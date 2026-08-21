/**
 * Selezione raster document-wide. Le candidate vengono costruite leggendo il
 * mip 0 grezzo del raster attivo; non usano Riferimento Fill, effetti o scena
 * composita e non entrano nel percorso caldo delle pennellate.
 */
import type { BrushEngine } from "./brush-engine";
import { ensureFillRenderer, scheduleFillScratchRelease } from "./engine-fill-runtime";
import { clientToLayer } from "./engine-layer-runtime";
import {
  SELECTION_MASK_BYTES,
  SELECTION_TILE_GRID_SIZE,
  SELECTION_TILE_HEIGHT,
  SELECTION_TILE_WIDTH,
  buildLassoSpans,
  emptyPixelSelectionState,
  normalizeMagicWandTolerance,
  normalizeSelectionCombineMode,
  normalizeSelectionMethod,
  normalizeSelectionTolerance,
  selectionHexToStraightSrgb,
  type PixelSelectionState,
  type SelectionCombineMode,
  type SelectionMethod,
  type SelectionOperationResult,
  type SelectionPoint,
} from "./selection-core";
import { SelectionRenderer } from "./selection-renderer";
import type { DirtyRect } from "./engine-stroke-types";
import type {
  PaintHistoryRenderBatch,
  SelectionHistoryMaskSnapshot,
} from "./engine-history-types";

export const SELECTION_RENDERER_IDLE_RELEASE_MS = 1_500;

/**
 * Restricts Paint's conservative stamp AABB to the selected bounds and to the
 * bounding union of active 256 px selection tiles. Fragment masking remains
 * authoritative at one-bit-per-pixel; this CPU result exists only to keep
 * dirty metadata, scissors, mips and effects from claiming untouched regions.
 */
export function clipPaintDirtyRectToPixelSelection(
  engine: BrushEngine,
  dirtyRect: DirtyRect | null,
  replayBatch: PaintHistoryRenderBatch | null = null,
): DirtyRect | null {
  if (!dirtyRect) return null;
  const snapshot = replayBatch?.selectionMask ?? null;
  if (replayBatch && !snapshot) return { ...dirtyRect };
  const selectedPixels = snapshot?.selectedPixels
    ?? engine.pixelSelectionState.selectedPixels;
  if (selectedPixels === 0) return replayBatch ? null : { ...dirtyRect };
  const bounds = snapshot?.bounds ?? engine.pixelSelectionState.bounds;
  const tileMask = snapshot?.tileMask ?? engine.pixelSelectionTileMask;
  if (!bounds || !tileMask) {
    throw new Error("Pixel Selection metadata is missing during Paint.");
  }

  const left = Math.max(dirtyRect.x, bounds.x);
  const top = Math.max(dirtyRect.y, bounds.y);
  const right = Math.min(
    dirtyRect.x + dirtyRect.width,
    bounds.x + bounds.width,
  );
  const bottom = Math.min(
    dirtyRect.y + dirtyRect.height,
    bounds.y + bounds.height,
  );
  if (right <= left || bottom <= top) return null;

  const firstTileX = Math.max(0, Math.floor(left / SELECTION_TILE_WIDTH));
  const firstTileY = Math.max(0, Math.floor(top / SELECTION_TILE_HEIGHT));
  const lastTileX = Math.min(
    SELECTION_TILE_GRID_SIZE - 1,
    Math.floor((right - 1) / SELECTION_TILE_WIDTH),
  );
  const lastTileY = Math.min(
    SELECTION_TILE_GRID_SIZE - 1,
    Math.floor((bottom - 1) / SELECTION_TILE_HEIGHT),
  );
  let clippedLeft = Number.POSITIVE_INFINITY;
  let clippedTop = Number.POSITIVE_INFINITY;
  let clippedRight = Number.NEGATIVE_INFINITY;
  let clippedBottom = Number.NEGATIVE_INFINITY;
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const tileIndex = tileY * SELECTION_TILE_GRID_SIZE + tileX;
      if ((tileMask[tileIndex >>> 5] & (1 << (tileIndex & 31))) === 0) continue;
      clippedLeft = Math.min(clippedLeft, Math.max(left, tileX * SELECTION_TILE_WIDTH));
      clippedTop = Math.min(clippedTop, Math.max(top, tileY * SELECTION_TILE_HEIGHT));
      clippedRight = Math.max(
        clippedRight,
        Math.min(right, (tileX + 1) * SELECTION_TILE_WIDTH),
      );
      clippedBottom = Math.max(
        clippedBottom,
        Math.min(bottom, (tileY + 1) * SELECTION_TILE_HEIGHT),
      );
    }
  }
  if (!Number.isFinite(clippedLeft)) return null;
  return {
    x: clippedLeft,
    y: clippedTop,
    width: clippedRight - clippedLeft,
    height: clippedBottom - clippedTop,
  };
}

