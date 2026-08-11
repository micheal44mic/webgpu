/**
 * Lifecycle, transazione e replay del Riempimento. Il percorso caldo del
 * pennello non dipende da questo modulo: un fill è un'azione raster autonoma.
 */
import type { BrushEngine } from "./brush-engine";
import {
  FILL_HISTORY_MASK_BYTES,
  FILL_LAYER_SIZE,
  hexToLinearFillColor,
  normalizeFillTolerance,
  type FillAnalysis,
} from "./fill-core";
import {
  FILL_DIAGNOSTIC_SCHEMA,
  classifyFillDiagnostic,
  summarizeFillMaskWords,
  summarizeFillRenderedRow,
  type FillDiagnosticClassification,
  type FillMaskDiagnosticSummary,
  type FillRenderedRowDiagnosticSummary,
} from "./fill-diagnostics";
import { FillRenderer } from "./fill-renderer";
import type { FillHistoryRenderBatch } from "./engine-history-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import { clientToLayer, resolveFillSource } from "./engine-layer-runtime";
import {
  rebuildActiveLayerFromHistory,
  truncateRedoHistory,
} from "./engine-history-runtime";

export const FILL_SCRATCH_LIFECYCLE_STRATEGY =
  "allocate-on-fill-select-release-when-idle-unused" as const;
export const FILL_SCRATCH_IDLE_RELEASE_MS = 1_500;

function fillScratchRequired(engine: BrushEngine): boolean {
  return engine.fillToolSelected
    || engine.selectionBusy
    || (engine.selectionToolSelected && engine.selectionMethod === "magic-wand");
}

export interface FillOperationResult extends FillAnalysis {
  readonly actionId: number;
  readonly sourceLayerId: number;
  readonly targetLayerId: number;
  readonly totalMs: number;
}

export interface LastFillDiagnosticOperation {
  readonly actionId: number;
  readonly capturedAt: string;
  readonly sourceLayerId: number;
  readonly targetLayerId: number;
  readonly seedX: number;
  readonly seedY: number;
  readonly color: string;
  readonly linearColor: readonly [number, number, number, number];
  readonly tolerancePercent: number;
  readonly selectedPixels: number;
  readonly activeBlocks: number;
  readonly activeTiles: number;
  readonly bounds: FillAnalysis["bounds"];
}

export type FillDiagnosticReport = {
  readonly schema: typeof FILL_DIAGNOSTIC_SCHEMA;
  readonly available: false;
  readonly reason: string;
  readonly rendererResident: boolean;
  readonly lastOperation: LastFillDiagnosticOperation | null;
} | {
  readonly schema: typeof FILL_DIAGNOSTIC_SCHEMA;
  readonly available: true;
  readonly rendererResident: true;
  readonly lastOperation: LastFillDiagnosticOperation;
  readonly currentHistory: {
    readonly cursor: number;
    readonly actionCount: number;
    readonly operationIsLatestAppliedAction: boolean;
    readonly targetLayerStillExists: boolean;
    readonly targetLayerStillActive: boolean;
  };
  readonly analysisSequence: number;
  readonly maskReadbackMs: number;
  readonly drawIndirect: readonly number[];
  readonly drawIndirectMatchesMetadata: boolean;
  readonly bitProbe: Awaited<ReturnType<FillRenderer["captureDiagnostics"]>>["bitProbe"];
  readonly mask: FillMaskDiagnosticSummary;
  readonly renderedSeedRow: FillRenderedRowDiagnosticSummary | null;
  readonly renderedSeedRowError: string | null;
  readonly classification: FillDiagnosticClassification | "target-row-unavailable";
};

