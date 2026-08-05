import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL,
  HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES,
  HISTORY_RETENTION_STRATEGY,
  createHistoryBudget,
  emptyHistoryMemoryLedger,
  historyBudgetPressure,
  historyMemoryTotalBytes,
  nearestHistoryCheckpoint,
  nextHistoryCompactionChunk,
  planHistoryBudgetEviction,
  planHistoryCheckpoint,
  processHistoryMaintenanceChunks,
} from "../src/history-retention-core.ts";

assert.equal(
  HISTORY_RETENTION_STRATEGY,
  "byte-budget-exact-tiled-checkpoints-idle-fenced-chunked-v1",
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
    /device\.queue\.onSubmittedWorkDone\(\)[\s\S]*?await engine\.waitForIdle\(\)[\s\S]*?await engine\.compactDiscardedHistoryIncrementally\([\s\S]*?capturePeriodicCheckpoint\(engine\)/,
  );
  assert(runtime.includes("latestFullCheckpointByLayer(engine)"));
  assert(runtime.includes("state.floorCursor = candidateFloor"));
  assert(runtime.includes("historyMemoryTotalBytes(ledger) <= budget.hardBytes"));
  assert(runtime.includes("!engine.activeRasterLayerMetadataHistoryEdit"));
  assert(runtime.includes("!engine.activeRasterTransformSession"));
  assert(runtime.includes("addSelectionSnapshot(action.selectionBefore)"));
  assert(runtime.includes("addSelectionSnapshot(action.selectionAfter)"));
  assert(runtime.includes("ledger.gpuReservedBytes = gpuStorage.usedReservedBytes"));
  assert(runtime.includes("ledger.gpuAllocatedBytes = gpuStorage.allocatedBytes"));
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
