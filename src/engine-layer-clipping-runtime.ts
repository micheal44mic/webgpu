import type {
  BrushEngine,
} from "./brush-engine";
import {
  runGpuAllocationTransaction,
} from "./gpu-allocation-transaction";
import {
  type ActiveClippingGroupResources,
  type ActiveClippingSuffixStepResources,
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
  createMixedSceneRasterSegmentResources,
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
  normalizeLayerRect,
} from "./engine-geometry";
import {
  alignedMergedSurfaceBounds,
  intersectMergedSurfaceRects,
  unionMergedSurfaceRects,
} from "./merged-surface-bounds";
import {
  type MixedSceneRasterRunKey,
} from "./mixed-scene-stack";

import {
  authoritativeColdTileCompositeSource,
  foldAuthoritativeColdTilesIntoMergedSurface,
  foldViewIntoMergedSurface,
  releaseLayerBlendFoldScratch,
  tryFoldAuthoritativeColdTilesIntoMergedSurface,
} from "./engine-layer-fold-runtime";
import {
  allocateMergedSurface,
  encodeMergedSurfacePyramid,
  layerCompositeVisualBounds,
  materializeLayerCompositeSource,
  requiredMergedSurfaceMipLevel,
} from "./engine-layer-surface-runtime";

function recordHasLiveContent(engine: BrushEngine, record: LayerRecord): boolean {
  return record.id === engine.layerStack.active.id
    ? engine.layerHasContent
    : record.hasContent;
}

function recordRawBounds(engine: BrushEngine, record: LayerRecord): DirtyRect | null {
  return normalizeLayerRect(
    record.id === engine.layerStack.active.id
      ? engine.layerContentBounds
      : record.contentBounds,
  );
}

async function finalizeClippingAuxiliarySurface(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  maintainMips: boolean,
  label: string,
): Promise<MergedSurfaceResources> {
  releaseLayerBlendFoldScratch(surface);
  if (!maintainMips) {
    return surface;
  }
  const targetMip = requiredMergedSurfaceMipLevel(engine, surface);
  if (targetMip <= 0) {
    return surface;
  }
  const encoder = engine.device.createCommandEncoder({ label: `${label} mip` });
  encodeMergedSurfacePyramid(engine, encoder, surface, targetMip);
  engine.device.queue.submit([encoder.finish()]);
  await engine.waitForGpuCapped(`${label} mip`);
  return surface;
}