export async function captureFillDiagnostics(
  engine: BrushEngine,
): Promise<FillDiagnosticReport> {
  const operation = engine.lastFillDiagnosticOperation;
  const renderer = engine.fillRenderer;
  if (!operation || !renderer || !renderer.resident) {
    return {
      schema: FILL_DIAGNOSTIC_SCHEMA,
      available: false,
      reason: !operation
        ? "Nessun Fill completato in questa sessione."
        : !renderer
          ? "Renderer Fill non creato."
          : "Scratch Fill già rilasciato: seleziona Fill, ripeti e premi subito Copy.",
      rendererResident: Boolean(renderer?.resident),
      lastOperation: operation ? { ...operation, bounds: { ...operation.bounds } } : null,
    };
  }

  await engine.waitForIdle();
  const readback = await renderer.captureDiagnostics();
  const mask = summarizeFillMaskWords(
    readback.maskWords,
    readback.analysis.selectedPixels,
    readback.seedX,
    readback.seedY,
    FILL_LAYER_SIZE,
  );
  const targetRecord = engine.layerStack.layers.find(
    (layer) => layer.id === operation.targetLayerId,
  );
  const targetGpu = engine.layerGpu.get(operation.targetLayerId);
  let renderedSeedRow: FillRenderedRowDiagnosticSummary | null = null;
  let renderedSeedRowError: string | null = null;
  if (!targetRecord) {
    renderedSeedRowError = "Il livello target non esiste più.";
  } else if (!targetGpu?.hot) {
    renderedSeedRowError = "Il livello target non è più residente hot sulla GPU.";
  } else {
    try {
      const rowPixels = await engine.readTexturePixels(
        targetGpu.hot.texture,
        { x: 0, y: readback.seedY, width: FILL_LAYER_SIZE, height: 1 },
        "diagnosi Fill riga seed",
      );
      renderedSeedRow = summarizeFillRenderedRow(
        rowPixels,
        engine.layerFormat,
        readback.maskWords,
        readback.fillColor,
        readback.seedY,
        FILL_LAYER_SIZE,
      );
    } catch (error) {
      renderedSeedRowError = error instanceof Error ? error.message : String(error);
    }
  }
  const history = engine.getHistoryState();
  const latestApplied = engine.historyActions[engine.historyCursor - 1];
  return {
    schema: FILL_DIAGNOSTIC_SCHEMA,
    available: true,
    rendererResident: true,
    lastOperation: { ...operation, bounds: { ...operation.bounds } },
    currentHistory: {
      cursor: history.cursor,
      actionCount: history.actionCount,
      operationIsLatestAppliedAction: latestApplied?.id === operation.actionId,
      targetLayerStillExists: Boolean(targetRecord),
      targetLayerStillActive: engine.layerStack.active.id === operation.targetLayerId,
    },
    analysisSequence: readback.sequence,
    maskReadbackMs: readback.readbackMs,
    drawIndirect: readback.drawIndirect,
    drawIndirectMatchesMetadata: readback.drawIndirect.length === 4
      && readback.drawIndirect[0] === 4
      && readback.drawIndirect[1] === readback.analysis.activeBlocks
      && readback.drawIndirect[2] === 0
      && readback.drawIndirect[3] === 0,
    bitProbe: readback.bitProbe,
    mask,
    renderedSeedRow,
    renderedSeedRowError,
    classification: renderedSeedRow
      ? classifyFillDiagnostic(mask, renderedSeedRow)
      : "target-row-unavailable",
  };
}

export async function ensureFillRenderer(engine: BrushEngine): Promise<FillRenderer> {
  if (engine.fillRenderer) return engine.fillRenderer;
  if (!engine.fillRendererLoadingPromise) {
    const source = resolveFillSource(engine);
    engine.fillRendererLoadingPromise = FillRenderer.create({
      device: engine.device,
      layerFormat: engine.layerFormat,
      sourceSamplingView: source.view,
    }).then((renderer) => {
      renderer.setSourceSamplingView(resolveFillSource(engine).view);
      engine.fillRenderer = renderer;
      return renderer;
    }).finally(() => {
      engine.fillRendererLoadingPromise = null;
    });
  }
  return engine.fillRendererLoadingPromise;
}

