import assert from "node:assert/strict";
import {
  HISTORY_JOURNAL_STRATEGY,
  assertSingleLayerBatch,
  firstVisibleActionIndex,
  hasVisibleContent,
  layersWithVisibleContent,
  selectBatchesForLayer,
  visibleStrokeIds,
} from "../src/history-journal.ts";

assert.equal(HISTORY_JOURNAL_STRATEGY, "global-order-per-layer-clear-barrier");

const stroke = (id, layerId) => ({ id, kind: "stroke", layerId });
const clear = (id, layerId) => ({ id, kind: "clear", layerId });

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

// A batch is the unit of replay and targets one texture, so it may not mix
// layers. The guard is free with one layer and load-bearing the moment replay
// starts choosing a destination.
{
  assert.doesNotThrow(() => assertSingleLayerBatch({ layerId: 1 }));
  assert.doesNotThrow(() => assertSingleLayerBatch({
    layerId: 1,
    stamps: [{ layerId: 1 }, {}, { layerId: 1 }],
  }));
  assert.throws(
    () => assertSingleLayerBatch({ layerId: 1, stamps: [{ layerId: 1 }, { layerId: 2 }] }),
    /livelli diversi: 1 e 2/,
  );
}

// layersWithVisibleContent answers "which layers still show something", which
// is what clear() needs before deciding to reset the whole journal.
{
  const actions = [stroke(1, 1), stroke(2, 2), clear(3, 2)];
  assert.deepEqual([...layersWithVisibleContent(actions, 3)], [1]);
  assert.deepEqual([...layersWithVisibleContent(actions, 2)].sort(), [1, 2]);
  assert.deepEqual([...layersWithVisibleContent(actions, 0)], []);
}

console.log("History journal verification passed.");
