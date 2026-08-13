import type {
  BrushEngine,
} from "./brush-engine";
import {
  type LayerFormat,
} from "./engine-types";
import {
  type EffectsRetargetCaller,
  type LayerBakeResources,
  type LayerTextureResources,
  type MergedSurfaceResources,
} from "./engine-layer-resources";
import {
  createHydratedLayerTexture,
  destroyTransientLayerHydration,
} from "./engine-cold-storage";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "./engine-limits";
import {
  type DirtyRect,
} from "./engine-stroke-types";
import {
  layerEffectRendererRequirements,
  type LayerRecord,
} from "./layer-stack";
import {
  mergeDirtyRects,
  normalizeLayerRect,
} from "./engine-geometry";
import {
  mergedSurfaceMemoryBytes,
  mergedSurfaceMipLevelCount,
} from "./merged-surface-bounds";
import {
  normalizeRasterBevelStyle,
} from "./bevel-core";
import {
  normalizeRasterInnerShadowStyle,
  normalizeRasterOuterShadowStyle,
} from "./shadow-core";
import {
  normalizeRasterStrokeStyle,
} from "./stroke-core";
import {
  normalizeRasterColorOverlayStyle,
} from "./raster-color-overlay-core";
import {
  ensureEffectRenderersForRecord,
} from "./engine-resource-setup";
import {
  rasterBevelEffectRect,
  rasterInnerShadowEffectRect,
  rasterOuterShadowEffectRect,
  rasterStrokeEffectRect,
} from "./engine-runtime-misc";

import { retargetEffectsWorkingSetInternal } from "./engine-layer-effects-runtime";
import { layerToCanvasPixels } from "./engine-layer-residency-runtime";

export async function materializeLayerCompositeSource(engine: BrushEngine,
  record: LayerRecord,
  caller: EffectsRetargetCaller,
): Promise<{
  texture: GPUTexture;
  view: GPUTextureView;
  transientBake: LayerBakeResources | null;
  transientHydration: LayerTextureResources | null;
  nonTransparentBounds: DirtyRect;
  analyticBakePixels: number;
}> {
  const gpu = engine.requireLayerGpu(record.id);
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  if (gpu.bake && gpu.bakeValid) {
    return {
      texture: gpu.bake.texture,
      view: gpu.bake.samplingView,
      transientBake: null,
      transientHydration: null,
      nonTransparentBounds: { ...gpu.bake.nonTransparentBounds },
      analyticBakePixels:
        gpu.bake.nonTransparentBounds.width * gpu.bake.nonTransparentBounds.height,
    };
  }

  const transientHydration = gpu.hot
    ? null
    : await createHydratedLayerTexture(engine,
      record,
      gpu,
      `Fold reidratazione livello ${record.id}`,
      false,
      "defer-to-fold-fence",
    );
  const hot = gpu.hot ?? transientHydration;
  if (!hot) {
    throw new Error(`Fold livello ${record.id}: sorgente full-canvas mancante.`);
  }
  if (!requirements.needsStrokeRenderer) {
    return {
      texture: hot.texture,
      view: hot.view,
      transientBake: null,
      transientHydration,
      nonTransparentBounds: normalizeLayerRect(record.contentBounds) ?? {
        x: 0,
        y: 0,
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
      },
      analyticBakePixels: 0,
    };
  }

  try {
    await ensureEffectRenderersForRecord(engine, record);
    await retargetEffectsWorkingSetInternal(engine,
      hot.view,
      engine.layerFormat,
      record.contentBounds,
      caller,
      record,
      false,
      false,
      "defer-to-fold-fence",
      "content-bounds",
    );
    const transientBake = await engine.createLayerBakeCandidate(
      record,
      1,
      false,
      "defer-to-fold-fence",
    );
    return {
      texture: transientBake.texture,
      view: transientBake.samplingView,
      transientBake,
      transientHydration,
      nonTransparentBounds: { ...transientBake.nonTransparentBounds },
      analyticBakePixels:
        transientBake.nonTransparentBounds.width * transientBake.nonTransparentBounds.height,
    };
  } catch (error) {
    destroyTransientLayerHydration(engine, transientHydration);
    throw error;
  }
}

/**
 * Non-Normal layer modes need the real backdrop and therefore cannot be
 * hidden inside an independently flattened raster run. Keep consecutive
 * Normal clipping units fused, but isolate every unit whose parent owns an
 * advanced mode. A clipping unit remains atomic: child modes are evaluated
 * while its isolated source is built, and the parent's mode is applied later
 * to the complete group by the ordered viewport compositor.
 */

