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
  createHistoryBudget,
  emptyHistoryMemoryLedger,
  historyBaseBudgetBytes,
  historyBudgetPressure,
  historyMemoryTotalBytes,
  nearestHistoryCheckpoint,
  nextHistoryCompactionChunk,
  planHistoryBudgetEviction,
  planHistoryCheckpoint,
  planHistoryDepthEviction,
  processHistoryMaintenanceChunks,
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

// Il telefono deve stare sotto il tetto assoluto in entrambi i formati alla
// taglia che usa davvero (2048²): e' il punto dell'intera modifica. Prima erano
// 192 MiB fissi, indipendenti da documento e formato.
for (const format of ["rgba8unorm", "rgba16float"]) {
  assert.ok(
    historyBaseBudgetBytes({ checkpointBytes: checkpointBytesFor(2048, format), mobile: true })
      <= 96 * MiB,
    `il budget mobile deve restare entro 96 MiB a ${format}`,
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
assert.match(
  captureBody,
  /^ {4}\|\| depthCapNeedsBoundary$/m,
  "il checkpoint deve essere full quando il tetto di profondita' attende un boundary",
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
  assert(runtime.includes("appendOnlySince("));
  assert(runtime.includes("accountingIncrementalActions"));
  assert(runtime.includes("baseBytes - effectsBytes"));
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
