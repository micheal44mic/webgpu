import type {
  BrushEngine,
} from "./brush-engine";
import {
  type LayerRecord,
} from "./layer-stack";
import {
  effectsScratchCanShrink,
  effectsScratchShrinkIsWorthwhile,
} from "./effects-scratch-pool";
import {
  rasterEffectRendererReachability,
  type RasterEffectRendererReachability,
} from "./effects-resource-lifecycle";
import {
  historyFloorCursor,
} from "./history-maintenance-runtime";
import {
  releaseRasterBevelRenderer,
  releaseRasterInnerShadowRenderer,
  releaseRasterOuterShadowRenderer,
  releaseRasterStrokeRenderer,
} from "./engine-resource-setup";
import {
  bevelFieldBlocksScratchShrink,
} from "./engine-runtime-misc";

export interface EffectsRendererReleasePlan {
  readonly stroke: boolean;
  readonly bevel: boolean;
  readonly outerShadow: boolean;
  readonly innerShadow: boolean;
  readonly any: boolean;
}

interface EffectsReachabilityLiveLayerCacheEntry {
  readonly record: LayerRecord;
  readonly effectMask: number;
}

interface EffectsReachabilityCacheEntry {
  readonly historyActions: BrushEngine["historyActions"];
  readonly historyLength: number;
  readonly historyLastAction: BrushEngine["historyActions"][number] | null;
  readonly historyFloorCursor: number;
  readonly openMetadataEdit: BrushEngine["activeRasterLayerMetadataHistoryEdit"];
  readonly liveLayers: readonly EffectsReachabilityLiveLayerCacheEntry[];
  readonly reachable: RasterEffectRendererReachability;
}

const effectsReachabilityCache = new WeakMap<BrushEngine, EffectsReachabilityCacheEntry>();

function layerEffectReachabilityMask(record: LayerRecord): number {
  return Number(record.strokeStyle.enabled && record.strokeStyle.width > 0)
    | (Number(record.bevelStyle.enabled) << 1)
    | (Number(record.outerShadowStyle.enabled) << 2)
    | (Number(record.innerShadowStyle.enabled) << 3)
    | (Number(
      record.colorOverlayStyle.enabled && record.colorOverlayStyle.opacity > 0,
    ) << 4);
}

function effectsReachabilityCacheMatchesLiveLayers(
  cached: EffectsReachabilityCacheEntry,
  liveLayers: readonly LayerRecord[],
): boolean {
  if (cached.liveLayers.length !== liveLayers.length) return false;
  for (let index = 0; index < liveLayers.length; index += 1) {
    const live = liveLayers[index];
    const previous = cached.liveLayers[index];
    if (
      previous.record !== live
      || previous.effectMask !== layerEffectReachabilityMask(live)
    ) {
      return false;
    }
  }
  return true;
}

function reachableEffectRenderers(engine: BrushEngine): RasterEffectRendererReachability {
  const liveLayers = engine.layerStack.layers;
  const actions = engine.historyActions;
  const floorCursor = historyFloorCursor(engine);
  const lastAction = actions.at(-1) ?? null;
  const cached = effectsReachabilityCache.get(engine);
  if (
    cached
    && cached.historyActions === actions
    && cached.historyLength === actions.length
    && cached.historyLastAction === lastAction
    && cached.historyFloorCursor === floorCursor
    && cached.openMetadataEdit === engine.activeRasterLayerMetadataHistoryEdit
    && effectsReachabilityCacheMatchesLiveLayers(cached, liveLayers)
  ) {
    return cached.reachable;
  }
  const reachable = rasterEffectRendererReachability(
    liveLayers,
    actions,
    engine.activeRasterLayerMetadataHistoryEdit,
    floorCursor,
  );
  effectsReachabilityCache.set(engine, {
    historyActions: actions,
    historyLength: actions.length,
    historyLastAction: lastAction,
    historyFloorCursor: floorCursor,
    openMetadataEdit: engine.activeRasterLayerMetadataHistoryEdit,
    liveLayers: liveLayers.map((record) => ({
      record,
      effectMask: layerEffectReachabilityMask(record),
    })),
    reachable,
  });
  return reachable;
}

export function effectsRendererReleasePlan(engine: BrushEngine): EffectsRendererReleasePlan {
  if (
    !engine.rasterStrokeRenderer
    && !engine.rasterBevelRenderer
    && !engine.rasterOuterShadowRenderer
    && !engine.rasterInnerShadowRenderer
  ) {
    return {
      stroke: false,
      bevel: false,
      outerShadow: false,
      innerShadow: false,
      any: false,
    };
  }
  const reachable = reachableEffectRenderers(engine);
  const bevel = Boolean(engine.rasterBevelRenderer && !reachable.bevel);
  const outerShadow = Boolean(
    engine.rasterOuterShadowRenderer && !reachable.outerShadow,
  );
  const innerShadow = Boolean(
    engine.rasterInnerShadowRenderer && !reachable.innerShadow,
  );
  // Advanced live layer blending borrows the shared style compositor even
  // when no raster effect is reachable. Its release helper deliberately keeps
  // that renderer resident; excluding it here also prevents an idle retry loop.
  const stroke = Boolean(
    engine.rasterStrokeRenderer
    && !reachable.stroke
    && !engine.layerBlendTileCompositor,
  );
  return {
    stroke,
    bevel,
    outerShadow,
    innerShadow,
    any: stroke || bevel || outerShadow || innerShadow,
  };
}

