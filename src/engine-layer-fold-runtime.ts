import type {
  BrushEngine,
} from "./brush-engine";
import {
  runGpuAllocationTransaction,
} from "./gpu-allocation-transaction";
import {
  type LayerColdStorageResources,
  type LayerCompressedColdStorageResources,
  type LayerGpuResources,
  type MergedSurfaceResources,
} from "./engine-layer-resources";
import {
  decompressLayerColdChunk,
} from "./engine-cold-storage";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  LAYER_COMPOSITE_UNIFORM_BYTES,
} from "./engine-limits";
import {
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_WIDTH,
} from "./layer-storage-study";
import {
  type DirtyRect,
} from "./engine-stroke-types";
import {
  layerEffectRendererRequirements,
  type LayerRecord,
} from "./layer-stack";
import {
  LAYER_BLEND_MODE_CODES,
  type LayerBlendMode,
} from "./layer-blend-modes";
import {
  LAYER_BLEND_FOLD_TILE_EXTENT,
  LAYER_BLEND_FOLD_UNIFORM_BYTES,
} from "./layer-blend-fold-shader";
import {
  normalizeLayerRect,
} from "./engine-geometry";
import {
  intersectMergedSurfaceRects,
  mergedSurfacePhysicalRect,
} from "./merged-surface-bounds";
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
  combineCompressionHashes,
} from "./engine-math";
import {
  LAYER_COLD_TILE_COMPOSITE_BATCH_TILES,
} from "./layer-cold-tile-composite-shader";

function packLayerCompositeUniforms(
  upload: ArrayBuffer,
  byteOffset: number,
  destinationOrigin: { x: number; y: number },
  destinationScale: number,
  sourceOrigin: { x: number; y: number },
  sourceScale: number,
  sourceWidth: number,
  sourceHeight: number,
  opacity: number,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
): void {
  const f32 = new Float32Array(upload, byteOffset, LAYER_COMPOSITE_UNIFORM_BYTES / 4);
  const u32 = new Uint32Array(upload, byteOffset, LAYER_COMPOSITE_UNIFORM_BYTES / 4);
  f32[0] = destinationOrigin.x;
  f32[1] = destinationOrigin.y;
  f32[2] = destinationScale;
  f32[3] = opacity;
  f32[4] = sourceOrigin.x;
  f32[5] = sourceOrigin.y;
  f32[6] = sourceScale;
  u32[8] = sourceWidth;
  u32[9] = sourceHeight;
  u32[10] = LAYER_BLEND_MODE_CODES[blendMode];
  u32[11] = operator === "source-atop" ? 1 : 0;
}

function writeLayerCompositeUniforms(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  sourceOrigin: { x: number; y: number },
  sourceScale: number,
  sourceWidth: number,
  sourceHeight: number,
  opacity: number,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
): void {
  const upload = new ArrayBuffer(LAYER_COMPOSITE_UNIFORM_BYTES);
  packLayerCompositeUniforms(
    upload,
    0,
    destination.bounds,
    destination.resolutionScale,
    sourceOrigin,
    sourceScale,
    sourceWidth,
    sourceHeight,
    opacity,
    blendMode,
    operator,
  );
  engine.device.queue.writeBuffer(engine.layerCompositeUniformBuffer, 0, upload);
}

type LayerFoldCompositeOperator = "source-over" | "source-atop";

