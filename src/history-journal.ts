export const HISTORY_JOURNAL_STRATEGY =
  "global-order-per-layer-clear-barrier" as const;

/**
 * One entry of the global journal. `layerId` is what makes a single stack usable
 * across layers: the order stays global, so undo walks the user's actions in the
 * order they happened, but visibility is resolved per layer.
 */
export interface JournalAction {
  id: number;
  kind: "stroke" | "clear";
  layerId: number;
}

export interface JournalBatch {
  actionId: number;
  layerId: number;
}

/**
 * Index of the first action still visible for a layer, scanning back from the
 * cursor to the most recent `clear`.
 *
 * With one layer a clear is a document-wide barrier, which is what the engine
 * does today. With several, a clear on layer B must not hide layer A's strokes —
 * so only clears belonging to the layer under question act as barriers. Passing
 * no layerId keeps the document-wide meaning, which is still the right question
 * for "is the whole document empty".
 */
export function firstVisibleActionIndex(
  actions: readonly JournalAction[],
  cursor: number,
  layerId?: number,
): number {
  const end = Math.max(0, Math.min(cursor, actions.length));
  for (let index = end - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action.kind !== "clear") {
      continue;
    }
    if (layerId === undefined || action.layerId === layerId) {
      return index + 1;
    }
  }
  return 0;
}

export function visibleStrokeIds(
  actions: readonly JournalAction[],
  cursor: number,
  layerId?: number,
): Set<number> {
  const end = Math.max(0, Math.min(cursor, actions.length));
  const first = firstVisibleActionIndex(actions, cursor, layerId);
  const visible = new Set<number>();
  for (let index = first; index < end; index += 1) {
    const action = actions[index];
    if (action.kind !== "stroke") {
      continue;
    }
    if (layerId === undefined || action.layerId === layerId) {
      visible.add(action.id);
    }
  }
  return visible;
}

export function hasVisibleContent(
  actions: readonly JournalAction[],
  cursor: number,
  layerId?: number,
): boolean {
  return visibleStrokeIds(actions, cursor, layerId).size > 0;
}

/**
 * The batches belonging to one layer, in their original global order. Replay
 * must not reorder them: two strokes on the same layer have to be re-applied in
 * the order the user made them, and their ids are monotonic across all layers.
 */
export function selectBatchesForLayer<T extends JournalBatch>(
  batches: readonly T[],
  layerId: number,
): T[] {
  return batches.filter((batch) => batch.layerId === layerId);
}

/**
 * A batch is the unit of replay and targets exactly one layer texture, so it may
 * never mix layers. Free today because there is one layer; load-bearing the
 * moment replay starts choosing a destination.
 */
export function assertSingleLayerBatch(
  batch: { layerId: number; stamps?: readonly { layerId?: number }[] },
): void {
  for (const stamp of batch.stamps ?? []) {
    if (stamp.layerId !== undefined && stamp.layerId !== batch.layerId) {
      throw new Error(
        `Batch cronologia con stamp su livelli diversi: ${batch.layerId} e ${stamp.layerId}.`,
      );
    }
  }
}

/** Layers that still have visible content, for "is the document empty" checks. */
export function layersWithVisibleContent(
  actions: readonly JournalAction[],
  cursor: number,
): Set<number> {
  const layers = new Set<number>();
  for (const action of actions.slice(0, Math.max(0, Math.min(cursor, actions.length)))) {
    if (action.kind === "stroke") {
      layers.add(action.layerId);
    }
  }
  for (const layerId of [...layers]) {
    if (!hasVisibleContent(actions, cursor, layerId)) {
      layers.delete(layerId);
    }
  }
  return layers;
}
