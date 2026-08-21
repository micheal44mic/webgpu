// Mutazioni strutturali di livello: creazione e cancellazione annullabili.
//
// Le due direzioni sono ricalcate su `raster-import`, che era gia' l'unica
// azione journaled capace di far comparire e sparire un livello. Qui si
// verifica il contratto sul sorgente e la logica d'ordine su un modello puro:
// senza GPU non si puo' eseguire il motore, ma si puo' provare che l'ordine di
// stacco e riattacco e' quello che mantiene validi gli indici.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = readEngineSource();
const structure = read("../src/engine-layer-structure-runtime.ts");
const html = read("../index.html");
const main = read("../src/main.ts");
const layerPanel = read("../src/layer-panel-controller.ts");
const types = read("../src/engine-history-types.ts");
const journal = read("../src/history-journal.ts");

const { LAYER_STRUCTURE_HISTORY_STRATEGY } = await import(
  "../src/engine-layer-structure-runtime.ts"
).catch(() => ({ LAYER_STRUCTURE_HISTORY_STRATEGY: null }));

// --- Contratto dichiarato -----------------------------------------------------
assert.match(
  structure,
  /journaled-add-and-delete-clipping-unit-atomic-seeded-restore-v1/,
  "la strategia strutturale deve dichiarare unita' di ritaglio atomica e ripristino da seed",
);

// --- I due tipi di azione -----------------------------------------------------
assert.match(types, /kind: "layer-add"/, "manca il tipo dell'azione di creazione");
assert.match(types, /kind: "layer-delete"/, "manca il tipo dell'azione di cancellazione");
assert.match(
  types,
  /entries: readonly DeletedLayerEntry\[\]/,
  "la cancellazione deve poter portarsi via piu' livelli: e' un'unita' di ritaglio",
);
assert.match(
  types,
  /seed: LayerColdStorageResources \| null/,
  "un livello vuoto non deve allocare un seed",
);

// I due kind devono essere membri distinti dell'unione del journal. Con un solo
// membro `"layer-add" | "layer-delete"` TypeScript riduce il discriminante a
// `never` senza eliminare il membro, e ogni accesso a `layerId` a valle resta
// un errore: e' costato una compilazione rossa, non deve tornare.
assert.match(
  journal,
  /\|\s*\{\s*id: number;\s*kind: "layer-add";[\s\S]*?layerId: number;[\s\S]*?baseBounds: unknown \| null;\s*\}/,
  "`layer-add` deve essere un membro con literal singolo",
);
assert.match(
  journal,
  /\|\s*\{\s*id: number;\s*kind: "layer-delete";\s*\}/,
  "`layer-delete` deve essere un membro con literal singolo",
);
assert.match(
  types,
  /interface LayerAddHistoryAction extends RasterHistoryCheckpoint/,
  "Layer Add deve essere anche il checkpoint raster usato da Duplicate",
);
assert.match(
  structure,
  /seed: action\.seed,[\s\S]*?baseBounds: action\.baseBounds/,
  "Undo/Redo Add deve riusare il seed tiled del duplicato",
);
assert.match(
  journal,
  /action\.kind === "layer-add"[\s\S]*?action\.baseBounds !== null/,
  "il journal deve riconoscere il contenuto iniziale di Duplicate",
);
assert.match(
  journal,
  /action\.kind === "layer-add"[\s\S]*?checkpoint =/,
  "Layer Add deve partecipare alla selezione del checkpoint di replay",
);

// --- Ordine di stacco e riattacco ---------------------------------------------
// E' la proprieta' che rende corretti gli indici, e si prova senza GPU.
const simulaStacco = (pila, ids) => {
  const risultato = [...pila];
  const osservati = [];
  // dall'alto verso il basso
  for (const id of [...ids].reverse()) {
    const indice = risultato.indexOf(id);
    assert.notEqual(indice, -1, `stacco: livello ${id} non trovato`);
    osservati.unshift({ id, indice });
    risultato.splice(indice, 1);
  }
  return { pila: risultato, osservati };
};
const simulaRiattacco = (pila, osservati) => {
  const risultato = [...pila];
  // dal basso verso l'alto
  for (const voce of osservati) {
    assert.ok(
      voce.indice <= risultato.length,
      `riattacco: indice ${voce.indice} oltre la pila di ${risultato.length}`,
    );
    risultato.splice(voce.indice, 0, voce.id);
  }
  return risultato;
};

