import type { BrushEngine } from "./brush-engine";
import type { EffectsRetargetCaller } from "./engine-layer-resources";
import {
  destroyLayerColdStorage,
  encodeLayerColdHydration,
  evictReconstructibleLayerResources,
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
import { planRasterHistoryReplay } from "./history-replay-plan";
import { noiseMipSmoothingAfterHistory } from "./noise-mip-smoothing-core";

export function captureRasterLayerMetadataHistoryState(
  engine: BrushEngine,
  layerId: number,
  property: RasterLayerMetadataHistoryProperty,
): RasterLayerMetadataHistoryState {
  const record = engine.layerStack.byId(layerId);
  if (!record) throw new Error(`Livello ${layerId} assente dalla cronologia metadata.`);
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
    throw new Error("Una modifica metadata non può cambiare livello o proprietà durante il gesto.");
  }
  if (rasterLayerMetadataHistoryStatesEqual(before, after)) return false;
  truncateRedoHistory(engine);
  engine.historyActions.push({
    id: engine.nextHistoryActionId++,
    kind: "layer-metadata",
    layerId: before.layerId,
    property,
    before: before.value,
    after: after.value,
  } as RasterLayerMetadataHistoryAction);
  engine.historyCursor = engine.historyActions.length;
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.historyCommittedActions += 1;
  }
  return true;
}