export function bindPaintPipelineWithPixelSelection(
  engine: BrushEngine,
  pass: GPURenderPassEncoder,
  basePipeline: GPURenderPipeline,
  replayBatch: PaintHistoryRenderBatch | null = null,
): void {
  const historySnapshot = replayBatch?.selectionMask ?? null;
  const usesLiveSelection = replayBatch === null
    && engine.pixelSelectionState.selectedPixels > 0;
  if (!historySnapshot && !usesLiveSelection) {
    pass.setPipeline(basePipeline);
    return;
  }

  const selectedPipeline = engine.selectionPipelineByBase.get(basePipeline);
  if (!selectedPipeline) {
    throw new Error("The Paint pipeline with Pixel Selection clipping is not registered.");
  }
  const buffer = historySnapshot?.gpuSlice.buffer ?? engine.selectionRenderer?.maskBuffer;
  if (!buffer) {
    throw new Error("A Pixel Selection mask is active, but its renderer is not resident.");
  }
  const offset = historySnapshot?.gpuSlice.offsetBytes ?? 0;
  let bindGroup: GPUBindGroup;
  if (historySnapshot) {
    const cached = engine.selectionHistoryClipBindGroups.get(historySnapshot.gpuSlice.id);
    bindGroup = cached ?? engine.device.createBindGroup({
      label: `Paint clip · history mask rev ${historySnapshot.revision}`,
      layout: engine.selectionMaskBindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer, offset, size: SELECTION_MASK_BYTES },
      }],
    });
    if (!cached) {
      engine.selectionHistoryClipBindGroups.set(historySnapshot.gpuSlice.id, bindGroup);
    }
  } else {
    const cached = engine.selectionLiveClipBindGroup;
    if (
      cached
      && cached.revision === engine.pixelSelectionState.revision
      && cached.buffer === buffer
    ) {
      bindGroup = cached.bindGroup;
    } else {
      bindGroup = engine.device.createBindGroup({
        label: `Paint clip · live mask rev ${engine.pixelSelectionState.revision}`,
        layout: engine.selectionMaskBindGroupLayout,
        entries: [{
          binding: 0,
          resource: { buffer, offset, size: SELECTION_MASK_BYTES },
        }],
      });
      engine.selectionLiveClipBindGroup = {
        revision: engine.pixelSelectionState.revision,
        buffer,
        bindGroup,
      };
    }
  }
  pass.setPipeline(selectedPipeline);
  pass.setBindGroup(1, bindGroup);
}

export function capturePaintSelectionHistoryMask(
  engine: BrushEngine,
  actionId: number,
): SelectionHistoryMaskSnapshot | null {
  const existing = engine.selectionHistoryMasksByAction.get(actionId);
  if (existing) return existing;
  if (engine.pixelSelectionState.selectedPixels === 0) return null;
  const revision = engine.pixelSelectionState.revision;
  const revisionSnapshot = engine.selectionHistoryMasksByRevision.get(revision);
  if (revisionSnapshot) {
    engine.selectionHistoryMasksByAction.set(actionId, revisionSnapshot);
    return revisionSnapshot;
  }
  const snapshot = captureSelectionHistoryMask(
    engine,
    `Paint selection · action ${actionId}`,
  );
  try {
    engine.selectionHistoryMasksByRevision.set(revision, snapshot);
    engine.selectionHistoryMasksByAction.set(actionId, snapshot);
    return snapshot;
  } catch (error) {
    engine.historyGpuStorage.release(snapshot.gpuSlice);
    throw error;
  }
}

