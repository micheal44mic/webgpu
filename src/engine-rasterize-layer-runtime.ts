import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  destroyTransientLayerHydration,
} from "./engine-cold-storage";
import {
  commitHistoryActionAtomically,
  rebuildActiveLayerFromHistory,
} from "./engine-history-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import {
  invalidateActiveLayerBake,
  materializeLayerCompositeSource,
  restoreEffectsWorkbenchToActiveLayer,
} from "./engine-layer-runtime";
import { publishMixedScene } from "./engine-vector-text-runtime";
import type { DirtyRect } from "./engine-stroke-types";
import {
  RASTERIZE_LAYER_EFFECTS_STRATEGY,
  applyRasterLayerEffects,
  copyRasterLayerEffects,
  defaultRasterLayerEffects,
  rasterLayerEffectsAreConfigured,
  rasterLayerEffectsNeedBake,
} from "./raster-layer-effects";
import { cloneRasterLayerSource } from "./raster-layer-source";
import { analyzeRasterTextureOccupancy } from "./raster-occupancy-analysis";

export interface RasterizeActiveRasterLayerResult {
  readonly layerId: number;
  readonly name: string;
  readonly bakedEffects: boolean;
  readonly detachedSource: boolean;
  readonly preservedBlendMode: true;
  readonly preservedOpacity: true;
  readonly bounds: DirtyRect | null;
}

function setAuthoritativeMetadata(
  engine: BrushEngine,
  bounds: DirtyRect | null,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  const hasContent = bounds !== null && tileMask.some((word) => word !== 0);
  engine.layerContentBounds = hasContent ? { ...bounds } : null;
  engine.layerHasContent = hasContent;
  record.contentBounds = hasContent ? { ...bounds } : null;
  record.hasContent = hasContent;
  record.storageTileMask.fill(0);
  if (hasContent) record.storageTileMask.set(tileMask);
  invalidateActiveLayerBake(engine);
}

/**
 * Commits the active raster's source cache and analytic layer effects to its
 * authoritative pixels. Layer opacity, blend mode, visibility and clipping
 * remain metadata because they depend on the surrounding scene/backdrop.
 */
