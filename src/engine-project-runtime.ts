import type { BrushEngine } from "./brush-engine";
import {
  coldStorageMaskForRecord,
  compressColdStorageResources,
  createColdLayerGpuResources,
  createHydratedLayerTexture,
  createLayerColdStorageCandidate,
  decompressLayerColdChunk,
  destroyLayerColdStorage,
  uploadCompressedLayerIntoHot,
} from "./engine-cold-storage";
import type {
  LayerCompressedColdStorageResources,
  LayerGpuResources,
  LayerTextureResources,
  RestoredProjectHistoryBaseline,
} from "./engine-layer-resources";
import {
  allocateLayerGpuResources,
  destroyLayerGpuResources,
  layerNeedsBackdropComposition,
  recreateLayerResources,
} from "./engine-layer-runtime";
import { ensureLayerBlendTilePresentationResources } from "./engine-layer-blend-tile-runtime";
import {
  destroyActiveCloneStrokeSession,
  releasePreparedCloneSourceAndWait,
} from "./engine-clone-runtime";
import { destroyLightGlazeResources } from "./engine-glaze-runtime";
import { resetPixelSelectionState } from "./engine-selection-runtime";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_TILE_HEIGHT,
  DOCUMENT_TILE_WIDTH,
  DOCUMENT_WIDTH,
  reconfigureDocumentDimensions,
  validateDocumentDimensions,
} from "./engine-limits";
import { combineCompressionHashes, hashBytes } from "./engine-math";
import { rgba8UnormToRgba16FloatBytes } from "./float16";
import type { LayerRecord, LayerStackState } from "./layer-stack";
import { MixedSceneStack } from "./mixed-scene-stack";
import type { LayerColdCompressedChunk } from "./layer-cold-compression-client";
import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_STORAGE_TILE_GRID_SIZE,
  PROJECT_STORAGE_TILE_MASK_WORDS,
  type ProjectChunkWriteV1,
  type ProjectLayerPixelsV1,
  type ProjectLayerV1,
  type ProjectLoadResultV1,
  type ProjectSnapshotV1,
} from "./project-storage";
import {
  installRasterLayerSourceResource,
  type RasterImageGpuResource,
} from "./engine-raster-image-runtime";
import { cloneRasterLayerSource } from "./raster-layer-source";
import { normalizeRasterColorOverlayStyle } from "./raster-color-overlay-core";
import { normalizeDocumentBackground } from "./document-background";
import { ensureMixedScenePresentationResources } from "./mixed-scene-presentation-resources";
import {
  prewarmMixedSceneClippingScratch,
  prewarmMixedSceneLinearTextureForLayerBlend,
} from "./engine-vector-text-runtime";
import {
  cloneLayerTonalBlend,
  DEFAULT_LAYER_CONTENT_OPACITY,
  DEFAULT_LAYER_CUTOUT_MODE,
  DEFAULT_LAYER_TONAL_BLEND,
  normalizeLayerContentOpacity,
  normalizeLayerCutoutMode,
  normalizeLayerTonalBlend,
} from "./layer-composition.ts";

export interface CapturedProjectDocumentV1 {
  readonly snapshot: ProjectSnapshotV1;
  readonly chunks: readonly ProjectChunkWriteV1[];
}

const DOCUMENT_RESET_WAIT_TIMEOUT_MS = 65_000;

/**
 * Fill/content opacity is part of the validated RGBA8 layer-composition path.
 * Only the separate raster-style renderers remain gated during project restore.
 */
function rasterLayerHasUnvalidatedEffects(record: Readonly<LayerRecord>): boolean {
  return record.strokeStyle.enabled
    || record.bevelStyle.enabled
    || record.outerShadowStyle.enabled
    || record.innerShadowStyle.enabled
    || record.colorOverlayStyle.enabled;
}

interface FreshProjectResetOptions {
  /** The cross-size owner already holds exactly one presentation freeze. */
  readonly parentPresentationTransactionActive?: boolean;
  /** Keep idle-release workers gated until a cross-size rebuild has published. */
  readonly retainLayerSwitchBusyOnSuccess?: boolean;
}

function assertFreshProjectResetAllowed(
  engine: BrushEngine,
  options: FreshProjectResetOptions,
): void {
  if (!engine.initialized) {
    throw new Error("The editor is not ready yet.");
  }
  if (engine.deviceLostError) {
    throw engine.deviceLostError;
  }
  if (engine.historyStateInconsistent) {
    throw new Error("The current document is inconsistent and must be reloaded.");
  }
  const expectedPresentationDepth = options.parentPresentationTransactionActive === true ? 1 : 0;
  if (engine.presentationTransactionDepth !== expectedPresentationDepth) {
    throw new Error("Another document presentation transaction is already active.");
  }
  engine.assertLayerSwitchAllowed();
}

async function waitForDocumentScopedPreparation(engine: BrushEngine): Promise<void> {
  while (engine.fillRendererLoadingPromise) {
    await engine.fillRendererLoadingPromise;
  }
  while (engine.selectionRendererLoadingPromise) {
    await engine.selectionRendererLoadingPromise;
  }
  while (engine.layerBlendTileResourcesPromise) {
    await engine.layerBlendTileResourcesPromise;
  }
  await engine.fillRenderer?.waitForPrewarm();
  await releasePreparedCloneSourceAndWait(engine);
}