for (const [pila, doomed] of [
  [[1, 2, 3, 4], [2]],
  [[1, 2, 3, 4], [2, 3]],
  [[1, 2, 3, 4], [1, 2, 3]],
  [[1, 2, 3, 4, 5, 6], [2, 4]],
  [[1, 2], [2]],
]) {
  const { pila: dopo, osservati } = simulaStacco(pila, doomed);
  assert.deepEqual(
    dopo,
    pila.filter((id) => !doomed.includes(id)),
    `stacco errato per ${JSON.stringify(doomed)}`,
  );
  assert.deepEqual(
    simulaRiattacco(dopo, osservati),
    pila,
    `il riattacco deve ricostruire la pila esatta per ${JSON.stringify(doomed)}`,
  );
}

// L'ordine conta davvero: staccare dal basso invalida gli indici di quelli
// sopra, e il ripristino finisce fuori posto. Questa e' la prova che l'ordine
// scelto nel runtime non e' arbitrario.
{
  const pila = [1, 2, 3, 4];
  const doomed = [2, 3];
  const sbagliato = [...pila];
  const osservati = [];
  for (const id of doomed) {
    const indice = sbagliato.indexOf(id);
    osservati.push({ id, indice });
    sbagliato.splice(indice, 1);
  }
  assert.notDeepEqual(
    simulaRiattacco(sbagliato, osservati),
    pila,
    "staccare dal basso deve produrre un ripristino sbagliato: se non lo fa, il test non prova nulla",
  );
}

