import type {
  BrushEngine,
} from "./brush-engine";
import {
  effectsRetargetCallerForHistoryReplay,
  type LayerGpuResources,
  type LayerTextureResources,
} from "./engine-layer-resources";
import {
  coldStorageMaskForRecord,
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  destroyLayerHot,
} from "./engine-cold-storage";
import {
  publishMixedScene,
} from "./engine-vector-text-resources-runtime";
import {
  ensureMixedSceneLinearTexture,
  prewarmMixedSceneLinearTextureForLayerBlend,
} from "./engine-vector-text-segmented-runtime";
import {
  type LayerRecord,
} from "./layer-stack";
import {
  isLayerBlendMode,
  type LayerBlendMode,
} from "./layer-blend-modes";
import {
  ensureLayerBlendTilePresentationResources,
  releaseLayerBlendTilePresentationResources,
} from "./engine-layer-blend-tile-runtime";

import { requireLayerHot } from "./engine-layer-residency-runtime";

function assertMixedSceneClippingMergeIsAdjacent(
  engine: BrushEngine,
  index: number,
): void {
  const scene = engine.mixedSceneStack;
  if (!scene) {
    return;
  }
  const record = engine.layerStack.at(index);
  if (record.clippingParentId !== null) {
    return;
  }
  if (index === 0) {
    throw new Error(
      "Per creare una maschera serve un livello raster immediatamente sotto.",
    );
  }
  const lowerUnit = engine.layerStack.clippingUnit(engine.layerStack.at(index - 1));
  const upperUnit = engine.layerStack.clippingUnit(record);
  const lowerIndices = lowerUnit.map((member) =>
    scene.indexOfKey(`raster:${member.id}` as const));
  const upperIndices = upperUnit.map((member) =>
    scene.indexOfKey(`raster:${member.id}` as const));
  const isConsecutive = (indices: readonly number[]) =>
    indices.every((candidate, offset) => (
      candidate >= 0 && candidate === indices[0] + offset
    ));
  if (
    !isConsecutive(lowerIndices)
    || !isConsecutive(upperIndices)
    || upperIndices[0] !== lowerIndices[lowerIndices.length - 1] + 1
  ) {
    throw new Error(
      "La maschera richiede un raster immediatamente sotto: sposta prima eventuali "
      + "livelli vettoriali che separano i due gruppi.",
    );
  }
}

/**
 * Changes only clipping structure; authoritative pixels, tile masks and layer
 * residency remain untouched. The two merged sides and the active prefix /
 * suffix are rebuilt transactionally from those authoritative resources.
 */