async function buildClippingOverlaySurface(
  engine: BrushEngine,
  records: readonly LayerRecord[],
  caller: EffectsRetargetCaller,
  requestedBounds: DirtyRect | null,
  maintainMips: boolean,
  label: string,
): Promise<MergedSurfaceResources | null> {
  const visible = records.filter(
    (record) => record.visible
      && record.opacity > 0
      && recordHasLiveContent(engine, record),
  );
  if (visible.length === 0) {
    return null;
  }
  const visualBounds = unionMergedSurfaceRects(
    visible.map((record) => layerCompositeVisualBounds(engine, record)),
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  const bounded = requestedBounds
    ? visualBounds && intersectMergedSurfaceRects(
      visualBounds,
      requestedBounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    )
    : visualBounds;
  if (!bounded) {
    return null;
  }
  const surface = allocateMergedSurface(
    engine,
    engine.layerFormat,
    "above",
    visible.length,
    alignedMergedSurfaceBounds(bounded, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT),
    1,
  );
  let first = true;
  try {
    for (const record of visible) {
      const directTileFold = await tryFoldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        record,
        record.opacity,
        "normal",
        "source-over",
        first,
        `${label} · layer ${record.id} direct cold tiles`,
      );
      if (directTileFold !== null) {
        first = first && !directTileFold;
        continue;
      }
      const source = await materializeLayerCompositeSource(engine, record, caller);
      try {
        const rect = intersectMergedSurfaceRects(
          source.nonTransparentBounds,
          surface.bounds,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        if (!rect) {
          continue;
        }
        await foldViewIntoMergedSurface(
          engine,
          surface,
          source.view,
          { x: 0, y: 0 },
          1,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
          record.opacity,
          rect,
          "normal",
          "source-over",
          first,
          `${label} · layer ${record.id} source-over`,
        );
        surface.analyticBakePixels += source.analyticBakePixels;
        first = false;
      } finally {
        engine.destroyLayerBake(source.transientBake);
        destroyTransientLayerHydration(engine, source.transientHydration);
      }
    }
    if (first) {
      engine.destroyMergedSurface(surface);
      return null;
    }
    return await finalizeClippingAuxiliarySurface(
      engine,
      surface,
      maintainMips,
      label,
    );
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  }
}

type ActiveClippingSuffixBuild = {
  suffix: MergedSurfaceResources | null;
  suffixSteps: ActiveClippingSuffixStepResources[];
};

/**
 * Materialize one clipping child without baking its layer opacity. The live
 * document-tile compositor owns both opacity and blend mode, so it can apply
 * every source-atop operation against the result of the preceding child.
 * These operands are mip-0-only: they are never presented directly and are
 * sampled at document resolution exclusively by the exact tile path.
 */
async function buildClippingSuffixStepSurface(
  engine: BrushEngine,
  record: LayerRecord,
  caller: EffectsRetargetCaller,
  requestedBounds: DirtyRect,
  label: string,
): Promise<MergedSurfaceResources | null> {
  const directSource = authoritativeColdTileCompositeSource(engine, record, "normal");
  const source = directSource
    ? null
    : await materializeLayerCompositeSource(engine, record, caller);
  let surface: MergedSurfaceResources | null = null;
  try {
    const bounded = intersectMergedSurfaceRects(
      directSource?.nonTransparentBounds ?? source!.nonTransparentBounds,
      requestedBounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    if (!bounded) {
      return null;
    }
    surface = await runGpuAllocationTransaction(
      engine.device,
      `${label} · allocazione mip0`,
      (transaction) => {
        const candidate = allocateMergedSurface(
          engine,
          engine.layerFormat,
          "above",
          1,
          alignedMergedSurfaceBounds(bounded, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT),
          1,
          false,
        );
        transaction.deferRollback(() => engine.destroyMergedSurface(candidate));
        return candidate;
      },
    );
    if (directSource) {
      await foldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        directSource,
        1,
        "source-over",
        true,
        bounded,
        `${label} · direct cold tiles`,
      );
    } else {
      await foldViewIntoMergedSurface(
        engine,
        surface,
        source!.view,
        { x: 0, y: 0 },
        1,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
        1,
        bounded,
        "normal",
        "source-over",
        true,
        label,
      );
      surface.analyticBakePixels += source!.analyticBakePixels;
    }
    return await finalizeClippingAuxiliarySurface(engine, surface, false, label);
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  } finally {
    engine.destroyLayerBake(source?.transientBake);
    destroyTransientLayerHydration(engine, source?.transientHydration);
  }
}

async function buildActiveClippingSuffixResources(
  engine: BrushEngine,
  records: readonly LayerRecord[],
  caller: EffectsRetargetCaller,
  aggregateRequestedBounds: DirtyRect | null,
  stepRequestedBounds: DirtyRect | null,
  label: string,
): Promise<ActiveClippingSuffixBuild> {
  const visible = records.filter(
    (record) => record.visible
      && record.opacity > 0
      && recordHasLiveContent(engine, record),
  );
  if (visible.length === 0) {
    return { suffix: null, suffixSteps: [] };
  }

  // Keep the pre-existing single-surface path byte-for-byte for the common
  // all-Normal case. Per-child operands exist only when stack order needs an
  // advanced backdrop-dependent operation.
  if (visible.every((record) => record.blendMode === "normal")) {
    const suffix = await buildClippingOverlaySurface(
      engine,
      records,
      caller,
      aggregateRequestedBounds,
      true,
      label,
    );
    return { suffix, suffixSteps: [] };
  }

  // No clipped child can contribute without a parent matte. Avoid allocating
  // operand textures for an empty active parent.
  if (!stepRequestedBounds) {
    return { suffix: null, suffixSteps: [] };
  }

  const suffixSteps: ActiveClippingSuffixStepResources[] = [];
  try {
    for (const record of visible) {
      const surface = await buildClippingSuffixStepSurface(
        engine,
        record,
        caller,
        stepRequestedBounds,
        `${label} · operand child ${record.id}`,
      );
      if (!surface) {
        continue;
      }
      try {
        suffixSteps.push({
          layerId: record.id,
          blendMode: record.blendMode,
          opacity: record.opacity,
          surface,
          viewportSegment: createMixedSceneRasterSegmentResources(
            engine,
            `raster-run:${record.id}@clipping-step` as MixedSceneRasterRunKey,
            surface,
            record.opacity,
          ),
        });
      } catch (error) {
        engine.destroyMergedSurface(surface);
        throw error;
      }
    }
    return { suffix: null, suffixSteps };
  } catch (error) {
    suffixSteps.forEach((step) => {
      step.viewportSegment.uniformBuffer.destroy();
      engine.destroyMergedSurface(step.surface);
    });
    throw error;
  }
}

export async function buildClippingPrefixSurface(
  engine: BrushEngine,
  parent: LayerRecord,
  children: readonly LayerRecord[],
  caller: EffectsRetargetCaller,
  maintainMips: boolean,
  label: string,
): Promise<MergedSurfaceResources | null> {
  if (!recordHasLiveContent(engine, parent)) {
    return null;
  }
  const directParentSource = authoritativeColdTileCompositeSource(engine, parent, "normal");
  const parentSource = directParentSource
    ? null
    : await materializeLayerCompositeSource(engine, parent, caller);
  const parentBounds = normalizeLayerRect(
    directParentSource?.nonTransparentBounds ?? parentSource!.nonTransparentBounds,
  );
  if (!parentBounds) {
    engine.destroyLayerBake(parentSource?.transientBake);
    destroyTransientLayerHydration(engine, parentSource?.transientHydration);
    return null;
  }
  let surface: MergedSurfaceResources | null = null;
  try {
    surface = allocateMergedSurface(
      engine,
      engine.layerFormat,
      "below",
      1 + children.length,
      alignedMergedSurfaceBounds(parentBounds, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT),
      1,
      maintainMips,
    );
    if (directParentSource) {
      await foldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        directParentSource,
        1,
        "source-over",
        true,
        parentBounds,
        `${label} · parent ${parent.id} direct cold tiles`,
      );
    } else {
      await foldViewIntoMergedSurface(
        engine,
        surface,
        parentSource!.view,
        { x: 0, y: 0 },
        1,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
        1,
        parentBounds,
        "normal",
        "source-over",
        true,
        `${label} · styled parent ${parent.id}`,
      );
      surface.analyticBakePixels += parentSource!.analyticBakePixels;
    }

    for (const child of children) {
      if (!child.visible || child.opacity <= 0 || !recordHasLiveContent(engine, child)) {
        continue;
      }
      const directTileFold = await tryFoldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        child,
        child.opacity,
        child.blendMode,
        "source-atop",
        false,
        `${label} · child ${child.id} direct cold tiles`,
      );
      if (directTileFold !== null) {
        continue;
      }
      const source = await materializeLayerCompositeSource(engine, child, caller);
      try {
        const rect = intersectMergedSurfaceRects(
          source.nonTransparentBounds,
          surface.bounds,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        if (!rect) {
          continue;
        }
        await foldViewIntoMergedSurface(
          engine,
          surface,
          source.view,
          { x: 0, y: 0 },
          1,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
          child.opacity,
          rect,
          child.blendMode,
          "source-atop",
          false,
          `${label} · child ${child.id} source-atop`,
        );
        surface.analyticBakePixels += source.analyticBakePixels;
      } finally {
        engine.destroyLayerBake(source.transientBake);
        destroyTransientLayerHydration(engine, source.transientHydration);
      }
    }
    return await finalizeClippingAuxiliarySurface(
      engine,
      surface,
      maintainMips,
      label,
    );
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  } finally {
    engine.destroyLayerBake(parentSource?.transientBake);
    destroyTransientLayerHydration(engine, parentSource?.transientHydration);
  }
}