assert.match(
  structure,
  /for \(const entry of \[\.\.\.action\.entries\]\.reverse\(\)\)/,
  "lo stacco deve procedere dall'alto verso il basso",
);
assert.match(
  structure,
  /for \(const entry of action\.entries\) \{\s*\n\s*await attachLayer\(engine, entry\);/,
  "il riattacco deve procedere dal basso verso l'alto",
);

// --- Stacco a presentazione congelata -----------------------------------------
// `switchActiveForStructuralHistory` si chiude con un'attivazione riuscita, e
// quella scongela la presentazione. Senza ricongelare, lo stacco procede a
// presentazione viva: il gate dei frame guarda `layerPresentationFrozen`, non
// `layerSwitchBusy`, quindi un frame passa fra lo stacco e la riattivazione e
// trova i segmenti di composizione che citano ancora il livello staccato —
// `clippingUnit()` lancia "Livello N assente dallo stack".
//
// Serve una scena **segmentata** per vederlo: con soli raster c'e' una tratta
// sola e nessuna cita il livello che se ne va. Riproduzione: testo vettoriale,
// poi un livello sopra, poi Undo. Trovato in QA browser, non da tsc.
{
  const ramoStacco = structure.slice(
    structure.indexOf("const survivorIndex = engine.layerStack.indexOfId("),
    structure.indexOf("engine.vectorTextPreviewExcludedNodeId = scene.selected.kind"),
  );
  assert.ok(ramoStacco.length > 0, "ramo di stacco non individuato");
  const commutazione = ramoStacco.indexOf("await switchActiveForStructuralHistory(engine, survivorIndex);");
  const drenaggio = ramoStacco.indexOf("await engine.waitForIdle();");
  const congelamento = ramoStacco.indexOf("engine.layerPresentationFrozen = true;");
  const stacco = ramoStacco.indexOf("const observed = await detachLayer(");
  assert.ok(congelamento >= 0, "lo stacco deve avvenire a presentazione congelata");
  assert.ok(
    drenaggio >= 0,
    "il lavoro render va drenato prima di congelare, altrimenti la guardia di "
      + "`waitForIdle` aborta la transazione",
  );
  assert.ok(
    commutazione < drenaggio && drenaggio < congelamento && congelamento < stacco,
    "ordine richiesto: commutazione → drenaggio → congelamento → stacco",
  );
}

// --- Rollback strutturale -----------------------------------------------------
// Lo stacco distrugge le risorse GPU: se la transazione fallisce dopo, la sola
// `scene.restoreState()` rimette la chiave `raster:N` senza il livello dietro e
// `createMixedSceneSnapshot()` lancia a ogni lettura delle statistiche, per
// sempre, senza che l'app lo dica mai. Trovato in QA browser con guasto
// iniettato su `activateLayer`, non da tsc.
for (const [frammento, motivo] of [
  ["detached.push(entry);", "lo stacco riuscito va registrato per poterlo annullare"],
  ["attached.push(entry);", "il riattacco riuscito va registrato per poterlo annullare"],
  [
    "await rollbackStructuralMutation(engine, detached, attached);",
    "il rollback deve annullare la struttura, non solo la scena",
  ],
  [
    "firstSceneRasterMissingFromStack(engine, scene)",
    "un rollback riuscito a meta' va dichiarato, non lasciato al primo lettore",
  ],
]) {
  assert.ok(structure.includes(frammento), motivo);
}

const rollbackStrutturale = structure.indexOf(
  "await rollbackStructuralMutation(engine, detached, attached);",
);
const ripristinoScena = structure.indexOf("scene.restoreState(sceneState);");
assert.ok(
  rollbackStrutturale >= 0 && ripristinoScena >= 0,
  "manca il rollback strutturale o il ripristino della scena",
);
assert.ok(
  rollbackStrutturale < ripristinoScena,
  "i livelli vanno riattaccati prima di riscrivere la scena: al contrario "
    + "`restoreState()` fisserebbe item raster che lo stack non ha ancora",
);

// Anche un'attivazione **riuscita** puo' essere seguita da un errore. In quel
// caso il freeze e' gia' spento, ma texture ed effetti sono stati retargettati:
// limitarsi a cambiare l'indice CPU lascerebbe bindate le risorse del raster
// appena distrutto. Il rollback deve quindi riattivare in base alla transazione,
// non allo stato finale del solo flag di freeze.
const rollbackCatch = structure.slice(
  structure.indexOf("const structureChanged = detached.length > 0 || attached.length > 0;"),
  structure.indexOf("    } catch (restoreError) {"),
);
assert.match(
  rollbackCatch,
  /const mustRetarget = presentationMayNeedRetarget[\s\S]*\|\| engine\.layerPresentationFrozen;/,
  "il rollback deve ricordare che la presentazione puo' essere gia' stata retargettata",
);
assert.match(
  rollbackCatch,
  /if \(mustRetarget && !engine\.layerPresentationFrozen\) \{[\s\S]*await engine\.waitForIdle\(\);[\s\S]*engine\.layerPresentationFrozen = true;/,
  "una presentazione riaperta va drenata e ricongelata prima di distruggere risorse",
);
assert.match(
  rollbackCatch,
  /if \(mustRetarget\) \{\s*await engine\.activateLayer\(outgoingIndex, "structural-history"\);/,
  "il rollback deve riattivare anche quando l'attivazione precedente aveva gia' spento il freeze",
);
assert.doesNotMatch(
  rollbackCatch,
  /if \(engine\.layerPresentationFrozen\) \{\s*await engine\.activateLayer/,
  "il solo flag di freeze non basta a decidere se riallineare le risorse attive",
);

// --- Attach compensato internamente ------------------------------------------
// Il chiamante aggiunge una voce ad `attached` solo quando attachLayer ritorna.
// Se l'inserimento nella scena lancia dopo aver aggiunto stack e GPU, e'
// quindi attachLayer stesso a dover osservare e compensare ogni scrittura.
{
  const attach = structure.slice(
    structure.indexOf("async function attachLayer("),
    structure.indexOf("async function rollbackStructuralMutation("),
  );
  for (const [pattern, message] of [
    [/catch \(error\)/, "attachLayer deve avere un proprio confine di rollback"],
    [/scene\.indexOfKey\(`raster:\$\{layerId\}`\) >= 0/, "la scena va controllata dal vivo"],
    [/engine\.layerStack\.indexOfId\(layerId\)/, "lo stack va controllato dal vivo"],
    [/engine\.layerGpu\.get\(layerId\) === gpu/, "va rimossa solo la GPU candidata"],
    [/latchDocumentStateInconsistent/, "una compensazione incompleta va dichiarata"],
  ]) {
    assert.match(attach, pattern, message);
  }
  const rollbackScene = attach.lastIndexOf("scene.removeRaster(layerId, fallbackLayerId);");
  const rollbackStack = attach.lastIndexOf("engine.layerStack.remove(stackIndex);");
  const rollbackGpu = attach.lastIndexOf("destroyLayerGpuResources(engine, gpu);");
  assert.ok(
    rollbackScene >= 0 && rollbackScene < rollbackStack && rollbackStack < rollbackGpu,
    "compensazione attach: scena → stack → GPU",
  );

  // Modello eseguibile del guasto che ha prodotto stack=[1,2], scene=[1].
  const state = { stack: [1], scene: [1], gpu: new Set([1]) };
  assert.throws(() => {
    try {
      state.stack.push(2);
      state.gpu.add(2);
      throw new Error("GUASTO INSERT SCENA");
    } catch (error) {
      if (state.scene.includes(2)) state.scene.splice(state.scene.indexOf(2), 1);
      if (state.stack.includes(2)) state.stack.splice(state.stack.indexOf(2), 1);
      if (!state.stack.includes(2)) state.gpu.delete(2);
      throw error;
    }
  }, /GUASTO INSERT SCENA/);
  assert.deepEqual(state.stack, [1]);
  assert.deepEqual(state.scene, [1]);
  assert.deepEqual([...state.gpu], [1]);
}

assert.ok(
  structure.includes("firstStackRasterMissingFromScene(engine, scene)"),
  "il rollback deve verificare anche stack → scena, non soltanto scena → stack",
);

// --- Snapshot di interazione esatti ------------------------------------------
for (const field of [
  "selectedKeyAfter",
  "referenceRasterLayerIdBefore",
  "referenceRasterLayerIdAfter",
]) {
  assert.ok(types.includes(field), `manca ${field} nell'azione strutturale`);
}
assert.match(
  structure,
  /selectedKeyBefore: addedKey,[\s\S]*selectedKeyAfter: action\.selectedKeyBefore,[\s\S]*activeRasterLayerIdBefore: action\.layerRecord\.id,[\s\S]*activeRasterLayerIdAfter: action\.activeRasterLayerIdBefore/,
  "layer-add deve sintetizzare la cancellazione collegando gli snapshot alla direzione corretta",
);
assert.match(
  structure,
  /restoreReferenceLayerId\(engine, action\.referenceRasterLayerIdBefore\)/,
  "Undo Delete deve ripristinare il riferimento Fill per ID stabile",
);
assert.match(
  structure,
  /restoreReferenceLayerId\(engine, action\.referenceRasterLayerIdAfter\)/,
  "Redo Delete deve ripristinare lo snapshot successivo del riferimento Fill",
);
assert.match(
  engine,
  /const selectedKeyAfter = scene\.selected\.kind === "raster"[\s\S]*doomed\.has\(scene\.selected\.rasterLayerId\)/,
  "il recorder deve calcolare la selezione successiva quando quella corrente viene cancellata",
);
assert.match(
  engine,
  /const referenceRasterLayerIdBefore = this\.layerStack\.referenceLayerId;[\s\S]*const referenceRasterLayerIdAfter = referenceRasterLayerIdBefore !== null[\s\S]*doomed\.has\(referenceRasterLayerIdBefore\)/,
  "il recorder deve conservare il riferimento prima e dopo la cancellazione",
);

// --- Invarianti del runtime ---------------------------------------------------
// La scena va staccata prima dello stack: l'ordine opposto lascia una chiave
// raster verso un livello inesistente. Trovato in QA browser, non da tsc.
const staccoScena = structure.indexOf("scene.removeRaster(layerId, fallbackLayerId);");
const staccoStack = structure.indexOf("engine.layerStack.remove(detachedIndex)");
assert.ok(staccoScena >= 0 && staccoStack >= 0, "manca lo stacco da scena o stack");
assert.ok(
  staccoScena < staccoStack,
  "la scena mista va staccata prima dello stack dei livelli",
);

// Solo il ramo che attacca prepara il cambio livello: prepararlo anche
// nell'altro evacua la texture attiva e la seconda attivazione la trova non
// residente. Anche questo trovato solo eseguendo l'app.
// Ancorato a `applyLayerDeleteHistory`: `} else {` compare prima dentro
// `attachLayer`, e una slice presa da li' sarebbe vuota — cioe' un test che
// passa senza guardare niente.
const applyDelete = structure.slice(
  structure.indexOf("export async function applyLayerDeleteHistory"),
);
assert.ok(applyDelete.length > 0, "manca applyLayerDeleteHistory");
const ramoAttacca = applyDelete.slice(
  applyDelete.indexOf("if (delta < 0) {"),
  applyDelete.indexOf("    } else {"),
);
assert.ok(ramoAttacca.length > 0, "slice del ramo che attacca vuota");
assert.match(
  ramoAttacca,
  /await engine\.prepareActiveLayerForSwitch\(\);/,
  "il ramo che attacca deve preparare il cambio livello",
);
assert.match(
  ramoAttacca,
  /const outgoingActiveLayerId = engine\.layerStack\.active\.id;/,
  "il ramo che attacca deve ricordare il raster uscente prima che attach cambi la selezione",
);
assert.match(
  ramoAttacca,
  /engine\.layerStack\.setActiveIndex\(restoredIndex\);\s*await engine\.activateLayer\(outgoingIndexAfterAttachment, "structural-history"\);/,
  "dopo attach serve una riattivazione esplicita: lo switch helper uscirebbe sull'indice gia' attivo",
);
assert.doesNotMatch(
  ramoAttacca,
  /switchActiveForStructuralHistory\(engine, restoredIndex\)/,
  "attach seleziona gia' il record: lo switch helper lascerebbe la presentazione congelata",
);
const ramoStacca = applyDelete.slice(
  applyDelete.indexOf("    } else {"),
  applyDelete.indexOf("engine.vectorTextPreviewExcludedNodeId = scene.selected.kind"),
);
assert.ok(ramoStacca.length > 0, "slice del ramo che stacca vuota");
assert.doesNotMatch(
  ramoStacca,
  /prepareActiveLayerForSwitch/,
  "il ramo che stacca non deve preparare il cambio: lo fa switchActiveForStructuralHistory",
);

// --- Seed: nessuna perdita ----------------------------------------------------
assert.match(
  engine,
  /discardedLayerDeleteHistoryActions/,
  "le cancellazioni abbandonate dal Redo devono avere una lista dedicata",
);
assert.match(
  engine,
  /destroyLayerDeleteHistorySeeds/,
  "i seed delle cancellazioni abbandonate devono essere distrutti",
);
assert.match(
  structure,
  /for \(const entry of action\.entries\) destroyLayerColdStorage\(entry\.seed\)/,
  "ogni voce della cancellazione deve liberare il proprio seed",
);

// --- Guardie della cancellazione ---------------------------------------------
assert.match(
  engine,
  /The last layer in the document cannot be deleted\./,
  "cancellare l'ultimo livello deve essere rifiutato",
);
assert.match(
  engine,
  /const unit = target\.clippingParentId === null\s*\?\s*this\.layerStack\.clippingUnit\(target\.id\)/,
  "cancellare un parent di ritaglio deve portarsi via l'intera unita'",
);

// --- Interfaccia mobile -------------------------------------------------------
assert.match(html, /id="mobileLayerDelete"/, "manca la voce Elimina nel menu contestuale");
const deleteButtonId = html.indexOf('id="mobileLayerDelete"');
const deleteButtonTag = html.slice(
  html.lastIndexOf("<button", deleteButtonId),
  html.indexOf(">", deleteButtonId) + 1,
);
assert.doesNotMatch(
  deleteButtonTag,
  /\bhidden\b/,
  "la voce Elimina verificata nel browser non deve tornare nascosta",
);
assert.match(
  html,
  /id="mobileLayerDelete"[\s\S]{0,120}class="is-destructive"/,
  "la voce Elimina deve essere marcata come distruttiva",
);
assert.match(
  layerPanel,
  /this\.listen\(elements\.deleteButton, "click", \(\) => void this\.requestDelete\(\)\)/,
  "la voce Elimina deve essere collegata dal controller del pannello",
);
assert.match(
  layerPanel,
  /await this\.options\.deleteLayer\(key\)/,
  "la voce Elimina deve usare la porta tipizzata deleteLayer",
);
// Il gesto e' gia' quello del menu contestuale: non deve esistere un secondo
// percorso che duplichi il long-press, altrimenti collide col riordino.
assert.doesNotMatch(
  layerPanel,
  /elements\.deleteButton[\s\S]{0,400}setTimeout\(/,
  "la voce Elimina non deve introdurre un proprio gesto a pressione prolungata",
);

console.log(
  `layer-structure:verify ok (${LAYER_STRUCTURE_HISTORY_STRATEGY ?? "strategia non importabile"})`,
);
