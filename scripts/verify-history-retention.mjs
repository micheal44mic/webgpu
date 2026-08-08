import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL,
  HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES,
  HISTORY_DESKTOP_CHECKPOINT_ALLOWANCE,
  HISTORY_DESKTOP_MAXIMUM_BYTES,
  HISTORY_MAXIMUM_UNDO_DEPTH,
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
  planHistoryDepthEviction,
  planHistorySpill,
  processHistoryMaintenanceChunks,
  selectCheckpointRepresentation,
} from "../src/history-retention-core.ts";

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

// --- Tetto di profondita' ----------------------------------------------------
assert.equal(HISTORY_MAXIMUM_UNDO_DEPTH, 100);

for (const [cursor, floorCursor] of [[0, 0], [50, 0], [100, 0], [250, 150], [1000, 900]]) {
  assert.deepEqual(
    planHistoryDepthEviction({ cursor, floorCursor }),
    { required: false, newestRetainedActionIndex: null },
    `il tetto di profondita' non deve scattare entro ${HISTORY_MAXIMUM_UNDO_DEPTH} passi`,
  );
}

for (const [cursor, floorCursor] of [[101, 0], [223, 0], [1000, 0], [1000, 500]]) {
  const plan = planHistoryDepthEviction({ cursor, floorCursor });
  assert.equal(plan.required, true, `il tetto deve scattare oltre i passi promessi (${cursor})`);
  // L'eviction porta il pavimento a `indice + 1`: la profondita' residua deve
  // essere esattamente il tetto, mai meno. Se questa relazione si rompe il
  // tetto diventa una riduzione della profondita' invece di un limite.
  const residualDepth = cursor - (plan.newestRetainedActionIndex + 1);
  assert.equal(
    residualDepth,
    HISTORY_MAXIMUM_UNDO_DEPTH,
    `il tetto di profondita' non deve tagliare sotto ${HISTORY_MAXIMUM_UNDO_DEPTH} passi`,
  );
  assert.ok(
    plan.newestRetainedActionIndex >= 0,
    "il boundary del tetto deve restare un indice azione valido",
  );
}

const customDepth = planHistoryDepthEviction({ cursor: 40, floorCursor: 0, maximumDepth: 10 });
assert.equal(customDepth.required, true);
assert.equal(40 - (customDepth.newestRetainedActionIndex + 1), 10);