export async function buildActiveClippingGroupResources(
  engine: BrushEngine,
  caller: EffectsRetargetCaller,
): Promise<ActiveClippingGroupResources | null> {
  const unit = engine.layerStack.clippingUnit(engine.layerStack.active.id);
  if (unit.length <= 1) {
    return null;
  }
  const parent = unit[0];
  const activeIndex = unit.findIndex((record) => record.id === engine.layerStack.active.id);
  if (activeIndex < 0) {
    throw new Error("Raster attivo assente dalla propria unità di ritaglio.");
  }
  const parentOpacity = parent.visible ? Math.min(1, Math.max(0, parent.opacity)) : 0;
  const parentBounds = recordRawBounds(engine, parent);
  if (activeIndex === 0) {
    const { suffix, suffixSteps } = await buildActiveClippingSuffixResources(
      engine,
      unit.slice(1),
      caller,
      null,
      parentBounds,
      `Gruppo ritaglio live parent ${parent.id}`,
    );
    return {
      parentId: parent.id,
      activeLayerId: parent.id,
      mode: "active-parent",
      parentOpacity,
      prefix: null,
      suffix,
      suffixSteps,
    };
  }

  const prefix = await buildClippingPrefixSurface(
    engine,
    parent,
    unit.slice(1, activeIndex),
    caller,
    true,
    `Gruppo ritaglio live prefix ${parent.id}→${engine.layerStack.active.id}`,
  );
  try {
    const { suffix, suffixSteps } = await buildActiveClippingSuffixResources(
      engine,
      unit.slice(activeIndex + 1),
      caller,
      parentBounds,
      parentBounds,
      `Gruppo ritaglio live suffix ${engine.layerStack.active.id}`,
    );
    return {
      parentId: parent.id,
      activeLayerId: engine.layerStack.active.id,
      mode: "active-child",
      parentOpacity,
      prefix,
      suffix,
      suffixSteps,
    };
  } catch (error) {
    engine.destroyMergedSurface(prefix);
    throw error;
  }
}

