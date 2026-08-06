export const HISTORY_JOURNAL_STRATEGY =
  "global-order-per-layer-clear-barrier-raster-checkpoints-layer-metadata-scene-reorder-v8" as const;

/**
 * One entry of the global journal. `layerId` is what makes a single stack usable
 * across layers: the order stays global, so undo walks the user's actions in the
 * order they happened, but visibility is resolved per layer.
 */
export type JournalAction =
  | {
    id: number;
    kind: "stroke" | "fill" | "clear";
    layerId: number;
  }
  | {
    id: number;
    kind: "vector-rasterize" | "raster-import";
    layerId: number;
  }
  | {
    id: number;
    kind: "raster-transform";
    layerId: number;
    /** Null means that Apply moved every resulting pixel outside the document. */
    baseBounds: unknown | null;
  }
  | {
    id: number;
    kind: "vector";
  }
  | {
    id: number;
    kind: "layer-blend-mode";
    layerId: number;
  }
  | {
    id: number;
    kind: "layer-metadata";
    layerId: number;
  }
  | {
    id: number;
    kind: "scene-reorder";
  }
  // Mutazioni strutturali: cambiano **quali** livelli esistono. Non hanno un
  // `layerId` singolo perche' una cancellazione puo' portarsi via un'intera
  // unita' di ritaglio, e non sono checkpoint: non ricostruiscono i pixel di
  // un livello vivo, spostano il livello dentro o fuori dal documento.
  //
  // Due membri distinti e non uno con discriminante `"layer-add" | "layer-delete"`:
  // escludendo entrambi i kind, TypeScript riduce quel discriminante a `never`
  // ma **non** elimina il membro, e ogni accesso a `layerId` a valle resta un
  // errore. Con literal singoli il narrowing funziona.
  | {
    id: number;
    kind: "layer-add";
  }
  | {
    id: number;
    kind: "layer-delete";
  };

export interface JournalBatch {
  actionId: number;
  layerId: number;
}

export interface LayerReplaySelection<T extends JournalBatch> {
  batches: T[];
  visibleStrokeIds: Set<number>;
}

export type JournalCheckpointAction<TAction extends JournalAction = JournalAction> = Extract<
  TAction,
  { kind: "vector-rasterize" | "raster-import" | "raster-transform" }
>;

export interface LayerReplayCheckpoint<TAction extends JournalAction = JournalAction> {
  action: JournalCheckpointAction<TAction>;
  actionIndex: number;
}

export interface LayerReplayAfterCheckpointSelection<
  T extends JournalBatch,
  TAction extends JournalAction = JournalAction,
