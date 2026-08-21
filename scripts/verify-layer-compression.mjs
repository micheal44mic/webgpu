import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";
import {
  LAYER_COMPRESSION_CHUNK_TILE_COUNT,
  LAYER_COMPRESSION_CODEC,
  combineCompressionHashes,
  compressLosslessGzipChunk,
  formatCompressionHash,
  hashCompressionBytes,
  measureLosslessGzipChunk,
} from "../src/layer-compression-codec.ts";
import {
  LAYER_COMPRESSION_STUDY_BUILD,
  LAYER_COMPRESSION_STUDY_VERSION,
} from "../src/labs/memory/layer-compression-study-contract.ts";

assert.equal(LAYER_COMPRESSION_STUDY_VERSION, 1);
assert.equal(
  LAYER_COMPRESSION_STUDY_BUILD,
  "lossless-gzip-256-tile-1mib-streamed-measurement-v1",
);
assert.equal(LAYER_COMPRESSION_CODEC, "compression-stream-gzip");
assert.equal(LAYER_COMPRESSION_CHUNK_TILE_COUNT, 4);

const tinyTileBytes = 16;
const classified = new Uint8Array(tinyTileBytes * 2);
for (let offset = tinyTileBytes; offset < classified.length; offset += 4) {
  classified[offset] = 12;
  classified[offset + 1] = 34;
  classified[offset + 2] = 56;
  classified[offset + 3] = 255;
}
const classifiedMeasurement = await measureLosslessGzipChunk(
  classified,
  tinyTileBytes,
);
assert.equal(classifiedMeasurement.byteIdentical, true);
assert.equal(classifiedMeasurement.zeroTileCount, 1);
assert.equal(classifiedMeasurement.solidTileCount, 2);
assert.equal(classifiedMeasurement.sourceHash, classifiedMeasurement.restoredHash);
assert.ok(classifiedMeasurement.adaptiveStoredBytes <= classified.byteLength);
const classifiedPayload = await compressLosslessGzipChunk(classified, tinyTileBytes);
assert.equal(classifiedPayload.storage, "gzip");
assert.equal(classifiedPayload.measurement.sourceHash, hashCompressionBytes(classified));
assert.equal(
  classifiedPayload.bytes.byteLength,
  classifiedPayload.measurement.adaptiveStoredBytes,
);

const realTileBytes = 256 * 256 * 4;
const zeros = new Uint8Array(realTileBytes);
const zeroMeasurement = await measureLosslessGzipChunk(zeros, realTileBytes);
assert.equal(zeroMeasurement.zeroTileCount, 1);
assert.equal(zeroMeasurement.solidTileCount, 1);
assert.equal(zeroMeasurement.usedRawFallback, false);
assert.ok(zeroMeasurement.gzipBytes < 1024);

const noisy = new Uint8Array(realTileBytes);
let state = 0x12345678;
for (let index = 0; index < noisy.length; index += 1) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  noisy[index] = state & 0xff;
}
const noisyMeasurement = await measureLosslessGzipChunk(noisy, realTileBytes);
assert.equal(noisyMeasurement.byteIdentical, true);
assert.ok(noisyMeasurement.adaptiveStoredBytes <= noisy.byteLength);
const noisyPayload = await compressLosslessGzipChunk(noisy, realTileBytes);
assert.equal(noisyPayload.storage, "raw");
assert.equal(noisyPayload.bytes.byteLength, noisy.byteLength);

const combinedSource = combineCompressionHashes(
  0x811c9dc5,
  classifiedMeasurement.sourceHash,
  classifiedMeasurement.rawBytes,
);
const combinedRestored = combineCompressionHashes(
  0x811c9dc5,
  classifiedMeasurement.restoredHash,
  classifiedMeasurement.rawBytes,
);
assert.equal(combinedSource, combinedRestored);
assert.match(formatCompressionHash(combinedSource), /^[0-9a-f]{8}$/);

