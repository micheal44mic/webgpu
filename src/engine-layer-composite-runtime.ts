import type {
  BrushEngine,
} from "./brush-engine";
import {
  runGpuAllocationTransaction,
} from "./gpu-allocation-transaction";
import {
  type EffectsRetargetCaller,
  type MergedSurfaceResources,
} from "./engine-layer-resources";
import {
  destroyTransientLayerHydration,
} from "./engine-cold-storage";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "./engine-limits";
import {
  mixedSceneItemIsVisible,
} from "./engine-vector-text-resources-runtime";
import {
  type DirtyRect,
} from "./engine-stroke-types";
import {
  type LayerRecord,
} from "./layer-stack";
import {
  type LayerBlendMode,
} from "./layer-blend-modes";
import {
  MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
  MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
  alignedMergedSurfaceBounds,
  intersectMergedSurfaceRects,
  mergedSurfaceMipLevelCount,
  unionMergedSurfaceRects,
  type MergedSurfaceRect,
} from "./merged-surface-bounds";
import {
  type MixedSceneCompositionSegment,
  type MixedSceneItem,
} from "./mixed-scene-stack";
import {
  type VectorTextViewState,
} from "./vector-text-types";

import {
  foldViewIntoMergedSurface,
  releaseLayerBlendFoldScratch,
  tryFoldAuthoritativeColdTilesIntoMergedSurface,
} from "./engine-layer-fold-runtime";
import { foldClippingGroupIntoMergedSurface } from "./engine-layer-clipping-runtime";
import {
  allocateMergedSurface,
  encodeMergedSurfacePyramid,
  layerCompositeVisualBounds,
  materializeLayerCompositeSource,
  requiredMergedSurfaceMipLevel,
} from "./engine-layer-surface-runtime";

export async function foldRasterRecordIntoMergedSurface(engine: BrushEngine,
  surface: MergedSurfaceResources,
  record: LayerRecord,
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  first: boolean,
  externalBlendMode: LayerBlendMode = record.blendMode,
): Promise<boolean> {
  if (record.clippingParentId !== null) {
    throw new Error(`Il child ${record.id} deve essere foldato con il proprio gruppo.`);
  }
  const directTileFold = await tryFoldAuthoritativeColdTilesIntoMergedSurface(
    engine,
    surface,
    record,
    record.opacity,
    externalBlendMode,
    "source-over",
    first,
    `Fold tile cold livello ${record.id} into merged ${side}`,
  );
  if (directTileFold !== null) {
    return directTileFold;
  }
  const source = await materializeLayerCompositeSource(engine, record, caller);
  const sourceRect = intersectMergedSurfaceRects(
    source.nonTransparentBounds,
    surface.bounds,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!sourceRect) {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
    return false;
  }
  surface.analyticBakePixels += source.analyticBakePixels;
  try {
    await foldViewIntoMergedSurface(
      engine,
      surface,
      source.view,
      { x: 0, y: 0 },
      1,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
      record.opacity,
      sourceRect,
      externalBlendMode,
      "source-over",
      first,
      `Fold livello ${record.id} into merged ${side}`,
    );
    return true;
  } finally {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
  }
}