>
  extends LayerReplaySelection<T> {
  checkpoint: LayerReplayCheckpoint<TAction> | null;
  /** First global action that still needs batch replay. */
  firstReplayActionIndex: number;
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
    if (action.kind !== "stroke" && action.kind !== "fill") {
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
  const end = Math.max(0, Math.min(cursor, actions.length));
  const contentByLayer = new Map<number, boolean>();
  for (let index = 0; index < end; index += 1) {
    const action = actions[index];
    if (
      action.kind === "vector"
      || action.kind === "layer-blend-mode"
      || action.kind === "layer-metadata"
      || action.kind === "scene-reorder"
      // Le mutazioni strutturali non hanno un livello singolo: una
      // cancellazione puo` portarsi via un`intera unita` di ritaglio.
      || action.kind === "layer-add"
      || action.kind === "layer-delete"
    ) continue;
    if (layerId !== undefined && action.layerId !== layerId) continue;
    if (action.kind === "clear") {
      contentByLayer.set(action.layerId, false);
    } else if (action.kind === "raster-transform") {
      contentByLayer.set(action.layerId, action.baseBounds !== null);
    } else {
      contentByLayer.set(action.layerId, true);
    }
  }
  return layerId === undefined
    ? [...contentByLayer.values()].some(Boolean)
    : contentByLayer.get(layerId) ?? false;
}

/** Latest post-action tiled checkpoint after this layer's most recent Clear. */
export function latestLayerReplayCheckpoint<TAction extends JournalAction>(
  actions: readonly TAction[],
  cursor: number,
  layerId: number,
): LayerReplayCheckpoint<TAction> | null {
  const end = Math.max(0, Math.min(cursor, actions.length));
  const first = firstVisibleActionIndex(actions, end, layerId);
  let checkpoint: LayerReplayCheckpoint<TAction> | null = null;
  for (let index = first; index < end; index += 1) {
    const action = actions[index];
    if (
      action.kind !== "vector"
      && action.kind !== "scene-reorder"
      && action.kind !== "layer-add"
      && action.kind !== "layer-delete"
      && action.layerId === layerId
      && (
        action.kind === "vector-rasterize"
        || action.kind === "raster-import"
        || action.kind === "raster-transform"
      )
    ) {
      checkpoint = {
        action: action as JournalCheckpointAction<TAction>,
        actionIndex: index,
      };
    }
  }
  return checkpoint;
}

/** Paint/Blend/Fill action ids that must run after hydrating the latest seed. */
export function visibleRasterBatchActionIdsAfterCheckpoint<TAction extends JournalAction>(
  actions: readonly TAction[],
  cursor: number,
  layerId: number,
  checkpoint: LayerReplayCheckpoint<TAction> | null = latestLayerReplayCheckpoint(
    actions,
    cursor,
    layerId,
  ),
): Set<number> {
  const end = Math.max(0, Math.min(cursor, actions.length));
  const first = checkpoint
    ? checkpoint.actionIndex + 1
    : firstVisibleActionIndex(actions, end, layerId);
  const visible = new Set<number>();
  for (let index = first; index < end; index += 1) {
    const action = actions[index];
    if (
      action.kind !== "vector"
      && action.kind !== "scene-reorder"
      && action.kind !== "layer-add"
      && action.kind !== "layer-delete"
      && action.layerId === layerId
      && (action.kind === "stroke" || action.kind === "fill")
    ) {
      visible.add(action.id);
    }
  }
  return visible;
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
 * Checkpoint-aware replay selector. The legacy selector above deliberately
 * remains unchanged until the engine runtime migrates, while this helper makes
 * the new ordering executable and independently testable.
 */
export function selectLayerReplayAfterCheckpoint<
  T extends JournalBatch,
  TAction extends JournalAction,
>(
  actions: readonly TAction[],
  cursor: number,
  batches: readonly T[],
  layerId: number,
): LayerReplayAfterCheckpointSelection<T, TAction> {
  const checkpoint = latestLayerReplayCheckpoint(actions, cursor, layerId);
  const visibleIds = visibleRasterBatchActionIdsAfterCheckpoint(
    actions,
    cursor,
    layerId,
    checkpoint,
  );
  return {
    checkpoint,
    firstReplayActionIndex: checkpoint
      ? checkpoint.actionIndex + 1
      : firstVisibleActionIndex(actions, cursor, layerId),
    batches: selectBatchesForLayer(batches, layerId).filter((batch) =>
      visibleIds.has(batch.actionId)
    ),
    visibleStrokeIds: visibleIds,
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
  if (
    !action
    || action.kind === "vector"
    || action.kind === "scene-reorder"
    || action.kind === "layer-add"
    || action.kind === "layer-delete"
  ) return false;
  if (action.kind === "vector-rasterize" || action.kind === "raster-import") {
    return delta < 0
      ? !liveLayerIds.has(action.layerId)
      : liveLayerIds.has(action.layerId);
  }
  return !liveLayerIds.has(action.layerId);
}

/** Layers that still have visible content, for "is the document empty" checks. */
export function layersWithVisibleContent(
  actions: readonly JournalAction[],
  cursor: number,
): Set<number> {
  const layers = new Set<number>();
  for (const action of actions.slice(0, Math.max(0, Math.min(cursor, actions.length)))) {
    if (
      action.kind === "stroke"
      || action.kind === "fill"
      || action.kind === "vector-rasterize"
      || action.kind === "raster-import"
      || action.kind === "raster-transform"
    ) {
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