const engineSource = readEngineSource();
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const gpuMemoryPanelSource = readFileSync(
  new URL("../src/gpu-memory-panel-controller.ts", import.meta.url),
  "utf8",
);
const interactionSource = readFileSync(
  new URL("../src/document-interaction-controller.ts", import.meta.url),
  "utf8",
);
const labOperationsSource = readFileSync(
  new URL("../src/labs/engine-lab-operations.ts", import.meta.url),
  "utf8",
);
const editorLabsSource = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const labsStartupSource = readFileSync(
  new URL("../src/labs/startup.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../src/layer-cold-compression-worker.ts", import.meta.url),
  "utf8",
);
const clientSource = readFileSync(
  new URL("../src/layer-cold-compression-client.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sitesSource = readFileSync(
  new URL("../scripts/prepare-sites-build.mjs", import.meta.url),
  "utf8",
);

const schemaSource = readFileSync(
  new URL("../db/schema.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL("../.openai/drizzle/0004_layer_compression_runs.sql", import.meta.url),
  "utf8",
);

assert.match(engineSource, /layerCompressionTestEnabled\?: boolean/);
assert.match(engineSource, /readLayerColdStorageTiles\(/);
assert.match(engineSource, /depthOrArrayLayers: arrayLayerCount/);
assert.match(labOperationsSource, /async function measureLayerColdCompressionStudy\(/);
assert.match(labOperationsSource, /temporaryReadbackPeakMiB/);
const studyStart = labOperationsSource.indexOf("export async function measureLayerColdCompressionStudy(");
const studyEnd = labOperationsSource.indexOf("export async function measureActiveStyleBakeGap(", studyStart);
assert.ok(studyStart >= 0 && studyEnd > studyStart);
const studyBody = labOperationsSource.slice(studyStart, studyEnd);
assert.doesNotMatch(studyBody, /destroyLayerColdStorage/);
assert.match(studyBody, /countedGpuMiBAfter - countedGpuMiBBefore/);
assert.match(studyBody, /measureLosslessGzipChunk/);

assert.match(clientSource, /direct-hot-prefetch-policy-pointer-gated-v5/);
assert.match(clientSource, /new Worker\(/);
assert.match(clientSource, /layer-cold-compression-worker\.ts/);
assert.match(clientSource, /this\.worker\.postMessage\(message, transfer\)/);
assert.match(
  clientSource,
  /const workerCopy = chunk\.bytes\.slice\(0\)/,
  "la decompressione non deve trasferire l'unica copia compressa autorevole",
);
assert.match(workerSource, /typeof CompressionStream === "function"/);
assert.match(workerSource, /compressLosslessGzipChunk/);
assert.match(workerSource, /hashCompressionBytes\(restored\)/);
assert.match(workerSource, /workerScope\.postMessage\([\s\S]*?\[output\]\)/);
assert.match(engineSource, /layerColdCompressionEnabled\?: boolean/);
assert.match(engineSource, /layerColdCompressionStatusEnabled\?: boolean/);
assert.match(engineSource, /layerColdDirectHotHydrationEnabled\?: boolean/);
assert.match(engineSource, /layerColdAdjacentPrefetchEnabled\?: boolean/);
assert.match(engineSource, /LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE/);
assert.doesNotMatch(
  engineSource,
  /\[\.\.\.this\.layerGpu\.values\(\)\]\.some\(\(gpu\) => gpu\.compressed !== null\)/,
  "più livelli distanti devono poter restare compressi insieme",
);
assert.match(
  engineSource,
  /export async function ensureAdjacentLayerColdStorageResident\([\s\S]*?activeIndex - 1[\s\S]*?activeIndex \+ 1[\s\S]*?ensureLayerColdStorageResident/,
  "i due vicini devono essere riportati raw prima di pubblicare il cambio",
);
assert.match(
  engineSource,
  /await ensureActiveLayerHot\(this, record\);[\s\S]*?if \(this\.layerColdAdjacentPrefetchEnabled\) \{[\s\S]*?await ensureAdjacentLayerColdStorageResident\(this\);/,
  "il prefetch raw dei vicini deve essere disabilitabile sui device memory-constrained",
);
assert.match(engineSource, /compressOneDistantLayerInBackground/);
assert.match(
  engineSource,
  /await client\.compress\(\s*payload,\s*tileByteLength,/,
  "la compressione deve continuare a passare per il client del worker",
);
// Il byte shuffle vale solo su componenti a due byte: su RGBA8 sarebbe una
// permutazione inutile che costa una copia.
assert.match(
  engineSource,
  /source\.cold\.format === "rgba16float" \? 2 : 1/,
  "il numero di byte per componente deve derivare dal formato del cold",
);
assert.match(
  workerSource,
  /request\.storage === "gzip-shuffle16"[\s\S]*?unshuffle16\(await gunzipBytes\(stored\)\)/,
  "il worker deve invertire lo shuffle in base al tag del payload",
);
const beginStrokeStart = engineSource.indexOf(
  "beginStrokeAtLayer(point: LayerPoint, deferredPreview = false)",
);
const beginStrokeEnd = engineSource.indexOf("extendStroke(", beginStrokeStart);
const beginStrokeBody = engineSource.slice(beginStrokeStart, beginStrokeEnd);
assert.match(beginStrokeBody, /pauseLayerColdCompressionIdle\(this\)/);
assert.match(interactionSource, /browser\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*?pauseLayerColdCompressionForInteraction\(\)/);
assert.match(engineSource, /layerColdCompressionInteractionActive = true;[\s\S]*?pauseLayerColdCompressionIdle\(this\)/);
assert.match(engineSource, /layerColdCompressionEngineIdle\([\s\S]*?!engine\.layerColdCompressionInteractionActive/);
assert.match(interactionSource, /compressionPointers\.size === 0[\s\S]*?resumeLayerColdCompressionAfterInteraction\(\)/);
assert.match(interactionSource, /compressionPointers\.size === 0[\s\S]*?document\.visibilityState === "visible"[\s\S]*?document\.hasFocus\(\)[\s\S]*?resumeLayerColdCompressionAfterInteraction/);
// `cancelLayerColdCompressionIdle` è rimasto un metodo della classe: il
// negativo deve cercare la forma che il codice può davvero assumere, con
// entrambi i ricevitori possibili, altrimenti non fallirebbe mai.
assert.doesNotMatch(
  beginStrokeBody,
  /(this|engine)\.cancelLayerColdCompressionIdle\(|cancelLayerColdCompressionIdle\((this|engine)\)/,
  "un gesto non deve invalidare i chunk verificati del livello distante",
);
const pauseStart = engineSource.indexOf("export function pauseLayerColdCompressionIdle(");
assert.ok(pauseStart >= 0, "pauseLayerColdCompressionIdle non trovata");
// Delimitata dalla dichiarazione successiva, non da una finestra fissa: se la
// funzione cresce, la coda resta comunque coperta dal negativo qui sotto.
const pauseEnd = engineSource.indexOf("\nexport ", pauseStart + 1);
assert.ok(pauseEnd > pauseStart, "fine di pauseLayerColdCompressionIdle non trovata");
const pauseBody = engineSource.slice(pauseStart, pauseEnd);
assert.match(pauseBody, /clearLayerColdCompressionIdleTimer/);
assert.doesNotMatch(pauseBody, /layerColdCompressionEpoch/);
const runtimeCompressionStart = engineSource.indexOf(
  "export async function compressOneDistantLayerInBackground(",
);
const runtimeCompressionEnd = engineSource.indexOf(
  "export async function ensureLayerColdStorageResident(",
  runtimeCompressionStart,
);
const runtimeCompressionBody = engineSource.slice(
  runtimeCompressionStart,
  runtimeCompressionEnd,
);
assert.match(runtimeCompressionBody, /progress\.chunks\.push\(result\.chunk\)/);
assert.match(runtimeCompressionBody, /progress\.nextArrayLayer \+= chunkTileCount/);
assert.match(
  runtimeCompressionBody,
  /if \(!layerColdCompressionEngineIdle\(engine\)\) \{[\s\S]*?return;[\s\S]*?readLayerColdStorageTiles/,
  "nessuna nuova lettura GPU deve partire mentre il motore non è idle",
);
assert.match(runtimeCompressionBody, /\$\{source\.record\.name\} compression paused/);
assert.match(
  engineSource,
  /const delayMs = this\.layerColdCompressionProgress[\s\S]*?\? 0[\s\S]*?: LAYER_COLD_COMPRESSION_IDLE_DELAY_MS/,
  "un job parziale deve riprendere subito dopo il lift senza anticipare il primo readback",
);
assert.match(
  engineSource,
  /\+ \(engine\.layerColdCompressionProgress\?\.storedBytes \?\? 0\)/,
  "la RAM dei chunk parziali deve essere conteggiata",
);
assert.match(
  engineSource,
  /source\.gpu\.compressed = \{[\s\S]*?source\.gpu\.cold = null;[\s\S]*?destroyLayerColdStorage\(source\.cold\)/,
  "il cold GPU può essere distrutto solo dopo la pubblicazione atomica dei byte compressi",
);
const transientHydrationStart = engineSource.indexOf(
  "export async function uploadCompressedLayerIntoHot(",
);
const transientHydrationEnd = engineSource.indexOf(
  "export async function createHydratedLayerTexture(",
  transientHydrationStart,
);
assert.ok(transientHydrationStart >= 0 && transientHydrationEnd > transientHydrationStart);
const transientHydrationBody = engineSource.slice(
  transientHydrationStart,
  transientHydrationEnd,
);
assert.match(transientHydrationBody, /await decompressLayerColdChunk\(engine, chunk\)/);
assert.match(transientHydrationBody, /engine\.device\.queue\.writeTexture/);
assert.match(transientHydrationBody, /restoredHash !== compressed\.sourceHash/);
assert.doesNotMatch(
  transientHydrationBody,
  /gpu\.compressed = null/,
  "il fold transitorio deve conservare lo storage compresso autorevole",
);
assert.match(
  engineSource,
  /if \(gpu\.cold && gpu\.compressed\)[\s\S]*?const directCompressedHydration = completionPolicy === "defer-to-fold-fence"[\s\S]*?engine\.layerColdDirectHotHydrationEnabled;[\s\S]*?const compressedSource = directCompressedHydration && !gpu\.cold[\s\S]*?if \(!compressedSource\) \{[\s\S]*?ensureLayerColdStorageResident/,
  "anche l'attivazione deve saltare il cold GPU intermedio quando esistono byte compressi",
);
const directHydrationStart = engineSource.indexOf(
  "export async function createHydratedLayerTexture(",
);
const directHydrationEnd = engineSource.indexOf(
  "export async function decompressLayerColdChunk(",
  directHydrationStart,
);
const directHydrationBody = engineSource.slice(directHydrationStart, directHydrationEnd);
assert.match(directHydrationBody, /uploadCompressedLayerIntoHot\(engine, record, gpu, compressedSource, hot\)/);
assert.match(
  directHydrationBody,
  /if \(completionPolicy === "await-immediately"\) \{[\s\S]*?waitForGpuCapped\(label\)[\s\S]*?after-hydrate-submit/,
  "l'attivazione diretta deve conservare fence e fault point transazionali",
);
assert.doesNotMatch(
  directHydrationBody,
  /gpu\.compressed = null/,
  "il commit, non la hydration, possiede il rilascio dei byte autorevoli",
);
assert.match(engineSource, /await ensureLayerColdStorageResident\(engine, record, gpu\)/);
assert.match(engineSource, /await decompressLayerColdChunk\(engine, chunk\)/);
assert.match(engineSource, /restoredHash !== compressed\.sourceHash/);
assert.match(engineSource, /await engine\.waitForGpuCapped\(`Upload compressed cold storage for layer/);
assert.match(engineSource, /gpu\.cold = \{[\s\S]*?gpu\.compressed = null/);
assert.match(engineSource, /const layerCompressedCpuMiB =/);
const countedStart = engineSource.indexOf("const countedTotalMiB = [");
const countedEnd = engineSource.indexOf("].reduce", countedStart);
assert.ok(countedStart >= 0 && countedEnd > countedStart);
assert.doesNotMatch(
  engineSource.slice(countedStart, countedEnd),
  /layerCompressedCpuMiB/,
  "la RAM compressa non deve gonfiare il totale GPU conteggiato",
);
assert.match(engineSource, /const countedGpuPlusCompressedCpuMiB = countedTotalMiB \+ layerCompressedCpuMiB/);
assert.match(mainSource, /const appleMobileMemoryLifecycle =/);
assert.match(mainSource, /const layerColdCompressionRequested =[\s\S]*?layerColdCompressionMode === "1"/);
assert.match(mainSource, /layerColdCompressionEnabled: layerColdCompressionRequested/);
assert.match(mainSource, /layerColdCompressionStatusEnabled: layerColdCompressionMode === "1"/);
assert.match(engineSource, /publishLayerColdCompressionStatus\([\s\S]*?if \(this\.layerColdCompressionStatusEnabled\)/);
assert.doesNotMatch(
  runtimeCompressionBody,
  /engine\.callbacks\.onStatus/,
  "il lifecycle automatico non deve sovrascrivere direttamente lo stato UI",
);
assert.match(mainSource, /pageSearchParams\.get\("layerDirectHotHydration"\) !== "0"/);
assert.match(mainSource, /layerColdDirectHotHydrationEnabled,/);
assert.match(mainSource, /layerColdAdjacentPrefetchEnabled,/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerCompressed/);assert.match(engineSource, /layerColdCompressionProgress: \{/);
assert.match(engineSource, /completedTileCount: engine\.layerColdCompressionProgress\.nextArrayLayer/);
assert.match(engineSource, /pausedByStroke: engine\.activeStroke !== null/);
assert.match(gpuMemoryPanelSource, /const LAYER_STATE_LABEL:[\s\S]*?compressed: "compressed"/);
assert.match(gpuMemoryPanelSource, /livello\.compressedCpuMiB > 0[\s\S]*?compressed RAM/);
assert.match(indexSource, /Layer · compressed · CPU RAM/);
assert.match(indexSource, /Counted total · GPU \+ cold CPU RAM/);
assert.doesNotMatch(mainSource, /layerCompressionStudy|measureLayerColdCompressionStudy|saveLayerCompressionRun/);
assert.match(labsStartupSource, /layerCompressionTestEnabled: true/);
assert.match(editorLabsSource, /\["layer-compression", "Studio compressione lossless"\]/);
assert.match(editorLabsSource, /measureLayerColdCompressionStudy\(engine/);
assert.match(editorLabsSource, /saveLabReport\("\/api\/layer-compression-runs", report\)/);
assert.match(sitesSource, /\/api\/layer-compression-runs/);
assert.match(sitesSource, /layer_compression_runs/);
assert.match(sitesSource, new RegExp(LAYER_COMPRESSION_STUDY_BUILD));
assert.match(schemaSource, /layerCompressionRunsSchemaSql/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS layer_compression_runs/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS layer_compression_runs/);
assert.match(migrationSource, /layer_compression_runs_created_at_idx/);

console.log(JSON.stringify({
  passed: true,
  version: LAYER_COMPRESSION_STUDY_VERSION,
  build: LAYER_COMPRESSION_STUDY_BUILD,
  zeroTileGzipBytes: zeroMeasurement.gzipBytes,
  noisyTileGzipBytes: noisyMeasurement.gzipBytes,
  noisyUsesRawFallback: noisyMeasurement.usedRawFallback,
}, null, 2));