export async function buildMixedMergedSurfaceCandidate(engine: BrushEngine,
  items: readonly MixedSceneItem[],
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  view: VectorTextViewState,
): Promise<MergedSurfaceResources | null> {
  const rasterItems = items.filter(
    (item): item is Extract<MixedSceneItem, { kind: "raster" }> => item.kind === "raster",
  );
  const boundedItems = rasterItems
    .filter((item) => mixedSceneItemIsVisible(engine, item))
    .map((item) => {
      const record = engine.layerStack.byId(item.rasterLayerId);
      if (!record) {
        throw new Error(`Raster ${item.rasterLayerId} assente durante il calcolo bounds.`);
      }
      return { item, bounds: layerCompositeVisualBounds(engine, record) };
    })
    .filter((entry): entry is {
      item: Extract<MixedSceneItem, { kind: "raster" }>;
      bounds: DirtyRect;
    } => entry.bounds !== null);
  if (boundedItems.length === 0) {
    return null;
  }

  const contentBounds = unionMergedSurfaceRects(
    boundedItems.map((entry) => entry.bounds as MergedSurfaceRect),
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!contentBounds) {
    return null;
  }
  const allocation = {
    bounds: alignedMergedSurfaceBounds(
      contentBounds,
      DOCUMENT_WIDTH,
      64,
      64,
      DOCUMENT_HEIGHT,
    ),
    resolutionScale: 1,
  } as const;
  const visibleItems = boundedItems.filter((entry) =>
    intersectMergedSurfaceRects(
      entry.bounds,
      allocation.bounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) !== null
  );
  if (visibleItems.length === 0) {
    return null;
  }

  const requiredInitialMip = Math.min(
    MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
    Math.ceil(Math.max(0, Math.log2(1 / Math.max(view.zoom, 1e-6)))),
  );
  if (mergedSurfaceMipLevelCount(allocation.bounds) <= requiredInitialMip) {
    throw new Error("Superficie merged raster priva dei mip display richiesti.");
  }
  const surface = await runGpuAllocationTransaction(
    engine.device,
    `Merged raster ${side} allocation · ${MIXED_MERGED_SURFACE_STORAGE_STRATEGY}`,
    (transaction) => {
      const allocated = allocateMergedSurface(engine,
        engine.layerFormat,
        side,
        visibleItems.length,
        allocation.bounds,
        allocation.resolutionScale,
      );
      transaction.deferRollback(() => engine.destroyMergedSurface(allocated));
      return allocated;
    },
  );
  try {
    let first = true;
    const foldedGroupMembers = new Set<number>();
    for (const { item } of visibleItems) {
      const record = engine.layerStack.byId(item.rasterLayerId);
      if (!record) {
        throw new Error(`Raster ${item.rasterLayerId} assente durante il fold.`);
      }
      if (foldedGroupMembers.has(record.id)) {
        continue;
      }
      const unit = engine.layerStack.clippingUnit(record.id);
      const didFold: boolean = unit.length > 1
        ? await foldClippingGroupIntoMergedSurface(
          engine,
          surface,
          unit,
          side,
          caller,
          first,
          "normal",
        )
        : await foldRasterRecordIntoMergedSurface(
          engine,
          surface,
          record,
          side,
          caller,
          first,
          "normal",
        );
      if (unit.length > 1) {
        unit.forEach((member) => foldedGroupMembers.add(member.id));
      }
      first = first && !didFold;
    }
    if (first) {
      engine.destroyMergedSurface(surface);
      return null;
    }
    releaseLayerBlendFoldScratch(surface);
    const initialMipLevel = requiredMergedSurfaceMipLevel(engine, surface);
    if (initialMipLevel > 0) {
      const encoder = engine.device.createCommandEncoder({
        label: `Build merged raster ${side} display pyramid`,
      });
      encodeMergedSurfacePyramid(engine, encoder, surface, initialMipLevel);
      engine.device.queue.submit([encoder.finish()]);
      await engine.waitForGpuCapped(`Piramide merged raster ${side}`);
    }
    return surface;
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  }
}


export function splitMixedSceneRasterRunsForLayerBlend(
  engine: BrushEngine,
  segments: readonly MixedSceneCompositionSegment[],
): readonly MixedSceneCompositionSegment[] {
  const result: MixedSceneCompositionSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "raster-run") {
      result.push(segment);
      continue;
    }

    const itemByLayerId = new Map(
      segment.items.map((item) => [item.rasterLayerId, item] as const),
    );
    const consumed = new Set<number>();
    let normalItems: (MixedSceneItem & { kind: "raster" })[] = [];
    const flushNormal = () => {
      if (normalItems.length === 0) {
        return;
      }
      const items = normalItems;
      normalItems = [];
      result.push({
        key: `raster-run:${items.map((item) => item.rasterLayerId).join(",")}`,
        kind: "raster-run",
        items,
      });
    };

    for (const item of segment.items) {
      if (consumed.has(item.rasterLayerId)) {
        continue;
      }
      const unit = engine.layerStack.clippingUnit(item.rasterLayerId);
      const parent = unit[0];
      const unitItems = unit
        .map((record) => itemByLayerId.get(record.id))
        .filter((candidate): candidate is MixedSceneItem & { kind: "raster" } => (
          candidate !== undefined
        ));
      if (unitItems.length !== unit.length) {
        throw new Error(
          `Unità di ritaglio ${parent.id} spezzata durante il programma fusione livelli.`,
        );
      }
      unit.forEach((record) => consumed.add(record.id));
      if (parent.blendMode === "normal") {
        normalItems.push(...unitItems);
        continue;
      }
      flushNormal();
      result.push({
        key: (
          `raster-run:${unitItems.map((candidate) => candidate.rasterLayerId).join(",")}`
          + `@blend=${parent.blendMode}`
        ) as `raster-run:${string}`,
        kind: "raster-run",
        items: unitItems,
      });
    }
    flushNormal();
  }
  return result;
}

