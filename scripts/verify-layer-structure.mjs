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
  /\|\s*\{\s*id: number;\s*kind: "layer-add";\s*\}/,
  "`layer-add` deve essere un membro con literal singolo",
);
assert.match(
  journal,
  /\|\s*\{\s*id: number;\s*kind: "layer-delete";\s*\}/,
  "`layer-delete` deve essere un membro con literal singolo",
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
  /for \(const entry of action\.entries\) await attachLayer\(engine, entry\)/,
  "il riattacco deve procedere dal basso verso l'alto",
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
  /Non è possibile eliminare l'ultimo livello del documento\./,
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
  main,
  /mobileLayerDeleteButton\.addEventListener\("click"/,
  "la voce Elimina deve essere collegata",
);
assert.match(
  main,
  /void engine\.deleteLayer\(index\)/,
  "la voce Elimina deve chiamare deleteLayer",
);
// Il gesto e' gia' quello del menu contestuale: non deve esistere un secondo
// percorso che duplichi il long-press, altrimenti collide col riordino.
assert.doesNotMatch(
  main,
  /mobileLayerDeleteButton[\s\S]{0,400}setTimeout\(/,
  "la voce Elimina non deve introdurre un proprio gesto a pressione prolungata",
);

console.log(
  `layer-structure:verify ok (${LAYER_STRUCTURE_HISTORY_STRATEGY ?? "strategia non importabile"})`,
);
