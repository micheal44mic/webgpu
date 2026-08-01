import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";
import {
  HISTORY_JOURNAL_STRATEGY,
  firstVisibleActionIndex,
  hasVisibleContent,
  historyStepTargetsMissingLayer,
  latestLayerReplayCheckpoint,
  layersWithVisibleContent,
  selectLayerReplay,
  selectLayerReplayAfterCheckpoint,
  selectBatchesForLayer,
  visibleRasterBatchActionIdsAfterCheckpoint,
  visibleStrokeIds,
} from "../src/history-journal.ts";

assert.equal(HISTORY_JOURNAL_STRATEGY, "global-order-per-layer-clear-barrier-raster-checkpoints-v5");

const stroke = (id, layerId) => ({ id, kind: "stroke", layerId });
const fill = (id, layerId) => ({ id, kind: "fill", layerId });
const clear = (id, layerId) => ({ id, kind: "clear", layerId });
const vector = (id) => ({ id, kind: "vector" });
const vectorRasterize = (id, layerId) => ({ id, kind: "vector-rasterize", layerId });
const rasterImport = (id, layerId) => ({ id, kind: "raster-import", layerId });
const rasterTransform = (id, layerId, hasContent = true) => ({
  id,
  kind: "raster-transform",
  layerId,
  baseBounds: hasContent ? { x: 0, y: 0, width: 1, height: 1 } : null,
});

// With one layer the module must reproduce the engine's current behaviour
// exactly: scan back to the most recent clear, everything after it is visible.
{
  const actions = [stroke(1, 1), stroke(2, 1), clear(3, 1), stroke(4, 1)];
  assert.equal(firstVisibleActionIndex(actions, 4), 3);
  assert.deepEqual([...visibleStrokeIds(actions, 4)], [4]);
  // Undoing past the clear brings the earlier strokes back.
  assert.equal(firstVisibleActionIndex(actions, 2), 0);
  assert.deepEqual([...visibleStrokeIds(actions, 2)], [1, 2]);
  assert.equal(hasVisibleContent(actions, 0), false);
}

// Raster transforms are post-action checkpoints, not overlay nodes. A later
// brush batch replays after the checkpoint; Undoing the transform exposes the
// earlier stroke again without replaying it on top of the transformed seed.
{
  const actions = [
    stroke(1, 1),
    rasterTransform(2, 1),
    stroke(3, 2),
    fill(4, 1),
  ];
  const checkpoint = latestLayerReplayCheckpoint(actions, 4, 1);
  assert.equal(checkpoint?.action.id, 2);
  assert.equal(checkpoint?.actionIndex, 1);
  assert.deepEqual(
    [...visibleRasterBatchActionIdsAfterCheckpoint(actions, 4, 1)],
    [4],
  );
  const batches = [
    { actionId: 1, layerId: 1, value: "before" },
    { actionId: 3, layerId: 2, value: "foreign" },
    { actionId: 4, layerId: 1, value: "after" },
  ];
  const replay = selectLayerReplayAfterCheckpoint(actions, 4, batches, 1);
  assert.equal(replay.checkpoint?.action.id, 2);
  assert.equal(replay.firstReplayActionIndex, 2);
  assert.deepEqual(replay.batches.map((batch) => batch.value), ["after"]);
  assert.deepEqual([...replay.visibleStrokeIds], [4]);

  const beforeTransform = selectLayerReplayAfterCheckpoint(actions, 1, batches, 1);
  assert.equal(beforeTransform.checkpoint, null);
  assert.deepEqual(beforeTransform.batches.map((batch) => batch.value), ["before"]);
}

// Only a checkpoint after the latest per-layer Clear can seed replay. A
// checkpoint belonging to another interleaved layer is never considered.
{
  const actions = [
    rasterImport(1, 1),
    rasterTransform(2, 2),
    clear(3, 1),
    stroke(4, 1),
    rasterTransform(5, 1),
  ];
  assert.equal(latestLayerReplayCheckpoint(actions, 2, 1)?.action.id, 1);
  assert.equal(latestLayerReplayCheckpoint(actions, 4, 1), null);
  assert.equal(latestLayerReplayCheckpoint(actions, 5, 1)?.action.id, 5);
}

