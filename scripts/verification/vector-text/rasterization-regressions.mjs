import assert from "node:assert/strict";
import fs from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";

const engineSource = readEngineSource();

// --- Rollback: ownership candidata ritirata prima della reidratazione ----------
// Un fault compositing tardivo lascia il candidato hot e i cache transienti
// ancora vivi. Provare prima ad attivare l'originale ricrea il picco che ha
// causato il fault. Il rollback deve congelare, staccare e distruggere il
// candidato, quindi riattivare l'originale usando il suo indice ricalcolato.
{
  const vectorRaster = fs.readFileSync(
    new URL("../../../src/engine-vector-raster-runtime.ts", import.meta.url),
    "utf8",
  );
  const helper = vectorRaster.slice(
    vectorRaster.indexOf("async function discardVectorRasterCandidateAndRestoreOriginalActive("),
    vectorRaster.indexOf("export async function rasterizeVectorNodeToLayer("),
  );
  const freeze = helper.indexOf("engine.layerPresentationFrozen = true;");
  const selectOriginal = helper.indexOf("engine.layerStack.setActiveIndex(originalIndexBeforeDetach);");
  const detach = helper.indexOf("engine.layerStack.remove(candidateIndex);");
  const unregister = helper.indexOf("engine.layerGpu.delete(candidateLayerId)");
  const destroy = helper.indexOf("destroyLayerGpuResources(engine, registeredGpu)");
  const reactivate = helper.indexOf("await engine.activateLayer(originalIndex, caller);");
  assert.ok(
    freeze >= 0
      && selectOriginal > freeze
      && detach > selectOriginal
      && unregister > detach
      && destroy > unregister
      && reactivate > destroy,
    "freeze/stacco/destroy devono precedere la riattivazione dell'originale",
  );
  assert.doesNotMatch(
    helper,
    /activateLayer\([\s\S]{0,80}candidateIndex/,
    "un indice candidato rimosso non deve raggiungere commitActiveLayerResidency",
  );
  const freezeHelper = helper.slice(
    helper.indexOf("async function freezeVectorRasterPresentationForRollback("),
  );
  assert.match(
    freezeHelper,
    /try \{[\s\S]{0,500}await engine\.waitForIdle\(\);[\s\S]{0,120}\} finally \{[\s\S]{0,500}engine\.layerPresentationFrozen = true;/,
    "anche un drain fallito deve congelare la presentazione in fail-closed",
  );

  const conversion = vectorRaster.slice(
    vectorRaster.indexOf("export async function rasterizeVectorNodeToLayer("),
    vectorRaster.indexOf("export async function rollbackUnpublishedVectorRasterization("),
  );
  const conversionActivation = conversion.indexOf(
    'await engine.activateLayer(previousIndexAfterInsertion, "layer-switch");',
  );
  const conversionSeed = conversion.indexOf("seed = await createLayerColdStorageCandidate(");
  assert.ok(
    conversionActivation >= 0 && conversionSeed > conversionActivation,
    "il seed Undo va catturato dopo il picco transitorio dell'activation",
  );
  assert.ok(
    conversion.indexOf("await freezeVectorRasterPresentationForRollback(engine);") >= 0
      && conversion.indexOf("await freezeVectorRasterPresentationForRollback(engine);")
        < conversion.indexOf("scene.restoreState(originalSceneState);"),
    "un fault post-activation deve drenare il frame valido prima di mutare la scena",
  );
  assert.ok(
    conversion.indexOf("destroyLayerColdStorage(seed);")
      < conversion.indexOf("await discardVectorRasterCandidateAndRestoreOriginalActive("),
    "il seed fallito va liberato prima di reidratare l'originale",
  );

  const unpublished = vectorRaster.slice(
    vectorRaster.indexOf("export async function rollbackUnpublishedVectorRasterization("),
    vectorRaster.indexOf("async function switchActiveForStructuralHistory("),
  );
  assert.ok(
    unpublished.indexOf("await freezeVectorRasterPresentationForRollback(engine);") >= 0
      && unpublished.indexOf("await freezeVectorRasterPresentationForRollback(engine);")
        < unpublished.indexOf("scene.replaceRasterWithVector(action.layerId, action.vectorState);"),
    "un commit History rifiutato deve drenare il frame candidato prima del rollback",
  );
  assert.ok(
    unpublished.indexOf("destroyLayerColdStorage(action.seed);")
      < unpublished.indexOf("await discardVectorRasterCandidateAndRestoreOriginalActive("),
    "un commit History rifiutato deve ritirare il seed prima del rebuild",
  );
  const wrapper = engineSource.slice(
    engineSource.indexOf("  private async rasterizeVectorNode("),
    engineSource.indexOf("  async rasterizeVectorTextNode("),
  );
  assert.match(wrapper, /await rollbackUnpublishedVectorRasterization\(this, action\)/);
  assert.match(
    wrapper,
    /const combined = new Error\([\s\S]{0,300}latchDocumentStateInconsistent\([\s\S]{0,180}combined/,
    "il diagnostico fatale deve conservare errore iniziale e causa del rollback",
  );
}

console.log("Vector rasterize candidate-first rollback verified.");

// --- Race freeze + invalidazione derivata ------------------------------------
// Il completamento asincrono del preview vettoriale puo' accodare un RAF dopo
// prepareActiveLayerForSwitch(). Il drain strutturale puo' coalescere soltanto
// quel ridisegno derivato; qualunque mutazione raster reale resta fail-closed.
{
  const discardStart = engineSource.indexOf(
    "  private discardFrozenDerivedPresentationWork(): boolean {",
  );
  const idleStart = engineSource.indexOf("  async waitForIdle(", discardStart);
  const idleEnd = engineSource.indexOf("\n  resetStrokeRandomSeed()", idleStart);
  assert.ok(
    discardStart >= 0 && idleStart > discardStart && idleEnd > idleStart,
    "drain freeze-aware non delimitabile",
  );
  const discard = engineSource.slice(discardStart, idleStart);
  const idle = engineSource.slice(idleStart, idleEnd);
  for (const authoritativeWork of [
    "pendingStamps.length > 0",
    "pendingBlendBatches.length > 0",
    "clearRequested",
    "lightGlazeSession?.commitRequested",
    "lightGlazeSession?.endRequested",
    "thicknessTailPreviewEligible()",
    "thicknessTailPresentedRect !== null",
  ]) {
    assert.ok(
      discard.includes(authoritativeWork),
      `il drain congelato non protegge ${authoritativeWork}`,
    );
  }
  assert.match(
    discard,
    /cancelAnimationFrame\(this\.frameRequest\);[\s\S]*this\.frameRequest = null;[\s\S]*this\.displayDirty = false;[\s\S]*this\.presentationCacheNeedsFullRebuild = true;/,
    "il solo frame derivato va coalesciuto nella ricostruzione finale",
  );
  assert.match(
    idle,
    /options\.allowFrozenDerivedPresentation === true[\s\S]*discardFrozenDerivedPresentationWork\(\)[\s\S]*continue;[\s\S]*Presentazione congelata con lavoro render pendente/,
    "l'opt-in deve precedere senza sostituire il fail-closed standard",
  );
  const retargetStart = engineSource.indexOf(
    "export async function retargetEffectsWorkingSetInternal(",
  );
  const retargetEnd = engineSource.indexOf(
    "export async function benchmarkEffectsWorkingSet(",
    retargetStart,
  );
  const retarget = engineSource.slice(retargetStart, retargetEnd);
  assert.match(
    retarget,
    /retargetEffectsWorkingSetInternal[\s\S]*allowFrozenDerivedPresentation: caller !== "public"/,
    "il retarget strutturale deve drenare le invalidazioni tardive e quello pubblico no",
  );
  const rebuildStart = engineSource.indexOf("  async rebuildMergedLayerSurfaces(");
  const rebuildEnd = engineSource.indexOf(
    "\n  recordVectorHistoryAction(",
    rebuildStart,
  );
  const rebuild = engineSource.slice(rebuildStart, rebuildEnd);
  assert.match(
    rebuild,
    /rebuildMergedLayerSurfaces\([\s\S]{0,900}layerPresentationFrozen[\s\S]{0,200}caller !== "public"[\s\S]{0,200}waitForIdle\(\{ allowFrozenDerivedPresentation: true \}\)/,
    "anche il gate del compositing deve ricontrollare la race dopo il retarget GPU",
  );
}

console.log("Vector rasterize frozen derived-frame drain verified.");

// --- Nessun frame fra mutazione della scena e ricostruzione -------------------
// `mutateMixedScenePresentation` e' il percorso di **ogni** aggiunta, rimozione
// e modifica vettoriale (testo, SVG, immagine). Muta la scena a presentazione
// viva e la ricostruisce subito dopo: i segmenti di composizione restano stale
// in mezzo, e citano per id livelli e nodi che il frame risolve con lookup che
// lanciano. Oggi regge solo perche' fra le due cose non c'e' nessun `await`,
// quindi il controllo non torna mai al loop di rendering. Basta inserirne uno
// e si riapre esattamente il bug "Livello N assente dallo stack" — con la
// differenza che colpirebbe tutti i vettori, non il solo layer-add.
{
  const vectorText = fs.readFileSync(
    new URL("../../../src/engine-mixed-scene-mutation-runtime.ts", import.meta.url),
    "utf8",
  );
  const corpo = vectorText.slice(
    vectorText.indexOf("export async function mutateMixedScenePresentation<Result>"),
  );
  const mutazione = corpo.indexOf("const result = mutate(scene);");
  const ricostruzione = corpo.indexOf("await engine.rebuildMergedLayerSurfaces(");
  assert.ok(
    mutazione >= 0 && ricostruzione > mutazione,
    "mutazione o ricostruzione della scena mista non individuate",
  );
  const inMezzo = corpo.slice(mutazione, ricostruzione);
  assert.ok(
    !/\bawait\b/.test(inMezzo),
    "nessun await fra la mutazione della scena e la ricostruzione dei segmenti: "
      + "cederebbe il controllo al loop di rendering con i segmenti stale",
  );
}

console.log("Mixed scene mutation atomicity verified.");

// --- Undo rasterizzazione: identita' stabile e preview testo -----------------
// La posizione del vettore nella scena non dice quale raster fosse attivo: con
// tre raster l'adiacente puo' essere diverso da quello su cui si stava
// dipingendo. L'azione deve conservare l'ID e ripristinare anche l'esclusione
// del testo appena tornato selezionato.
{
  const vectorRaster = fs.readFileSync(
    new URL("../../../src/engine-vector-raster-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyTypes = fs.readFileSync(
    new URL("../../../src/engine-history-types.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    historyTypes,
    /interface VectorRasterizeHistoryAction[\s\S]*activeRasterLayerIdBefore: number;/,
    "l'azione deve ricordare il raster attivo prima della conversione",
  );
  assert.match(
    vectorRaster,
    /vectorState,[\s\S]{0,120}activeRasterLayerIdBefore: originalActiveId,/,
    "la conversione deve registrare l'identita' attiva osservata",
  );
  const undo = vectorRaster.slice(
    vectorRaster.indexOf("async function undoVectorRasterization("),
    vectorRaster.indexOf("async function redoVectorRasterization("),
  );
  assert.match(
    undo,
    /const fallbackIndex = engine\.layerStack\.indexOfId\(action\.activeRasterLayerIdBefore\);/,
    "Undo deve cercare il raster originario per ID, non scegliere un adiacente",
  );
  assert.doesNotMatch(
    undo,
    /activeTargetIndex > 0[\s\S]*activeTargetIndex - 1/,
    "la geometria dello stack non e' uno snapshot dello stato attivo",
  );
  assert.match(
    undo,
    /const restoredSelection = scene\.selected;[\s\S]*restoredSelection\.kind === "text"[\s\S]*restoredSelection\.textNodeId/,
    "il testo ripristinato e selezionato deve tornare escluso dalla preview statica",
  );

  // Modello del caso non adiacente riprodotto: il testo sta fra raster 1 e 2,
  // ma prima della conversione era attivo il raster 3.
  const stackDuringRasterization = [1, 4, 2, 3];
  const targetIndex = stackDuringRasterization.indexOf(4);
  const adjacentFallback = stackDuringRasterization[targetIndex - 1];
  const stableFallback = stackDuringRasterization.findIndex((id) => id === 3);
  assert.equal(adjacentFallback, 1, "il modello deve distinguere davvero le due scelte");
  assert.equal(stackDuringRasterization[stableFallback], 3);
}

console.log("Vector rasterize exact active/preview restoration verified.");