export function destroyActiveClippingGroupResources(
  engine: BrushEngine,
  group: ActiveClippingGroupResources | null | undefined,
): void {
  if (!group) {
    return;
  }
  engine.destroyMergedSurface(group.prefix);
  engine.destroyMergedSurface(group.suffix);
  group.suffixSteps.forEach((step) => {
    step.viewportSegment.uniformBuffer.destroy();
    engine.destroyMergedSurface(step.surface);
  });
}

export async function foldClippingGroupIntoMergedSurface(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  unit: readonly LayerRecord[],
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  first: boolean,
  externalBlendMode: LayerBlendMode = unit[0].blendMode,
): Promise<boolean> {
  const parent = unit[0];
  if (!parent.visible || parent.opacity <= 0) {
    return false;
  }
  const group = await buildClippingPrefixSurface(
    engine,
    parent,
    unit.slice(1),
    caller,
    false,
    `Fold gruppo ritaglio ${parent.id}`,
  );
  if (!group) {
    return false;
  }
  try {
    const rect = intersectMergedSurfaceRects(
      group.bounds,
      surface.bounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    if (!rect) {
      return false;
    }
    await foldViewIntoMergedSurface(
      engine,
      surface,
      group.samplingView,
      group.bounds,
      group.resolutionScale,
      group.textureWidth,
      group.textureHeight,
      parent.opacity,
      rect,
      externalBlendMode,
      "source-over",
      first,
      `Fold gruppo ritaglio ${parent.id} into merged ${side}`,
    );
    surface.analyticBakePixels += group.analyticBakePixels;
    return true;
  } finally {
    engine.destroyMergedSurface(group);
  }
}