function bevelFieldBlocksEffectsReclaim(
  engine: BrushEngine,
  releasePlan: EffectsRendererReleasePlan,
): boolean {
  // An unreachable Bevel renderer is destroyed whole, including its field; it
  // does not need the final field-shrink encode reserved for a reachable one.
  return !releasePlan.bevel && bevelFieldBlocksScratchShrink(engine);
}

export async function shrinkEffectsScratchAfterIdle(engine: BrushEngine): Promise<void> {
  const initialReleasePlan = effectsRendererReleasePlan(engine);
  if (
    engine.effectsScratchShrinkInFlight
    || bevelFieldBlocksEffectsReclaim(engine, initialReleasePlan)
    || !effectsScratchNeedsShrink(engine)
  ) {
    engine.scheduleBevelFieldShrink();
    return;
  }
  if (!effectsScratchCanShrinkNow(engine)) {
    engine.scheduleEffectsScratchShrink();
    return;
  }

  engine.effectsScratchShrinkInFlight = true;
  try {
    await engine.device.queue.onSubmittedWorkDone();
    const releasePlan = effectsRendererReleasePlan(engine);
    if (
      !effectsScratchCanShrinkNow(engine)
      || bevelFieldBlocksEffectsReclaim(engine, releasePlan)
    ) {
      engine.scheduleBevelFieldShrink();
      return;
    }

    // Destroy effect-owned persistent textures/buffers first. Each destroy()
    // also drops its scratch requirement; the one physical pool can then be
    // resized once, after every unreachable owner has gone away.
    if (releasePlan.outerShadow) releaseRasterOuterShadowRenderer(engine);
    if (releasePlan.innerShadow) releaseRasterInnerShadowRenderer(engine);
    if (releasePlan.bevel) releaseRasterBevelRenderer(engine);
    if (releasePlan.stroke) releaseRasterStrokeRenderer(engine);

    const pool = engine.effectsWorkbench?.scratchPool;
    if (!pool) {
      if (releasePlan.any) engine.publishStats();
      return;
    }
    const before = pool.snapshot();
    const retainedWithoutBevel = Math.max(
      0,
      ...Object.entries(before.requirements)
        .filter(([effectId]) => effectId !== "bevel")
        .map(([, bytes]) => bytes),
    );
    if ((before.requirements.bevel ?? 0) > retainedWithoutBevel) {
      engine.rasterBevelRenderer?.releaseIdleWorkspace();
    }
    const shrunk = pool.shrinkToFit();
    if (releasePlan.any || shrunk) {
      engine.publishStats();
    }
  } finally {
    engine.effectsScratchShrinkInFlight = false;
    if (effectsScratchNeedsShrink(engine)) {
      engine.scheduleEffectsScratchShrink();
    }
  }
}


export function effectsScratchNeedsShrink(engine: BrushEngine): boolean {
  if (effectsRendererReleasePlan(engine).any) {
    return true;
  }
  const snapshot = engine.effectsWorkbench?.scratchPool.snapshot();
  if (!snapshot || snapshot.currentBytes === 0) {
    return false;
  }
  if (!Object.values(snapshot.requirements).some((bytes) => bytes > 0)) {
    // Once the last owner is gone, even a sub-threshold allocation is useless:
    // return the physical pool all the way to zero instead of treating it as a
    // warm cache for an effect that no reachable state can request.
    return true;
  }
  let retainedBytes = 0;
  for (const [effectId, bytes] of Object.entries(snapshot.requirements)) {
    if (effectId !== "bevel") {
      retainedBytes = Math.max(retainedBytes, bytes);
    }
  }
  // Releasing the Smusso workspace only pays off when it actually reclaims
  // something material. When the Smusso footprint merely exceeds the Traccia
  // one by a little — reachable from the shipped UI with a hard chisel at a
  // large size — an unconditional comparison stays true in steady state and
  // turns every idle gap between two strokes into a free/regrow cycle.
  return effectsScratchShrinkIsWorthwhile(snapshot.currentBytes, retainedBytes);
}

export function effectsScratchCanShrinkNow(engine: BrushEngine): boolean {
  return effectsScratchCanShrink({
    initialized: engine.initialized,
    activeStroke: engine.activeStroke !== null,
    historyBusy: engine.historyBusy,
    layerSwitchBusy: engine.layerSwitchBusy,
    rasterStrokeBusy: engine.rasterStrokeBusy,
    rasterBevelBusy: engine.rasterBevelBusy,
    rasterOuterShadowBusy: engine.rasterOuterShadowBusy,
    rasterInnerShadowBusy: engine.rasterInnerShadowBusy,
    queuedWork: engine.effectsScratchHasQueuedWork(),
  });
}