export function captureSelectionHistoryMask(
  engine: BrushEngine,
  label: string,
  allowEmpty = false,
): SelectionHistoryMaskSnapshot {
  const renderer = engine.selectionRenderer;
  if (!renderer || (!allowEmpty && engine.pixelSelectionState.selectedPixels === 0)) {
    throw new Error("An empty or non-resident Pixel Selection cannot be archived.");
  }
  const slice = engine.historyGpuStorage.allocate(
    SELECTION_MASK_BYTES,
    label,
    engine.device.limits.minStorageBufferOffsetAlignment,
  );
  try {
    const encoder = engine.device.createCommandEncoder({ label: `Archivia ${label}` });
    encoder.copyBufferToBuffer(
      renderer.maskBuffer,
      0,
      slice.buffer,
      slice.offsetBytes,
      SELECTION_MASK_BYTES,
    );
    engine.device.queue.submit([encoder.finish()]);
    const state = engine.pixelSelectionState;
    return {
      revision: state.revision,
      identity: engine.pixelSelectionIdentity,
      gpuSlice: slice,
      selectedPixels: state.selectedPixels,
      activeTiles: state.activeTiles,
      bounds: state.bounds ? { ...state.bounds } : null,
      tileMask: engine.pixelSelectionTileMask.slice(),
    };
  } catch (error) {
    engine.historyGpuStorage.release(slice);
    throw error;
  }
}

export function releasePaintSelectionHistoryMask(
  engine: BrushEngine,
  actionId: number,
): void {
  const snapshot = engine.selectionHistoryMasksByAction.get(actionId);
  if (!snapshot) return;
  engine.selectionHistoryMasksByAction.delete(actionId);
  const stillReferenced = [...engine.selectionHistoryMasksByAction.values()].some(
    (candidate) => candidate === snapshot,
  );
  if (stillReferenced) return;
  engine.selectionHistoryMasksByRevision.delete(snapshot.revision);
  engine.selectionHistoryClipBindGroups.delete(snapshot.gpuSlice.id);
  engine.historyGpuStorage.release(snapshot.gpuSlice);
}

function cancelSelectionRendererRelease(engine: BrushEngine): void {
  if (engine.selectionRendererReleaseTimer === null) return;
  window.clearTimeout(engine.selectionRendererReleaseTimer);
  engine.selectionRendererReleaseTimer = null;
}

function selectionRendererCanRelease(engine: BrushEngine): boolean {
  return !engine.selectionToolSelected
    && !engine.selectionBusy
    && !engine.historyBusy
    && !engine.layerSwitchBusy
    && !engine.activeStroke
    && engine.selectionRendererLoadingPromise === null
    && engine.pixelSelectionState.selectedPixels === 0;
}

export function scheduleSelectionRendererRelease(engine: BrushEngine): void {
  if (
    !engine.initialized
    || !engine.selectionRenderer
    || engine.selectionToolSelected
    || engine.pixelSelectionState.selectedPixels !== 0
    || engine.selectionRendererReleaseTimer !== null
  ) {
    return;
  }
  engine.selectionRendererReleaseTimer = window.setTimeout(() => {
    engine.selectionRendererReleaseTimer = null;
    if (!selectionRendererCanRelease(engine)) {
      scheduleSelectionRendererRelease(engine);
      return;
    }
    void engine.device.queue.onSubmittedWorkDone().then(() => {
      if (!selectionRendererCanRelease(engine)) {
        scheduleSelectionRendererRelease(engine);
        return;
      }
      if (engine.selectionOverlayFrameRequest !== null) {
        cancelAnimationFrame(engine.selectionOverlayFrameRequest);
        engine.selectionOverlayFrameRequest = null;
      }
      engine.selectionRenderer?.destroy();
      engine.selectionRenderer = null;
      engine.publishStats();
    });
  }, SELECTION_RENDERER_IDLE_RELEASE_MS);
}

