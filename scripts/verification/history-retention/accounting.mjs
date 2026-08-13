import assert from "node:assert/strict";
import { historyAccountingIsAppendOnly } from "../../../src/history-retention-core.ts";

// ---------------------------------------------------------------------------
// La decisione fra ledger incrementale e ricostruzione, esercitata direttamente.
//
// E' la logica piu' delicata del sottosistema e il suo difetto non si vede dai
// pixel: se il ledger resta descritto a un vecchio cursore continua a sembrare
// sano, e il danno arriva molto dopo sotto forma di un checkpoint ancorato
// all'azione sbagliata. Provarla richiede che sia pura — per questo vive qui e
// non dentro il runtime, che importa mezzo motore e non si carica in Node.
// ---------------------------------------------------------------------------
{
  const azioni = Array.from({ length: 30 }, (_, index) => ({ id: index + 1 }));
  const vuoto = [];
  const osserva = (cursor, actions = azioni) => ({
    cursor,
    actions,
    batches: vuoto,
    discardedVector: vuoto,
    discardedImport: vuoto,
    discardedTransform: vuoto,
    discardedStructural: vuoto,
    selectionRevisionSize: 0,
    selectionActionSize: 0,
  });
  const segna = (cursor, actions = azioni) => ({
    initialized: true,
    cursor,
    actionsLength: actions.length,
    actionsTail: actions.at(-1) ?? null,
    batchesLength: 0,
    batchesTail: null,
    discardedVectorLength: 0,
    discardedVectorTail: null,
    discardedImportLength: 0,
    discardedImportTail: null,
    discardedTransformLength: 0,
    discardedTransformTail: null,
    discardedStructuralLength: 0,
    discardedStructuralTail: null,
    selectionRevisionSize: 0,
    selectionActionSize: 0,
  });

  // Niente e' cambiato: si resta sul ramo incrementale.
  assert.equal(
    historyAccountingIsAppendOnly(segna(30), osserva(30)),
    true,
    "senza movimenti non si deve pagare una ricostruzione",
  );

  // Mai inizializzato: sempre ricostruzione.
  assert.equal(
    historyAccountingIsAppendOnly({ ...segna(30), initialized: false }, osserva(30)),
    false,
  );

  // IL CASO CHE CI HA MORSO. Il ledger e' stato ricostruito con il cursore a 15
  // (quindi descrive solo 15 azioni) ma il watermark degli array e' alla
  // lunghezza piena. L'utente rifa' i Redo e torna a 30: gli array non sono
  // cambiati, quindi ogni altro termine e' soddisfatto. Solo il cursore puo'
  // accorgersene — e senza di lui il ledger resterebbe troncato per sempre.
  assert.equal(
    historyAccountingIsAppendOnly(segna(15), osserva(30)),
    false,
    "tornare in fondo dopo una ricostruzione a meta' DEVE forzare un rebuild: "
    + "senza, il ledger resta descritto a un cursore che non esiste piu'",
  );

  // E vale in entrambi i versi: anche allontanarsi dal fondo invalida.
  assert.equal(
    historyAccountingIsAppendOnly(segna(30), osserva(15)),
    false,
    "anche annullare invalida: il ledger descriveva un mondo piu' avanti",
  );

  // Un andirivieni completo: ogni tappa che sposta il cursore deve invalidare,
  // ogni tappa che lo lascia fermo no.
  let watermark = segna(30);
  for (const cursore of [30, 22, 22, 7, 30, 30, 1]) {
    const atteso = watermark.cursor === cursore;
    assert.equal(
      historyAccountingIsAppendOnly(watermark, osserva(cursore)),
      atteso,
      `cursore ${cursore}: incrementale atteso ${atteso}`,
    );
    watermark = segna(cursore);
  }

  // Il cursore non oscura gli altri termini: una coda di redo troncata resta
  // rilevata anche se il cursore non si e' mosso.
  const troncate = azioni.slice(0, 20);
  assert.equal(
    historyAccountingIsAppendOnly(segna(20, azioni), osserva(20, troncate)),
    false,
    "un array accorciato deve invalidare anche a cursore fermo",
  );

  // Un elemento sostituito in posizione non e' un append: il confronto e' per
  // identita', non per lunghezza.
  const sostituite = [...azioni];
  sostituite[29] = { id: 30 };
  assert.equal(
    historyAccountingIsAppendOnly(segna(30, azioni), osserva(30, sostituite)),
    false,
    "una coda sostituita non e' una crescita in coda",
  );

  // Crescita vera in coda a cursore che segue: incrementale.
  const cresciute = [...azioni, { id: 31 }];
  assert.equal(
    historyAccountingIsAppendOnly(segna(30, azioni), osserva(30, cresciute)),
    true,
    "aggiungere in coda senza muovere il cursore resta incrementale",
  );
}

console.log("History accounting append-only decision verified.");
