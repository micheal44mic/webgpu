import { readEditorHtml } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_MAX_EDGE,
  DOCUMENT_SIZES,
  DOCUMENT_WIDTH,
  LAYER_SIZE,
  at,
  expected,
  read,
} from "./profile-context.mjs";

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
  const indexSource = readEditorHtml();
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