async function ensureLayerBlendFoldScratch(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  label: string,
): Promise<void> {
  if (
    destination.blendFoldBackdropScratchTexture
    && destination.blendFoldBackdropScratchView
    && destination.blendFoldScratchTexture
    && destination.blendFoldScratchView
    && destination.blendFoldUniformBuffer
    && destination.blendFoldUniformStride > 0
  ) {
    return;
  }
  releaseLayerBlendFoldScratch(destination);
  const tileWidth = Math.min(LAYER_BLEND_FOLD_TILE_EXTENT, destination.textureWidth);
  const tileHeight = Math.min(LAYER_BLEND_FOLD_TILE_EXTENT, destination.textureHeight);
  const uniformAlignment = engine.device.limits.minUniformBufferOffsetAlignment;
  const uniformStride = Math.ceil(
    LAYER_BLEND_FOLD_UNIFORM_BYTES / uniformAlignment,
  ) * uniformAlignment;
  const tileCapacity = Math.ceil(destination.textureWidth / tileWidth)
    * Math.ceil(destination.textureHeight / tileHeight);
  const scratch = await runGpuAllocationTransaction(
    engine.device,
    `${label} · scratch fusione tile ${tileWidth}×${tileHeight}`,
    (transaction) => {
      const backdropTexture = engine.device.createTexture({
        label:
          `Advanced layer blend backdrop tile ${tileWidth}×${tileHeight} `
          + engine.layerFormat,
        size: {
          width: tileWidth,
          height: tileHeight,
          depthOrArrayLayers: 1,
        },
        format: engine.layerFormat,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      transaction.deferRollback(() => backdropTexture.destroy());
      const outputTexture = engine.device.createTexture({
        label:
          `Advanced layer blend output tile ${tileWidth}×${tileHeight} `
          + engine.layerFormat,
        size: { width: tileWidth, height: tileHeight, depthOrArrayLayers: 1 },
        format: engine.layerFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      transaction.deferRollback(() => outputTexture.destroy());
      const uniformBuffer = engine.device.createBuffer({
        label: `Advanced layer blend tile uniforms ${tileCapacity}×${uniformStride} B`,
        size: tileCapacity * uniformStride,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => uniformBuffer.destroy());
      return {
        backdropTexture,
        backdropView: backdropTexture.createView({
          label: "Advanced layer blend backdrop tile view",
        }),
        outputTexture,
        outputView: outputTexture.createView({
          label: "Advanced layer blend output tile view",
        }),
        uniformBuffer,
      };
    },
  );
  destination.blendFoldBackdropScratchTexture = scratch.backdropTexture;
  destination.blendFoldBackdropScratchView = scratch.backdropView;
  destination.blendFoldScratchTexture = scratch.outputTexture;
  destination.blendFoldScratchView = scratch.outputView;
  destination.blendFoldUniformBuffer = scratch.uniformBuffer;
  destination.blendFoldUniformStride = uniformStride;
  destination.blendFoldTileWidth = tileWidth;
  destination.blendFoldTileHeight = tileHeight;
}

export function releaseLayerBlendFoldScratch(destination: MergedSurfaceResources): void {
  destination.blendFoldBackdropScratchTexture?.destroy();
  destination.blendFoldScratchTexture?.destroy();
  destination.blendFoldUniformBuffer?.destroy();
  destination.blendFoldBackdropScratchTexture = null;
  destination.blendFoldBackdropScratchView = null;
  destination.blendFoldScratchTexture = null;
  destination.blendFoldScratchView = null;
  destination.blendFoldUniformBuffer = null;
  destination.blendFoldUniformStride = 0;
  destination.blendFoldTileWidth = 0;
  destination.blendFoldTileHeight = 0;
}

type AuthoritativeColdTileCompositeSource = {
  recordId: number;
  gpu: LayerGpuResources;
  cold: LayerColdStorageResources | null;
  compressed: LayerCompressedColdStorageResources | null;
  nonTransparentBounds: DirtyRect;
};

export function authoritativeColdTileCompositeSource(
  engine: BrushEngine,
  record: LayerRecord,
  blendMode: LayerBlendMode,
): AuthoritativeColdTileCompositeSource | null {
  if (!engine.layerColdTileCompositeEnabled || blendMode !== "normal") {
    return null;
  }
  const gpu = engine.requireLayerGpu(record.id);
  if (gpu.hot || (gpu.bake && gpu.bakeValid)) {
    return null;
  }
  const cold = gpu.cold;
  const compressed = gpu.compressed;
  if (Boolean(cold) === Boolean(compressed)) {
    return null;
  }
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  if (requirements.needsStrokeRenderer) {
    return null;
  }
  const format = cold?.format ?? compressed?.format;
  if (format !== engine.layerFormat) {
    throw new Error(
      `Fold tile livello ${record.id}: formato ${format ?? "assente"} incompatibile con `
      + `${engine.layerFormat}.`,
    );
  }
  if (compressed) {
    const bytesPerPixel = compressed.format === "rgba16float" ? 8 : 4;
    const tileBytes = LAYER_STORAGE_TILE_WIDTH * LAYER_STORAGE_TILE_HEIGHT * bytesPerPixel;
    const chunksFitBoundedScratch = compressed.tileIndices.length > 0
      && compressed.chunks.length > 0
      && compressed.chunks.every((chunk) => (
        chunk.rawBytes > 0
        && chunk.rawBytes % tileBytes === 0
        && chunk.rawBytes <= LAYER_COLD_TILE_COMPOSITE_BATCH_TILES * tileBytes
      ));
    if (!chunksFitBoundedScratch) {
      return null;
    }
  }
  return {
    recordId: record.id,
    gpu,
    cold,
    compressed,
    nonTransparentBounds: normalizeLayerRect(record.contentBounds) ?? {
      x: 0,
      y: 0,
      width: DOCUMENT_WIDTH,
      height: DOCUMENT_HEIGHT,
    },
  };
}

function coldTileCompositeSourceIsCurrent(
  source: AuthoritativeColdTileCompositeSource,
): boolean {
  return source.gpu.hot === null
    && source.gpu.cold === source.cold
    && source.gpu.compressed === source.compressed;
}

function writeColdTileCompositeUniforms(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  opacity: number,
): void {
  if (
    destination.resolutionScale !== 1
    || destination.textureWidth !== destination.bounds.width
    || destination.textureHeight !== destination.bounds.height
    || !Number.isInteger(destination.bounds.x)
    || !Number.isInteger(destination.bounds.y)
  ) {
    throw new Error("Il fold cold tile richiede una superficie mip0 1:1 intera.");
  }
  const upload = new ArrayBuffer(32);
  const i32 = new Int32Array(upload);
  const u32 = new Uint32Array(upload);
  const f32 = new Float32Array(upload);
  i32[0] = destination.bounds.x;
  i32[1] = destination.bounds.y;
  u32[2] = destination.textureWidth;
  u32[3] = destination.textureHeight;
  f32[4] = Math.min(1, Math.max(0, opacity));
  engine.device.queue.writeBuffer(engine.layerColdTileCompositeUniformBuffer, 0, upload);
}

export async function foldAuthoritativeColdTilesIntoMergedSurface(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  source: AuthoritativeColdTileCompositeSource,
  opacity: number,
  operator: LayerFoldCompositeOperator,
  clearDestination: boolean,
  documentRect: DirtyRect,
  label: string,
): Promise<void> {
  writeColdTileCompositeUniforms(engine, destination, opacity);
  if (!coldTileCompositeSourceIsCurrent(source)) {
    throw new Error(`Fold tile livello ${source.recordId}: sorgente diventata stale.`);
  }

  let submitted = false;
  let completed = false;
  let submissionCount = 0;
  const submitBatch = (
    sourceView: GPUTextureView,
    tileIndices: readonly number[],
    clear: boolean,
    batchLabel: string,
  ): void => {
    if (tileIndices.length < 1 || tileIndices.length > LAYER_STORAGE_TILE_COUNT) {
      throw new RangeError(`${batchLabel}: conteggio tile ${tileIndices.length} non valido.`);
    }
    engine.device.queue.writeBuffer(
      engine.layerColdTileCompositeIndicesBuffer,
      0,
      new Uint32Array(tileIndices),
    );
    const bindGroup = engine.device.createBindGroup({
      label: batchLabel,
      layout: engine.layerColdTileCompositeBindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: { buffer: engine.layerColdTileCompositeIndicesBuffer } },
        { binding: 2, resource: { buffer: engine.layerColdTileCompositeUniformBuffer } },
      ],
    });
    const encoder = engine.device.createCommandEncoder({ label: batchLabel });
    const pass = encoder.beginRenderPass({
      label: batchLabel,
      colorAttachments: [{
        view: destination.mipViews[0],
        loadOp: clear ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(
      operator === "source-atop"
        ? engine.layerColdTileSourceAtopPipeline
        : engine.layerColdTileCompositePipeline,
    );
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, tileIndices.length, 0, 0);
    pass.end();
    engine.device.queue.submit([encoder.finish()]);
    submitted = true;
    submissionCount += 1;
  };

  let scratchTexture: GPUTexture | null = null;
  let scratchBytes = 0;
  let foldedTileCount = 0;
  try {
    if (source.cold) {
      const cold = source.cold;
      submitBatch(
        cold.texture.createView({
          label: `${label} · cold array view`,
          dimension: "2d-array",
          baseArrayLayer: 0,
          arrayLayerCount: cold.tileIndices.length,
        }),
        cold.tileIndices,
        clearDestination,
        label,
      );
      foldedTileCount = cold.tileIndices.length;
    } else {
      const compressed = source.compressed!;
      const bytesPerPixel = compressed.format === "rgba16float" ? 8 : 4;
      const tileBytes = LAYER_STORAGE_TILE_WIDTH * LAYER_STORAGE_TILE_HEIGHT * bytesPerPixel;
      const chunkTileCounts = compressed.chunks.map((chunk, index) => {
        if (
          chunk.rawBytes <= 0
          || chunk.rawBytes % tileBytes !== 0
          || chunk.rawBytes / tileBytes > LAYER_STORAGE_TILE_COUNT
        ) {
          throw new Error(`Fold tile livello ${source.recordId}: chunk ${index} non valido.`);
        }
        return chunk.rawBytes / tileBytes;
      });
      const scratchLayerCount = Math.min(
        compressed.tileIndices.length,
        Math.max(LAYER_COLD_TILE_COMPOSITE_BATCH_TILES, ...chunkTileCounts),
      );
      scratchBytes = scratchLayerCount * tileBytes;
      scratchTexture = engine.device.createTexture({
        label: `Scratch direct cold tile composite livello ${source.recordId}`,
        size: {
          width: LAYER_STORAGE_TILE_WIDTH,
          height: LAYER_STORAGE_TILE_HEIGHT,
          depthOrArrayLayers: scratchLayerCount,
        },
        format: compressed.format,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      engine.layerColdTileCompositeScratchActiveBytes += scratchBytes;
      engine.layerColdTileCompositeScratchPeakBytes = Math.max(
        engine.layerColdTileCompositeScratchPeakBytes,
        engine.layerColdTileCompositeScratchActiveBytes,
      );
      const scratchView = scratchTexture.createView({
        label: `${label} · scratch array view`,
        dimension: "2d-array",
        baseArrayLayer: 0,
        arrayLayerCount: scratchLayerCount,
      });
      let chunkIndex = 0;
      let firstTile = 0;
      let restoredBytes = 0;
      let restoredHash = 0x811c9dc5;
      let clear = clearDestination;
      while (chunkIndex < compressed.chunks.length) {
        const batchIndices: number[] = [];
        const uploads: Array<{ bytes: Uint8Array; arrayLayer: number; tileCount: number }> = [];
        while (chunkIndex < compressed.chunks.length) {
          const chunk = compressed.chunks[chunkIndex];
          const chunkTileCount = chunkTileCounts[chunkIndex];
          if (batchIndices.length > 0 && batchIndices.length + chunkTileCount > scratchLayerCount) {
            break;
          }
          const restored = await decompressLayerColdChunk(engine, chunk);
          if (
            !coldTileCompositeSourceIsCurrent(source)
            || restored.byteLength !== chunk.rawBytes
            || firstTile + chunkTileCount > compressed.tileIndices.length
          ) {
            throw new Error(`Fold tile livello ${source.recordId}: chunk diventato stale.`);
          }
          uploads.push({
            bytes: restored,
            arrayLayer: batchIndices.length,
            tileCount: chunkTileCount,
          });
          batchIndices.push(
            ...compressed.tileIndices.slice(firstTile, firstTile + chunkTileCount),
          );
          firstTile += chunkTileCount;
          restoredBytes += restored.byteLength;
          restoredHash = combineCompressionHashes(
            restoredHash,
            chunk.sourceHash,
            restored.byteLength,
          );
          chunkIndex += 1;
        }
        for (const upload of uploads) {
          engine.device.queue.writeTexture(
            { texture: scratchTexture, origin: { x: 0, y: 0, z: upload.arrayLayer } },
            upload.bytes,
            {
              bytesPerRow: LAYER_STORAGE_TILE_WIDTH * bytesPerPixel,
              rowsPerImage: LAYER_STORAGE_TILE_HEIGHT,
            },
            {
              width: LAYER_STORAGE_TILE_WIDTH,
              height: LAYER_STORAGE_TILE_HEIGHT,
              depthOrArrayLayers: upload.tileCount,
            },
          );
        }
        submitBatch(
          scratchView,
          batchIndices,
          clear,
          `${label} · batch ${submissionCount + 1}`,
        );
        clear = false;
      }
      if (
        !coldTileCompositeSourceIsCurrent(source)
        || firstTile !== compressed.tileIndices.length
        || restoredBytes !== compressed.rawBytes
        || restoredHash !== compressed.sourceHash
      ) {
        throw new Error(`Fold tile livello ${source.recordId}: integrità aggregata non valida.`);
      }
      foldedTileCount = firstTile;
    }
    await engine.waitForGpuCapped(label);
    completed = true;
    if (!coldTileCompositeSourceIsCurrent(source)) {
      throw new Error(`Fold tile livello ${source.recordId}: autorità cambiata dopo il submit.`);
    }
    destination.foldedPixels += documentRect.width * documentRect.height;
    engine.layerColdTileCompositeFoldCount += 1;
    engine.layerColdTileCompositeResidentFoldCount += source.cold ? 1 : 0;
    engine.layerColdTileCompositeCompressedFoldCount += source.compressed ? 1 : 0;
    engine.layerColdTileCompositeTileCount += foldedTileCount;
    engine.layerColdTileCompositeSubmissionCount += submissionCount;
    engine.layerColdTileCompositeAvoidedHydrationBytes += DOCUMENT_WIDTH * DOCUMENT_HEIGHT
      * (engine.layerFormat === "rgba16float" ? 8 : 4);
  } finally {
    if (submitted && !completed) {
      try {
        await engine.waitForGpuCapped(`${label} · drain rollback`);
      } catch {
        // Device-loss/timeout already makes the render path unusable. Resource
        // destruction below is still the only safe local cleanup available.
      }
    }
    scratchTexture?.destroy();
    engine.layerColdTileCompositeScratchActiveBytes = Math.max(
      0,
      engine.layerColdTileCompositeScratchActiveBytes - scratchBytes,
    );
  }
}

export async function tryFoldAuthoritativeColdTilesIntoMergedSurface(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  record: LayerRecord,
  opacity: number,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
  clearDestination: boolean,
  label: string,
): Promise<boolean | null> {
  if (destination.resolutionScale !== 1) {
    return null;
  }
  const source = authoritativeColdTileCompositeSource(engine, record, blendMode);
  if (!source) {
    return null;
  }
  const rect = intersectMergedSurfaceRects(
    source.nonTransparentBounds,
    destination.bounds,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!rect) {
    return false;
  }
  await foldAuthoritativeColdTilesIntoMergedSurface(
    engine,
    destination,
    source,
    opacity,
    operator,
    clearDestination,
    rect,
    label,
  );
  return true;
}

export async function foldViewIntoMergedSurface(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  sourceView: GPUTextureView,
  sourceOrigin: { x: number; y: number },
  sourceScale: number,
  sourceWidth: number,
  sourceHeight: number,
  opacity: number,
  documentRect: DirtyRect,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
  clearDestination: boolean,
  label: string,
): Promise<void> {
  const clipped = intersectMergedSurfaceRects(
    documentRect,
    destination.bounds,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!clipped) {
    return;
  }
  const physicalRect = mergedSurfacePhysicalRect(
    clipped,
    destination.bounds,
    destination.resolutionScale,
  );
  if (blendMode === "normal") {
    // Preserve the original single-pass fixed-function path exactly. It is
    // faster, associative, and does not require a backdrop texture or scratch.
    writeLayerCompositeUniforms(
      engine,
      destination,
      sourceOrigin,
      sourceScale,
      sourceWidth,
      sourceHeight,
      opacity,
      blendMode,
      operator,
    );
    const encoder = engine.device.createCommandEncoder({ label });
    const bindGroup = engine.device.createBindGroup({
      label,
      layout: engine.layerCompositeBindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: { buffer: engine.layerCompositeUniformBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: destination.mipViews[0],
        loadOp: clearDestination ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(
      operator === "source-atop"
        ? engine.layerSourceAtopPipeline
        : engine.layerCompositePipeline,
    );
    pass.setBindGroup(0, bindGroup);
    pass.setScissorRect(
      physicalRect.x,
      physicalRect.y,
      physicalRect.width,
      physicalRect.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
    engine.device.queue.submit([encoder.finish()]);
  } else {
    await ensureLayerBlendFoldScratch(engine, destination, label);
    const backdropScratchTexture = destination.blendFoldBackdropScratchTexture!;
    const backdropScratchView = destination.blendFoldBackdropScratchView!;
    const outputScratchTexture = destination.blendFoldScratchTexture!;
    const outputScratchView = destination.blendFoldScratchView!;
    const uniformBuffer = destination.blendFoldUniformBuffer!;
    const uniformStride = destination.blendFoldUniformStride;
    const tiles: DirtyRect[] = [];
    const maximumY = physicalRect.y + physicalRect.height;
    const maximumX = physicalRect.x + physicalRect.width;
    for (
      let y = physicalRect.y;
      y < maximumY;
      y += destination.blendFoldTileHeight
    ) {
      for (
        let x = physicalRect.x;
        x < maximumX;
        x += destination.blendFoldTileWidth
      ) {
        tiles.push({
          x,
          y,
          width: Math.min(destination.blendFoldTileWidth, maximumX - x),
          height: Math.min(destination.blendFoldTileHeight, maximumY - y),
        });
      }
    }
    const uniformUpload = new ArrayBuffer(tiles.length * uniformStride);
    tiles.forEach((tile, index) => {
      packLayerCompositeUniforms(
        uniformUpload,
        index * uniformStride,
        {
          x: destination.bounds.x + tile.x / destination.resolutionScale,
          y: destination.bounds.y + tile.y / destination.resolutionScale,
        },
        destination.resolutionScale,
        sourceOrigin,
        sourceScale,
        sourceWidth,
        sourceHeight,
        opacity,
        blendMode,
        operator,
      );
    });
    engine.device.queue.writeBuffer(uniformBuffer, 0, uniformUpload);
    const bindGroup = engine.device.createBindGroup({
      label: `${label} · advanced tile backdrop/source`,
      layout: engine.layerBlendFoldBindGroupLayout,
      entries: [
        { binding: 0, resource: backdropScratchView },
        { binding: 1, resource: sourceView },
        {
          binding: 2,
          resource: {
            buffer: uniformBuffer,
            offset: 0,
            size: LAYER_BLEND_FOLD_UNIFORM_BYTES,
          },
        },
      ],
    });
    const encoder = engine.device.createCommandEncoder({ label });
    if (clearDestination) {
      // The advanced shader samples the canonical destination. Match the old
      // first-fold clear semantics before exposing it as the backdrop.
      const clearPass = encoder.beginRenderPass({
        label: `${label} · clear canonical backdrop`,
        colorAttachments: [{
          view: destination.mipViews[0],
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      clearPass.end();
    }
    tiles.forEach((tile, tileIndex) => {
      encoder.copyTextureToTexture(
        {
          texture: destination.texture,
          mipLevel: 0,
          origin: { x: tile.x, y: tile.y, z: 0 },
        },
        {
          texture: backdropScratchTexture,
          origin: { x: 0, y: 0, z: 0 },
        },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      );
      const pass = encoder.beginRenderPass({
        label: `${label} · advanced tile ${tileIndex + 1}/${tiles.length}`,
        colorAttachments: [{
          view: outputScratchView,
          // Initialize the reusable attachment once; every copied pixel is
          // then overwritten by the fullscreen triangle.
          loadOp: tileIndex === 0 ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(engine.layerBlendFoldPipeline);
      pass.setBindGroup(0, bindGroup, [tileIndex * uniformStride]);
      pass.setScissorRect(0, 0, tile.width, tile.height);
      pass.draw(3, 1, 0, 0);
      pass.end();
      encoder.copyTextureToTexture(
        { texture: outputScratchTexture, origin: { x: 0, y: 0, z: 0 } },
        {
          texture: destination.texture,
          mipLevel: 0,
          origin: { x: tile.x, y: tile.y, z: 0 },
        },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      );
    });
    engine.device.queue.submit([encoder.finish()]);
  }
  await engine.waitForGpuCapped(label);
  destination.foldedPixels += physicalRect.width * physicalRect.height;
}
