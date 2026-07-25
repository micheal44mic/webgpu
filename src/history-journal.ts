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
  layerId: number;
}

export interface LayerReplaySelection<T extends JournalBatch> {
  batches: T[];
  visibleStrokeIds: Set<number>;
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
 * Complete input selection for rebuilding one layer. Keep the action filter and
 * the batch filter together: either one independently prevents a foreign stroke
 * from being replayed, but both are required as defence against inconsistent
 * journal metadata.
 */
export function selectLayerReplay<T extends JournalBatch>(
  actions: readonly JournalAction[],
  cursor: number,
  batches: readonly T[],
  layerId: number,
): LayerReplaySelection<T> {
  return {
    batches: selectBatchesForLayer(batches, layerId),
    visibleStrokeIds: visibleStrokeIds(actions, cursor, layerId),
  };
}

/**
 * True when undo/redo would cross an action whose layer no longer exists.
 *
 * Crossing into another LIVE layer is supported: the active layer moves with the
 * cursor. An action whose layer is gone has no texture to rebuild, so it must be
 * refused rather than applied somewhere else.
 */
export function historyStepTargetsMissingLayer(
  actions: readonly JournalAction[],
  cursor: number,
  delta: -1 | 1,
  liveLayerIds: ReadonlySet<number>,
): boolean {
  const action = delta < 0 ? actions[cursor - 1] : actions[cursor];
  return Boolean(action) && !liveLayerIds.has(action.layerId);
}

/** True when undo/redo would cross an action owned by another layer. */
export function historyStepTargetsOtherLayer(
  actions: readonly JournalAction[],
  cursor: number,
  delta: -1 | 1,
  activeLayerId: number,
): boolean {
  const action = delta < 0 ? actions[cursor - 1] : actions[cursor];
  return Boolean(action) && action.layerId !== activeLayerId;
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