function reportSelectionPresentationError(stage: string, error: unknown): void {
  console.error(
    `Pixel Selection: ${stage} failed; the authoritative mask remains valid.`,
    error,
  );
}

function presentPixelSelectionOverlay(engine: BrushEngine): void {
  try {
    engine.selectionRenderer?.renderOverlay(
      engine.getVectorTextViewState(),
      engine.pixelSelectionState,
      {
        x: engine.selectionOverlayOffsetX,
        y: engine.selectionOverlayOffsetY,
      },
    );
  } catch (error) {
    if (engine.selectionOverlayCanvas) engine.selectionOverlayCanvas.hidden = true;
    reportSelectionPresentationError("overlay presentation", error);
  }
}

function notifyPixelSelectionChange(
  engine: BrushEngine,
  state: PixelSelectionState,
): void {
  try {
    engine.callbacks.onPixelSelectionChange?.({
      ...state,
      bounds: state.bounds ? { ...state.bounds } : null,
    });
  } catch (error) {
    reportSelectionPresentationError("callback UI", error);
  }
}

export async function ensureSelectionRenderer(
  engine: BrushEngine,
): Promise<SelectionRenderer> {
  cancelSelectionRendererRelease(engine);
  if (engine.selectionRenderer) return engine.selectionRenderer;
  if (!engine.selectionOverlayCanvas) {
    throw new Error("The selection overlay canvas is not configured.");
  }
  if (!engine.selectionRendererLoadingPromise) {
    engine.selectionRendererLoadingPromise = SelectionRenderer.create({
      device: engine.device,
      sourceSamplingView: engine.layerSamplingView,
      overlayCanvas: engine.selectionOverlayCanvas,
    }).then((renderer) => {
      renderer.setSourceSamplingView(engine.layerSamplingView);
      renderer.resizeOverlay(engine.canvas.width, engine.canvas.height);
      engine.selectionRenderer = renderer;
      renderPixelSelectionOverlay(engine);
      return renderer;
    }).finally(() => {
      engine.selectionRendererLoadingPromise = null;
      scheduleSelectionRendererRelease(engine);
    });
  }
  return engine.selectionRendererLoadingPromise;
}

export function selectionNeedsConnectedColorScratch(engine: BrushEngine): boolean {
  return engine.fillToolSelected
    || (engine.selectionToolSelected && engine.selectionMethod === "magic-wand");
}

