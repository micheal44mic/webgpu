import type { BrushEngine } from "./brush-engine";
import { usesStrokeGlazeRenderer, type LightGlazeStorageMode } from "./engine-strategies";
import { type LightGlazeResourceSet, type LightGlazeSession } from "./engine-paint-resources";
import {
  LAYER_SIZE,
  LIGHT_GLAZE_COMMIT_TILE_EXTENT,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES,
  MAX_STAMPS_PER_BATCH,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
  STABILIZATION_TAIL_TEXTURE_QUANTUM,
} from "./engine-limits";
import { type DirtyRect } from "./engine-stroke-types";
import { paintMipDimensions } from "./engine-geometry";
import { type BlendMode } from "./engine-types";

export function createLightGlazeResourceSet(engine: BrushEngine, 
  storageMode: LightGlazeStorageMode,
): LightGlazeResourceSet {
  const {
    texture,
    compositeMipTexture,
    view,
    samplingView,
    compositeMipViews,
    downsampleBindGroups,
    compositeMipBindGroup,
    displayBindGroup,
    compositeBindGroup,
    commitTileTexture,
    commitTileView,
    commitTileBindGroup,
  } = (() => {
    let texture: GPUTexture | null = null;
    let compositeMipTexture: GPUTexture | null = null;
    let commitTileTexture: GPUTexture | null = null;
    let commitTileView: GPUTextureView | null = null;
    let commitTileBindGroup: GPUBindGroup | null = null;
    try {
      const accumulatorFormat: GPUTextureFormat = storageMode === "r8-coverage"
        ? "r8unorm"
        : "rgba16float";
      texture = engine.device.createTexture({
        label: `Lazy Light Glaze stroke accumulator ${accumulatorFormat}`,
        size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
        format: accumulatorFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.COPY_DST,
      });
      compositeMipTexture = engine.device.createTexture({
        label: `Lazy Light Glaze composited logical mip 1+ ${engine.layerFormat}`,
        size: {
          width: Math.max(1, LAYER_SIZE >> 1),
          height: Math.max(1, LAYER_SIZE >> 1),
          depthOrArrayLayers: 1,
        },
        mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
        format: engine.layerFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const view = texture.createView({
        label: "Light Glaze authoritative stroke mip 0",
      });
      const samplingView = compositeMipTexture.createView({
        label: "Light Glaze final-composite logical mip 1+ sampling chain",
        baseMipLevel: 0,
        mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
      });
      const compositeMipViews = Array.from(
        { length: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1 },
        (_, mipIndex) => compositeMipTexture!.createView({
          label: `Light Glaze final-composite logical mip ${mipIndex + 1}`,
          baseMipLevel: mipIndex,
          mipLevelCount: 1,
        }),
      );
      const downsampleBindGroups = compositeMipViews
        .slice(0, -1)
        .map((sourceView, sourceMipIndex) => engine.device.createBindGroup({
          label: `Light Glaze logical mip ${sourceMipIndex + 1} to ${sourceMipIndex + 2}`,
          layout: engine.paintMipDownsampleBindGroupLayout,
          entries: [{ binding: 0, resource: sourceView }],
        }));
      const compositeMipBindGroup = engine.device.createBindGroup({
        label: "Light Glaze permanent + stroke to composited logical mip 1",
        layout: engine.lightGlazeCompositeMipBindGroupLayout,
        entries: [
          { binding: 0, resource: engine.layerView },
          { binding: 1, resource: view },
          { binding: 2, resource: { buffer: engine.lightGlazeUniformBuffer } },
        ],
      });
      const displayBindGroup = engine.device.createBindGroup({
        label: "Light Glaze live display bind group",
        layout: engine.lightGlazeDisplayBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: engine.layerSamplingView },
          { binding: 2, resource: view },
          { binding: 3, resource: engine.sampler },
          { binding: 4, resource: { buffer: engine.lightGlazeUniformBuffer } },
          { binding: 5, resource: samplingView },
          { binding: 6, resource: engine.mergedBelowView() },
          { binding: 7, resource: engine.mergedAboveView() },
          { binding: 8, resource: engine.vectorTextBelowView ?? engine.transparentLayerView },
          { binding: 9, resource: engine.vectorTextAboveView ?? engine.transparentLayerView },
        ],
      });
      const compositeBindGroup = engine.device.createBindGroup({
        label: "Light Glaze final composite bind group",
        layout: engine.lightGlazeCompositeBindGroupLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: { buffer: engine.lightGlazeUniformBuffer } },
        ],
      });

      if (storageMode === "rgba16float-stroke") {
        if (
          LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES
            % engine.device.limits.minUniformBufferOffsetAlignment !== 0
        ) {
          throw new Error(
            "Allineamento uniform dinamico non supportato dal commit tile glaze ad alta precisione.",
          );
        }
        commitTileTexture = engine.device.createTexture({
          label: `High precision glaze exact commit tile ${engine.layerFormat}`,
          size: {
            width: LIGHT_GLAZE_COMMIT_TILE_EXTENT,
            height: LIGHT_GLAZE_COMMIT_TILE_EXTENT,
            depthOrArrayLayers: 1,
          },
          format: engine.layerFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        commitTileView = commitTileTexture.createView({
          label: "High precision glaze exact commit tile view",
        });
        commitTileBindGroup = engine.device.createBindGroup({
          label: "High precision glaze exact commit tile bind group",
          layout: engine.lightGlazeCommitTileBindGroupLayout,
          entries: [
            { binding: 0, resource: engine.layerView },
            { binding: 1, resource: view },
            { binding: 2, resource: { buffer: engine.lightGlazeUniformBuffer } },
            {
              binding: 3,
              resource: {
                buffer: engine.lightGlazeCommitTileUniformBuffer,
                offset: 0,
                size: LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES,
              },
            },
          ],
        });
      }

      return {
        texture: texture!,
        compositeMipTexture: compositeMipTexture!,
        view,
        samplingView,
        compositeMipViews,
        downsampleBindGroups,
        compositeMipBindGroup,
        displayBindGroup,
        compositeBindGroup,
        commitTileTexture,
        commitTileView,
        commitTileBindGroup,
      };
    } catch (error) {
      commitTileTexture?.destroy();
      compositeMipTexture?.destroy();
      texture?.destroy();
      throw error;
    }
  })();
  return {
    storageMode,
    texture,
    compositeMipTexture,
    view,
    samplingView,
    compositeMipViews,
    downsampleBindGroups,
    compositeMipBindGroup,
    displayBindGroup,
    compositeBindGroup,
    commitTileTexture,
    commitTileView,
    commitTileBindGroup,
  };
}

