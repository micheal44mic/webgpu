import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HISTORY_DESKTOP_CHECKPOINT_ALLOWANCE,
  HISTORY_DESKTOP_MAXIMUM_BYTES,
  HISTORY_MINIMUM_BUDGET_BYTES,
  HISTORY_MOBILE_CHECKPOINT_ALLOWANCE,
  HISTORY_MOBILE_MAXIMUM_BYTES,
  createHistoryBudget,
  emptyHistoryMemoryLedger,
  historyBaseBudgetBytes,
  historyMemoryTotalBytes,
  planHistoryBudgetEviction,
  selectCheckpointRepresentation,
} from "../../../src/history-retention-core.ts";
import {
  adaptiveHistoryStorageKeepHotActions,
  canonicalHistoryJson,
  historyDiskBudget,
  planHistoryStorageSegment,
} from "../../../src/history-storage-core.ts";


// --- Budget derivato dal costo di un checkpoint ------------------------------
// Un checkpoint costa esattamente un livello intero, quindi il budget deve
// seguire documento e formato invece di essere un numero fisso: altrimenti la
// profondita' di Undo crolla appena il livello cresce.
const MiB = 1024 * 1024;
const checkpointBytesFor = (documentSize, format) =>
  documentSize * documentSize * (format === "rgba16float" ? 8 : 4);