// A transform may legitimately produce an empty raster. It remains an action
// and a replay checkpoint, but the content reducer must report the layer empty
// until a later Paint/Fill action adds pixels again.
{
  const actions = [stroke(1, 7), rasterTransform(2, 7, false), stroke(3, 8)];
  assert.equal(hasVisibleContent(actions, 2, 7), false);
  assert.equal(hasVisibleContent(actions, 3, 8), true);
  assert.equal(hasVisibleContent(actions, 3), true);
  assert.deepEqual([...layersWithVisibleContent(actions, 3)], [8]);
  assert.equal(latestLayerReplayCheckpoint(actions, 2, 7)?.action.id, 2);
  assert.equal(hasVisibleContent([...actions, stroke(4, 7)], 4, 7), true);
}

// Fill is raster content in the same ordered journal, but keeps its own GPU
// bitmask payload instead of pretending to be a brush stroke.
{
  const actions = [stroke(1, 1), fill(2, 1), fill(3, 2), clear(4, 1)];
  assert.deepEqual([...visibleStrokeIds(actions, 3, 1)], [1, 2]);
  assert.deepEqual([...visibleStrokeIds(actions, 3, 2)], [3]);
  assert.deepEqual([...visibleStrokeIds(actions, 4, 1)], []);
  assert.deepEqual([...layersWithVisibleContent(actions, 3)].sort(), [1, 2]);
  assert.equal(hasVisibleContent(actions, 3, 2), true);
}

// THE behavioural change: clearing layer B must not hide layer A's strokes.
// Today a clear is a document-wide barrier, which with layers would silently
// erase another layer's history from view.
{
  const actions = [stroke(1, 1), stroke(2, 2), clear(3, 2), stroke(4, 2)];
  assert.deepEqual(
    [...visibleStrokeIds(actions, 4, 1)],
    [1],
    "pulire il livello 2 non deve nascondere i tratti del livello 1",
  );
  assert.deepEqual([...visibleStrokeIds(actions, 4, 2)], [4]);
  assert.equal(hasVisibleContent(actions, 4, 1), true);
  assert.equal(hasVisibleContent(actions, 4, 2), true);
  // A clear on another layer is not a barrier for this one.
  assert.equal(firstVisibleActionIndex(actions, 4, 1), 0);
  assert.equal(firstVisibleActionIndex(actions, 4, 2), 3);
}

// Only the queried layer's strokes are collected, even without any clear.
{
  const actions = [stroke(1, 1), stroke(2, 2), stroke(3, 1), stroke(4, 3)];
  assert.deepEqual([...visibleStrokeIds(actions, 4, 1)], [1, 3]);
  assert.deepEqual([...visibleStrokeIds(actions, 4, 2)], [2]);
  assert.deepEqual([...visibleStrokeIds(actions, 4, 9)], []);
  // Omitting the layer keeps the document-wide question answerable.
  assert.deepEqual([...visibleStrokeIds(actions, 4)], [1, 2, 3, 4]);
}

// The cursor is clamped rather than trusted: an out-of-range cursor during a
// failed replay must not read past the array.
{
  const actions = [stroke(1, 1)];
  assert.deepEqual([...visibleStrokeIds(actions, 99)], [1]);
  assert.deepEqual([...visibleStrokeIds(actions, -5)], []);
  assert.equal(firstVisibleActionIndex(actions, 99), 0);
}

// Batch selection preserves the GLOBAL order: two strokes on one layer must be
// replayed in the order the user made them, and ids are monotonic across layers.
{
  const batches = [
    { actionId: 1, layerId: 1 },
    { actionId: 2, layerId: 2 },
    { actionId: 3, layerId: 1 },
    { actionId: 4, layerId: 2 },
    { actionId: 5, layerId: 1 },
  ];
  assert.deepEqual(
    selectBatchesForLayer(batches, 1).map((b) => b.actionId),
    [1, 3, 5],
  );
  assert.deepEqual(
    selectBatchesForLayer(batches, 2).map((b) => b.actionId),
    [2, 4],
  );
  assert.deepEqual(selectBatchesForLayer(batches, 7), []);
  // Same objects, not copies: replay must not lose per-batch payload.
  assert.equal(selectBatchesForLayer(batches, 1)[0], batches[0]);
}

