import type {
  BrushEngine,
} from "./brush-engine";
import {
  type LayerBakeFaultPoint,
  type LayerCompositeFaultPoint,
  type LayerFormat,
} from "./engine-types";
import {
  runGpuAllocationTransaction,
} from "./gpu-allocation-transaction";
import {
  type DisplayPyramidResources,
  type EffectsRetargetCaller,
  type LayerEffectsRebuildDomain,
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
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
} from "./engine-limits";
import {
  rebuildVectorTextDisplayBindGroup,
} from "./engine-vector-text-resources-runtime";
import {
  layerEffectRendererRequirements,
} from "./layer-stack";
import {
  normalizeRasterBevelStyle,
} from "./bevel-core";
import {
  normalizeRasterInnerShadowStyle,
  normalizeRasterOuterShadowStyle,
} from "./shadow-core";
import {
  normalizeRasterColorOverlayStyle,
} from "./raster-color-overlay-core";
import {
  ensureEffectRenderersForRecord,
} from "./engine-resource-setup";
import {
  clientToCanvasPixels,
} from "./engine-runtime-misc";

import { retargetEffectsWorkingSetInternal } from "./engine-layer-effects-runtime";
import { releaseLayerBlendFoldScratch } from "./engine-layer-fold-runtime";

export async function bakeActiveLayerForSwitchAttempt(engine: BrushEngine): Promise<void> {
  const record = engine.layerStack.active;
  const gpu = engine.requireLayerGpu(record.id);
  const hot = requireLayerHot(engine, record.id);
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  if (!engine.layerHasContent || !requirements.needsStrokeRenderer) {
    const previous = gpu.bake;
    gpu.bake = null;
    gpu.bakeValid = false;
    engine.destroyLayerBake(previous);
    return;
  }

  const faultForcesCandidate = import.meta.env.DEV
    && engine.layerBakeFaultQueue[0] === "after-candidate-submit";
  if (gpu.bake && gpu.bakeValid && !faultForcesCandidate) {
    return;
  }

  const workbench = engine.effectsWorkbench;
  if (!engine.rasterStrokeRenderer || !workbench) {
    throw new Error("Bake impossibile: compositore effetti non disponibile.");
  }
  if (
    engine.layerView !== hot.view
    || workbench.sourceView !== hot.view
    || engine.layerStack.active.id !== record.id
  ) {
    throw new Error("Bake rifiutato: il banco effetti non punta al livello uscente.");
  }

  const previous = gpu.bake;
  const generation = (previous?.generation ?? 0) + 1;
  const completed = await engine.createLayerBakeCandidate(record, generation, true);
  gpu.bake = completed;
  gpu.bakeValid = true;
  engine.destroyLayerBake(previous);
}


export async function freezeActiveLayerToCold(engine: BrushEngine): Promise<void> {
  const record = engine.layerStack.active;
  const gpu = engine.requireLayerGpu(record.id);
  const hot = requireLayerHot(engine, record.id);
  const previous = gpu.cold;
  const previousCompressed = gpu.compressed;
  if (!record.hasContent) {
    gpu.cold = null;
    gpu.compressed = null;
    destroyLayerColdStorage(previous);
    return;
  }
  const mask = coldStorageMaskForRecord(record);
  const generation = Math.max(
    previous?.generation ?? 0,
    previousCompressed?.generation ?? 0,
  ) + 1;
  const candidate = await createLayerColdStorageCandidate(engine,
    record,
    hot,
    mask,
    generation,
  );
  gpu.cold = candidate;
  gpu.compressed = null;
  record.storageTileMask.set(mask);
  destroyLayerColdStorage(previous);
}

