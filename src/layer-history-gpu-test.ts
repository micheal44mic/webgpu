import type { BrushEngine } from "./brush-engine";
import type { HistoryReplayFaultPoint, HistoryState } from "./engine-types";
import {
  runLayerCompositeGpuTest,
  type LayerCompositeGpuTestReport,
  type LayerMemorySnapshot,
} from "./layer-composite-gpu-test";

export const LAYER_HISTORY_GPU_TEST_VERSION = 12 as const;

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
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
  layerDifferingBytes: number[];
}

interface BakeRollbackProbe {
  threw: boolean;
  layerCountRestored: boolean;
  activeLayerRestored: boolean;
  workingSetMatchesActiveLayer: boolean;
  rawLayerDifferingBytes: number;
  bakeAllocatedAfterFailure: boolean;
  bakeMemoryBeforeMiB: number;
  bakeMemoryAfterMiB: number;
}

interface ColdStorageRollbackProbe {
  threw: boolean;
  layerCount: number;
  activeLayerIndex: number;
  workingSetMatchesActiveLayer: boolean;
  rawLayerDifferingBytes: number;
  layerBaseMiB: number;
  layerColdMiB: number;
  layerHydrationMiB: number;
  layerBakeMiB: number;
}

interface LayerDuplicateHistoryProbe {
  sourceLayerId: number | null;
  duplicateLayerId: number | null;
  initialDifferingBytes: number;
  sourceAfterPaintDifferingBytes: number;
  duplicatePaintDifferingBytes: number;
  paintUndoDifferingBytes: number;
  paintRedoDifferingBytes: number;
  structuralRedoDifferingBytes: number;
  paintUndoReturned: boolean;
  paintRedoReturned: boolean;
  cleanupPaintUndoReturned: boolean;
  structuralUndoReturned: boolean;
  structuralRedoReturned: boolean;
  finalStructuralUndoReturned: boolean;
  layerCountAfterCleanup: number;
  workingSetMatchesActiveLayer: boolean;
  layerColdMiBAfterCleanup: number;
  layerHydrationMiBAfterCleanup: number;
  layerBakeMiBAfterCleanup: number;
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
    fusedStyledLayerVersusRawLayerA: number;
  };
  fwidthBakeGap: Awaited<ReturnType<BrushEngine["measureActiveStyleBakeGap"]>>;
  bakeRollback: BakeRollbackProbe;
  compositing: LayerCompositeGpuTestReport;
  coldStorageRollback: {
    pack: ColdStorageRollbackProbe;
    hydrate: ColdStorageRollbackProbe;
  };
  duplicate: LayerDuplicateHistoryProbe;
  storageStudy: Awaited<ReturnType<BrushEngine["measureExactLayerStorageStudy"]>>;
  memory: {
    oneLayer: LayerMemorySnapshot;
    twoLayers: LayerMemorySnapshot;
    fiveLayers: LayerMemorySnapshot;
  };
  switchCost: {
    documentedBeforeMs: readonly [151, 215];
    twoLayerAfterMs: readonly [number, number];
    fiveLayerStressMs: readonly [number, number];
    withinDocumentedCeiling: boolean;
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
    bevelStyleEnabled: boolean;
    bakeFailureWasReported: boolean;
  };
}

function countNonZeroAlpha(pixels: Uint8Array, bytesPerPixel: 4 | 8): number {
  let count = 0;
  const alphaOffset = bytesPerPixel === 8 ? 6 : 3;
  for (let index = alphaOffset; index < pixels.length; index += bytesPerPixel) {
    const nonZero = bytesPerPixel === 8
      ? pixels[index] !== 0 || (pixels[index + 1] & 0x7f) !== 0
      : pixels[index] !== 0;
    count += Number(nonZero);
  }
  return count;
}

function mipTailMiB(layerSize: number, bytesPerPixel: number): number {
  let bytes = 0;
  for (let size = Math.max(1, layerSize >> 1);; size = Math.max(1, size >> 1)) {
    bytes += size * size * bytesPerPixel;
    if (size === 1) break;
  }
  return bytes / (1024 * 1024);
}

function countDifferingBytes(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) {
    return Math.max(left.length, right.length);
  }
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    count += Number(left[index] !== right[index]);
  }
  return count;
}