async function waitForColdCompressionCancellation(engine: BrushEngine): Promise<void> {
  const startedAt = performance.now();
  while (engine.layerColdCompressionJobRunning) {
    if (engine.deviceLostError) throw engine.deviceLostError;
    if (performance.now() - startedAt > DOCUMENT_RESET_WAIT_TIMEOUT_MS) {
      throw new Error("The outgoing document compression did not stop in time.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}

function clearHotLayerForFreshProject(
  engine: BrushEngine,
  hot: LayerTextureResources,
): void {
  const encoder = engine.device.createCommandEncoder({
    label: "Clear reusable layer for project switch",
  });
  const pass = encoder.beginRenderPass({
    label: "Clear reusable project layer",
    colorAttachments: [{
      view: hot.view,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  pass.end();
  engine.device.queue.submit([encoder.finish()]);
}

function resetDocumentScopedTransientState(engine: BrushEngine): void {
  if (engine.frameRequest !== null) {
    cancelAnimationFrame(engine.frameRequest);
    engine.frameRequest = null;
  }
  engine.pendingStamps.length = 0;
  engine.pendingBlendBatches.length = 0;
  engine.activeStroke = null;
  engine.deferredStrokePreview = null;
  engine.straightLineAdjustment = null;
  engine.lastDeferredLiftReplay = null;
  destroyActiveCloneStrokeSession(engine);
  destroyLightGlazeResources(engine);
  engine.destroyThicknessTailOverlayResources();
  engine.invalidateAdaptivePreview();

  if (engine.fillScratchReleaseTimer !== null) {
    window.clearTimeout(engine.fillScratchReleaseTimer);
    engine.fillScratchReleaseTimer = null;
  }
  engine.fillRenderer?.releaseScratch();
  engine.blendRenderer?.releaseScratch();

  engine.selectionRenderer?.clearSelection();
  resetPixelSelectionState(engine);
  engine.clearVectorTextPresentation(undefined, true);
  engine.vectorTextPreviewExcludedNodeId = null;
  engine.shapePreviewAfterKey = null;
  engine.shapePreviewVisible = false;
  engine.shapePreviewBounds = null;
  engine.semanticPresentationDirtyRect = null;
  engine.vectorTextFastPresentationLatestRequested = false;
  engine.vectorTextFastRequestedRevision = 0;
  engine.vectorTextFastSubmittedRevision = 0;
  engine.vectorTextFastCompletedRevision = 0;
  engine.paintDisplayMipValidThroughLevel = 0;
  engine.paintDisplayPyramidContent = "active-only";
  engine.paintDisplaySelectedMipLevel = 0;
  engine.clearRequested = false;
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
}

function cloneBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function copyCompressedResources(
  compressed: LayerCompressedColdStorageResources,
): LayerCompressedColdStorageResources {
  return {
    ...compressed,
    tileIndices: [...compressed.tileIndices],
    chunks: compressed.chunks.map((chunk) => ({
      ...chunk,
      bytes: cloneBuffer(chunk.bytes),
    })),
  };
}

function projectPixelsFromCompressed(
  layerId: number,
  compressed: LayerCompressedColdStorageResources,
): { pixels: ProjectLayerPixelsV1; writes: ProjectChunkWriteV1[] } {
  const bytesPerPixel = compressed.format === "rgba16float" ? 8 : 4;
  const tileBytes = DOCUMENT_TILE_WIDTH * DOCUMENT_TILE_HEIGHT * bytesPerPixel;
  let firstTileOffset = 0;
  const writes: ProjectChunkWriteV1[] = [];
  const chunks = compressed.chunks.map((chunk, chunkIndex) => {
    if (chunk.rawBytes % tileBytes !== 0) {
      throw new Error(`Project chunk ${layerId}:${chunkIndex} is not tile-aligned.`);
    }
    const tileCount = chunk.rawBytes / tileBytes;
    const descriptor = {
      schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
      chunkIndex,
      firstTileOffset,
      tileCount,
      storage: chunk.storage,
      rawBytes: chunk.rawBytes,
      storedBytes: chunk.storedBytes,
      sourceHash: chunk.sourceHash,
    } as const;
    firstTileOffset += tileCount;
    writes.push({
      schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
      layerId,
      chunkIndex,
      storage: chunk.storage,
      rawBytes: chunk.rawBytes,
      storedBytes: chunk.storedBytes,
      sourceHash: chunk.sourceHash,
      bytes: cloneBuffer(chunk.bytes),
    });
    return descriptor;
  });
  if (firstTileOffset !== compressed.tileIndices.length) {
    throw new Error(
      `Project layer ${layerId} describes ${firstTileOffset} tiles, expected `
      + `${compressed.tileIndices.length}.`,
    );
  }
  return {
    pixels: {
      schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
      format: compressed.format,
      tileIndices: [...compressed.tileIndices],
      chunks,
      rawBytes: compressed.rawBytes,
      storedBytes: compressed.storedBytes,
      sourceHash: compressed.sourceHash,
      generation: compressed.generation,
    },
    writes,
  };
}

function projectStorageMaskForTileIndices(
  tileIndices: readonly number[],
): Uint32Array {
  const mask = new Uint32Array(PROJECT_STORAGE_TILE_MASK_WORDS);
  const tileCount = PROJECT_STORAGE_TILE_GRID_SIZE ** 2;
  for (const tileIndex of tileIndices) {
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= tileCount) {
      throw new Error(`Project pixel tile ${tileIndex} is outside the storage grid.`);
    }
    mask[tileIndex >>> 5] |= (1 << (tileIndex & 31)) >>> 0;
  }
  return mask;
}

async function captureLayerCompressed(
  engine: BrushEngine,
  record: LayerRecord,
  gpu: LayerGpuResources,
): Promise<LayerCompressedColdStorageResources> {
  if (gpu.compressed) return copyCompressedResources(gpu.compressed);
  if (gpu.cold) {
    return compressColdStorageResources(
      engine,
      gpu.cold,
      `Save project layer ${record.id}`,
    );
  }
  if (!gpu.hot) {
    throw new Error(`Layer ${record.id} has content but no authoritative pixel storage.`);
  }
  // Both durable inactive forms returned above, so this transient save seed is
  // the first generation derived from the live hot texture.
  const generation = 1;
  const candidate = await createLayerColdStorageCandidate(
    engine,
    record,
    gpu.hot,
    coldStorageMaskForRecord(record),
    generation,
    "history",
  );
  try {
    return await compressColdStorageResources(
      engine,
      candidate,
      `Save project layer ${record.id}`,
    );
  } finally {
    destroyLayerColdStorage(candidate);
  }
}

function projectLayerMetadata(
  engine: BrushEngine,
  record: LayerRecord,
  pixels: ProjectLayerPixelsV1 | null,
): ProjectLayerV1 {
  const source = record.rasterSource;
  const sourceResource = source
    ? engine.rasterImageGpuResources.get(source.document.assetId)
    : null;
  if (source && !sourceResource) {
    throw new Error(`Immutable raster source ${source.document.assetId} is unavailable.`);
  }
  return {
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    id: record.id,
    name: record.name,
    visible: record.visible,
    opacity: record.opacity,
    contentOpacity: record.contentOpacity,
    blendMode: record.blendMode,
    cutoutMode: record.cutoutMode,
    tonalBlend: cloneLayerTonalBlend(record.tonalBlend),
    clippingParentId: record.clippingParentId,
    contentBounds: record.contentBounds ? { ...record.contentBounds } : null,
    // Cold capture may conservatively add tiles covered by contentBounds even
    // when the live mutation mask is sparser (common for rasterized outlines).
    // Persist the exact compressed payload mask so manifest metadata and chunk
    // tileIndices remain a single coherent source of truth on save and reload.
    storageTileMask: pixels
      ? projectStorageMaskForTileIndices(pixels.tileIndices)
      : record.storageTileMask.slice(),
    hasContent: record.hasContent,
    noiseMipSmoothing: record.noiseMipSmoothing,
    rasterSource: source && sourceResource
      ? {
        schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
        assetId: source.document.assetId,
        sourceName: source.document.sourceName,
        mimeType: source.document.mimeType,
        sourceBytes: source.document.sourceBytes,
        width: source.document.width,
        height: source.document.height,
        x: source.x,
        y: source.y,
        scale: source.scale,
        rotation: source.rotation,
        blob: sourceResource.sourceBlob,
      }
      : null,
    strokeStyle: structuredClone(record.strokeStyle),
    bevelStyle: structuredClone(record.bevelStyle),
    outerShadowStyle: structuredClone(record.outerShadowStyle),
    innerShadowStyle: structuredClone(record.innerShadowStyle),
    colorOverlayStyle: structuredClone(record.colorOverlayStyle),
    pixels,
  };
}

/**
 * Captures every durable document concern while the engine is quiescent.
 * History is intentionally omitted: it is a session cache, not recovery data.
 */
export async function captureProjectDocument(
  engine: BrushEngine,
): Promise<CapturedProjectDocumentV1> {
  if (!engine.initialized) throw new Error("The editor is not ready yet.");
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  try {
    await engine.waitForIdle();
    while (engine.layerColdCompressionJobRunning) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    engine.persistActiveLayerState();
    const layers: ProjectLayerV1[] = [];
    const chunks: ProjectChunkWriteV1[] = [];
    for (const record of engine.layerStack.layers) {
      if (!record.hasContent) {
        layers.push(projectLayerMetadata(engine, record, null));
        continue;
      }
      const compressed = await captureLayerCompressed(
        engine,
        record,
        engine.requireLayerGpu(record.id),
      );
      const captured = projectPixelsFromCompressed(record.id, compressed);
      layers.push(projectLayerMetadata(engine, record, captured.pixels));
      chunks.push(...captured.writes);
    }

    const mixedScene = engine.mixedSceneStack?.captureState();
    if (!mixedScene) {
      throw new Error("The project scene is unavailable in this editor mode.");
    }
    return {
      snapshot: {
        schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
        document: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          width: DOCUMENT_WIDTH,
          height: DOCUMENT_HEIGHT,
          layerFormat: engine.layerFormat,
          tileGridSize: PROJECT_STORAGE_TILE_GRID_SIZE,
          colorSpace: engine.documentStorageColorSpace,
        },
        layers,
        activeRasterLayerId: engine.layerStack.active.id,
        referenceRasterLayerId: engine.layerStack.referenceLayerId,
        mixedScene: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          ...mixedScene,
        },
        view: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          centerX: engine.viewCenterX,
          centerY: engine.viewCenterY,
          zoom: engine.zoom,
          rotationRadians: engine.viewRotation,
        },
        background: {
          schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
          ...engine.documentBackground,
        },
        brushSettings: structuredClone(engine.getSettings()),
      },
      chunks,
    };
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
  }
}

function layerRecordFromProject(layer: ProjectLayerV1): LayerRecord {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    contentOpacity: normalizeLayerContentOpacity(
      layer.contentOpacity ?? DEFAULT_LAYER_CONTENT_OPACITY,
    ),
    blendMode: layer.blendMode,
    cutoutMode: normalizeLayerCutoutMode(
      layer.cutoutMode ?? DEFAULT_LAYER_CUTOUT_MODE,
    ),
    tonalBlend: normalizeLayerTonalBlend(
      layer.tonalBlend ?? DEFAULT_LAYER_TONAL_BLEND,
    ),
    clippingParentId: layer.clippingParentId,
    contentBounds: layer.contentBounds ? { ...layer.contentBounds } : null,
    storageTileMask: layer.storageTileMask.slice(),
    hasContent: layer.hasContent,
    noiseMipSmoothing: layer.noiseMipSmoothing,
    rasterSource: layer.rasterSource
      ? {
        document: {
          assetId: layer.rasterSource.assetId,
          sourceName: layer.rasterSource.sourceName,
          mimeType: layer.rasterSource.mimeType,
          sourceBytes: layer.rasterSource.sourceBytes,
          width: layer.rasterSource.width,
          height: layer.rasterSource.height,
        },
        x: layer.rasterSource.x,
        y: layer.rasterSource.y,
        scale: layer.rasterSource.scale,
        rotation: layer.rasterSource.rotation,
      }
      : null,
    strokeStyle: structuredClone(layer.strokeStyle),
    bevelStyle: structuredClone(layer.bevelStyle),
    outerShadowStyle: structuredClone(layer.outerShadowStyle),
    innerShadowStyle: structuredClone(layer.innerShadowStyle),
    // Projects written before uniform-alpha mode do not carry that field.
    colorOverlayStyle: normalizeRasterColorOverlayStyle(layer.colorOverlayStyle),
  };
}

async function compressedFromProject(
  engine: BrushEngine,
  layer: ProjectLayerV1,
  storedChunksByIndex: ReadonlyMap<
    number,
    ProjectLoadResultV1["chunks"][number]
  >,
): Promise<LayerCompressedColdStorageResources | null> {
  const pixels = layer.pixels;
  if (!pixels) return null;
  const chunks: LayerColdCompressedChunk[] = pixels.chunks.map((descriptor) => {
    const stored = storedChunksByIndex.get(descriptor.chunkIndex);
    if (!stored) {
      throw new Error(`Saved chunk ${layer.id}:${descriptor.chunkIndex} is missing.`);
    }
    return {
      storage: stored.storage,
      // IndexedDB already returns an isolated structured clone, and the
      // decompressor never detaches or mutates it. Share that immutable payload
      // with cold storage instead of copying every raster byte on the UI thread.
      bytes: stored.bytes,
      rawBytes: stored.rawBytes,
      storedBytes: stored.storedBytes,
      sourceHash: stored.sourceHash,
    };
  });
  const persisted: LayerCompressedColdStorageResources = {
    tileIndices: [...pixels.tileIndices],
    chunks,
    rawBytes: pixels.rawBytes,
    storedBytes: pixels.storedBytes,
    sourceHash: pixels.sourceHash,
    generation: pixels.generation,
    encodeMs: 0,
    format: pixels.format,
  };
  if (pixels.format === engine.layerFormat) return persisted;
  if (pixels.format !== "rgba8unorm" || engine.layerFormat !== "rgba16float") {
    throw new Error(
      "Saved " + pixels.format + " pixels cannot be opened as " + engine.layerFormat + ".",
    );
  }

  // Legacy V1 projects could persist linear-premultiplied RGBA8 tiles. Convert
  // one compressed chunk at a time, then recompress it immediately: the old
  // project remains untouched and migration never needs a second full document.
  const migratedChunks: LayerColdCompressedChunk[] = [];
  const targetTileBytes = DOCUMENT_TILE_WIDTH * DOCUMENT_TILE_HEIGHT * 8;
  let sourceBytes = 0;
  let sourceAggregateHash = 0x811c9dc5;
  let migratedRawBytes = 0;
  let migratedStoredBytes = 0;
  let migratedAggregateHash = 0x811c9dc5;
  let compressionClient: Awaited<
    ReturnType<BrushEngine["requireLayerColdCompressionClient"]>
  > | null = null;
  for (const chunk of persisted.chunks) {
    const restored = await decompressLayerColdChunk(engine, chunk);
    sourceBytes += restored.byteLength;
    sourceAggregateHash = combineCompressionHashes(
      sourceAggregateHash,
      chunk.sourceHash,
      restored.byteLength,
    );
    const converted = rgba8UnormToRgba16FloatBytes(restored);
    let migrated: LayerColdCompressedChunk;
    try {
      compressionClient ??= await engine.requireLayerColdCompressionClient(true);
      migrated = (await compressionClient.compress(converted, targetTileBytes, 2)).chunk;
    } catch {
      // A missing compression worker must not make a readable legacy project
      // unusable. Keeping this one converted chunk raw is a bounded fallback.
      const fallback = rgba8UnormToRgba16FloatBytes(restored);
      migrated = {
        storage: "raw",
        bytes: fallback.buffer,
        rawBytes: fallback.byteLength,
        storedBytes: fallback.byteLength,
        sourceHash: hashBytes(fallback),
      };
      compressionClient = null;
    }
    migratedChunks.push(migrated);
    migratedRawBytes += migrated.rawBytes;
    migratedStoredBytes += migrated.storedBytes;
    migratedAggregateHash = combineCompressionHashes(
      migratedAggregateHash,
      migrated.sourceHash,
      migrated.rawBytes,
    );
  }
  if (
    sourceBytes !== persisted.rawBytes
    || sourceAggregateHash !== persisted.sourceHash
  ) {
    throw new Error(
      "Saved layer " + layer.id + " failed legacy RGBA8 integrity checks.",
    );
  }
  return {
    tileIndices: persisted.tileIndices,
    chunks: migratedChunks,
    rawBytes: migratedRawBytes,
    storedBytes: migratedStoredBytes,
    sourceHash: migratedAggregateHash,
    generation: persisted.generation,
    encodeMs: 0,
    format: "rgba16float",
  };
}

async function promotePersistedLayer(
  engine: BrushEngine,
  record: LayerRecord,
  gpu: LayerGpuResources,
  reusableBlankHot: LayerTextureResources | null,
): Promise<LayerTextureResources> {
  if (reusableBlankHot) {
    if (record.hasContent) {
      const compressed = gpu.compressed;
      if (!compressed) throw new Error(`Layer ${record.id} is missing saved pixels.`);
      await uploadCompressedLayerIntoHot(engine, record, gpu, compressed, reusableBlankHot);
    }
    gpu.hot = reusableBlankHot;
    gpu.compressed = null;
    return reusableBlankHot;
  }
  if (!record.hasContent) {
    const allocated = await allocateLayerGpuResources(
      engine,
      engine.layerFormat,
      `Restore blank project layer ${record.id}`,
    );
    if (!allocated.hot) throw new Error(`Blank layer ${record.id} allocation failed.`);
    gpu.hot = allocated.hot;
    return allocated.hot;
  }
  const hot = await createHydratedLayerTexture(
    engine,
    record,
    gpu,
    `Restore project layer ${record.id}`,
    false,
  );
  engine.liveLayerHydrationTextures.delete(hot.texture);
  gpu.hot = hot;
  destroyLayerColdStorage(gpu.cold);
  gpu.cold = null;
  gpu.compressed = null;
  return hot;
}

/**
 * Replaces every document-owned resource with one transparent raster while
 * preserving the long-lived WebGPU device, compiled programs and brush asset
 * residency. The caller must durably save the outgoing project first: once the
 * reusable hot texture is cleared, failure is intentionally fail-closed.
 */
export async function resetEngineToFreshProjectState(
  engine: BrushEngine,
  options: FreshProjectResetOptions = {},
): Promise<number> {
  assertFreshProjectResetAllowed(engine, options);

  // These two previews own structural composition state that is stored outside
  // the layer stack. Withdraw them while the outgoing document is still valid.
  await engine.releaseShapePreviewPresentation();
  await engine.clearMixedSceneRasterTransformPreview();
  await waitForDocumentScopedPreparation(engine);
  assertFreshProjectResetAllowed(engine, options);

  engine.persistActiveLayerState();
  const oldGpu = [...engine.layerGpu.values()];
  const oldActiveGpu = engine.requireLayerGpu(engine.layerStack.active.id);
  const reusableBlankHot = oldActiveGpu.hot;
  if (!reusableBlankHot) {
    throw new Error("The active project has no reusable layer texture.");
  }
  const freshRecord = engine.layerStack.createDetachedRecord("Layer 1");
  const freshGpu = createColdLayerGpuResources();
  freshGpu.hot = reusableBlankHot;

  if (engine.documentGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new Error("The document generation counter is exhausted.");
  }
  const nextGeneration = engine.documentGeneration + 1;
  engine.documentGeneration = nextGeneration;
  engine.layerSwitchBusy = true;
  engine.cancelLayerColdCompressionIdle();

  let presentationTransactionStarted = false;
  let destructiveCommitStarted = false;
  let freshStatePublished = false;
  let oldGpuDestroyed = false;
  let completed = false;
  try {
    await waitForColdCompressionCancellation(engine);
    await engine.waitForIdle();
    await engine.beginPresentationTransaction();
    presentationTransactionStarted = true;

    // This is the irreversible boundary. It avoids allocating a second full
    // 4096² RGBA16F texture merely to manufacture an empty restore target.
    destructiveCommitStarted = true;
    clearHotLayerForFreshProject(engine, reusableBlankHot);
    await engine.waitForGpuCapped(
      "Clear reusable project layer",
      DOCUMENT_RESET_WAIT_TIMEOUT_MS,
    );

    engine.resetHistoryState();
    resetDocumentScopedTransientState(engine);

    const freshStack: LayerStackState = {
      layers: [freshRecord],
      activeLayerId: freshRecord.id,
      referenceLayerId: null,
    };
    engine.layerStack.restoreState(freshStack);
    engine.layerGpu.clear();
    engine.layerGpu.set(freshRecord.id, freshGpu);
    oldActiveGpu.hot = null;
    freshStatePublished = true;

    if (engine.mixedSceneStack) {
      const freshScene = new MixedSceneStack([freshRecord.id]);
      engine.mixedSceneStack.restoreState(freshScene.captureState());
    }
    engine.documentBackground = normalizeDocumentBackground(undefined);
    engine.layerContentBounds = null;
    engine.layerHasContent = false;

    engine.viewRotation = 0;
    engine.viewRotationCos = 1;
    engine.viewRotationSin = 0;
    engine.viewRotationGestureRaw = 0;
    engine.viewRotationGestureActive = false;
    engine.viewRotationSnappedToZero = true;
    engine.hasFittedView = false;
    engine.fitView();

    await engine.activateLayer(0, "layer-switch");
    for (const gpu of oldGpu) destroyLayerGpuResources(engine, gpu);
    oldGpuDestroyed = true;
    engine.sweepRasterImageGpuResources();

    engine.publishHistoryState();
    engine.publishActiveLayerChange();
    try {
      engine.callbacks.onViewRotationChange?.(0, true);
      engine.callbacks.onViewChange?.(engine.getVectorTextViewState(), false);
    } catch (error) {
      console.error("Project view observer ignored after document reset:", error);
    }
    engine.publishStats();
    completed = true;
    return nextGeneration;
  } catch (error) {
    if (freshStatePublished && !oldGpuDestroyed) {
      for (const gpu of oldGpu) destroyLayerGpuResources(engine, gpu);
      oldGpuDestroyed = true;
    }
    if (destructiveCommitStarted) {
      engine.latchDocumentStateInconsistent(
        "The project switch could not create a safe restore target. Reload before continuing.",
        error,
      );
    }
    throw error;
  } finally {
    if (!completed || options.retainLayerSwitchBusyOnSuccess !== true) {
      engine.layerSwitchBusy = false;
    }
    if (
      presentationTransactionStarted
      && (completed || !destructiveCommitStarted)
    ) {
      engine.endPresentationTransaction();
    }
    if (completed && options.retainLayerSwitchBusyOnSuccess !== true) {
      engine.scheduleEffectsScratchShrink();
      engine.scheduleBevelFieldShrink();
      engine.scheduleLayerColdCompression();
    }
  }
}

/**
 * Replaces the active document extent without replacing the WebGPU session.
 * The outgoing project must already have a verified durable head. Program
 * objects stay resident; only document-sized textures, views and bind groups
 * are rebuilt before the target project is restored.
 */
export async function reconfigureEngineForDocumentSwitch(
  engine: BrushEngine,
  width: number,
  height: number,
): Promise<number> {
  validateDocumentDimensions(width, height, { allowLegacy4096: true });
  if (width === engine.documentWidth && height === engine.documentHeight) {
    return resetEngineToFreshProjectState(engine);
  }

  // Own presentation across the nested fresh-project reset and the complete
  // dimensional rebuild. The inner transaction may finish after clearing the
  // old layer, but this outer depth prevents its scheduled frame from observing
  // new live dimensions alongside resources that are about to be destroyed.
  await engine.beginPresentationTransaction();
  let completed = false;
  try {
    const nextGeneration = await resetEngineToFreshProjectState(engine, {
      parentPresentationTransactionActive: true,
      retainLayerSwitchBusyOnSuccess: true,
    });
    reconfigureDocumentDimensions(width, height, { allowLegacy4096: true });
    await recreateLayerResources(engine, engine.layerFormat, {
      deferBlendRenderer: engine.blendRenderer === null,
      deferSelectionPipelines: !engine.selectionPipelinesReady,
      reuseResidentPrograms: true,
      releaseDocumentResourcesBeforeAllocation: true,
    });
    await engine.fillRenderer?.reconfigureDocument(
      width,
      height,
      engine.layerSamplingView,
    );
    await engine.selectionRenderer?.reconfigureDocument(
      width,
      height,
      engine.layerSamplingView,
    );
    engine.hasFittedView = false;
    engine.fitView();
    engine.writeBrushUniforms();
    engine.publishStats();
    completed = true;
    return nextGeneration;
  } catch (error) {
    engine.latchDocumentStateInconsistent(
      "The canvas size changed, but its document resources could not be rebuilt. Reload before continuing.",
      error,
    );
    throw error;
  } finally {
    // Every failure after this boundary is fail-closed and immediately falls
    // back to a reload. Keeping the cache frozen avoids presenting mixed or
    // destroyed resources while that recovery is underway.
    if (completed) {
      engine.layerSwitchBusy = false;
      engine.scheduleEffectsScratchShrink();
      engine.scheduleBevelFieldShrink();
      engine.scheduleLayerColdCompression();
      engine.endPresentationTransaction();
    }
  }
}

/**
 * Restores a validated project into the freshly initialized blank engine. The
 * initial hot texture is reused for the saved active layer, avoiding a second
 * 128 MiB allocation when opening a 4096² RGBA16F document.
 */
export async function restoreProjectDocument(
  engine: BrushEngine,
  project: ProjectLoadResultV1,
): Promise<void> {
  const snapshot = project.manifest.snapshot;
  if (
    snapshot.document.width !== DOCUMENT_WIDTH
    || snapshot.document.height !== DOCUMENT_HEIGHT
  ) {
    throw new Error(
      `This project is ${snapshot.document.width} × ${snapshot.document.height}; `
      + `reopen it with the matching canvas size.`,
    );
  }
  const exactPixelContract = snapshot.document.layerFormat === engine.layerFormat
    && snapshot.document.colorSpace === engine.documentStorageColorSpace;
  const legacyLinearRgba8Migration = snapshot.document.layerFormat === "rgba8unorm"
    && snapshot.document.colorSpace === "linear-premultiplied"
    && engine.layerFormat === "rgba16float"
    && engine.documentStorageColorSpace === "linear-premultiplied";
  if (!exactPixelContract && !legacyLinearRgba8Migration) {
    throw new Error(
      "The saved document pixel contract "
      + `(${snapshot.document.layerFormat}, ${snapshot.document.colorSpace}) cannot be opened as `
      + `(${engine.layerFormat}, ${engine.documentStorageColorSpace}).`,
    );
  }
  if (!engine.initialized) throw new Error("The editor is not ready yet.");
  const records = snapshot.layers.map(layerRecordFromProject);
  const containsSemanticItems = snapshot.mixedScene.items.some(
    (item) => item.kind !== "raster",
  );
  if (engine.documentStorageColorSpace === "encoded-srgb-premultiplied") {
    if (containsSemanticItems) {
      throw new Error(
        "This RGBA8 sRGB project contains semantic layers whose renderer is not validated yet.",
      );
    }
    if (records.some(rasterLayerHasUnvalidatedEffects)) {
      throw new Error(
        "This RGBA8 sRGB project uses raster layer effects that are not validated yet.",
      );
    }
    if (records.some((record) => record.rasterSource !== null)) {
      throw new Error(
        "This RGBA8 sRGB project contains an imported raster source that is not validated yet.",
      );
    }
  }
  const restoredScenePlan = new MixedSceneStack(records.map((record) => record.id));
  restoredScenePlan.restoreState(snapshot.mixedScene, true);
  const advancedLayerCompositionRequired = Boolean(engine.mixedSceneStack)
    && records.some(layerNeedsBackdropComposition);
  const rasterOnlyLayerBlendPresentationRequired = advancedLayerCompositionRequired
    && restoredScenePlan.visibleSemanticCount === 0
    && !restoredScenePlan.hasHeterogeneousClipping;
  const orderedScenePresentationRequired = advancedLayerCompositionRequired
    || restoredScenePlan.visibleSemanticCount > 0
    || restoredScenePlan.hasHeterogeneousClipping;
  const rasterClippingSegmentLayoutRequired = Boolean(engine.mixedSceneStack)
    && records.some((record) => record.clippingParentId !== null);
  // A restored scene can schedule a presentation frame or rebuild an active
  // clipping child as soon as its CPU state is published below. Prepare the
  // exact capability before crossing that destructive boundary; the session
  // controller's overlapping warm-up is deliberately not an ordering guarantee.
  if (containsSemanticItems) {
    await engine.ensureMixedSceneEditorResources();
  }
  if (
    rasterOnlyLayerBlendPresentationRequired
    || rasterClippingSegmentLayoutRequired
  ) {
    await ensureMixedScenePresentationResources(engine);
  }
  if (orderedScenePresentationRequired) {
    await prewarmMixedSceneLinearTextureForLayerBlend(
      engine,
      Math.max(1, engine.canvas.width),
      Math.max(1, engine.canvas.height),
      advancedLayerCompositionRequired && !rasterOnlyLayerBlendPresentationRequired,
      records.some((record) => record.cutoutMode === "document"),
    );
  }
  if (rasterOnlyLayerBlendPresentationRequired) {
    await ensureLayerBlendTilePresentationResources(engine);
  }
  if (restoredScenePlan.hasHeterogeneousClipping) {
    await prewarmMixedSceneClippingScratch(
      engine,
      Math.max(1, engine.canvas.width),
      Math.max(1, engine.canvas.height),
      true,
    );
  }
  engine.persistActiveLayerState();
  if (
    engine.layerStack.count !== 1
    || engine.layerStack.active.hasContent
    || engine.getHistoryState().actionCount !== 0
  ) {
    throw new Error("A project can only be restored into a fresh editor session.");
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  await engine.waitForIdle();
  engine.layerSwitchBusy = true;

  const oldGpu = [...engine.layerGpu.values()];
  const oldActiveGpu = engine.requireLayerGpu(engine.layerStack.active.id);
  const reusableBlankHot = oldActiveGpu.hot;
  if (!reusableBlankHot) throw new Error("The fresh editor has no reusable layer texture.");

  const recordById = new Map(records.map((record) => [record.id, record]));
  const storedChunksByLayer = new Map<
    number,
    Map<number, ProjectLoadResultV1["chunks"][number]>
  >();
  for (const chunk of project.chunks) {
    const byIndex = storedChunksByLayer.get(chunk.layerId) ?? new Map();
    byIndex.set(chunk.chunkIndex, chunk);
    storedChunksByLayer.set(chunk.layerId, byIndex);
  }
  const nextGpu = new Map<number, LayerGpuResources>();
  const restoredHistoryBaselines = new Map<number, RestoredProjectHistoryBaseline>();
  for (const layer of snapshot.layers) {
    const record = recordById.get(layer.id);
    if (!record) throw new Error(`The saved layer ${layer.id} is missing its record.`);
    const gpu = createColdLayerGpuResources();
    gpu.compressed = await compressedFromProject(
      engine,
      layer,
      storedChunksByLayer.get(layer.id) ?? new Map(),
    );
    nextGpu.set(layer.id, gpu);
    // The immutable compressed payload is shared with inactive layer storage.
    // Keeping the same reference gives every restored layer a cursor-zero
    // replay base without another full-size GPU cold texture or byte clone.
    restoredHistoryBaselines.set(layer.id, {
      compressed: gpu.compressed,
      baseBounds: record.contentBounds ? { ...record.contentBounds } : null,
      baseTileMask: record.storageTileMask.slice(),
      noiseMipSmoothing: record.noiseMipSmoothing,
    });
  }

  let reusedHotCommitted = false;
  let presentationTransactionStarted = false;
  let restoreCompleted = false;
  const installedRasterSources: RasterImageGpuResource[] = [];
  try {
    const installedAssetIds = new Set<string>();
    for (let index = 0; index < records.length; index += 1) {
      const source = records[index].rasterSource;
      const persisted = snapshot.layers[index].rasterSource;
      if (!source || !persisted || installedAssetIds.has(source.document.assetId)) continue;
      const wasAlreadyResident = engine.rasterImageGpuResources.has(
        source.document.assetId,
      );
      const resource = await installRasterLayerSourceResource(
        engine,
        cloneRasterLayerSource(source)!,
        persisted.blob,
      );
      if (!wasAlreadyResident) installedRasterSources.push(resource);
      installedAssetIds.add(resource.assetId);
    }
    const activeRecord = recordById.get(snapshot.activeRasterLayerId);
    if (!activeRecord) throw new Error("The saved active layer is missing.");
    const activeGpu = nextGpu.get(activeRecord.id)!;
    await engine.beginPresentationTransaction();
    presentationTransactionStarted = true;
    await promotePersistedLayer(engine, activeRecord, activeGpu, reusableBlankHot);
    reusedHotCommitted = true;
    oldActiveGpu.hot = null;

    if (
      snapshot.referenceRasterLayerId !== null
      && snapshot.referenceRasterLayerId !== activeRecord.id
    ) {
      const referenceRecord = recordById.get(snapshot.referenceRasterLayerId);
      const referenceGpu = nextGpu.get(snapshot.referenceRasterLayerId);
      if (!referenceRecord || !referenceGpu) {
        throw new Error("The saved reference layer is missing.");
      }
      await promotePersistedLayer(engine, referenceRecord, referenceGpu, null);
    }

    const stackState: LayerStackState = {
      layers: records,
      activeLayerId: snapshot.activeRasterLayerId,
      referenceLayerId: snapshot.referenceRasterLayerId,
    };
    engine.layerStack.restoreState(stackState);
    engine.layerGpu.clear();
    for (const [layerId, gpu] of nextGpu) engine.layerGpu.set(layerId, gpu);
    // Vector and image documents are immutable project payloads. Share them
    // while cloning only mutable node properties, avoiding a deep SVG copy.
    engine.mixedSceneStack?.restoreState(snapshot.mixedScene, true);
    engine.mixedSceneStack?.synchronizeRasterClippingRelations(records);
    engine.documentBackground = normalizeDocumentBackground(
      snapshot.background ?? { visible: false, color: "#ffffff" },
    );

    engine.viewCenterX = snapshot.view.centerX;
    engine.viewCenterY = snapshot.view.centerY;
    engine.zoom = snapshot.view.zoom;
    engine.viewRotation = snapshot.view.rotationRadians;
    engine.viewRotationCos = Math.cos(snapshot.view.rotationRadians);
    engine.viewRotationSin = Math.sin(snapshot.view.rotationRadians);
    engine.viewRotationGestureRaw = snapshot.view.rotationRadians;
    engine.viewRotationSnappedToZero = Math.abs(snapshot.view.rotationRadians) < 1e-6;
    engine.hasFittedView = true;
    engine.resetHistoryState();

    await engine.activateLayer(engine.layerStack.activeIndex, "layer-switch");
    for (const gpu of oldGpu) destroyLayerGpuResources(engine, gpu);
    engine.installRestoredProjectHistoryBaselines(restoredHistoryBaselines);
    engine.publishHistoryState();
    engine.callbacks.onActiveLayerChange?.(engine.layerStack.activeIndex);
    engine.callbacks.onViewRotationChange?.(
      snapshot.view.rotationRadians * 180 / Math.PI,
      engine.viewRotationSnappedToZero,
    );
    engine.callbacks.onViewChange?.(engine.getVectorTextViewState(), false);
    restoreCompleted = true;
  } catch (error) {
    engine.restoredProjectHistoryBaselines.clear();
    for (const resource of installedRasterSources) {
      if (engine.rasterImageGpuResources.get(resource.assetId) !== resource) continue;
      engine.rasterImageGpuResources.delete(resource.assetId);
      resource.uniformBuffer.destroy();
      resource.texture.destroy();
    }
    if (!reusedHotCommitted) {
      for (const gpu of nextGpu.values()) destroyLayerGpuResources(engine, gpu);
    }
    engine.latchDocumentStateInconsistent(
      "The project could not be restored safely. Reload before continuing.",
      error,
    );
    throw error;
  } finally {
    if (presentationTransactionStarted && restoreCompleted) {
      engine.endPresentationTransaction();
    }
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
  }

  // Brush selection belongs to the global library, which restores and prepares
  // only its active brush before the project is opened. The serialized settings
  // remain in V1 documents for compatibility, but must not select or hydrate a
  // different brush while restoring a project.
  engine.publishStats();
}