export async function setLayerClipping(
  engine: BrushEngine,
  index: number,
  enabled: boolean,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const record = engine.layerStack.at(index);
  const previousEnabled = record.clippingParentId !== null;
  if (previousEnabled === enabled) {
    return false;
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  let changed = false;
  try {
    await engine.waitForIdle();
    if (enabled) {
      assertMixedSceneClippingMergeIsAdjacent(engine, index);
    }
    engine.persistActiveLayerState();
    changed = engine.layerStack.setClippingEnabled(index, enabled);
    await engine.rebuildMergedLayerSurfaces();
    engine.paintDisplayMipValidThroughLevel = 0;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    return changed;
  } catch (error) {
    if (changed) {
      try {
        engine.layerStack.setClippingEnabled(index, previousEnabled);
        await engine.rebuildMergedLayerSurfaces("layer-switch");
        engine.paintDisplayMipValidThroughLevel = 0;
        engine.presentationCacheNeedsFullRebuild = true;
        engine.displayDirty = true;
        engine.requestRender();
      } catch (restoreError) {
        engine.latchDocumentStateInconsistent(
          "Stato incoerente dopo il cambio maschera: ricarica prima di continuare.",
        );
        const originalMessage = error instanceof Error ? error.message : String(error);
        const restoreMessage = restoreError instanceof Error
          ? restoreError.message
          : String(restoreError);
        throw new Error(
          `Maschera non aggiornata (${originalMessage}) e ripristino fallito `
          + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
        );
      }
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
    publishMixedScene(engine);
  }
}

export async function setLayerPresentation(engine: BrushEngine,
  index: number,
  visible: boolean | undefined,
  opacity: number | undefined,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const record = engine.layerStack.at(index);
  const nextVisible = visible ?? record.visible;
  const nextOpacity = opacity ?? record.opacity;
  if (nextVisible === record.visible && nextOpacity === record.opacity) {
    return false;
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const previousVisible = record.visible;
  const previousOpacity = record.opacity;
  try {
    await engine.waitForIdle();
    record.visible = nextVisible;
    record.opacity = nextOpacity;
    // In final-stack mode the active opacity/visibility is baked into mip 1;
    // inactive-layer changes rebuild the merged view below. Both cases must
    // invalidate the shared display pyramid before the next presentation.
    engine.paintDisplayMipValidThroughLevel = 0;
    if (
      index !== engine.layerStack.activeIndex
      || engine.layerStack.clippingDependents(record.id).length > 0
    ) {
      await engine.rebuildMergedLayerSurfaces();
    }
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.publishStats();
    return true;
  } catch (error) {
    record.visible = previousVisible;
    record.opacity = previousOpacity;
    try {
      // The old merged textures were deliberately evicted before allocation.
      // Rebuild the reverted presentation from authoritative raw storage; the
      // injected fault queue was cleared by the failed attempt.
      await engine.rebuildMergedLayerSurfaces("layer-switch");
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo il compositing: ricarica prima di continuare.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Compositing non riuscito (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
      );
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
  }
}

/**
 * Publishes one non-destructive raster blend-mode change transactionally.
 *
 * The mode is CPU metadata; every derived merged surface is rebuilt by the
 * WebGPU compositor before the new value becomes visible. Undo/Redo sets
 * `historyReplay` because the global history gate is intentionally held while
 * it crosses this action. Pixel history is never replayed for a mode change.
 */
export async function setLayerBlendMode(
  engine: BrushEngine,
  index: number,
  blendMode: LayerBlendMode,
  historyReplay = false,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  if (!isLayerBlendMode(blendMode)) {
    throw new RangeError(`Modalità fusione livello non valida: ${String(blendMode)}.`);
  }
  const record = engine.layerStack.at(index);
  if (record.blendMode === blendMode) {
    return false;
  }
  if (historyReplay) {
    if (!engine.historyBusy || engine.layerSwitchBusy || engine.activeStroke) {
      throw new Error("Transazione storica della fusione livello non valida.");
    }
  } else {
    engine.assertLayerSwitchAllowed();
  }
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const previousBlendMode = record.blendMode;
  const rebuildCaller = effectsRetargetCallerForHistoryReplay(historyReplay);
  const hadTileCompositor = engine.layerBlendTileCompositor !== null;
  try {
    await engine.waitForIdle();
    const candidateAdvanced = blendMode !== "normal"
      || engine.layerStack.layers.some(
        (candidate) => candidate.id !== record.id && candidate.blendMode !== "normal",
      );
    const visibleSemantics = Boolean(engine.mixedSceneStack?.visibleSemanticCount);
    const candidateNeedsTile = candidateAdvanced && !visibleSemantics;
    const candidateNeedsViewportBlend = candidateAdvanced && visibleSemantics;
    if (candidateAdvanced) {
      // The screen-linear cache is also the destination of the exact tile
      // path. With semantic nodes, validate its two RGBA16F ping-pong peers as
      // well. No mode/history metadata is visible until every scope succeeds.
      await prewarmMixedSceneLinearTextureForLayerBlend(
        engine,
        Math.max(1, engine.canvas.width),
        Math.max(1, engine.canvas.height),
        candidateNeedsViewportBlend,
      );
    }
    if (candidateNeedsTile) {
      // Allocate and validate the bounded live working set before metadata is
      // published. An OOM therefore leaves both the mode and history untouched.
      await ensureLayerBlendTilePresentationResources(engine);
    }
    record.blendMode = blendMode;
    engine.paintDisplayMipValidThroughLevel = 0;
    await engine.rebuildMergedLayerSurfaces(rebuildCaller);
    if (engine.layerStack.layers.every((candidate) => candidate.blendMode === "normal")) {
      releaseLayerBlendTilePresentationResources(engine);
    }
    ensureMixedSceneLinearTexture(
      engine,
      Math.max(1, engine.canvas.width),
      Math.max(1, engine.canvas.height),
    );
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    return true;
  } catch (error) {
    record.blendMode = previousBlendMode;
    if (
      !hadTileCompositor
      && engine.layerStack.layers.every((candidate) => candidate.blendMode === "normal")
    ) {
      releaseLayerBlendTilePresentationResources(engine);
    }
    try {
      await engine.rebuildMergedLayerSurfaces(rebuildCaller);
      ensureMixedSceneLinearTexture(
        engine,
        Math.max(1, engine.canvas.width),
        Math.max(1, engine.canvas.height),
      );
      engine.paintDisplayMipValidThroughLevel = 0;
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
    } catch (restoreError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      const combined = new Error(
        `Fusione livello non aggiornata (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
      );
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo la fusione livello: ricarica prima di continuare.",
        combined,
      );
      throw combined;
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
    publishMixedScene(engine);
  }
}

export function resolveFillSource(engine: BrushEngine): {
  record: LayerRecord;
  view: GPUTextureView;
} {
  const reference = engine.layerStack.reference;
  const record = reference === null ? engine.layerStack.active : reference;
  // `reference` throws for a stale identity and requireLayerHot throws for a
  // non-resident texture. Neither invariant violation may degrade to sampling
  // the active destination: no fallback is part of the public strategy.
  return {
    record,
    view: requireLayerHot(engine, record.id).samplingView,
  };
}

export function retargetFillRendererSource(engine: BrushEngine): void {
  if (!engine.fillRenderer) {
    return;
  }
  engine.fillRenderer.setSourceSamplingView(resolveFillSource(engine).view);
}

interface ReferenceLayerDemotion {
  readonly record: LayerRecord;
  readonly gpu: LayerGpuResources;
  readonly hot: LayerTextureResources;
  readonly cold: Awaited<ReturnType<typeof createLayerColdStorageCandidate>> | null;
  readonly mask: Uint32Array;
}

async function createReferenceLayerDemotion(
  engine: BrushEngine,
  record: LayerRecord,
): Promise<ReferenceLayerDemotion> {
  const gpu = engine.requireLayerGpu(record.id);
  const hot = requireLayerHot(engine, record.id);
  const mask = coldStorageMaskForRecord(record);
  if (!record.hasContent) {
    return { record, gpu, hot, cold: null, mask };
  }
  const generation = Math.max(
    gpu.cold?.generation ?? 0,
    gpu.compressed?.generation ?? 0,
  ) + 1;
  const cold = await createLayerColdStorageCandidate(
    engine,
    record,
    hot,
    mask,
    generation,
  );
  return { record, gpu, hot, cold, mask };
}

/**
 * Promotes only the active raster layer to Reference. When another reference
 * was kept full-resident, it is packed to authoritative cold tiles before its
 * hot texture is released. Any allocation failure leaves the old reference and
 * both source bindings untouched: there is deliberately no slower fallback.
 */
export async function setLayerReference(
  engine: BrushEngine,
  index: number,
  enabled: boolean,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const requested = engine.layerStack.at(index);
  const previousReference = engine.layerStack.reference;
  if (enabled && previousReference?.id === requested.id) {
    return false;
  }
  if (!enabled && previousReference?.id !== requested.id) {
    return false;
  }
  if (requested.id !== engine.layerStack.active.id) {
    throw new Error("Seleziona il livello raster prima di impostarlo come Riferimento.");
  }

  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  let demotion: ReferenceLayerDemotion | null = null;
  let referenceChanged = false;
  try {
    await engine.waitForIdle();
    if (
      enabled
      && previousReference
      && previousReference.id !== requested.id
    ) {
      demotion = await createReferenceLayerDemotion(engine, previousReference);
    }

    engine.layerStack.setReferenceIndex(enabled ? index : null);
    referenceChanged = true;
    retargetFillRendererSource(engine);

    if (demotion) {
      const supersededCold = demotion.gpu.cold;
      demotion.gpu.cold = demotion.cold;
      demotion.gpu.compressed = null;
      demotion.record.storageTileMask.set(demotion.mask);
      destroyLayerColdStorage(supersededCold);
      destroyLayerHot(demotion.hot);
      demotion.gpu.hot = null;
      // Ownership moved into gpu.cold; the catch path must not destroy it.
      demotion = null;
    }
    referenceChanged = false;
    engine.publishStats();
    return true;
  } catch (error) {
    if (referenceChanged) {
      const previousIndex = previousReference
        ? engine.layerStack.indexOfId(previousReference.id)
        : -1;
      engine.layerStack.setReferenceIndex(previousIndex >= 0 ? previousIndex : null);
      retargetFillRendererSource(engine);
    }
    if (demotion?.cold) {
      destroyLayerColdStorage(demotion.cold);
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
  }
}