export function encodeLightGlazeDisplayPyramid(engine: BrushEngine, 
  encoder: GPUCommandEncoder,
  session: LightGlazeSession,
  baseDirtyRect: DirtyRect | null,
  selectedMipLevel: number,
): { passes: number; updatedPixels: number } {
  const previousValidThroughLevel = session.mipValidThroughLevel;
  const baseChanged = baseDirtyRect !== null;
  let sourceDirtyRect = baseDirtyRect;
  let passes = 0;
  let updatedPixels = 0;

  for (let mipLevel = 1; mipLevel <= selectedMipLevel; mipLevel += 1) {
    const dimensions = paintMipDimensions(mipLevel);
    const needsFullBuild = mipLevel > previousValidThroughLevel;
    const targetDirtyRect = needsFullBuild
      ? { x: 0, y: 0, ...dimensions }
      : sourceDirtyRect
        ? engine.downsampleDirtyRect(sourceDirtyRect, mipLevel)
        : null;
    if (!targetDirtyRect || targetDirtyRect.width <= 0 || targetDirtyRect.height <= 0) {
      continue;
    }

    const pass = encoder.beginRenderPass({
      label: needsFullBuild
        ? `Build full Light Glaze final-composite mip ${mipLevel}`
        : `Update Light Glaze final-composite mip ${mipLevel} dirty rect`,
      colorAttachments: [
        {
          view: engine.lightGlazeMipViews[mipLevel],
          loadOp: needsFullBuild ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    if (mipLevel === 1) {
      pass.setPipeline(engine.lightGlazeCompositeMipPipeline);
      pass.setBindGroup(0, engine.lightGlazeCompositeMipBindGroup!);
    } else {
      pass.setPipeline(engine.paintMipDownsamplePipeline);
      pass.setBindGroup(0, engine.lightGlazeMipDownsampleBindGroups[mipLevel - 2]);
    }
    if (!needsFullBuild) {
      pass.setScissorRect(
        targetDirtyRect.x,
        targetDirtyRect.y,
        targetDirtyRect.width,
        targetDirtyRect.height,
      );
    }
    pass.draw(3, 1, 0, 0);
    pass.end();
    passes += 1;
    updatedPixels += targetDirtyRect.width * targetDirtyRect.height;
    sourceDirtyRect = targetDirtyRect;
  }

  if (baseChanged) {
    session.mipValidThroughLevel = selectedMipLevel;
  } else if (selectedMipLevel > previousValidThroughLevel) {
    session.mipValidThroughLevel = selectedMipLevel;
  }
  return { passes, updatedPixels };
}

export function currentLightGlazeResourceSet(engine: BrushEngine): LightGlazeResourceSet | null {
  if (
    !engine.lightGlazeStorageAllocated
    || engine.lightGlazeStorageMode === "none"
    || !engine.lightGlazeTexture
    || !engine.lightGlazeCompositeMipTexture
    || !engine.lightGlazeView
    || !engine.lightGlazeSamplingView
    || !engine.lightGlazeCompositeMipBindGroup
    || !engine.lightGlazeDisplayBindGroup
    || !engine.lightGlazeCompositeBindGroup
  ) {
    return null;
  }
  return {
    storageMode: engine.lightGlazeStorageMode,
    texture: engine.lightGlazeTexture,
    compositeMipTexture: engine.lightGlazeCompositeMipTexture,
    view: engine.lightGlazeView,
    samplingView: engine.lightGlazeSamplingView,
    compositeMipViews: engine.lightGlazeMipViews.slice(1),
    downsampleBindGroups: [...engine.lightGlazeMipDownsampleBindGroups],
    compositeMipBindGroup: engine.lightGlazeCompositeMipBindGroup,
    displayBindGroup: engine.lightGlazeDisplayBindGroup,
    compositeBindGroup: engine.lightGlazeCompositeBindGroup,
    commitTileTexture: engine.lightGlazeCommitTileTexture,
    commitTileView: engine.lightGlazeCommitTileView,
    commitTileBindGroup: engine.lightGlazeCommitTileBindGroup,
  };
}

export function destroyLightGlazeResources(engine: BrushEngine): void {
  engine.rasterStrokeRenderer?.setLightGlazeView(null);
  engine.rasterBevelRenderer?.setLightGlazeView(null);
  engine.rasterOuterShadowRenderer?.setLightGlazeView(null);
  engine.rasterInnerShadowRenderer?.setLightGlazeView(null);
  engine.rebuildRasterStrokeDisplayBindGroups();
  engine.lightGlazeSession = null;
  engine.lightGlazeStaleRect = null;
  engine.lightGlazeTexture?.destroy();
  engine.lightGlazeCompositeMipTexture?.destroy();
  engine.lightGlazeCommitTileTexture?.destroy();
  engine.lightGlazeTexture = null;
  engine.lightGlazeCompositeMipTexture = null;
  engine.lightGlazeView = null;
  engine.lightGlazeSamplingView = null;
  engine.lightGlazeMipViews = [];
  engine.lightGlazeMipDownsampleBindGroups = [];
  engine.lightGlazeCompositeMipBindGroup = null;
  engine.lightGlazeDisplayBindGroup = null;
  engine.lightGlazeCompositeBindGroup = null;
  engine.lightGlazeCommitTileTexture = null;
  engine.lightGlazeCommitTileView = null;
  engine.lightGlazeCommitTileBindGroup = null;
  engine.lightGlazeStorageAllocated = false;
  engine.lightGlazeStorageMode = "none";
  destroyStrokeStabilizationSnapshot(engine);
}

export function destroyStrokeStabilizationSnapshot(engine: BrushEngine): void {
  engine.stabilizationSnapshotTexture?.destroy();
  engine.stabilizationSnapshotTexture = null;
  engine.stabilizationSnapshotWidth = 0;
  engine.stabilizationSnapshotHeight = 0;
  engine.stabilizationSnapshotStorageMode = "none";
  engine.stabilizationSnapshotRect = null;
}

/**
 * Grows the prefix snapshot monotonically. The returned old texture may still
 * be referenced by a restore copy already encoded by the caller; destroy it
 * only after that command buffer has been submitted.
 */
export function ensureStrokeStabilizationSnapshot(
  engine: BrushEngine,
  storageMode: Exclude<LightGlazeStorageMode, "none">,
  minimumWidth: number,
  minimumHeight: number,
): GPUTexture | null {
  const roundedWidth = Math.min(
    LAYER_SIZE,
    Math.max(
      STABILIZATION_TAIL_TEXTURE_QUANTUM,
      Math.ceil(Math.max(1, minimumWidth) / STABILIZATION_TAIL_TEXTURE_QUANTUM)
        * STABILIZATION_TAIL_TEXTURE_QUANTUM,
    ),
  );
  const roundedHeight = Math.min(
    LAYER_SIZE,
    Math.max(
      STABILIZATION_TAIL_TEXTURE_QUANTUM,
      Math.ceil(Math.max(1, minimumHeight) / STABILIZATION_TAIL_TEXTURE_QUANTUM)
        * STABILIZATION_TAIL_TEXTURE_QUANTUM,
    ),
  );
  if (
    engine.stabilizationSnapshotTexture
    && engine.stabilizationSnapshotStorageMode === storageMode
    && engine.stabilizationSnapshotWidth >= roundedWidth
    && engine.stabilizationSnapshotHeight >= roundedHeight
  ) {
    return null;
  }

  const sameStorage = engine.stabilizationSnapshotStorageMode === storageMode;
  // Geometric growth keeps allocation off the repeated pointer-frame path:
  // a moving tail can cross many 128 px boundaries, but typically pays only
  // logarithmically many reallocations over the lifetime of the resource.
  const width = sameStorage && engine.stabilizationSnapshotWidth > 0
    ? roundedWidth > engine.stabilizationSnapshotWidth
      ? Math.min(
        LAYER_SIZE,
        Math.max(roundedWidth, engine.stabilizationSnapshotWidth * 2),
      )
      : engine.stabilizationSnapshotWidth
    : roundedWidth;
  const height = sameStorage && engine.stabilizationSnapshotHeight > 0
    ? roundedHeight > engine.stabilizationSnapshotHeight
      ? Math.min(
        LAYER_SIZE,
        Math.max(roundedHeight, engine.stabilizationSnapshotHeight * 2),
      )
      : engine.stabilizationSnapshotHeight
    : roundedHeight;
  const format: GPUTextureFormat = storageMode === "r8-coverage"
    ? "r8unorm"
    : "rgba16float";
  const texture = engine.device.createTexture({
    label: `Stabilization mature-prefix snapshot ${width}×${height} ${format}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format,
    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
  const previous = engine.stabilizationSnapshotTexture;
  engine.stabilizationSnapshotTexture = texture;
  engine.stabilizationSnapshotWidth = width;
  engine.stabilizationSnapshotHeight = height;
  engine.stabilizationSnapshotStorageMode = storageMode;
  return previous;
}

export function applyLightGlazeResourceSet(engine: BrushEngine, resources: LightGlazeResourceSet | null): void {
  if (
    !resources
    || (
      engine.stabilizationSnapshotStorageMode !== "none"
      && engine.stabilizationSnapshotStorageMode !== resources.storageMode
    )
  ) {
    destroyStrokeStabilizationSnapshot(engine);
  }
  const view = resources?.view ?? null;
  engine.lightGlazeTexture = resources?.texture ?? null;
  engine.lightGlazeCompositeMipTexture = resources?.compositeMipTexture ?? null;
  engine.lightGlazeView = view;
  engine.lightGlazeSamplingView = resources?.samplingView ?? null;
  engine.lightGlazeMipViews = resources
    ? [resources.view, ...resources.compositeMipViews]
    : [];
  engine.lightGlazeMipDownsampleBindGroups = resources?.downsampleBindGroups ?? [];
  engine.lightGlazeCompositeMipBindGroup = resources?.compositeMipBindGroup ?? null;
  engine.lightGlazeDisplayBindGroup = resources?.displayBindGroup ?? null;
  engine.lightGlazeCompositeBindGroup = resources?.compositeBindGroup ?? null;
  engine.lightGlazeCommitTileTexture = resources?.commitTileTexture ?? null;
  engine.lightGlazeCommitTileView = resources?.commitTileView ?? null;
  engine.lightGlazeCommitTileBindGroup = resources?.commitTileBindGroup ?? null;
  engine.lightGlazeStorageAllocated = resources !== null;
  engine.lightGlazeStorageMode = resources?.storageMode ?? "none";
  engine.rasterStrokeRenderer?.setLightGlazeView(view);
  engine.rasterBevelRenderer?.setLightGlazeView(view);
  engine.rasterOuterShadowRenderer?.setLightGlazeView(view);
  engine.rasterInnerShadowRenderer?.setLightGlazeView(view);
  engine.rebuildRasterStrokeDisplayBindGroups();
}

export function lightGlazeResourcesMatch(engine: BrushEngine, storageMode: LightGlazeStorageMode): boolean {
  return Boolean(
    engine.lightGlazeTexture
    && engine.lightGlazeCompositeMipTexture
    && engine.lightGlazeView
    && engine.lightGlazeSamplingView
    && engine.lightGlazeCompositeMipBindGroup
    && engine.lightGlazeDisplayBindGroup
    && engine.lightGlazeCompositeBindGroup
    && (
      storageMode === "r8-coverage"
      || (
        engine.lightGlazeCommitTileTexture
        && engine.lightGlazeCommitTileView
        && engine.lightGlazeCommitTileBindGroup
      )
    )
    && engine.lightGlazeStorageMode === storageMode
  );
}

export function flushClosingLightGlazeSessionBeforeNewStroke(engine: BrushEngine): void {
  if (!engine.lightGlazeSession?.endRequested) {
    return;
  }

  let iterations = 0;
  const maximumIterations = Math.ceil(engine.pendingStamps.length / MAX_STAMPS_PER_BATCH) + 2;
  while (engine.lightGlazeSession?.endRequested) {
    if (engine.frameRequest !== null) {
      cancelAnimationFrame(engine.frameRequest);
      engine.frameRequest = null;
    }
    engine.renderFrame(performance.now());
    iterations += 1;
    if (iterations > maximumIterations) {
      throw new Error("Impossibile finalizzare il tratto Light Glaze precedente.");
    }
  }
}

export function maybeReleaseIdleLightGlazeResources(engine: BrushEngine): void {
  if (
    !engine.initialized
    || !engine.lightGlazeStorageAllocated
    || usesStrokeGlazeRenderer(engine.settings)
    || engine.lightGlazeLoadingPromise !== null
    || engine.lightGlazeSession !== null
    || engine.activeStroke !== null
    || engine.historyBusy
    || engine.pendingStamps.length > 0
  ) {
    return;
  }
  destroyLightGlazeResources(engine);
  engine.publishStats();
}

export function requestLightGlazeResources(engine: BrushEngine, blendMode: BlendMode): void {
  void engine.ensureLightGlazeResources(blendMode).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Rendering glaze non disponibile: ${message}`, "error");
  });
}
