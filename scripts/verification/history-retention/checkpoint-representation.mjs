import assert from "node:assert/strict";
import { selectCheckpointRepresentation } from "../../../src/history-retention-core.ts";

// ---------------------------------------------------------------------------
// Scelta della rappresentazione: una preferenza non deve diventare un blocco.
//
// L'ordinale del full periodico avanza SOLO al commit. Con il full preferito
// rifiutato e nessun ripiego, l'ottavo checkpoint restava l'ottavo per sempre:
// ogni tentativo riproponeva lo stesso full da 32 MiB, un delta da 2 MiB non
// veniva mai considerato, e la coda di replay cresceva senza fine.
// ---------------------------------------------------------------------------
{
  const scelta = (o) => selectCheckpointRepresentation({
    fullRequired: false,
    rebasePreferred: false,
    fullValid: true,
    fullAdmitted: true,
    deltaValid: true,
    deltaAdmitted: true,
    ...o,
  });

  // LA FAME. Ottavo checkpoint, full preferito ma rifiutato, delta disponibile.
  assert.equal(
    scelta({ rebasePreferred: true, fullAdmitted: false }),
    "delta",
    "un full periodico rifiutato deve ripiegare sul delta, non bloccare la cattura",
  );

  // Quando il full ci sta, il rebase periodico lo preferisce.
  assert.equal(scelta({ rebasePreferred: true }), "full");

  // Fuori dal rebase si preferisce il delta: stesso azzeramento della coda,
  // molti meno byte.
  assert.equal(scelta({ rebasePreferred: false }), "delta");

  // Se il delta non e' valido — niente e' cambiato — si ripiega sul full.
  assert.equal(scelta({ deltaValid: false }), "full");

  // Il full obbligatorio non ha alternative: li' serve alla correttezza.
  assert.equal(
    scelta({ fullRequired: true, fullAdmitted: false, deltaAdmitted: true }),
    "none",
    "un delta non puo' sostituire un full richiesto dalla correttezza",
  );
  assert.equal(scelta({ fullRequired: true }), "full");

  // Anche il tetto della catena impone un rebase, ma resta una cache: se il
  // full non entra si salta la cattura invece di ammetterlo oltre budget o di
  // allungare ancora la catena con un delta.
  assert.equal(
    scelta({ rebaseRequired: true, rebasePreferred: false }),
    "full",
  );
  assert.equal(
    scelta({ rebaseRequired: true, fullAdmitted: false, deltaAdmitted: true }),
    "none",
  );

  // Nessuno dei due entra: si rinuncia, e la coda crescera'. Va detto, non
  // mascherato scattando qualcosa che non ci sta.
  assert.equal(
    scelta({ fullAdmitted: false, deltaAdmitted: false }),
    "none",
  );
}

console.log("Checkpoint representation selection verified.");