function snapshotMemory(engine: BrushEngine): LayerMemorySnapshot {
  const stats = engine.getStats();
  return {
    layerCount: stats.layerCount,
    layerBaseMiB: stats.gpuMemory.layerBaseMiB,
    layerColdMiB: stats.gpuMemory.layerColdMiB,
    layerHydrationMiB: stats.gpuMemory.layerHydrationMiB,
    layerMipChainMiB: stats.gpuMemory.layerMipChainMiB,
    layerBakeMiB: stats.gpuMemory.layerBakeMiB,
    layerCompositeMiB: stats.gpuMemory.layerCompositeMiB,
    countedTotalMiB: stats.gpuMemory.countedTotalMiB,
  };
}

/**
 * Destructive diagnostic for a fresh dev page (`?layerHistoryTest=1`). It uses
 * named RGBA16F layer readback, absolute compositor references and explicit fault
 * injection. The outer caller adds a wall-clock timeout as a final fail-safe.
 */
export async function runLayerHistoryGpuTest(
  engine: BrushEngine,
): Promise<LayerHistoryGpuTestReport> {
  const initialStats = engine.getStats();
  const initialLayers = initialStats.layers;
  const initialHistory = engine.getHistoryState();
  if (
    initialStats.layerFormat !== "rgba16float"
    || initialLayers.length !== 1
    || initialLayers[0].hasContent
    || initialHistory.actionCount !== 0
    || initialHistory.cursor !== 0
  ) {
    throw new Error(
      "Il test GPU richiede una pagina dev nuova, RGBA16F, con un solo livello vuoto.",
    );
  }

  const rawBytesPerPixel = 8 as const;
  const expectedLayerBaseMiB = engine.layerSize * engine.layerSize
    * rawBytesPerPixel / (1024 * 1024);
  const expectedLayerMipMiB = mipTailMiB(engine.layerSize, rawBytesPerPixel);

  const pRect: PixelRect = { x: 448, y: 448, width: 176, height: 128 };
  const qRect: PixelRect = { x: 960, y: 448, width: 176, height: 128 };
  const auditRect: PixelRect = { x: 448, y: 448, width: 688, height: 128 };
  const compositeAuditRect: PixelRect = { x: 1280, y: 960, width: 1160, height: 128 };
  const rollbackAuditRects = [auditRect, compositeAuditRect] as const;

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

  const strokeStyle = {
    enabled: true,
    width: 14,
    position: "outside" as const,
    color: [1, 0.643, 0.282, 1] as [number, number, number, number],
  };
  const bevelStyleEnabled = await engine.setRasterBevelStyle({
    ...engine.getRasterBevelStyle(),
    enabled: true,
    mode: "inner",
    technique: "smooth",
    size: 32,
    soften: 4,
    gloss: "linear",
    contourAA: true,
  });
  await engine.waitForIdle();

  const draw = async (
    x: number,
    y: number,
    color: string,
    timeMs: number,
  ): Promise<void> => {
    engine.setBrushSettings({ color });
    if (!await engine.beginStrokeAtLayerAfterHistoryDrain({ x, y, pressure: 1, timeMs })) {
      throw new Error("Tratto History GPU rifiutato dal gate storage.");
    }
    engine.extendStrokeAtLayer([
      { x: x + 48, y, pressure: 1, timeMs: timeMs + 16 },
    ]);
    engine.endStroke(timeMs + 16);
    await engine.waitForIdle();
  };

  await draw(512, 512, "#e33939", 100);
  const layerABaseline = await engine.readLayerPixels(auditRect, 0);
  const layerAP = await engine.readLayerPixels(pRect, 0);
  const layerAQ = await engine.readLayerPixels(qRect, 0);
  const fwidthBakeGap = await engine.measureActiveStyleBakeGap(pRect);
  await engine.waitForIdle();
  const oneLayerMemory = snapshotMemory(engine);

  // Duplicate is both a structural action and the first authoritative raster
  // checkpoint of the new layer. Exercise the real GPU path before the broader
  // history harness so Paint -> Undo cannot silently rebuild an empty copy.
  const duplicateResult = await engine.duplicateSelectedLayer();
  await engine.waitForIdle();
  const duplicateInitial = await engine.readLayerPixels(auditRect, 1);
  await draw(1024, 512, "#35c66b", 200);
  const duplicateAfterPaint = await engine.readLayerPixels(auditRect, 1);
  const sourceAfterDuplicatePaint = await engine.readLayerPixels(auditRect, 0);

  const duplicatePaintUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const duplicateAfterPaintUndo = await engine.readLayerPixels(auditRect, 1);
  const duplicatePaintRedoReturned = await engine.redo();
  await engine.waitForIdle();
  const duplicateAfterPaintRedo = await engine.readLayerPixels(auditRect, 1);

  const duplicateCleanupPaintUndoReturned = await engine.undo();
  const duplicateStructuralUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const duplicateStructuralRedoReturned = await engine.redo();
  await engine.waitForIdle();
  const duplicateAfterStructuralRedo = await engine.readLayerPixels(auditRect, 1);
  const duplicateFinalStructuralUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const statsAfterDuplicateCleanup = engine.getStats();
  const duplicate: LayerDuplicateHistoryProbe = {
    sourceLayerId: duplicateResult.sourceRasterLayerId,
    duplicateLayerId: duplicateResult.duplicateRasterLayerId,
    initialDifferingBytes: countDifferingBytes(layerABaseline, duplicateInitial),
    sourceAfterPaintDifferingBytes: countDifferingBytes(
      layerABaseline,
      sourceAfterDuplicatePaint,
    ),
    duplicatePaintDifferingBytes: countDifferingBytes(
      duplicateInitial,
      duplicateAfterPaint,
    ),
    paintUndoDifferingBytes: countDifferingBytes(
      duplicateInitial,
      duplicateAfterPaintUndo,
    ),
    paintRedoDifferingBytes: countDifferingBytes(
      duplicateAfterPaint,
      duplicateAfterPaintRedo,
    ),
    structuralRedoDifferingBytes: countDifferingBytes(
      duplicateInitial,
      duplicateAfterStructuralRedo,
    ),
    paintUndoReturned: duplicatePaintUndoReturned,
    paintRedoReturned: duplicatePaintRedoReturned,
    cleanupPaintUndoReturned: duplicateCleanupPaintUndoReturned,
    structuralUndoReturned: duplicateStructuralUndoReturned,
    structuralRedoReturned: duplicateStructuralRedoReturned,
    finalStructuralUndoReturned: duplicateFinalStructuralUndoReturned,
    layerCountAfterCleanup: statsAfterDuplicateCleanup.layerCount,
    workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
    layerColdMiBAfterCleanup: statsAfterDuplicateCleanup.gpuMemory.layerColdMiB,
    layerHydrationMiBAfterCleanup: statsAfterDuplicateCleanup.gpuMemory.layerHydrationMiB,
    layerBakeMiBAfterCleanup: statsAfterDuplicateCleanup.gpuMemory.layerBakeMiB,
  };

  const bakeMemoryBeforeMiB = engine.getStats().gpuMemory.layerBakeMiB;
  engine.injectLayerBakeFault("after-candidate-submit");
  let bakeFailureWasReported = false;
  try {
    await engine.addLayer("Bake fault candidate");
  } catch {
    bakeFailureWasReported = true;
  }
  await engine.waitForIdle();
  const statsAfterBakeFailure = engine.getStats();
  const rawAfterBakeFailure = await engine.readLayerPixels(auditRect, 0);
  const bakeStateAfterFailure = engine.getLayerBakeState(0);
  const bakeRollback: BakeRollbackProbe = {
    threw: bakeFailureWasReported,
    layerCountRestored: statsAfterBakeFailure.layerCount === 1,
    activeLayerRestored: statsAfterBakeFailure.activeLayerIndex === 0,
    workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
    rawLayerDifferingBytes: countDifferingBytes(layerABaseline, rawAfterBakeFailure),
    bakeAllocatedAfterFailure: bakeStateAfterFailure.allocated,
    bakeMemoryBeforeMiB,
    bakeMemoryAfterMiB: statsAfterBakeFailure.gpuMemory.layerBakeMiB,
  };

  engine.injectLayerColdStorageFault("after-pack-submit");
  let packFailureWasReported = false;
  try {
    await engine.addLayer("Cold pack fault candidate");
  } catch {
    packFailureWasReported = true;
  }
  await engine.waitForIdle();
  const statsAfterPackFailure = engine.getStats();
  const rawAfterPackFailure = await engine.readLayerPixels(auditRect, 0);
  const coldPackRollback: ColdStorageRollbackProbe = {
    threw: packFailureWasReported,
    layerCount: statsAfterPackFailure.layerCount,
    activeLayerIndex: statsAfterPackFailure.activeLayerIndex,
    workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
    rawLayerDifferingBytes: countDifferingBytes(layerABaseline, rawAfterPackFailure),
    layerBaseMiB: statsAfterPackFailure.gpuMemory.layerBaseMiB,
    layerColdMiB: statsAfterPackFailure.gpuMemory.layerColdMiB,
    layerHydrationMiB: statsAfterPackFailure.gpuMemory.layerHydrationMiB,
    layerBakeMiB: statsAfterPackFailure.gpuMemory.layerBakeMiB,
  };

  await engine.addLayer("Test cronologia B");
  await engine.waitForIdle();
  const layerABeforeHydrateFailure = await engine.readLayerPixels(auditRect, 0);
  engine.injectLayerColdStorageFault("after-hydrate-submit");
  let hydrateFailureWasReported = false;
  try {
    await engine.setActiveLayer(0);
  } catch {
    hydrateFailureWasReported = true;
  }
  await engine.waitForIdle();
  const statsAfterHydrateFailure = engine.getStats();
  const layerAAfterHydrateFailure = await engine.readLayerPixels(auditRect, 0);
  const coldHydrateRollback: ColdStorageRollbackProbe = {
    threw: hydrateFailureWasReported,
    layerCount: statsAfterHydrateFailure.layerCount,
    activeLayerIndex: statsAfterHydrateFailure.activeLayerIndex,
    workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
    rawLayerDifferingBytes: countDifferingBytes(
      layerABeforeHydrateFailure,
      layerAAfterHydrateFailure,
    ),
    layerBaseMiB: statsAfterHydrateFailure.gpuMemory.layerBaseMiB,
    layerColdMiB: statsAfterHydrateFailure.gpuMemory.layerColdMiB,
    layerHydrationMiB: statsAfterHydrateFailure.gpuMemory.layerHydrationMiB,
    layerBakeMiB: statsAfterHydrateFailure.gpuMemory.layerBakeMiB,
  };
  const twoLayersMemory = snapshotMemory(engine);
  const fusedStyledLayer = await engine.readMergedLayerPixels("below", auditRect);
  const fusedStyledLayerVersusRawLayerA = countDifferingBytes(
    fusedStyledLayer,
    layerABaseline,
  );
  const releasedBakeAfterFusion = engine.getLayerBakeState(0);
  const compositeAfterFirstFusion = engine.getLayerCompositeState();

  await draw(1024, 512, "#35c66b", 400);
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

  const activeBeforeCrossLayerUndo = engine.getStats().activeLayerIndex;
  const crossLayerUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const afterCrossLayerUndo = engine.getHistoryState();
  const activeAfterCrossLayerUndo = engine.getStats().activeLayerIndex;
  const workingSetMatchesAfterCrossLayerUndo = engine.effectsWorkingSetMatchesActiveLayer();
  const layerAAfterCrossLayerUndo = await engine.readLayerPixels(pRect, 0);

  await engine.setActiveLayer(1);
  const activeBeforeCrossLayerRedo = engine.getStats().activeLayerIndex;
  const crossLayerRedoReturned = await engine.redo();
  await engine.waitForIdle();
  const afterCrossLayerRedo = engine.getHistoryState();
  const activeAfterCrossLayerRedo = engine.getStats().activeLayerIndex;
  const workingSetMatchesAfterCrossLayerRedo = engine.effectsWorkingSetMatchesActiveLayer();
  const layerAAfterCrossLayerRedo = await engine.readLayerPixels(pRect, 0);
  await engine.setActiveLayer(1);

  const readLayerAudit = async (layerIndex: number): Promise<Uint8Array[]> => {
    const pixels: Uint8Array[] = [];
    for (const rect of rollbackAuditRects) {
      pixels.push(await engine.readLayerPixels(rect, layerIndex));
    }
    return pixels;
  };

  const probeRollback = async (
    ...faultPoints: HistoryReplayFaultPoint[]
  ): Promise<RollbackProbe> => {
    const beforeHistory = engine.getHistoryState();
    const beforeActive = engine.getStats().activeLayerIndex;
    const layerCount = engine.getStats().layerCount;
    const beforeLayers: Uint8Array[][] = [];
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
      beforeLayers.push(await readLayerAudit(layerIndex));
    }
    engine.injectHistoryReplayFault(...faultPoints);
    let threw = false;
    try {
      await engine.undo();
    } catch {
      threw = true;
    }
    await engine.waitForIdle();
    const afterHistory = engine.getHistoryState();
    const layerDifferingBytes: number[] = [];
    for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
      const afterRects = await readLayerAudit(layerIndex);
      layerDifferingBytes.push(afterRects.reduce(
        (total, pixels, rectIndex) =>
          total + countDifferingBytes(beforeLayers[layerIndex][rectIndex], pixels),
        0,
      ));
    }
    return {
      threw,
      cursorRestored: afterHistory.cursor === beforeHistory.cursor,
      activeLayerRestored: engine.getStats().activeLayerIndex === beforeActive,
      workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
      historyBusy: afterHistory.busy,
      historyInconsistent: afterHistory.inconsistent,
      canUndo: afterHistory.canUndo,
      canRedo: afterHistory.canRedo,
      layerDifferingBytes,
    };
  };

  const partialReplayRollback = await probeRollback("after-first-replay-submit");
  const switchActivationRollback = await probeRollback("during-switch-activation");

  const redoReturned = await engine.redo();
  await engine.waitForIdle();
  const afterRedo = engine.getHistoryState();
  const layerAAfterRedo = await engine.readLayerPixels(auditRect, 0);
  const layerBAfterRedo = await engine.readLayerPixels(auditRect, 1);
  const layerBAfterRedoQ = await engine.readLayerPixels(qRect, 1);

  const switchToA = await engine.setActiveLayer(0);
  const switchToB = await engine.setActiveLayer(1);
  const twoLayerAfterMs = [
    switchToA?.totalMs ?? 0,
    switchToB?.totalMs ?? 0,
  ] as const;
  const withinDocumentedCeiling = Math.max(...twoLayerAfterMs) <= 215 * 1.03;

  const compositing = await runLayerCompositeGpuTest(engine, strokeStyle, 2_000);
  const storageStudy = await engine.measureExactLayerStorageStudy();

  const fatalPreparationUndoReturned = await engine.undo();
  await engine.waitForIdle();
  const fatalRollback = await probeRollback(
    "after-first-replay-submit",
    "during-switch-activation",
  );
  const afterFatalRollback = engine.getHistoryState();
  const fatalFollowUpUndoReturned = await engine.undo();

  const alphaPixels = {
    layerAStrokeP: countNonZeroAlpha(layerAP, rawBytesPerPixel),
    layerARegionQ: countNonZeroAlpha(layerAQ, rawBytesPerPixel),
    layerBBeforeUndoRegionP: countNonZeroAlpha(layerBBeforeUndoP, rawBytesPerPixel),
    layerBBeforeUndoStrokeQ: countNonZeroAlpha(layerBBeforeUndoQ, rawBytesPerPixel),
    layerBAfterUndoRegionP: countNonZeroAlpha(layerBAfterUndoP, rawBytesPerPixel),
    layerBAfterUndoRegionQ: countNonZeroAlpha(layerBAfterUndoQ, rawBytesPerPixel),
    layerBAfterRedoStrokeQ: countNonZeroAlpha(layerBAfterRedoQ, rawBytesPerPixel),
  };
  const differingBytes = {
    layerAAfterPaintingB: countDifferingBytes(layerABaseline, layerAAfterPaintingB),
    layerAAfterUndo: countDifferingBytes(layerABaseline, layerAAfterUndo),
    layerAAfterRedo: countDifferingBytes(layerABaseline, layerAAfterRedo),
    layerBRedoVersusBeforeUndo: countDifferingBytes(layerBBeforeUndo, layerBAfterRedo),
    fusedStyledLayerVersusRawLayerA,
  };

  const memoryChecks = {
    oneLayerHasOneRawPyramid: oneLayerMemory.layerCount === 1
      && Math.abs(oneLayerMemory.layerMipChainMiB - expectedLayerMipMiB) < 0.01,
    oneLayerHasOneHotAndNoCold:
      Math.abs(oneLayerMemory.layerBaseMiB - expectedLayerBaseMiB) < 0.01
      && oneLayerMemory.layerColdMiB < 0.01
      && oneLayerMemory.layerHydrationMiB < 0.01,
    twoLayersHaveOneHotAndSparseCold:
      Math.abs(twoLayersMemory.layerBaseMiB - expectedLayerBaseMiB) < 0.01
      && twoLayersMemory.layerColdMiB > 0
      && twoLayersMemory.layerColdMiB < expectedLayerBaseMiB
      && twoLayersMemory.layerHydrationMiB < 0.01,
    fiveLayersHaveOneHotAndSparseCold:
      Math.abs(compositing.fiveLayerMemory.layerBaseMiB - expectedLayerBaseMiB) < 0.01
      && compositing.fiveLayerMemory.layerColdMiB > twoLayersMemory.layerColdMiB
      && compositing.fiveLayerMemory.layerColdMiB < 4 * expectedLayerBaseMiB
      && compositing.fiveLayerMemory.layerHydrationMiB < 0.01,
    twoLayersReleasedPerLayerBakes: twoLayersMemory.layerBakeMiB < 0.01,
    fiveLayersReleasedPerLayerBakes: compositing.fiveLayerMemory.layerBakeMiB < 0.01,
    twoAndFiveLayerMipMemoryIsConstant:
      Math.abs(
        twoLayersMemory.layerMipChainMiB
          - compositing.fiveLayerMemory.layerMipChainMiB,
      ) < 0.05,
    twoAndFiveLayerCompositeMemoryIsConstant:
      Math.abs(
        twoLayersMemory.layerCompositeMiB
          - compositing.fiveLayerMemory.layerCompositeMiB,
      ) < 0.05,
    fiveEagerFullLayersMatchRgba16fBytes:
      Math.abs(storageStudy.eagerFullRawMiB - 5 * expectedLayerBaseMiB) < 0.05,
  };

  const checks: Record<string, boolean> = {
    storageStudyMeasuredEveryLayer:
      storageStudy.layers.length === 5
      && storageStudy.layers.every((layer) => layer.exactTileCount > 0),
    storageStudyUsesRgba16fBytes: storageStudy.bytesPerPixel === rawBytesPerPixel,
    conservativeTilesContainEveryExactTile:
      storageStudy.totalMissedExactTiles === 0
      && storageStudy.layers.every((layer) => layer.missedExactTiles === 0),
    exactProjectionIsNoLargerThanConservative:
      storageStudy.projectedExactRawMiB
        <= storageStudy.projectedConservativeRawMiB + 1e-6,
    conservativeProjectionIsNoLargerThanBbox:
      storageStudy.projectedConservativeRawMiB
        <= storageStudy.projectedAlignedBboxRawMiB + 1e-6,
    actualColdStorageMatchesConservativeProjection:
      Math.abs(storageStudy.actualRawMiB - storageStudy.projectedConservativeRawMiB) < 0.01,
    sparseHarnessReducedRawLayerMemory:
      storageStudy.actualRawMiB < storageStudy.eagerFullRawMiB,
    exactReadbackReleasedItsTemporaryBuffers: (() => {
      const expectedPeakMiB = engine.layerSize * engine.layerSize
        * storageStudy.bytesPerPixel / (1024 * 1024);
      return storageStudy.temporaryReadbackMiBBefore === 0
        && storageStudy.temporaryReadbackMiBAfter === 0
        && Math.abs(storageStudy.temporaryReadbackPeakMiB - expectedPeakMiB) < 0.01
        && Math.abs(
          storageStudy.countedGpuMiBAfter - storageStudy.countedGpuMiBBefore,
        ) < 0.01;
    })(),
    bevelWasEnabledForGapAndBake: bevelStyleEnabled,
    fwidthBakeGapWasMeasured:
      fwidthBakeGap.comparedPixels === pRect.width * pRect.height
      && fwidthBakeGap.comparedBytes === pRect.width * pRect.height * 4
      && Number.isFinite(fwidthBakeGap.maxDelta),
    fwidthProbeReleasedItsTransientBake: oneLayerMemory.layerBakeMiB < 0.01,
    duplicateCreatedDistinctRasterIds:
      duplicate.sourceLayerId !== null
      && duplicate.duplicateLayerId !== null
      && duplicate.sourceLayerId !== duplicate.duplicateLayerId,
    duplicateWasInitiallyByteExact: duplicate.initialDifferingBytes === 0,
    paintingDuplicateChangedItsPixels: duplicate.duplicatePaintDifferingBytes > 0,
    paintingDuplicateDidNotChangeSource: duplicate.sourceAfterPaintDifferingBytes === 0,
    duplicatePaintUndoUsedSeedByteExactly:
      duplicate.paintUndoReturned && duplicate.paintUndoDifferingBytes === 0,
    duplicatePaintRedoWasByteExact:
      duplicate.paintRedoReturned && duplicate.paintRedoDifferingBytes === 0,
    duplicateStructuralUndoRedoWasByteExact:
      duplicate.cleanupPaintUndoReturned
      && duplicate.structuralUndoReturned
      && duplicate.structuralRedoReturned
      && duplicate.structuralRedoDifferingBytes === 0
      && duplicate.finalStructuralUndoReturned,
    duplicateCleanupRestoredOneHealthyLayer:
      duplicate.layerCountAfterCleanup === 1
      && duplicate.workingSetMatchesActiveLayer,
    duplicateCleanupReleasedTransientLayerMemory:
      duplicate.layerColdMiBAfterCleanup < 0.01
      && duplicate.layerHydrationMiBAfterCleanup < 0.01
      && duplicate.layerBakeMiBAfterCleanup < 0.01,
    injectedBakeFailureWasReported: bakeRollback.threw,
    injectedBakeFailureKeptOneLayer: bakeRollback.layerCountRestored,
    injectedBakeFailureKeptActiveLayer: bakeRollback.activeLayerRestored,
    injectedBakeFailureKeptWorkingSet: bakeRollback.workingSetMatchesActiveLayer,
    injectedBakeFailureKeptRawPixels: bakeRollback.rawLayerDifferingBytes === 0,
    injectedBakeFailureDidNotPublishBake: !bakeRollback.bakeAllocatedAfterFailure,
    injectedBakeFailureReleasedCandidate:
      Math.abs(bakeRollback.bakeMemoryAfterMiB - bakeRollback.bakeMemoryBeforeMiB) < 0.01,
    injectedColdPackFailureWasReported: coldPackRollback.threw,
    coldPackFailureKeptOneActiveHotLayer:
      coldPackRollback.layerCount === 1
      && coldPackRollback.activeLayerIndex === 0
      && Math.abs(coldPackRollback.layerBaseMiB - expectedLayerBaseMiB) < 0.01,
    coldPackFailureKeptWorkingSet: coldPackRollback.workingSetMatchesActiveLayer,
    coldPackFailureKeptRawPixels: coldPackRollback.rawLayerDifferingBytes === 0,
    coldPackFailureReleasedEveryCandidate:
      coldPackRollback.layerColdMiB < 0.01
      && coldPackRollback.layerHydrationMiB < 0.01
      && coldPackRollback.layerBakeMiB < 0.01,
    injectedHydrationFailureWasReported: coldHydrateRollback.threw,
    hydrationFailureRestoredIncomingSelection:
      coldHydrateRollback.layerCount === 2
      && coldHydrateRollback.activeLayerIndex === 1
      && Math.abs(coldHydrateRollback.layerBaseMiB - expectedLayerBaseMiB) < 0.01,
    hydrationFailureKeptWorkingSet: coldHydrateRollback.workingSetMatchesActiveLayer,
    hydrationFailureKeptColdPixels: coldHydrateRollback.rawLayerDifferingBytes === 0,
    hydrationFailureReleasedFullCandidate:
      coldHydrateRollback.layerColdMiB > 0
      && coldHydrateRollback.layerHydrationMiB < 0.01,
    successfulFusionContainsStyledResult: fusedStyledLayerVersusRawLayerA > 0,
    successfulFusionReleasedLayerBake:
      !releasedBakeAfterFusion.allocated
      && !releasedBakeAfterFusion.valid
      && twoLayersMemory.layerBakeMiB < 0.01,
    firstFusionCreatedOnlyMergedBelow:
      compositeAfterFirstFusion.below.allocated
      && compositeAfterFirstFusion.below.layerCount === 1
      && !compositeAfterFirstFusion.above.allocated,
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
    crossLayerUndoMovedTheCursor: afterCrossLayerUndo.cursor === afterUndo.cursor - 1,
    crossLayerUndoMovedTheActiveLayer:
      activeAfterCrossLayerUndo !== activeBeforeCrossLayerUndo,
    crossLayerUndoRemovedPFromA:
      countNonZeroAlpha(layerAAfterCrossLayerUndo, rawBytesPerPixel) === 0,
    workingSetFollowedTheCrossLayerUndo: workingSetMatchesAfterCrossLayerUndo,
    crossLayerRedoAdvertised: afterCrossLayerUndo.canRedo,
    crossLayerRedoSucceeded: crossLayerRedoReturned,
    crossLayerRedoMovedTheCursor:
      afterCrossLayerRedo.cursor === afterCrossLayerUndo.cursor + 1,
    crossLayerRedoMovedTheActiveLayer:
      activeAfterCrossLayerRedo !== activeBeforeCrossLayerRedo,
    crossLayerRedoRestoredPOnA:
      countNonZeroAlpha(layerAAfterCrossLayerRedo, rawBytesPerPixel) > 0,
    crossLayerRedoRestoredPByteExactly:
      countDifferingBytes(layerAP, layerAAfterCrossLayerRedo) === 0,
    crossLayerRedoSelectedTheActionsLayer:
      activeAfterCrossLayerRedo === activeAfterCrossLayerUndo,
    workingSetFollowedTheCrossLayerRedo: workingSetMatchesAfterCrossLayerRedo,
    partialReplayFailureWasReported: partialReplayRollback.threw,
    partialReplayRollbackRestoredTheCursor: partialReplayRollback.cursorRestored,
    partialReplayRollbackRestoredTheActiveLayer: partialReplayRollback.activeLayerRestored,
    partialReplayRollbackRestoredTheWorkingSet:
      partialReplayRollback.workingSetMatchesActiveLayer,
    partialReplayRollbackReleasedTheLock: !partialReplayRollback.historyBusy,
    partialReplayRollbackStayedConsistent: !partialReplayRollback.historyInconsistent,
    partialReplayRollbackPreservedUndo: partialReplayRollback.canUndo,
    partialReplayRollbackPreservedRedo: partialReplayRollback.canRedo,
    partialReplayRollbackLeftEveryLayerByteIdentical:
      partialReplayRollback.layerDifferingBytes.every((count) => count === 0),
    switchActivationFailureWasReported: switchActivationRollback.threw,
    switchActivationRollbackRestoredTheCursor: switchActivationRollback.cursorRestored,
    switchActivationRollbackRestoredTheActiveLayer:
      switchActivationRollback.activeLayerRestored,
    switchActivationRollbackRestoredTheWorkingSet:
      switchActivationRollback.workingSetMatchesActiveLayer,
    switchActivationRollbackReleasedTheLock: !switchActivationRollback.historyBusy,
    switchActivationRollbackStayedConsistent: !switchActivationRollback.historyInconsistent,
    switchActivationRollbackPreservedUndo: switchActivationRollback.canUndo,
    switchActivationRollbackPreservedRedo: switchActivationRollback.canRedo,
    switchActivationRollbackLeftEveryLayerByteIdentical:
      switchActivationRollback.layerDifferingBytes.every((count) => count === 0),
    redoSucceeded: redoReturned,
    redoRestoredQ: alphaPixels.layerBAfterRedoStrokeQ > 0,
    redoRestoredBByteExactly: differingBytes.layerBRedoVersusBeforeUndo === 0,
    paintingBDidNotChangeA: differingBytes.layerAAfterPaintingB === 0,
    undoDidNotChangeA: differingBytes.layerAAfterUndo === 0,
    redoDidNotChangeA: differingBytes.layerAAfterRedo === 0,
    twoLayerSwitchStayedWithinDocumentedCeiling: withinDocumentedCeiling,
    ...memoryChecks,
    ...Object.fromEntries(Object.entries(compositing.checks).map(
      ([name, passed]) => [`composite.${name}`, passed],
    )),
    fatalPreparationUndoSucceeded: fatalPreparationUndoReturned,
    fatalRollbackFailureWasReported: fatalRollback.threw,
    fatalRollbackRestoredTheCursor: fatalRollback.cursorRestored,
    fatalRollbackRestoredTheActiveLayer: fatalRollback.activeLayerRestored,
    fatalRollbackDetectedTheHalfSwitch: !fatalRollback.workingSetMatchesActiveLayer,
    fatalRollbackLatchedBusy: fatalRollback.historyBusy,
    fatalRollbackLatchedInconsistent: fatalRollback.historyInconsistent,
    fatalRollbackDisabledUndo: !fatalRollback.canUndo,
    fatalRollbackDisabledRedo: !fatalRollback.canRedo,
    fatalRollbackLeftEveryLayerByteIdentical:
      fatalRollback.layerDifferingBytes.every((count) => count === 0),
    fatalLatchRefusedAnotherUndo: !fatalFollowUpUndoReturned,
  };

  return {
    version: LAYER_HISTORY_GPU_TEST_VERSION,
    passed: Object.values(checks).every(Boolean),
    checks,
    alphaPixels,
    differingBytes,
    fwidthBakeGap,
    bakeRollback,
    coldStorageRollback: {
      pack: coldPackRollback,
      hydrate: coldHydrateRollback,
    },
    duplicate,
    compositing,
    storageStudy,
    memory: {
      oneLayer: oneLayerMemory,
      twoLayers: twoLayersMemory,
      fiveLayers: compositing.fiveLayerMemory,
    },
    switchCost: {
      documentedBeforeMs: [151, 215],
      twoLayerAfterMs,
      fiveLayerStressMs: compositing.fiveLayerSwitchMs,
      withinDocumentedCeiling,
    },
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
      bevelStyleEnabled,
      bakeFailureWasReported,
    },
  };
}
