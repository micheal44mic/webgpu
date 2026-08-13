import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL,
  HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES,
  HISTORY_DESKTOP_CHECKPOINT_ALLOWANCE,
  HISTORY_DESKTOP_MAXIMUM_BYTES,
  HISTORY_MINIMUM_BUDGET_BYTES,
  HISTORY_MOBILE_CHECKPOINT_ALLOWANCE,
  HISTORY_MOBILE_MAXIMUM_BYTES,
  HISTORY_RETENTION_STRATEGY,
  HISTORY_SPILL_HIGH_WATER_BYTES,
  HISTORY_SPILL_KEEP_HOT_CHECKPOINTS,
  HISTORY_SPILL_LOW_WATER_BYTES,
  admitHistoryCheckpoint,
  assertHistorySpillMarks,
  createHistoryBudget,
  defaultHistorySpillMarks,
  emptyHistoryMemoryLedger,
  historyAccountingIsAppendOnly,
  historyBaseBudgetBytes,
  historyBudgetPressure,
  historyMemoryTotalBytes,
  nearestHistoryCheckpoint,
  nextHistoryCompactionChunk,
  planHistoryBudgetEviction,
  planHistoryCheckpoint,
  planHistoryBudgetRecovery,
  planHistorySpill,
  processHistoryMaintenanceChunks,
  selectCheckpointRepresentation,
} from "../src/history-retention-core.ts";
import {
  adaptiveHistoryStorageKeepHotActions,
  canonicalHistoryJson,
  historyDiskBudget,
  planHistoryStorageSegment,
} from "../src/history-storage-core.ts";

