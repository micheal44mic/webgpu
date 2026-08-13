import type { BrushEngine } from "./brush-engine";
import type {
  RasterLayerMetadataHistoryProperty,
  RasterLayerMetadataHistoryState,
} from "./engine-history-types";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import { mergeDirtyRects } from "./engine-geometry";
import { captureRasterLayerMetadataHistoryState } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import { layerEffectRendererRequirements } from "./layer-stack";
import {
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
  copyRasterStrokeStyle,
  normalizeRasterStrokeStyle,
  rasterStrokeScratchExtentForRenderer,
  rasterStrokeScratchExtentForWidth,
  rasterStrokeStylesEqual,
} from "./stroke-core";
import {
  RASTER_COLOR_OVERLAY_EFFECT_ID,
  copyRasterColorOverlayStyle,
  normalizeRasterColorOverlayStyle,
  rasterColorOverlayStylesEqual,
} from "./raster-color-overlay-core";
import {
  classifyRasterBevelStyleChange,
  copyRasterBevelStyle,
  normalizeRasterBevelStyle,
  rasterBevelRadiusBucket,
  rasterBevelStylesEqual,
  rasterBevelVisualBounds,
} from "./bevel-core";
import {
  classifyRasterInnerShadowStyleChange,
  classifyRasterOuterShadowStyleChange,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
  normalizeRasterInnerShadowStyle,
  normalizeRasterOuterShadowStyle,
  rasterInnerShadowStylesEqual,
  rasterInnerShadowVisualBounds,
  rasterOuterShadowStylesEqual,
  rasterOuterShadowUsesSupportedBlend,
  rasterOuterShadowVisualBounds,
} from "./shadow-core";
import {
  ensureRasterBevelRenderer,
  ensureRasterInnerShadowRenderer,
  ensureRasterOuterShadowRenderer,
  ensureRasterStrokeRenderer,
  releaseRasterBevelRenderer,
  releaseRasterInnerShadowRenderer,
  releaseRasterOuterShadowRenderer,
  releaseRasterStrokeRenderer,
} from "./engine-resource-setup";
import {
  flushPendingWorkBeforeSettingsChange,
  rasterStrokeEffectRect,
  setRasterStrokeGeometryEnabled,
} from "./engine-runtime-misc";

export interface RasterStyleHistoryPort {
  readonly allows: (property: RasterLayerMetadataHistoryProperty) => boolean;
  readonly record: (
    property: RasterLayerMetadataHistoryProperty,
    before: RasterLayerMetadataHistoryState,
  ) => void;
}