function assignRasterLayerMetadataHistoryValue(
  engine: BrushEngine,
  action: RasterLayerMetadataHistoryAction,
  target: RasterLayerMetadataHistoryAction["before"],
): void {
  const record = engine.layerStack.byId(action.layerId);
  if (!record) throw new Error(`Livello ${action.layerId} della proprietà non trovato.`);
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
        "Stato incoerente dopo Undo/Redo delle proprietà raster: ricarica la pagina.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Undo/Redo proprietà raster fallito (${originalMessage}) e ripristino fallito `
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
      "Applica o annulla la trasformazione prima di usare la cronologia.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterGaussianBlurSession) {
    engine.publishStatus(
      "Applica o annulla Gaussian Blur prima di usare la cronologia.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterMotionBlurSession) {
    engine.publishStatus(
      "Applica o annulla Motion Blur prima di usare la cronologia.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterNoiseSession) {
    engine.publishStatus(
      "Applica o annulla Noise prima di usare la cronologia.",
      "error",
    );
    return false;
  }
  if (engine.activeRasterLiquifySession) {
    engine.publishStatus(
      "Applica o annulla Liquify prima di usare la cronologia.",
      "error",
    );
    return false;
  }
  if (engine.historyStateInconsistent) {
    engine.publishStatus("La cronologia è incoerente: ricarica la pagina.", "error");
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
  // The refusal lives here as well as in getHistoryState: reporting
  // canUndo=false only greys out a button, and the API is reachable directly.
  // A vanished layer is refused; scene reorder also refuses an old permutation
  // that is no longer legal under the current, non-journalled clipping map.
  // A step into another live layer still moves the active layer with the cursor.
  if (historyStepBlockedByLayer(engine, delta)) {
    const sceneReorderBlocked = crossedAction.kind === "scene-reorder";
    engine.publishStatus(
      sceneReorderBlocked
        ? "Quel riordino non è più compatibile con i gruppi di clipping attuali."
        : delta < 0
        ? "Il livello di quel passo non esiste più: impossibile annullarlo."
        : "Il livello di quel passo non esiste più: impossibile ripristinarlo.",
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
    engine.publishStatus(`Undo/Redo locale non riuscito: ${message}`, "error");
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
    crossedAction.kind === "raster-import"
      ? delta < 0 ? "Undo: rimozione immagine raster…" : "Redo: ripristino immagine raster…"
      : crossedAction.kind === "layer-delete"
      ? delta < 0 ? "Undo: ripristino livello…" : "Redo: eliminazione livello…"
      : crossedAction.kind === "layer-add"
      ? crossedAction.creation === "duplicate"
        ? delta < 0 ? "Undo: rimozione duplicato…" : "Redo: duplicazione livello…"
        : delta < 0 ? "Undo: rimozione livello…" : "Redo: creazione livello…"
      : crossedAction.kind === "layer-merge"
      ? delta < 0 ? "Undo: ripristino elementi uniti…" : "Redo: unione elementi…"
      : crossedAction.kind === "vector-rasterize"
      ? delta < 0 ? "Undo: ripristino del vettore…" : "Redo: rasterizzazione vettoriale…"
      : crossedAction.kind === "scene-reorder"
      ? delta < 0 ? "Undo: riordino livelli…" : "Redo: riordino livelli…"
      : crossedAction.kind === "layer-blend-mode"
      ? delta < 0 ? "Undo: fusione livello…" : "Redo: fusione livello…"
      : crossedAction.kind === "layer-metadata"
      ? delta < 0 ? "Undo: proprietà livello…" : "Redo: proprietà livello…"
      : crossedAction.kind === "vector"
      ? delta < 0 ? "Undo: ripristino del vettore…" : "Redo: ripristino del vettore…"
      : delta < 0
        ? "Undo: ricostruzione del layer…"
        : "Redo: ricostruzione del layer…",
    "working",
  );

  try {
    await engine.waitForIdle();
    if (crossedAction.kind === "vector-rasterize") {
      await applyVectorRasterizeHistory(engine, crossedAction, delta);
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Undo rasterizzazione vettoriale completato." : "Redo rasterizzazione vettoriale completato.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "layer-merge") {
      await applyLayerMergeHistory(engine, crossedAction, delta);
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Undo unione livelli completato." : "Redo unione livelli completato.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "raster-import") {
      await applyRasterImportHistory(engine, crossedAction, delta);
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Undo importazione raster completato." : "Redo importazione raster completato.",
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
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      publishMixedScene(engine);
      engine.publishStatus(
        delta < 0 ? "Undo struttura livelli completato." : "Redo struttura livelli completato.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "layer-blend-mode") {
      const index = engine.layerStack.indexOfId(crossedAction.layerId);
      if (index < 0) {
        throw new Error(`Livello ${crossedAction.layerId} della fusione non trovato.`);
      }
      await setLayerBlendMode(
        engine,
        index,
        delta < 0 ? crossedAction.before : crossedAction.after,
        true,
      );
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Undo fusione livello completato." : "Redo fusione livello completato.",
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
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Proprietà livello annullata." : "Proprietà livello ripristinata.",
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
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(
        delta < 0 ? "Riordino livelli annullato." : "Riordino livelli ripristinato.",
        "ok",
      );
      return true;
    }
    if (crossedAction.kind === "vector") {
      await applyVectorHistoryState(engine, 
        delta < 0 ? crossedAction.delta.before : crossedAction.delta.after,
        "history-replay",
      );
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.publishStatus(delta < 0 ? "Undo completato." : "Redo completato.", "ok");
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
      engine.historyCursor = nextCursor;
      replayAttempted = true;
      await rebuildActiveLayerFromHistory(engine);
      if (selectionCompareAndSwap && targetSelection) {
        await restorePixelSelectionHistoryMask(engine, targetSelection);
        selectionRestored = true;
      }
    } catch (operationError) {
      engine.historyCursor = previousCursor;
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
          await rebuildActiveLayerFromHistory(engine);
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
          "Stato incoerente dopo Undo/Redo: ricarica prima di continuare.",
          "error",
        );
        throw new Error(
          `Undo/Redo non riuscito (${originalMessage}) e ripristino fallito (${restoreMessage}). `
          + "Ricarica la pagina prima di continuare.",
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
      delta < 0 ? "Undo completato." : "Redo completato.",
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

export async function rebuildActiveLayerFromHistory(engine: BrushEngine): Promise<void> {
  const layerId = engine.layerStack.active.id;
  // Set presentation policy before the first replay submission. Otherwise an
  // Undo across Noise could publish its final frame with the stale post-Noise
  // LOD policy and leave that cache visible until the next view interaction.
  const replayNoiseMipSmoothing = noiseMipSmoothingAfterHistory(
    engine.historyActions,
    engine.historyCursor,
    layerId,
  );
  engine.layerStack.active.noiseMipSmoothing = replayNoiseMipSmoothing;
  const periodicSelection = periodicCheckpointChainForReplay(engine, layerId);
  const replayPlan = planRasterHistoryReplay({
    actions: engine.historyActions,
    cursor: engine.historyCursor,
    batches: engine.historyBatches,
    layerId,
    periodicSelection,
  });
  const periodicChain = replayPlan.periodicChain;
  const seedAction = replayPlan.seedAction;
  const replayCheckpointActionIndex = replayPlan.replayCheckpointActionIndex;
  const visibleIds = replayPlan.visibleActionIds;
  const layerBatches = replayPlan.batches;
  const latestPeriodicCheckpoint = periodicChain.at(-1);
  const hasReplaySeed = Boolean(seedAction || periodicChain.length > 0);
  const replaySeedBounds = latestPeriodicCheckpoint
    ? latestPeriodicCheckpoint.baseBounds
    : seedAction?.baseBounds ?? null;
  const replaySeedTileMask = latestPeriodicCheckpoint
    ? latestPeriodicCheckpoint.baseTileMask
    : seedAction?.baseTileMask ?? null;
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
        if (!hot) throw new Error("Texture hot mancante per il checkpoint raster.");
        const encoder = engine.device.createCommandEncoder({
          label: `Replay checkpoint tiled raster livello ${layerId}`,
        });
        for (const replaySeed of replaySeeds) {
          encodeLayerColdHydration(encoder, replaySeed, hot);
        }
        engine.device.queue.submit([encoder.finish()]);
        await yieldReplaySubmit();
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
            throw new Error("Ordine storico Light Glaze non valido.");
          }
          const hasLaterBatchForAction =
            (lastVisiblePaintBatchIndexByAction.get(actionId) ?? index) > index;
          const replaySession = engine.lightGlazeSession;
          if (!replaySession) {
            throw new Error("Sessione Light Glaze storica non inizializzata.");
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
        throw new Error("La ricostruzione storica ha lasciato un tratto Light Glaze aperto.");
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
  const record = engine.layerStack.active;
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
  await engine.waitForGpuCapped("Completamento replay Undo/Redo", 60_000);
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
        `Undo/Redo vettoriale fallito (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina.`,
      );
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo Undo/Redo vettoriale: ricarica la pagina.",
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
    throw new Error("Un batch storico Blend contiene più pennellate.");
  }
  const renderer = engine.blendRenderer;
  const capturedSlice = timing.historyGpuSlice;
  if (!renderer || !capturedSlice) {
    if (capturedSlice) engine.historyGpuStorage.release(capturedSlice);
    throw new Error("Payload GPU della cronologia Blend mancante.");
  }
  const batches = pending.map((entry) => compactDryBlendHistoryGeometry(entry.batch));
  const expectedBytes = renderer.historyUniformBytes(batches);
  if (capturedSlice.logicalBytes !== expectedBytes) {
    engine.historyGpuStorage.release(capturedSlice);
    throw new Error(
      `Payload GPU Blend ${capturedSlice.logicalBytes} B, attesi ${expectedBytes} B.`,
    );
  }
  if (engine.activeStroke?.historyActionId === actionId) {
    engine.activeStroke.submitted = true;
  }
  const settings = pending[0].settings;
  engine.historyBatches.push({
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
  });
  engine.historyStoredBaseStamps += pending.length;
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
    } else if (action.kind === "vector-rasterize") {
      retainedVectorRasterIds.add(action.id);
      retainRasterImageNode(action.vectorState.node);
    } else if (action.kind === "raster-import") {
      retainedImportIds.add(action.id);
    } else if (action.kind === "raster-transform" || action.kind === "raster-filter") {
      retainedTransformIds.add(action.id);
    } else if (action.kind === "layer-add") {
      retainedLayerAddIds.add(action.id);
    } else if (action.kind === "layer-delete") {
      retainedLayerDeleteIds.add(action.id);
    } else if (action.kind === "layer-merge") {
      retainedLayerMergeIds.add(action.id);
      for (const input of action.inputs) {
        if (input.kind === "vector" && input.state) retainRasterImageNode(input.state.node);
      }
    } else if (action.kind === "vector") {
      retainRasterImageNode(action.delta.before.node);
      retainRasterImageNode(action.delta.after.node);
    }
  })) return abortResult();

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
  engine.historyBatches = retainedBatches;
  engine.historyStoredBaseStamps = retainedStampCount;
  engine.discardedVectorRasterHistoryActions = [];
  engine.discardedRasterImportHistoryActions = [];
  engine.discardedLayerAddHistoryActions = [];
  engine.discardedLayerDeleteHistoryActions = [];
  engine.discardedLayerMergeHistoryActions = [];
  engine.discardedRasterTransformHistoryActions = [];
  engine.historyCompactionPending = false;
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
  truncateRedoHistory(engine);
  engine.historyActions.push({
    id: engine.nextHistoryActionId++,
    kind: "vector",
    delta: { before, after },
  });
  engine.historyCursor = engine.historyActions.length;
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
    if (!record) throw new Error(`Raster ${id} assente dal riordino.`);
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
      throw new Error("Il riordino ha cambiato selezione, raster attivo o riferimento.");
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
        `Riordino fallito (${originalMessage}) e ripristino fallito (${rollbackMessage}).`,
      );
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo il riordino livelli: ricarica la pagina.",
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
  truncateRedoHistory(engine);
  engine.historyActions.push(action);
  engine.nextHistoryActionId += 1;
  engine.historyCursor = engine.historyActions.length;
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
): void {
  const actionIdBefore = engine.nextHistoryActionId;
  if (action.id !== actionIdBefore) {
    throw new Error(
      `ID azione history ${action.id} inatteso; prossimo ID ${actionIdBefore}.`,
    );
  }
  const cursorBefore = engine.historyCursor;
  const redoActions = engine.historyActions.slice(cursorBefore);
  const discardedVectorLength = engine.discardedVectorRasterHistoryActions.length;
  const discardedImportLength = engine.discardedRasterImportHistoryActions.length;
  const discardedTransformLength = engine.discardedRasterTransformHistoryActions.length;
  const discardedLayerAddLength = engine.discardedLayerAddHistoryActions.length;
  const discardedLayerDeleteLength = engine.discardedLayerDeleteHistoryActions.length;
  const discardedLayerMergeLength = engine.discardedLayerMergeHistoryActions.length;
  const compactionPendingBefore = engine.historyCompactionPending;
  try {
    truncateRedoHistory(engine);
    engine.historyActions.push(action);
    engine.nextHistoryActionId = actionIdBefore + 1;
    engine.historyCursor = engine.historyActions.length;
  } catch (error) {
    // Non usare l'eventuale `push` sovrascritto dal fault test anche per il
    // ripristino: assegnare per indice ricostruisce esattamente il ramo.
    engine.historyActions.length = cursorBefore;
    for (let index = 0; index < redoActions.length; index += 1) {
      engine.historyActions[cursorBefore + index] = redoActions[index];
    }
    engine.historyCursor = cursorBefore;
    engine.nextHistoryActionId = actionIdBefore;
    engine.discardedVectorRasterHistoryActions.length = discardedVectorLength;
    engine.discardedRasterImportHistoryActions.length = discardedImportLength;
    engine.discardedRasterTransformHistoryActions.length = discardedTransformLength;
    engine.discardedLayerAddHistoryActions.length = discardedLayerAddLength;
    engine.discardedLayerDeleteHistoryActions.length = discardedLayerDeleteLength;
    engine.discardedLayerMergeHistoryActions.length = discardedLayerMergeLength;
    engine.historyCompactionPending = compactionPendingBefore;
    throw error;
  }
}

