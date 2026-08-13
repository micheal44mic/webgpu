import assert from "node:assert/strict";
import {
  HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL,
  admitHistoryCheckpoint,
  createHistoryBudget,
  planHistoryCheckpoint,
  planHistoryBudgetRecovery,
} from "../../../src/history-retention-core.ts";

const MiB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Recupero del budget: si butta la cache, non la cronologia.
//
// E' la correzione dell'errore centrale. I checkpoint periodici sono
// acceleratori ricostruibili; il journal e' l'unica copia dei passi di Undo.
// Il motore faceva il contrario — alzava il pavimento (distruggendo
// l'insostituibile) e lasciava intatti i checkpoint (la parte pesante e
// rimpiazzabile). Da qui il caso misurato dall'utente: pavimento a 54 su 55
// azioni con 246 MiB di checkpoint ancora residenti.
// ---------------------------------------------------------------------------
{
  const budget = createHistoryBudget(192 * MiB);
  const voce = (id, layerId, parentId, kind, actionIndex, mib) => ({
    id,
    layerId,
    parentId,
    kind,
    actionIndex,
    bytes: mib * MiB,
  });

  // Modello della lettura reale: 4 full e 5 delta per 246 MiB, piu' 2 MiB di
  // journal e pagine. I delta pendono dai rispettivi full.
  const scenarioUtente = [
    voce(1, 1, null, "full", 7, 32),
    voce(2, 1, 1, "delta", 15, 32),
    voce(3, 1, 2, "delta", 23, 32),
    voce(4, 1, null, "full", 31, 32),
    voce(5, 1, 4, "delta", 39, 24),
    voce(6, 2, null, "full", 41, 32),
    voce(7, 2, 6, "delta", 47, 20),
    voce(8, 3, null, "full", 49, 32),
    voce(9, 3, 8, "delta", 54, 10),
  ];

  const piano = planHistoryBudgetRecovery({
    currentBytes: 248 * MiB,
    budget,
    checkpoints: scenarioUtente,
  });

  assert.equal(piano.required, true);
  assert.equal(piano.reason, "recovered-by-cache");
  assert.equal(piano.reachedTarget, true);
  // Bastano quattro delta per rientrare sotto il bersaglio di 157,44 MiB:
  // 248 − (32+32+24+20) = 140. Il quinto non viene toccato, ed e' la proprieta'
  // che conta piu' del numero: **non si distrugge piu' cache del necessario**.
  assert.deepEqual(
    [...piano.checkpointIdsToDrop].sort((a, b) => a - b),
    [2, 3, 5, 7],
    "si sacrificano i delta, che sono gli acceleratori piu' economici da rifare",
  );
  assert.equal(piano.projectedBytes, 140 * MiB);
  assert.ok(
    piano.projectedBytes <= budget.targetBytes,
    "il recupero deve arrivare sotto il bersaglio",
  );
  assert.ok(
    !piano.checkpointIdsToDrop.includes(9),
    "fermarsi appena si rientra: ogni checkpoint in piu' buttato e' replay pagato per niente",
  );
  // L'ordine di eliminazione parte dalle foglie: il 3 se ne va prima del 2, che
  // e' suo genitore. Invertirli renderebbe la catena inservibile.
  assert.ok(
    piano.checkpointIdsToDrop.indexOf(3) < piano.checkpointIdsToDrop.indexOf(2),
    "una catena si consuma dalla punta verso la base",
  );
  // E soprattutto: nessun pavimento. La profondita' di Undo non viene toccata.
  assert.ok(
    !("floorCursor" in piano) && !("boundaryCursor" in piano),
    "il recupero da cache non deve nemmeno poter esprimere un pavimento",
  );

  // Sotto il tetto non si tocca niente.
  assert.equal(
    planHistoryBudgetRecovery({ currentBytes: 100 * MiB, budget, checkpoints: scenarioUtente })
      .reason,
    "within-budget",
  );

  // Le catene non si spezzano: un genitore non se ne va prima del figlio.
  // Qui il bersaglio richiede di intaccare anche i full, e l'ordine di
  // eliminazione deve restare valido a ogni passo.
  {
    const stretto = planHistoryBudgetRecovery({
      currentBytes: 248 * MiB,
      budget: createHistoryBudget(60 * MiB),
      checkpoints: scenarioUtente,
    });
    const buttati = new Set(stretto.checkpointIdsToDrop);
    for (const voceCorrente of scenarioUtente) {
      if (voceCorrente.parentId === null) continue;
      if (buttati.has(voceCorrente.parentId)) {
        assert.ok(
          buttati.has(voceCorrente.id),
          `catena spezzata: il genitore ${voceCorrente.parentId} e' stato buttato `
          + `ma il figlio ${voceCorrente.id} e' rimasto`,
        );
      }
    }
  }

  // A parita' di foglia, il delta se ne va prima del full.
  //
  // Nello scenario sopra le due regole coincidono — tutte le foglie sono delta —
  // quindi non lo distinguerebbe. Qui ci sono due foglie eleggibili insieme, un
  // full isolato e un delta, e una sola basta a rientrare: si deve scegliere il
  // delta, perche' rifarlo costa meno e perche' un full e' la base su cui altri
  // delta potrebbero poggiare in futuro.
  {
    const foglieMiste = [
      voce(1, 1, null, "full", 5, 45),   // foglia: nessun figlio
      voce(2, 2, null, "full", 10, 40),
      voce(3, 2, 2, "delta", 20, 45),    // foglia: figlio di 2
    ];
    // 200 − 45 = 155, sotto il bersaglio di 157,44: una foglia sola basta.
    const piano = planHistoryBudgetRecovery({
      currentBytes: 200 * MiB,
      budget: createHistoryBudget(192 * MiB),
      checkpoints: foglieMiste,
    });
    assert.deepEqual(
      piano.checkpointIdsToDrop,
      [3],
      "fra due foglie eleggibili si sacrifica il delta, non il full",
    );
  }

  // Un checkpoint in uso da un replay non si tocca.
  {
    const conPin = planHistoryBudgetRecovery({
      currentBytes: 248 * MiB,
      budget,
      checkpoints: scenarioUtente,
      pinnedIds: [9, 7],
    });
    assert.ok(!conPin.checkpointIdsToDrop.includes(9));
    assert.ok(!conPin.checkpointIdsToDrop.includes(7));
  }

  // Cache insufficiente: va detto, non mascherato.
  {
    const insufficiente = planHistoryBudgetRecovery({
      currentBytes: 400 * MiB,
      budget,
      checkpoints: [voce(1, 1, null, "full", 3, 10)],
    });
    assert.equal(insufficiente.reason, "cache-insufficient");
    assert.equal(insufficiente.reachedTarget, false);
  }

  // Regressione del diagnostico dell'11/08/2026: 366,073 MiB totali, di cui
  // 204 MiB di checkpoint periodici, contro un hard limit di 162,215 MiB.
  // La cache da sola non raggiunge il target di isteresi, ma deve essere
  // liberata immediatamente per rientrare sotto il limite senza toccare Undo.
  {
    const totalBytes = 383_855_512;
    const checkpointBytes = 213_909_504;
    const hardBytes = 170_094_452;
    const diagnostico = planHistoryBudgetRecovery({
      currentBytes: totalBytes,
      budget: createHistoryBudget(hardBytes),
      checkpoints: [{
        id: 1,
        layerId: 1,
        parentId: null,
        kind: "full",
        actionIndex: 54,
        bytes: checkpointBytes,
      }],
    });
    assert.deepEqual(diagnostico.checkpointIdsToDrop, [1]);
    assert.equal(diagnostico.projectedBytes, totalBytes - checkpointBytes);
    assert.equal(diagnostico.reason, "cache-insufficient");
    assert.equal(diagnostico.reachedTarget, false);
    assert.ok(
      diagnostico.projectedBytes <= hardBytes,
      "nel caso reale la cache basta comunque a richiudere il tetto hard",
    );
  }
}