// --- Segmenti locali globali e budget disco --------------------------------
// Gli ID azione possono avere buchi e le azioni CPU-only possono stare fra due
// payload: il range e' del cursore globale, mai un journal parallelo per layer.
{
  const plan = planHistoryStorageSegment({
    currentResidentBytes: 220 * MiB,
    highWaterBytes: 140 * MiB,
    targetSegmentBytes: 64 * MiB,
    maximumSegmentBytes: 128 * MiB,
    journalLength: 40,
    keepHotActions: 8,
    actions: [
      { actionId: 7, cursor: 2, payloadBytes: 40 * MiB, payloadCount: 2, alreadyStored: false, pinned: false },
      // cursor 3 e' un'azione vettoriale CPU-only e resta implicitamente nel range.
      { actionId: 11, cursor: 4, payloadBytes: 30 * MiB, payloadCount: 1, alreadyStored: false, pinned: false },
      { actionId: 19, cursor: 35, payloadBytes: 90 * MiB, payloadCount: 1, alreadyStored: false, pinned: false },
    ],
  });
  assert.deepEqual(plan, {
    required: true,
    actionIds: [7, 11],
    startCursor: 2,
    endCursor: 5,
    rawBytes: 70 * MiB,
    payloadCount: 3,
    oversize: false,
    reason: "segment",
  });
  assert.equal(
    planHistoryStorageSegment({
      currentResidentBytes: 140 * MiB,
      highWaterBytes: 140 * MiB,
      targetSegmentBytes: 64 * MiB,
      maximumSegmentBytes: 128 * MiB,
      journalLength: 10_000,
      actions: [],
    }).reason,
    "below-high-water",
    "il disco non deve ricevere scritture per gesto sotto la soglia",
  );
  const oversize = planHistoryStorageSegment({
    currentResidentBytes: 300 * MiB,
    highWaterBytes: 140 * MiB,
    targetSegmentBytes: 32 * MiB,
    maximumSegmentBytes: 64 * MiB,
    journalLength: 100,
    keepHotActions: 2,
    actions: [
      { actionId: 50, cursor: 10, payloadBytes: 96 * MiB, payloadCount: 1, alreadyStored: false, pinned: false },
      { actionId: 51, cursor: 11, payloadBytes: 2 * MiB, payloadCount: 1, alreadyStored: false, pinned: false },
    ],
  });
  assert.deepEqual(oversize.actionIds, [50], "un'azione oversize non va spezzata");
  assert.equal(oversize.oversize, true);
  const afterOversizeBudgetRejection = planHistoryStorageSegment({
    currentResidentBytes: 300 * MiB,
    highWaterBytes: 140 * MiB,
    targetSegmentBytes: 32 * MiB,
    maximumSegmentBytes: 64 * MiB,
    journalLength: 100,
    keepHotActions: 2,
    actions: [
      { actionId: 50, cursor: 10, payloadBytes: 96 * MiB, payloadCount: 1, alreadyStored: false, pinned: true },
      { actionId: 51, cursor: 11, payloadBytes: 2 * MiB, payloadCount: 1, alreadyStored: false, pinned: false },
    ],
  });
  assert.deepEqual(
    afterOversizeBudgetRejection.actionIds,
    [51],
    "un merge oltre quota va isolato: il payload successivo più piccolo deve restare spillabile",
  );
  assert.equal(afterOversizeBudgetRejection.oversize, false);

  const recentLargeActions = Array.from({ length: 7 }, (_, cursor) => ({
    cursor,
    payloadBytes: 32 * MiB,
  }));
  assert.equal(
    adaptiveHistoryStorageKeepHotActions({
      currentResidentBytes: 224 * MiB,
      highWaterBytes: 180 * MiB,
      hotPayloadBudgetBytes: 50 * MiB,
      journalLength: 7,
      actions: recentLargeActions,
    }),
    1,
    "sette checkpoint grandi non devono essere tutti protetti dalla finestra fissa di 16 azioni",
  );
  assert.equal(
    adaptiveHistoryStorageKeepHotActions({
      currentResidentBytes: 160 * MiB,
      highWaterBytes: 180 * MiB,
      hotPayloadBudgetBytes: 50 * MiB,
      journalLength: 40,
      actions: recentLargeActions,
    }),
    16,
    "sotto pressione nulla resta valida la normale finestra calda di 16 azioni",
  );

  const budget = historyDiskBudget({
    quota: 10 * 1024 * MiB,
    usage: 2 * 1024 * MiB,
    committedHistoryBytes: 100 * MiB,
    maximumStoredSegmentBytes: 128 * MiB,
    mobile: false,
  });
  assert(budget.hardBytes >= budget.targetBytes && budget.targetBytes >= 0);
  assert(
    historyDiskBudget({
      quota: 0,
      usage: 0,
      committedHistoryBytes: 0,
      maximumStoredSegmentBytes: 64 * MiB,
      mobile: true,
    }).hardBytes > 0,
    "una quota non riportata deve tentare un budget prudente e affidarsi a QuotaExceeded",
  );
  for (const malformed of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const safe = historyDiskBudget({
      quota: malformed,
      usage: malformed,
      committedHistoryBytes: malformed,
      maximumStoredSegmentBytes: malformed,
      mobile: true,
    });
    assert.equal(safe.hardBytes, 0);
    assert.equal(safe.targetBytes, 0);
  }
  assert.equal(
    canonicalHistoryJson({ z: 1, a: { y: 2, x: 3 } }),
    canonicalHistoryJson({ a: { x: 3, y: 2 }, z: 1 }),
    "il digest del descriptor non deve dipendere dall'ordine di inserimento delle chiavi",
  );
}

assert.equal(checkpointBytesFor(2048, "rgba8unorm"), 16 * MiB);
assert.equal(checkpointBytesFor(2048, "rgba16float"), 32 * MiB);
assert.equal(checkpointBytesFor(4096, "rgba8unorm"), 64 * MiB);
assert.equal(checkpointBytesFor(4096, "rgba16float"), 128 * MiB);

for (const documentSize of [2048, 4096]) {
  for (const format of ["rgba8unorm", "rgba16float"]) {
    const checkpointBytes = checkpointBytesFor(documentSize, format);
    for (const mobile of [true, false]) {
      const budget = historyBaseBudgetBytes({ checkpointBytes, mobile });
      const allowance = mobile
        ? HISTORY_MOBILE_CHECKPOINT_ALLOWANCE
        : HISTORY_DESKTOP_CHECKPOINT_ALLOWANCE;
      const ceiling = mobile ? HISTORY_MOBILE_MAXIMUM_BYTES : HISTORY_DESKTOP_MAXIMUM_BYTES;
      const label = `${documentSize}² ${format} ${mobile ? "mobile" : "desktop"}`;
      assert.equal(
        budget,
        Math.max(
          HISTORY_MINIMUM_BUDGET_BYTES,
          checkpointBytes,
          Math.min(ceiling, checkpointBytes * allowance),
        ),
        `budget History non derivato dal checkpoint: ${label}`,
      );
      assert.ok(
        budget <= Math.max(ceiling, checkpointBytes),
        `budget History oltre il tetto del dispositivo: ${label}`,
      );
      assert.ok(
        budget >= HISTORY_MINIMUM_BUDGET_BYTES,
        `budget History sotto il minimo: ${label}`,
      );
      // Il budget deve reggere almeno un checkpoint pieno, altrimenti
      // l'eviction non troverebbe mai un boundary e resterebbe bloccata.
      assert.ok(
        budget >= checkpointBytes,
        `budget History non regge un checkpoint intero: ${label}`,
      );
    }
  }
}

