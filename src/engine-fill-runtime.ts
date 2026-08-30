/**
 * Lifecycle, transazione e replay del Riempimento. Il percorso caldo del
 * pennello non dipende da questo modulo: un fill è un'azione raster autonoma.
 */
import type { BrushEngine } from "./brush-engine";
import {
  FILL_LAYER_HEIGHT,
  FILL_LAYER_WIDTH,
  FILL_RENDER_MASK_STRATEGY,
  currentFillDocumentMetrics,
  hexToLinearFillColor,
  normalizeFillTolerance,
  resolveFillCompositeMode,
  type FillCompositeMode,
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
import type { DirtyRect } from "./engine-stroke-types";
import {
  commitHistoryActionAtomically,
  rebuildActiveLayerFromHistory,
} from "./engine-history-runtime";
import {
  clientToLayer,
  invalidateActiveLayerBake,
  resolveFillSource,
} from "./engine-layer-runtime";

export const FILL_SCRATCH_LIFECYCLE_STRATEGY =
  "allocate-on-demand-release-immediately-after-close-or-replay" as const;
export const FILL_SCRATCH_IDLE_RELEASE_MS = 0;
export const FILL_SCRATCH_BUSY_RETRY_MS = 50;

function fillScratchRequired(engine: BrushEngine): boolean {
  return engine.fillToolSelected
    || engine.activeFillPreviewSession !== null
    || engine.fillPreviewFinalizationPromise !== null
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
  readonly sourceSeedColorLinear: readonly [number, number, number, number];
  readonly residualFringeRadius: 0 | 1 | 2 | 3;
  readonly tolerancePercent: number;
  readonly compositeMode: FillCompositeMode;
  readonly selectedPixels: number;
  readonly activeBlocks: number;
  readonly activeTiles: number;
  readonly bounds: FillAnalysis["bounds"];
}

export interface FillPreviewState {
  readonly active: boolean;
  readonly terminal: boolean;
}

interface PendingFillClick {
  readonly seedX: number;
  readonly seedY: number;
  readonly startedAt: number;
  tolerancePercent: number;
  color: string;
  linearColor: readonly [number, number, number, number];
}

/**
 * One Fill panel owns one History transaction containing one or more ordered
 * Fill batches. Each new click advances the immutable preview snapshot to the
 * pixels produced so far; tolerance/color can therefore rebuild only the most
 * recent click without disturbing earlier fills in the same panel session.
 */
export interface ActiveFillPreviewSession {
  readonly actionId: number;
  readonly layerId: number;
  readonly sourceLayerId: number;
  readonly sourceIsTarget: boolean;
  readonly sourceView: GPUTextureView;
  seedX: number;
  seedY: number;
  readonly selectionMask: GPUBuffer | null;
  readonly startedAt: number;
  baseLayerHasContent: boolean;
  baseLayerContentBounds: DirtyRect | null;
  baseRecordHasContent: boolean;
  baseRecordContentBounds: DirtyRect | null;
  baseStorageTileMask: Uint32Array;
  readonly stagedBatches: FillHistoryRenderBatch[];
  readonly pendingClicks: PendingFillClick[];
  stagedFillCount: number;
  renderer: FillRenderer | null;
  tolerancePercent: number;
  color: string;
  linearColor: readonly [number, number, number, number];
  analysis: FillAnalysis | null;
  compositeMode: FillCompositeMode | null;
  analyzedTolerancePercent: number | null;
  presentedBounds: DirtyRect | null;
  mutatedBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  startPromise: Promise<FillOperationResult | null> | null;
  tapDrainPromise: Promise<FillOperationResult | null> | null;
  snapshotCaptured: boolean;
  liveSessionActive: boolean;
  ready: boolean;
  terminal: boolean;
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
  readonly renderMaskStrategy: typeof FILL_RENDER_MASK_STRATEGY;
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
        ? "No Fill has completed in this session."
        : !renderer
          ? "The Fill renderer has not been created."
          : "Fill scratch memory has already been released. Select Fill, repeat the action, and press Copy immediately.",
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
    FILL_LAYER_WIDTH,
  );
  const targetRecord = engine.layerStack.layers.find(
    (layer) => layer.id === operation.targetLayerId,
  );
  const targetGpu = engine.layerGpu.get(operation.targetLayerId);
  let renderedSeedRow: FillRenderedRowDiagnosticSummary | null = null;
  let renderedSeedRowError: string | null = null;
  if (!targetRecord) {
    renderedSeedRowError = "The target layer no longer exists.";
  } else if (!targetGpu?.hot) {
    renderedSeedRowError = "The target layer is no longer hot-resident on the GPU.";
  } else {
    try {
      const rowPixels = await engine.readTexturePixels(
        targetGpu.hot.texture,
        { x: 0, y: readback.seedY, width: FILL_LAYER_WIDTH, height: 1 },
        "Fill seed-row diagnostics",
      );
      renderedSeedRow = summarizeFillRenderedRow(
        rowPixels,
        engine.layerFormat,
        readback.maskWords,
        readback.seedY,
        FILL_LAYER_WIDTH,
        readback.compositeMode === null
          ? null
          : {
            compositeMode: readback.compositeMode,
            fillColor: readback.fillColor,
          },
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
    renderMaskStrategy: FILL_RENDER_MASK_STRATEGY,
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
      // With a render-only residual fringe the authoritative CCL metadata still
      // counts the immutable History core, while drawIndirect also contains any
      // neighboring antialias blocks. It must cover, not necessarily equal, the
      // core block count.
      && readback.drawIndirect[1] >= readback.analysis.activeBlocks
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

function cloneFillRect(rect: DirtyRect | null): DirtyRect | null {
  return rect ? { ...rect } : null;
}

function unionFillRects(
  left: DirtyRect | null,
  right: DirtyRect | null,
): DirtyRect | null {
  if (!left) return cloneFillRect(right);
  if (!right) return cloneFillRect(left);
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y,
  };
}

function asFillPreviewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertFillSessionLayer(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): void {
  if (engine.layerStack.active.id !== session.layerId) {
    throw new Error("The active layer changed during the Fill preview.");
  }
}

/** Restores authoritative metadata, optionally unioned with the current mask. */
function setFillPreviewMetadata(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
  analysis: FillAnalysis | null,
): void {
  assertFillSessionLayer(engine, session);
  const record = engine.layerStack.active;
  const previewBounds = analysis?.selectedPixels ? analysis.bounds : null;
  engine.layerContentBounds = unionFillRects(
    session.baseLayerContentBounds,
    previewBounds,
  );
  record.contentBounds = unionFillRects(
    session.baseRecordContentBounds,
    previewBounds,
  );
  engine.layerHasContent = session.baseLayerHasContent || Boolean(previewBounds);
  record.hasContent = session.baseRecordHasContent || Boolean(previewBounds);
  record.storageTileMask.set(session.baseStorageTileMask);
  if (analysis) {
    for (let index = 0; index < analysis.tileMask.length; index += 1) {
      record.storageTileMask[index] |= analysis.tileMask[index];
    }
  }
  invalidateActiveLayerBake(engine);
}

function scheduleFillPreview(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): void {
  if (
    session.previewFrame !== null
    || session.previewInFlight
    || session.previewFault
    || !session.ready
    || session.terminal
  ) {
    return;
  }
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeFillPreviewSession !== session
      || session.terminal
      || session.previewFault
    ) {
      return;
    }
    void startFillPreviewSubmission(engine, session);
  });
}

