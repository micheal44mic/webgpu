import type { BrushEngine, HistoryState } from "./brush-engine";

export const LAYER_HISTORY_GPU_TEST_VERSION = 1 as const;

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
    afterBlockedUndo: HistoryState;
    afterRedo: HistoryState;
  };
  operations: {
    undoReturned: boolean;
    blockedUndoReturned: boolean;
    redoReturned: boolean;
  };
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

  // The next undo belongs to layer A. Calling the API directly must be refused,
  // not merely hidden by the disabled UI button.
  const blockedUndoReturned = await engine.undo();
  const afterBlockedUndo = engine.getHistoryState();

  const redoReturned = await engine.redo();
  await engine.waitForIdle();
  const afterRedo = engine.getHistoryState();
  const layerAAfterRedo = await engine.readLayerPixels(auditRect, 0);
  const layerBAfterRedo = await engine.readLayerPixels(auditRect, 1);
  const layerBAfterRedoQ = await engine.readLayerPixels(qRect, 1);

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
    foreignUndoNotAdvertised: !afterUndo.canUndo,
    redoAdvertised: afterUndo.canRedo,
    directForeignUndoRefused: !blockedUndoReturned,
    blockedUndoKeptCursor: afterBlockedUndo.cursor === afterUndo.cursor,
    redoSucceeded: redoReturned,
    redoRestoredQ: alphaPixels.layerBAfterRedoStrokeQ > 0,
    redoRestoredBByteExactly: differingBytes.layerBRedoVersusBeforeUndo === 0,
    paintingBDidNotChangeA: differingBytes.layerAAfterPaintingB === 0,
    undoDidNotChangeA: differingBytes.layerAAfterUndo === 0,
    redoDidNotChangeA: differingBytes.layerAAfterRedo === 0,
  };

  return {
    version: LAYER_HISTORY_GPU_TEST_VERSION,
    passed: Object.values(checks).every(Boolean),
    checks,
    alphaPixels,
    differingBytes,
    history: { beforeUndo, afterUndo, afterBlockedUndo, afterRedo },
    operations: { undoReturned, blockedUndoReturned, redoReturned },
  };
}