// Il telefono deve restare sotto il proprio tetto assoluto in entrambi i
// formati alla taglia che usa davvero (2048²). Il tetto e' passato da 96 a 200
// MiB: a 96 veniva superato quasi subito e l'eviction rispondeva distruggendo
// passi di Undo, che e' il costo che non si voleva pagare. L'asserzione resta
// legata alla costante invece che a un numero scritto qui, cosi' spostare il
// tetto e' una decisione sola in un posto solo.
for (const format of ["rgba8unorm", "rgba16float"]) {
  assert.ok(
    historyBaseBudgetBytes({ checkpointBytes: checkpointBytesFor(2048, format), mobile: true })
      <= HISTORY_MOBILE_MAXIMUM_BYTES,
    `il budget mobile deve restare entro il proprio tetto a ${format}`,
  );
}
assert.ok(
  historyBaseBudgetBytes({ checkpointBytes: checkpointBytesFor(2048, "rgba8unorm"), mobile: true })
    < 192 * MiB,
  "il budget mobile deve essere sceso rispetto ai 192 MiB fissi precedenti",
);
assert.ok(
  historyBaseBudgetBytes({ checkpointBytes: checkpointBytesFor(2048, "rgba8unorm"), mobile: true })
    < historyBaseBudgetBytes({
      checkpointBytes: checkpointBytesFor(2048, "rgba8unorm"),
      mobile: false,
    }),
  "il budget mobile deve restare inferiore a quello desktop",
);

// --- Nessun tetto numerico sulla profondita' --------------------------------
// Diecimila azioni leggere non sono una ragione per perderne una sola: finche'
// i byte restano sotto budget, il pianificatore non deve chiedere eviction.
assert.deepEqual(
  planHistoryBudgetEviction(
    { ...emptyHistoryMemoryLedger(), gpuAllocatedBytes: 64 * MiB },
    createHistoryBudget(192 * MiB),
    [{
      cursor: 10_000,
      retainedBytes: 32 * MiB,
      baselineBytes: 16 * MiB,
      exactLayerCount: 1,
      liveLayerCount: 1,
    }],
  ),
  {
    required: false,
    boundaryCursor: null,
    projectedBytes: 64 * MiB,
    reason: "within-budget",
  },
  "il conteggio delle azioni non deve accorciare una cronologia entro budget",
);

// --- La classe dispositivo non va risonata dal viewport -----------------------
// Il difetto misurato il 06/08/2026: con `matchMedia("(max-width: 700px)")` lo
// stesso telefono passava da 192 a 512 MiB ruotando in landscape (`844 px`).
const maintenanceSource = readFileSync(
  new URL("../../../src/history-maintenance-runtime.ts", import.meta.url),
  "utf8",
);
const retentionCoreSource = readFileSync(
  new URL("../../../src/history-retention-core.ts", import.meta.url),
  "utf8",
);
const removedDepthCap =
  /HISTORY_MAXIMUM_UNDO_DEPTH|planHistoryDepthEviction|enforceHistoryDepthCap|depthEvictions|maximumUndoDepth/;