async function encodeRequestedFillPreview(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
  serial: number,
  tolerancePercent: number,
  color: string,
  linearColor: readonly [number, number, number, number],
): Promise<void> {
  if (engine.activeFillPreviewSession !== session) {
    throw new Error("The Fill preview session is no longer active.");
  }
  assertFillSessionLayer(engine, session);
  const renderer = session.renderer;
  if (!renderer || !session.ready) {
    throw new Error("The Fill preview is not ready.");
  }

  let analysis = session.analysis;
  let compositeMode = session.compositeMode;
  if (session.analyzedTolerancePercent !== tolerancePercent || !analysis || !compositeMode) {
    analysis = await renderer.analyze(
      session.seedX,
      session.seedY,
      normalizeFillTolerance(tolerancePercent),
      linearColor,
      session.selectionMask,
      tolerancePercent,
    );
    compositeMode = resolveFillCompositeMode(
      session.sourceIsTarget,
      analysis.sourceSeedTransparent,
    );
    session.analysis = analysis;
    session.compositeMode = compositeMode;
    session.analyzedTolerancePercent = tolerancePercent;
  }

  // A newer slider/color input arrived while the GPU CCL was being read back.
  // Leave the stale mask unpublished; the latest serial will reuse/recompute it.
  if (
    engine.activeFillPreviewSession !== session
    || serial !== session.requestedSerial
  ) {
    return;
  }

  const dirtyRect = unionFillRects(session.presentedBounds, analysis.bounds);
  if (!dirtyRect) throw new Error("Fill produced no preview bounds.");
  const encoder = engine.device.createCommandEncoder({
    label: `Fill ${session.actionId} · live preview ${tolerancePercent}%`,
  });
  renderer.encodeLivePreview(
    encoder,
    engine.layerTexture,
    engine.layerView,
    session.presentedBounds ? dirtyRect : null,
    compositeMode,
    linearColor,
    analysis.sourceSeedColorLinear,
    analysis.residualFringeRadius,
  );
  engine.device.queue.submit([encoder.finish()]);
  session.mutatedBounds = unionFillRects(session.mutatedBounds, dirtyRect);

  // submitImmediate expands metadata via noteLayerMutation(). Reset it on both
  // sides so each preview is baseline + current mask, never baseline + every
  // tolerance the slider passed through.
  setFillPreviewMetadata(engine, session, analysis);
  engine.submitImmediate(
    [],
    false,
    engine.settings,
    true,
    null,
    dirtyRect,
    false,
  );
  setFillPreviewMetadata(engine, session, analysis);
  session.presentedBounds = { ...analysis.bounds };
  session.encodedSerial = serial;
  await engine.waitForGpuCapped(
    `Fill preview ${tolerancePercent}% ${color}`,
    60_000,
  );
  engine.publishStats();
}