assert.equal(
  HISTORY_RETENTION_STRATEGY,
  "byte-budget-exact-tiled-checkpoints-idle-fenced-chunked-v1",
);

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
  new URL("../src/history-maintenance-runtime.ts", import.meta.url),
  "utf8",
);
const retentionCoreSource = readFileSync(
  new URL("../src/history-retention-core.ts", import.meta.url),
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

const applyAction = (pixels, action) => {
  const first = (action.id * 17 + action.layerId * 11) % pixels.length;
  const second = (first + 19 + action.id % 7) % pixels.length;
  pixels[first] = (pixels[first] + action.id * 3 + 7) & 0xff;
  pixels[second] ^= (action.id * 29) & 0xff;
};

const hashBytes = (bytes) => {
  let hash = 0x811c9dc5;
  for (const value of bytes) hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
};

const longSessionTelemetry = [];

/**
 * Deterministic long-session model: checkpoint snapshots and legacy replay must
 * reach byte-identical pixels for every sampled cursor. The model deliberately
 * uses the same stable action-id anchor as the runtime, not array offsets.
 */
for (const actionCount of [10, 100, 500, 1000]) {
  const actions = [];
  const checkpoints = [];
  const checkpointPixels = new Map();
  const tiledCheckpoints = [];
  const changedTiles = new Set();
  const authoritative = new Uint8Array(128);
  let actionsSinceCheckpoint = 0;
  let replayBatchesSinceCheckpoint = 0;
  let payloadBytesSinceCheckpoint = 0;
  let checkpointId = 1;

  for (let id = 1; id <= actionCount; id += 1) {
    const action = { id, kind: "stroke", layerId: 1 };
    actions.push(action);
    applyAction(authoritative, action);
    const firstPixel = (action.id * 17 + action.layerId * 11) % authoritative.length;
    const secondPixel = (firstPixel + 19 + action.id % 7) % authoritative.length;
    changedTiles.add(Math.floor(firstPixel / 16));
    changedTiles.add(Math.floor(secondPixel / 16));
    actionsSinceCheckpoint += 1;
    replayBatchesSinceCheckpoint += 1 + Number(id % 11 === 0);
    payloadBytesSinceCheckpoint += 32 * (8 + (id * 13) % 300);
    const plan = planHistoryCheckpoint({
      actionsSinceCheckpoint,
      replayBatchesSinceCheckpoint,
      payloadBytesSinceCheckpoint,
      budgetPressure: id / actionCount * 0.6,
    });
    if (plan.capture) {
      const checkpoint = {
        id: checkpointId++,
        layerId: 1,
        afterActionId: id,
      };
      checkpoints.push(checkpoint);
      checkpointPixels.set(checkpoint.id, authoritative.slice());
      const full = tiledCheckpoints.length === 0 || (tiledCheckpoints.length + 1) % 8 === 0;
      const tileIndices = full
        ? Array.from({ length: authoritative.length / 16 }, (_, index) => index)
        : [...changedTiles].sort((left, right) => left - right);
      tiledCheckpoints.push({
        ...checkpoint,
        parentId: full ? null : tiledCheckpoints.at(-1).id,
        full,
        tiles: new Map(tileIndices.map((tileIndex) => [
          tileIndex,
          authoritative.slice(tileIndex * 16, tileIndex * 16 + 16),
        ])),
      });
      changedTiles.clear();
      actionsSinceCheckpoint = 0;
      replayBatchesSinceCheckpoint = 0;
      payloadBytesSinceCheckpoint = 0;
    }
  }

  let maximumReplayActions = 0;
  const cursors = Array.from({ length: actionCount + 1 }, (_, index) => index);
  for (const cursor of cursors) {
    const expected = new Uint8Array(128);
    for (let index = 0; index < cursor; index += 1) applyAction(expected, actions[index]);

    const nearest = nearestHistoryCheckpoint(actions, cursor, 1, checkpoints);
    const actual = nearest
      ? checkpointPixels.get(nearest.checkpoint.id).slice()
      : new Uint8Array(128);
    const replayStart = nearest ? nearest.actionIndex + 1 : 0;
    for (let index = replayStart; index < cursor; index += 1) applyAction(actual, actions[index]);
    maximumReplayActions = Math.max(maximumReplayActions, cursor - replayStart);
    assert.deepEqual(
      actual,
      expected,
      `${actionCount} azioni, cursor ${cursor}: checkpoint e replay legacy devono coincidere`,
    );

    const tiledNearest = nearestHistoryCheckpoint(actions, cursor, 1, tiledCheckpoints);
    const tiledActual = new Uint8Array(128);
    let tiledReplayStart = 0;
    if (tiledNearest) {
      const byId = new Map(tiledCheckpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
      const chain = [];
      let checkpoint = tiledNearest.checkpoint;
      while (checkpoint) {
        chain.push(checkpoint);
        if (checkpoint.full) break;
        checkpoint = byId.get(checkpoint.parentId);
      }
      assert(chain.at(-1)?.full, "ogni catena delta deve terminare in una base full");
      for (const patch of chain.reverse()) {
        for (const [tileIndex, bytes] of patch.tiles) tiledActual.set(bytes, tileIndex * 16);
      }
      tiledReplayStart = tiledNearest.actionIndex + 1;
    }
    for (let index = tiledReplayStart; index < cursor; index += 1) {
      applyAction(tiledActual, actions[index]);
    }
    assert.deepEqual(
      tiledActual,
      expected,
      `${actionCount} azioni, cursor ${cursor}: catena tiled delta deve essere pixel-identica`,
    );
  }
  assert(
    maximumReplayActions <= HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES,
    `${actionCount} azioni: tail ${maximumReplayActions} oltre il limite adattivo`,
  );
  if (actionCount >= HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL) {
    assert(checkpoints.length > 0, `${actionCount} azioni devono creare checkpoint`);
  }
  longSessionTelemetry.push({
    actions: actionCount,
    checkpoints: checkpoints.length,
    maximumReplayActions,
    finalPixelHash: hashBytes(authoritative),
  });
}

// Clear is a strict per-layer barrier: a checkpoint before it cannot seed the
// visible state after it, while a checkpoint on another layer is irrelevant.
{
  const actions = [
    { id: 1, kind: "stroke", layerId: 1 },
    { id: 2, kind: "stroke", layerId: 2 },
    { id: 3, kind: "clear", layerId: 1 },
    { id: 4, kind: "stroke", layerId: 1 },
  ];
  const checkpoints = [
    { id: 1, layerId: 1, afterActionId: 1 },
    { id: 2, layerId: 2, afterActionId: 2 },
    { id: 3, layerId: 1, afterActionId: 4 },
  ];
  assert.equal(nearestHistoryCheckpoint(actions, 3, 1, checkpoints), null);
  assert.equal(nearestHistoryCheckpoint(actions, 4, 1, checkpoints)?.checkpoint.id, 3);
}

// Chunking has exact, gap-free coverage and never performs an unbounded sweep.
{
  const visited = [];
  let start = 0;
  while (true) {
    const chunk = nextHistoryCompactionChunk(1000, start, 64);
    for (let index = chunk.start; index < chunk.end; index += 1) visited.push(index);
    start = chunk.end;
    if (chunk.done) break;
  }
  assert.deepEqual(visited, Array.from({ length: 1000 }, (_, index) => index));
  assert.throws(() => nextHistoryCompactionChunk(5, 0, 0), /positivo/);
}

// Incremental maintenance must return control between bounded chunks and stop
// at the first interaction gate without visiting the remaining journal.
{
  const visited = [];
  let yields = 0;
  const complete = await processHistoryMaintenanceChunks(
    1000,
    (start, end) => {
      assert(end - start <= 64, "nessun turno può superare il chunk da 64");
      for (let index = start; index < end; index += 1) visited.push(index);
    },
    {
      shouldContinue: () => true,
      yieldTurn: async () => {
        yields += 1;
        await Promise.resolve();
      },
    },
  );
  assert.equal(complete.completed, true);
  assert.equal(complete.processedItems, 1000);
  assert.equal(complete.chunks, 16);
  assert.equal(complete.yields, 15);
  assert.equal(yields, 15);
  assert.deepEqual(visited, Array.from({ length: 1000 }, (_, index) => index));

  let continueMaintenance = true;
  const abortedVisited = [];
  const aborted = await processHistoryMaintenanceChunks(
    1000,
    (start, end) => {
      for (let index = start; index < end; index += 1) abortedVisited.push(index);
    },
    {
      shouldContinue: () => continueMaintenance,
      yieldTurn: async () => {
        continueMaintenance = false;
        await Promise.resolve();
      },
    },
  );
  assert.equal(aborted.completed, false);
  assert.equal(aborted.processedItems, 64);
  assert.equal(aborted.chunks, 1);
  assert.equal(aborted.yields, 1);
  assert.equal(abortedVisited.length, 64);
}

// Accounting is categorical and byte-based. A complete exact boundary is the
// only legal eviction point; missing one layer requests another checkpoint.
{
  const MiB = 1024 * 1024;
  const ledger = {
    ...emptyHistoryMemoryLedger(),
    gpuPayloadBytes: 120 * MiB,
    gpuReservedBytes: 150 * MiB,
    gpuAllocatedBytes: 160 * MiB,
    checkpointBytes: 48 * MiB,
    selectionFillMaskBytes: 24 * MiB,
    cpuVectorBytes: 4 * MiB,
    assetBytes: 12 * MiB,
  };
  assert.equal(
    historyMemoryTotalBytes(ledger),
    224 * MiB,
    "il budget deve usare le pagine fisiche, non i soli 144 MiB logici",
  );
  const budget = createHistoryBudget(192 * MiB);
  assert.equal(historyBudgetPressure(ledger, budget), 1);
  assert.equal(
    planHistoryBudgetEviction(ledger, budget, [{
      cursor: 300,
      retainedBytes: 80 * MiB,
      baselineBytes: 48 * MiB,
      exactLayerCount: 1,
      liveLayerCount: 2,
    }]).reason,
    "checkpoint-required",
  );
  const plan = planHistoryBudgetEviction(ledger, budget, [
    {
      cursor: 500,
      retainedBytes: 70 * MiB,
      baselineBytes: 50 * MiB,
      exactLayerCount: 2,
      liveLayerCount: 2,
    },
    {
      cursor: 250,
      retainedBytes: 100 * MiB,
      baselineBytes: 50 * MiB,
      exactLayerCount: 2,
      liveLayerCount: 2,
    },
  ]);
  assert.deepEqual(plan, {
    required: true,
    boundaryCursor: 250,
    projectedBytes: 150 * MiB,
    reason: "exact-boundary",
  });
}

// Runtime seam: maintenance is never invoked from pointermove/the hot stamp
// encoder; it starts from stable history publication, fences the queue, pumps
// the final RAF, then compacts/captures. Replay hydrates every patch in order.
{
  const brushEngine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
  const runtime = readFileSync(
    new URL("../src/history-maintenance-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyRuntime = readFileSync(
    new URL("../src/engine-history-runtime.ts", import.meta.url),
    "utf8",
  );
  const runtimeMisc = readFileSync(
    new URL("../src/engine-runtime-misc.ts", import.meta.url),
    "utf8",
  );
  const coldStorage = readFileSync(
    new URL("../src/engine-cold-storage.ts", import.meta.url),
    "utf8",
  );
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const documentInteraction = readFileSync(
    new URL("../src/document-interaction-controller.ts", import.meta.url),
    "utf8",
  );
  const publishHistory = brushEngine.slice(
    brushEngine.indexOf("  publishHistoryState(): void"),
    brushEngine.indexOf("  publishActiveLayerChange(): void"),
  );
  assert(publishHistory.includes("scheduleHistoryMaintenance(this)"));
  const appendPoint = brushEngine.slice(
    brushEngine.indexOf("  appendPoint("),
    brushEngine.indexOf("  endStroke("),
  );
  assert(!appendPoint.includes("scheduleHistoryMaintenance"));
  assert(!appendPoint.includes("compactDiscardedHistoryIncrementally"));
  assert(!runtimeMisc.includes("compactDiscardedHistoryIncrementally"));
  assert.match(
    runtime,
    /device\.queue\.onSubmittedWorkDone\(\)[\s\S]*?await engine\.waitForIdle\(\)[\s\S]*?await engine\.compactDiscardedHistoryIncrementally\([\s\S]*?capturePeriodicCheckpoint\(engine, expectedGeneration\)/,
  );
  const scheduleStart = runtime.indexOf("export function scheduleHistoryMaintenance");
  const scheduleEnd = runtime.indexOf("export function cancelHistoryMaintenance");
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  const scheduleBody = runtime.slice(scheduleStart, scheduleEnd);
  const recoveryBeforeCapture = scheduleBody.indexOf("enforceHistoryBudget(engine, false);");
  const capture = scheduleBody.indexOf("await capturePeriodicCheckpoint(engine, expectedGeneration);");
  const recoveryAfterCapture = scheduleBody.indexOf(
    "enforceHistoryBudget(engine, false);",
    recoveryBeforeCapture + 1,
  );
  const spill = scheduleBody.indexOf("await engine.historyLocalStorage.spillIfNeeded(spillOptions);");
  const journalRecovery = scheduleBody.indexOf(
    "enforceHistoryBudget(engine, !deferJournalEviction);",
  );
  assert.ok(
    recoveryBeforeCapture >= 0
      && recoveryBeforeCapture < capture
      && capture < recoveryAfterCapture
      && recoveryAfterCapture < spill
      && spill < journalRecovery,
    "la cache va recuperata prima e dopo la cattura, sempre prima dello spill; "
      + "il journal si valuta solo dopo",
  );
  assert.equal(
    scheduleBody.match(/enforceHistoryBudget\(engine, false\);/g)?.length,
    2,
    "servono esattamente i due gate cache attorno alla cattura",
  );
  assert(runtime.includes("latestFullCheckpointByLayer(engine)"));
  assert(runtime.includes("state.floorCursor = candidateFloor"));
  assert(runtime.includes("historyMemoryTotalBytes(ledger) <= budget.hardBytes"));
  assert(runtime.includes("!engine.activeRasterLayerMetadataHistoryEdit"));
  assert(runtime.includes("!engine.activeRasterTransformSession"));
  assert(runtime.includes("accountSelectionSnapshot(engine, state, action.selectionBefore)"));
  assert(runtime.includes("accountSelectionSnapshot(engine, state, action.selectionAfter)"));
  assert(runtime.includes("state.accounting.gpuReservedBytes = gpuStorage.usedReservedBytes"));
  assert(runtime.includes("state.accounting.gpuAllocatedBytes = gpuStorage.allocatedBytes"));
  // La decisione fra incrementale e ricostruzione non vive piu' qui: e' stata
  // spostata in `history-retention-core`, che si carica in Node e quindi si puo'
  // provare sul comportamento invece che sul testo. Il runtime deve limitarsi a
  // dichiarare cosa vede, cursore compreso.
  assert(runtime.includes("historyAccountingIsAppendOnly("));
  // Il collegamento va pinzato oltre alla semantica. Il test di comportamento
  // prova la funzione pura con watermark scritti a mano, quindi non si accorge
  // se il runtime passa il cursore SBAGLIATO: mettendo `engine.historyCursor`
  // da entrambi i lati il confronto sarebbe sempre vero e il veleno tornerebbe,
  // con la funzione pura ancora perfettamente corretta. E' successo, in questa
  // stessa sessione, ed e' passato inosservato al primo giro.
  const sincronizza = runtime.slice(
    runtime.indexOf("function synchronizeHistoryAccounting"),
    runtime.indexOf("function rebuildHistoryAccounting") >= 0
      ? runtime.length
      : runtime.length,
  );
  assert.match(
    sincronizza,
    /\{\s*\n\s*initialized: state\.accountingInitialized,\s*\n\s*cursor: state\.observedCursor,/,
    "il watermark deve portare il cursore OSSERVATO, non quello corrente: "
    + "confrontare il cursore con se stesso rende il termine sempre vero",
  );
  assert.match(
    sincronizza,
    /\{\s*\n\s*cursor: engine\.historyCursor,\s*\n\s*actions: engine\.historyActions,/,
    "l'osservazione deve portare il cursore corrente",
  );
  assert(runtime.includes("accountingIncrementalActions"));
  assert(runtime.includes("baseBytes - effectsBytes"));
  assert.match(
    runtime,
    /const availableBytes = Math\.max\(\s*HISTORY_MINIMUM_BUDGET_BYTES,\s*checkpointBytes,\s*baseBytes - effectsBytes,\s*\)/,
    "gli scratch effetti non devono ridurre History sotto un checkpoint RGBA16F intero",
  );
  assert(coldStorage.includes("createLayerColdStorageCandidateIncrementally"));
  assert.match(
    coldStorage,
    /if \(!hooks\.shouldContinue\(\)\)[\s\S]{0,500}device\.queue\.submit/,
    "ogni submit tile del checkpoint deve avere un gate di interazione immediatamente prima",
  );
  assert(historyRuntime.includes("historyCursorWithinRetainedRange(engine, nextCursor)"));
  assert(runtime.includes("await engine.compactDiscardedHistoryIncrementally("));
  assert(runtime.includes("yieldHistoryMaintenanceTurn"));
  assert(documentInteraction.includes("this.options.engine.interruptHistoryMaintenance()"));
  assert(documentInteraction.includes("this.options.engine.resumeDiscardedHistoryMaintenance()"));
  assert(historyRuntime.includes("const releaseSlicePhase = async"));
  assert(historyRuntime.includes("engine.historyGpuStorage.releaseMany(slices)"));
  assert.match(
    historyRuntime,
    /beforeRelease\?\.\(value\);\s*slices\.push\(sliceFor\(value\)\);[\s\S]{0,180}releaseMany\(slices\)/,
  );
  assert(!historyRuntime.includes("while (releaseCursor < slicesToRelease.length)"));
  assert(!runtime.includes("JSON.stringify"));
  assert.match(
    historyRuntime,
    /for \(const replaySeed of replaySeeds\) \{\s*encodeLayerColdHydration\(encoder, replaySeed, hot\);/,
  );
}

console.log(`History retention telemetry: ${JSON.stringify(longSessionTelemetry)}`);
console.log("History retention long-session verification passed (10/100/500/1000 actions).");

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

// --- Guasto di cronologia visibile ------------------------------------------
// Il messaggio d'errore vero vive un istante nella barra di stato e il primo
// aggiornamento lo cancella; su telefono non c'e' console, quindi in mano
// restano solo le righe ripetute che ne sono la conseguenza. Senza la causa
// una diagnosi e' impossibile: il pannello deve conservarla e mostrarla.
{
  const gpuMemoryPanel = readFileSync(
    new URL("../src/gpu-memory-panel-controller.ts", import.meta.url),
    "utf8",
  );
  const historyControls = readFileSync(
    new URL("../src/history-controls-controller.ts", import.meta.url),
    "utf8",
  );
  assert(
    historyControls.includes("this.failure = {"),
    "HistoryControlsController deve registrare il guasto, non solo mostrarlo",
  );
  for (const campo of ["operation,", "action:", "cursor:", "message,"]) {
    assert(
      historyControls.includes(campo),
      `il guasto registrato deve riportare ${campo}`,
    );
  }
  const diagnostica = gpuMemoryPanel.slice(
    gpuMemoryPanel.indexOf("private updateHistoryDiagnostics(): void"),
    gpuMemoryPanel.indexOf("private updateGpuMemoryAudit("),
  );
  assert(
    diagnostica.includes("ULTIMO GUASTO"),
    "il pannello deve mostrare l'ultimo guasto di cronologia",
  );
  assert(
    diagnostica.includes("lastFailure.message"),
    "il pannello deve riportare il messaggio originale, non solo che c'e' stato un guasto",
  );
}

console.log("History failure surfacing verified.");

// --- Input rapidi e pavimento visibile -------------------------------------
// Durante un replay getHistoryState espone canUndo/canRedo=false perche' il
// motore e' occupato. Quello stato non e' un verdetto sul comando successivo:
// filtrarlo nel keydown o rendere nativo-disabled il pulsante fa sparire gli
// input proprio mentre la coda dovrebbe conservarli. Al pavimento, viceversa,
// il comando deve arrivare a runHistoryOperation per mostrarne il motivo.
{
  const historyControls = readFileSync(
    new URL("../src/history-controls-controller.ts", import.meta.url),
    "utf8",
  );
  assert(
    historyControls.includes("const replayBusy = this.replayBusy || this.currentState.busy;"),
    "i controlli devono distinguere un replay accodabile da un blocco reale",
  );
  assert(
    historyControls.includes("this.undoButton.disabled = false;")
      && historyControls.includes("this.redoButton.disabled = false;"),
    "i pulsanti visibili non devono diventare nativo-disabled durante il replay o al pavimento",
  );
  assert(
    historyControls.includes("[this.undoButton, undoBlocked, undoReason")
      && historyControls.includes("[this.redoButton, redoBlocked, redoReason"),
    "i pulsanti visibili devono esporre aria-disabled e il motivo del blocco",
  );
  assert(
    historyControls.includes("const HISTORY_QUEUE_MAXIMUM = 32;")
      && historyControls.includes("this.operationQueue.push(operation);"),
    "la coda rapida deve restare limitata e serializzata",
  );
  assert(
    !historyControls.includes("this.undoButton.disabled = undoBlocked")
      && !historyControls.includes("this.redoButton.disabled = redoBlocked"),
    "canUndo/canRedo temporaneamente falsi non devono disabilitare fisicamente la coda",
  );

  const shortcutStart = historyControls.indexOf("private handleKeyboard(");
  const shortcut = historyControls.slice(
    shortcutStart,
    historyControls.lastIndexOf("\n  }") + 4,
  );
  assert(shortcutStart >= 0, "blocco scorciatoia Undo/Redo non trovato");
  assert(
    !shortcut.includes("const available =")
      && !shortcut.includes("!this.currentState.canUndo")
      && !shortcut.includes("!this.currentState.canRedo"),
    "la scorciatoia non deve scartare input mentre il replay espone canUndo/canRedo=false",
  );
  assert(
    shortcut.includes("if (this.requestLocked())")
      && shortcut.includes("this.request(operation);"),
    "la scorciatoia deve filtrare solo i lock reali e poi affidarsi alla coda",
  );
  assert(
    shortcut.indexOf("event.preventDefault();")
      < shortcut.indexOf("if (this.requestLocked())"),
    "anche un Undo bloccato deve restare nell'app e mostrare il proprio motivo",
  );
}

console.log("History rapid-input queue and retention-floor feedback verified.");

// --- Storage locale: ordine di commit, hydrate preflight e fallback ---------
// Queste sono cuciture di sicurezza: i test puri non vedono l'ordine delle
// mutazioni runtime, quindi una release spostata accidentalmente sopra il CAS
// renderebbe verde il planner e perderebbe comunque l'unica copia dei pixel.
{
  const coordinator = readFileSync(
    new URL("../src/history-storage-coordinator.ts", import.meta.url),
    "utf8",
  );
  const historyRuntime = readFileSync(
    new URL("../src/engine-history-runtime.ts", import.meta.url),
    "utf8",
  );
  const maintenance = readFileSync(
    new URL("../src/history-maintenance-runtime.ts", import.meta.url),
    "utf8",
  );
  const idb = readFileSync(
    new URL("../src/history-storage-idb.ts", import.meta.url),
    "utf8",
  );
  const opfs = readFileSync(
    new URL("../src/history-storage-opfs-worker.ts", import.meta.url),
    "utf8",
  );
  const opfsClient = readFileSync(
    new URL("../src/history-storage-opfs-client.ts", import.meta.url),
    "utf8",
  );
  const replayPlanner = readFileSync(
    new URL("../src/history-replay-plan.ts", import.meta.url),
    "utf8",
  );
  const rasterImageRuntime = readFileSync(
    new URL("../src/engine-raster-image-runtime.ts", import.meta.url),
    "utf8",
  );
  const fillRuntime = readFileSync(
    new URL("../src/engine-fill-runtime.ts", import.meta.url),
    "utf8",
  );
  const gpuStorage = readFileSync(
    new URL("../src/gpu-history-storage.ts", import.meta.url),
    "utf8",
  );

  const spill = coordinator.slice(
    coordinator.indexOf("private async spillOneSegment"),
    coordinator.indexOf("private async serializeGpuPayload"),
  );
  const manifestCommit = spill.indexOf("await this.catalog.commitSegmentCAS(");
  const ownershipCommit = spill.indexOf("gpuDemotion.commitNoThrow();");
  assert(manifestCommit >= 0 && ownershipCommit > manifestCommit,
    "la release residente deve avvenire soltanto dopo il manifest durable");
  assert(
    spill.indexOf("prepareDemoteMany(gpuSlices)") < manifestCommit,
    "l'intero set GPU va prevalidato prima del CAS, senza release incrementali",
  );
  const postManifest = spill.slice(manifestCommit);
  assert(
    postManifest.includes("demotionStillSafe")
      && postManifest.indexOf("if (demotionStillSafe)")
        < postManifest.indexOf("gpuDemotion.commitNoThrow();"),
    "un gesto foreground durante il CAS deve lasciare residenti i payload prevalidati",
  );
  assert.match(
    maintenance,
    /historyCursor === engine\.historyActions\.length;[\s\S]*?historyLocalStorage\.spillIfNeeded/,
    "lo spill v1 deve partire soltanto al journal end",
  );
  assert(
    maintenance.includes("historyMaintenanceEngineIdle(engine, true)"),
    "lo spill non deve auto-annullarsi quando pubblica busy=spilling",
  );

  const move = historyRuntime.slice(
    historyRuntime.indexOf("export async function moveHistoryCursor"),
    historyRuntime.indexOf("export async function rebuildActiveLayerFromHistory"),
  );
  assert(
    move.indexOf("await engine.historyLocalStorage.prepareHistoryStep(delta);")
      < move.indexOf("engine.historyCursor = nextCursor;"),
    "target e rollback devono essere residenti prima che il cursore cambi",
  );
  assert(move.includes("cancelHistoryMaintenance(engine);"));
  assert(coordinator.includes("planRasterHistoryReplay({"));
  assert(coordinator.includes("periodicCheckpointChainForReplay("));
  assert(replayPlanner.includes("selectLayerReplayAfterCheckpoint("));
  assert(coordinator.includes("addRasterReplayRequirements("));
  assert(coordinator.includes("[previousCursor, nextCursor]"));
  const prepare = coordinator.slice(
    coordinator.indexOf("async prepareHistoryStep"),
    coordinator.indexOf("private async initializeSession"),
  );
  assert(
    prepare.indexOf("await this.waitForForegroundStorageAccess();")
      < prepare.indexOf("this.payloadsRequiredForStep(delta)"),
    "Undo deve attendere lo spill e ricalcolare poi le dipendenze residenti",
  );
  assert(
    coordinator.includes("periodicHistoryCheckpoints(this.engine)")
      && coordinator.includes("prepareRasterReplayAtCursor")
      && maintenance.includes("historyColdSeedResidentBytes(checkpoint.seed)")
      && maintenance.includes("rebaseRequiredForReplayBudget")
      && maintenance.includes("currentReplayChainBytes + bytesOf(deltaMask)"),
    "i checkpoint periodici devono poter essere spillati e preidratati con accounting residente",
  );
  const fill = fillRuntime.slice(
    fillRuntime.indexOf("export async function fillAtClientPoint"),
    fillRuntime.indexOf("export const", fillRuntime.indexOf("export async function fillAtClientPoint") + 1),
  );
  assert(
    fill.indexOf("await engine.historyLocalStorage.prepareRasterReplayAtCursor(")
      < fill.indexOf("renderer.encodeLiveCommit("),
    "il Fill deve preidratare il piano di rollback prima di mutare i pixel",
  );
  assert(coordinator.includes("this.engine.selectionHistoryClipBindGroups.clear();"));
  assert(coordinator.includes("Azione History troppo grande per il budget locale"));
  assert(coordinator.includes("diskBudgetBlockedActionIds"));
  assert(coordinator.includes('if (result === "budget-skip") continue;'));
  const diskBudgetGateStart = spill.indexOf(
    "diskBudget.hardBytes <= this.committedBytes",
  );
  assert(diskBudgetGateStart >= 0, "gate budget History non individuato");
  const diskBudgetGate = spill.slice(
    diskBudgetGateStart,
    spill.indexOf("const segmentId = makeId"),
  );
  assert(diskBudgetGate.includes("this.diskBudgetBlockedActionIds.add(actionId)"));
  assert(
    !diskBudgetGate.includes("this.writable = false"),
    "un singolo merge oversize non deve disabilitare globalmente gli spill successivi",
  );
  assert(coordinator.includes("this.consecutiveSpillFailures >= 3"));
  assert(coordinator.includes("failureSignature === this.lastSpillFailureSignature"));
  assert(coordinator.includes("trimHydratedWorkingSetAfterStep"));
  assert(historyRuntime.includes("trimHydratedWorkingSetAfterStep(delta)"));
  assert(!coordinator.includes("localStorage."), "i payload History non vanno in localStorage");

  const floorRetirement = maintenance.slice(
    maintenance.indexOf("// The global floor makes structural Undo below it unreachable."),
    maintenance.indexOf("state.floorCursor = candidateFloor;"),
  );
  assert.match(floorRetirement, /index < candidateFloor/);
  assert.match(floorRetirement, /destroyLayerColdStorage\(input\.entry\.seed\)/);
  assert.match(floorRetirement, /input\.entry\.seed = null/);
  assert.match(floorRetirement, /input\.state = null/);
  assert.match(floorRetirement, /destroyLayerColdStorage\(action\.output\.seed\)/);
  assert.match(floorRetirement, /action\.output\.seed = null/);
  assert.match(floorRetirement, /action\.payloadsRetiredBelowFloor = true/);
  assert(
    maintenance.indexOf("rebuildHistoryAccounting(engine);", maintenance.indexOf(floorRetirement)) >= 0,
    "dopo i tombstone merge il ledger residente deve essere ricostruito",
  );
  assert.match(
    coordinator,
    /onRetire: \(retired\)[\s\S]*?retireStoredPayload\(retired\.payloadId\)/,
    "ritirare un seed merge stored-only deve rimuoverne anche l'ownership locale",
  );

  const serializeGpu = coordinator.slice(
    coordinator.indexOf("private async serializeGpuPayload"),
    coordinator.indexOf("private async serializeColdPayload"),
  );
  assert(
    serializeGpu.indexOf("const rawBytes = raw.byteLength;")
      < serializeGpu.indexOf("await writer.append(bytes)")
      && serializeGpu.indexOf("const rawHash32 = historyHash32(raw);")
        < serializeGpu.indexOf("await writer.append(bytes)"),
    "metadata e hash GPU vanno catturati prima che OPFS detach il buffer",
  );
  const serializeCold = coordinator.slice(
    coordinator.indexOf("private async serializeColdPayload"),
    coordinator.indexOf("private async beginCandidate"),
  );
  assert(
    serializeCold.includes("raw.slice()"),
    "il fallback raw deve sopravvivere al transfer del worker di compressione",
  );
  assert(
    coordinator.includes("await opfs.deleteSegment(sessionId, segmentId);")
      && coordinator.includes("removeSegmentCAS({"),
    "candidati OPFS abortiti e segmenti morti devono essere reclamati",
  );
  assert(
    coordinator.includes("optionalLockManager()")
      && coordinator.includes("ifAvailable: true"),
    "il GC cross-tab deve cancellare soltanto sotto Web Lock esclusivo",
  );
  assert(
    !coordinator.includes(
      'addGpu(batch.selectionMask.gpuSlice, "selection-mask-gpu", batch.actionId, batch.layerId)',
    )
      && !coordinator.includes(
        'addGpu(snapshot.gpuSlice, "selection-mask-gpu", action.id, action.layerId)',
      ),
    "le maschere selezione condivise non devono ereditare un layerId instabile",
  );
  assert(
    maintenance.includes("isHistoryColdSeedHandle(value as LayerColdStorageResources)")
      && maintenance.includes("engine.historyGpuStorage.contains(value as GpuHistorySlice)"),
    "l'estimatore strutturale deve trattare gli handle stored-only come opachi",
  );
  assert(
    rasterImageRuntime.includes("historyColdSeedResidentBytes(seed)"),
    "il budget import deve contare soltanto i seed History residenti",
  );
  assert(
    gpuStorage.includes("sliceById(id: number)")
      && !coordinator.includes("private findGpuSlice"),
    "la telemetria lunga deve usare lookup GPU O(1), non riscansioni del journal",
  );

  assert(idb.includes('const MANIFEST_STORE = "manifestHeads"'));
  assert(idb.includes('const CHUNK_STORE = "idbChunks"'));
  assert(idb.includes("expectedManifestGeneration"));
  assert(idb.includes('durability: "strict"'));
  assert(idb.includes("[SESSION_STORE, MANIFEST_STORE, SEGMENT_STORE]"));
  assert(idb.includes("sessionStore.put({ ...session, opfsMayExist: true })"));
  assert(idb.includes("async removeSegmentCAS(options:"));
  assert(idb.includes("lockProtected: record.lockProtected ?? false"));
  assert(idb.includes("index.openKeyCursor(range)"));
  assert(idb.includes("store.delete(cursor.primaryKey)"));
  assert(!idb.includes("cursor.delete()"));
  assert(idb.includes("Older Safari versions reject the optional third argument"));
  assert(opfs.includes("createSyncAccessHandle"));
  assert(opfs.includes("HISTORY_LOCAL_STORAGE_COMMIT_MAGIC"));
  assert(opfs.includes("writeAll("), "le write parziali OPFS devono avanzare in ciclo");
  assert(opfs.includes("let access: SyncAccessHandle | null = null;"));
  assert(opfs.includes("if (!isNotFound(error)) throw error;"));
  assert(opfsClient.includes("error.name = response.name;"));
  const requireOpfs = coordinator.slice(
    coordinator.indexOf("private async requireOpfs"),
    coordinator.indexOf("private captureToken"),
  );
  assert.doesNotMatch(
    requireOpfs,
    /selfTest\(/,
    "lettura e cleanup OPFS non devono dipendere da una prova di scrittura",
  );
  const deleteSession = coordinator.slice(
    coordinator.indexOf("private async deleteSessionBestEffort"),
    coordinator.lastIndexOf("\n}"),
  );
  assert.doesNotMatch(deleteSession, /selfTest\(/);
  assert(coordinator.includes("cleanupOpfsGarbageCandidates"));
  assert(coordinator.includes("candidate.leaseExpiresAt <= now"));
  assert(coordinator.includes("candidate.lockProtected"));
  assert(coordinator.includes("markSessionLockProtected"));
  assert(coordinator.includes('this.backend = "indexeddb-chunks"'));
  assert(coordinator.includes('this.backend = "memory-only"'));
}

console.log("Session-local History storage protocol verified.");