export function allocateActiveLayerDisplayPyramid(engine: BrushEngine, format: LayerFormat): DisplayPyramidResources {
  const texture = engine.device.createTexture({
    label: `Single active-layer display pyramid ${format}`,
    size: {
      width: Math.max(1, DOCUMENT_WIDTH >> 1),
      height: Math.max(1, DOCUMENT_HEIGHT >> 1),
      depthOrArrayLayers: 1,
    },
    mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    const samplingView = texture.createView({ label: `Active logical mips 1–12 ${format}` });
    const mipViews = Array.from(
      { length: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1 },
      (_, mipLevel) => texture.createView({
        label: `Active logical mip ${mipLevel + 1} ${format}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }),
    );
    return { texture, samplingView, mipViews };
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export async function restoreEffectsWorkbenchToActiveLayer(engine: BrushEngine,
  caller: EffectsRetargetCaller = "layer-switch",
  force = false,
  rebuildDomain: LayerEffectsRebuildDomain = "full-document",
): Promise<void> {
  const record = engine.layerStack.active;
  const hot = requireLayerHot(engine, record.id);
  if (!force && engine.effectsWorkbench?.sourceView === hot.view) {
    return;
  }
  await ensureEffectRenderersForRecord(engine, record);
  await retargetEffectsWorkingSetInternal(engine,
    hot.view,
    engine.layerFormat,
    record.contentBounds,
    caller,
    record,
    false,
    true,
    "await-immediately",
    rebuildDomain,
  );
}


export function rebuildLayerDisplayBindGroups(engine: BrushEngine): void {
  engine.displayBindGroup = engine.device.createBindGroup({
    label: "Three-surface layer display bind group",
    layout: engine.displayBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: engine.layerView },
      { binding: 2, resource: engine.activeLayerDisplayPyramid.samplingView },
      { binding: 3, resource: engine.mergedBelowView() },
      { binding: 4, resource: engine.mergedAboveView() },
      { binding: 5, resource: engine.sampler },
      { binding: 6, resource: engine.activeClippingPrefixView() },
      { binding: 7, resource: engine.activeClippingSuffixView() },
    ],
  });
  engine.paintStackCompositeMipBindGroup = engine.device.createBindGroup({
    label: "Final raster stack composited mip 1 bind group",
    layout: engine.paintStackCompositeMipBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: engine.layerView },
      { binding: 2, resource: engine.mergedBelowView() },
      { binding: 3, resource: engine.mergedAboveView() },
      { binding: 4, resource: engine.activeClippingPrefixView() },
      { binding: 5, resource: engine.activeClippingSuffixView() },
    ],
  });
  if (engine.lightGlazeView) {
    engine.lightGlazeCompositeMipBindGroup = engine.device.createBindGroup({
      label: "Light Glaze group-aware composited logical mip 1",
      layout: engine.lightGlazeCompositeMipBindGroupLayout,
      entries: [
        { binding: 0, resource: engine.layerView },
        { binding: 1, resource: engine.lightGlazeView },
        { binding: 2, resource: { buffer: engine.lightGlazeUniformBuffer } },
        { binding: 3, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 4, resource: engine.activeClippingPrefixView() },
        { binding: 5, resource: engine.activeClippingSuffixView() },
        { binding: 6, resource: engine.mergedBelowView() },
        { binding: 7, resource: engine.mergedAboveView() },
      ],
    });
  }
  // Mip 1 may currently contain a fold of the previous active/merged views.
  // Resource retargeting therefore invalidates the shared pyramid regardless
  // of its current content mode.
  engine.paintDisplayMipValidThroughLevel = 0;
  rebuildVectorTextDisplayBindGroup(engine);
  engine.rebuildRasterStrokeDisplayBindGroups();
}

export function commitActiveLayerResidency(engine: BrushEngine, fromIndex: number): void {
  const activeGpu = engine.requireLayerGpu(engine.layerStack.active.id);
  requireLayerHot(engine, engine.layerStack.active.id);
  destroyLayerColdStorage(activeGpu.cold);
  activeGpu.cold = null;
  activeGpu.compressed = null;

  const previousRecord = engine.layerStack.at(fromIndex);
  if (previousRecord.id === engine.layerStack.active.id) {
    return;
  }
  if (previousRecord.id === engine.layerStack.referenceLayerId) {
    // Fill must sample the reference immediately on every target layer. Its
    // authoritative mip 0 therefore remains full-resident by contract.
    return;
  }
  const previousGpu = engine.requireLayerGpu(previousRecord.id);
  destroyLayerHot(previousGpu.hot);
  previousGpu.hot = null;
}

export function rebuildActiveLayerPyramidBindings(engine: BrushEngine): void {
  engine.paintMipViews = [engine.layerView, ...engine.activeLayerDisplayPyramid.mipViews];
  const sources = [
    engine.layerView,
    ...engine.activeLayerDisplayPyramid.mipViews.slice(0, -1),
  ];
  engine.paintMipDownsampleBindGroups = sources.map((sourceView, sourceMipLevel) =>
    engine.device.createBindGroup({
      label: `Active display logical mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
      layout: engine.paintMipDownsampleBindGroupLayout,
      entries: [{ binding: 0, resource: sourceView }],
    })
  );
}


export async function bakeActiveLayerForSwitch(engine: BrushEngine): Promise<void> {
  try {
    await bakeActiveLayerForSwitchAttempt(engine);
  } finally {
    if (import.meta.env.DEV) {
      // A fault that was not reached by this attempt must not ambush a later,
      // unrelated switch.
      engine.layerBakeFaultQueue = [];
    }
  }
}

export function clientToLayer(engine: BrushEngine, clientX: number, clientY: number): { x: number; y: number } {
  const screen = clientToCanvasPixels(engine, clientX, clientY);
  const offset = canvasOffsetToLayerOffset(engine,
    screen.x - engine.canvas.width * 0.5,
    screen.y - engine.canvas.height * 0.5,
  );
  return {
    x: engine.viewCenterX + offset.x,
    y: engine.viewCenterY + offset.y,
  };
}

export async function allocateLayerGpuResources(engine: BrushEngine,
  format: LayerFormat,
  label: string,
): Promise<LayerGpuResources> {
  return runGpuAllocationTransaction(engine.device, label, (transaction) => {
    const hot = engine.allocateLayerTexture(format);
    transaction.deferRollback(() => hot.texture.destroy());
    return { hot, cold: null, compressed: null, bake: null, bakeValid: false };
  });
}

export function destroyLayerGpuResources(engine: BrushEngine, gpu: LayerGpuResources): void {
  engine.destroyLayerBake(gpu.bake);
  destroyLayerColdStorage(gpu.cold);
  destroyLayerHot(gpu.hot);
  gpu.bake = null;
  gpu.bakeValid = false;
  gpu.cold = null;
  gpu.compressed = null;
  gpu.hot = null;
}

export function layerToCanvasPixels(engine: BrushEngine, layerX: number, layerY: number): { x: number; y: number } {
  const offset = layerOffsetToCanvasOffset(engine,
    layerX - engine.viewCenterX,
    layerY - engine.viewCenterY,
  );
  return {
    x: engine.canvas.width * 0.5 + offset.x,
    y: engine.canvas.height * 0.5 + offset.y,
  };
}

export function invalidateActiveLayerBake(engine: BrushEngine): void {
  if (!engine.initialized) {
    return;
  }
  const gpu = engine.layerGpu.get(engine.layerStack.active.id);
  if (gpu) {
    gpu.bakeValid = false;
  }
}

export function bindActiveLayerResources(engine: BrushEngine): void {
  const hot = requireLayerHot(engine, engine.layerStack.active.id);
  engine.layerTexture = hot.texture;
  engine.layerView = hot.view;
  engine.layerSamplingView = hot.samplingView;
  engine.selectionRenderer?.setSourceSamplingView(hot.samplingView);
  rebuildActiveLayerPyramidBindings(engine);
  rebuildLayerDisplayBindGroups(engine);
}

export function canvasOffsetToLayerOffset(engine: BrushEngine, deltaX: number, deltaY: number): { x: number; y: number } {
  const scaledX = deltaX / engine.zoom;
  const scaledY = deltaY / engine.zoom;
  return {
    x: engine.viewRotationCos * scaledX + engine.viewRotationSin * scaledY,
    y: -engine.viewRotationSin * scaledX + engine.viewRotationCos * scaledY,
  };
}

export function cancelEffectsScratchShrink(engine: BrushEngine): void {
  if (engine.effectsScratchShrinkTimer === null) {
    return;
  }
  window.clearTimeout(engine.effectsScratchShrinkTimer);
  engine.effectsScratchShrinkTimer = null;
}

export function requireLayerHot(engine: BrushEngine, layerId: number): LayerTextureResources {
  const hot = engine.requireLayerGpu(layerId).hot;
  if (!hot) {
    throw new Error(`Texture full-canvas del livello ${layerId} non residente.`);
  }
  return hot;
}

export function maybeInjectLayerBakeFault(engine: BrushEngine, point: LayerBakeFaultPoint): void {
  if (!import.meta.env.DEV || engine.layerBakeFaultQueue[0] !== point) {
    return;
  }
  engine.layerBakeFaultQueue.shift();
  throw new Error(`Guasto iniettato nel bake: ${point}.`);
}

export function maybeInjectLayerCompositeFault(engine: BrushEngine, point: LayerCompositeFaultPoint): void {
  if (!import.meta.env.DEV || engine.layerCompositeFaultQueue[0] !== point) {
    return;
  }
  engine.layerCompositeFaultQueue.shift();
  throw new Error(`Guasto iniettato nel compositing: ${point}.`);
}

export function releaseFusedLayerBakes(engine: BrushEngine): void {
  for (const gpu of engine.layerGpu.values()) {
    engine.destroyLayerBake(gpu.bake);
    gpu.bake = null;
    gpu.bakeValid = false;
  }
}


export function layerOffsetToCanvasOffset(engine: BrushEngine, deltaX: number, deltaY: number): { x: number; y: number } {
  return {
    x: (engine.viewRotationCos * deltaX - engine.viewRotationSin * deltaY) * engine.zoom,
    y: (engine.viewRotationSin * deltaX + engine.viewRotationCos * deltaY) * engine.zoom,
  };
}

export function destroyLayerBakeTexture(engine: BrushEngine, texture: GPUTexture): void {
  engine.liveLayerBakeTextures.delete(texture);
  texture.destroy();
}

export function destroyMergedSurfaceTexture(engine: BrushEngine, texture: GPUTexture): void {
  const surface = engine.liveMergedSurfaceTextures.get(texture);
  if (surface) {
    releaseLayerBlendFoldScratch(surface);
  }
  engine.liveMergedSurfaceTextures.delete(texture);
  texture.destroy();
}