function startFillPreviewSubmission(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeFillPreviewSession !== session
    || session.previewFault
    || !session.ready
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const tolerancePercent = session.tolerancePercent;
  const color = session.color;
  const linearColor = session.linearColor;
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      await encodeRequestedFillPreview(
        engine,
        session,
        serial,
        tolerancePercent,
        color,
        linearColor,
      );
    } catch (error) {
      session.previewFault = asFillPreviewError(error);
      if (engine.activeFillPreviewSession === session) {
        engine.publishStatus(
          `Fill preview interrupted: ${session.previewFault.message}. Close Fill to recover.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeFillPreviewSession === session
        && !session.terminal
        && !session.previewFault
        && session.encodedSerial !== session.requestedSerial
      ) {
        scheduleFillPreview(engine, session);
      }
    }
  });
  session.previewInFlight = completion;
  return completion;
}

async function flushFillPreview(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  for (;;) {
    if (session.previewFault) throw session.previewFault;
    if (engine.activeFillPreviewSession !== session) {
      throw new Error("The Fill preview session ended before it could be flushed.");
    }
    if (session.encodedSerial === session.requestedSerial && !session.previewInFlight) {
      return;
    }
    await startFillPreviewSubmission(engine, session);
  }
}

async function restoreOriginalFillPixels(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;
  setFillPreviewMetadata(engine, session, null);
  if (
    !session.snapshotCaptured
    || !session.liveSessionActive
    || !session.mutatedBounds
    || !session.renderer
  ) {
    return;
  }

  const restoreRect = { ...session.mutatedBounds };
  const encoder = engine.device.createCommandEncoder({
    label: `Fill ${session.actionId} · restore immutable source`,
  });
  session.renderer.encodeLiveSnapshotRestore(
    encoder,
    engine.layerTexture,
    restoreRect,
  );
  engine.device.queue.submit([encoder.finish()]);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate(
      [],
      false,
      engine.settings,
      true,
      null,
      restoreRect,
      false,
    );
  } catch (error) {
    presentationError = error;
  }
  setFillPreviewMetadata(engine, session, null);
  await engine.waitForGpuCapped("Restore Fill preview", 60_000);
  if (presentationError) throw presentationError;
}

function finishFillSession(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  try {
    if (session.liveSessionActive) {
      session.renderer?.endLiveSession();
      session.liveSessionActive = false;
    }
  } catch {
    // Session teardown only retargets scratch bind groups. Pixels and History
    // are already authoritative, so a destroyed renderer must not turn a
    // successful commit/restore into a false document failure.
  } finally {
    if (engine.activeFillPreviewSession === session) {
      engine.activeFillPreviewSession = null;
    }
  }
}

function releaseStagedFillBatches(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): void {
  if (session.stagedBatches.length === 0) return;
  const slices = session.stagedBatches.map((batch) => batch.gpuSlice);
  const preparedRelease = engine.historyGpuStorage.prepareReleaseMany(slices);
  session.stagedBatches.length = 0;
  preparedRelease.commitNoThrow();
}

/**
 * Once a second Fill has started, the renderer snapshot contains the result of
 * the previous clicks rather than the panel-opening pixels. A failed session
 * must therefore replay the still-authoritative journal to roll back the whole
 * panel transaction, not merely restore the latest per-click snapshot.
 */
async function rollbackFillSessionPixels(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): Promise<void> {
  if (session.stagedFillCount === 0) {
    await restoreOriginalFillPixels(engine, session);
    return;
  }
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;
  if (session.liveSessionActive) {
    session.renderer?.endLiveSession();
    session.liveSessionActive = false;
  }
  session.snapshotCaptured = false;
  try {
    await rebuildActiveLayerFromHistory(engine);
  } finally {
    releaseStagedFillBatches(engine, session);
  }
}

async function recoverFailedFillSession(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
  operationError: unknown,
  context: "startup" | "preview" | "commit",
): Promise<never> {
  let restoreError: unknown = null;
  try {
    await rollbackFillSessionPixels(engine, session);
  } catch (error) {
    restoreError = error;
    engine.latchDocumentStateInconsistent(
      `Fill ${context} failed and recovery was incomplete: reload the page.`,
    );
  }
  if (!restoreError) finishFillSession(engine, session);
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  engine.scheduleEffectsScratchShrink();
  engine.scheduleBevelFieldShrink();
  engine.scheduleLayerColdCompression();
  if (!engine.fillToolSelected) scheduleFillScratchRelease(engine);
  const operation = asFillPreviewError(operationError);
  if (restoreError) {
    throw new Error(
      `Fill ${context} failed: ${operation.message}; recovery failed: `
      + asFillPreviewError(restoreError).message,
    );
  }
  throw operation;
}

export function getFillPreviewState(engine: BrushEngine): FillPreviewState {
  const session = engine.activeFillPreviewSession;
  return {
    active: session !== null,
    terminal: session?.terminal ?? false,
  };
}

export function updateFillPreview(
  engine: BrushEngine,
  tolerancePercent: number,
): boolean {
  const session = engine.activeFillPreviewSession;
  if (!session || session.terminal || engine.historyStateInconsistent) return false;
  if (session.previewFault) return false;
  if (!Number.isFinite(tolerancePercent)) return false;
  const normalizedTolerance = Math.min(100, Math.max(0, tolerancePercent));
  const pendingClick = session.pendingClicks.at(-1);
  if (pendingClick) {
    if (normalizedTolerance === pendingClick.tolerancePercent) {
      return true;
    }
    pendingClick.tolerancePercent = normalizedTolerance;
    engine.publishStatus(
      `Fill preview ${normalizedTolerance.toFixed(0)}%…`,
      "working",
    );
    return true;
  }
  if (normalizedTolerance === session.tolerancePercent) {
    return true;
  }
  session.tolerancePercent = normalizedTolerance;
  session.requestedSerial += 1;
  if (session.ready) scheduleFillPreview(engine, session);
  engine.publishStatus(
    `Fill preview ${normalizedTolerance.toFixed(0)}%…`,
    "working",
  );
  return true;
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
    let committed = false;
    try {
      committed = await commitFillPreview(engine);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engine.publishStatus(`Fill failed: ${message}`, "error");
      return false;
    } finally {
      scheduleFillScratchRelease(engine);
    }
    if (!committed && engine.initialized && !engine.historyBusy && !engine.layerSwitchBusy) {
      engine.callbacks.onStatus?.("WebGPU ready. Draw on the canvas.", "ok");
    }
    return true;
  }
  if (!engine.initialized) return false;
  try {
    engine.assertDestructiveRasterEditCanOpen("fill");
  } catch (error) {
    engine.fillToolSelected = false;
    const message = error instanceof Error ? error.message : String(error);
    engine.publishStatus(message, "working");
    return false;
  }
  engine.callbacks.onStatus?.("Preparing WebGPU Fill…", "working");
  try {
    const renderer = await ensureFillRenderer(engine);
    await renderer.prewarmComposite();
    if (!engine.fillToolSelected) {
      scheduleFillScratchRelease(engine);
      return false;
    }
    engine.callbacks.onStatus?.("WebGPU Fill is ready. Tap a region.", "ok");
    engine.publishStats();
    return true;
  } catch (error) {
    engine.fillToolSelected = false;
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Fill is unavailable: ${message}`, "error");
    engine.publishStats();
    scheduleFillScratchRelease(engine);
    return false;
  }
}