export async function setFillToolSelected(
  engine: BrushEngine,
  selected: boolean,
): Promise<boolean> {
  engine.fillToolSelected = selected;
  if (engine.fillScratchReleaseTimer !== null) {
    window.clearTimeout(engine.fillScratchReleaseTimer);
    engine.fillScratchReleaseTimer = null;
  }
  if (!selected) {
    if (engine.initialized && !engine.historyBusy && !engine.layerSwitchBusy) {
      engine.callbacks.onStatus?.("WebGPU pronto. Disegna sul canvas.", "ok");
    }
    scheduleFillScratchRelease(engine);
    return true;
  }
  if (!engine.initialized) return false;
  engine.callbacks.onStatus?.("Preparo il Riempimento WebGPU…", "working");
  try {
    const renderer = await ensureFillRenderer(engine);
    await renderer.prewarm();
    if (!engine.fillToolSelected) {
      scheduleFillScratchRelease(engine);
      return false;
    }
    engine.callbacks.onStatus?.("Riempimento WebGPU pronto: tocca una regione.", "ok");
    engine.publishStats();
    return true;
  } catch (error) {
    engine.fillToolSelected = false;
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Riempimento non disponibile: ${message}`, "error");
    engine.publishStats();
    return false;
  }
}

export function scheduleFillScratchRelease(engine: BrushEngine): void {
  if (!engine.initialized || fillScratchRequired(engine) || engine.fillScratchReleaseTimer !== null) {
    return;
  }
  engine.fillScratchReleaseTimer = window.setTimeout(() => {
    engine.fillScratchReleaseTimer = null;
    if (fillScratchRequired(engine) || engine.historyBusy || engine.layerSwitchBusy) {
      scheduleFillScratchRelease(engine);
      return;
    }
    void engine.device.queue.onSubmittedWorkDone().then(() => {
      if (!fillScratchRequired(engine) && !engine.historyBusy && !engine.layerSwitchBusy) {
        engine.fillRenderer?.releaseScratch();
        engine.publishStats();
      } else {
        scheduleFillScratchRelease(engine);
      }
    }).catch(() => {
      // device.lost è già gestito dal gate globale del motore.
    });
  }, FILL_SCRATCH_IDLE_RELEASE_MS);
}

export async function fillAtClientPoint(
  engine: BrushEngine,
  clientX: number,
  clientY: number,
  tolerancePercent: number,
  color: string,
): Promise<FillOperationResult | null> {
  if (
    !engine.initialized
    || !engine.fillToolSelected
    || engine.historyBusy
    || engine.layerSwitchBusy
    || engine.selectionBusy
    || engine.activeStroke
    || engine.activeVectorHistoryEdit
  ) {
    return null;
  }
  if (!engine.canPaintSelectedSceneItem()) {
    engine.callbacks.onStatus?.(
      "Il Riempimento agisce solo sul livello raster selezionato.",
      "working",
    );
    return null;
  }
  const point = clientToLayer(engine, clientX, clientY);
  const seedX = Math.floor(point.x);
  const seedY = Math.floor(point.y);
  if (seedX < 0 || seedY < 0 || seedX >= engine.layerSize || seedY >= engine.layerSize) {
    return null;
  }

  engine.cancelLayerColdCompressionIdle();
  engine.invalidateAdaptivePreview();
  engine.historyBusy = true;
  engine.publishHistoryState();
  engine.callbacks.onStatus?.("Riempimento WebGPU in corso…", "working");
  const startedAt = performance.now();
  let historySlice: GpuHistorySlice | null = null;
  let pixelsMutated = false;
  try {
    await engine.waitForIdle();
    await engine.historyLocalStorage.prepareRasterReplayAtCursor(
      engine.layerStack.active.id,
      engine.historyCursor,
    );
    const renderer = await ensureFillRenderer(engine);
    await renderer.prewarm();
    const source = resolveFillSource(engine);
    renderer.setSourceSamplingView(source.view);
    const target = engine.layerStack.active;
    const linearColor = hexToLinearFillColor(color);
    const selectionMask = engine.pixelSelectionState.selectedPixels > 0
      ? engine.selectionRenderer?.maskBuffer ?? null
      : null;
    if (engine.pixelSelectionState.selectedPixels > 0 && !selectionMask) {
      throw new Error("Selezione pixel attiva ma maschera GPU non residente.");
    }
    const analysis = await renderer.analyze(
      seedX,
      seedY,
      normalizeFillTolerance(tolerancePercent),
      linearColor,
      selectionMask,
    );
    const actionId = engine.nextHistoryActionId;
    historySlice = engine.historyGpuStorage.allocate(
      FILL_HISTORY_MASK_BYTES,
      `Fill ${actionId} · mask ${FILL_LAYER_SIZE}² 1-bit`,
    );

    const storageMaskBefore = engine.layerStack.active.storageTileMask.slice();
    const encoder = engine.device.createCommandEncoder({
      label: `Riempimento ${actionId} · commit selezionato`,
    });
    renderer.encodeLiveCommit(encoder, engine.layerView, historySlice);
    engine.device.queue.submit([encoder.finish()]);
    pixelsMutated = true;

    // Riusa il percorso già autorevole per effetti, mip e presentazione. Non
    // emette stamp e non altera il percorso caldo che genera le pennellate.
    engine.submitImmediate(
      [],
      false,
      engine.settings,
      true,
      null,
      analysis.bounds,
      false,
    );
    const record = engine.layerStack.active;
    record.storageTileMask.set(storageMaskBefore);
    for (let index = 0; index < analysis.tileMask.length; index += 1) {
      record.storageTileMask[index] |= analysis.tileMask[index];
    }
    engine.layerHasContent = true;
    record.hasContent = true;
    record.contentBounds = engine.layerContentBounds;
    await engine.waitForGpuCapped("Completamento Riempimento", 60_000);

    truncateRedoHistory(engine);
    engine.nextHistoryActionId += 1;
    engine.historyActions.push({
      id: actionId,
      kind: "fill",
      layerId: record.id,
    });
    engine.sweepRasterImageGpuResources();
    const batch: FillHistoryRenderBatch = {
      kind: "fill",
      actionId,
      layerId: record.id,
      sourceLayerId: source.record.id,
      color,
      linearColor: [...linearColor],
      tolerancePercent,
      gpuSlice: historySlice,
      clearLayer: false,
      dirtyRect: { ...analysis.bounds },
      tileMask: analysis.tileMask.slice(),
    };
    engine.historyBatches.push(batch);
    engine.lastFillDiagnosticOperation = {
      actionId,
      capturedAt: new Date().toISOString(),
      sourceLayerId: source.record.id,
      targetLayerId: target.id,
      seedX,
      seedY,
      color,
      linearColor: [...linearColor],
      tolerancePercent,
      selectedPixels: analysis.selectedPixels,
      activeBlocks: analysis.activeBlocks,
      activeTiles: analysis.activeTiles,
      bounds: { ...analysis.bounds },
    };
    historySlice = null;
    engine.historyCursor = engine.historyActions.length;
    engine.callbacks.onStatus?.(
      `Riempiti ${analysis.selectedPixels.toLocaleString("it-IT")} pixel su `
      + `${analysis.activeTiles} tile in `
      + `${(performance.now() - startedAt).toFixed(1)} ms.`,
      "ok",
    );
    engine.publishStats();
    return {
      ...analysis,
      actionId,
      sourceLayerId: source.record.id,
      targetLayerId: target.id,
      totalMs: performance.now() - startedAt,
    };
  } catch (error) {
    if (historySlice) engine.historyGpuStorage.release(historySlice);
    if (pixelsMutated) {
      try {
        await rebuildActiveLayerFromHistory(engine);
      } catch (rollbackError) {
        const original = error instanceof Error ? error.message : String(error);
        const rollback = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        engine.latchDocumentStateInconsistent(
          "Stato incoerente dopo il Riempimento: ricarica prima di continuare.",
        );
        throw new Error(
          `Riempimento fallito (${original}) e ripristino fallito (${rollback}).`,
        );
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Riempimento fallito: ${message}`, "error");
    throw error;
  } finally {
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.scheduleEffectsScratchShrink();
    engine.scheduleBevelFieldShrink();
    engine.scheduleLayerColdCompression();
  }
}

export async function submitFillHistoryBatch(
  engine: BrushEngine,
  batch: FillHistoryRenderBatch,
  present: boolean,
): Promise<void> {
  const renderer = await ensureFillRenderer(engine);
  await renderer.prewarm();
  renderer.setSourceSamplingView(resolveFillSource(engine).view);
  const storageMaskBefore = engine.layerStack.active.storageTileMask.slice();
  const encoder = engine.device.createCommandEncoder({
    label: `Replay Fill ${batch.actionId}`,
  });
  renderer.encodeReplayCommit(
    encoder,
    engine.layerView,
    batch.gpuSlice,
    batch.linearColor,
  );
  engine.device.queue.submit([encoder.finish()]);
  engine.submitImmediate(
    [],
    false,
    engine.settings,
    present,
    null,
    batch.dirtyRect,
    false,
  );
  const record = engine.layerStack.active;
  record.storageTileMask.set(storageMaskBefore);
  for (let index = 0; index < batch.tileMask.length; index += 1) {
    record.storageTileMask[index] |= batch.tileMask[index];
  }
}
