import type {
  BrushEngine,
  HistoryReplayFaultPoint,
  HistoryState,
} from "./brush-engine";

export const LAYER_HISTORY_GPU_TEST_VERSION = 2 as const;

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayerHistoryGpuTestReport {
  version: typeof LAYER_HISTORY_GPU_TEST_VERSION;
  passed: boolean;
  checks: Record<string, boolean>;
  alphaPixels: {
    layerAStrokeP: number;
    layerARegionQ: number;
    layerBBeforeUndoRegionP: number;
    layerBBeforeUndoStrokeQ: number;
    layerBAfterUndoRegionP: number;
    layerBAfterUndoRegionQ: number;
    layerBAfterRedoStrokeQ: number;
  };
  differingBytes: {
    layerAAfterPaintingB: number;
    layerAAfterUndo: number;
    layerAAfterRedo: number;
    layerBRedoVersusBeforeUndo: number;
  };
  history: {
    beforeUndo: HistoryState;
    afterUndo: HistoryState;
    afterCrossLayerUndo: HistoryState;
    afterCrossLayerRedo: HistoryState;
    afterRedo: HistoryState;
    afterFatalRollback: HistoryState;
  };
  partialReplayRollback: RollbackProbe;
  switchActivationRollback: RollbackProbe;
  fatalRollback: RollbackProbe;
  operations: {
    undoReturned: boolean;
    crossLayerUndoReturned: boolean;
    crossLayerRedoReturned: boolean;
    redoReturned: boolean;
    fatalPreparationUndoReturned: boolean;
    fatalFollowUpUndoReturned: boolean;
  };
}

interface RollbackProbe {
  threw: boolean;
  cursorRestored: boolean;
  activeLayerRestored: boolean;
  workingSetMatchesActiveLayer: boolean;
  historyBusy: boolean;
  historyInconsistent: boolean;
  canUndo: boolean;
  canRedo: boolean;
  layerADifferingBytes: number;
  layerBDifferingBytes: number;
}

function countNonZeroAlpha(pixels: Uint8Array): number {
  let count = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      count += 1;
    }
  }
  return count;
}

function countDifferingBytes(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) {
    return Math.max(left.length, right.length);
  }
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      count += 1;
    }
  }
  return count;
}

/**
 * Destructive diagnostic for a fresh dev page (`?layerHistoryTest=1`). It uses
 * two real RGBA8 layer textures and named-layer readback, so the untouched layer
 * is verified byte-for-byte rather than inferred from the active composite.
 */