export function scheduleFillScratchRelease(
  engine: BrushEngine,
  delayMs = FILL_SCRATCH_IDLE_RELEASE_MS,
): void {
  if (!engine.initialized || fillScratchRequired(engine) || engine.fillScratchReleaseTimer !== null) {
    return;
  }
  engine.fillScratchReleaseTimer = window.setTimeout(() => {
    engine.fillScratchReleaseTimer = null;
    if (fillScratchRequired(engine) || engine.historyBusy || engine.layerSwitchBusy) {
      scheduleFillScratchRelease(engine, FILL_SCRATCH_BUSY_RETRY_MS);
      return;
    }
    void engine.device.queue.onSubmittedWorkDone().then(() => {
      if (!fillScratchRequired(engine) && !engine.historyBusy && !engine.layerSwitchBusy) {
        engine.fillRenderer?.releaseScratch();
        engine.publishStats();
      } else {
        scheduleFillScratchRelease(engine, FILL_SCRATCH_BUSY_RETRY_MS);
      }
    }).catch(() => {
      // device.lost è già gestito dal gate globale del motore.
    });
  }, delayMs);
}

async function startFillPreviewSession(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): Promise<FillOperationResult | null> {
  try {
    await engine.waitForIdle();
    await engine.historyLocalStorage.prepareRasterReplayAtCursor(
      session.layerId,
      engine.historyCursor,
    );
    if (engine.activeFillPreviewSession !== session) return null;
    assertFillSessionLayer(engine, session);

    const renderer = await ensureFillRenderer(engine);
    await renderer.prewarmComposite();
    if (engine.activeFillPreviewSession !== session) return null;
    session.renderer = renderer;
    renderer.setSourceSamplingView(session.sourceView);
    const encoder = engine.device.createCommandEncoder({
      label: `Fill ${session.actionId} · immutable destination snapshot`,
    });
    renderer.beginLiveSession(
      encoder,
      engine.layerTexture,
      session.sourceIsTarget,
    );
    session.snapshotCaptured = true;
    session.liveSessionActive = true;
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped("Prepare Fill preview", 60_000);

    session.ready = true;
    if (!session.terminal) engine.historyBusy = false;
    engine.publishHistoryState();
    await flushFillPreview(engine, session);
    const analysis = session.analysis;
    if (!analysis) throw new Error("Fill did not produce an analysis.");
    if (!session.terminal && engine.activeFillPreviewSession === session) {
      engine.publishStatus(
        `Fill preview: ${analysis.selectedPixels.toLocaleString("en-US")} pixels. `
        + "Adjust the latest fill, tap another region, or close Fill to apply.",
        "ok",
      );
    }
    engine.publishHistoryState();
    engine.publishStats();
    return {
      ...analysis,
      actionId: session.actionId,
      sourceLayerId: session.sourceLayerId,
      targetLayerId: session.layerId,
      totalMs: performance.now() - session.startedAt,
    };
  } catch (error) {
    if (engine.activeFillPreviewSession !== session) throw error;
    session.terminal = true;
    engine.publishStatus(`Fill failed: ${asFillPreviewError(error).message}`, "error");
    return recoverFailedFillSession(engine, session, error, "startup");
  }
}