// --- La classe dispositivo non va risonata dal viewport -----------------------
// Il difetto misurato il 06/08/2026: con `matchMedia("(max-width: 700px)")` lo
// stesso telefono passava da 192 a 512 MiB ruotando in landscape (`844 px`).
const maintenanceSource = readFileSync(
  new URL("../src/history-maintenance-runtime.ts", import.meta.url),
  "utf8",
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
// Scoped e ancorata a inizio riga: una versione commentata della chiamata non
// deve poter soddisfare l'asserzione.
const enforceBudgetStart = maintenanceSource.indexOf("function enforceHistoryBudget");
const enforceBudgetEnd = maintenanceSource.indexOf("export function historyFloorCursor");
assert.ok(
  enforceBudgetStart >= 0 && enforceBudgetEnd > enforceBudgetStart,
  "marcatori di enforceHistoryBudget assenti",
);
const enforceBudgetBody = maintenanceSource.slice(enforceBudgetStart, enforceBudgetEnd);
assert.match(
  enforceBudgetBody,
  /^ {2}enforceHistoryDepthCap\(engine\);$/m,
  "il tetto di profondita' deve essere applicato da enforceHistoryBudget",
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

// I due contatori devono restare distinti: se l'incremento vivesse dentro
// l'eviction condivisa, un taglio dovuto al tetto di profondita' verrebbe
// riportato come pressione di memoria e la telemetria mentirebbe.
const evictStart = maintenanceSource.indexOf("function evictHistoryBelowBaselines");
const evictEnd = maintenanceSource.indexOf("function enforceHistoryDepthCap");
assert.ok(evictStart >= 0 && evictEnd > evictStart, "marcatori di evictHistoryBelowBaselines assenti");
assert.doesNotMatch(
  maintenanceSource.slice(evictStart, evictEnd),
  /state\.(budgetEvictions|depthEvictions) \+= 1/,
  "l'eviction condivisa non deve attribuirsi la causa: la contano i due gate",
);
const depthCapBody = maintenanceSource.slice(
  evictEnd,
  maintenanceSource.indexOf("function enforceHistoryBudget"),
);
assert.match(
  depthCapBody,
  /state\.depthEvictions \+= 1/,
  "il gate del tetto deve contare le proprie eviction",
);
assert.doesNotMatch(
  depthCapBody,
  /state\.budgetEvictions \+= 1/,
  "il tetto di profondita' non deve essere riportato come pressione di memoria",
);
assert.match(
  depthCapBody,
  /latestFullCheckpointByLayer\(engine, plan\.newestRetainedActionIndex\)/,
  "il tetto deve limitare il boundary ai passi promessi",
);

// Il tetto libera soltanto fino a un checkpoint full. Se la cattura non ne
// forzasse uno quando il tetto e' gia' superato, il gate resterebbe inerte:
// misurato, senza questo la profondita' restava a 196 passi invece di ~100.
const captureStart = maintenanceSource.indexOf("async function capturePeriodicCheckpoint");
const captureEnd = maintenanceSource.indexOf("export function discardStalePeriodicCheckpoints");
assert.ok(captureStart >= 0 && captureEnd > captureStart, "marcatori di capturePeriodicCheckpoint assenti");
const captureBody = maintenanceSource.slice(captureStart, captureEnd);
assert.match(
  captureBody,
  /const depthCapNeedsBoundary = planHistoryDepthEviction\(\{/,
  "la cattura deve sapere se il tetto di profondita' attende un boundary",
);
// Il boundary del tetto di profondita' e' ora una condizione di `fullRequired`,
// non di `forceFull`: e' la distinzione che permette al full **periodico** di
// ripiegare su un delta quando non c'e' spazio, senza che quello obbligatorio
// possa fare altrettanto. Un delta non puo' sostituire un boundary: il tetto
// libera solo fino a un full, e sopra un delta l'eviction resterebbe inerte.
assert.match(
  captureBody,
  /^ {4}\|\| depthCapNeedsBoundary;$/m,
  "il boundary del tetto di profondita' deve rendere il full obbligatorio",
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
  assert(runtime.includes("latestFullCheckpointByLayer(engine)"));
  assert(runtime.includes("state.floorCursor = candidateFloor"));
  assert(runtime.includes("historyMemoryTotalBytes(ledger) <= budget.hardBytes"));
  assert(runtime.includes("!engine.activeRasterLayerMetadataHistoryEdit"));
  assert(runtime.includes("!engine.activeRasterTransformSession"));
  assert(runtime.includes("accountSelectionSnapshot(state, action.selectionBefore)"));
  assert(runtime.includes("accountSelectionSnapshot(state, action.selectionAfter)"));
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
  assert(main.includes("engine.interruptHistoryMaintenance()"));
  assert(main.includes("engine.resumeDiscardedHistoryMaintenance()"));
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
    "i boundary richiesti dal tetto di profondita' non sono facoltativi",
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
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const operazione = main.slice(
    main.indexOf("async function runHistoryOperation("),
    main.indexOf("async function clearLayerWithHistory("),
  );
  assert(
    operazione.includes("ultimoGuastoCronologia = {"),
    "runHistoryOperation deve registrare il guasto, non solo mostrarlo",
  );
  for (const campo of ["operazione: operation", "azione:", "cursore,", "messaggio,"]) {
    assert(
      operazione.includes(campo),
      `il guasto registrato deve riportare ${campo}`,
    );
  }
  const diagnostica = main.slice(
    main.indexOf("function updateHistoryDiagnostics(): void"),
    main.indexOf("function updateGpuMemoryAudit("),
  );
  assert(
    diagnostica.includes("ULTIMO GUASTO"),
    "il pannello deve mostrare l'ultimo guasto di cronologia",
  );
  assert(
    diagnostica.includes("ultimoGuastoCronologia.messaggio"),
    "il pannello deve riportare il messaggio originale, non solo che c'e' stato un guasto",
  );
}

console.log("History failure surfacing verified.");