export function allocateMergedSurface(engine: BrushEngine,
  format: LayerFormat,
  side: "below" | "above",
  layerCount: number,
  bounds: DirtyRect = { x: 0, y: 0, width: DOCUMENT_WIDTH, height: DOCUMENT_HEIGHT },
  resolutionScale = 1,
  maintainMipChain = true,
): MergedSurfaceResources {
  const normalizedBounds = normalizeLayerRect(bounds);
  if (!normalizedBounds) {
    throw new Error(`Merged ${side}: bounds di allocazione non validi.`);
  }
  if (
    !Number.isInteger(resolutionScale)
    || resolutionScale < 1
    || resolutionScale > 64
  ) {
    throw new Error(`Merged ${side}: densità ${resolutionScale} non valida.`);
  }
  const textureWidth = normalizedBounds.width * resolutionScale;
  const textureHeight = normalizedBounds.height * resolutionScale;
  const maximumTextureExtent = engine.device.limits.maxTextureDimension2D;
  if (textureWidth > maximumTextureExtent || textureHeight > maximumTextureExtent) {
    throw new Error(
      `Merged ${side}: ${textureWidth}×${textureHeight} supera il limite `
      + `${maximumTextureExtent} della GPU.`,
    );
  }
  const physicalBounds = { width: textureWidth, height: textureHeight };
  const fullMipLevelCount = mergedSurfaceMipLevelCount(physicalBounds);
  const mipLevelCount = maintainMipChain ? fullMipLevelCount : 1;
  const memory = mergedSurfaceMemoryBytes(
    physicalBounds,
    format === "rgba16float" ? 8 : 4,
  );
  const texture = engine.device.createTexture({
    label:
      `Merged ${side} surface (${layerCount} layers) ${format} `
      + `${textureWidth}×${textureHeight} (${normalizedBounds.width}×`
      + `${normalizedBounds.height} doc @ ${resolutionScale}x) `
      + `@ ${normalizedBounds.x},${normalizedBounds.y}`
      + (maintainMipChain ? "" : " · mip0-only"),
    size: { width: textureWidth, height: textureHeight, depthOrArrayLayers: 1 },
    mipLevelCount,
    format,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.COPY_SRC,
  });
  try {
    const samplingView = texture.createView({
      label: `Merged ${side} sampling chain ${format}`,
    });
    const mipViews = Array.from(
      { length: mipLevelCount },
      (_, mipLevel) => texture.createView({
        label: `Merged ${side} mip ${mipLevel} ${format}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }),
    );
    const mipDownsampleBindGroups = mipViews.slice(0, -1).map(
      (sourceView, sourceMipLevel) => engine.device.createBindGroup({
        label: `Merged ${side} mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
        layout: engine.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }),
    );
    const surface: MergedSurfaceResources = {
      texture,
      samplingView,
      mipViews,
      mipDownsampleBindGroups,
      blendFoldBackdropScratchTexture: null,
      blendFoldBackdropScratchView: null,
      blendFoldScratchTexture: null,
      blendFoldScratchView: null,
      blendFoldUniformBuffer: null,
      blendFoldUniformStride: 0,
      blendFoldTileWidth: 0,
      blendFoldTileHeight: 0,
      bounds: { ...normalizedBounds },
      resolutionScale,
      textureWidth,
      textureHeight,
      mip0MemoryBytes: memory.mip0Bytes,
      mipChainMemoryBytes: maintainMipChain ? memory.mipChainBytes : 0,
      validThroughLevel: 0,
      layerCount,
      foldedPixels: 0,
      analyticBakePixels: 0,
    };
    engine.liveMergedSurfaceTextures.set(texture, surface);
    return surface;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}


export function layerCompositeVisualBounds(engine: BrushEngine, record: LayerRecord): DirtyRect {
  const fullDocumentRect: DirtyRect = {
    x: 0,
    y: 0,
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  };
  const contentBounds = normalizeLayerRect(record.contentBounds);
  if (!contentBounds) {
    // `hasContent` with no bounds is inconsistent metadata. Preserve pixels by
    // falling back to the old full-document contract.
    return fullDocumentRect;
  }

  let bounds: DirtyRect | null = contentBounds;
  const strokeStyle = normalizeRasterStrokeStyle(record.strokeStyle);
  if (strokeStyle.enabled && strokeStyle.width > 0) {
    bounds = mergeDirtyRects(
      bounds,
      rasterStrokeEffectRect(engine, contentBounds, strokeStyle.width),
    );
  }

  const bevelStyle = normalizeRasterBevelStyle(record.bevelStyle);
  if (bevelStyle.enabled) {
    bounds = mergeDirtyRects(
      bounds,
      rasterBevelEffectRect(engine, contentBounds, bevelStyle),
    );
  }

  const outerShadowStyle = normalizeRasterOuterShadowStyle(record.outerShadowStyle);
  if (outerShadowStyle.enabled) {
    bounds = mergeDirtyRects(
      bounds,
      rasterOuterShadowEffectRect(engine, contentBounds, outerShadowStyle),
    );
  }

  const innerShadowStyle = normalizeRasterInnerShadowStyle(record.innerShadowStyle);
  if (innerShadowStyle.enabled) {
    bounds = mergeDirtyRects(
      bounds,
      rasterInnerShadowEffectRect(engine, contentBounds, innerShadowStyle),
    );
  }
  return normalizeLayerRect(bounds) ?? fullDocumentRect;
}


export function layerDirtyRectToPresentationRect(engine: BrushEngine,
  dirtyRect: DirtyRect,
  selectedMipLevel: number,
): DirtyRect | null {
  const width = engine.canvas.width;
  const height = engine.canvas.height;
  if (width <= 0 || height <= 0) {
    return null;
  }

  // Il display usa filtraggio lineare sul mip selezionato: un texel derivato
  // copre 2^LOD pixel layer e può contribuire anche al campione adiacente.
  // Il margine 2^(LOD+1), più un pixel canvas, è conservativo anche rispetto
  // agli arrotondamenti f32 e ai confini interi dello scissor.
  const layerMargin = Math.max(2, 2 ** (selectedMipLevel + 1));
  const canvasMargin = 1;
  const layerLeft = dirtyRect.x - layerMargin;
  const layerTop = dirtyRect.y - layerMargin;
  const layerRight = dirtyRect.x + dirtyRect.width + layerMargin;
  const layerBottom = dirtyRect.y + dirtyRect.height + layerMargin;
  const topLeft = layerToCanvasPixels(engine, layerLeft, layerTop);
  const topRight = layerToCanvasPixels(engine, layerRight, layerTop);
  const bottomLeft = layerToCanvasPixels(engine, layerLeft, layerBottom);
  const bottomRight = layerToCanvasPixels(engine, layerRight, layerBottom);
  const canvasLeft = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const canvasTop = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  const canvasRight = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const canvasBottom = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

  const x = Math.max(0, Math.floor(Math.min(canvasLeft, canvasRight)) - canvasMargin);
  const y = Math.max(0, Math.floor(Math.min(canvasTop, canvasBottom)) - canvasMargin);
  const right = Math.min(width, Math.ceil(Math.max(canvasLeft, canvasRight)) + canvasMargin);
  const bottom = Math.min(height, Math.ceil(Math.max(canvasTop, canvasBottom)) + canvasMargin);
  const dirtyWidth = Math.max(0, right - x);
  const dirtyHeight = Math.max(0, bottom - y);
  return dirtyWidth > 0 && dirtyHeight > 0
    ? { x, y, width: dirtyWidth, height: dirtyHeight }
    : null;
}

export function encodeMergedSurfacePyramid(engine: BrushEngine,
  encoder: GPUCommandEncoder,
  surface: MergedSurfaceResources,
  selectedMipLevel: number,
): number {
  let passes = 0;
  const targetMipLevel = Math.min(
    selectedMipLevel,
    surface.mipViews.length - 1,
  );
  for (
    let mipLevel = surface.validThroughLevel + 1;
    mipLevel <= targetMipLevel;
    mipLevel += 1
  ) {
    const pass = encoder.beginRenderPass({
      label: `Build merged surface mip ${mipLevel}`,
      colorAttachments: [{
        view: surface.mipViews[mipLevel],
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(engine.paintMipDownsamplePipeline);
    pass.setBindGroup(0, surface.mipDownsampleBindGroups[mipLevel - 1]);
    pass.draw(3, 1, 0, 0);
    pass.end();
    passes += 1;
  }
  surface.validThroughLevel = Math.max(surface.validThroughLevel, targetMipLevel);
  return passes;
}

export function encodeMergedDisplayPyramids(engine: BrushEngine,
  encoder: GPUCommandEncoder,
  selectedMipLevel: number,
): number {
  let passes = 0;
  if (engine.mergedBelow) {
    passes += encodeMergedSurfacePyramid(engine,
      encoder,
      engine.mergedBelow,
      Math.max(selectedMipLevel, requiredMergedSurfaceMipLevel(engine, engine.mergedBelow)),
    );
  }
  if (engine.mergedAbove) {
    passes += encodeMergedSurfacePyramid(engine,
      encoder,
      engine.mergedAbove,
      Math.max(selectedMipLevel, requiredMergedSurfaceMipLevel(engine, engine.mergedAbove)),
    );
  }
  for (const segment of engine.mixedSceneRasterSegments) {
    passes += encodeMergedSurfacePyramid(engine,
      encoder,
      segment.surface,
      Math.max(
        selectedMipLevel,
        requiredMergedSurfaceMipLevel(engine, segment.surface),
      ),
    );
  }
  return passes;
}


export function mergedSurfaceSamplingLod(engine: BrushEngine, surface: MergedSurfaceResources): number {
  return Math.max(
    0,
    Math.log2(surface.resolutionScale / Math.max(engine.zoom, 1e-6)),
  );
}

export function requiredMergedSurfaceMipLevel(engine: BrushEngine, surface: MergedSurfaceResources): number {
  return Math.min(
    surface.mipViews.length - 1,
    Math.ceil(mergedSurfaceSamplingLod(engine, surface)),
  );
}
