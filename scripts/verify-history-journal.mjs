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

assert.equal(
  HISTORY_JOURNAL_STRATEGY,
  "global-order-per-layer-clear-barrier-raster-checkpoints-layer-metadata-scene-reorder-v9",
);

const stroke = (id, layerId) => ({ id, kind: "stroke", layerId });
const fill = (id, layerId) => ({ id, kind: "fill", layerId });
const clear = (id, layerId) => ({ id, kind: "clear", layerId });
const vector = (id) => ({ id, kind: "vector" });
const sceneReorder = (id) => ({ id, kind: "scene-reorder" });
const layerBlendMode = (id, layerId) => ({
  id,
  kind: "layer-blend-mode",
  layerId,
  before: "normal",
  after: "multiply",
});
const layerMetadata = (id, layerId) => ({ id, kind: "layer-metadata", layerId });
const vectorRasterize = (id, layerId) => ({ id, kind: "vector-rasterize", layerId });
const rasterImport = (id, layerId) => ({ id, kind: "raster-import", layerId });
const rasterTransform = (id, layerId, hasContent = true) => ({
  id,
  kind: "raster-transform",
  layerId,
  baseBounds: hasContent ? { x: 0, y: 0, width: 1, height: 1 } : null,
});
const rasterFilter = (id, layerId) => ({
  id,
  kind: "raster-filter",
  layerId,
  baseBounds: { x: 0, y: 0, width: 1, height: 1 },
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

// A destructive filter is also a post-action checkpoint. Undo reveals the
// earlier raster state; Redo hydrates exact committed pixels without running
// the shader again.
{
  const actions = [stroke(1, 3), rasterFilter(2, 3), fill(3, 3)];
  assert.equal(latestLayerReplayCheckpoint(actions, 3, 3)?.action.id, 2);
  assert.deepEqual(
    [...visibleRasterBatchActionIdsAfterCheckpoint(actions, 3, 3)],
    [3],
  );
  assert.equal(hasVisibleContent(actions, 2, 3), true);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, -1, new Set([3])), false);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, -1, new Set()), true);
}

// Scene ordering is reversible document metadata. Like vector metadata it
// neither creates raster content nor requires an owning raster layer.
{
  const onlyReorder = [sceneReorder(1)];
  assert.equal(hasVisibleContent(onlyReorder, 1), false);
  assert.deepEqual([...layersWithVisibleContent(onlyReorder, 1)], []);
  assert.deepEqual([...visibleStrokeIds(onlyReorder, 1)], []);
  assert.equal(
    historyStepTargetsMissingLayer(onlyReorder, 1, -1, new Set()),
    false,
  );

  const withPixels = [stroke(1, 7), sceneReorder(2)];
  assert.equal(hasVisibleContent(withPixels, 2, 7), true);
  assert.deepEqual([...visibleStrokeIds(withPixels, 2, 7)], [1]);
}

// Blend-mode metadata is reversible document state, never raster content and
// never a batch replay boundary. Crossing it still requires its live owner.
{
  const onlyMode = [layerBlendMode(1, 7)];
  assert.equal(hasVisibleContent(onlyMode, 1), false);
  assert.equal(hasVisibleContent(onlyMode, 1, 7), false);
  assert.deepEqual([...layersWithVisibleContent(onlyMode, 1)], []);
  assert.deepEqual([...visibleStrokeIds(onlyMode, 1, 7)], []);
  assert.equal(historyStepTargetsMissingLayer(onlyMode, 1, -1, new Set([7])), false);
  assert.equal(historyStepTargetsMissingLayer(onlyMode, 1, -1, new Set([8])), true);

  const withPixels = [stroke(1, 7), layerBlendMode(2, 7)];
  assert.equal(hasVisibleContent(withPixels, 2, 7), true);
  assert.deepEqual([...visibleStrokeIds(withPixels, 2, 7)], [1]);
}