export async function applyRasterColorOverlayStyle(engine: BrushEngine, style: unknown, history: RasterStyleHistoryPort): Promise<boolean> {
    const normalized = normalizeRasterColorOverlayStyle(style);
    const normalizedActive = normalized.enabled && normalized.opacity > 0;
    if (engine.initialized && !history.allows("color-overlay")) {
      return false;
    }
    if (engine.initialized && engine.layerSwitchBusy) {
      return false;
    }
    if (
      rasterColorOverlayStylesEqual(normalized, engine.rasterColorOverlayStyle)
      && (!normalizedActive || Boolean(engine.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!engine.initialized) {
      engine.rasterColorOverlayStyle = normalized;
      return true;
    }
    if (
      engine.activeStroke
      || engine.historyBusy
      || engine.layerSwitchBusy
      || engine.rasterStrokeBusy
      || engine.rasterBevelBusy
      || engine.rasterOuterShadowBusy
      || engine.rasterInnerShadowBusy
    ) {
      return false;
    }

    flushPendingWorkBeforeSettingsChange(engine);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      engine,
      engine.layerStack.active.id,
      "color-overlay",
    );
    const previous = copyRasterColorOverlayStyle(engine.rasterColorOverlayStyle);
    const previousActive = previous.enabled && previous.opacity > 0;
    const previousDisplayUsesStyle = Boolean(
      engine.rasterStrokeRenderer && engine.styleStackNeedsCompositor(),
    );
    const nextStackNeedsCompositor = layerEffectRendererRequirements(
      engine.rasterStrokeStyle,
      engine.rasterBevelStyle,
      engine.rasterOuterShadowStyle,
      engine.rasterInnerShadowStyle,
      normalized,
    ).needsStrokeRenderer;
    const rendererNeedsCreation = normalizedActive && !engine.rasterStrokeRenderer;
    const rendererWillBeReleased = Boolean(
      engine.rasterStrokeRenderer && !nextStackNeedsCompositor,
    );
    const styleDirtyRect = previousActive || normalizedActive
      ? engine.layerContentBounds
        ?? (engine.layerHasContent
          ? { x: 0, y: 0, width: DOCUMENT_WIDTH, height: DOCUMENT_HEIGHT }
          : null)
      : null;
    engine.rasterStrokeBusy = true;
    try {
      // Destroying a renderer must wait for every older submission. Hot color
      // and opacity edits only enqueue new uniform data after older queue work,
      // so they do not pay a queue-idle round trip.
      if (rendererWillBeReleased) {
        await engine.waitForIdle();
      }
      if (normalizedActive) {
        if (rendererNeedsCreation) {
          engine.callbacks.onStatus?.(
            "Preparo la Sovrapposizione colore WebGPU…",
            "working",
          );
        }
        await ensureRasterStrokeRenderer(
          engine,
          engine.rasterStrokeStyle.width,
          engine.rasterStrokeStyle.enabled && engine.rasterStrokeStyle.width > 0,
        );
        engine.requireEffectsWorkbench().scratchPool.declareEffect(
          RASTER_COLOR_OVERLAY_EFFECT_ID,
          [],
        );
      }

      engine.rasterColorOverlayStyle = normalized;
      invalidateActiveLayerBake(engine);
      engine.rasterStrokePendingComposeRect = mergeDirtyRects(
        engine.rasterStrokePendingComposeRect,
        styleDirtyRect,
      );

      if (!normalizedActive) {
        engine.requireEffectsWorkbench().scratchPool.releaseRequirement(
          RASTER_COLOR_OVERLAY_EFFECT_ID,
        );
        if (rendererWillBeReleased) {
          releaseRasterStrokeRenderer(engine);
        }
      }

      engine.paintDisplayMipValidThroughLevel = 0;
      const nextDisplayUsesStyle = Boolean(
        engine.rasterStrokeRenderer && engine.styleStackNeedsCompositor(),
      );
      if (previousDisplayUsesStyle !== nextDisplayUsesStyle) {
        engine.presentationCacheNeedsFullRebuild = true;
      }
      engine.displayDirty = true;
      engine.requestRender();
      engine.callbacks.onStatus?.(
        normalizedActive
          ? "Sovrapposizione colore WebGPU attiva."
          : normalized.enabled
            ? "Sovrapposizione colore attiva ma invisibile: opacità 0%."
            : "Sovrapposizione colore disattivata.",
        "ok",
      );
      engine.publishStats();
      history.record("color-overlay", historyBefore);
      return true;
    } catch (error) {
      engine.rasterColorOverlayStyle = previous;
      try {
        if (previousActive) {
          await ensureRasterStrokeRenderer(
            engine,
            engine.rasterStrokeStyle.width,
            engine.rasterStrokeStyle.enabled && engine.rasterStrokeStyle.width > 0,
          );
          engine.requireEffectsWorkbench().scratchPool.declareEffect(
            RASTER_COLOR_OVERLAY_EFFECT_ID,
            [],
          );
        } else {
          engine.requireEffectsWorkbench().scratchPool.releaseRequirement(
            RASTER_COLOR_OVERLAY_EFFECT_ID,
          );
          if (!engine.styleStackNeedsCompositor()) {
            releaseRasterStrokeRenderer(engine);
          }
        }
      } catch (restoreError) {
        console.error(
          "Ripristino Sovrapposizione colore non riuscito",
          restoreError,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      engine.callbacks.onStatus?.(
        `Sovrapposizione colore WebGPU non disponibile: ${message}`,
        "error",
      );
      throw error;
    } finally {
      engine.rasterStrokeBusy = false;
    }
  }

export async function applyRasterStrokeStyle(engine: BrushEngine, style: unknown, history: RasterStyleHistoryPort): Promise<boolean> {
    const normalized = normalizeRasterStrokeStyle(style);
    const normalizedActive = normalized.enabled && normalized.width > 0;
    if (engine.initialized && !history.allows("stroke")) {
      return false;
    }
    if (engine.initialized && engine.layerSwitchBusy) {
      return false;
    }
    if (
      rasterStrokeStylesEqual(normalized, engine.rasterStrokeStyle)
      && (normalizedActive
        ? engine.rasterStrokeRenderer?.strokeGeometryEnabled === true
        : engine.rasterStrokeRenderer?.strokeGeometryEnabled !== true)
    ) {
      return true;
    }
    if (!engine.initialized) {
      engine.rasterStrokeStyle = normalized;
      return true;
    }
    if (
      engine.activeStroke
      || engine.historyBusy
      || engine.layerSwitchBusy
      || engine.rasterStrokeBusy
      || engine.rasterBevelBusy
      || engine.rasterOuterShadowBusy
      || engine.rasterInnerShadowBusy
    ) {
      return false;
    }

    flushPendingWorkBeforeSettingsChange(engine);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      engine,
      engine.layerStack.active.id,
      "stroke",
    );
    const previous = copyRasterStrokeStyle(engine.rasterStrokeStyle);
    const previousActive = previous.enabled && previous.width > 0;
    const nextActive = normalized.enabled && normalized.width > 0;
    engine.rasterStrokeBusy = true;
    try {
      if (nextActive) {
        const scratchExtent = rasterStrokeScratchExtentForWidth(normalized.width);
        const rendererNeedsCreation = !engine.rasterStrokeRenderer;
        const geometryNeedsAllocation =
          !engine.rasterStrokeRenderer?.strokeGeometryEnabled;
        const scratchNeedsResize = Boolean(
          engine.rasterStrokeRenderer
          && engine.rasterStrokeRenderer.scratchExtent !== scratchExtent,
        );
        if (rendererNeedsCreation || geometryNeedsAllocation || scratchNeedsResize) {
          engine.callbacks.onStatus?.(
            rendererNeedsCreation || geometryNeedsAllocation
              ? "Preparo la geometria della Traccia WebGPU…"
              : "Adatto la memoria scratch della Traccia…",
            "working",
          );
          await engine.waitForIdle();
          const renderer = await ensureRasterStrokeRenderer(engine, normalized.width, true);
          if (renderer.scratchExtent !== scratchExtent) {
            renderer.resizeScratch(scratchExtent);
          }
        }
      }

      engine.rasterStrokeStyle = normalized;
      invalidateActiveLayerBake(engine);
      if (nextActive) {
        const coverageStyleChanged = normalized.width !== previous.width
          || normalized.position !== previous.position;
        if (!previousActive || coverageStyleChanged) {
          engine.rasterStrokeCoverageValid = false;
        }
        engine.rasterStrokePendingComposeRect = rasterStrokeEffectRect(engine,
          engine.layerContentBounds,
          Math.max(previous.width, normalized.width),
        );
        engine.presentationCacheNeedsFullRebuild = true;
        engine.displayDirty = true;
        engine.requestRender();
        engine.callbacks.onStatus?.("Traccia WebGPU attiva.", "ok");
      } else {
        await engine.waitForIdle();
        if (engine.styleStackNeedsCompositor()) {
          await setRasterStrokeGeometryEnabled(engine, false);
          engine.rasterStrokePendingComposeRect = rasterStrokeEffectRect(engine,
            engine.layerContentBounds,
            previous.width,
          );
          if (
            engine.rasterStrokeRenderer
            && engine.rasterStrokeRenderer.scratchExtent
              !== RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT
          ) {
            engine.rasterStrokeRenderer.resizeScratch(
              RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
            );
            engine.scheduleEffectsScratchShrink();
          }
        } else {
          releaseRasterStrokeRenderer(engine);
        }
        engine.paintDisplayMipValidThroughLevel = 0;
        engine.presentationCacheNeedsFullRebuild = true;
        engine.displayDirty = true;
        engine.requestRender();
        if (previousActive) {
          engine.callbacks.onStatus?.(
            engine.styleStackNeedsCompositor()
              ? "Traccia disattivata; il compositore condiviso resta per gli altri effetti."
              : "Traccia disattivata; memoria GPU liberata.",
            "ok",
          );
        }
      }
      engine.publishStats();
      history.record("stroke", historyBefore);
      return true;
    } catch (error) {
      engine.rasterStrokeStyle = previous;
      try {
        if (previousActive && !engine.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(engine, previous.width, true);
        }
        if (engine.rasterStrokeRenderer) {
          await setRasterStrokeGeometryEnabled(engine, previousActive);
          const previousScratchExtent = rasterStrokeScratchExtentForRenderer(
            previousActive,
            previous.width,
          );
          if (engine.rasterStrokeRenderer.scratchExtent !== previousScratchExtent) {
            engine.rasterStrokeRenderer.resizeScratch(previousScratchExtent);
          }
        }
      } catch (restoreError) {
        console.error("Ripristino risorse Traccia non riuscito", restoreError);
      }
      if (!previousActive && !engine.styleStackNeedsCompositor()) {
        releaseRasterStrokeRenderer(engine);
      }
      const message = error instanceof Error ? error.message : String(error);
      engine.callbacks.onStatus?.(`Traccia WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      engine.rasterStrokeBusy = false;
    }
  }

export async function applyRasterBevelStyle(engine: BrushEngine, style: unknown, history: RasterStyleHistoryPort): Promise<boolean> {
    const normalized = normalizeRasterBevelStyle(style);
    if (engine.initialized && !history.allows("bevel")) {
      return false;
    }
    if (engine.initialized && engine.layerSwitchBusy) {
      return false;
    }
    const change = classifyRasterBevelStyleChange(
      engine.rasterBevelStyle,
      normalized,
      engine.rasterBevelHeightValid ? rasterBevelRadiusBucket(engine.rasterBevelStyle) : 0,
    );
    if (
      rasterBevelStylesEqual(normalized, engine.rasterBevelStyle)
      && (!normalized.enabled || (engine.rasterBevelRenderer && engine.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!engine.initialized) {
      engine.rasterBevelStyle = normalized;
      return true;
    }
    if (
      engine.activeStroke
      || engine.historyBusy
      || engine.layerSwitchBusy
      || engine.rasterStrokeBusy
      || engine.rasterBevelBusy
      || engine.rasterOuterShadowBusy
      || engine.rasterInnerShadowBusy
    ) {
      return false;
    }

    flushPendingWorkBeforeSettingsChange(engine);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      engine,
      engine.layerStack.active.id,
      "bevel",
    );
    const previous = copyRasterBevelStyle(engine.rasterBevelStyle);
    const previousActive = previous.enabled;
    const previousRect = rasterBevelVisualBounds(
      engine.layerContentBounds,
      previous,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    engine.rasterBevelBusy = true;
    try {
      await engine.waitForIdle();
      engine.rasterBevelStyle = normalized;
      invalidateActiveLayerBake(engine);
      if (normalized.enabled) {
        if (!engine.rasterBevelRenderer) {
          engine.callbacks.onStatus?.("Preparo lo Smusso/Rilievo Heightfield V2…", "working");
          await ensureRasterBevelRenderer(engine);
        }
        if (!engine.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(engine);
        }
        engine.rasterBevelRenderer!.updateStyleResources(normalized);
        engine.rasterStrokeRenderer!.setBevelResources(
          engine.rasterBevelRenderer!.heightView,
          engine.rasterBevelRenderer!.glossView,
        );
        engine.rasterStrokeRenderer!.updateBevelFieldParameters(
          engine.rasterBevelRenderer!.fieldState,
        );
        engine.rasterStrokeRenderer!.updateBevelParameters(normalized);
        engine.rebuildRasterStrokeDisplayBindGroups();
        if (!previousActive || change.geometryRebuild) {
          engine.rasterBevelHeightValid = false;
          engine.rasterBevelHeightSourceMode = null;
        }
        const nextRect = rasterBevelVisualBounds(
          engine.layerContentBounds,
          normalized,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        engine.rasterBevelPendingComposeRect = mergeDirtyRects(
          previousRect,
          nextRect,
        );
        engine.callbacks.onStatus?.("Smusso/Rilievo Heightfield V2 attivo.", "ok");
      } else {
        engine.rasterBevelPendingComposeRect = previousRect;
        releaseRasterBevelRenderer(engine);
        if (!engine.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(engine);
        }
        if (previousActive) {
          engine.callbacks.onStatus?.(
            "Smusso/Rilievo disattivato; memoria Heightfield liberata.",
            "ok",
          );
        }
      }
      engine.paintDisplayMipValidThroughLevel = 0;
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
      engine.publishStats();
      history.record("bevel", historyBefore);
      return true;
    } catch (error) {
      engine.rasterBevelStyle = previous;
      if (!previousActive) {
        releaseRasterBevelRenderer(engine);
        if (!engine.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(engine);
        }
      } else {
        engine.rasterBevelHeightValid = false;
        engine.rasterBevelHeightSourceMode = null;
        engine.rasterBevelRenderer?.updateStyleResources(previous);
        engine.rasterStrokeRenderer?.updateBevelParameters(previous);
      }
      const message = error instanceof Error ? error.message : String(error);
      engine.callbacks.onStatus?.(`Smusso/Rilievo WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      engine.rasterBevelBusy = false;
    }
  }

export async function applyRasterOuterShadowStyle(engine: BrushEngine, style: unknown, history: RasterStyleHistoryPort): Promise<boolean> {
    const normalized = normalizeRasterOuterShadowStyle(style);
    if (engine.initialized && !history.allows("outer-shadow")) {
      return false;
    }
    if (!rasterOuterShadowUsesSupportedBlend(normalized)) {
      throw new Error(
        "L'Ombra esterna Multiply è esatta solo con colore nero; "
        + "usa Normale per un'ombra colorata.",
      );
    }
    if (engine.initialized && engine.layerSwitchBusy) {
      return false;
    }
    const change = classifyRasterOuterShadowStyleChange(
      engine.rasterOuterShadowStyle,
      normalized,
    );
    if (
      rasterOuterShadowStylesEqual(normalized, engine.rasterOuterShadowStyle)
      && (!normalized.enabled || (engine.rasterOuterShadowRenderer && engine.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!engine.initialized) {
      engine.rasterOuterShadowStyle = normalized;
      return true;
    }
    if (
      engine.activeStroke
      || engine.historyBusy
      || engine.layerSwitchBusy
      || engine.rasterStrokeBusy
      || engine.rasterBevelBusy
      || engine.rasterOuterShadowBusy
      || engine.rasterInnerShadowBusy
    ) {
      return false;
    }

    flushPendingWorkBeforeSettingsChange(engine);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      engine,
      engine.layerStack.active.id,
      "outer-shadow",
    );
    const previous = copyRasterOuterShadowStyle(engine.rasterOuterShadowStyle);
    const previousRect = rasterOuterShadowVisualBounds(
      engine.layerContentBounds,
      previous,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    engine.rasterOuterShadowBusy = true;
    try {
      await engine.waitForIdle();
      engine.rasterOuterShadowStyle = normalized;
      invalidateActiveLayerBake(engine);
      if (normalized.enabled) {
        if (!engine.rasterOuterShadowRenderer) {
          engine.callbacks.onStatus?.("Preparo l'Ombra esterna WebGPU…", "working");
          await ensureRasterOuterShadowRenderer(engine);
        }
        if (!engine.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(engine);
        }
        engine.rasterOuterShadowRenderer!.updateStyle(normalized);
        engine.rasterStrokeRenderer!.setShadowResources(
          "outer",
          engine.rasterOuterShadowRenderer!.coverageBuffer,
          engine.rasterOuterShadowRenderer!.compositionUniformBuffer,
        );
        if (change.matteChanged) {
          engine.rasterOuterShadowMatteValid = false;
          engine.rasterOuterShadowSourceMode = null;
        }
        const nextRect = rasterOuterShadowVisualBounds(
          engine.layerContentBounds,
          normalized,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        engine.rasterOuterShadowPendingComposeRect = mergeDirtyRects(
          previousRect,
          nextRect,
        );
        engine.callbacks.onStatus?.("Ombra esterna WebGPU attiva.", "ok");
      } else {
        engine.rasterOuterShadowPendingComposeRect = previousRect;
        releaseRasterOuterShadowRenderer(engine);
        if (!engine.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(engine);
        }
        engine.callbacks.onStatus?.(
          "Ombra esterna disattivata; matte R16F liberata.",
          "ok",
        );
      }
      engine.paintDisplayMipValidThroughLevel = 0;
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
      engine.publishStats();
      history.record("outer-shadow", historyBefore);
      return true;
    } catch (error) {
      engine.rasterOuterShadowStyle = previous;
      if (!previous.enabled) {
        releaseRasterOuterShadowRenderer(engine);
        if (!engine.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(engine);
        }
      } else {
        engine.rasterOuterShadowMatteValid = false;
        engine.rasterOuterShadowSourceMode = null;
        engine.rasterOuterShadowRenderer?.updateStyle(previous);
      }
      const message = error instanceof Error ? error.message : String(error);
      engine.callbacks.onStatus?.(`Ombra esterna WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      engine.rasterOuterShadowBusy = false;
    }
  }

export async function applyRasterInnerShadowStyle(engine: BrushEngine, style: unknown, history: RasterStyleHistoryPort): Promise<boolean> {
    const normalized = normalizeRasterInnerShadowStyle(style);
    if (engine.initialized && !history.allows("inner-shadow")) {
      return false;
    }
    if (engine.initialized && engine.layerSwitchBusy) {
      return false;
    }
    const change = classifyRasterInnerShadowStyleChange(
      engine.rasterInnerShadowStyle,
      normalized,
    );
    if (
      rasterInnerShadowStylesEqual(normalized, engine.rasterInnerShadowStyle)
      && (!normalized.enabled || (engine.rasterInnerShadowRenderer && engine.rasterStrokeRenderer))
    ) {
      return true;
    }
    if (!engine.initialized) {
      engine.rasterInnerShadowStyle = normalized;
      return true;
    }
    if (
      engine.activeStroke
      || engine.historyBusy
      || engine.layerSwitchBusy
      || engine.rasterStrokeBusy
      || engine.rasterBevelBusy
      || engine.rasterOuterShadowBusy
      || engine.rasterInnerShadowBusy
    ) {
      return false;
    }

    flushPendingWorkBeforeSettingsChange(engine);
    const historyBefore = captureRasterLayerMetadataHistoryState(
      engine,
      engine.layerStack.active.id,
      "inner-shadow",
    );
    const previous = copyRasterInnerShadowStyle(engine.rasterInnerShadowStyle);
    const previousRect = rasterInnerShadowVisualBounds(
      engine.layerContentBounds,
      previous,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    engine.rasterInnerShadowBusy = true;
    try {
      await engine.waitForIdle();
      engine.rasterInnerShadowStyle = normalized;
      invalidateActiveLayerBake(engine);
      if (normalized.enabled) {
        if (!engine.rasterInnerShadowRenderer) {
          engine.callbacks.onStatus?.("Preparo l'Ombra interna WebGPU…", "working");
          await ensureRasterInnerShadowRenderer(engine);
        }
        if (!engine.rasterStrokeRenderer) {
          await ensureRasterStrokeRenderer(engine);
        }
        engine.rasterInnerShadowRenderer!.updateStyle(normalized);
        engine.rasterStrokeRenderer!.setShadowResources(
          "inner",
          engine.rasterInnerShadowRenderer!.coverageBuffer,
          engine.rasterInnerShadowRenderer!.compositionUniformBuffer,
        );
        if (change.matteChanged) {
          engine.rasterInnerShadowMatteValid = false;
          engine.rasterInnerShadowSourceMode = null;
        }
        const nextRect = rasterInnerShadowVisualBounds(
          engine.layerContentBounds,
          normalized,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        engine.rasterInnerShadowPendingComposeRect = mergeDirtyRects(
          previousRect,
          nextRect,
        );
        engine.callbacks.onStatus?.("Ombra interna WebGPU attiva.", "ok");
      } else {
        engine.rasterInnerShadowPendingComposeRect = previousRect;
        releaseRasterInnerShadowRenderer(engine);
        if (!engine.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(engine);
        }
        engine.callbacks.onStatus?.(
          "Ombra interna disattivata; matte R16F liberata.",
          "ok",
        );
      }
      engine.paintDisplayMipValidThroughLevel = 0;
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
      engine.publishStats();
      history.record("inner-shadow", historyBefore);
      return true;
    } catch (error) {
      engine.rasterInnerShadowStyle = previous;
      if (!previous.enabled) {
        releaseRasterInnerShadowRenderer(engine);
        if (!engine.styleStackNeedsCompositor()) {
          releaseRasterStrokeRenderer(engine);
        }
      } else {
        engine.rasterInnerShadowMatteValid = false;
        engine.rasterInnerShadowSourceMode = null;
        engine.rasterInnerShadowRenderer?.updateStyle(previous);
      }
      const message = error instanceof Error ? error.message : String(error);
      engine.callbacks.onStatus?.(`Ombra interna WebGPU non disponibile: ${message}`, "error");
      throw error;
    } finally {
      engine.rasterInnerShadowBusy = false;
    }
  }
