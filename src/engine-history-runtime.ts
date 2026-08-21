import type { BrushEngine } from "./brush-engine";
import type { EffectsRetargetCaller } from "./engine-layer-resources";
import {
  createColdLayerGpuResources,
  destroyLayerColdStorage,
  encodeLayerColdHydration,
  evictReconstructibleLayerResources,
  uploadCompressedLayerIntoHot,
} from "./engine-cold-storage";
import {
  hasVisibleContent,
  historyStepTargetsMissingLayer,
} from "./history-journal";
import { isTexturizedGrainActive, usesStrokeGlazeRenderer } from "./engine-strategies";
import {
  type MixedSceneItem,
  type MixedSceneVectorHistoryState,
} from "./mixed-scene-stack";
import {
  clearVectorTextPresentationForTransaction,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";
import {
  applyLayerAddHistory,
  applyLayerDeleteHistory,
  destroyLayerDeleteHistorySeeds,
} from "./engine-layer-structure-runtime";
import {
  applyLayerMergeHistory,
  destroyLayerMergeHistorySeeds,
} from "./engine-layer-merge-runtime";
import { type PendingBlendBatch } from "./engine-stroke-types";
import { type SubmitTiming } from "./engine-stats";
import { compactDryBlendHistoryGeometry } from "./blend-renderer";
import {
  vectorHistoryStatesEqual,
  type HistoryAction,
  type HistoryRenderBatch,
  type LayerAddHistoryAction,
  type LayerDeleteHistoryAction,
  type LayerMergeHistoryAction,
  type MixedSceneReorderHistoryAction,
  type RasterLayerMetadataHistoryAction,
  type RasterLayerMetadataHistoryProperty,
  type RasterLayerMetadataHistoryState,
  type RasterLayerMetadataHistoryValueMap,
  type RasterImportHistoryAction,
  type RasterFilterHistoryAction,
  type RasterHistoryCheckpoint,
  type RasterTransformHistoryAction,
  type VectorRasterizeHistoryAction,
} from "./engine-history-types";
import {
  assertValidMixedSceneOrder,
  isMixedSceneOrderStateApplicable,
  mixedSceneReorderTargets,
  planMixedSceneReorder,
  type MixedSceneOrderState,
  type MixedSceneReorderTargets,
} from "./mixed-scene-reorder-core";
import { type GpuHistorySlice } from "./gpu-history-storage";
import { type HistoryReplayFaultPoint } from "./engine-types";
import {
  applyVectorRasterizeHistory,
  destroyVectorRasterHistorySeed,
} from "./engine-vector-raster-runtime";
import {
  applyRasterImportHistory,
  destroyRasterImportHistorySeed,
} from "./engine-raster-image-runtime";
import { mergeDirtyRects } from "./engine-geometry";
import { markLayerStorageRect } from "./layer-storage-study";
import {
  restoreEffectsWorkbenchToActiveLayer,
  setLayerBlendMode,
} from "./engine-layer-runtime";
import { copyRasterStrokeStyle, rasterStrokeStylesEqual } from "./stroke-core";
import { copyRasterBevelStyle, rasterBevelStylesEqual } from "./bevel-core";
import {
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
  rasterInnerShadowStylesEqual,
  rasterOuterShadowStylesEqual,
} from "./shadow-core";
import {
  copyRasterColorOverlayStyle,
  rasterColorOverlayStylesEqual,
} from "./raster-color-overlay-core";
import { restorePixelSelectionHistoryMask } from "./engine-selection-runtime";
import {
  grainAssetIdForSettings,
  shapeAssetIdForSettings,
  shapeInvertForSettings,
} from "./engine-brush-assets";
import {
  maybeReleaseIdleGrainResources,
  maybeReleaseIdleShapeResources,
} from "./engine-resource-setup";
import {
  cancelHistoryMaintenance,
  historyCursorWithinRetainedRange,
  periodicCheckpointChainForReplay,
} from "./history-maintenance-runtime";
import { processHistoryMaintenanceChunks } from "./history-retention-core";
import {
  planRasterHistoryReplay,
  restoredProjectBaselineApplies,
} from "./history-replay-plan";
import { noiseMipSmoothingAfterHistory } from "./noise-mip-smoothing-core";
import type { HistoryCommitOptions } from "./history-service.ts";
import {
  cloneRasterLayerSource,
  type RasterLayerSource,
} from "./raster-layer-source";
import {
  applyRasterLayerEffects,
  copyRasterLayerEffects,
  type RasterLayerEffectsSnapshot,
} from "./raster-layer-effects";

export function captureRasterLayerMetadataHistoryState(
  engine: BrushEngine,
  layerId: number,
  property: RasterLayerMetadataHistoryProperty,
): RasterLayerMetadataHistoryState {
  const record = engine.layerStack.byId(layerId);
  if (!record) throw new Error(`Layer ${layerId} is missing from metadata history.`);
  const value = property === "visibility"
    ? record.visible
    : property === "opacity"
      ? record.opacity
      : property === "clipping"
        ? engine.layerStack.captureClippingHistoryState()
        : property === "stroke"
          ? copyRasterStrokeStyle(record.strokeStyle)
          : property === "bevel"
            ? copyRasterBevelStyle(record.bevelStyle)
            : property === "outer-shadow"
              ? copyRasterOuterShadowStyle(record.outerShadowStyle)
              : property === "inner-shadow"
                ? copyRasterInnerShadowStyle(record.innerShadowStyle)
                : copyRasterColorOverlayStyle(record.colorOverlayStyle);
  return { layerId, property, value } as RasterLayerMetadataHistoryState;
}

function clippingHistoryStatesEqual(
  left: readonly { layerId: number; parentId: number | null }[],
  right: readonly { layerId: number; parentId: number | null }[],
): boolean {
  return left.length === right.length && left.every((entry, index) => (
    entry.layerId === right[index].layerId && entry.parentId === right[index].parentId
  ));
}

export function rasterLayerMetadataHistoryStatesEqual(
  left: RasterLayerMetadataHistoryState,
  right: RasterLayerMetadataHistoryState,
): boolean {
  if (left.layerId !== right.layerId || left.property !== right.property) return false;
  switch (left.property) {
    case "visibility":
    case "opacity":
      return left.value === right.value;
    case "clipping":
      return clippingHistoryStatesEqual(
        left.value,
        (right as Extract<RasterLayerMetadataHistoryState, { property: "clipping" }>).value,
      );
    case "stroke":
      return rasterStrokeStylesEqual(
        left.value,
        (right as Extract<RasterLayerMetadataHistoryState, { property: "stroke" }>).value,
      );
    case "bevel":
      return rasterBevelStylesEqual(
        left.value,
        (right as Extract<RasterLayerMetadataHistoryState, { property: "bevel" }>).value,
      );
    case "outer-shadow":
      return rasterOuterShadowStylesEqual(
        left.value,
        (right as Extract<RasterLayerMetadataHistoryState, { property: "outer-shadow" }>).value,
      );
    case "inner-shadow":
      return rasterInnerShadowStylesEqual(
        left.value,
        (right as Extract<RasterLayerMetadataHistoryState, { property: "inner-shadow" }>).value,
      );
    case "color-overlay":
      return rasterColorOverlayStylesEqual(
        left.value,
        (right as Extract<RasterLayerMetadataHistoryState, { property: "color-overlay" }>).value,
      );
  }
}

export function recordRasterLayerMetadataHistoryAction(
  engine: BrushEngine,
  property: RasterLayerMetadataHistoryProperty,
  before: RasterLayerMetadataHistoryState,
  after: RasterLayerMetadataHistoryState,
): boolean {
  if (
    before.layerId !== after.layerId
    || before.property !== property
    || after.property !== property
  ) {
    throw new Error("A metadata edit cannot change its layer or property during a gesture.");
  }
  if (rasterLayerMetadataHistoryStatesEqual(before, after)) return false;
  commitHistoryActionAtomically(engine, {
    id: engine.nextHistoryActionId,
    kind: "layer-metadata",
    layerId: before.layerId,
    property,
    before: before.value,
    after: after.value,
  } as RasterLayerMetadataHistoryAction);
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.historyCommittedActions += 1;
  }
  return true;
}

function assignRasterLayerMetadataHistoryValue(
  engine: BrushEngine,
  action: Pick<RasterLayerMetadataHistoryAction, "layerId" | "property">,
  target: RasterLayerMetadataHistoryAction["before"],
): void {
  const record = engine.layerStack.byId(action.layerId);
  if (!record) throw new Error(`Layer ${action.layerId} for the property was not found.`);
  switch (action.property) {
    case "visibility":
      record.visible = target as boolean;
      return;
    case "opacity":
      record.opacity = target as number;
      return;
    case "clipping":
      engine.layerStack.restoreClippingHistoryState(
        target as RasterLayerMetadataHistoryValueMap["clipping"],
      );
      return;
    case "stroke":
      record.strokeStyle = copyRasterStrokeStyle(target);
      break;
    case "bevel":
      record.bevelStyle = copyRasterBevelStyle(target);
      break;
    case "outer-shadow":
      record.outerShadowStyle = copyRasterOuterShadowStyle(target);
      break;
    case "inner-shadow":
      record.innerShadowStyle = copyRasterInnerShadowStyle(target);
      break;
    case "color-overlay":
      record.colorOverlayStyle = copyRasterColorOverlayStyle(target);
      break;
  }
  const gpu = engine.layerGpu.get(record.id);
  if (gpu) gpu.bakeValid = false;
}

