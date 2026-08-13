import assert from "node:assert/strict";
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
} from "../../../src/history-journal.ts";

assert.equal(
  HISTORY_JOURNAL_STRATEGY,
  "global-order-per-layer-clear-barrier-raster-checkpoints-layer-metadata-scene-reorder-merge-seeded-add-v11",
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
const layerAdd = (id, layerId, hasContent = false) => ({
  id,
  kind: "layer-add",
  layerId,
  baseBounds: hasContent ? { x: 0, y: 0, width: 1, height: 1 } : null,
});
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
const layerMerge = (
  id,
  inputLayerIds,
  outputLayerId,
  hasContent = true,
  payloadsRetiredBelowFloor = false,
) => ({
  id,
  kind: "layer-merge",
  inputs: inputLayerIds.map((layerId) => ({
    kind: "raster",
    entry: { layerRecord: { id: layerId } },
  })),
  output: {
    layerRecord: { id: outputLayerId },
    baseBounds: hasContent ? { x: 0, y: 0, width: 1, height: 1 } : null,
  },
  payloadsRetiredBelowFloor,
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

// Add is both structural and a raster checkpoint. Duplicate carries content;
// a normal Add is the explicit empty baseline for later paint replay.
{
  const duplicate = layerAdd(1, 21, true);
  const actions = [duplicate, stroke(2, 21)];
  assert.equal(latestLayerReplayCheckpoint(actions, 1, 21)?.action.id, 1);
  assert.equal(hasVisibleContent(actions, 1, 21), true);
  assert.deepEqual([...layersWithVisibleContent(actions, 1)], [21]);
  const replay = selectLayerReplayAfterCheckpoint(
    actions,
    2,
    [{ actionId: 2, layerId: 21 }],
    21,
  );
  assert.equal(replay.checkpoint?.action.id, 1);
  assert.deepEqual(replay.batches.map((batch) => batch.actionId), [2]);
  assert.equal(historyStepTargetsMissingLayer([duplicate], 1, -1, new Set([21])), false);
  assert.equal(historyStepTargetsMissingLayer([duplicate], 1, -1, new Set()), true);
  assert.equal(historyStepTargetsMissingLayer([duplicate], 0, 1, new Set()), false);
  assert.equal(historyStepTargetsMissingLayer([duplicate], 0, 1, new Set([21])), true);

  const blank = layerAdd(3, 22, false);
  assert.equal(latestLayerReplayCheckpoint([blank], 1, 22)?.action.id, 3);
  assert.equal(hasVisibleContent([blank], 1, 22), false);
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

// A merge removes the raster inputs from the visible journal state and becomes
// the exact replay checkpoint for its fresh output identity.
{
  const actions = [
    stroke(1, 3),
    stroke(2, 4),
    layerMerge(3, [3, 4], 9),
    stroke(4, 9),
  ];
  assert.equal(hasVisibleContent(actions, 2, 3), true);
  assert.equal(hasVisibleContent(actions, 3, 3), false);
  assert.equal(hasVisibleContent(actions, 3, 4), false);
  assert.equal(hasVisibleContent(actions, 3, 9), true);
  assert.deepEqual([...layersWithVisibleContent(actions, 3)], [9]);
  assert.equal(latestLayerReplayCheckpoint(actions, 4, 9)?.action.id, 3);
  assert.deepEqual([...visibleRasterBatchActionIdsAfterCheckpoint(actions, 4, 9)], [4]);

  assert.equal(historyStepTargetsMissingLayer(actions, 3, -1, new Set([9])), false);
  assert.equal(historyStepTargetsMissingLayer(actions, 3, -1, new Set()), true);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, 1, new Set([3, 4])), false);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, 1, new Set([3])), true);
  assert.equal(historyStepTargetsMissingLayer(actions, 2, 1, new Set([3, 4, 9])), true);

  const retired = [
    stroke(1, 3),
    layerMerge(2, [3], 9, true, true),
    stroke(3, 9),
  ];
  assert.equal(
    latestLayerReplayCheckpoint(retired, retired.length, 9),
    null,
    "un seed merge ritirato sotto il floor non deve più essere scelto come baseline replay",
  );
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