export async function setSelectionToolSelected(
  engine: BrushEngine,
  selected: boolean,
  requestedMethod: SelectionMethod,
): Promise<boolean> {
  const method = normalizeSelectionMethod(requestedMethod);
  if (engine.selectionBusy) return false;
  if (!selected || engine.selectionMethod !== method) {
    engine.selectionRenderer?.finishColorRangePreview();
  }
  if (selected) cancelSelectionRendererRelease(engine);
  engine.selectionToolSelected = selected;
  engine.selectionMethod = method;
  if (!selected) {
    scheduleFillScratchRelease(engine);
    scheduleSelectionRendererRelease(engine);
    return true;
  }
  if (!engine.initialized) return false;
  engine.callbacks.onStatus?.("Preparing WebGPU Pixel Selection…", "working");
  try {
    await ensureSelectionRenderer(engine);
    if (method === "magic-wand") {
      const fillRenderer = await ensureFillRenderer(engine);
      fillRenderer.setSourceSamplingView(engine.layerSamplingView);
      await fillRenderer.prewarm();
    } else {
      scheduleFillScratchRelease(engine);
    }
    if (!engine.selectionToolSelected || engine.selectionMethod !== method) {
      scheduleFillScratchRelease(engine);
      scheduleSelectionRendererRelease(engine);
      return false;
    }
    const instruction = method === "magic-wand"
      ? "tap a connected region"
      : method === "lasso"
        ? "draw and close the outline"
        : "choose a color and press Select";
    engine.callbacks.onStatus?.(`Pixel Selection is ready: ${instruction}.`, "ok");
    engine.publishStats();
    return true;
  } catch (error) {
    engine.selectionToolSelected = false;
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Pixel Selection is unavailable: ${message}`, "error");
    engine.publishStats();
    scheduleSelectionRendererRelease(engine);
    return false;
  }
}

function selectionOperationAllowed(engine: BrushEngine): boolean {
  return engine.initialized
    && engine.selectionToolSelected
    && !engine.selectionBusy
    && !engine.historyBusy
    && !engine.layerSwitchBusy
    && !engine.activeStroke
    && !engine.activeVectorHistoryEdit;
}

function requireRasterSelectionSource(engine: BrushEngine): boolean {
  if (engine.canPaintSelectedSceneItem()) return true;
  engine.callbacks.onStatus?.(
    "Pixel Selection reads only from the selected raster layer.",
    "working",
  );
  return false;
}

function publishSelectionState(
  engine: BrushEngine,
  summary: Omit<PixelSelectionState, "revision">,
  identity: number | null = null,
): PixelSelectionState {
  const state: PixelSelectionState = {
    selectedPixels: summary.selectedPixels,
    activeTiles: summary.activeTiles,
    bounds: summary.bounds ? { ...summary.bounds } : null,
    revision: engine.pixelSelectionState.revision + 1,
  };
  engine.pixelSelectionState = state;
  engine.selectionOverlayOffsetX = 0;
  engine.selectionOverlayOffsetY = 0;
  engine.pixelSelectionIdentity = identity ?? engine.nextPixelSelectionIdentity++;
  const publishedTileMask = engine.selectionRenderer?.tileMask;
  if (publishedTileMask) engine.pixelSelectionTileMask.set(publishedTileMask);
  try {
    engine.invalidateAdaptivePreview();
  } catch (error) {
    reportSelectionPresentationError("adaptive preview withdrawal", error);
  }
  engine.selectionLiveClipBindGroup = null;
  try {
    renderPixelSelectionOverlay(engine);
  } catch (error) {
    reportSelectionPresentationError("overlay scheduling", error);
  }
  notifyPixelSelectionChange(engine, state);
  try {
    engine.publishStats();
  } catch (error) {
    reportSelectionPresentationError("stats publication", error);
  }
  return state;
}

function selectionStatus(
  state: PixelSelectionState,
  elapsedMs: number,
): string {
  if (state.selectedPixels === 0) {
    return `Empty selection · ${elapsedMs.toFixed(1)} ms.`;
  }
  return `${state.selectedPixels.toLocaleString("en-US")} pixels selected across `
    + `${state.activeTiles} tiles · ${elapsedMs.toFixed(1)} ms.`;
}

function notifySelectionStatusBestEffort(
  engine: BrushEngine,
  message: string,
  kind: "working" | "ok" | "error",
): void {
  try {
    engine.callbacks.onStatus?.(message, kind);
  } catch {
    // An observer must not turn an already committed mask into a failed operation.
  }
}

export async function selectConnectedAtClientPoint(
  engine: BrushEngine,
  clientX: number,
  clientY: number,
  tolerance: number,
  requestedCombineMode: SelectionCombineMode,
): Promise<SelectionOperationResult | null> {
  if (!selectionOperationAllowed(engine) || !requireRasterSelectionSource(engine)) return null;
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
  const combineMode = normalizeSelectionCombineMode(requestedCombineMode);
  const startedAt = performance.now();
  engine.selectionBusy = true;
  engine.callbacks.onStatus?.("WebGPU Magic Wand in progress…", "working");
  try {
    await engine.waitForIdle();
    const selectionRenderer = await ensureSelectionRenderer(engine);
    selectionRenderer.setSourceSamplingView(engine.layerSamplingView);
    const fillRenderer = await ensureFillRenderer(engine);
    fillRenderer.setSourceSamplingView(engine.layerSamplingView);
    const analysis = await fillRenderer.analyze(
      seedX,
      seedY,
      normalizeMagicWandTolerance(tolerance),
      [0, 0, 0, 1],
    );
    const summary = await selectionRenderer.combineExternalMask(
      fillRenderer.getAnalyzedSelectionMaskBuffer(),
      combineMode,
    );
    const state = publishSelectionState(engine, summary);
    const totalMs = performance.now() - startedAt;
    notifySelectionStatusBestEffort(engine, selectionStatus(state, totalMs), "ok");
    return {
      ...state,
      method: "magic-wand",
      combineMode,
      queueCompletionMs: analysis.queueCompletionMs + summary.queueCompletionMs,
      totalMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Magic Wand failed: ${message}`, "error");
    throw error;
  } finally {
    engine.selectionBusy = false;
  }
}

