import type {
  BrushEngine,
} from "./brush-engine";
import {
  type EffectsWorkbenchRetargetResult,
  type LayerFormat,
} from "./engine-types";
import {
  type EffectsRetargetCaller,
  type LayerEffectsRebuildDomain,
  type LayerGpuCompletionPolicy,
} from "./engine-layer-resources";
import {
  EFFECTS_WORKING_SET_STRATEGY,
} from "./effects-workbench";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "./engine-limits";
import {
  type DirtyRect,
} from "./engine-stroke-types";
import {
  type LayerRecord,
} from "./layer-stack";
import {
  normalizeLayerRect,
} from "./engine-geometry";
import {
  encodeRasterStrokeDisplayPyramid,
} from "./engine-runtime-misc";

export async function retargetEffectsWorkingSetInternal(engine: BrushEngine,
  layerView: GPUTextureView,
  layerFormat: LayerFormat,
  contentBounds: DirtyRect | null | undefined,
  caller: EffectsRetargetCaller,
  styles: Pick<
    LayerRecord,
    | "strokeStyle"
    | "bevelStyle"
    | "outerShadowStyle"
    | "innerShadowStyle"
    | "colorOverlayStyle"
  > | null = null,
  publish = true,
  maintainDisplayPyramid = true,
  completionPolicy: LayerGpuCompletionPolicy = "await-immediately",
  rebuildDomain: LayerEffectsRebuildDomain = "full-document",
): Promise<EffectsWorkbenchRetargetResult> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  // Each caller's exemption is spelled out rather than hidden behind booleans.
  // A layer switch legitimately runs while layerSwitchBusy is its own flag;
  // cross-layer replay and structural vector history legitimately run while
  // historyBusy is high because each is the current history transaction, so
  // neither can go through the public method.
  const duringLayerSwitch = caller !== "public";
  const duringHistoryTransaction =
    caller === "history-replay" || caller === "structural-history";
  if (
    engine.activeStroke
    || (!duringHistoryTransaction && engine.historyBusy)
    || (!duringLayerSwitch && engine.layerSwitchBusy)
    || engine.rasterStrokeBusy
    || engine.rasterBevelBusy
    || engine.rasterOuterShadowBusy
    || engine.rasterInnerShadowBusy
  ) {
    throw new Error("Il banco effetti può cambiare sorgente solo a motore fermo.");
  }
  const workbench = engine.requireEffectsWorkbench();
  if (layerFormat !== engine.layerFormat || layerFormat !== workbench.sourceFormat) {
    throw new Error(
      `Formato banco effetti ${workbench.sourceFormat} incompatibile con ${layerFormat}; `
      + "operazione rifiutata: il documento RGBA16F non ammette fallback di formato.",
    );
  }

  if (completionPolicy === "await-immediately") {
    await engine.waitForIdle({
      allowFrozenDerivedPresentation: caller !== "public",
    });
  }
  const strokeStyle = styles?.strokeStyle ?? engine.rasterStrokeStyle;
  const bevelStyle = styles?.bevelStyle ?? engine.rasterBevelStyle;
  const outerShadowStyle = styles?.outerShadowStyle ?? engine.rasterOuterShadowStyle;
  const innerShadowStyle = styles?.innerShadowStyle ?? engine.rasterInnerShadowStyle;
  const colorOverlayStyle = styles?.colorOverlayStyle
    ?? engine.rasterColorOverlayStyle;
  const fullDocumentRect: DirtyRect = {
    x: 0,
    y: 0,
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  };
  // Omitted preserves the pre-PR3 contract; explicit null means an empty source.
  const normalizedContentBounds = contentBounds === undefined
    ? fullDocumentRect
    : normalizeLayerRect(contentBounds);
  const boundedContentRect = normalizedContentBounds ?? fullDocumentRect;
  const styleStackRetargetBounds = rebuildDomain === "content-bounds"
    ? boundedContentRect
    : fullDocumentRect;
  const bevelRetargetContentBounds = engine.bevelBoundingFieldEnabled
    ? normalizedContentBounds
    : fullDocumentRect;
  engine.rasterStrokeBusy = true;
  engine.rasterBevelBusy = true;
  engine.rasterOuterShadowBusy = true;
  engine.rasterInnerShadowBusy = true;
  const startedAt = performance.now();
  try {
    const generation = workbench.retarget({ view: layerView, format: layerFormat });
    engine.rebuildRasterStrokeDisplayBindGroups();
    engine.rasterStrokeCoverageValid = false;
    engine.rasterStrokeStyledInitialized = false;
    engine.rasterStrokeMipValidThroughLevel = 0;
    engine.rasterStrokePendingComposeRect = null;
    engine.rasterStrokeLastEncode = null;
    engine.rasterBevelHeightValid = false;
    engine.rasterBevelHeightSourceMode = null;
    engine.rasterBevelPendingComposeRect = null;
    engine.rasterBevelLastEncode = null;
    engine.rasterOuterShadowMatteValid = false;
    engine.rasterOuterShadowSourceMode = null;
    engine.rasterOuterShadowPendingComposeRect = null;
    engine.rasterOuterShadowLastEncode = null;
    engine.rasterInnerShadowMatteValid = false;
    engine.rasterInnerShadowSourceMode = null;
    engine.rasterInnerShadowPendingComposeRect = null;
    engine.rasterInnerShadowLastEncode = null;

    const encoder = engine.device.createCommandEncoder({
      label: engine.bevelBoundingFieldEnabled
        ? `Banco effetti retarget #${generation}: rebuild campo bbox`
        : `Banco effetti retarget #${generation}: rebuild documento completo`,
    });
    // Public/active retargets preserve the full-document rebuild contract.
    // Fold-only materialization may use the conservative visual-domain input:
    // every buffer is still document-addressed, only dispatched work is bounded.
    const update = engine.encodeRasterStyleStackUpdate(
      encoder,
      "permanent",
      styleStackRetargetBounds,
      styleStackRetargetBounds,
      true,
      bevelRetargetContentBounds,
      engine.bevelBoundingFieldEnabled,
      strokeStyle,
      bevelStyle,
      outerShadowStyle,
      innerShadowStyle,
      normalizedContentBounds,
      colorOverlayStyle,
    );
    if (maintainDisplayPyramid) {
      encodeRasterStrokeDisplayPyramid(engine,
        encoder,
        update.dirtyRect,
        engine.paintDisplaySelectedMipLevel,
      );
    }
    engine.device.queue.submit([encoder.finish()]);
    const submittedAt = performance.now();
    if (completionPolicy === "await-immediately") {
      await engine.waitForGpuCapped(`Retarget banco effetti #${generation}`);
    }
    const completedAt = performance.now();
    const result: EffectsWorkbenchRetargetResult = {
      strategy: EFFECTS_WORKING_SET_STRATEGY,
      generation,
      layerFormat,
      contentBounds: normalizedContentBounds ? { ...normalizedContentBounds } : null,
      contentPixels: normalizedContentBounds
        ? normalizedContentBounds.width * normalizedContentBounds.height
        : 0,
      fullDocumentPixels: DOCUMENT_WIDTH * DOCUMENT_HEIGHT,
      cpuRetargetAndEncodeMs: submittedAt - startedAt,
      queueCompletionMs: completedAt - submittedAt,
      totalMs: completedAt - startedAt,
      stroke: update.timing,
      bevel: engine.rasterBevelLastEncode,
      outerShadow: engine.rasterOuterShadowLastEncode,
      innerShadow: engine.rasterInnerShadowLastEncode,
    };
    if (publish) {
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
      engine.publishStats();
    }
    if (import.meta.env.DEV && completionPolicy === "await-immediately") {
      console.info(
        engine.bevelBoundingFieldEnabled
          ? "[EffectsWorkbench] retarget con campo Smusso bbox completato"
          : `[EffectsWorkbench] retarget ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT} completato`,
        result,
      );
    }
    return result;
  } finally {
    engine.rasterStrokeBusy = false;
    engine.rasterBevelBusy = false;
    engine.rasterOuterShadowBusy = false;
    engine.rasterInnerShadowBusy = false;
  }
}