// ---------------------------------------------------------------------------
// Ammissione: sotto pressione un checkpoint si rifiuta, non si ingrandisce.
// ---------------------------------------------------------------------------
{
  const budget = createHistoryBudget(192 * MiB);

  assert.equal(
    admitHistoryCheckpoint({
      currentBytes: 100 * MiB,
      candidateBytes: 32 * MiB,
      budget,
      mandatory: false,
    }).admitted,
    true,
    "con spazio si scatta",
  );

  assert.equal(
    admitHistoryCheckpoint({
      currentBytes: 150 * MiB,
      candidateBytes: 32 * MiB,
      budget,
      mandatory: false,
    }).admitted,
    false,
    "un acceleratore che sfora il bersaglio si paga in profondita' di Undo, non in velocita'",
  );

  assert.equal(
    admitHistoryCheckpoint({
      currentBytes: 150 * MiB,
      candidateBytes: 32 * MiB,
      budget,
      mandatory: true,
    }).admitted,
    true,
    "le basi full richieste dalla correttezza non sono facoltative",
  );
}

// ---------------------------------------------------------------------------
// La pressione non accelera piu' le catture.
// ---------------------------------------------------------------------------
{
  for (const pressione of [0, 0.5, 0.9, 1]) {
    assert.equal(
      planHistoryCheckpoint({
        actionsSinceCheckpoint: 0,
        replayBatchesSinceCheckpoint: 0,
        payloadBytesSinceCheckpoint: 0,
        budgetPressure: pressione,
      }).effectiveActionInterval,
      HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL,
      `pressione ${pressione}: l'intervallo non deve accorciarsi`,
    );
  }
  assert.equal(
    planHistoryCheckpoint({
      actionsSinceCheckpoint: 12,
      replayBatchesSinceCheckpoint: 0,
      payloadBytesSinceCheckpoint: 0,
      budgetPressure: 1,
    }).capture,
    false,
    "a meta' intervallo, sotto pressione piena, non si deve catturare comunque",
  );
}

console.log("History budget recovery and checkpoint admission verified.");