export async function selectPixelsByColor(
  engine: BrushEngine,
  color: string,
  tolerance: number,
  requestedCombineMode: SelectionCombineMode,
  livePreview = false,
): Promise<SelectionOperationResult | null> {
  if (!selectionOperationAllowed(engine) || !requireRasterSelectionSource(engine)) return null;
  const combineMode = normalizeSelectionCombineMode(requestedCombineMode);
  const target = selectionHexToStraightSrgb(color);
  const startedAt = performance.now();
  engine.selectionBusy = true;
  engine.callbacks.onStatus?.("Global color selection in progress…", "working");
  try {
    await engine.waitForIdle();
    const renderer = await ensureSelectionRenderer(engine);
    if (livePreview) renderer.beginColorRangePreview();
    else renderer.finishColorRangePreview();
    renderer.setSourceSamplingView(engine.layerSamplingView);
    const summary = await renderer.selectGlobalColor(
      target,
      normalizeSelectionTolerance(tolerance),
      combineMode,
    );
    const state = publishSelectionState(engine, summary);
    const totalMs = performance.now() - startedAt;
    notifySelectionStatusBestEffort(engine, selectionStatus(state, totalMs), "ok");
    return {
      ...state,
      method: "color-range",
      combineMode,
      queueCompletionMs: summary.queueCompletionMs,
      totalMs,
    };
  } catch (error) {
    if (livePreview) engine.selectionRenderer?.finishColorRangePreview();
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Color selection failed: ${message}`, "error");
    throw error;
  } finally {
    engine.selectionBusy = false;
  }
}

export function finishColorRangeSelectionPreview(engine: BrushEngine): void {
  engine.selectionRenderer?.finishColorRangePreview();
}

export async function selectPixelsByClientLasso(
  engine: BrushEngine,
  clientPoints: readonly SelectionPoint[],
  requestedCombineMode: SelectionCombineMode,
): Promise<SelectionOperationResult | null> {
  if (!selectionOperationAllowed(engine) || !requireRasterSelectionSource(engine)) return null;
  const combineMode = normalizeSelectionCombineMode(requestedCombineMode);
  const startedAt = performance.now();
  engine.selectionBusy = true;
  engine.callbacks.onStatus?.("Rasterizing the lasso…", "working");
  try {
    await engine.waitForIdle();
    const layerPoints = clientPoints.map((point) => clientToLayer(engine, point.x, point.y));
    const raster = buildLassoSpans(
      layerPoints,
      engine.documentWidth,
      engine.documentHeight,
    );
    if (raster.pointCount < 3) {
      engine.callbacks.onStatus?.("Lasso canceled: at least three points are required.", "working");
      return null;
    }
    const renderer = await ensureSelectionRenderer(engine);
    renderer.setSourceSamplingView(engine.layerSamplingView);
    const summary = await renderer.selectLasso(raster, combineMode);
    const state = publishSelectionState(engine, summary);
    const totalMs = performance.now() - startedAt;
    notifySelectionStatusBestEffort(engine, selectionStatus(state, totalMs), "ok");
    return {
      ...state,
      method: "lasso",
      combineMode,
      queueCompletionMs: summary.queueCompletionMs,
      totalMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Lasso failed: ${message}`, "error");
    throw error;
  } finally {
    engine.selectionBusy = false;
  }
}