// The engine uses this combined selector directly. Test it as replay behaviour,
// not as two regexes: the untouched texture is compared byte-for-byte while the
// active target is rebuilt from interleaved global history.
{
  const actions = [stroke(1, 1), stroke(2, 2)];
  const batches = [
    { actionId: 1, layerId: 1, pixel: 1, value: 41 },
    { actionId: 2, layerId: 2, pixel: 6, value: 92 },
  ];
  const layerOne = Uint8Array.from([0, 41, 0, 0, 0, 0, 0, 0]);
  const layerOneBefore = layerOne.slice();
  const layerTwo = new Uint8Array(8);

  const replay = (target, cursor, layerId, sourceBatches = batches) => {
    target.fill(0);
    const selection = selectLayerReplay(actions, cursor, sourceBatches, layerId);
    for (const batch of selection.batches) {
      if (selection.visibleStrokeIds.has(batch.actionId)) {
        target[batch.pixel] = batch.value;
      }
    }
  };

  replay(layerTwo, 2, 2);
  assert.deepEqual([...layerTwo], [0, 0, 0, 0, 0, 0, 92, 0]);
  replay(layerTwo, 1, 2);
  assert.deepEqual([...layerTwo], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(layerOne, layerOneBefore, "il livello non ricostruito deve essere byte-identico");

  // Each half is independently load-bearing under inconsistent metadata. If
  // the batch filter is removed, id 2 (tagged layer 1) leaks into layer 2. If
  // the visible-id filter becomes document-wide, id 1 (tagged layer 2) leaks.
  const adversarial = [
    { actionId: 1, layerId: 2, pixel: 1, value: 41 },
    { actionId: 2, layerId: 1, pixel: 6, value: 92 },
  ];
  replay(layerTwo, 2, 2, adversarial);
  assert.deepEqual(
    [...layerTwo],
    [0, 0, 0, 0, 0, 0, 0, 0],
    "entrambi i filtri devono respingere metadati azione/batch incoerenti",
  );
}

// Crossing into another LIVE layer is allowed — the active layer moves with the
// cursor. Only an action whose layer is gone is refused: there is no texture to
// rebuild, so applying it anywhere would be applying it to the wrong layer.
{
  const actions = [stroke(1, 1), stroke(2, 2), stroke(3, 1)];
  const bothAlive = new Set([1, 2]);
  assert.equal(historyStepTargetsMissingLayer(actions, 3, -1, bothAlive), false);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, -1, bothAlive), false,
    "un passo su un altro livello VIVO non va rifiutato");
  const onlyOne = new Set([1]);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, -1, onlyOne), true,
    "un passo su un livello eliminato va rifiutato");
  assert.equal(historyStepTargetsMissingLayer(actions, 1, 1, onlyOne), true);
  // Nothing to cross at either end.
  assert.equal(historyStepTargetsMissingLayer(actions, 0, -1, onlyOne), false);
  assert.equal(historyStepTargetsMissingLayer(actions, actions.length, 1, onlyOne), false);
}

// layersWithVisibleContent answers "which layers still show something", which
// is what clear() needs before deciding to reset the whole journal.
{
  const actions = [stroke(1, 1), stroke(2, 2), clear(3, 2)];
  assert.deepEqual([...layersWithVisibleContent(actions, 3)], [1]);
  assert.deepEqual([...layersWithVisibleContent(actions, 2)].sort(), [1, 2]);
  assert.deepEqual([...layersWithVisibleContent(actions, 0)], []);
}

// Rasterizing a semantic vector seeds raster content without inventing a stroke batch.
// A later clear hides the seed, while undoing that clear reveals it again.
{
  const actions = [vectorRasterize(1, 7), stroke(2, 7), clear(3, 7)];
  assert.equal(hasVisibleContent(actions, 1, 7), true);
  assert.deepEqual([...visibleStrokeIds(actions, 1, 7)], []);
  assert.deepEqual([...layersWithVisibleContent(actions, 1)], [7]);
  assert.equal(hasVisibleContent(actions, 3, 7), false);
  assert.equal(hasVisibleContent(actions, 2, 7), true);
  assert.deepEqual([...visibleStrokeIds(actions, 2, 7)], [2]);
}

