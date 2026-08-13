import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import {
  assertBoundedSourceSection as assertSection,
  readRepositorySource,
} from "../source-contract.mjs";

const engineSource = readEngineSource();
const layerRecreationSource = readRepositorySource(
  "src/engine-layer-recreation-runtime.ts",
);
const brushSettingsRuntimeSource = readRepositorySource(
  "src/engine-brush-settings-runtime.ts",
);
const mainSource = readRepositorySource("src/main.ts");
const editorLabsSource = readRepositorySource("src/labs/editor-labs.ts");
const labOperationsSource = readRepositorySource("src/labs/engine-lab-operations.ts");

// The GPU regression is persistent, destructive on a fresh page and capped.
// History rollback and the absolute three-surface compositor references run in
// the same `?layerHistoryTest=1` harness.
const layerHistoryGpuTestSource = readFileSync(
  new URL("../../../src/labs/gpu/layer-history-gpu-test.ts", import.meta.url),
  "utf8",
);
const layerCompositeGpuTestSource = readFileSync(
  new URL("../../../src/labs/gpu/layer-composite-gpu-test.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(mainSource, /layerHistoryTest|runLayerHistoryGpuTest/);
assert.match(editorLabsSource, /case "layer-history"/);
assert.match(editorLabsSource, /import\("\.\/gpu\/layer-history-gpu-test"\)/);
assert.match(editorLabsSource, /runLayerHistoryGpuTest\(engine\)/);
assert.match(
  editorLabsSource,
  /return await Promise\.race\(\[\s*runLayerHistoryGpuTest\(engine\),/,
  "l'esecuzione dell'harness deve avere un tetto di tempo",
);
assert.match(editorLabsSource, /Test livelli scaduto dopo 180 s/);
assert.match(editorLabsSource, /180_000/);
assert.match(editorLabsSource, /window\.clearTimeout\(timeoutId\)/,
  "il timer dell'harness deve essere disarmato dopo successo o errore");
assert.match(editorLabsSource, /this\.#latchedBusy = true/,
  "dopo timeout la pagina Labs deve restare bloccata perché Promise.race non cancella il test");
assert.match(layerHistoryGpuTestSource, /LAYER_HISTORY_GPU_TEST_VERSION = 13 as const/);
assert.match(layerHistoryGpuTestSource, /await engine\.duplicateSelectedLayer\(\)/);
assert.match(layerHistoryGpuTestSource, /duplicatePaintUndoUsedSeedByteExactly/);
assert.match(layerHistoryGpuTestSource, /duplicateStructuralUndoRedoWasByteExact/);
assert.match(layerHistoryGpuTestSource, /initialStats\.layerFormat !== "rgba16float"/);
assert.match(layerHistoryGpuTestSource, /const rawBytesPerPixel = 8 as const/);
assert.match(layerHistoryGpuTestSource, /storageStudyUsesRgba16fBytes/);
assert.match(layerHistoryGpuTestSource, /crossLayerRedoRestoredAStrokeByteExactly/);
assert.match(layerHistoryGpuTestSource, /redoRestoredBByteExactly/);
assert.match(layerCompositeGpuTestSource, /fiveLayerSwitchMemoryPeaks/);
assert.match(layerCompositeGpuTestSource, /fiveLayerMiddleSwitchMemoryPeaks/);
assert.match(layerCompositeGpuTestSource, /measureMemoryPeakDuring/);
assert.match(layerHistoryGpuTestSource, /measureActiveStyleBakeGap\(engine, pRect\)/);
assert.match(layerHistoryGpuTestSource, /engine\.injectLayerBakeFault\("after-candidate-submit"\)/);
assert.match(layerHistoryGpuTestSource, /injectedBakeFailureReleasedCandidate/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 0\)/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 1\)/);
assert.match(layerHistoryGpuTestSource, /const undoReturned = await engine\.undo\(\)/);
assert.match(layerHistoryGpuTestSource, /const redoReturned = await engine\.redo\(\)/);
assert.match(
  layerHistoryGpuTestSource,
  /await engine\.setActiveLayer\(1\);\s*const activeBeforeCrossLayerRedo[\s\S]*?const crossLayerRedoReturned = await engine\.redo\(\)/,
  "il redo cross-layer deve partire deliberatamente dal livello sbagliato",
);
assert.match(
  layerHistoryGpuTestSource,
  /await engine\.setActiveLayer\(0\);[\s\S]{0,500}await draw\(768, 512,[\s\S]{0,500}const layerAHistoryBaseline[\s\S]{0,250}await engine\.setActiveLayer\(1\)/,
  "il probe cross-layer deve registrare un Paint su A dopo layer-add e tornare su B",
);
assert.match(layerHistoryGpuTestSource, /probeRollback\("after-first-replay-submit"\)/);
assert.match(layerHistoryGpuTestSource, /probeRollback\("during-switch-activation"\)/);
assert.match(
  layerHistoryGpuTestSource,
  /probeRollback\(\s*"after-first-replay-submit",\s*"during-switch-activation",\s*\)/,
  "il test deve esercitare anche un errore durante il rollback",
);
assert.match(layerHistoryGpuTestSource, /fatalRollbackLatchedInconsistent: fatalRollback\.historyInconsistent/);
assert.match(layerHistoryGpuTestSource, /fatalLatchRefusedAnotherUndo: !fatalFollowUpUndoReturned/);
assert.match(layerHistoryGpuTestSource, /twoAndFiveLayerMipMemoryTracksBoundedComposites/);
assert.match(layerHistoryGpuTestSource, /twoAndFiveLayerCompositeMemoryIsBounded/);
assert.match(layerCompositeGpuTestSource, /decodeFloat16/);
assert.match(
  layerCompositeGpuTestSource,
  /const fullLayerMiB = engine\.layerSize \* engine\.layerSize \* 8/,
);

assert.match(layerCompositeGpuTestSource, /expectedPresentation\(/);
assert.match(layerCompositeGpuTestSource, /sourceOver\(above, sourceOver\(active, below\)\)/,
  "il riferimento indipendente deve fissare sopra over attivo over sotto");
assert.match(layerCompositeGpuTestSource, /wrongSrgbSpacePresentation\(/,
  "il riferimento deve discriminare la composizione eseguita nello spazio sbagliato");
assert.match(layerCompositeGpuTestSource, /engine\.injectLayerCompositeFault\("after-candidate-submit"\)/);
assert.match(layerCompositeGpuTestSource, /setLayerOpacity\(2, 0\.25\)/);
assert.match(layerCompositeGpuTestSource, /setLayerVisibility\(2, false\)/);
assert.match(layerCompositeGpuTestSource, /readMergedLayerPixels\(\s*"above",[\s\S]*?2,\s*true,/,
  "la sonda matematica zoom deve completare esplicitamente la piramide merged");
assert.match(layerCompositeGpuTestSource, /zoomBuiltFinalRasterStackMip2/,
  "il test visuale zoom deve verificare il percorso final-raster-stack corrente");
assert.match(layerCompositeGpuTestSource, /zoomExplicitReadbackCompletedMergedAboveMip2/);
assert.match(layerCompositeGpuTestSource, /zoomMip2MatchesIndependentBoxFilter/);
assert.match(layerCompositeGpuTestSource, /fiveLayerBakesWereReleased/);
assert.match(layerCompositeGpuTestSource, /opaqueRawFastPathIsByteExact/);
// The switch lock has to be held across the awaits, or a pointerdown landing
// during the 150-215 ms rebuild starts a stroke on a half-swapped layer.
// Ancorata alla dichiarazione del campo: un assegnamento dentro un `finally`
// soddisfarebbe il pattern senza provare che il campo esista ancora.
assert.match(engineSource, /^ {2}layerSwitchBusy = false;$/m);
assert.match(
  engineSource,
  /if \(this\.historyBusy \|\| this\.activeStroke \|\| this\.layerSwitchBusy \|\| this\.selectionBusy\) \{/,
  "beginStrokeAtLayer deve rifiutare durante uno switch",
);
assert.match(mainSource, /return !engineInitialized\s*\|\| sceneEditorController\?\.isBusy === true/,
  "il lock di switch deve entrare in operationLocked, non solo nella lista");

// The workbench is one retargetable instance, so a layer whose record says
// Traccia OR Smusso is enabled can arrive after another layer released the
// renderer. Without this the checkbox returns on and the effect stays absent.
assert.match(engineSource, /async ensureEffectRenderersForRecord\(record: LayerRecord\): Promise<void>/);
assert.match(
  engineSource,
  /await ensureEffectRenderersForRecord\(this, record\);/,
  "activateLayer deve garantire i renderer del livello entrante",
);
const ensureStart = engineSource.indexOf("export async function ensureEffectRenderersForRecord(");
const ensureBody = engineSource.slice(ensureStart, ensureStart + 1_800);
assert.match(ensureBody, /layerEffectRendererRequirements\(/,
  "la decisione Smusso-only deve passare dall'invariante testato");
assert.match(ensureBody, /if \(requirements\.needsStrokeRenderer\)/,
  "Smusso deve ricreare anche il compositore Traccia");
assert.match(
  ensureBody,
  /rasterStrokeScratchExtentForRenderer\([\s\S]*?strokeGeometryActive,[\s\S]*?requirements\.strokeWidth/,
  "il tier dipende dall'attività della Traccia e dalla width del livello entrante",
);
assert.match(ensureBody, /record\.strokeStyle\.enabled && record\.strokeStyle\.width > 0/,
  "un compositore senza Traccia deve usare lo scratch minimo");
assert.match(ensureBody, /renderer\.resizeScratch\(scratchExtent\)/);
assert.match(ensureBody, /setRasterStrokeGeometryEnabled\(engine, false\)/,
  "un livello senza Traccia deve liberare la geometria residente condivisa");
assert.match(engineSource, /strokeGeometryEnabled: strokeGeometryActive/,
  "la creazione del compositore deve rispettare la Traccia del livello entrante");

// A failed activation mutates Blend, effects and live content fields before it
// can reject. Rollback therefore has to run the complete activation path back
// to the outgoing layer; rebinding only the texture is not sufficient.
const selectMethodStart = engineSource.indexOf("async setActiveLayer(");
const selectMethodBody = engineSource.slice(selectMethodStart, selectMethodStart + 2_600);
assert.match(selectMethodBody, /activationStarted = true/);
const selectPrepare = selectMethodBody.indexOf("await this.prepareActiveLayerForSwitch();");
const selectIndexChange = selectMethodBody.indexOf("this.layerStack.setActiveIndex(index);");
assert.ok(
  selectPrepare >= 0 && selectIndexChange > selectPrepare,
  "setActiveLayer deve completare pack ed evizione prima di cambiare indice",
);
assert.match(selectMethodBody, /evictReconstructibleLayerResources\(this, this\.layerStack\.at\(index\)\);[\s\S]*?this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve evacuare il target fallito prima di reidratare l'origine");
assert.match(selectMethodBody, /this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve ritargettare tutti i sottosistemi");
assert.match(selectMethodBody, /Stato incoerente dopo il cambio livello:[\s\S]*?Ricarica la pagina/,
  "un doppio fallimento dello switch deve alzare il latch fatale");
const addMethodStart = engineSource.indexOf("async addLayer(");
// La transazione include ora anche il rollback dello stack misto raster/testo.
const addMethodEnd = engineSource.indexOf("async setActiveLayer(", addMethodStart);
assertSection("add layer", addMethodStart, addMethodEnd);
const addMethodBody = engineSource.slice(addMethodStart, addMethodEnd);
const addPrepare = addMethodBody.indexOf("await this.prepareActiveLayerForSwitch();");
const addRecord = addMethodBody.indexOf("this.layerStack.insertAt(layerInsertIndex, name)");
assert.ok(
  addPrepare >= 0 && addRecord > addPrepare,
  "addLayer deve congelare e impacchettare l'uscente prima del nuovo record",
);
assert.match(
  addMethodBody,
  /planMixedSceneRasterInsertion\([\s\S]*?scene\.selected\.key,[\s\S]*?clippingParentId/,
  "stack raster e scena mista devono derivare entrambi da un solo slot autorevole",
);
assert.match(
  addMethodBody,
  /scene\.insertRasterAt\(record\.id, sceneInsertIndex\)/,
  "l'inserimento eterogeneo pianificato deve pubblicare lo stesso raster nella scena",
);
assert.match(addMethodBody, /await allocateLayerGpuResources\(this,/);
const addActivation = addMethodBody.indexOf(
  "const result = await this.activateLayer(outgoingIndexAfterInsertion);",
);
const addLiveTextClear = addMethodBody.indexOf("this.clearVectorTextPresentation();");
assert.ok(
  addActivation >= 0 && addLiveTextClear > addActivation,
  "addLayer deve liberare la preview testo soltanto dopo che activateLayer ha "
    + "sbloccato la presentazione, altrimenti waitForIdle resta su displayDirty",
);
assert.match(addMethodBody, /Stato incoerente dopo la creazione del livello: ricarica prima di continuare/,
  "un doppio fallimento di addLayer deve alzare il latch fatale");
assert.match(
  addMethodBody,
  /const combined = new Error\([\s\S]*?Ricarica la pagina prima di continuare[\s\S]*?latchDocumentStateInconsistent\([\s\S]*?combined/,
  "la diagnosi fatale di Add deve conservare insieme errore iniziale e rollback",
);
assert.match(addMethodBody, /const insertedIndex = this\.layerStack\.indexOfId\(record\.id\);[\s\S]*?this\.layerStack\.remove\(insertedIndex\);[\s\S]*?const restoredIndex = this\.layerStack\.indexOfId\(activeRasterLayerIdBefore\);[\s\S]*?await this\.activateLayer\(restoredIndex\);/,
  "un OOM del nuovo mip 0 deve reidratare l'uscente già evacuato");
assert.match(addMethodBody, /evictReconstructibleLayerResources\(this, record\);[\s\S]*?const candidateIndex = this\.layerStack\.indexOfId\(record\.id\);[\s\S]*?this\.layerStack\.remove\(candidateIndex\);[\s\S]*?const restoredIndex = this\.layerStack\.indexOfId\(activeRasterLayerIdBefore\);[\s\S]*?await this\.activateLayer\(restoredIndex\);/,
  "il rollback di addLayer deve evacuare il nuovo hot prima di reidratare l'origine");
assert.match(addMethodBody, /this\.layerGpu\.delete\(record\.id\);[\s\S]*?destroyLayerGpuResources\(this, gpu\);[\s\S]*?await this\.activateLayer\(restoredIndex\);/,
  "il candidato fallito deve essere rimosso prima di ricostruire la scena originaria");

// Measurement setups reset the GLOBAL journal but clear only the active layer.
assert.match(engineSource, /get documentWideResetBlockedByLayers\(\): boolean/);
assert.match(engineSource, /if \(this\.documentWideResetBlockedByLayers\) \{/);
// A format change allocates the one active full texture before destruction; the
// inactive records are empty cold slots because the operation clears all layers.
assert.ok(
  engineSource.indexOf("const replacement = new Map<number, LayerGpuResources>();")
    < engineSource.indexOf("const supersededLayerGpu = [...engine.layerGpu.values()];"),
  "il cambio formato deve allocare prima di distruggere",
);
const pipelineFactoryStart = layerRecreationSource.indexOf(
  "async function createLayerPipelineBundle(",
);
const candidateAllocationStart = layerRecreationSource.indexOf(
  "async function allocateLayerResourceCandidate(",
);
const candidatePublishStart = layerRecreationSource.indexOf(
  "async function publishLayerResourceCandidate(",
);
const recreateStart = layerRecreationSource.indexOf(
  "export async function recreateLayerResources(",
);
assertSection(
  "layer pipeline candidate factory",
  pipelineFactoryStart,
  candidateAllocationStart,
);
assertSection(
  "layer resource candidate allocation",
  candidateAllocationStart,
  candidatePublishStart,
);
assertSection(
  "layer resource candidate publication",
  candidatePublishStart,
  recreateStart,
);
assertSection(
  "layer resource recreation orchestrator",
  recreateStart,
  layerRecreationSource.length,
);
const pipelineFactoryBody = layerRecreationSource.slice(
  pipelineFactoryStart,
  candidateAllocationStart,
);
const candidateAllocationBody = layerRecreationSource.slice(
  candidateAllocationStart,
  candidatePublishStart,
);
const candidatePublishBody = layerRecreationSource.slice(
  candidatePublishStart,
  recreateStart,
);
const recreateBody = layerRecreationSource.slice(recreateStart);
assert.match(pipelineFactoryBody, /runGpuAllocationTransaction\(\s*engine\.device,\s*`Pipeline formato layer/,
  "anche pipeline e layout devono chiudere validation/OOM scope");
assert.match(candidateAllocationBody, /record\.id === engine\.layerStack\.active\.id[\s\S]*?await allocateLayerGpuResources\(engine,[\s\S]*?: createColdLayerGpuResources\(\)/,
  "il cambio formato deve allocare full solo per il livello attivo");
assert.match(candidateAllocationBody, /for \(const gpu of replacement\.values\(\)\) \{\s*destroyLayerGpuResources\(engine, gpu\);/,
  "un fallimento deve eliminare tutti i candidati, incluso quello attivo");
assert.doesNotMatch(candidateAllocationBody, /layerId !== (this|engine)\.layerStack\.active\.id/,
  "il cleanup non può saltare il candidato del livello attivo");
assert.match(
  candidatePublishBody,
  /const supersededLayerGpu = \[\.\.\.engine\.layerGpu\.values\(\)\];[\s\S]*?for \(const gpu of supersededLayerGpu\) \{\s*destroyLayerGpuResources\(engine, gpu\);/,
  "la pubblicazione deve distruggere le vecchie risorse soltanto dopo averle sostituite",
);
const createPipelinesCall = recreateBody.indexOf("await createLayerPipelineBundle(");
const allocateCandidateCall = recreateBody.indexOf("await allocateLayerResourceCandidate(");
const publishCandidateCall = recreateBody.indexOf("await publishLayerResourceCandidate(");
assert.ok(
  createPipelinesCall >= 0
    && allocateCandidateCall > createPipelinesCall
    && publishCandidateCall > allocateCandidateCall,
  "l'orchestratore deve creare pipeline, allocare il candidato e pubblicarlo in quest'ordine",
);

// Public mutations must not interleave with the awaited layer switch.
assert.match(
  brushSettingsRuntimeSource,
  /applyBrushSettings\([\s\S]*?engine\.initialized && \(engine\.layerSwitchBusy \|\| engine\.historyBusy\)/,
  "le impostazioni non devono riattivare render o allocazioni dopo un latch fatale",
);
assert.doesNotMatch(engineSource, /\bsetLayerFormat\(/);
assert.match(
  labOperationsSource,
  /async function benchmarkEffectsWorkingSet\([\s\S]*?engine\.layerSwitchBusy/,
);
// Each caller's exemption is named rather than passed as an unreadable boolean.
// A layer switch may cross layerSwitchBusy because that flag is its own;
// history replay and structural SVG history may cross historyBusy because they
// are the history transaction.
assert.match(
  engineSource,
  /type EffectsRetargetCaller =[\s\S]*?\| "public"[\s\S]*?\| "layer-switch"[\s\S]*?\| "history-replay"[\s\S]*?\| "structural-history";/,
);
assert.match(engineSource, /\(!duringLayerSwitch && engine\.layerSwitchBusy\)/,
  "solo i retarget interni possono attraversare il lock di switch");
assert.match(engineSource, /\(!duringHistoryTransaction && engine\.historyBusy\)/,
  "solo le transazioni history nominate possono attraversare historyBusy");
assert.match(
  engineSource,
  /const duringHistoryTransaction =[\s\S]*?caller === "history-replay" \|\| caller === "structural-history";/,
);
// The public entry point must never grant itself an exemption.
assert.match(
  engineSource,
  /return retargetEffectsWorkingSetInternal\(this,\s*layerView,\s*layerFormat,\s*contentBounds,\s*"public",\s*\)/,
);
