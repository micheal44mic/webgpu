import type {
  BrushEngine,
} from "./brush-engine";
import {
  MixedSceneStack,
  type MixedSceneVectorHistoryState,
  type MixedSceneVectorKey,
} from "./mixed-scene-stack";
import {
  recordVectorHistoryAction,
} from "./engine-history-runtime";

import {
  clearVectorTextPresentationForTransaction,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-resources-runtime";

export async function mutateMixedScenePresentation<Result>(engine: BrushEngine,
  mutate: (scene: MixedSceneStack) => Result,
  history?: {
    targetKey?: MixedSceneVectorKey;
    addedKey?: (result: Result) => MixedSceneVectorKey;
    /** Share only readonly SVG/image documents in the rollback snapshot. */
    shareImmutableDocuments?: boolean;
  },
): Promise<Result> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const scene = requireMixedSceneStack(engine);
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const shareImmutableDocuments = history?.shareImmutableDocuments === true;
  const previousState = scene.captureState(shareImmutableDocuments);
  const historyBefore = history?.targetKey
    ? scene.captureVectorHistoryState(history.targetKey)
    : null;
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  try {
    engine.callbacks.onStatus?.("Preparazione della scena raster/testo…", "working");
    await engine.waitForIdle();
    const result = mutate(scene);
    const selected = scene.selected;
    engine.vectorTextPreviewExcludedNodeId = selected.kind === "text"
      ? selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.callbacks.onStatus?.("Composizione dei livelli raster/testo…", "working");
    await engine.rebuildMergedLayerSurfaces(
      "layer-switch",
      engine.getVectorTextViewState(),
      { reuseUnchangedRasterRuns: true },
    );
    engine.callbacks.onStatus?.("Scena raster/testo pronta.", "ok");
    if (history) {
      const targetKey = history.targetKey ?? history.addedKey?.(result);
      if (!targetKey) {
        throw new Error("Target vettoriale mancante per la cronologia.");
      }
      const before = historyBefore ?? {
        key: targetKey,
        index: -1,
        selectedKey: previousState.selectedKey,
        node: null,
      } satisfies MixedSceneVectorHistoryState;
      recordVectorHistoryAction(engine,
        before,
        scene.captureVectorHistoryState(targetKey),
      );
    }
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    return result;
  } catch (error) {
    scene.restoreState(previousState, shareImmutableDocuments);
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
        "Stato incoerente dopo la modifica della scena mista: ricarica la pagina.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Modifica scena fallita (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina.`,
      );
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    publishMixedScene(engine);
    engine.publishHistoryState();
    engine.publishStats();
  }
}