// Structural Undo needs the generated raster to be live so it can replace it
// with the original vector. Structural Redo is the inverse and requires it absent.
{
  const actions = [vectorRasterize(1, 9)];
  assert.equal(
    historyStepTargetsMissingLayer(actions, 1, -1, new Set([9])),
    false,
  );
  assert.equal(
    historyStepTargetsMissingLayer(actions, 1, -1, new Set()),
    true,
  );
  assert.equal(
    historyStepTargetsMissingLayer(actions, 0, 1, new Set()),
    false,
  );
  assert.equal(
    historyStepTargetsMissingLayer(actions, 0, 1, new Set([9])),
    true,
  );
}

// Import is structural too: Undo requires the generated raster to be live,
// while Redo requires it absent. Transform is non-structural and always targets
// an existing raster layer in either direction.
{
  const imported = [rasterImport(1, 12)];
  assert.equal(historyStepTargetsMissingLayer(imported, 1, -1, new Set([12])), false);
  assert.equal(historyStepTargetsMissingLayer(imported, 1, -1, new Set()), true);
  assert.equal(historyStepTargetsMissingLayer(imported, 0, 1, new Set()), false);
  assert.equal(historyStepTargetsMissingLayer(imported, 0, 1, new Set([12])), true);

  const transformed = [rasterTransform(1, 12)];
  assert.equal(historyStepTargetsMissingLayer(transformed, 1, -1, new Set([12])), false);
  assert.equal(historyStepTargetsMissingLayer(transformed, 0, 1, new Set([12])), false);
  assert.equal(historyStepTargetsMissingLayer(transformed, 1, -1, new Set()), true);
}


// Vector entries share the global order but never become raster content,
// clear barriers or missing-layer failures.
{
  const actions = [
    stroke(1, 1),
    vector(2),
    stroke(3, 2),
    vector(4),
    clear(5, 2),
  ];
  assert.deepEqual([...visibleStrokeIds(actions, 4)], [1, 3]);
  assert.deepEqual([...visibleStrokeIds(actions, 5, 1)], [1]);
  assert.deepEqual([...visibleStrokeIds(actions, 5, 2)], []);
  assert.deepEqual([...layersWithVisibleContent(actions, 4)].sort(), [1, 2]);
  assert.equal(
    historyStepTargetsMissingLayer(actions, 2, -1, new Set([1])),
    false,
    "un'azione vettoriale non deve richiedere un layer raster",
  );
  assert.equal(
    historyStepTargetsMissingLayer(actions, 1, 1, new Set([1])),
    false,
    "anche il Redo vettoriale deve ignorare la vita dei layer raster",
  );
}