function createCurrentFillHistoryBatch(
  session: ActiveFillPreviewSession,
  gpuSlice: GpuHistorySlice,
): FillHistoryRenderBatch {
  const analysis = session.analysis;
  const compositeMode = session.compositeMode;
  if (!analysis || !compositeMode) {
    throw new Error("The current Fill preview is incomplete.");
  }
  return {
    kind: "fill",
    actionId: session.actionId,
    layerId: session.layerId,
    sourceLayerId: session.sourceLayerId,
    color: session.color,
    linearColor: [...session.linearColor],
    sourceSeedColorLinear: [...analysis.sourceSeedColorLinear],
    residualFringeRadius: analysis.residualFringeRadius,
    tolerancePercent: session.tolerancePercent,
    compositeMode,
    gpuSlice,
    clearLayer: false,
    dirtyRect: { ...analysis.bounds },
    tileMask: analysis.tileMask.slice(),
  };
}

async function startNextFillClick(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
  click: PendingFillClick,
): Promise<FillOperationResult | null> {
  let orphanedSlice: GpuHistorySlice | null = null;
  try {
    if (engine.activeFillPreviewSession !== session) return null;
    assertFillSessionLayer(engine, session);
    await flushFillPreview(engine, session);
    const renderer = session.renderer;
    const analysis = session.analysis;
    if (!renderer || !analysis || !session.compositeMode) {
      throw new Error("The previous Fill preview is incomplete.");
    }

    orphanedSlice = engine.historyGpuStorage.allocate(
      currentFillDocumentMetrics().historyMaskBytes,
      `Fill ${session.actionId} · staged mask ${session.stagedBatches.length + 1}`,
    );
    const captureEncoder = engine.device.createCommandEncoder({
      label: `Fill ${session.actionId} · capture staged mask ${session.stagedBatches.length + 1}`,
    });
    renderer.encodeFinalMaskCapture(captureEncoder, orphanedSlice);
    engine.device.queue.submit([captureEncoder.finish()]);
    await engine.waitForGpuCapped("Stage Fill mask", 60_000);

    // Publish ownership to the session before advancing the snapshot. From this
    // point onward any failure must replay History to recover the panel-opening
    // state and release every unpublished staged slice.
    const stagedBatch = createCurrentFillHistoryBatch(session, orphanedSlice);
    session.stagedBatches.push(stagedBatch);
    session.stagedFillCount += 1;
    orphanedSlice = null;

    setFillPreviewMetadata(engine, session, analysis);
    const record = engine.layerStack.active;
    session.baseLayerHasContent = engine.layerHasContent;
    session.baseLayerContentBounds = cloneFillRect(engine.layerContentBounds);
    session.baseRecordHasContent = record.hasContent;
    session.baseRecordContentBounds = cloneFillRect(record.contentBounds);
    session.baseStorageTileMask = record.storageTileMask.slice();

    renderer.endLiveSession();
    session.liveSessionActive = false;
    const snapshotEncoder = engine.device.createCommandEncoder({
      label: `Fill ${session.actionId} · immutable snapshot ${session.stagedBatches.length + 1}`,
    });
    renderer.beginLiveSession(
      snapshotEncoder,
      engine.layerTexture,
      session.sourceIsTarget,
    );
    session.liveSessionActive = true;
    session.snapshotCaptured = true;
    engine.device.queue.submit([snapshotEncoder.finish()]);
    await engine.waitForGpuCapped("Prepare next Fill preview", 60_000);

    if (session.pendingClicks[0] !== click) {
      throw new Error("The queued Fill click order is inconsistent.");
    }
    session.pendingClicks.shift();
    session.seedX = click.seedX;
    session.seedY = click.seedY;
    session.tolerancePercent = click.tolerancePercent;
    session.color = click.color;
    session.linearColor = click.linearColor;
    session.analysis = null;
    session.compositeMode = null;
    session.analyzedTolerancePercent = null;
    session.presentedBounds = null;
    session.mutatedBounds = null;
    session.requestedSerial = 1;
    session.encodedSerial = 0;
    session.previewFault = null;
    session.ready = true;
    await flushFillPreview(engine, session);

    // flushFillPreview mutates the session asynchronously; make that effect
    // explicit because TypeScript otherwise retains the preceding null write.
    const nextAnalysis = session.analysis as FillAnalysis | null;
    if (!nextAnalysis) throw new Error("Fill did not produce an analysis.");
    if (!session.terminal && engine.activeFillPreviewSession === session) {
      engine.publishStatus(
        `Fill ${session.stagedBatches.length + 1} preview: `
        + `${nextAnalysis.selectedPixels.toLocaleString("en-US")} pixels. `
        + "Adjust the latest fill, tap another region, or close Fill to apply.",
        "ok",
      );
    }
    engine.publishHistoryState();
    engine.publishStats();
    return {
      ...nextAnalysis,
      actionId: session.actionId,
      sourceLayerId: session.sourceLayerId,
      targetLayerId: session.layerId,
      totalMs: performance.now() - click.startedAt,
    };
  } catch (error) {
    if (orphanedSlice) engine.historyGpuStorage.release(orphanedSlice);
    throw error;
  }
}

