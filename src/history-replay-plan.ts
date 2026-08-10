import type {
  HistoryAction,
  HistoryRenderBatch,
  RasterHistoryCheckpoint,
} from "./engine-history-types";
import { selectLayerReplayAfterCheckpoint } from "./history-journal";
import type { PeriodicRasterHistoryCheckpoint } from "./history-maintenance-runtime";

export interface PeriodicHistoryReplaySelection {
  readonly checkpoints: readonly PeriodicRasterHistoryCheckpoint[];
  readonly actionIndex: number;
}

export interface RasterHistoryReplayPlan {
  readonly periodicChain: readonly PeriodicRasterHistoryCheckpoint[];
  readonly seedAction: RasterHistoryCheckpoint | undefined;
  readonly replayCheckpointActionIndex: number;
  readonly visibleActionIds: ReadonlySet<number>;
  readonly batches: readonly HistoryRenderBatch[];
}

/**
 * Single authority for the payloads consumed by raster replay. Storage
 * preflight and the renderer must use this same plan: otherwise preflight can
 * hydrate a discarded prefix or miss the checkpoint the renderer selects.
 */
export function planRasterHistoryReplay(options: {
  readonly actions: readonly HistoryAction[];
  readonly cursor: number;
  readonly batches: readonly HistoryRenderBatch[];
  readonly layerId: number;
  readonly periodicSelection: PeriodicHistoryReplaySelection | null;
}): RasterHistoryReplayPlan {
  const journalSelection = selectLayerReplayAfterCheckpoint(
    options.actions,
    options.cursor,
    options.batches,
    options.layerId,
  );
  const usePeriodicCheckpoint = Boolean(
    options.periodicSelection
    && options.periodicSelection.actionIndex
      >= (journalSelection.checkpoint?.actionIndex ?? -1)
  );
  const periodicChain = usePeriodicCheckpoint
    ? options.periodicSelection?.checkpoints ?? []
    : [];
  const checkpointAction = usePeriodicCheckpoint
    ? undefined
    : journalSelection.checkpoint?.action;
  const seedAction: RasterHistoryCheckpoint | undefined = checkpointAction?.kind === "layer-merge"
    ? {
      layerId: checkpointAction.output.layerRecord.id,
      seed: checkpointAction.output.seed,
      baseBounds: checkpointAction.output.baseBounds,
      baseTileMask: checkpointAction.output.baseTileMask,
    }
    : checkpointAction;
  const replayCheckpointActionIndex = usePeriodicCheckpoint
    ? options.periodicSelection?.actionIndex ?? -1
    : journalSelection.checkpoint?.actionIndex ?? -1;
  const actionIndexById = new Map(
    options.actions.slice(0, options.cursor).map((action, index) => [action.id, index]),
  );
  const visibleActionIds = new Set(
    [...journalSelection.visibleStrokeIds].filter((actionId) => (
      (actionIndexById.get(actionId) ?? -1) > replayCheckpointActionIndex
    )),
  );
  const batches = journalSelection.batches.filter(
    (batch) => visibleActionIds.has(batch.actionId),
  );
  return {
    periodicChain,
    seedAction,
    replayCheckpointActionIndex,
    visibleActionIds,
    batches,
  };
}