export async function invertPixelSelection(engine: BrushEngine): Promise<boolean> {
  if (
    !selectionOperationAllowed(engine)
    || engine.pixelSelectionState.selectedPixels === 0
  ) return false;
  const startedAt = performance.now();
  engine.selectionBusy = true;
  engine.callbacks.onStatus?.("Inverting Pixel Selection…", "working");
  try {
    await engine.waitForIdle();
    const renderer = await ensureSelectionRenderer(engine);
    const summary = await renderer.invertSelection();
    const state = publishSelectionState(engine, summary);
    const totalMs = performance.now() - startedAt;
    notifySelectionStatusBestEffort(
      engine,
      `Selection inverted · ${selectionStatus(state, totalMs)}`,
      "ok",
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Selection inversion failed: ${message}`, "error");
    throw error;
  } finally {
    engine.selectionBusy = false;
  }
}

export async function clearPixelSelection(engine: BrushEngine): Promise<boolean> {
  if (
    !engine.initialized
    || engine.selectionBusy
    || engine.historyBusy
    || engine.layerSwitchBusy
    || engine.activeStroke
    || engine.activeVectorHistoryEdit
  ) return false;
  if (engine.pixelSelectionState.selectedPixels === 0 && !engine.selectionRenderer) return true;
  engine.selectionBusy = true;
  try {
    await engine.waitForIdle();
    const renderer = await ensureSelectionRenderer(engine);
    renderer.clearSelection();
    resetPixelSelectionState(engine);
    notifySelectionStatusBestEffort(engine, "Pixel Selection cleared.", "ok");
    engine.publishStats();
    return true;
  } finally {
    engine.selectionBusy = false;
    scheduleSelectionRendererRelease(engine);
  }
}

export function resetPixelSelectionState(engine: BrushEngine): void {
  const state = emptyPixelSelectionState(engine.pixelSelectionState.revision + 1);
  engine.pixelSelectionState = state;
  engine.selectionOverlayOffsetX = 0;
  engine.selectionOverlayOffsetY = 0;
  engine.pixelSelectionIdentity = engine.nextPixelSelectionIdentity++;
  engine.pixelSelectionTileMask.fill(0);
  engine.selectionLiveClipBindGroup = null;
  try {
    engine.invalidateAdaptivePreview();
    renderPixelSelectionOverlay(engine);
  } catch (error) {
    reportSelectionPresentationError("presentation withdrawal after deselection", error);
  }
  notifyPixelSelectionChange(engine, state);
  try {
    scheduleSelectionRendererRelease(engine);
  } catch (error) {
    reportSelectionPresentationError("renderer release", error);
  }
}

export function renderPixelSelectionOverlay(engine: BrushEngine): void {
  if (engine.selectionOverlaySuppressed) {
    if (engine.selectionOverlayCanvas) engine.selectionOverlayCanvas.hidden = true;
    return;
  }
  if (!engine.selectionRenderer || engine.selectionOverlayFrameRequest !== null) return;
  engine.selectionOverlayFrameRequest = requestAnimationFrame(() => {
    engine.selectionOverlayFrameRequest = null;
    presentPixelSelectionOverlay(engine);
  });
}

export async function translatePixelSelection(
  engine: BrushEngine,
  deltaX: number,
  deltaY: number,
): Promise<PixelSelectionState> {
  const renderer = await ensureSelectionRenderer(engine);
  const summary = await renderer.translateSelection(Math.round(deltaX), Math.round(deltaY));
  engine.selectionOverlayOffsetX = 0;
  engine.selectionOverlayOffsetY = 0;
  return publishSelectionState(engine, summary);
}

export async function restorePixelSelectionHistoryMask(
  engine: BrushEngine,
  snapshot: SelectionHistoryMaskSnapshot,
): Promise<PixelSelectionState> {
  const renderer = await ensureSelectionRenderer(engine);
  const summary = await renderer.restoreMaskSnapshot(
    snapshot.gpuSlice.buffer,
    snapshot.gpuSlice.offsetBytes,
    snapshot,
    snapshot.tileMask,
  );
  engine.selectionOverlayOffsetX = 0;
  engine.selectionOverlayOffsetY = 0;
  return publishSelectionState(engine, summary, snapshot.identity);
}