function enqueueFillClick(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
  click: PendingFillClick,
): Promise<FillOperationResult | null> {
  session.pendingClicks.push(click);
  const predecessor = session.tapDrainPromise
    ?? session.startPromise
    ?? Promise.resolve<FillOperationResult | null>(null);
  const operation = predecessor.then(async () => {
    if (engine.activeFillPreviewSession !== session) return null;
    return startNextFillClick(engine, session, click);
  }).catch(async (error): Promise<never> => {
    if (engine.activeFillPreviewSession !== session) throw error;
    session.previewFault = asFillPreviewError(error);
    session.terminal = true;
    engine.publishStatus(`Fill failed: ${session.previewFault.message}`, "error");
    return recoverFailedFillSession(engine, session, error, "preview");
  });
  session.tapDrainPromise = operation;
  return operation;
}

export async function fillAtClientPoint(
  engine: BrushEngine,
  clientX: number,
  clientY: number,
  tolerancePercent: number,
  color: string,
): Promise<FillOperationResult | null> {
  const activeSession = engine.activeFillPreviewSession;
  const continuingFillSession = activeSession !== null
    && !activeSession.terminal
    && !activeSession.previewFault
    && engine.fillPreviewFinalizationPromise === null;
  const destructiveEdit = engine.activeDestructiveRasterEditKind();
  if (
    !engine.initialized
    || !engine.fillToolSelected
    || engine.historyStateInconsistent
    || (engine.historyBusy && !continuingFillSession)
    || engine.layerSwitchBusy
    || engine.selectionBusy
    || engine.activeStroke
    || engine.activeVectorHistoryEdit
    || engine.activeRasterLayerMetadataHistoryEdit
    || (destructiveEdit !== null && destructiveEdit !== "fill")
    || (activeSession !== null && !continuingFillSession)
    || engine.fillPreviewFinalizationPromise !== null
  ) {
    return null;
  }
  if (!engine.canPaintSelectedSceneItem()) {
    engine.callbacks.onStatus?.(
      "Fill works only on the selected raster layer.",
      "working",
    );
    return null;
  }
  const point = clientToLayer(engine, clientX, clientY);
  const seedX = Math.floor(point.x);
  const seedY = Math.floor(point.y);
  if (
    seedX < 0
    || seedY < 0
    || seedX >= engine.documentWidth
    || seedY >= engine.documentHeight
  ) {
    return null;
  }

  if (!Number.isFinite(tolerancePercent)) return null;
  const normalizedTolerance = Math.min(100, Math.max(0, tolerancePercent));
  const linearColor = hexToLinearFillColor(color);
  if (activeSession) {
    assertFillSessionLayer(engine, activeSession);
    return enqueueFillClick(engine, activeSession, {
      seedX,
      seedY,
      startedAt: performance.now(),
      tolerancePercent: normalizedTolerance,
      color,
      linearColor,
    });
  }

  const target = engine.layerStack.active;
  const source = resolveFillSource(engine);
  const selectionMask = engine.pixelSelectionState.selectedPixels > 0
    ? engine.selectionRenderer?.maskBuffer ?? null
    : null;
  if (engine.pixelSelectionState.selectedPixels > 0 && !selectionMask) {
    throw new Error("A pixel selection is active, but its GPU mask is not resident.");
  }
  const session: ActiveFillPreviewSession = {
    actionId: engine.nextHistoryActionId,
    layerId: target.id,
    sourceLayerId: source.record.id,
    sourceIsTarget: source.record.id === target.id,
    sourceView: source.view,
    seedX,
    seedY,
    selectionMask,
    startedAt: performance.now(),
    baseLayerHasContent: engine.layerHasContent,
    baseLayerContentBounds: cloneFillRect(engine.layerContentBounds),
    baseRecordHasContent: target.hasContent,
    baseRecordContentBounds: cloneFillRect(target.contentBounds),
    baseStorageTileMask: target.storageTileMask.slice(),
    stagedBatches: [],
    pendingClicks: [],
    stagedFillCount: 0,
    renderer: null,
    tolerancePercent: normalizedTolerance,
    color,
    linearColor,
    analysis: null,
    compositeMode: null,
    analyzedTolerancePercent: null,
    presentedBounds: null,
    mutatedBounds: null,
    requestedSerial: 1,
    encodedSerial: 0,
    previewFrame: null,
    previewInFlight: null,
    previewFault: null,
    startPromise: null,
    tapDrainPromise: null,
    snapshotCaptured: false,
    liveSessionActive: false,
    ready: false,
    terminal: false,
  };

  engine.cancelLayerColdCompressionIdle();
  engine.invalidateAdaptivePreview();
  engine.activeFillPreviewSession = session;
  engine.historyBusy = true;
  engine.publishHistoryState();
  engine.callbacks.onStatus?.("Preparing live Fill preview…", "working");
  const startPromise = startFillPreviewSession(engine, session);
  session.startPromise = startPromise;
  return startPromise;
}

