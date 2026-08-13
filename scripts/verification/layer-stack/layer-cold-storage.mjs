import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import { readRepositorySource } from "../source-contract.mjs";

const engineSource = readEngineSource();
const activateStart = engineSource.indexOf("  async activateLayer(");
const activateEnd = engineSource.indexOf(
  "  destroyThicknessTailOverlayResources(): void",
  activateStart,
);
const layerHistoryGpuTestSource = readRepositorySource("src/labs/gpu/layer-history-gpu-test.ts");
const layerCompositeGpuTestSource = readRepositorySource("src/labs/gpu/layer-composite-gpu-test.ts");
const humanLabSource = readRepositorySource("src/labs/human-stroke-lab.ts");
const gpuMemoryPanelSource = readRepositorySource("src/gpu-memory-panel-controller.ts");

// Telemetry has to sign both layer identity and actual hot/cold storage.
assert.match(engineSource, /layerCount: engine\.layerStack\.count/);
assert.match(
  engineSource,
  /layerMemoryMiB:\s*gpuMemory\.layerBaseMiB\s*\+ gpuMemory\.layerColdMiB\s*\+ gpuMemory\.layerHydrationMiB/,
);
assert.match(engineSource, /layerCount: number;/);
assert.match(engineSource, /activeLayerId: number;/);