// La cronologia raster autorevole deve vivere in buffer GPU paginati: sul CPU
// restano soltanto metadati piccoli per l'ordine globale e il replay.
{
  globalThis.GPUBufferUsage ??= { COPY_SRC: 1, COPY_DST: 2 };
  const { GPU_HISTORY_PAGE_BYTES, GpuHistoryStorage } = await import(
    "../src/gpu-history-storage.ts"
  );
  const buffers = [];
  const device = {
    createBuffer(descriptor) {
      const buffer = {
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
  };
  const storage = new GpuHistoryStorage(device);
  storage.prewarm();
  assert.deepEqual(storage.stats(), {
    allocatedBytes: GPU_HISTORY_PAGE_BYTES,
    usedLogicalBytes: 0,
    usedReservedBytes: 0,
    freeBytes: GPU_HISTORY_PAGE_BYTES,
    pageCount: 1,
    sliceCount: 0,
  });
  const first = storage.allocate(32, "paint");
  storage.trimEmptyPages(true);
  assert.equal(
    storage.stats().pageCount,
    1,
    "una pagina standard viva è già la pagina calda e non va duplicata",
  );
  const second = storage.allocate(GPU_HISTORY_PAGE_BYTES, "second-page");
  assert.equal(storage.stats().allocatedBytes, GPU_HISTORY_PAGE_BYTES * 2);
  assert.equal(storage.stats().usedLogicalBytes, GPU_HISTORY_PAGE_BYTES + 32);
  assert.equal(storage.releaseMany([first, second, first]), 2);
  assert.equal(storage.release(first), false, "una slice non può essere liberata due volte");
  assert.equal(storage.release(second), false, "releaseMany deve liberare entrambe le pagine");
  storage.trimEmptyPages(true);
  assert.equal(storage.stats().allocatedBytes, GPU_HISTORY_PAGE_BYTES);
  assert.equal(storage.stats().pageCount, 1);
  assert.equal(buffers.filter((buffer) => buffer.destroyed).length, 1);
  const aligned = storage.allocate(5, "alignment");
  assert.equal(aligned.logicalBytes, 5);
  assert.equal(aligned.reservedBytes, 8);
  storage.destroy();
  assert.equal(buffers.every((buffer) => buffer.destroyed), true);

  const oversizedStorage = new GpuHistoryStorage(device);
  oversizedStorage.prewarm();
  oversizedStorage.trimEmptyPages(false);
  const oversized = oversizedStorage.allocate(
    GPU_HISTORY_PAGE_BYTES + 4,
    "oversized-live-page",
  );
  oversizedStorage.trimEmptyPages(true);
  assert.equal(
    oversizedStorage.stats().pageCount,
    2,
    "una slice oversized viva deve avere comunque una pagina standard calda",
  );
  assert.equal(oversizedStorage.release(oversized), true);
  oversizedStorage.destroy();
}

{
  const engine = readEngineSource();
  const blendRenderer = readFileSync(
    new URL("../src/blend-renderer.ts", import.meta.url),
    "utf8",
  );
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const paintBatch = engine.slice(
    engine.indexOf("interface PaintHistoryRenderBatch"),
    engine.indexOf("interface BlendHistoryRenderBatch"),
  );
  assert(!paintBatch.includes("stamps:"), "La storia Paint non deve trattenere array Stamp CPU.");
  assert(paintBatch.includes("gpuSlice: GpuHistorySlice"));
  assert(paintBatch.includes("stampCount: number"));
  assert(engine.includes('"gpu-only-packed-payload-no-cpu-stamp-arrays"'));
  assert(engine.includes('"clear-and-gpu-buffer-copy-replay"'));
  assert(engine.includes("replayBatch.gpuSlice.buffer"));
  assert(engine.includes("this.instanceBuffer,"));
  assert(engine.includes("slice.buffer,"));
  assert(
    engine.includes(
      "GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST",
    ),
    "Il buffer stamp deve poter essere copiato nella cronologia GPU.",
  );
  assert(engine.includes("historyGpuMiB,"));
  assert(engine.includes("historyGpuUsedMiB,"));
  assert(engine.includes("historyGpuPageCount: historyGpu.pageCount"));
  assert(engine.includes("engine.historyGpuStorage.releaseMany(discardedSlices)"));
  assert(engine.includes("lastVisiblePaintBatchIndexByAction"));
  assert(
    engine.indexOf("historyGpuMiB,", engine.indexOf("const countedTotalMiB")) >= 0,
    "Le pagine GPU della cronologia devono essere incluse nel totale.",
  );
  const blendGeometry = blendRenderer.slice(
    blendRenderer.indexOf("export interface DryBlendHistoryGeometry"),
    blendRenderer.indexOf("export interface DryBlendGpuCopyRegion"),
  );
  assert(!blendGeometry.includes("steps:"), "La storia Blend non deve trattenere step CPU.");
  assert(blendRenderer.includes("historyTransfer.replay.buffer"));
  assert(blendRenderer.includes("historyTransfer.capture.buffer"));
  assert(main.includes('["gpuMemoryHistory", "historyGpuMiB"]'));
  assert(!engine.includes("runHistoryCapturePerformanceProbe"));
  assert(!main.includes("runHistoryPerformanceProbeDev"));
  assert(main.includes("history GPU"));
  assert(!main.includes("history CPU"));
  assert(main.includes("historyGpuUsedMiB"));
  assert(html.includes('id="gpuMemoryHistoryLabel"'));
  assert(html.includes("La cronologia raster mostra pagine GPU riservate"));

  const moveCursor = engine.slice(
    engine.indexOf("export async function moveHistoryCursor"),
    engine.indexOf("export async function rebuildActiveLayerFromHistory"),
  );
  assert.match(engine, /publishStatus\(message: string, kind:[\s\S]{0,220}catch \(error\)/);
  assert.doesNotMatch(
    moveCursor,
    /callbacks\.onStatus/,
    "gli observer UI non devono lasciare historyBusy bloccato prima del finally",
  );
  assert.match(
    moveCursor,
    /await rebuildActiveLayerFromHistory\(engine\);[\s\S]{0,4200}publishRasterSceneAfterUnlock = true;[\s\S]{0,2500}engine\.historyBusy = engine\.historyStateInconsistent;[\s\S]{0,250}publishMixedScene\(engine\);[\s\S]{0,120}engine\.publishStats\(\);/,
    "il replay raster deve aggiornare la bbox dell'overlay dopo Undo/Redo",
  );
  const addLayer = engine.slice(
    engine.indexOf("  async addLayer("),
    engine.indexOf("  async setActiveLayer("),
  );
  assert.match(
    addLayer,
    /const result = await this\.activateLayer\(fromIndex\);[\s\S]{0,300}truncateRedoHistory\(this\);/,
    "un nuovo livello non journalled deve invalidare gli indici strutturali del Redo",
  );

  const rasterReplay = engine.slice(
    engine.indexOf("export async function rebuildActiveLayerFromHistory"),
    engine.indexOf("export async function applyVectorHistoryState"),
  );
  const seedBranchStart = rasterReplay.indexOf("if (seedAction) {");
  const seedClear = rasterReplay.indexOf(
    "engine.submitImmediate(\n        [],\n        true,\n        engine.settings,\n        false,\n        null,",
    seedBranchStart,
  );
  const seedHydration = rasterReplay.indexOf(
    "encodeLayerColdHydration(encoder, seedAction.seed, hot);",
    seedClear,
  );
  const seedOnlyPresentation = rasterReplay.indexOf(
    "if (lastVisibleBatchIndex < 0) {",
    seedHydration,
  );
  const seedOnlyDirtyBounds = rasterReplay.indexOf(
    "seedAction.baseBounds,\n          true,",
    seedOnlyPresentation,
  );
  assert(
    seedBranchStart >= 0
      && seedClear > seedBranchStart
      && seedHydration > seedClear
      && seedOnlyPresentation > seedHydration
      && seedOnlyDirtyBounds > seedOnlyPresentation,
    "Undo Fill sul raster vettoriale deve fare clear nascosto, hydration e una sola presentazione del seed",
  );
  assert.doesNotMatch(
    rasterReplay.slice(seedBranchStart, seedHydration),
    /lastVisibleBatchIndex < 0/,
    "il clear precedente al seed non deve mai diventare la presentazione finale",
  );

  const vectorMutation = engine.slice(
    engine.indexOf("export async function mutateMixedScenePresentation"),
    engine.indexOf("export function ensureVectorTextGpuBlurCache"),
  );
  const vectorHistoryApply = engine.slice(
    engine.indexOf("export async function applyVectorHistoryState"),
    engine.indexOf("export function recordBlendHistoryBatch"),
  );
  const layerActivation = engine.slice(
    engine.indexOf("  async activateLayer("),
    engine.indexOf("  destroyThicknessTailOverlayResources(): void"),
  );
  for (const [label, source] of [
    ["mutazione vettoriale", vectorMutation],
    ["Undo/Redo vettoriale", vectorHistoryApply],
  ]) {
    assert(source.includes("clearVectorTextPresentationForTransaction(engine)"),
      `${label}: il clear deve restare transazionale`);
    assert(source.includes("reuseUnchangedRasterRuns: true"),
      `${label}: i raster-run invariati devono restare residenti`);
    assert(!/(this|engine)\.clearVectorTextPresentation\(\);/.test(source),
      `${label}: un clear normale riaprirebbe il ciclo freeze/waitForIdle`);
  }
  assert.match(
    layerActivation,
    /caller === "history-replay"[\s\S]*?clearVectorTextPresentationForTransaction\(this\)/,
    "il cambio layer attraversato dalla cronologia non deve invalidare mentre è congelato",
  );
}

console.log("History journal and GPU payload verification passed.");