async function finalizeFillPreview(
  engine: BrushEngine,
  session: ActiveFillPreviewSession,
): Promise<boolean> {
  engine.historyBusy = true;
  engine.publishHistoryState();
  let historySlice: GpuHistorySlice | null = null;
  let historyPublished = false;
  try {
    if (session.startPromise) await session.startPromise;
    if (session.tapDrainPromise) await session.tapDrainPromise;
    if (engine.activeFillPreviewSession !== session) return false;
    if (engine.historyStateInconsistent) {
      throw new Error("The document is locked because Fill recovery was incomplete.");
    }
    await flushFillPreview(engine, session);
    const renderer = session.renderer;
    const analysis = session.analysis;
    const compositeMode = session.compositeMode;
    if (!renderer || !analysis || !compositeMode) {
      throw new Error("The final Fill preview is incomplete.");
    }
    assertFillSessionLayer(engine, session);
    historySlice = engine.historyGpuStorage.allocate(
      currentFillDocumentMetrics().historyMaskBytes,
      `Fill ${session.actionId} · final mask ${FILL_LAYER_WIDTH}×${FILL_LAYER_HEIGHT} 1-bit`,
    );
    const encoder = engine.device.createCommandEncoder({
      label: `Fill ${session.actionId} · capture final History mask`,
    });
    renderer.encodeFinalMaskCapture(encoder, historySlice);
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped("Finalize Fill mask", 60_000);

    const capturedHistorySlice = historySlice;
    const batch = createCurrentFillHistoryBatch(session, capturedHistorySlice);
    const batches = [...session.stagedBatches, batch];
    commitHistoryActionAtomically(
      engine,
      {
        id: session.actionId,
        kind: "fill",
        layerId: session.layerId,
      },
      {
        batches,
        releasePayloadOnCancel: () => {
          const slices = batches.map((item) => item.gpuSlice);
          engine.historyGpuStorage.prepareReleaseMany(slices).commitNoThrow();
          session.stagedBatches.length = 0;
          if (historySlice === capturedHistorySlice) historySlice = null;
        },
      },
    );
    historySlice = null;
    session.stagedBatches.length = 0;
    historyPublished = true;
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
    engine.lastFillDiagnosticOperation = {
      actionId: session.actionId,
      capturedAt: new Date().toISOString(),
      sourceLayerId: session.sourceLayerId,
      targetLayerId: session.layerId,
      seedX: session.seedX,
      seedY: session.seedY,
      color: session.color,
      linearColor: [...session.linearColor],
      sourceSeedColorLinear: [...analysis.sourceSeedColorLinear],
      residualFringeRadius: analysis.residualFringeRadius,
      tolerancePercent: session.tolerancePercent,
      compositeMode,
      selectedPixels: analysis.selectedPixels,
      activeBlocks: analysis.activeBlocks,
      activeTiles: analysis.activeTiles,
      bounds: { ...analysis.bounds },
    };
    finishFillSession(engine, session);
    engine.sweepRasterImageGpuResources();
    const fillCount = session.stagedFillCount + 1;
    engine.publishStatus(
      `Applied ${fillCount.toLocaleString("en-US")} Fill${fillCount === 1 ? "" : "s"}; `
      + `the latest covered ${analysis.selectedPixels.toLocaleString("en-US")} pixels across `
      + `${analysis.activeTiles} tiles. `
      + `${(performance.now() - session.startedAt).toFixed(1)} ms: one Undo step.`,
      "ok",
    );
    return true;
  } catch (error) {
    if (historySlice) {
      engine.historyGpuStorage.release(historySlice);
      historySlice = null;
    }
    if (!historyPublished && engine.activeFillPreviewSession === session) {
      // Startup owns its rollback. If that first recovery already latched an
      // inconsistent document, retain the immutable snapshot/session for
      // diagnostics instead of issuing a second restore from this finalizer.
      if (engine.historyStateInconsistent) throw error;
      engine.publishStatus(`Fill failed: ${asFillPreviewError(error).message}`, "error");
      return recoverFailedFillSession(engine, session, error, "commit");
    }
    if (engine.activeFillPreviewSession === session) finishFillSession(engine, session);
    throw error;
  } finally {
    if (engine.activeFillPreviewSession !== session) {
      engine.historyBusy = engine.historyStateInconsistent;
    }
    engine.publishHistoryState();
    engine.publishStats();
    engine.scheduleEffectsScratchShrink();
    engine.scheduleBevelFieldShrink();
    engine.scheduleLayerColdCompression();
    if (!engine.fillToolSelected) scheduleFillScratchRelease(engine);
  }
}

