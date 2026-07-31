import type { BrushEngine } from "./brush-engine";
import { evictReconstructibleLayerResources } from "./engine-cold-storage";
import {
  hasVisibleContent,
  historyStepTargetsMissingLayer,
  selectLayerReplay,
} from "./history-journal";
import { isTexturizedGrainActive, usesStrokeGlazeRenderer } from "./engine-strategies";
import { type MixedSceneVectorHistoryState } from "./mixed-scene-stack";
import {
  clearVectorTextPresentationForTransaction,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";
import { type PendingBlendBatch } from "./engine-stroke-types";
import { type SubmitTiming } from "./engine-stats";
import { compactDryBlendHistoryGeometry } from "./blend-renderer";
import { vectorHistoryStatesEqual, type HistoryRenderBatch } from "./engine-history-types";
import { type GpuHistorySlice } from "./gpu-history-storage";
import { type HistoryReplayFaultPoint } from "./engine-types";

export async function moveHistoryCursor(engine: BrushEngine, delta: -1 | 1): Promise<boolean> {
  if (
    !engine.initialized
    || engine.activeStroke
    || engine.historyBusy
    || engine.activeVectorHistoryEdit
  ) {
    return false;
  }
  if (engine.layerSwitchBusy) {
    return false;
  }
  const nextCursor = engine.historyCursor + delta;
  if (nextCursor < 0 || nextCursor > engine.historyActions.length) {
    return false;
  }
  const crossedAction = delta < 0
    ? engine.historyActions[engine.historyCursor - 1]
    : engine.historyActions[engine.historyCursor];
  if (!crossedAction) return false;
  // The refusal lives here as well as in getHistoryState: reporting
  // canUndo=false only greys out a button, and the API is reachable directly.
  // Only a vanished layer is refused now — a step into another live layer moves
  // the active layer with the cursor further down.
  if (historyStepBlockedByLayer(engine, delta)) {
    engine.callbacks.onStatus?.(
      delta < 0
        ? "Il livello di quel passo non esiste più: impossibile annullarlo."
        : "Il livello di quel passo non esiste più: impossibile ripristinarlo.",
      "error",
    );
    return false;
  }

  const previousCursor = engine.historyCursor;
  engine.cancelLayerColdCompressionIdle();
  engine.invalidateAdaptivePreview();
  engine.historyBusy = true;
  engine.publishHistoryState();
  engine.callbacks.onStatus?.(
    crossedAction.kind === "vector"
      ? delta < 0 ? "Undo: ripristino del vettore…" : "Redo: ripristino del vettore…"
      : delta < 0
        ? "Undo: ricostruzione del layer…"
        : "Redo: ricostruzione del layer…",
    "working",
  );

  try {
    await engine.waitForIdle();
    // Eventuali rami Redo già invalidati vengono liberati soltanto dentro
    // un'operazione esplicita, mai durante o subito dopo una pennellata.
    compactDiscardedHistory(engine);
    if (crossedAction.kind === "vector") {
      await applyVectorHistoryState(engine, 
        delta < 0 ? crossedAction.delta.before : crossedAction.delta.after,
      );
      engine.historyCursor = nextCursor;
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.historyReplayOperations += 1;
      }
      engine.callbacks.onStatus?.(delta < 0 ? "Undo completato." : "Redo completato.", "ok");
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
    try {
      if (switched) {
        engine.layerStack.setActiveIndex(targetIndex);
        await engine.activateLayer(previousActiveIndex, "history-replay");
      }
      engine.historyCursor = nextCursor;
      replayAttempted = true;
      await rebuildActiveLayerFromHistory(engine);
    } catch (operationError) {
      engine.historyCursor = previousCursor;
      const rollbackErrors: unknown[] = [];

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
        engine.callbacks.onStatus?.(
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
    if (switched) {
      engine.callbacks.onActiveLayerChange?.(engine.layerStack.activeIndex);
    }
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyReplayOperations += 1;
    }
    engine.callbacks.onStatus?.(
      delta < 0 ? "Undo completato." : "Redo completato.",
      "ok",
    );
    return true;
  } finally {
    // A failed rollback is a terminal document state. Keeping historyBusy high
    // reuses every engine-side mutation guard and the UI lock; a status message
    // alone would still let the user continue painting on incoherent resources.
    engine.historyBusy = engine.historyStateInconsistent;
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
  const {
    batches: layerBatches,
    visibleStrokeIds: visibleIds,
  } = selectLayerReplay(
    engine.historyActions,
    engine.historyCursor,
    engine.historyBatches,
    layerId,
  );
  if (layerBatches.some((batch) => batch.grainTextureIdentity !== null)) {
    await engine.ensureGrainResources();
  }
  if (layerBatches.some((batch) => batch.settings.shape === "shape")) {
    await engine.ensureShapeResources();
  }
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
    if (lastVisibleBatchIndex < 0) {
      engine.submitImmediate([], true, engine.settings, true, null);
      observeReplaySubmit();
      await yieldReplaySubmit();
    } else {
      const firstVisibleBatch = layerBatches[firstVisibleBatchIndex];
      if (!firstVisibleBatch.clearLayer) {
        // Il clear originale era un pass separato (per esempio dopo
        // "Pulisci"): manteniamo quel confine prima del primo batch visibile.
        engine.submitImmediate([], true, firstVisibleBatch.settings, false, null);
        observeReplaySubmit();
        await yieldReplaySubmit();
      }

      for (let index = firstVisibleBatchIndex; index <= lastVisibleBatchIndex; index += 1) {
        const batch = layerBatches[index];
        if (batch.kind === "blend") {
          if (!visibleIds.has(batch.actionId)) {
            continue;
          }
          engine.submitBlendImmediate(
            batch.batches,
            batch.clearLayer,
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
          batch.clearLayer,
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
      engine.writeGrainUniforms(engine.settings);
    }
    if (usesStrokeGlazeRenderer(engine.settings)) {
      await engine.ensureLightGlazeResources(engine.settings.blendMode);
    }
  }

  engine.clearRequested = false;
  engine.displayDirty = false;
  engine.layerHasContent = lastVisibleBatchIndex >= 0;
  await engine.waitForGpuCapped("Completamento replay Undo/Redo", 60_000);
}

export async function applyVectorHistoryState(engine: BrushEngine, 
  target: MixedSceneVectorHistoryState,
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
      "layer-switch",
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
        "layer-switch",
        engine.getVectorTextViewState(),
        { reuseUnchangedRasterRuns: true },
      );
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo Undo/Redo vettoriale: ricarica la pagina.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Undo/Redo vettoriale fallito (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina.`,
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
    shapeMaskIdentity: engine.shapeMaskIdentity,
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

export function compactDiscardedHistory(engine: BrushEngine): void {
  if (!engine.historyCompactionPending) {
    return;
  }

  const retainedActionIds = new Set(
    engine.historyActions
      .filter((action) => action.kind === "stroke")
      .map((action) => action.id),
  );

  const retainedBatches: HistoryRenderBatch[] = [];
  const discardedSlices: GpuHistorySlice[] = [];
  let retainedStampCount = 0;
  for (const batch of engine.historyBatches) {
    if (!retainedActionIds.has(batch.actionId)) {
      discardedSlices.push(batch.gpuSlice);
      continue;
    }
    retainedBatches.push(batch);
    retainedStampCount += batch.kind === "paint"
      ? batch.stampCount
      : batch.batches.length;
  }
  engine.historyGpuStorage.releaseMany(discardedSlices);
  engine.historyBatches = retainedBatches;
  engine.historyStoredBaseStamps = retainedStampCount;
  engine.historyCompactionPending = false;
  scheduleHistoryGpuTrim(engine);
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
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.historyCommittedActions += 1;
  }
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
  if (!action || action.kind === "vector") {
    return null;
  }
  const index = engine.layerStack.indexOfId(action.layerId);
  return index >= 0 ? index : null;
}

export function truncateRedoHistory(engine: BrushEngine): void {
  if (engine.historyCursor >= engine.historyActions.length) {
    return;
  }
  engine.historyActions.length = engine.historyCursor;

  // Il primo stamp dopo un Undo deve restare O(1): i payload abbandonati
  // vengono esclusi subito e liberati alla prossima operazione esplicita.
  engine.historyCompactionPending = true;
}

export function historyStepBlockedByLayer(engine: BrushEngine, delta: -1 | 1): boolean {
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