export async function rasterizeActiveRasterLayer(
  engine: BrushEngine,
): Promise<RasterizeActiveRasterLayerResult | null> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  engine.assertDestructiveRasterEditCanOpen("rasterize");
  engine.assertLayerSwitchAllowed();
  const selected = engine.mixedSceneStack?.selected;
  const record = engine.layerStack.active;
  if (!selected || selected.kind !== "raster" || selected.rasterLayerId !== record.id) {
    throw new Error("Seleziona un livello raster prima di rasterizzarlo.");
  }
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("Il livello raster selezionato è vuoto.");
  }

  const effectsBefore = copyRasterLayerEffects(record);
  const effectsAfter = defaultRasterLayerEffects();
  const effectsConfigured = rasterLayerEffectsAreConfigured(effectsBefore);
  const bakedEffects = rasterLayerEffectsNeedBake(effectsBefore);
  const detachedSource = record.rasterSource !== null;
  if (!effectsConfigured && !detachedSource) return null;

  const originalBounds = { ...record.contentBounds };
  const originalTileMask = record.storageTileMask.slice();
  const originalRasterSource = cloneRasterLayerSource(record.rasterSource);
  const actionId = engine.nextHistoryActionId;
  const gpu = engine.requireLayerGpu(record.id);
  const hot = gpu.hot;
  if (!hot) throw new Error("Texture hot del livello da rasterizzare mancante.");

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let materialized: Awaited<ReturnType<typeof materializeLayerCompositeSource>> | null = null;
  let beforeSeed: Awaited<ReturnType<typeof createLayerColdStorageCandidate>> | null = null;
  let seed: Awaited<ReturnType<typeof createLayerColdStorageCandidate>> | null = null;
  let pixelsWereReplaced = false;
  let journalPublished = false;
  let resultBounds: DirtyRect | null = originalBounds;
  let resultTileMask = originalTileMask.slice();
  try {
    await engine.waitForIdle();
    // Rasterize owns both sides of its transition. This seed is also the first
    // baseline after loading a project, whose journal intentionally starts empty.
    beforeSeed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      originalTileMask,
      actionId,
      "history",
    );
    if (bakedEffects) {
      materialized = await materializeLayerCompositeSource(
        engine,
        record,
        "structural-history",
      );
      const copyBounds = { ...materialized.nonTransparentBounds };
      const occupancy = await analyzeRasterTextureOccupancy(
        engine,
        materialized.texture,
        copyBounds,
        `Rasterize layer ${record.id}`,
      );
      resultBounds = occupancy.bounds ? { ...occupancy.bounds } : null;
      resultTileMask = occupancy.tileMask.slice();
      const encoder = engine.device.createCommandEncoder({
        label: `Rasterize layer ${record.id} effects into authoritative pixels`,
      });
      encoder.copyTextureToTexture(
        {
          texture: materialized.texture,
          origin: { x: copyBounds.x, y: copyBounds.y },
        },
        {
          texture: hot.texture,
          origin: { x: copyBounds.x, y: copyBounds.y },
        },
        {
          width: copyBounds.width,
          height: copyBounds.height,
          depthOrArrayLayers: 1,
        },
      );
      engine.device.queue.submit([encoder.finish()]);
      await engine.waitForGpuCapped(`Rasterizzazione effetti livello ${record.id}`, 60_000);
      pixelsWereReplaced = true;
    }

    setAuthoritativeMetadata(engine, resultBounds, resultTileMask);
    if (!bakedEffects) {
      // Source detach and configured-but-inactive effects do not change a byte.
      seed = beforeSeed;
    } else if (record.hasContent) {
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        resultTileMask,
        actionId,
        "history",
      );
    }
    applyRasterLayerEffects(record, effectsAfter);
    await restoreEffectsWorkbenchToActiveLayer(
      engine,
      "structural-history",
      true,
      "content-bounds",
    );

    const action: RasterFilterHistoryAction = {
      id: actionId,
      kind: "raster-filter",
      layerId: record.id,
      filter: "rasterize-layer",
      effectsBefore,
      effectsAfter,
      beforeSeed,
      beforeBounds: { ...originalBounds },
      beforeTileMask: originalTileMask.slice(),
      strategy: RASTERIZE_LAYER_EFFECTS_STRATEGY,
      preservesLayerOpacity: true,
      preservesBlendMode: true,
      preservesClipping: true,
      seed,
      baseBounds: resultBounds ? { ...resultBounds } : null,
      baseTileMask: resultTileMask.slice(),
    };
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
    engine.sweepRasterImageGpuResources();

    if (gpu.bake) engine.destroyLayerBake(gpu.bake);
    gpu.bake = null;
    gpu.bakeValid = false;
    engine.paintDisplayMipValidThroughLevel = 0;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.publishStatus(
      `${record.name} rasterizzato: effetti incorporati nei pixel; blend mode e opacità preservati.`,
      "ok",
    );
    return {
      layerId: record.id,
      name: record.name,
      bakedEffects,
      detachedSource,
      preservedBlendMode: true,
      preservedOpacity: true,
      bounds: resultBounds ? { ...resultBounds } : null,
    };
  } catch (error) {
    let rollbackError: unknown = null;
    if (!journalPublished) {
      try {
        record.rasterSource = cloneRasterLayerSource(originalRasterSource);
        applyRasterLayerEffects(record, effectsBefore);
        if (pixelsWereReplaced) {
          if (!beforeSeed) {
            throw new Error("Checkpoint pre-Rasterize mancante durante il rollback.");
          }
          await rebuildActiveLayerFromHistory(engine, {
            layerId: record.id,
            seed: beforeSeed,
            baseBounds: originalBounds,
            baseTileMask: originalTileMask,
          });
        } else {
          setAuthoritativeMetadata(engine, originalBounds, originalTileMask);
        }
        await restoreEffectsWorkbenchToActiveLayer(
          engine,
          "structural-history",
          true,
          "content-bounds",
        );
      } catch (caught) {
        rollbackError = caught;
        engine.latchDocumentStateInconsistent(
          "Rasterizzazione livello fallita e ripristino incompleto: ricarica la pagina.",
        );
      }
      destroyLayerColdStorage(seed);
      if (beforeSeed !== seed) destroyLayerColdStorage(beforeSeed);
    }
    if (rollbackError) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Rasterizzazione livello fallita: ${operationMessage}; ripristino fallito: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    engine.destroyLayerBake(materialized?.transientBake);
    destroyTransientLayerHydration(engine, materialized?.transientHydration ?? null);
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleEffectsScratchShrink();
    engine.scheduleBevelFieldShrink();
    engine.scheduleLayerColdCompression();
  }
}