export function mixedSceneSegmentLayerBlendMode(
  engine: BrushEngine,
  segment: MixedSceneCompositionSegment,
): LayerBlendMode {
  if (segment.kind === "raster-run") {
    const first = segment.items[0];
    if (!first) {
      return "normal";
    }
    return engine.layerStack.clippingUnit(first.rasterLayerId)[0].blendMode;
  }
  if (segment.kind === "active-raster") {
    return engine.layerStack.clippingUnit(segment.item.rasterLayerId)[0].blendMode;
  }
  return "normal";
}

export function orderedLayerBlendPresentationRequired(engine: BrushEngine): boolean {
  return engine.layerStack.layers.some((record) => record.blendMode !== "normal");
}


export async function buildMergedSurfaceCandidate(engine: BrushEngine,
  records: readonly LayerRecord[],
  side: "below" | "above",
  caller: EffectsRetargetCaller,
): Promise<MergedSurfaceResources | null> {
  const visibleRecords = records.filter(
    (record) => record.visible && record.opacity > 0 && record.hasContent,
  );
  if (visibleRecords.length === 0) {
    return null;
  }
  const contentBounds = unionMergedSurfaceRects(
    visibleRecords.map(
      (record) => layerCompositeVisualBounds(engine, record) as MergedSurfaceRect,
    ),
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!contentBounds) {
    return null;
  }
  const allocationBounds = alignedMergedSurfaceBounds(
    contentBounds,
    DOCUMENT_WIDTH,
    64,
    64,
    DOCUMENT_HEIGHT,
  );

  return runGpuAllocationTransaction(
    engine.device,
    `Merged ${side} surface transaction`,
    async (transaction) => {
      const surface = allocateMergedSurface(engine,
        engine.layerFormat,
        side,
        visibleRecords.length,
        allocationBounds,
      );
      transaction.deferRollback(() => engine.destroyMergedSurface(surface));

      let first = true;
      const foldedGroupMembers = new Set<number>();
      for (const record of visibleRecords) {
        if (foldedGroupMembers.has(record.id)) {
          continue;
        }
        const unit = engine.layerStack.clippingUnit(record.id);
        const didFold: boolean = unit.length > 1
          ? await foldClippingGroupIntoMergedSurface(
            engine,
            surface,
            unit,
            side,
            caller,
            first,
          )
          : await foldRasterRecordIntoMergedSurface(
            engine,
            surface,
            record,
            side,
            caller,
            first,
          );
        if (unit.length > 1) {
          unit.forEach((member) => foldedGroupMembers.add(member.id));
        }
        first = first && !didFold;
      }

      if (first) {
        engine.destroyMergedSurface(surface);
        return null;
      }
      releaseLayerBlendFoldScratch(surface);

      if (engine.paintDisplaySelectedMipLevel > 0) {
        const encoder = engine.device.createCommandEncoder({
          label: `Build merged ${side} display pyramid`,
        });
        encodeMergedSurfacePyramid(engine,
          encoder,
          surface,
          engine.paintDisplaySelectedMipLevel,
        );
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped(`Piramide merged ${side}`);
      }
      return surface;
    },
  );
}
