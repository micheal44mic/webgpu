import assert from "node:assert/strict";
import {
  HISTORY_SPILL_HIGH_WATER_BYTES,
  HISTORY_SPILL_KEEP_HOT_CHECKPOINTS,
  HISTORY_SPILL_LOW_WATER_BYTES,
  assertHistorySpillMarks,
  defaultHistorySpillMarks,
  planHistorySpill,
} from "../../../src/history-retention-core.ts";

// ---------------------------------------------------------------------------
// Travaso della cronologia lontana in RAM compressa.
//
// L'eviction butta via, il travaso sposta: un checkpoint travasato resta
// annullabile. La regola che rende il compromesso accettabile e' una sola —
// i checkpoint recenti non si toccano mai, cosi' i primi annullamenti restano
// immediati e si paga soltanto tornando indietro parecchio.
// ---------------------------------------------------------------------------
{
  const MiB = 1024 * 1024;
  const marks = defaultHistorySpillMarks();
  assert.equal(marks.highWaterBytes, HISTORY_SPILL_HIGH_WATER_BYTES);
  assert.equal(marks.lowWaterBytes, HISTORY_SPILL_LOW_WATER_BYTES);
  assert.equal(marks.keepHotCheckpoints, HISTORY_SPILL_KEEP_HOT_CHECKPOINTS);
  // Una soglia sola: oltre HIGH si travasa tutto il travasabile. L'isteresi
  // arriva gratis dal fatto che un travasato non e' piu' candidato.
  assert.equal(
    marks.lowWaterBytes,
    0,
    "non ci si ferma a meta': i byte lasciati sulla GPU non comprano profondita'",
  );

  // Soglie coincidenti o invertite sono il difetto che l'isteresi previene.
  assert.throws(
    () => assertHistorySpillMarks({ ...marks, lowWaterBytes: marks.highWaterBytes }),
    /lowWaterBytes/,
  );
  assert.throws(
    () => assertHistorySpillMarks({ ...marks, keepHotCheckpoints: -1 }),
    /keepHotCheckpoints/,
  );

  const candidato = (id, distance, gpuBytes, extra = {}) => ({
    id,
    distance,
    gpuBytes,
    spilled: false,
    pinned: false,
    ...extra,
  });

  // Sotto la soglia alta non si muove niente, nemmeno con candidati pronti.
  {
    const piano = planHistorySpill(
      [candidato(1, 9, 32 * MiB), candidato(2, 8, 32 * MiB)],
      150 * MiB,
      marks,
    );
    assert.equal(piano.required, false);
    assert.equal(piano.reason, "within-high-water");
    assert.equal(piano.steps.length, 0);
    assert.equal(piano.projectedBytes, 150 * MiB);
  }

  // Il confine e' inclusivo: esattamente alla soglia alta non si parte.
  assert.equal(
    planHistorySpill([candidato(1, 9, 32 * MiB)], marks.highWaterBytes, marks).required,
    false,
  );
  assert.equal(
    planHistorySpill([candidato(1, 9, 32 * MiB)], marks.highWaterBytes + 1, marks).required,
    true,
  );

  // Oltre la soglia si travasa TUTTO il travasabile, non fino a un bersaglio.
  // Lasciare byte sulla GPU non comprerebbe profondita': i checkpoint residenti
  // rendono veloce un ritorno lontano, non lo rendono possibile.
  {
    const candidati = [
      candidato(1, 7, 32 * MiB),
      candidato(2, 6, 32 * MiB),
      candidato(3, 5, 32 * MiB),
      candidato(4, 4, 32 * MiB),
      candidato(5, 1, 32 * MiB),
      candidato(6, 0, 32 * MiB),
    ];
    const piano = planHistorySpill(candidati, 224 * MiB, marks);
    assert.equal(piano.required, true);
    assert.equal(piano.reason, "spilled-all-eligible");
    assert.equal(piano.exhaustedEligible, true);
    // Dal piu' lontano verso il piu' recente: la probabilita' di essere
    // richiesto scende con la distanza, ed e' quella che deve guidare.
    assert.deepEqual(piano.steps.map((s) => s.id), [1, 2, 3, 4]);
    assert.equal(piano.spilledBytes, 128 * MiB);
    assert.equal(piano.projectedBytes, 96 * MiB);
    // I due recenti restano caldi anche potendo travasarli: e' il contratto che
    // tiene immediati i primi annullamenti.
    assert.ok(!piano.steps.some((s) => s.id === 5 || s.id === 6));
  }

  // I recenti sono intoccabili anche quando sono l'unica cosa rimasta.
  {
    const piano = planHistorySpill(
      [candidato(1, 0, 120 * MiB), candidato(2, 1, 120 * MiB)],
      240 * MiB,
      marks,
    );
    assert.equal(piano.steps.length, 0);
    assert.equal(piano.required, false);
    assert.equal(piano.exhaustedEligible, true);
    assert.equal(
      piano.reason,
      "no-eligible-checkpoints",
      "restare sopra soglia senza candidati va detto, non nascosto",
    );
    assert.equal(piano.projectedBytes, 240 * MiB);
  }

  // Gia' travasati e bloccati da un replay in corso non contano.
  {
    const piano = planHistorySpill(
      [
        candidato(1, 9, 64 * MiB, { spilled: true }),
        candidato(2, 8, 64 * MiB, { pinned: true }),
        candidato(3, 7, 64 * MiB),
      ],
      240 * MiB,
      marks,
    );
    assert.deepEqual(piano.steps.map((s) => s.id), [3]);
    assert.equal(piano.projectedBytes, 176 * MiB);
    assert.equal(piano.exhaustedEligible, true, "il solo candidato libero era il 3");
  }

  // Lo scenario dell'utente: superata la soglia si travasa tutto il travasabile
  // in un giro solo, e il giro dopo non c'e' piu' niente da fare.
  {
    const candidati = Array.from({ length: 8 }, (_, index) =>
      candidato(index + 1, 7 - index, 32 * MiB));
    const travasati = new Set();
    const piano = planHistorySpill(candidati, 256 * MiB, marks);
    piano.steps.forEach((step) => travasati.add(step.id));
    const gpuBytes = piano.projectedBytes;

    // Otto candidati, i due piu' recenti restano caldi: sei travasati.
    assert.equal(piano.steps.length, 6);
    assert.equal(piano.reason, "spilled-all-eligible");
    assert.equal(gpuBytes, 64 * MiB, "256 − 6×32 = 64 MiB, i due checkpoint caldi");

    // L'isteresi arriva gratis: un travasato non e' piu' candidato, quindi il
    // secondo giro non ha nulla da rifare anche restando sopra la soglia.
    const stabile = planHistorySpill(
      candidati.map((c) => ({ ...c, spilled: travasati.has(c.id) })),
      gpuBytes,
      marks,
    );
    assert.equal(stabile.required, false);
    assert.equal(stabile.reason, "within-high-water");

    const sopraSoglia = planHistorySpill(
      candidati.map((c) => ({ ...c, spilled: travasati.has(c.id) })),
      240 * MiB,
      marks,
    );
    assert.equal(sopraSoglia.required, false);
    assert.equal(
      sopraSoglia.reason,
      "no-eligible-checkpoints",
      "sopra soglia senza candidati: niente churn, e il motivo resta leggibile",
    );
  }
}

console.log("History spill planning verification passed.");
