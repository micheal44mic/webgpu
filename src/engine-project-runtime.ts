import type { BrushEngine } from "./brush-engine";
import {
  coldStorageMaskForRecord,
  compressColdStorageResources,
  createColdLayerGpuResources,
  createHydratedLayerTexture,
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  uploadCompressedLayerIntoHot,
} from "./engine-cold-storage";
import type {
  LayerCompressedColdStorageResources,
  LayerGpuResources,
  LayerTextureResources,
} from "./engine-layer-resources";
import {
  allocateLayerGpuResources,
  destroyLayerGpuResources,
} from "./engine-layer-runtime";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_TILE_HEIGHT,
  DOCUMENT_TILE_WIDTH,
  DOCUMENT_WIDTH,
} from "./engine-limits";
import type { LayerRecord, LayerStackState } from "./layer-stack";
import type { LayerColdCompressedChunk } from "./layer-cold-compression-client";
import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_STORAGE_TILE_GRID_SIZE,
  type ProjectChunkWriteV1,
  type ProjectLayerPixelsV1,
  type ProjectLayerV1,
  type ProjectLoadResultV1,
  type ProjectSnapshotV1,
} from "./project-storage";

export interface CapturedProjectDocumentV1 {
  readonly snapshot: ProjectSnapshotV1;
  readonly chunks: readonly ProjectChunkWriteV1[];
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
  record: LayerRecord,
  pixels: ProjectLayerPixelsV1 | null,
): ProjectLayerV1 {
  return {
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    id: record.id,
    name: record.name,
    visible: record.visible,
    opacity: record.opacity,
    blendMode: record.blendMode,
    clippingParentId: record.clippingParentId,
    contentBounds: record.contentBounds ? { ...record.contentBounds } : null,
    storageTileMask: record.storageTileMask.slice(),
    hasContent: record.hasContent,
    noiseMipSmoothing: record.noiseMipSmoothing,
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
        layers.push(projectLayerMetadata(record, null));
        continue;
      }
      const compressed = await captureLayerCompressed(
        engine,
        record,
        engine.requireLayerGpu(record.id),
      );
      const captured = projectPixelsFromCompressed(record.id, compressed);
      layers.push(projectLayerMetadata(record, captured.pixels));
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
          colorSpace: "linear-premultiplied",
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
    blendMode: layer.blendMode,
    clippingParentId: layer.clippingParentId,
    contentBounds: layer.contentBounds ? { ...layer.contentBounds } : null,
    storageTileMask: layer.storageTileMask.slice(),
    hasContent: layer.hasContent,
    noiseMipSmoothing: layer.noiseMipSmoothing,
    strokeStyle: structuredClone(layer.strokeStyle),
    bevelStyle: structuredClone(layer.bevelStyle),
    outerShadowStyle: structuredClone(layer.outerShadowStyle),
    innerShadowStyle: structuredClone(layer.innerShadowStyle),
    colorOverlayStyle: structuredClone(layer.colorOverlayStyle),
  };
}

function compressedFromProject(
  layer: ProjectLayerV1,
  storedChunks: ProjectLoadResultV1["chunks"],
): LayerCompressedColdStorageResources | null {
  const pixels = layer.pixels;
  if (!pixels) return null;
  const byIndex = new Map(
    storedChunks
      .filter((chunk) => chunk.layerId === layer.id)
      .map((chunk) => [chunk.chunkIndex, chunk]),
  );
  const chunks: LayerColdCompressedChunk[] = pixels.chunks.map((descriptor) => {
    const stored = byIndex.get(descriptor.chunkIndex);
    if (!stored) {
      throw new Error(`Saved chunk ${layer.id}:${descriptor.chunkIndex} is missing.`);
    }
    return {
      storage: stored.storage,
      bytes: cloneBuffer(stored.bytes),
      rawBytes: stored.rawBytes,
      storedBytes: stored.storedBytes,
      sourceHash: stored.sourceHash,
    };
  });
  return {
    tileIndices: [...pixels.tileIndices],
    chunks,
    rawBytes: pixels.rawBytes,
    storedBytes: pixels.storedBytes,
    sourceHash: pixels.sourceHash,
    generation: pixels.generation,
    encodeMs: 0,
    format: pixels.format,
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
  if (snapshot.document.layerFormat !== engine.layerFormat) {
    throw new Error(
      `Saved ${snapshot.document.layerFormat} pixels cannot be opened as ${engine.layerFormat}.`,
    );
  }
  if (!engine.initialized) throw new Error("The editor is not ready yet.");
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

  const records = snapshot.layers.map(layerRecordFromProject);
  const recordById = new Map(records.map((record) => [record.id, record]));
  const nextGpu = new Map<number, LayerGpuResources>();
  for (const layer of snapshot.layers) {
    const gpu = createColdLayerGpuResources();
    gpu.compressed = compressedFromProject(layer, project.chunks);
    nextGpu.set(layer.id, gpu);
  }

  let reusedHotCommitted = false;
  try {
    const activeRecord = recordById.get(snapshot.activeRasterLayerId);
    if (!activeRecord) throw new Error("The saved active layer is missing.");
    const activeGpu = nextGpu.get(activeRecord.id)!;
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
    engine.mixedSceneStack?.restoreState(snapshot.mixedScene);

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
    engine.publishHistoryState();
    engine.callbacks.onActiveLayerChange?.(engine.layerStack.activeIndex);
    engine.callbacks.onViewRotationChange?.(
      snapshot.view.rotationRadians * 180 / Math.PI,
      engine.viewRotationSnappedToZero,
    );
    engine.callbacks.onViewChange?.(engine.getVectorTextViewState());
  } catch (error) {
    if (!reusedHotCommitted) {
      for (const gpu of nextGpu.values()) destroyLayerGpuResources(engine, gpu);
    }
    engine.latchDocumentStateInconsistent(
      "The project could not be restored safely. Reload before continuing.",
    );
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
  }

  // Brush settings are document convenience state; custom brush assets remain
  // in the global library and are resolved there.
  engine.setBrushSettings(snapshot.brushSettings);
  engine.publishStats();
}