export async function runLayerHistoryGpuTest(
  engine: BrushEngine,
): Promise<LayerHistoryGpuTestReport> {
  const initialStats = engine.getStats();
  const initialLayers = initialStats.layers;
  const initialHistory = engine.getHistoryState();
  if (
    initialStats.layerFormat !== "rgba8unorm"
    || initialLayers.length !== 1
    || initialLayers[0].hasContent
    || initialHistory.actionCount !== 0
    || initialHistory.cursor !== 0
  ) {
    throw new Error(
      "Il test GPU della cronologia richiede una pagina dev nuova, RGBA8, con un solo livello vuoto.",
    );
  }

  const pRect: PixelRect = { x: 448, y: 448, width: 176, height: 128 };
  const qRect: PixelRect = { x: 960, y: 448, width: 176, height: 128 };
  const auditRect: PixelRect = { x: 448, y: 448, width: 688, height: 128 };

  engine.setBrushSettings({
    tool: "paint",
    shape: "circle",
    shapeScatter: 0,
    grainMode: "off",
    color: "#e33939",
    size: 64,
    spacingPercent: 25,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "normal",
    jitterMaster: 0,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  });

  const draw = async (x: number, color: string, timeMs: number): Promise<void> => {
    engine.setBrushSettings({ color });
    engine.beginStrokeAtLayer({ x, y: 512, pressure: 1, timeMs });
    engine.extendStrokeAtLayer([
      { x: x + 48, y: 512, pressure: 1, timeMs: timeMs + 16 },
    ]);
    engine.endStroke(timeMs + 16);
    await engine.waitForIdle();
  };

  await draw(512, "#e33939", 100);
  const layerABaseline = await engine.readLayerPixels(auditRect, 0);
  const layerAP = await engine.readLayerPixels(pRect, 0);
  const layerAQ = await engine.readLayerPixels(qRect, 0);

  await engine.addLayer("Test cronologia B");
  await draw(1024, "#35c66b", 200);
  const beforeUndo = engine.getHistoryState();
  const layerAAfterPaintingB = await engine.readLayerPixels(auditRect, 0);
  const layerBBeforeUndo = await engine.readLayerPixels(auditRect, 1);
  const layerBBeforeUndoP = await engine.readLayerPixels(pRect, 1);
  const layerBBeforeUndoQ = await engine.readLayerPixels(qRect, 1);

  const undoReturned = await engine.undo();
  await engine.waitForIdle();
  const afterUndo = engine.getHistoryState();
  const layerAAfterUndo = await engine.readLayerPixels(auditRect, 0);
  const layerBAfterUndoP = await engine.readLayerPixels(pRect, 1);
  const layerBAfterUndoQ = await engine.readLayerPixels(qRect, 1);

  // The next undo belongs to layer A: it must succeed and move the active layer
  // with the cursor, since the journal is global.
  const activeBeforeCrossLayerUndo = engine.getStats().activeLayerIndex;
  const crossLayerUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const afterCrossLayerUndo = engine.getHistoryState();
  const activeAfterCrossLayerUndo = engine.getStats().activeLayerIndex;
  const workingSetMatchesAfterCrossLayerUndo = engine
    .effectsWorkingSetMatchesActiveLayer();
  const layerAAfterCrossLayerUndo = await engine.readLayerPixels(pRect, 0);

  // Force a REAL cross-layer redo: deliberately select B while the next action
  // belongs to A. A same-layer redo would not exercise the activation path.
  await engine.setActiveLayer(1);
  const activeBeforeCrossLayerRedo = engine.getStats().activeLayerIndex;
  const crossLayerRedoReturned = await engine.redo();
  await engine.waitForIdle();
  const afterCrossLayerRedo = engine.getHistoryState();
  const activeAfterCrossLayerRedo = engine.getStats().activeLayerIndex;
  const workingSetMatchesAfterCrossLayerRedo = engine
    .effectsWorkingSetMatchesActiveLayer();
  const layerAAfterCrossLayerRedo = await engine.readLayerPixels(pRect, 0);
  await engine.setActiveLayer(1);

  const probeRollback = async (
    ...faultPoints: HistoryReplayFaultPoint[]
  ): Promise<RollbackProbe> => {
    const beforeHistory = engine.getHistoryState();
    const beforeActive = engine.getStats().activeLayerIndex;
    const beforeLayerA = await engine.readLayerPixels(auditRect, 0);
    const beforeLayerB = await engine.readLayerPixels(auditRect, 1);
    engine.injectHistoryReplayFault(...faultPoints);
    let threw = false;
    try {
      await engine.undo();
    } catch {
      threw = true;
    }
    await engine.waitForIdle();
    const afterHistory = engine.getHistoryState();
    return {
      threw,
      cursorRestored: afterHistory.cursor === beforeHistory.cursor,
      activeLayerRestored: engine.getStats().activeLayerIndex === beforeActive,
      workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
      historyBusy: afterHistory.busy,
      historyInconsistent: afterHistory.inconsistent,
      canUndo: afterHistory.canUndo,
      canRedo: afterHistory.canRedo,
      layerADifferingBytes: countDifferingBytes(
        beforeLayerA,
        await engine.readLayerPixels(auditRect, 0),
      ),
      layerBDifferingBytes: countDifferingBytes(
        beforeLayerB,
        await engine.readLayerPixels(auditRect, 1),
      ),
    };
  };

  // This failure happens only after a real clear/draw submission. Restoring just
  // cursor/index would leave A damaged even though all CPU state looked correct.
  const partialReplayRollback = await probeRollback("after-first-replay-submit");

  // This failure lands after engine fields and Blend point at A but before the
  // effects workbench does. Pixel-only checks cannot observe that half-switch.
  const switchActivationRollback = await probeRollback("during-switch-activation");

  // Cursor 1 on B: the next redo is Q on B and must restore it byte-for-byte.
  const redoReturned = await engine.redo();
  await engine.waitForIdle();
  const afterRedo = engine.getHistoryState();
  const layerAAfterRedo = await engine.readLayerPixels(auditRect, 0);
  const layerBAfterRedo = await engine.readLayerPixels(auditRect, 1);
  const layerBAfterRedoQ = await engine.readLayerPixels(qRect, 1);

  // Finish with a deliberately unrecoverable transaction. The first fault lands
  // after A was cleared; rollback rebuilds A, then the second fault breaks the
  // reverse activation halfway through. The engine must expose and retain a fatal
  // latch: continuing to edit a half-retargeted document would risk user data.
  const fatalPreparationUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const fatalRollback = await probeRollback(
    "after-first-replay-submit",
    "during-switch-activation",
  );
  const afterFatalRollback = engine.getHistoryState();
  const fatalFollowUpUndoReturned = await engine.undo();

  const alphaPixels = {
    layerAStrokeP: countNonZeroAlpha(layerAP),
    layerARegionQ: countNonZeroAlpha(layerAQ),
    layerBBeforeUndoRegionP: countNonZeroAlpha(layerBBeforeUndoP),
    layerBBeforeUndoStrokeQ: countNonZeroAlpha(layerBBeforeUndoQ),
    layerBAfterUndoRegionP: countNonZeroAlpha(layerBAfterUndoP),
    layerBAfterUndoRegionQ: countNonZeroAlpha(layerBAfterUndoQ),
    layerBAfterRedoStrokeQ: countNonZeroAlpha(layerBAfterRedoQ),
  };
  const differingBytes = {
    layerAAfterPaintingB: countDifferingBytes(layerABaseline, layerAAfterPaintingB),
    layerAAfterUndo: countDifferingBytes(layerABaseline, layerAAfterUndo),
    layerAAfterRedo: countDifferingBytes(layerABaseline, layerAAfterRedo),
    layerBRedoVersusBeforeUndo: countDifferingBytes(layerBBeforeUndo, layerBAfterRedo),
  };
  const checks = {
    layerAContainsP: alphaPixels.layerAStrokeP > 0,
    layerARegionQIsEmpty: alphaPixels.layerARegionQ === 0,
    layerBBeforeUndoDoesNotContainP: alphaPixels.layerBBeforeUndoRegionP === 0,
    layerBBeforeUndoContainsQ: alphaPixels.layerBBeforeUndoStrokeQ > 0,
    sameLayerUndoAdvertised: beforeUndo.canUndo,
    undoSucceeded: undoReturned,
    undoRemovedQ: alphaPixels.layerBAfterUndoRegionQ === 0,
    undoDidNotReplayPOnB: alphaPixels.layerBAfterUndoRegionP === 0,
    crossLayerUndoAdvertised: afterUndo.canUndo,
    redoAdvertised: afterUndo.canRedo,
    crossLayerUndoSucceeded: crossLayerUndoReturned,
    crossLayerUndoMovedTheCursor:
      afterCrossLayerUndo.cursor === afterUndo.cursor - 1,
    crossLayerUndoMovedTheActiveLayer:
      activeAfterCrossLayerUndo !== activeBeforeCrossLayerUndo,
    crossLayerUndoRemovedPFromA:
      countNonZeroAlpha(layerAAfterCrossLayerUndo) === 0,
    workingSetFollowedTheCrossLayerUndo: workingSetMatchesAfterCrossLayerUndo,
    crossLayerRedoAdvertised: afterCrossLayerUndo.canRedo,
    crossLayerRedoSucceeded: crossLayerRedoReturned,
    crossLayerRedoMovedTheCursor:
      afterCrossLayerRedo.cursor === afterCrossLayerUndo.cursor + 1,
    crossLayerRedoMovedTheActiveLayer:
      activeAfterCrossLayerRedo !== activeBeforeCrossLayerRedo,
    crossLayerRedoRestoredPOnA:
      countNonZeroAlpha(layerAAfterCrossLayerRedo) > 0,
    crossLayerRedoRestoredPByteExactly:
      countDifferingBytes(layerAP, layerAAfterCrossLayerRedo) === 0,
    crossLayerRedoSelectedTheActionsLayer:
      activeAfterCrossLayerRedo === activeAfterCrossLayerUndo,
    workingSetFollowedTheCrossLayerRedo: workingSetMatchesAfterCrossLayerRedo,
    partialReplayFailureWasReported: partialReplayRollback.threw,
    partialReplayRollbackRestoredTheCursor: partialReplayRollback.cursorRestored,
    partialReplayRollbackRestoredTheActiveLayer:
      partialReplayRollback.activeLayerRestored,
    partialReplayRollbackRestoredTheWorkingSet:
      partialReplayRollback.workingSetMatchesActiveLayer,
    partialReplayRollbackReleasedTheLock: !partialReplayRollback.historyBusy,
    partialReplayRollbackStayedConsistent:
      !partialReplayRollback.historyInconsistent,
    partialReplayRollbackPreservedUndo: partialReplayRollback.canUndo,
    partialReplayRollbackPreservedRedo: partialReplayRollback.canRedo,
    partialReplayRollbackLeftLayerAByteIdentical:
      partialReplayRollback.layerADifferingBytes === 0,
    partialReplayRollbackLeftLayerBByteIdentical:
      partialReplayRollback.layerBDifferingBytes === 0,
    switchActivationFailureWasReported: switchActivationRollback.threw,
    switchActivationRollbackRestoredTheCursor:
      switchActivationRollback.cursorRestored,
    switchActivationRollbackRestoredTheActiveLayer:
      switchActivationRollback.activeLayerRestored,
    switchActivationRollbackRestoredTheWorkingSet:
      switchActivationRollback.workingSetMatchesActiveLayer,
    switchActivationRollbackReleasedTheLock:
      !switchActivationRollback.historyBusy,
    switchActivationRollbackStayedConsistent:
      !switchActivationRollback.historyInconsistent,
    switchActivationRollbackPreservedUndo: switchActivationRollback.canUndo,
    switchActivationRollbackPreservedRedo: switchActivationRollback.canRedo,
    switchActivationRollbackLeftLayerAByteIdentical:
      switchActivationRollback.layerADifferingBytes === 0,
    switchActivationRollbackLeftLayerBByteIdentical:
      switchActivationRollback.layerBDifferingBytes === 0,
    redoSucceeded: redoReturned,
    redoRestoredQ: alphaPixels.layerBAfterRedoStrokeQ > 0,
    redoRestoredBByteExactly: differingBytes.layerBRedoVersusBeforeUndo === 0,
    paintingBDidNotChangeA: differingBytes.layerAAfterPaintingB === 0,
    undoDidNotChangeA: differingBytes.layerAAfterUndo === 0,
    redoDidNotChangeA: differingBytes.layerAAfterRedo === 0,
    fatalPreparationUndoSucceeded: fatalPreparationUndoReturned,
    fatalRollbackFailureWasReported: fatalRollback.threw,
    fatalRollbackRestoredTheCursor: fatalRollback.cursorRestored,
    fatalRollbackRestoredTheActiveLayer: fatalRollback.activeLayerRestored,
    fatalRollbackDetectedTheHalfSwitch:
      !fatalRollback.workingSetMatchesActiveLayer,
    fatalRollbackLatchedBusy: fatalRollback.historyBusy,
    fatalRollbackLatchedInconsistent: fatalRollback.historyInconsistent,
    fatalRollbackDisabledUndo: !fatalRollback.canUndo,
    fatalRollbackDisabledRedo: !fatalRollback.canRedo,
    fatalRollbackLeftLayerAByteIdentical:
      fatalRollback.layerADifferingBytes === 0,
    fatalRollbackLeftLayerBByteIdentical:
      fatalRollback.layerBDifferingBytes === 0,
    fatalLatchRefusedAnotherUndo: !fatalFollowUpUndoReturned,
  };

  return {
    version: LAYER_HISTORY_GPU_TEST_VERSION,
    passed: Object.values(checks).every(Boolean),
    checks,
    alphaPixels,
    differingBytes,
    history: {
      beforeUndo,
      afterUndo,
      afterCrossLayerUndo,
      afterCrossLayerRedo,
      afterRedo,
      afterFatalRollback,
    },
    partialReplayRollback,
    switchActivationRollback,
    fatalRollback,
    operations: {
      undoReturned,
      crossLayerUndoReturned,
      crossLayerRedoReturned,
      redoReturned,
      fatalPreparationUndoReturned,
      fatalFollowUpUndoReturned,
    },
  };
}