export function restoreRasterLayerMetadataHistorySnapshot(
  engine: BrushEngine,
  snapshot: RasterLayerMetadataHistoryState,
): void {
  assignRasterLayerMetadataHistoryValue(
    engine,
    snapshot,
    snapshot.value,
  );
}

async function refreshRasterLayerMetadataPresentation(
  engine: BrushEngine,
  action: RasterLayerMetadataHistoryAction,
): Promise<void> {
  if (
    action.property === "visibility"
    || action.property === "opacity"
    || action.property === "clipping"
  ) {
    await engine.rebuildMergedLayerSurfaces(
      "history-replay",
      engine.getVectorTextViewState(),
    );
  } else if (engine.layerStack.active.id === action.layerId) {
    // One retarget updates only the active effect resources, bounds and
    // compositor. The raster document/merged surfaces are not rebuilt.
    await restoreEffectsWorkbenchToActiveLayer(
      engine,
      "history-replay",
      true,
      "content-bounds",
    );
  } else {
    // Gli identificatori delle raster-run contengono gli ID dei livelli, non
    // gli stili. Un effetto modificato su un raster inattivo deve quindi
    // ricostruire la run invece di riutilizzarne una byte-diversa ma omonima.
    await engine.rebuildMergedLayerSurfaces(
      "history-replay",
      engine.getVectorTextViewState(),
    );
  }
  engine.paintDisplayMipValidThroughLevel = 0;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.displayDirty = true;
  engine.requestRender();
}

/** Replays one field delta; authoritative layer pixels are never touched. */
export async function applyRasterLayerMetadataHistoryState(
  engine: BrushEngine,
  action: RasterLayerMetadataHistoryAction,
  target: RasterLayerMetadataHistoryAction["before"],
): Promise<void> {
  const previous = captureRasterLayerMetadataHistoryState(
    engine,
    action.layerId,
    action.property,
  );
  engine.layerSwitchBusy = true;
  try {
    assignRasterLayerMetadataHistoryValue(engine, action, target);
    await refreshRasterLayerMetadataPresentation(engine, action);
  } catch (error) {
    try {
      assignRasterLayerMetadataHistoryValue(engine, action, previous.value);
      await refreshRasterLayerMetadataPresentation(engine, action);
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "State is inconsistent after raster property Undo/Redo. Reload the page.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Raster property Undo/Redo failed (${originalMessage}) and restore failed `
        + `(${restoreMessage}).`,
      );
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    publishMixedScene(engine);
    engine.publishStats();
  }
}

interface RasterSourceHistoryTransition {
  readonly layerId: number;
  readonly before: RasterLayerSource | null;
  readonly after: RasterLayerSource | null;
}

interface RasterEffectsHistoryTransition {
  readonly layerId: number;
  readonly before: RasterLayerEffectsSnapshot;
  readonly after: RasterLayerEffectsSnapshot;
}

function rasterEffectsHistoryTransition(
  action: HistoryAction,
): RasterEffectsHistoryTransition | null {
  if (action.kind !== "raster-filter" || action.filter !== "rasterize-layer") {
    return null;
  }
  return {
    layerId: action.layerId,
    before: copyRasterLayerEffects(action.effectsBefore),
    after: copyRasterLayerEffects(action.effectsAfter),
  };
}

function rasterSourceHistoryTransition(
  action: HistoryAction,
): RasterSourceHistoryTransition | null {
  if (action.kind === "raster-transform") {
    return {
      layerId: action.layerId,
      before: cloneRasterLayerSource(action.rasterSourceBefore),
      after: cloneRasterLayerSource(action.rasterSourceAfter),
    };
  }
  if (
    action.kind === "stroke"
    || action.kind === "fill"
    || action.kind === "clear"
    || action.kind === "raster-filter"
  ) {
    if (
      action.rasterSourceBefore === undefined
      && action.rasterSourceAfter === undefined
    ) return null;
    return {
      layerId: action.layerId,
      before: cloneRasterLayerSource(action.rasterSourceBefore ?? null),
      after: cloneRasterLayerSource(action.rasterSourceAfter ?? null),
    };
  }
  return null;
}