// Presentation, clipping and effects are metadata too: they require a live
// owner but must never create pixels or alter raster replay selection.
{
  const onlyMetadata = [layerMetadata(1, 7)];
  assert.equal(hasVisibleContent(onlyMetadata, 1), false);
  assert.deepEqual([...layersWithVisibleContent(onlyMetadata, 1)], []);
  assert.deepEqual([...visibleStrokeIds(onlyMetadata, 1, 7)], []);
  assert.equal(historyStepTargetsMissingLayer(onlyMetadata, 1, -1, new Set([7])), false);
  assert.equal(historyStepTargetsMissingLayer(onlyMetadata, 1, -1, new Set()), true);
  const withPixels = [stroke(1, 7), layerMetadata(2, 7)];
  assert.deepEqual([...visibleStrokeIds(withPixels, 2, 7)], [1]);
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
  globalThis.GPUBufferUsage ??= { COPY_SRC: 1, COPY_DST: 2, STORAGE: 4 };
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
  const storageAligned = storage.allocate(12, "storage-alignment", 256);
  assert.equal(storageAligned.offsetBytes % 256, 0);
  const atomicFirst = storage.allocate(16, "atomic-first");
  const atomicLast = storage.allocate(16, "atomic-last");
  const allocatorBeforeInvalidRelease = storage.stats();
  assert.throws(
    () => storage.prepareReleaseMany([
      atomicFirst,
      { ...atomicLast, label: "foreign-copy" },
    ]),
    /non appartenente/,
    "una slice finale non valida deve impedire la release dell'intero set",
  );
  assert.deepEqual(
    storage.stats(),
    allocatorBeforeInvalidRelease,
    "prepareReleaseMany non deve liberare il prefisso prima di validare la coda",
  );
  assert.equal(storage.releaseMany([atomicFirst, atomicLast]), 2);

  const demoted = storage.allocate(20, "stored-only-handle");
  const preparedDemotion = storage.prepareDemoteMany([demoted]);
  assert.equal(preparedDemotion.sliceCount, 1);
  assert.equal(preparedDemotion.commitNoThrow(), 1);
  assert.equal(storage.isResident(demoted), false);
  assert.throws(
    () => demoted.buffer,
    /non reidratata/,
    "un replay senza preflight hydrate deve fallire prima di leggere un buffer morto",
  );
  assert.equal(storage.release(demoted), true, "un handle stored-only resta ritirabile");
  assert.throws(
    () => storage.allocate(4, "bad-alignment", 24),
    /potenza di due/,
  );
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
  const brushEngine = readFileSync(
    new URL("../src/brush-engine.ts", import.meta.url),
    "utf8",
  );
  const selectionRuntime = readFileSync(
    new URL("../src/engine-selection-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyRuntime = readFileSync(
    new URL("../src/engine-history-runtime.ts", import.meta.url),
    "utf8",
  );
  const transformRuntime = readFileSync(
    new URL("../src/engine-raster-transform-runtime.ts", import.meta.url),
    "utf8",
  );
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const effectsSheet = readFileSync(
    new URL("../src/mobile-raster-effects-sheet.ts", import.meta.url),
    "utf8",
  );
  const strokeSheet = readFileSync(
    new URL("../src/mobile-stroke-sheet.ts", import.meta.url),
    "utf8",
  );
  const toolSheet = readFileSync(
    new URL("../src/mobile-tool-settings-sheet.ts", import.meta.url),
    "utf8",
  );
  const paintBatch = engine.slice(
    engine.indexOf("interface PaintHistoryRenderBatch"),
    engine.indexOf("interface BlendHistoryRenderBatch"),
  );
  assert(!paintBatch.includes("stamps:"), "La storia Paint non deve trattenere array Stamp CPU.");
  assert(paintBatch.includes("gpuSlice: GpuHistorySlice"));
  assert(paintBatch.includes("stampCount: number"));
  assert(paintBatch.includes("selectionMask: SelectionHistoryMaskSnapshot | null"));
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
  assert(engine.includes("selectionRevisionsToRelease"));
  assert(engine.includes("releaseSlicePhase("));
  assert(engine.includes("selectionHistoryMasksByAction"));
  assert(engine.includes("selectionHistoryMasksByRevision"));
  assert(selectionRuntime.includes("identity: engine.pixelSelectionIdentity"));
  assert(selectionRuntime.includes("engine.selectionHistoryMasksByRevision.get(revision)"));
  assert(selectionRuntime.includes("engine.selectionHistoryMasksByRevision.set(revision, snapshot)"));
  const beginStroke = brushEngine.slice(
    brushEngine.indexOf("  beginStrokeAtLayer(point: LayerPoint): boolean"),
    brushEngine.indexOf("  extendStroke(samples: readonly PointerSample[]): void"),
  );
  assert(beginStroke.includes("return false;"));
  assert(beginStroke.includes("return true;"));
  assert(
    beginStroke.indexOf("capturePaintSelectionHistoryMask(this, historyActionId)") >= 0
      && beginStroke.indexOf("capturePaintSelectionHistoryMask(this, historyActionId)")
        < beginStroke.indexOf("this.nextHistoryActionId += 1"),
    "Paint deve congelare la selezione storica prima di avanzare o renderizzare l'azione.",
  );
  const rasterPropertyHandshake = brushEngine.slice(
    brushEngine.indexOf("  beginRasterLayerMetadataHistoryEdit("),
    brushEngine.indexOf("  beginVectorHistoryEdit("),
  );
  assert.match(
    rasterPropertyHandshake,
    /\): number \| null[\s\S]*?active\.layerId === layerId && active\.property === property[\s\S]*?\? active\.token[\s\S]*?: null/,
    "Un edit già aperto deve restituire il token soltanto per lo stesso livello e proprietà.",
  );
  assert.match(
    rasterPropertyHandshake,
    /commitRasterLayerMetadataHistoryEdit\(token: number\)[\s\S]*?!edit \|\| edit\.token !== token/,
    "Un commit stale non deve chiudere la transazione di un altro controllo.",
  );
  assert.match(
    rasterPropertyHandshake,
    /edit\.layerId !== before\.layerId \|\| edit\.property !== property/,
    "Bevel, Shadow e Stroke non devono mai assorbirsi nella stessa azione.",
  );
  assert.match(
    rasterPropertyHandshake,
    /cancelRasterLayerMetadataHistoryEdit\(token: number\)[\s\S]*?rasterLayerMetadataHistoryStatesEqual\(edit, current\)/,
    "Cancel può abbandonare soltanto un handshake ancora immutato, mai perdere un effetto già visibile.",
  );
  for (const [method, property] of [
    ["setRasterColorOverlayStyle", "color-overlay"],
    ["setRasterStrokeStyle", "stroke"],
    ["setRasterBevelStyle", "bevel"],
    ["setRasterOuterShadowStyle", "outer-shadow"],
    ["setRasterInnerShadowStyle", "inner-shadow"],
  ]) {
    assert.match(
      brushEngine,
      new RegExp(`async ${method}\\(style: unknown\\): Promise<boolean> \\{[\\s\\S]{0,900}?rasterLayerMetadataHistoryEditAllows\\("${property}"\\)`),
      `${method} deve rifiutare una transazione di un altro effetto prima di mutare risorse.`,
    );
  }
  assert.match(
    main,
    /historyState\.openEdit === "transform"[\s\S]{0,180}\(!allowDestructiveBlurEdit && historyState\.openEdit === "gaussian-blur"\)[\s\S]{0,180}\(!allowDestructiveBlurEdit && historyState\.openEdit === "motion-blur"\)[\s\S]{0,180}historyState\.openEdit === "raster-property"/,
    "Le modifiche ai pixel devono restare bloccate finché l'effetto non ha committato la cronologia.",
  );
  assert.match(
    main,
    /function canvasViewOperationLocked\(\)[\s\S]{0,700}operationLocked\(allowDestructiveBlurEdit/,
    "I Blur distruttivi devono separare la navigazione del canvas dal lock delle modifiche ai pixel.",
  );
  const canvasPointerDown = main.slice(
    main.indexOf('canvas.addEventListener("pointerdown"'),
    main.indexOf('canvas.addEventListener("pointermove"'),
  );
  assert(
    canvasPointerDown.indexOf("if (!engine.beginStroke(paintSample))") >= 0
      && canvasPointerDown.indexOf("if (!engine.beginStroke(paintSample))")
        < canvasPointerDown.lastIndexOf("canvas.setPointerCapture(event.pointerId)"),
    "Un begin Paint rifiutato non deve acquisire il puntatore né simulare uno stroke attivo.",
  );
  const recordPaintBatch = brushEngine.slice(
    brushEngine.indexOf("  recordHistoryBatch("),
    brushEngine.indexOf("  resetHistoryState(): void"),
  );
  assert(recordPaintBatch.includes("this.selectionHistoryMasksByAction.get(actionId) ?? null"));
  assert(!recordPaintBatch.includes("capturePaintSelectionHistoryMask("));
  assert(historyRuntime.includes("engine.pixelSelectionIdentity === expectedSelection.identity"));
  assert(historyRuntime.includes("await restorePixelSelectionHistoryMask(engine, targetSelection)"));
  assert(historyRuntime.includes(
    "wand/lasso/color selection must survive raster Undo/Redo unchanged",
  ));
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
  assert(engine.includes('kind: "layer-metadata"'));
  assert(engine.includes("captureRasterLayerMetadataHistoryState"));
  assert(engine.includes("applyRasterLayerMetadataHistoryState"));
  assert(engine.includes("restoreClippingHistoryState("));
  assert(engine.includes('action.property === "visibility"'));
  assert(engine.includes('action.property === "opacity"'));
  assert(engine.includes('action.property === "clipping"'));
  assert.match(
    engine,
    /restoreEffectsWorkbenchToActiveLayer\(\s*engine,\s*"history-replay",\s*true,\s*"content-bounds",\s*\)/,
    "Undo/Redo di un singolo effetto deve ricostruire soltanto il dominio visivo del contenuto.",
  );
  assert(!engine.includes("restoreClippingHistoryState(target.clipping)"));
  assert(!engine.includes("record.visible = target.visible"));
  assert(!engine.includes("record.opacity = target.opacity"));
  assert(engine.includes("undoBlockedReason"));
  assert(engine.includes("redoBlockedReason"));
  assert(effectsSheet.includes("commitHistoryEditIfIdle"));
  assert(strokeSheet.includes("commitHistoryEditIfIdle"));
  assert.match(effectsSheet, /applyLoop = null;[\s\S]{0,180}commitHistoryEditIfIdle/);
  assert.match(strokeSheet, /applyLoop = null;[\s\S]{0,180}commitHistoryEditIfIdle/);
  assert.match(toolSheet, /visibilitychange[\s\S]{0,180}finishSvgPaintEdit/);
  assert.match(toolSheet, /pagehide[\s\S]{0,100}finishSvgPaintEdit/);
  assert.match(
    toolSheet,
    /input\.addEventListener\("change"[\s\S]{0,500}finally[\s\S]{0,100}finishSvgPaintEdit/,
  );

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
  // Contratto cambiato il 6 agosto 2026: la creazione di un livello e' ora
  // journaled. Prima troncava il Redo perche' un'inserzione non registrata
  // rendeva inapplicabili le azioni `scene-reorder`, che conservano un ordine
  // assoluto; registrandola, lo stato a qualsiasi cursore si ottiene applicando
  // le azioni in ordine. Senza queste asserzioni un ritorno al vecchio
  // comportamento renderebbe la creazione non annullabile senza che nulla lo
  // segnali.
  assert.match(
    addLayer,
    /kind: "layer-add"/,
    "la creazione di un livello deve registrare un'azione journaled",
  );
  assert.match(
    addLayer,
    /const selectedKeyBefore = this\.mixedSceneStack\?\.selected\.key \?\? null;/,
    "lo stato selezionato va catturato prima dell'inserimento, non dopo",
  );
  assert.match(
    addLayer,
    /const activeRasterLayerIdBefore = this\.layerStack\.active\.id;/,
    "il raster attivo precedente va catturato prima dell'inserimento",
  );
  assert.match(
    addLayer,
    /commitHistoryActionAtomically\(this, action\);/,
    "l'azione di creazione deve pubblicare journal e troncamento Redo atomicamente",
  );

  // Ogni lista che `truncateRedoHistory` puo' allungare appartiene allo stesso
  // commit. Dimenticarne una lascia un'azione contemporaneamente viva nel Redo
  // e candidata alla distruzione idle.
  const atomicCommit = historyRuntime.slice(
    historyRuntime.indexOf("export function commitHistoryActionAtomically("),
    historyRuntime.indexOf("export function truncateRedoHistory("),
  );
  assert.ok(atomicCommit.length > 0, "helper di commit history atomico non individuato");
  for (const field of [
    "discardedVectorRasterHistoryActions",
    "discardedRasterImportHistoryActions",
    "discardedRasterTransformHistoryActions",
    "discardedLayerDeleteHistoryActions",
  ]) {
    assert.match(
      atomicCommit,
      new RegExp(`${field}\\.length = discarded`),
      `${field} deve tornare alla propria lunghezza se la pubblicazione fallisce`,
    );
  }
  assert.match(
    atomicCommit,
    /engine\.historyActions\[cursorBefore \+ index\] = redoActions\[index\]/,
    "il ramo Redo va ricostruito senza riusare il push eventualmente guastato",
  );
  assert.match(
    brushEngine.slice(
      brushEngine.indexOf("  commitRasterImportHistory("),
      brushEngine.indexOf("  beginRasterLayerTransform("),
    ),
    /commitHistoryActionAtomically\(this, action\)/,
    "anche l'import raster deve usare il commit che ripristina tutte le liste di scarto",
  );
  assert.match(
    transformRuntime,
    /commitHistoryActionAtomically\(engine, action\)/,
    "Trasforma deve usare il commit che ripristina anche le layer-delete scartate",
  );
  for (const [name, body] of [
    ["deleteLayer", brushEngine.slice(
      brushEngine.indexOf("  async deleteLayer("),
      brushEngine.indexOf("  measuredGpuMemory()"),
    )],
    ["rasterizeVectorNode", brushEngine.slice(
      brushEngine.indexOf("  private async rasterizeVectorNode("),
      brushEngine.indexOf("  async rasterizeVectorTextNode("),
    )],
  ]) {
    assert.match(body, /commitHistoryActionAtomically\(this, action\)/,
      `${name}: il journal va pubblicato atomicamente`);
    assert.match(body, /catch \(error\)[\s\S]*rollback|catch \(error\)[\s\S]*apply.*-1/,
      `${name}: un commit rifiutato deve annullare anche la mutazione del documento`);
  }

  // Il compattatore non deve fidarsi ciecamente della lista di scarto: una
  // layer-delete ancora trattenuta nel journal conserva i propri seed.
  assert.match(
    historyRuntime,
    /retainedLayerDeleteIds\.add\(action\.id\)/,
    "le layer-delete vive vanno marcate durante la scansione del journal",
  );
  assert.match(
    historyRuntime,
    /if \(!retainedLayerDeleteIds\.has\(action\.id\)\) layerDeleteActionsToDestroy\.push\(action\)/,
    "solo le layer-delete davvero abbandonate possono essere distrutte",
  );
  assert.doesNotMatch(
    historyRuntime,
    /for \(const action of engine\.discardedLayerDeleteHistoryActions\) \{\s*destroyLayerDeleteHistorySeeds/,
    "vietata la distruzione incondizionata della lista layer-delete",
  );

  // Le raster-run sono nominate dagli ID, non dagli stili: una modifica raster
  // non puo' usare l'ottimizzazione riservata alle sole mutazioni vettoriali.
  const metadataPresentation = historyRuntime.slice(
    historyRuntime.indexOf("async function refreshRasterLayerMetadataPresentation("),
    historyRuntime.indexOf("export async function applyRasterLayerMetadataHistoryState("),
  );
  assert.doesNotMatch(
    metadataPresentation,
    /reuseUnchangedRasterRuns: true/,
    "Undo/Redo metadata raster deve rigenerare le run cambiate",
  );
  assert.match(
    metadataPresentation,
    /else \{[\s\S]*await engine\.rebuildMergedLayerSurfaces\([\s\S]*"history-replay"/,
    "anche gli effetti di un raster inattivo devono ricostruire la sua run",
  );

  const rasterReplay = engine.slice(
    engine.indexOf("export async function rebuildActiveLayerFromHistory"),
    engine.indexOf("export async function applyVectorHistoryState"),
  );
  const seedBranchStart = rasterReplay.indexOf("if (hasReplaySeed) {");
  const seedClear = rasterReplay.indexOf(
    "engine.submitImmediate(\n        [],\n        true,\n        engine.settings,\n        false,\n        null,",
    seedBranchStart,
  );
  const seedHydration = rasterReplay.indexOf(
    "encodeLayerColdHydration(encoder, replaySeed, hot);",
    seedClear,
  );
  const seedOnlyPresentation = rasterReplay.indexOf(
    "if (lastVisibleBatchIndex < 0) {",
    seedHydration,
  );
  const seedOnlyDirtyBounds = rasterReplay.indexOf(
    "replaySeedBounds,\n          true,",
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
  assert(rasterReplay.includes("periodicCheckpointChainForReplay(engine, layerId)"));
  assert(rasterReplay.includes("periodicChain.flatMap"));

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