const layerStorageStudySource = readFileSync(
  new URL("../../../src/layer-storage-study.ts", import.meta.url),
  "utf8",
);
assert.match(
  layerStorageStudySource,
  /single-active-plus-optional-reference-full-inactive-256-array-tiles-direct-native-fold-fallback-rehydrate/,
);
assert.match(layerStorageStudySource, /LAYER_STORAGE_TILE_WIDTH = DOCUMENT_TILE_WIDTH/);
assert.match(layerStorageStudySource, /LAYER_STORAGE_TILE_HEIGHT = DOCUMENT_TILE_HEIGHT/);
assert.match(layerStorageStudySource, /LAYER_STORAGE_DOCUMENT_WIDTH = DOCUMENT_WIDTH/);
assert.match(layerStorageStudySource, /LAYER_STORAGE_DOCUMENT_HEIGHT = DOCUMENT_HEIGHT/);
assert.match(
  layerStorageStudySource,
  /Math\.floor\(pixelLeft \/ LAYER_STORAGE_TILE_WIDTH\)[\s\S]*?Math\.floor\(pixelTop \/ LAYER_STORAGE_TILE_HEIGHT\)/,
  "la griglia cold deve mappare X e Y con estensioni tile indipendenti",
);
assert.match(layerStorageStudySource, /"Occupied" deliberately means ANY non-zero byte/);
assert.doesNotMatch(
  layerStorageStudySource,
  /GPUTexture|GPUBuffer|GPUDevice|GPUQueue/,
  "la matematica delle tile deve restare pura e testabile senza WebGPU",
);
const mutationStart = engineSource.indexOf("noteLayerMutation(");
const mutationBody = engineSource.slice(mutationStart, mutationStart + 1_100);
assert.match(
  mutationBody,
  /clearLayerStorageTileMask\(this\.layerStack\.active\.storageTileMask\)/,
  "clear deve azzerare la maschera del solo livello attivo",
);
assert.match(
  mutationBody,
  /markLayerStorageRect\(this\.layerStack\.active\.storageTileMask, dirtyRect\)/,
  "ogni mutazione raw deve raggiungere il collo di bottiglia della maschera",
);
const packStart = engineSource.indexOf("export async function createLayerColdStorageCandidate(");
const packBody = engineSource.slice(packStart, packStart + 4_300);
assert.match(packBody, /hot\.format !== engine\.layerFormat/);
assert.match(packBody, /const format = hot\.format/);
assert.match(packBody, /layerFormatBytesPerPixel\(format\)/);
assert.match(packBody, /return \{ texture, tileIndices, memoryBytes, generation, format \}/);
assert.match(packBody, /depthOrArrayLayers: tileIndices\.length/);
assert.match(packBody, /tileIndices\.forEach\(\(tileIndex, arrayLayer\) =>/);
assert.match(packBody, /copyTextureToTexture\(/);
assert.ok(
  packBody.indexOf("await engine.waitForGpuCapped(")
    < packBody.indexOf('engine.maybeInjectLayerColdStorageFault("after-pack-submit")'),
  "il candidato cold non può essere pubblicato prima del completamento GPU",
);
const freezeStart = engineSource.indexOf("export async function freezeActiveLayerToCold(");
const freezeBody = engineSource.slice(freezeStart, freezeStart + 1_400);
assert.match(freezeBody, /const candidate = await createLayerColdStorageCandidate\(engine,/);
assert.match(freezeBody, /gpu\.cold = candidate;/);
assert.match(freezeBody, /record\.storageTileMask\.set\(mask\)/);
const hydrateStart = engineSource.indexOf("export async function createHydratedLayerTexture(");
const hydrateBody = engineSource.slice(hydrateStart, hydrateStart + 2_600);
assert.match(hydrateBody, /encodeLayerColdHydration\(encoder, cold, hot\)/);
assert.match(engineSource, /assertColdMatchesHot\(cold, hot\)/);
// Il codec non e' piu' vincolato a quattro byte: la taglia del tile viene dal
// formato del documento. L'invariante che conta si e' spostata, non indebolita —
// un cold compresso deve descrivere lo **stesso** formato del documento, perche'
// decomprimere byte di un formato dentro una texture dell'altro produrrebbe
// pixel plausibili e sbagliati.
assert.match(
  engineSource,
  /function coldCodecTileBytes\(format: LayerFormat\)[\s\S]*?layerFormatBytesPerPixel\(format\)/,
  "la taglia del tile compresso deve seguire il formato del documento",
);
assert.doesNotMatch(
  engineSource,
  /RGBA8_COLD_CODEC_BYTES_PER_PIXEL/,
  "la costante a quattro byte non deve sopravvivere alla generalizzazione",
);
assert.match(
  engineSource,
  /compressed\.format !== engine\.layerFormat/,
  "il ripristino deve rifiutare un cold compresso di formato diverso dal documento",
);
// La compressione si paga in latenza al prossimo cambio livello, quindi non
// deve partire a vuoto. Ma il criterio non puo' essere la sola pressione: con
// un tetto largo la zona resta verde per sempre e la compressione non parte
// mai. Servono entrambe le vie — pressione **oppure** abbastanza da recuperare.
assert.match(
  engineSource,
  /compressionIsWorthwhile\(\)[\s\S]*?if \(zone !== "green"\) return true;/,
  "sotto pressione la compressione deve partire sempre",
);
assert.match(
  engineSource,
  /layerColdCompressionDistantGpuBytes\(\)\s*>= layerBytes \* LAYER_COLD_COMPRESSION_IDLE_THRESHOLD_RATIO/,
  "in zona verde la compressione deve partire quando c'e' abbastanza da recuperare",
);
assert.doesNotMatch(
  engineSource,
  /return zone !== "green";\s*\}/,
  "la sola pressione non basta come criterio: con un tetto largo non scatterebbe mai",
);
assert.match(
  engineSource,
  /!this\.layerColdCompressionEnabled \|\| !this\.compressionIsWorthwhile\(\)/,
  "il candidato alla compressione deve passare dal cancello",
);
assert.match(hydrateBody, /await engine\.waitForGpuCapped\(label\)/);
assert.match(hydrateBody, /engine\.liveLayerHydrationTextures\.set\(hot\.texture, memoryBytes\)/);
const activateStorageBody = engineSource.slice(activateStart, activateEnd);
assert.ok(
  activateStorageBody.indexOf("await ensureActiveLayerHot(this, record);")
    < activateStorageBody.indexOf("bindActiveLayerResources(this);"),
  "il livello entrante deve essere reidratato prima di legare i renderer",
);
assert.ok(
  activateStorageBody.indexOf("await this.rebuildMergedLayerSurfaces(caller);")
    < activateStorageBody.indexOf("commitActiveLayerResidency(this, fromIndex);"),
  "il cold duplicato dell'attivo può essere rilasciato solo dopo il compositing riuscito",
);
assert.match(engineSource, /const layerColdMiB = baseResourcesAllocated/);
assert.match(engineSource, /const layerHydrationMiB = \([\s\S]*?engine\.layerColdRestoreActiveBytes/);
assert.match(engineSource, /measurementOnly: false/);
assert.match(
  engineSource,
  /projectedConservativeRawMiB = residentFullMiB \+ inactiveConservativeTileMiB/,
  "la proiezione deve conservare attivo e riferimento full-canvas",
);
const exactStudyStart = engineSource.indexOf("export async function measureExactLayerStorageStudy(");
const exactStudyBody = engineSource.slice(exactStudyStart, exactStudyStart + 4_500);
assert.match(exactStudyBody, /import\.meta\.env\.DEV/);
assert.match(exactStudyBody, /await engine\.readLayerPixels\(undefined, index\)/);
assert.match(exactStudyBody, /compareLayerStorageMasks\(exactMask, record\.storageTileMask\)/);
assert.match(exactStudyBody, /countedGpuMiBBefore/);
assert.match(exactStudyBody, /countedGpuMiBAfter/);
assert.match(exactStudyBody, /temporaryReadbackPeakMiB/);
assert.match(
  layerCompositeGpuTestSource,
  /compositeSchedulingAndBoundsSignatureMatches:[\s\S]*?deferred-to-fold-fence-bounded-visual-rect/,
  "l'harness GPU deve firmare scheduling e bounds prima di leggere i tempi",
);
assert.match(
  layerCompositeGpuTestSource,
  /boundedBakeSignatureMatches:[\s\S]*?transient-analytic-bounded-visual-rect/,
  "l'harness GPU deve firmare anche il bake bounded",
);
assert.match(layerCompositeGpuTestSource, /fiveLayerAnalyticBakeDomainWasBounded/);
assert.match(layerCompositeGpuTestSource, /fiveLayerSwitchBreakdownIsConsistent/);
assert.match(layerHistoryGpuTestSource, /measureExactLayerStorageStudy\(\)/);
assert.match(layerHistoryGpuTestSource, /conservativeTilesContainEveryExactTile/);
assert.match(layerHistoryGpuTestSource, /exactReadbackReleasedItsTemporaryBuffers/);
assert.match(humanLabSource, /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 64/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerCold/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerCompressed/);
assert.match(gpuMemoryPanelSource, /gpuMemoryLayerHydration/);
assert.match(gpuMemoryPanelSource, /Raw livelli · effettivo/);
assert.match(gpuMemoryPanelSource, /Memoria logica WebGPU realmente allocata/);
assert.match(gpuMemoryPanelSource, /non è memoria allocata/);