assert.doesNotMatch(
  retentionCoreSource,
  removedDepthCap,
  "la politica pura non deve piu' contenere un tetto numerico di Undo",
);
assert.doesNotMatch(
  maintenanceSource,
  removedDepthCap,
  "il runtime non deve piu' accorciare la cronologia in base al numero di azioni",
);
assert.doesNotMatch(
  maintenanceSource,
  /matchMedia\(/,
  "il budget History non deve risondare i media query: la classe dispositivo vive in engine-limits",
);
assert.match(
  maintenanceSource,
  /MOBILE_DEVICE_CLASS/,
  "il budget History deve usare la classe dispositivo condivisa",
);
const enforceBudgetStart = maintenanceSource.indexOf("function enforceHistoryBudget");
const enforceBudgetEnd = maintenanceSource.indexOf("export function historyFloorCursor");
assert.ok(
  enforceBudgetStart >= 0 && enforceBudgetEnd > enforceBudgetStart,
  "marcatori di enforceHistoryBudget assenti",
);
const enforceBudgetBody = maintenanceSource.slice(enforceBudgetStart, enforceBudgetEnd);
const withinBudgetGate = enforceBudgetBody.indexOf(
  "if (historyMemoryTotalBytes(ledger) <= budget.hardBytes)",
);
assert.ok(withinBudgetGate >= 0, "gate entro-budget assente");
assert.doesNotMatch(
  enforceBudgetBody.slice(0, withinBudgetGate),
  /historyCursor|floorCursor|historyActions|evictHistoryBelowBaselines|latestFullCheckpointByLayer/,
  "prima del gate in byte non deve esistere alcuna decisione basata sulla profondita'",
);
assert.match(
  enforceBudgetBody,
  /^ {2}const evicted = evictHistoryBelowBaselines\(engine, baselines\);$/m,
  "il budget deve leggere l'esito reale dell'eviction",
);
assert.match(
  enforceBudgetBody,
  /^ {2}state\.budgetCheckpointBlocked = !evicted;$/m,
  "il budget deve marcare il blocco in base all'esito reale dell'eviction",
);

// L'eviction condivisa non si attribuisce la causa da sola: e' il solo gate del
// budget, dopo avere verificato il risultato, a incrementare la telemetria.
const evictStart = maintenanceSource.indexOf("function evictHistoryBelowBaselines");
const evictEnd = maintenanceSource.indexOf("function enforceHistoryBudget");
assert.ok(evictStart >= 0 && evictEnd > evictStart, "marcatori di evictHistoryBelowBaselines assenti");
assert.doesNotMatch(
  maintenanceSource.slice(evictStart, evictEnd),
  /state\.budgetEvictions \+= 1/,
  "l'eviction condivisa non deve attribuirsi la causa prima del gate del budget",
);

const captureStart = maintenanceSource.indexOf("async function capturePeriodicCheckpoint");
const captureEnd = maintenanceSource.indexOf("export function discardStalePeriodicCheckpoints");
assert.ok(captureStart >= 0 && captureEnd > captureStart, "marcatori di capturePeriodicCheckpoint assenti");
const captureBody = maintenanceSource.slice(captureStart, captureEnd);
assert.match(
  captureBody,
  /const fullRequired = !current\s*\n\s*\|\| delta\.requiresFull\s*\n\s*\|\| delta\.reset;/,
  "un full deve essere obbligatorio soltanto per la correttezza della catena",
);
assert.match(
  captureBody,
  /const fullRequired = !current$/m,
  "la distinzione fra full obbligatorio e full preferito deve restare esplicita",
);
assert.match(
  captureBody,
  /const rebasePreferred = checkpointOrdinal % HISTORY_FULL_CHECKPOINT_PERIOD === 0;/,
  "il full periodico e' una preferenza, non un obbligo",
);
// Entrambi i candidati devono essere misurati prima di scegliere: sceglierne
// uno e chiedere poi se ci sta e' cio' che produceva la fame all'ottavo.
assert.match(
  captureBody,
  /const fullMask = buildMask\(true\);\s*\n\s*const deltaMask = buildMask\(false\);/,
  "full e delta vanno costruiti entrambi prima della scelta",
);
assert.match(
  captureBody,
  /selectCheckpointRepresentation\(\{/,
  "la scelta della rappresentazione deve passare dalla politica pura",
);