export function truncateRedoHistory(engine: BrushEngine): void {
  if (engine.historyCursor >= engine.historyActions.length) {
    return;
  }
  for (const action of engine.historyActions.slice(engine.historyCursor)) {
    if (action.kind === "vector-rasterize") {
      engine.discardedVectorRasterHistoryActions.push(action);
    } else if (action.kind === "raster-import") {
      engine.discardedRasterImportHistoryActions.push(action);
    } else if (action.kind === "raster-transform" || action.kind === "raster-filter") {
      engine.discardedRasterTransformHistoryActions.push(action);
    } else if (action.kind === "layer-add") {
      engine.discardedLayerAddHistoryActions.push(action);
    } else if (action.kind === "layer-delete") {
      // Senza questo ogni cancellazione superata dal Redo perde il suo seed:
      // 16 MiB a 2048²/rgba8, che nessuno liberera` mai.
      engine.discardedLayerDeleteHistoryActions.push(action);
    } else if (action.kind === "layer-merge") {
      engine.discardedLayerMergeHistoryActions.push(action);
    }
  }
  engine.historyActions.length = engine.historyCursor;
  engine.historyLocalStorage.noteBranchCut();

  // Il primo stamp dopo un Undo deve restare O(1): i payload abbandonati
  // vengono esclusi subito e liberati dalla manutenzione idle dopo una fence.
  engine.historyCompactionPending = true;
  // Il ramo appena escluso puo' essere l'ultimo proprietario logico di un
  // effetto annullato. La reclamazione e' differita e rifara' il controllo di
  // raggiungibilita' dopo che tratto, frame e fence GPU sono terminati.
  engine.scheduleEffectsScratchShrink();
}

export function historyStepBlockedByLayer(engine: BrushEngine, delta: -1 | 1): boolean {
  const action = delta < 0
    ? engine.historyActions[engine.historyCursor - 1]
    : engine.historyActions[engine.historyCursor];
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
  throw new Error(`Guasto iniettato nella cronologia: ${point}.`);
}

export function hasVisibleHistoryContent(engine: BrushEngine, layerId?: number): boolean {
  return hasVisibleContent(engine.historyActions, engine.historyCursor, layerId);
}