/** Idempotent close path shared by swipe, Escape, tool change and pagehide. */
export function commitFillPreview(engine: BrushEngine): Promise<boolean> {
  if (engine.fillPreviewFinalizationPromise) {
    return engine.fillPreviewFinalizationPromise;
  }
  const session = engine.activeFillPreviewSession;
  if (!session) return Promise.resolve(false);
  session.terminal = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  engine.historyBusy = true;
  engine.publishHistoryState();
  const operation = finalizeFillPreview(engine, session);
  engine.fillPreviewFinalizationPromise = operation;
  const settled = (): void => {
    if (engine.fillPreviewFinalizationPromise === operation) {
      engine.fillPreviewFinalizationPromise = null;
    }
    if (!engine.fillToolSelected) scheduleFillScratchRelease(engine);
  };
  void operation.then(settled, settled);
  return operation;
}

export async function submitFillHistoryBatch(
  engine: BrushEngine,
  batch: FillHistoryRenderBatch,
  present: boolean,
): Promise<void> {
  try {
    const renderer = await ensureFillRenderer(engine);
    await renderer.prewarmComposite();
    renderer.setSourceSamplingView(resolveFillSource(engine).view);
    const storageMaskBefore = engine.layerStack.active.storageTileMask.slice();
    const encoder = engine.device.createCommandEncoder({
      label: `Replay Fill ${batch.actionId}`,
    });
    renderer.encodeReplayCommit(
      encoder,
      engine.layerTexture,
      engine.layerView,
      batch.gpuSlice,
      batch.linearColor,
      batch.sourceSeedColorLinear,
      batch.residualFringeRadius,
      batch.compositeMode,
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
  } finally {
    if (!engine.fillToolSelected) scheduleFillScratchRelease(engine);
  }
}