export async function moveHistoryCursor(engine: BrushEngine, delta: -1 | 1): Promise<boolean> {
  if (
    !engine.initialized
    || engine.activeStroke
    || engine.historyBusy
    || engine.selectionBusy
    || engine.activeVectorHistoryEdit
    || engine.activeRasterLayerMetadataHistoryEdit
  ) {
    return false;
  }
  if (engine.layerSwitchBusy) {
    return false;
  }
  // Queste due erano coperte solo di rimbalzo, perche' chi le apriva lasciava
  // acceso `historyBusy`. Farle valere qui in modo esplicito e' cio' che
  // permette a quel flag di tornare a significare "un'operazione di cronologia
  // e' in corso" invece di "qualcosa, da qualche parte, e' aperto".
  if (engine.activeRasterTransformSession) {
    engine.publishStatus(
      "Apply or cancel the transform before using history.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterGaussianBlurSession) {
    engine.publishStatus(
      "Apply or cancel Gaussian Blur before using history.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterMotionBlurSession) {
    engine.publishStatus(
      "Apply or cancel Motion Blur before using history.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterNoiseSession) {
    engine.publishStatus(
      "Apply or cancel Noise before using history.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterLiquifySession) {
    engine.publishStatus(
      "Apply or cancel Liquify before using history.",
      "error",
    );
    return false;
  }
  if (engine.historyStateInconsistent) {
    engine.publishStatus("History is inconsistent. Reload the page.", "error");
    return false;
  }
  const nextCursor = engine.historyCursor + delta;
  if (
    nextCursor < 0
    || nextCursor > engine.historyActions.length
    || !historyCursorWithinRetainedRange(engine, nextCursor)
  ) {
    return false;
  }
  const crossedAction = delta < 0
    ? engine.historyActions[engine.historyCursor - 1]
    : engine.historyActions[engine.historyCursor];
  if (!crossedAction) return false;
  const rasterSourceTransition = rasterSourceHistoryTransition(crossedAction);
  const rasterEffectsTransition = rasterEffectsHistoryTransition(crossedAction);
  // The refusal lives here as well as in getHistoryState: reporting
  // canUndo=false only greys out a button, and the API is reachable directly.
  // A vanished layer is refused; scene reorder also refuses an old permutation
  // that is no longer legal under the current, non-journalled clipping map.
  // A step into another live layer still moves the active layer with the cursor.
  if (historyStepBlockedByLayer(engine, delta)) {
    const sceneReorderBlocked = crossedAction.kind === "scene-reorder";
    engine.publishStatus(
      sceneReorderBlocked
        ? "That reorder is no longer compatible with the current clipping groups."
        : delta < 0
        ? "The layer for that step no longer exists, so it cannot be undone."
        : "The layer for that step no longer exists, so it cannot be redone.",
      "error",
    );
    return false;
  }

  // A deep step may cross payloads whose authoritative copy is now in local
  // storage. Cancel fenced maintenance and hydrate both the target replay and
  // its rollback closure before the cursor or any pixels can change.
  cancelHistoryMaintenance(engine);
  engine.historyBusy = true;
  engine.publishHistoryState();
  try {
    await engine.historyLocalStorage.prepareHistoryStep(delta);
  } catch (error) {
    engine.historyBusy = false;
    const message = error instanceof Error ? error.message : String(error);
    engine.publishStatus(`Local Undo/Redo failed: ${message}`, "error");
    engine.publishHistoryState();
    throw error;
  }
  engine.historyBusy = false;

  const previousCursor = engine.historyCursor;
  let publishRasterSceneAfterUnlock = false;
  engine.cancelLayerColdCompressionIdle();
  engine.invalidateAdaptivePreview();
  engine.historyBusy = true;
  engine.publishHistoryState();
  engine.publishStatus(
    crossedAction.kind === "raster-filter" && crossedAction.filter === "rasterize-layer"
      ? delta < 0 ? "Undo: restoring layer effects…" : "Redo: rasterizing layer…"
      : crossedAction.kind === "raster-import"
      ? delta < 0 ? "Undo: removing raster image…" : "Redo: restoring raster image…"
      : crossedAction.kind === "layer-delete"
      ? delta < 0 ? "Undo: restoring layer…" : "Redo: deleting layer…"
      : crossedAction.kind === "layer-add"
      ? crossedAction.creation === "duplicate"
        ? delta < 0 ? "Undo: removing duplicate…" : "Redo: duplicating layer…"
        : delta < 0 ? "Undo: removing layer…" : "Redo: creating layer…"
      : crossedAction.kind === "layer-merge"
      ? delta < 0 ? "Undo: restoring merged items…" : "Redo: merging items…"
      : crossedAction.kind === "vector-rasterize"
      ? delta < 0 ? "Undo: restoring vector…" : "Redo: rasterizing vector…"
      : crossedAction.kind === "scene-reorder"
      ? delta < 0 ? "Undo: reordering layers…" : "Redo: reordering layers…"
      : crossedAction.kind === "document-background"
      ? delta < 0 ? "Undo: restoring document background…" : "Redo: restoring document background…"
      : crossedAction.kind === "layer-blend-mode"
      ? delta < 0 ? "Undo: restoring layer blend mode…" : "Redo: restoring layer blend mode…"
      : crossedAction.kind === "layer-metadata"
      ? delta < 0 ? "Undo: restoring layer property…" : "Redo: restoring layer property…"
      : crossedAction.kind === "vector"
      ? delta < 0 ? "Undo: restoring vector…" : "Redo: restoring vector…"
      : delta < 0
        ? "Undo: rebuilding layer…"
        : "Redo: rebuilding layer…",
    "working",
  );

  try {
    await engine.waitForIdle();
    if (crossedAction.kind === "document-background") {
      engine.applyDocumentBackgroundHistoryState(
        delta < 0 ? crossedAction.before : crossedAction.after,
      );
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Document background undone." : "Document background redone.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "vector-rasterize") {
      await applyVectorRasterizeHistory(engine, crossedAction, delta);
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Vector rasterization undo completed." : "Vector rasterization redo completed.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "layer-merge") {
      await applyLayerMergeHistory(engine, crossedAction, delta);
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Layer merge undo completed." : "Layer merge redo completed.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "raster-import") {
      await applyRasterImportHistory(engine, crossedAction, delta);
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Raster import undo completed." : "Raster import redo completed.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "layer-delete" || crossedAction.kind === "layer-add") {
      if (crossedAction.kind === "layer-delete") {
        await applyLayerDeleteHistory(engine, crossedAction, delta);
      } else {
        await applyLayerAddHistory(engine, crossedAction, delta);
      }
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      publishMixedScene(engine);
      engine.publishStatus(
        delta < 0 ? "Layer structure undo completed." : "Layer structure redo completed.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "layer-blend-mode") {
      const index = engine.layerStack.indexOfId(crossedAction.layerId);
      if (index < 0) {
        throw new Error(`Layer ${crossedAction.layerId} for the blend-mode change was not found.`);
      }
      await setLayerBlendMode(
        engine,
        index,
        delta < 0 ? crossedAction.before : crossedAction.after,
        true,
      );
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Layer blend-mode undo completed." : "Layer blend-mode redo completed.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "layer-metadata") {
      await applyRasterLayerMetadataHistoryState(
        engine,
        crossedAction,
        delta < 0 ? crossedAction.before : crossedAction.after,
      );
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Layer property undone." : "Layer property redone.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "scene-reorder") {
      await applyMixedSceneOrderState(
        engine,
        delta < 0 ? crossedAction.before : crossedAction.after,
        "history-replay",
      );
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Layer reorder undone." : "Layer reorder redone.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "vector") {
      await applyVectorHistoryState(engine, 
        delta < 0 ? crossedAction.delta.before : crossedAction.delta.after,
        "history-replay",
      );
      engine.history.setCursor(nextCursor);
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(delta < 0 ? "Undo completed." : "Redo completed.", "ok");
      return true;
    }
    // Cross-layer Undo/Redo is one transaction: switch, move the cursor, replay.
    // Any failure restores the target pixels under the OLD cursor before moving
    // the active layer back. Reversing that order would strand a partially
    // cleared target texture behind an apparently successful rollback.
    const previousActiveIndex = engine.layerStack.activeIndex;
    const targetIndex = historyStepTargetLayerIndex(engine, delta);
    const switched = targetIndex !== null && targetIndex !== previousActiveIndex;
    if (switched) {
      // Freeze both the visible effect result and the authoritative raw tiles
      // before the shared workbench is pointed elsewhere. Neither candidate is
      // published until its GPU copy completes.
      engine.persistActiveLayerState();
      await engine.prepareActiveLayerForSwitch();
    }
    let replayAttempted = false;
    let selectionRestored = false;
    const selectionTransform = crossedAction.kind === "raster-transform"
      && crossedAction.scope === "selection"
      ? crossedAction
      : null;
    const targetSelection = selectionTransform
      ? delta < 0 ? selectionTransform.selectionBefore : selectionTransform.selectionAfter
      : null;
    const expectedSelection = selectionTransform
      ? delta < 0 ? selectionTransform.selectionAfter : selectionTransform.selectionBefore
      : null;
    // Selection edits are intentionally not journal actions. Restore the mask
    // that travelled with this pixel transform only when the live mask still
    // descends from the opposite side of the same transition. A later
    // wand/lasso/color selection must survive raster Undo/Redo unchanged.
    const selectionCompareAndSwap = Boolean(
      targetSelection
      && expectedSelection
      && engine.pixelSelectionIdentity === expectedSelection.identity,
    );
    try {
      if (switched) {
        engine.layerStack.setActiveIndex(targetIndex);
        await engine.activateLayer(previousActiveIndex, "history-replay");
      }
      engine.history.setCursor(nextCursor);
      replayAttempted = true;
      if (rasterSourceTransition) {
        const targetRecord = engine.layerStack.byId(rasterSourceTransition.layerId);
        if (!targetRecord) {
          throw new Error(
            `Layer ${rasterSourceTransition.layerId} for the raster source was not found.`,
          );
        }
        targetRecord.rasterSource = cloneRasterLayerSource(
          delta < 0 ? rasterSourceTransition.before : rasterSourceTransition.after,
        );
      }
      if (rasterEffectsTransition) {
        const targetRecord = engine.layerStack.byId(rasterEffectsTransition.layerId);
        if (!targetRecord) {
          throw new Error(
            `Layer ${rasterEffectsTransition.layerId} for the raster effects was not found.`,
          );
        }
        applyRasterLayerEffects(
          targetRecord,
          delta < 0 ? rasterEffectsTransition.before : rasterEffectsTransition.after,
        );
      }
      await rebuildActiveLayerFromHistory(engine);
      if (rasterEffectsTransition) {
        await restoreEffectsWorkbenchToActiveLayer(
          engine,
          "history-replay",
          true,
          "content-bounds",
        );
      }
      if (selectionCompareAndSwap && targetSelection) {
        await restorePixelSelectionHistoryMask(engine, targetSelection);
        selectionRestored = true;
      }
    } catch (operationError) {
      engine.history.setCursor(previousCursor);
      const rollbackErrors: unknown[] = [];

      if (selectionRestored && expectedSelection) {
        try {
          await restorePixelSelectionHistoryMask(engine, expectedSelection);
          selectionRestored = false;
        } catch (restoreSelectionError) {
          rollbackErrors.push(restoreSelectionError);
        }
      }

      // If replay was entered, it may already have submitted a clear or one or
      // more batches. Restore the TARGET while it is still active and while the
      // cursor again describes the pre-operation document. A switched target
      // must then receive a fresh cold candidate before reverse activation is
      // allowed to release its repaired full texture.
      let targetPreparedForRelease = !replayAttempted;
      if (replayAttempted) {
        try {
          if (rasterSourceTransition) {
            const targetRecord = engine.layerStack.byId(rasterSourceTransition.layerId);
            if (!targetRecord) {
              throw new Error(
                `Layer ${rasterSourceTransition.layerId} is missing during raster-source rollback.`,
              );
            }
            targetRecord.rasterSource = cloneRasterLayerSource(
              delta < 0 ? rasterSourceTransition.after : rasterSourceTransition.before,
            );
          }
          if (rasterEffectsTransition) {
            const targetRecord = engine.layerStack.byId(rasterEffectsTransition.layerId);
            if (!targetRecord) {
              throw new Error(
                `Layer ${rasterEffectsTransition.layerId} is missing during raster-effects rollback.`,
              );
            }
            applyRasterLayerEffects(
              targetRecord,
              delta < 0 ? rasterEffectsTransition.after : rasterEffectsTransition.before,
            );
          }
          await rebuildActiveLayerFromHistory(engine);
          if (rasterEffectsTransition) {
            await restoreEffectsWorkbenchToActiveLayer(
              engine,
              "history-replay",
              true,
              "content-bounds",
            );
          }
          if (switched) {
            engine.persistActiveLayerState();
            await engine.prepareActiveLayerForSwitch();
          }
          targetPreparedForRelease = true;
        } catch (restoreTargetError) {
          rollbackErrors.push(restoreTargetError);
        }
      }

      // activateLayer itself can fail after binding engine fields and Blend but
      // before retargeting the effects workbench. switched is derived before
      // that await, so this reverse activation also repairs a half-switch. If
      // target recovery/packing failed, keep its full texture alive and latch
      // the document instead of silently discarding the only valid copy.
      if (switched && targetPreparedForRelease) {
        try {
          // A failed activation can leave the target hot while its pre-switch
          // cold store is still authoritative. Release that reconstructible
          // candidate before rehydrating the previous active layer.
          evictReconstructibleLayerResources(engine, engine.layerStack.at(targetIndex));
          engine.layerStack.setActiveIndex(previousActiveIndex);
          await engine.activateLayer(targetIndex, "history-replay");
        } catch (restoreSwitchError) {
          rollbackErrors.push(restoreSwitchError);
        }
      }

      if (rollbackErrors.length > 0) {
        const originalMessage = operationError instanceof Error
          ? operationError.message
          : String(operationError);
        const restoreMessage = rollbackErrors.map((rollbackError) =>
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        ).join("; ");
        // A damaged target or half-retargeted workbench is not safe to edit.
        // Latch historyBusy in finally; every existing mutation guard and the UI
        // already treats it as a hard lock, and only a reload clears the latch.
        engine.historyStateInconsistent = true;
      engine.publishStatus(
          "State is inconsistent after Undo/Redo. Reload before continuing.",
          "error",
        );
        throw new Error(
          `Undo/Redo failed (${originalMessage}) and restore failed (${restoreMessage}). `
          + "Reload the page before continuing.",
        );
      }
      throw operationError;
    }
    // Raster replay can change content bounds without switching scene items.
    // Publish the post-replay snapshot so the Transform overlay never keeps
    // the geometry from the action that was just undone/redone.
    publishRasterSceneAfterUnlock = true;
    if (switched) {
      engine.publishActiveLayerChange();
    }
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyReplayOperations += 1;
    }
    engine.publishStatus(
      rasterEffectsTransition
        ? delta < 0
          ? "Layer effects and source restored."
          : "Layer rasterization restored."
        : delta < 0 ? "Undo completed." : "Redo completed.",
      "ok",
    );
    return true;
  } finally {
    const stepCommitted = !engine.historyStateInconsistent
      && engine.historyCursor === nextCursor;
    if (stepCommitted) {
      try {
        await engine.waitForGpuCapped("Working set Undo/Redo", 60_000);
        engine.historyLocalStorage.trimHydratedWorkingSetAfterStep(delta);
      } catch {
        // The document transition already committed. Cache demotion is a
        // bounded-memory optimisation and may be retried after the next step.
      }
    }
    // A failed rollback is a terminal document state. Keeping historyBusy high
    // reuses every engine-side mutation guard and the UI lock; a status message
    // alone would still let the user continue painting on incoherent resources.
    engine.historyBusy = engine.historyStateInconsistent;
    if (!engine.historyStateInconsistent) {
      maybeReleaseIdleShapeResources(engine);
      maybeReleaseIdleGrainResources(engine);
    }
    if (publishRasterSceneAfterUnlock && !engine.historyStateInconsistent) {
      publishMixedScene(engine);
      engine.publishStats();
    }
    if (import.meta.env.DEV) {
      // A point that did not match this transaction must not ambush a later
      // unrelated Undo/Redo. Multi-point rollback probes are consumed before
      // this outer transaction finally runs.
      engine.historyReplayFaultQueue = [];
      engine.layerColdStorageFaultQueue = [];
    }
    engine.publishHistoryState();
    engine.scheduleEffectsScratchShrink();
    engine.scheduleBevelFieldShrink();
    engine.scheduleLayerColdCompression();
  }
}

export async function rebuildActiveLayerFromHistory(
  engine: BrushEngine,
  checkpointOverride?: RasterHistoryCheckpoint,
): Promise<void> {
  const layerId = engine.layerStack.active.id;
  const record = engine.layerStack.active;
  const restoredProjectBaseline = checkpointOverride
    ? undefined
    : engine.restoredProjectHistoryBaselines.get(layerId);
  // Set presentation policy before the first replay submission. Otherwise an
  // Undo across Noise could publish its final frame with the stale post-Noise
  // LOD policy and leave that cache visible until the next view interaction.
  const replayNoiseMipSmoothing = noiseMipSmoothingAfterHistory(
    engine.historyActions,
    engine.historyCursor,
    layerId,
    restoredProjectBaseline?.noiseMipSmoothing ?? false,
  );
  engine.layerStack.active.noiseMipSmoothing = replayNoiseMipSmoothing;
  if (checkpointOverride && checkpointOverride.layerId !== layerId) {
    throw new Error(
      `Checkpoint for layer ${checkpointOverride.layerId} was applied to active layer ${layerId}.`,
    );
  }
  const periodicSelection = checkpointOverride
    ? null
    : periodicCheckpointChainForReplay(engine, layerId);
  const replayPlan = checkpointOverride
    ? {
      periodicChain: [],
      seedAction: checkpointOverride,
      sessionBaseline: undefined,
      replayCheckpointActionIndex: engine.historyCursor - 1,
      visibleActionIds: new Set<number>(),
      batches: [],
    }
    : planRasterHistoryReplay({
      actions: engine.historyActions,
      cursor: engine.historyCursor,
      batches: engine.historyBatches,
      layerId,
      periodicSelection,
      sessionBaseline: restoredProjectBaseline,
    });
  const periodicChain = replayPlan.periodicChain;
  const seedAction = replayPlan.seedAction;
  const sessionBaseline = replayPlan.sessionBaseline;
  const visibleIds = replayPlan.visibleActionIds;
  const layerBatches = replayPlan.batches;
  const latestPeriodicCheckpoint = periodicChain.at(-1);
  const hasReplaySeed = Boolean(
    seedAction
    || periodicChain.length > 0
    || sessionBaseline,
  );
  const replaySeedBounds = latestPeriodicCheckpoint
    ? latestPeriodicCheckpoint.baseBounds
    : seedAction
      ? seedAction.baseBounds
      : sessionBaseline?.baseBounds ?? null;
  const replaySeedTileMask = latestPeriodicCheckpoint
    ? latestPeriodicCheckpoint.baseTileMask
    : seedAction
      ? seedAction.baseTileMask
      : sessionBaseline?.baseTileMask ?? null;
  const ensureReplayBrushAssets = async (
    settings: Exclude<HistoryRenderBatch, { kind: "fill" }>["settings"],
  ): Promise<void> => {
    if (settings.shape === "shape") {
      await engine.ensureShapeResources(
        shapeAssetIdForSettings(settings),
        shapeInvertForSettings(settings),
      );
    }
    if (isTexturizedGrainActive(settings)) {
      await engine.ensureGrainResources(grainAssetIdForSettings(settings));
    }
  };
  // Force the first historical Blend action to reset its persistent carrier,
  // even when its numeric id matches the last live action rendered.
  engine.blendRenderer?.beginStroke(0);
  let firstVisibleBatchIndex = -1;
  let lastVisibleBatchIndex = -1;
  const lastVisiblePaintBatchIndexByAction = new Map<number, number>();
  let firstReplaySubmitObserved = false;
  const observeReplaySubmit = (): void => {
    if (firstReplaySubmitObserved) {
      return;
    }
    firstReplaySubmitObserved = true;
    maybeInjectHistoryReplayFault(engine, "after-first-replay-submit");
  };
  let replaySubmissionCount = 0;
  const yieldReplaySubmit = async (): Promise<void> => {
    replaySubmissionCount += 1;
    if (replaySubmissionCount % 8 === 0) {
      await engine.waitForGpuCapped("Replay Undo/Redo", 60_000);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  };
  for (let index = 0; index < layerBatches.length; index += 1) {
    const batch = layerBatches[index];
    const visible = visibleIds.has(batch.actionId);
    if (!visible) {
      continue;
    }
    if (firstVisibleBatchIndex < 0) {
      firstVisibleBatchIndex = index;
    }
    lastVisibleBatchIndex = index;
    if (batch.kind === "paint") {
      lastVisiblePaintBatchIndexByAction.set(batch.actionId, index);
    }
  }

  try {
    if (hasReplaySeed) {
      // Structural seeds and periodic full+delta tile chains are authoritative
      // checkpoints. Clear first without publishing an intermediate frame.
      engine.submitImmediate(
        [],
        true,
        engine.settings,
        false,
        null,
      );
      observeReplaySubmit();
      await yieldReplaySubmit();
      const replaySeeds = periodicChain.length > 0
        ? periodicChain.flatMap((item) => item.seed ? [item.seed] : [])
        : seedAction?.seed ? [seedAction.seed] : [];
      if (replaySeeds.length > 0) {
        const hot = engine.requireLayerGpu(layerId).hot;
        if (!hot) throw new Error("The hot texture is missing for the raster checkpoint.");
        const encoder = engine.device.createCommandEncoder({
          label: `Replay tiled raster checkpoint for layer ${layerId}`,
        });
        for (const replaySeed of replaySeeds) {
          encodeLayerColdHydration(encoder, replaySeed, hot);
        }
        engine.device.queue.submit([encoder.finish()]);
        await yieldReplaySubmit();
      } else if (sessionBaseline?.compressed) {
        const hot = engine.requireLayerGpu(layerId).hot;
        if (!hot) throw new Error("The hot texture is missing for the project baseline.");
        // uploadCompressedLayerIntoHot validates ownership during every async
        // chunk. A short-lived owner lets the immutable saved payload hydrate
        // replay without making it authoritative layer storage again.
        const baselineOwner = createColdLayerGpuResources();
        baselineOwner.compressed = sessionBaseline.compressed;
        try {
          await uploadCompressedLayerIntoHot(
            engine,
            record,
            baselineOwner,
            sessionBaseline.compressed,
            hot,
          );
        } finally {
          baselineOwner.compressed = null;
        }
      }

      if (lastVisibleBatchIndex < 0) {
        // Present exactly once after clear plus optional hydration. A null seed
        // is the valid checkpoint for a transform fully outside the document.
        engine.submitImmediate(
          [],
          false,
          engine.settings,
          true,
          null,
          replaySeedBounds,
          true,
        );
        observeReplaySubmit();
        await yieldReplaySubmit();
      }
    }
    if (lastVisibleBatchIndex < 0) {
      if (!hasReplaySeed) {
        engine.submitImmediate([], true, engine.settings, true, null);
        observeReplaySubmit();
        await yieldReplaySubmit();
      }
    } else {
      const firstVisibleBatch = layerBatches[firstVisibleBatchIndex];
      if (!hasReplaySeed && !firstVisibleBatch.clearLayer) {
        // Il clear originale era un pass separato (per esempio dopo
        // "Pulisci"): manteniamo quel confine prima del primo batch visibile.
        engine.submitImmediate(
          [],
          true,
          firstVisibleBatch.kind === "fill" ? engine.settings : firstVisibleBatch.settings,
          false,
          null,
        );
        observeReplaySubmit();
        await yieldReplaySubmit();
      }

      for (let index = firstVisibleBatchIndex; index <= lastVisibleBatchIndex; index += 1) {
        const batch = layerBatches[index];
        if (batch.kind === "fill") {
          if (!visibleIds.has(batch.actionId)) {
            continue;
          }
          await engine.submitFillHistoryBatch(batch, index === lastVisibleBatchIndex);
          observeReplaySubmit();
          await yieldReplaySubmit();
          continue;
        }
        if (batch.kind === "blend") {
          if (!visibleIds.has(batch.actionId)) {
            continue;
          }
          await ensureReplayBrushAssets(batch.settings);
          engine.submitBlendImmediate(
            batch.batches,
            hasReplaySeed ? false : batch.clearLayer,
            batch.settings,
            batch.actionId,
            index === lastVisibleBatchIndex,
            batch,
          );
          observeReplaySubmit();
          await yieldReplaySubmit();
          continue;
        }
        if (!visibleIds.has(batch.actionId)) {
          continue;
        }

        await ensureReplayBrushAssets(batch.settings);

        if (usesStrokeGlazeRenderer(batch.settings)) {
          await engine.ensureLightGlazeResources(batch.settings.blendMode);
          const actionId = batch.actionId;
          if (!engine.lightGlazeSession) {
            engine.startLightGlazeSession(actionId, batch.settings);
          } else if (engine.lightGlazeSession.historyActionId !== actionId) {
            throw new Error("The historical Light Glaze order is invalid.");
          }
          const hasLaterBatchForAction =
            (lastVisiblePaintBatchIndexByAction.get(actionId) ?? index) > index;
          const replaySession = engine.lightGlazeSession;
          if (!replaySession) {
            throw new Error("The historical Light Glaze session is not initialized.");
          }
          replaySession.endRequested = !hasLaterBatchForAction;
          replaySession.commitRequested = !hasLaterBatchForAction;
        }

        engine.writeBrushUniforms(batch.settings);
        engine.submitImmediate(
          [],
          hasReplaySeed ? false : batch.clearLayer,
          batch.settings,
          index === lastVisibleBatchIndex,
          batch,
        );
        observeReplaySubmit();
        await yieldReplaySubmit();
      }
      if (engine.lightGlazeSession) {
        throw new Error("History reconstruction left a Light Glaze stroke open.");
      }
    }
  } finally {
    if (engine.lightGlazeSession) {
      engine.abandonLightGlazeSession();
    }
    // Ogni writeBuffer è ordinata sulla stessa GPUQueue: il ripristino arriva
    // dopo tutti i batch storici e prima di un eventuale tratto successivo.
    engine.writeBrushUniforms(engine.settings);
    if (isTexturizedGrainActive(engine.settings)) {
      await engine.ensureGrainResources(grainAssetIdForSettings(engine.settings));
      engine.writeGrainUniforms(engine.settings);
    } else {
      engine.grainDesiredAssetId = grainAssetIdForSettings(engine.settings);
    }
    if (engine.settings.shape === "shape") {
      await engine.ensureShapeResources(
        shapeAssetIdForSettings(engine.settings),
        shapeInvertForSettings(engine.settings),
      );
    } else {
      engine.shapeDesiredAssetId = shapeAssetIdForSettings(engine.settings);
      engine.shapeDesiredInvert = shapeInvertForSettings(engine.settings);
    }
    if (usesStrokeGlazeRenderer(engine.settings)) {
      await engine.ensureLightGlazeResources(engine.settings.blendMode);
    }
  }

  engine.clearRequested = false;
  if (hasReplaySeed && replaySeedTileMask) {
    let replayBounds = replaySeedBounds ? { ...replaySeedBounds } : null;
    record.storageTileMask.set(replaySeedTileMask);
    for (const batch of layerBatches) {
      if (!visibleIds.has(batch.actionId) || !batch.dirtyRect) continue;
      replayBounds = mergeDirtyRects(replayBounds, batch.dirtyRect);
      if (batch.kind === "fill") {
        for (let index = 0; index < batch.tileMask.length; index += 1) {
          record.storageTileMask[index] |= batch.tileMask[index];
        }
      } else {
        markLayerStorageRect(record.storageTileMask, batch.dirtyRect);
      }
    }
    engine.layerContentBounds = replayBounds;
  } else if (lastVisibleBatchIndex < 0) {
    engine.layerContentBounds = null;
    record.storageTileMask.fill(0);
  }
  engine.layerHasContent = Boolean(replaySeedBounds) || lastVisibleBatchIndex >= 0;
  record.contentBounds = engine.layerContentBounds;
  record.hasContent = engine.layerHasContent;
  // Checkpoint replay starts with an internal clear, which correctly resets
  // live metadata but must not erase the policy reconstructed for the final
  // historical raster lineage.
  record.noiseMipSmoothing = replayNoiseMipSmoothing;
  await engine.waitForGpuCapped("Complete Undo/Redo replay", 60_000);
  if (hasReplaySeed) {
    await restoreEffectsWorkbenchToActiveLayer(engine, "history-replay", true);
    engine.displayDirty = true;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.requestRender();
  } else {
    engine.displayDirty = false;
  }
}

export async function applyVectorHistoryState(engine: BrushEngine, 
  target: MixedSceneVectorHistoryState,
  caller: EffectsRetargetCaller = "layer-switch",
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const previousState = scene.captureVectorHistoryState(target.key);
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  const selectedKey = target.selectedKey.startsWith("raster:")
    ? `raster:${engine.layerStack.active.id}` as const
    : target.selectedKey;
  const normalizedTarget = selectedKey === target.selectedKey
    ? target
    : { ...target, selectedKey };
  engine.layerSwitchBusy = true;
  try {
    scene.restoreVectorHistoryState(normalizedTarget);
    const selected = scene.selected;
    engine.vectorTextPreviewExcludedNodeId = selected.kind === "text"
      ? selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    await engine.rebuildMergedLayerSurfaces(
      caller,
      engine.getVectorTextViewState(),
      { reuseUnchangedRasterRuns: true },
    );
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
  } catch (error) {
    scene.restoreVectorHistoryState(previousState);
    engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
    clearVectorTextPresentationForTransaction(engine);
    try {
      await engine.rebuildMergedLayerSurfaces(
        caller,
        engine.getVectorTextViewState(),
        { reuseUnchangedRasterRuns: true },
      );
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
    } catch (restoreError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      const combined = new Error(
        `Vector Undo/Redo failed (${originalMessage}) and restore failed `
        + `(${restoreMessage}). Reload the page.`,
      );
      engine.latchDocumentStateInconsistent(
        "State is inconsistent after vector Undo/Redo. Reload the page.",
        combined,
      );
      throw combined;
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    publishMixedScene(engine);
    engine.publishStats();
  }
}

export function recordBlendHistoryBatch(engine: BrushEngine, 
  pending: readonly PendingBlendBatch[],
  timing: SubmitTiming,
  clearLayer: boolean,
): void {
  if (pending.length === 0 || pending[0].actionId === 0) {
    return;
  }
  const actionId = pending[0].actionId;
  if (pending.some((entry) => entry.actionId !== actionId)) {
    if (timing.historyGpuSlice) engine.historyGpuStorage.release(timing.historyGpuSlice);
    throw new Error("A historical Blend batch contains multiple strokes.");
  }
  const renderer = engine.blendRenderer;
  const capturedSlice = timing.historyGpuSlice;
  if (!renderer || !capturedSlice) {
    if (capturedSlice) engine.historyGpuStorage.release(capturedSlice);
    throw new Error("The Blend history GPU payload is missing.");
  }
  const batches = pending.map((entry) => compactDryBlendHistoryGeometry(entry.batch));
  const expectedBytes = renderer.historyUniformBytes(batches);
  if (capturedSlice.logicalBytes !== expectedBytes) {
    engine.historyGpuStorage.release(capturedSlice);
    throw new Error(
      `Blend GPU payload is ${capturedSlice.logicalBytes} B; expected ${expectedBytes} B.`,
    );
  }
  const settings = pending[0].settings;
  const historyBatch = {
    kind: "blend",
    actionId,
    layerId: engine.layerStack.active.id,
    settings,
    batches,
    gpuSlice: capturedSlice,
    clearLayer,
    dirtyRect: timing.dirtyRect,
    shapeMaskIdentity: settings.shape === "shape" ? engine.shapeMaskIdentity : null,
    grainTextureIdentity: isTexturizedGrainActive(settings)
      ? engine.grainTextureIdentity
      : null,
  } satisfies HistoryRenderBatch;
  const actionAlreadyPublished = engine.historyActions.some((action) => action.id === actionId);
  const releasePayloadOnCancel = () => engine.historyGpuStorage.release(capturedSlice);
  if (actionAlreadyPublished) {
    engine.history.appendBatch(historyBatch, {
      storedBaseStamps: pending.length,
      releasePayloadOnCancel,
    });
  } else {
    engine.history.commitAction(
      {
        id: actionId,
        kind: "stroke",
        layerId: engine.layerStack.active.id,
      },
      {
        reservedActionId: true,
        batches: [historyBatch],
        storedBaseStamps: pending.length,
        releasePayloadOnCancel,
      },
    );
    engine.sweepRasterImageGpuResources();
    engine.publishHistoryState();
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
  }
  if (engine.activeStroke?.historyActionId === actionId) {
    engine.activeStroke.historyCommitted = true;
    engine.activeStroke.submitted = true;
  }
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.historyCapturedBaseStamps += pending.length;
    engine.activeStrokeProfile.historyCapturedBatches += 1;
  }
}

export interface HistoryIncrementalCompactionHooks {
  shouldContinue(): boolean;
  yieldTurn(): Promise<void>;
}

export interface HistoryIncrementalCompactionResult {
  readonly completed: boolean;
  readonly chunks: number;
  readonly yields: number;
  readonly releasedSlices: number;
}

/**
 * Releases an invalidated Redo branch only from fenced idle maintenance.
 * Every scan, release and metadata cleanup is bounded, yields to the browser,
 * and re-checks the interaction gate before touching the next chunk.
 */
export async function compactDiscardedHistoryIncrementally(
  engine: BrushEngine,
  hooks: HistoryIncrementalCompactionHooks,
): Promise<HistoryIncrementalCompactionResult> {
  if (!engine.historyCompactionPending) {
    return { completed: true, chunks: 0, yields: 0, releasedSlices: 0 };
  }

  const retainedActionIds = new Set<number>();
  const retainedVectorRasterIds = new Set<number>();
  const retainedImportIds = new Set<number>();
  const retainedTransformIds = new Set<number>();
  const retainedLayerAddIds = new Set<number>();
  const retainedLayerDeleteIds = new Set<number>();
  const retainedLayerMergeIds = new Set<number>();
  const retainedBatches: HistoryRenderBatch[] = [];
  const batchSlicesToRelease: GpuHistorySlice[] = [];
  const selectionRevisionsToRelease: Array<{
    revision: number;
    snapshot: { gpuSlice: GpuHistorySlice };
  }> = [];
  const transformSelectionSnapshotsToRelease: Array<{ gpuSlice: GpuHistorySlice }> = [];
  const retainedRasterImageAssetIds = new Set<string>();
  const rasterImageAssetIdsToDelete: string[] = [];
  const sliceIdsToRelease = new Set<number>();
  const selectionActionIdsToDelete: number[] = [];
  const vectorRasterActionsToDestroy: VectorRasterizeHistoryAction[] = [];
  const importActionsToDestroy: RasterImportHistoryAction[] = [];
  const transformActionsToDestroy: Array<
    RasterTransformHistoryAction | RasterFilterHistoryAction
  > = [];
  const layerAddActionsToDestroy: LayerAddHistoryAction[] = [];
  const layerDeleteActionsToDestroy: LayerDeleteHistoryAction[] = [];
  const layerMergeActionsToDestroy: LayerMergeHistoryAction[] = [];
  const releasedTransformSelectionSlices = new Set<number>();
  let retainedStampCount = 0;
  let chunks = 0;
  let yields = 0;
  let releasedSlices = 0;

  const abortResult = (): HistoryIncrementalCompactionResult => ({
    completed: false,
    chunks,
    yields,
    releasedSlices,
  });
  const reserveSliceToRelease = (slice: GpuHistorySlice): boolean => {
    if (sliceIdsToRelease.has(slice.id)) return false;
    sliceIdsToRelease.add(slice.id);
    return true;
  };
  const retainRasterImageNode = (
    node: MixedSceneVectorHistoryState["node"],
  ): void => {
    if (node?.kind === "image") retainedRasterImageAssetIds.add(node.document.assetId);
  };
  const retainRasterLayerSource = (
    source: { readonly document: { readonly assetId: string } } | null | undefined,
  ): void => {
    if (source) retainedRasterImageAssetIds.add(source.document.assetId);
  };
  const yieldBetweenPhases = async (worked: boolean): Promise<boolean> => {
    if (!worked) return hooks.shouldContinue();
    await hooks.yieldTurn();
    yields += 1;
    return hooks.shouldContinue();
  };
  const processArrayPhase = async <T>(
    values: readonly T[],
    process: (value: T) => void,
  ): Promise<boolean> => {
    const result = await processHistoryMaintenanceChunks(
      values.length,
      (start, end) => {
        for (let index = start; index < end; index += 1) process(values[index]);
      },
      hooks,
    );
    chunks += result.chunks;
    yields += result.yields;
    if (!result.completed) return false;
    return yieldBetweenPhases(values.length > 0);
  };
  const processIteratorPhase = async <T>(
    iterator: Iterator<T>,
    process: (value: T) => void,
  ): Promise<boolean> => {
    let worked = false;
    while (true) {
      if (!hooks.shouldContinue()) return false;
      let count = 0;
      let done = false;
      while (count < 64) {
        const next = iterator.next();
        if (next.done) {
          done = true;
          break;
        }
        process(next.value);
        count += 1;
        worked = true;
      }
      if (count > 0) chunks += 1;
      if (done) break;
      await hooks.yieldTurn();
      yields += 1;
      if (!hooks.shouldContinue()) return false;
    }
    return yieldBetweenPhases(worked);
  };
  const releaseSlicePhase = async <T>(
    values: readonly T[],
    sliceFor: (value: T) => GpuHistorySlice,
    beforeRelease?: (value: T) => void,
  ): Promise<boolean> => {
    const result = await processHistoryMaintenanceChunks(
      values.length,
      (start, end) => {
        const slices: GpuHistorySlice[] = [];
        for (let index = start; index < end; index += 1) {
          const value = values[index];
          beforeRelease?.(value);
          slices.push(sliceFor(value));
        }
        releasedSlices += engine.historyGpuStorage.releaseMany(slices);
      },
      hooks,
    );
    chunks += result.chunks;
    yields += result.yields;
    if (!result.completed) return false;
    return yieldBetweenPhases(values.length > 0);
  };

  if (!await processArrayPhase(engine.historyActions, (action) => {
    if (action.kind === "stroke" || action.kind === "fill") {
      retainedActionIds.add(action.id);
      retainRasterLayerSource(action.rasterSourceBefore);
      retainRasterLayerSource(action.rasterSourceAfter);
    } else if (action.kind === "vector-rasterize") {
      retainedVectorRasterIds.add(action.id);
      retainRasterImageNode(action.vectorState.node);
    } else if (action.kind === "raster-import") {
      retainedImportIds.add(action.id);
      retainRasterLayerSource(action.rasterSource);
    } else if (action.kind === "raster-transform" || action.kind === "raster-filter") {
      retainedTransformIds.add(action.id);
      retainRasterLayerSource(action.rasterSourceBefore);
      retainRasterLayerSource(action.rasterSourceAfter);
    } else if (action.kind === "layer-add") {
      retainedLayerAddIds.add(action.id);
      retainRasterLayerSource(action.layerRecord.rasterSource);
    } else if (action.kind === "layer-delete") {
      retainedLayerDeleteIds.add(action.id);
      for (const entry of action.entries) {
        retainRasterLayerSource(entry.layerRecord.rasterSource);
      }
    } else if (action.kind === "layer-merge") {
      retainedLayerMergeIds.add(action.id);
      for (const input of action.inputs) {
        if (input.kind === "vector" && input.state) retainRasterImageNode(input.state.node);
        if (input.kind === "raster") {
          retainRasterLayerSource(input.entry.layerRecord.rasterSource);
        }
      }
      retainRasterLayerSource(action.output.layerRecord.rasterSource);
    } else if (action.kind === "vector") {
      retainRasterImageNode(action.delta.before.node);
      retainRasterImageNode(action.delta.after.node);
    } else if (action.kind === "clear") {
      retainRasterLayerSource(action.rasterSourceBefore);
      retainRasterLayerSource(action.rasterSourceAfter);
    }
  })) return abortResult();

  if (!await processArrayPhase(engine.layerStack.layers, (record) => {
    retainRasterLayerSource(record.rasterSource);
  })) return abortResult();
  retainRasterLayerSource(engine.activeRasterTransformSession?.rasterSourceBefore);

  const scene = engine.mixedSceneStack;
  if (scene && !await processArrayPhase(scene.items, (item) => {
    if (item.kind === "image") retainRasterImageNode(scene.imageById(item.imageNodeId));
  })) return abortResult();

  if (!await processArrayPhase(engine.historyBatches, (batch) => {
    if (!retainedActionIds.has(batch.actionId)) {
      if (reserveSliceToRelease(batch.gpuSlice)) batchSlicesToRelease.push(batch.gpuSlice);
    } else {
      retainedBatches.push(batch);
      retainedStampCount += batch.kind === "paint"
        ? batch.stampCount
        : batch.kind === "blend"
          ? batch.batches.length
          : 0;
    }
  })) return abortResult();

  const retainedSelectionSnapshots = new Set<unknown>();
  if (!await processIteratorPhase(
    engine.selectionHistoryMasksByAction.entries(),
    ([actionId, snapshot]) => {
      if (!retainedActionIds.has(actionId)) {
        selectionActionIdsToDelete.push(actionId);
      } else {
        retainedSelectionSnapshots.add(snapshot);
      }
    },
  )) return abortResult();
  if (!await processIteratorPhase(
    engine.selectionHistoryMasksByRevision.entries(),
    ([revision, snapshot]) => {
      if (retainedSelectionSnapshots.has(snapshot)) return;
      if (reserveSliceToRelease(snapshot.gpuSlice)) {
        selectionRevisionsToRelease.push({ revision, snapshot });
      }
    },
  )) return abortResult();

  if (!await processArrayPhase(engine.discardedVectorRasterHistoryActions, (action) => {
    if (!retainedVectorRasterIds.has(action.id)) vectorRasterActionsToDestroy.push(action);
  })) return abortResult();
  if (!await processArrayPhase(engine.discardedRasterImportHistoryActions, (action) => {
    if (!retainedImportIds.has(action.id)) importActionsToDestroy.push(action);
  })) return abortResult();
  if (!await processArrayPhase(engine.discardedRasterTransformHistoryActions, (action) => {
    if (retainedTransformIds.has(action.id)) return;
    transformActionsToDestroy.push(action);
    if (action.kind === "raster-transform") {
      for (const snapshot of [action.selectionBefore, action.selectionAfter]) {
        if (!snapshot || releasedTransformSelectionSlices.has(snapshot.gpuSlice.id)) continue;
        releasedTransformSelectionSlices.add(snapshot.gpuSlice.id);
        if (reserveSliceToRelease(snapshot.gpuSlice)) {
          transformSelectionSnapshotsToRelease.push(snapshot);
        }
      }
    }
  })) return abortResult();
  if (!await processArrayPhase(engine.discardedLayerAddHistoryActions, (action) => {
    if (!retainedLayerAddIds.has(action.id)) layerAddActionsToDestroy.push(action);
  })) return abortResult();
  if (!await processArrayPhase(engine.discardedLayerDeleteHistoryActions, (action) => {
    if (!retainedLayerDeleteIds.has(action.id)) layerDeleteActionsToDestroy.push(action);
  })) return abortResult();
  if (!await processArrayPhase(engine.discardedLayerMergeHistoryActions, (action) => {
    if (!retainedLayerMergeIds.has(action.id)) layerMergeActionsToDestroy.push(action);
  })) return abortResult();
  if (!await processIteratorPhase(
    engine.rasterImageGpuResources.keys(),
    (assetId) => {
      if (!retainedRasterImageAssetIds.has(assetId)) rasterImageAssetIdsToDelete.push(assetId);
    },
  )) return abortResult();

  if (!await processArrayPhase(selectionActionIdsToDelete, (actionId) => {
    engine.selectionHistoryMasksByAction.delete(actionId);
  })) return abortResult();
  // Release one physical allocator batch per bounded browser turn. Any map or
  // bind-group reference is removed in the same synchronous chunk as its
  // slice, so an interaction starting at the following yield cannot reuse it.
  if (!await releaseSlicePhase(batchSlicesToRelease, (slice) => slice)) {
    return abortResult();
  }
  if (!await releaseSlicePhase(
    selectionRevisionsToRelease,
    (entry) => entry.snapshot.gpuSlice,
    (entry) => {
      engine.selectionHistoryClipBindGroups.delete(entry.snapshot.gpuSlice.id);
      engine.selectionHistoryMasksByRevision.delete(entry.revision);
    },
  )) return abortResult();
  if (!await releaseSlicePhase(
    transformSelectionSnapshotsToRelease,
    (snapshot) => snapshot.gpuSlice,
    (snapshot) => engine.selectionHistoryClipBindGroups.delete(snapshot.gpuSlice.id),
  )) return abortResult();

  if (!await processArrayPhase(vectorRasterActionsToDestroy, (action) => {
    destroyVectorRasterHistorySeed(action);
  })) return abortResult();
  if (!await processArrayPhase(importActionsToDestroy, (action) => {
    destroyRasterImportHistorySeed(action);
  })) return abortResult();
  if (!await processArrayPhase(transformActionsToDestroy, (action) => {
    destroyLayerColdStorage(action.seed);
    if (
      action.kind === "raster-filter"
      && action.filter === "rasterize-layer"
      && action.beforeSeed !== action.seed
    ) {
      destroyLayerColdStorage(action.beforeSeed);
    }
  })) return abortResult();
  if (!await processArrayPhase(layerAddActionsToDestroy, (action) => {
    destroyLayerColdStorage(action.seed);
  })) return abortResult();
  if (!await processArrayPhase(layerDeleteActionsToDestroy, (action) => {
    destroyLayerDeleteHistorySeeds(action);
  })) return abortResult();
  if (!await processArrayPhase(layerMergeActionsToDestroy, (action) => {
    destroyLayerMergeHistorySeeds(action);
  })) return abortResult();
  if (!await processArrayPhase(rasterImageAssetIdsToDelete, (assetId) => {
    const resource = engine.rasterImageGpuResources.get(assetId);
    if (!resource) return;
    resource.uniformBuffer.destroy();
    resource.texture.destroy();
    engine.rasterImageGpuResources.delete(assetId);
  })) return abortResult();
  if (!hooks.shouldContinue()) return abortResult();
  engine.history.completeRedoCompaction(retainedBatches, retainedStampCount);
  engine.historyGpuStorage.trimEmptyPages(true);
  return {
    completed: true,
    chunks,
    yields,
    releasedSlices,
  };
}

export function recordVectorHistoryAction(engine: BrushEngine, 
  before: MixedSceneVectorHistoryState,
  after: MixedSceneVectorHistoryState,
): boolean {
  if (vectorHistoryStatesEqual(before, after)) {
    return false;
  }
  commitHistoryActionAtomically(engine, {
    id: engine.nextHistoryActionId,
    kind: "vector",
    delta: { before, after },
  });
  engine.sweepRasterImageGpuResources();
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.historyCommittedActions += 1;
  }
  return true;
}

function captureMixedSceneOrderState(engine: BrushEngine): MixedSceneOrderState {
  const scene = requireMixedSceneStack(engine);
  return {
    bottomUpKeys: scene.items.map((item) => item.key),
    rasterLayerIds: engine.layerStack.layers.map((record) => record.id),
  };
}

function rasterOrderEntries(engine: BrushEngine) {
  return engine.layerStack.layers.map((record) => ({
    id: record.id,
    clippingParentId: record.clippingParentId,
  }));
}

export function getMixedSceneReorderTargets(
  engine: BrushEngine,
  key: MixedSceneItem["key"],
): MixedSceneReorderTargets {
  const scene = requireMixedSceneStack(engine);
  return mixedSceneReorderTargets(
    scene.items.map((item) => item.key),
    rasterOrderEntries(engine),
    key,
  );
}

/**
 * Publishes stable-id permutations and rebuilds presentation exactly once on
 * success. A failed composition restores only the two order arrays; textures,
 * raster pixels and semantic nodes are never copied into the rollback state.
 */
export async function applyMixedSceneOrderState(
  engine: BrushEngine,
  target: MixedSceneOrderState,
  caller: EffectsRetargetCaller = "layer-switch",
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const previous = captureMixedSceneOrderState(engine);
  const activeRasterId = engine.layerStack.active.id;
  const referenceRasterId = engine.layerStack.referenceLayerId;
  const selectedKey = scene.selected.key;
  const recordsById = new Map(
    engine.layerStack.layers.map((record) => [record.id, record]),
  );
  const targetRasterOrder = target.rasterLayerIds.map((id) => {
    const record = recordsById.get(id);
    if (!record) throw new Error(`Raster ${id} is missing from the reorder operation.`);
    return { id, clippingParentId: record.clippingParentId };
  });
  assertValidMixedSceneOrder(target.bottomUpKeys, targetRasterOrder);
  engine.layerSwitchBusy = true;
  try {
    await engine.waitForIdle();
    engine.layerStack.reorderByIds(target.rasterLayerIds);
    scene.reorderByKeys(target.bottomUpKeys);
    if (
      engine.layerStack.active.id !== activeRasterId
      || engine.layerStack.referenceLayerId !== referenceRasterId
      || scene.selected.key !== selectedKey
    ) {
      throw new Error("Reordering changed the selection, active raster, or reference.");
    }
    clearVectorTextPresentationForTransaction(engine);
    await engine.rebuildMergedLayerSurfaces(
      caller,
      engine.getVectorTextViewState(),
      { reuseUnchangedRasterRuns: true },
    );
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      engine.layerStack.reorderByIds(previous.rasterLayerIds);
      scene.reorderByKeys(previous.bottomUpKeys);
      clearVectorTextPresentationForTransaction(engine);
      await engine.rebuildMergedLayerSurfaces(
        caller,
        engine.getVectorTextViewState(),
        { reuseUnchangedRasterRuns: true },
      );
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((rollbackError) =>
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      ).join("; ");
      const combined = new Error(
        `Reorder failed (${originalMessage}) and restore failed (${rollbackMessage}).`,
      );
      engine.latchDocumentStateInconsistent(
        "State is inconsistent after reordering layers. Reload the page.",
        combined,
      );
      throw combined;
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    publishMixedScene(engine);
    engine.publishStats();
  }
}

function recordMixedSceneReorderHistoryAction(
  engine: BrushEngine,
  before: MixedSceneOrderState,
  after: MixedSceneOrderState,
): void {
  const action: MixedSceneReorderHistoryAction = {
    id: engine.nextHistoryActionId,
    kind: "scene-reorder",
    before,
    after,
  };
  commitHistoryActionAtomically(engine, action);
  // truncateRedoHistory may have dropped the last vector action retaining an
  // imported image asset. Match the vector recorder and release it immediately.
  engine.sweepRasterImageGpuResources();
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.historyCommittedActions += 1;
  }
}

export async function moveMixedSceneItem(
  engine: BrushEngine,
  key: MixedSceneItem["key"],
  targetTopFirstSlot: number,
): Promise<boolean> {
  if (!engine.initialized || engine.historyStateInconsistent) return false;
  engine.assertLayerSwitchAllowed();
  const before = captureMixedSceneOrderState(engine);
  const plan = planMixedSceneReorder(
    before.bottomUpKeys,
    rasterOrderEntries(engine),
    key,
    targetTopFirstSlot,
  );
  if (!plan.changed) return false;
  const after: MixedSceneOrderState = {
    bottomUpKeys: [...plan.bottomUpKeys],
    rasterLayerIds: [...plan.rasterLayerIds],
  };
  engine.cancelLayerColdCompressionIdle();
  await applyMixedSceneOrderState(engine, after);
  try {
    recordMixedSceneReorderHistoryAction(engine, before, after);
  } catch (error) {
    await applyMixedSceneOrderState(engine, before);
    throw error;
  }
  engine.publishHistoryState();
  return true;
}

export function scheduleHistoryGpuTrim(engine: BrushEngine): void {
  const generation = ++engine.historyGpuTrimGeneration;
  void engine.device.queue.onSubmittedWorkDone().then(() => {
    if (
      generation !== engine.historyGpuTrimGeneration
      || !engine.initialized
      || engine.deviceLostError
    ) {
      return;
    }
    engine.historyGpuStorage.trimEmptyPages(true);
    engine.publishStats();
  }).catch(() => {
    // device.lost è già gestito dal gate globale del motore.
  });
}

export function historyStepTargetLayerIndex(engine: BrushEngine, delta: -1 | 1): number | null {
  const action = delta < 0
    ? engine.historyActions[engine.historyCursor - 1]
    : engine.historyActions[engine.historyCursor];
  if (
    !action
    || action.kind === "vector"
    || action.kind === "document-background"
    || action.kind === "scene-reorder"
    || action.kind === "layer-metadata"
    || action.kind === "vector-rasterize"
    || action.kind === "raster-import"
    || action.kind === "layer-add"
    || action.kind === "layer-delete"
    || action.kind === "layer-merge"
  ) {
    return null;
  }
  const index = engine.layerStack.indexOfId(action.layerId);
  return index >= 0 ? index : null;
}

/**
 * Pubblica un'azione e abbandona il ramo Redo come un'unica transazione CPU.
 * Alcune azioni possiedono seed GPU: se `push` o il troncamento falliscono, la
 * stessa azione non puo' restare contemporaneamente viva nel journal e nella
 * lista che la manutenzione distruggera' piu' tardi.
 */
export function commitHistoryActionAtomically(
  engine: BrushEngine,
  action: HistoryAction,
  options: HistoryCommitOptions = {},
): void {
  if (
    action.kind === "stroke"
    || action.kind === "fill"
    || action.kind === "clear"
    || action.kind === "raster-filter"
  ) {
    const record = engine.layerStack.byId(action.layerId);
    if (record) {
      action.rasterSourceBefore = cloneRasterLayerSource(record.rasterSource);
      action.rasterSourceAfter = null;
    }
  }
  engine.history.commitAction(action, options);
  if (
    action.kind === "stroke"
    || action.kind === "fill"
    || action.kind === "clear"
    || action.kind === "raster-filter"
  ) {
    const record = engine.layerStack.byId(action.layerId);
    if (record) record.rasterSource = null;
  } else if (action.kind === "raster-transform") {
    const record = engine.layerStack.byId(action.layerId);
    if (record) {
      record.rasterSource = cloneRasterLayerSource(action.rasterSourceAfter);
    }
  }
}

export function historyStepBlockedByLayer(engine: BrushEngine, delta: -1 | 1): boolean {
  const action = delta < 0
    ? engine.historyActions[engine.historyCursor - 1]
    : engine.historyActions[engine.historyCursor];
  if (action?.kind === "document-background") return false;
  if (action?.kind === "layer-metadata") {
    if (!engine.layerStack.byId(action.layerId)) return true;
    if (action.property !== "clipping") return false;
    const target = delta < 0 ? action.before : action.after;
    return !engine.layerStack.isClippingHistoryStateApplicable(target);
  }
  if (action?.kind === "scene-reorder") {
    const target = delta < 0 ? action.before : action.after;
    const scene = engine.mixedSceneStack;
    if (!scene) return true;
    return !isMixedSceneOrderStateApplicable(
      target,
      scene.items.map((item) => item.key),
      rasterOrderEntries(engine),
    );
  }
  return historyStepTargetsMissingLayer(
    engine.historyActions,
    engine.historyCursor,
    delta,
    new Set(engine.layerStack.layers.map((record) => record.id)),
  );
}

export function maybeInjectHistoryReplayFault(engine: BrushEngine, point: HistoryReplayFaultPoint): void {
  if (!import.meta.env.DEV || engine.historyReplayFaultQueue[0] !== point) {
    return;
  }
  engine.historyReplayFaultQueue.shift();
  throw new Error(`Injected history fault: ${point}.`);
}

export function hasVisibleHistoryContent(engine: BrushEngine, layerId?: number): boolean {
  if (hasVisibleContent(engine.historyActions, engine.historyCursor, layerId)) return true;
  const baselineVisible = (targetLayerId: number): boolean => {
    const baseline = engine.restoredProjectHistoryBaselines.get(targetLayerId);
    return baseline !== undefined
      && baseline.baseBounds !== null
      && restoredProjectBaselineApplies(
        engine.historyActions,
        engine.historyCursor,
        targetLayerId,
      );
  };
  return layerId === undefined
    ? [...engine.restoredProjectHistoryBaselines.keys()].some(baselineVisible)
    : baselineVisible(layerId);
}
