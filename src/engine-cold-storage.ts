
import {
  type LayerColdStorageResources,
  type LayerCompressedColdStorageResources,
  type LayerGpuCompletionPolicy,
  type LayerGpuResources,
  type LayerTextureResources,
} from "./engine-layer-resources";
import { type LayerRecord } from "./layer-stack";
import {
  countLayerStorageTiles,
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_TILE_SIZE,
  layerStorageTileIndices,
  markLayerStorageRect,
} from "./layer-storage-study";
import type { BrushEngine } from "./brush-engine";
import { combineCompressionHashes } from "./engine-math";
import {
  LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE,
  type LayerColdCompressedChunk,
} from "./layer-cold-compression-client";
import { LAYER_SIZE, MEBIBYTE_BYTES } from "./engine-limits";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";/**
 * Archiviazione fredda dei livelli: codifica dell'idratazione, maschere dei
 * record e distruzione delle risorse calde e fredde.
 */

export function createColdLayerGpuResources(): LayerGpuResources {
  return { hot: null, cold: null, compressed: null, bake: null, bakeValid: false };
}

export function destroyLayerColdStorage(cold: LayerColdStorageResources | null | undefined): void {
  cold?.texture.destroy();
}

export function destroyLayerHot(hot: LayerTextureResources | null | undefined): void {
  hot?.texture.destroy();
}

export function coldStorageMaskForRecord(record: LayerRecord): Uint32Array {
  const mask = record.storageTileMask.slice();
  if (record.contentBounds) {
    // The bbox is an independent conservative fallback. A future writer that
    // forgets the sparse bit still cannot silently discard a pixel inside the
    // document-wide bounds.
    markLayerStorageRect(mask, record.contentBounds);
  }
  if (record.hasContent && countLayerStorageTiles(mask) === 0) {
    // Last-resort safety for inconsistent metadata: keep the whole layer.
    // This loses the memory win, never the user pixels.
    mask.fill(0xffffffff);
  }
  return mask;
}

export function encodeLayerColdHydration(
  encoder: GPUCommandEncoder,
  cold: LayerColdStorageResources,
  hot: LayerTextureResources,
): void {
  cold.tileIndices.forEach((tileIndex, arrayLayer) => {
    const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
    const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
    encoder.copyTextureToTexture(
      { texture: cold.texture, origin: { x: 0, y: 0, z: arrayLayer } },
      {
        texture: hot.texture,
        origin: {
          x: tileX * LAYER_STORAGE_TILE_SIZE,
          y: tileY * LAYER_STORAGE_TILE_SIZE,
          z: 0,
        },
      },
      {
        width: LAYER_STORAGE_TILE_SIZE,
        height: LAYER_STORAGE_TILE_SIZE,
        depthOrArrayLayers: 1,
      },
    );
  });
}

export async function compressOneDistantLayerInBackground(engine: BrushEngine, token: number): Promise<void> {
  if (
    token !== engine.layerColdCompressionEpoch
    || engine.layerColdCompressionJobRunning
    || !layerColdCompressionEngineIdle(engine)
  ) {
    engine.scheduleLayerColdCompression();
    return;
  }
  const source = engine.selectLayerColdCompressionCandidate();
  if (!source) {
    return;
  }
  let progress = engine.layerColdCompressionProgress;
  if (
    !progress
    || progress.record !== source.record
    || progress.gpu !== source.gpu
    || progress.cold !== source.cold
  ) {
    progress = {
      record: source.record,
      gpu: source.gpu,
      cold: source.cold,
      chunks: [],
      nextArrayLayer: 0,
      rawBytes: 0,
      storedBytes: 0,
      sourceHash: 0x811c9dc5,
      encodeMs: 0,
      pauseReported: false,
    };
    engine.layerColdCompressionProgress = progress;
  }
  engine.layerColdCompressionJobRunning = true;
  const tileByteLength = LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
  try {
    const client = await engine.requireLayerColdCompressionClient();
    await engine.waitForIdle();
    if (
      token !== engine.layerColdCompressionEpoch
      || engine.layerColdCompressionProgress !== progress
      || source.gpu.cold !== source.cold
    ) {
      return;
    }
    progress.pauseReported = false;
    while (progress.nextArrayLayer < source.cold.tileIndices.length) {
      if (
        token !== engine.layerColdCompressionEpoch
        || engine.layerColdCompressionProgress !== progress
        || source.gpu.cold !== source.cold
      ) {
        return;
      }
      // Never enqueue a new GPU readback while a stroke or another engine
      // mutation is active. A chunk already read may still finish in the
      // worker; its verified result is retained below before pausing.
      if (!layerColdCompressionEngineIdle(engine)) {
        return;
      }
      const firstArrayLayer = progress.nextArrayLayer;
      const chunkTileCount = Math.min(
        4,
        source.cold.tileIndices.length - firstArrayLayer,
      );
      const payload = await engine.readLayerColdStorageTiles(
        source.cold,
        firstArrayLayer,
        chunkTileCount,
        `worker compressione livello ${source.record.id}`,
      );
      if (
        token !== engine.layerColdCompressionEpoch
        || engine.layerColdCompressionProgress !== progress
        || source.gpu.cold !== source.cold
      ) {
        return;
      }
      const result = await client.compress(payload, tileByteLength);
      if (
        token !== engine.layerColdCompressionEpoch
        || engine.layerColdCompressionProgress !== progress
        || source.gpu.cold !== source.cold
      ) {
        return;
      }
      progress.chunks.push(result.chunk);
      progress.nextArrayLayer += chunkTileCount;
      progress.rawBytes += result.measurement.rawBytes;
      progress.storedBytes += result.chunk.storedBytes;
      progress.encodeMs += result.measurement.encodeMs;
      progress.sourceHash = combineCompressionHashes(
        progress.sourceHash,
        result.measurement.sourceHash,
        result.measurement.rawBytes,
      );
      if (!layerColdCompressionEngineIdle(engine)) {
        if (!progress.pauseReported) {
          progress.pauseReported = true;
          engine.publishLayerColdCompressionStatus(
            `Compressione ${source.record.name} in pausa: `
            + `${progress.nextArrayLayer}/${source.cold.tileIndices.length} tile verificati.`,
            "working",
          );
        }
        engine.publishStats();
        return;
      }
    }
    if (!layerColdCompressionEngineIdle(engine)) {
      return;
    }
    if (progress.rawBytes !== source.cold.memoryBytes) {
      throw new Error(
        `Compressione livello ${source.record.id}: ${progress.rawBytes} byte letti, `
        + `${source.cold.memoryBytes} attesi.`,
      );
    }
    await engine.waitForGpuCapped(`Evizione cold livello ${source.record.id}`);
    if (
      token !== engine.layerColdCompressionEpoch
      || engine.layerColdCompressionProgress !== progress
      || !layerColdCompressionEngineIdle(engine)
      || source.gpu.cold !== source.cold
      || source.gpu.compressed
      || Math.abs(source.index - engine.layerStack.activeIndex)
        < LAYER_COLD_COMPRESSION_MINIMUM_DISTANCE
    ) {
      return;
    }
    source.gpu.compressed = {
      tileIndices: [...source.cold.tileIndices],
      chunks: [...progress.chunks],
      rawBytes: progress.rawBytes,
      storedBytes: progress.storedBytes,
      sourceHash: progress.sourceHash,
      generation: source.cold.generation,
      encodeMs: progress.encodeMs,
    };
    source.gpu.cold = null;
    engine.layerColdCompressionProgress = null;
    destroyLayerColdStorage(source.cold);
    engine.publishLayerColdCompressionStatus(
      `${source.record.name} compresso in background: `
      + `${(progress.rawBytes / MEBIBYTE_BYTES).toFixed(1)} MiB GPU → `
      + `${(progress.storedBytes / MEBIBYTE_BYTES).toFixed(1)} MiB RAM.`,
      "ok",
    );
    engine.publishStats();
  } catch (error) {
    if (token === engine.layerColdCompressionEpoch) {
      engine.layerColdCompressionProgress = null;
      engine.layerColdCompressionWorkerUnavailable = true;
      engine.layerColdCompressionClient?.dispose();
      engine.layerColdCompressionClient = null;
      const message = error instanceof Error ? error.message : String(error);
      engine.publishLayerColdCompressionStatus(
        `Compressione background non disponibile; cold GPU mantenuto: ${message}`,
        "error",
      );
      engine.publishStats();
    }
  } finally {
    engine.layerColdCompressionJobRunning = false;
    engine.scheduleLayerColdCompression();
  }
}

export async function ensureLayerColdStorageResident(engine: BrushEngine, 
  record: LayerRecord,
  gpu: LayerGpuResources,
): Promise<void> {
  if (gpu.cold || !record.hasContent) {
    return;
  }
  const compressed = gpu.compressed;
  if (!compressed) {
    throw new Error(`Livello ${record.id}: storage autorevole mancante.`);
  }
  const tileByteLength = LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
  const texture = engine.device.createTexture({
    label: `Cold ripristinato livello ${record.id} #${compressed.generation}`,
    size: {
      width: LAYER_STORAGE_TILE_SIZE,
      height: LAYER_STORAGE_TILE_SIZE,
      depthOrArrayLayers: compressed.tileIndices.length,
    },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.TEXTURE_BINDING,
  });
  engine.layerColdRestoreActiveBytes += compressed.rawBytes;
  let committed = false;
  try {
    let firstArrayLayer = 0;
    let restoredBytes = 0;
    let restoredHash = 0x811c9dc5;
    for (const chunk of compressed.chunks) {
      const restored = await decompressLayerColdChunk(engine, chunk);
      if (restored.byteLength % tileByteLength !== 0) {
        throw new Error(`Chunk livello ${record.id} non allineato ai tile.`);
      }
      const chunkTileCount = restored.byteLength / tileByteLength;
      engine.device.queue.writeTexture(
        { texture, origin: { x: 0, y: 0, z: firstArrayLayer } },
        restored,
        {
          bytesPerRow: LAYER_STORAGE_TILE_SIZE * 4,
          rowsPerImage: LAYER_STORAGE_TILE_SIZE,
        },
        {
          width: LAYER_STORAGE_TILE_SIZE,
          height: LAYER_STORAGE_TILE_SIZE,
          depthOrArrayLayers: chunkTileCount,
        },
      );
      firstArrayLayer += chunkTileCount;
      restoredBytes += restored.byteLength;
      restoredHash = combineCompressionHashes(
        restoredHash,
        chunk.sourceHash,
        restored.byteLength,
      );
    }
    if (
      firstArrayLayer !== compressed.tileIndices.length
      || restoredBytes !== compressed.rawBytes
      || restoredHash !== compressed.sourceHash
    ) {
      throw new Error(`Integrità aggregata livello ${record.id} non valida.`);
    }
    await engine.waitForGpuCapped(`Upload cold compresso livello ${record.id}`);
    if (gpu.compressed !== compressed || gpu.cold) {
      throw new Error(`Ripristino livello ${record.id} diventato stale.`);
    }
    gpu.cold = {
      texture,
      tileIndices: compressed.tileIndices,
      memoryBytes: compressed.rawBytes,
      generation: compressed.generation,
    };
    gpu.compressed = null;
    committed = true;
    engine.publishLayerColdCompressionStatus(
      `${record.name} ripristinato dal worker senza perdita.`,
      "ok",
    );
    engine.publishStats();
  } finally {
    engine.layerColdRestoreActiveBytes -= compressed.rawBytes;
    if (!committed) {
      texture.destroy();
    }
  }
}

export async function createLayerColdStorageCandidate(engine: BrushEngine, 
  record: LayerRecord,
  hot: LayerTextureResources,
  mask: Uint32Array,
  generation: number,
): Promise<LayerColdStorageResources> {
  const tileIndices = layerStorageTileIndices(mask);
  if (tileIndices.length === 0) {
    throw new Error(`Cold storage livello ${record.id}: contenuto senza tile.`);
  }
  if (tileIndices.length > engine.device.limits.maxTextureArrayLayers) {
    throw new Error(
      `Cold storage livello ${record.id}: ${tileIndices.length} tile superano `
      + `maxTextureArrayLayers=${engine.device.limits.maxTextureArrayLayers}.`,
    );
  }
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const memoryBytes = tileIndices.length
    * LAYER_STORAGE_TILE_SIZE
    * LAYER_STORAGE_TILE_SIZE
    * bytesPerPixel;
  return runGpuAllocationTransaction(
    engine.device,
    `Pack cold livello ${record.id}`,
    async (transaction) => {
      const texture = engine.device.createTexture({
        label: `Cold tile livello ${record.id} #${generation}`,
        size: {
          width: LAYER_STORAGE_TILE_SIZE,
          height: LAYER_STORAGE_TILE_SIZE,
          depthOrArrayLayers: tileIndices.length,
        },
        format: engine.layerFormat,
        usage:
          GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      transaction.deferRollback(() => texture.destroy());
      const encoder = engine.device.createCommandEncoder({
        label: `Pack cold livello ${record.id} #${generation}`,
      });
      tileIndices.forEach((tileIndex, arrayLayer) => {
        const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
        const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: {
              x: tileX * LAYER_STORAGE_TILE_SIZE,
              y: tileY * LAYER_STORAGE_TILE_SIZE,
              z: 0,
            },
          },
          { texture, origin: { x: 0, y: 0, z: arrayLayer } },
          {
            width: LAYER_STORAGE_TILE_SIZE,
            height: LAYER_STORAGE_TILE_SIZE,
            depthOrArrayLayers: 1,
          },
        );
      });
      engine.device.queue.submit([encoder.finish()]);
      await engine.waitForGpuCapped(`Pack cold livello ${record.id}`);
      engine.maybeInjectLayerColdStorageFault("after-pack-submit");
      return { texture, tileIndices, memoryBytes, generation };
    },
  );
}

export interface IncrementalColdStorageCaptureHooks {
  /**
   * Checked immediately before allocation and before every GPU submission.
   * A pointer-down invalidates the owning maintenance generation, therefore a
   * false result guarantees that no later tile-copy submission is enqueued.
   */
  shouldContinue(): boolean;
  /** Gives pointer/input events a browser turn between bounded submissions. */
  yieldTurn(): Promise<void>;
}

/**
 * History-only variant of the cold-store packer.
 *
 * The destination is still one compact texture array, but source tiles are
 * copied in bounded submissions.  The continuation gate is sampled before
 * each submit and after each browser yield; abort destroys the unpublished
 * candidate and returns null.  Normal layer switching keeps using the single
 * submission function above, so its established transaction is unchanged.
 */
export async function createLayerColdStorageCandidateIncrementally(
  engine: BrushEngine,
  record: LayerRecord,
  hot: LayerTextureResources,
  mask: Uint32Array,
  generation: number,
  hooks: IncrementalColdStorageCaptureHooks,
  maximumTilesPerSubmission = 16,
): Promise<LayerColdStorageResources | null> {
  if (!Number.isInteger(maximumTilesPerSubmission) || maximumTilesPerSubmission <= 0) {
    throw new RangeError("Il chunk tile del checkpoint History deve essere positivo.");
  }
  if (!hooks.shouldContinue()) return null;
  const tileIndices = layerStorageTileIndices(mask);
  if (tileIndices.length === 0) {
    throw new Error(`Cold storage livello ${record.id}: contenuto senza tile.`);
  }
  if (tileIndices.length > engine.device.limits.maxTextureArrayLayers) {
    throw new Error(
      `Cold storage livello ${record.id}: ${tileIndices.length} tile superano `
      + `maxTextureArrayLayers=${engine.device.limits.maxTextureArrayLayers}.`,
    );
  }
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const memoryBytes = tileIndices.length
    * LAYER_STORAGE_TILE_SIZE
    * LAYER_STORAGE_TILE_SIZE
    * bytesPerPixel;
  return runGpuAllocationTransaction(
    engine.device,
    `Pack cold incrementale livello ${record.id}`,
    async (transaction) => {
      if (!hooks.shouldContinue()) return null;
      const texture = engine.device.createTexture({
        label: `Cold tile History livello ${record.id} #${generation}`,
        size: {
          width: LAYER_STORAGE_TILE_SIZE,
          height: LAYER_STORAGE_TILE_SIZE,
          depthOrArrayLayers: tileIndices.length,
        },
        format: engine.layerFormat,
        usage:
          GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      transaction.deferRollback(() => texture.destroy());
      for (
        let firstTile = 0;
        firstTile < tileIndices.length;
        firstTile += maximumTilesPerSubmission
      ) {
        // This is deliberately the last operation before encoder creation and
        // submit. Pointer-down changes the generation synchronously, so no new
        // copy can begin after user interaction has resumed.
        if (!hooks.shouldContinue()) {
          texture.destroy();
          return null;
        }
        const endTile = Math.min(
          tileIndices.length,
          firstTile + maximumTilesPerSubmission,
        );
        const encoder = engine.device.createCommandEncoder({
          label: `Pack cold History livello ${record.id} ${firstTile}-${endTile}`,
        });
        for (let arrayLayer = firstTile; arrayLayer < endTile; arrayLayer += 1) {
          const tileIndex = tileIndices[arrayLayer];
          const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
          const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
          encoder.copyTextureToTexture(
            {
              texture: hot.texture,
              origin: {
                x: tileX * LAYER_STORAGE_TILE_SIZE,
                y: tileY * LAYER_STORAGE_TILE_SIZE,
                z: 0,
              },
            },
            { texture, origin: { x: 0, y: 0, z: arrayLayer } },
            {
              width: LAYER_STORAGE_TILE_SIZE,
              height: LAYER_STORAGE_TILE_SIZE,
              depthOrArrayLayers: 1,
            },
          );
        }
        if (!hooks.shouldContinue()) {
          texture.destroy();
          return null;
        }
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped(
          `Pack cold History livello ${record.id} ${firstTile}-${endTile}`,
        );
        engine.maybeInjectLayerColdStorageFault("after-pack-submit");
        if (endTile < tileIndices.length) {
          await hooks.yieldTurn();
        }
      }
      if (!hooks.shouldContinue()) {
        texture.destroy();
        return null;
      }
      return { texture, tileIndices, memoryBytes, generation };
    },
  );
}

export async function uploadCompressedLayerIntoHot(engine: BrushEngine, 
  record: LayerRecord,
  gpu: LayerGpuResources,
  compressed: LayerCompressedColdStorageResources,
  hot: LayerTextureResources,
): Promise<void> {
  const tileByteLength = LAYER_STORAGE_TILE_SIZE * LAYER_STORAGE_TILE_SIZE * 4;
  let firstTile = 0;
  let restoredBytes = 0;
  let restoredHash = 0x811c9dc5;
  for (const chunk of compressed.chunks) {
    const restored = await decompressLayerColdChunk(engine, chunk);
    if (
      gpu.compressed !== compressed
      || gpu.cold
      || restored.byteLength !== chunk.rawBytes
      || restored.byteLength % tileByteLength !== 0
    ) {
      throw new Error(`Reidratazione transitoria livello ${record.id} non valida.`);
    }
    const chunkTileCount = restored.byteLength / tileByteLength;
    if (firstTile + chunkTileCount > compressed.tileIndices.length) {
      throw new Error(`Chunk transitorio livello ${record.id} oltre i tile attesi.`);
    }
    for (let chunkTile = 0; chunkTile < chunkTileCount; chunkTile += 1) {
      const tileIndex = compressed.tileIndices[firstTile + chunkTile];
      const tileX = tileIndex % LAYER_STORAGE_GRID_SIZE;
      const tileY = Math.floor(tileIndex / LAYER_STORAGE_GRID_SIZE);
      const byteOffset = chunkTile * tileByteLength;
      engine.device.queue.writeTexture(
        {
          texture: hot.texture,
          origin: {
            x: tileX * LAYER_STORAGE_TILE_SIZE,
            y: tileY * LAYER_STORAGE_TILE_SIZE,
            z: 0,
          },
        },
        restored.subarray(byteOffset, byteOffset + tileByteLength),
        {
          bytesPerRow: LAYER_STORAGE_TILE_SIZE * 4,
          rowsPerImage: LAYER_STORAGE_TILE_SIZE,
        },
        {
          width: LAYER_STORAGE_TILE_SIZE,
          height: LAYER_STORAGE_TILE_SIZE,
          depthOrArrayLayers: 1,
        },
      );
    }
    firstTile += chunkTileCount;
    restoredBytes += restored.byteLength;
    restoredHash = combineCompressionHashes(
      restoredHash,
      chunk.sourceHash,
      restored.byteLength,
    );
  }
  if (
    gpu.compressed !== compressed
    || gpu.cold
    || firstTile !== compressed.tileIndices.length
    || restoredBytes !== compressed.rawBytes
    || restoredHash !== compressed.sourceHash
  ) {
    throw new Error(`Integrità transitoria livello ${record.id} non valida.`);
  }
}

export async function createHydratedLayerTexture(engine: BrushEngine, 
  record: LayerRecord,
  gpu: LayerGpuResources,
  label: string,
  injectFault: boolean,
  completionPolicy: LayerGpuCompletionPolicy = "await-immediately",
): Promise<LayerTextureResources> {
  if (injectFault && completionPolicy !== "await-immediately") {
    throw new Error("Il fault hydrate richiede il completamento GPU immediato.");
  }
  if (gpu.cold && gpu.compressed) {
    throw new Error(`Livello ${record.id}: cold GPU e compresso autorevoli insieme.`);
  }
  // Compressed bytes remain authoritative until the caller commits ownership,
  // so both activation and transient folding can hydrate the final hot target
  // directly without first allocating a duplicate GPU cold store.
  const directCompressedHydration = completionPolicy === "defer-to-fold-fence"
    || engine.layerColdDirectHotHydrationEnabled;
  const compressedSource = directCompressedHydration && !gpu.cold
    ? gpu.compressed
    : null;
  if (!compressedSource) {
    await ensureLayerColdStorageResident(engine, record, gpu);
  }
  const cold = gpu.cold;
  if (record.hasContent && !cold && !compressedSource) {
    throw new Error(`Reidratazione livello ${record.id}: cold store mancante.`);
  }
  const memoryBytes = LAYER_SIZE * LAYER_SIZE
    * (engine.layerFormat === "rgba16float" ? 8 : 4);
  return runGpuAllocationTransaction(
    engine.device,
    label,
    async (transaction) => {
      const hot = engine.allocateLayerTexture(engine.layerFormat);
      engine.liveLayerHydrationTextures.set(hot.texture, memoryBytes);
      transaction.deferRollback(() => destroyTransientLayerHydration(engine, hot));
      if (compressedSource) {
        await uploadCompressedLayerIntoHot(engine, record, gpu, compressedSource, hot);
        if (completionPolicy === "await-immediately") {
          await engine.waitForGpuCapped(label);
          if (injectFault) {
            engine.maybeInjectLayerColdStorageFault("after-hydrate-submit");
          }
        }
      } else if (cold) {
        const encoder = engine.device.createCommandEncoder({ label });
        encodeLayerColdHydration(encoder, cold, hot);
        engine.device.queue.submit([encoder.finish()]);
        if (completionPolicy === "await-immediately") {
          await engine.waitForGpuCapped(label);
          if (injectFault) {
            engine.maybeInjectLayerColdStorageFault("after-hydrate-submit");
          }
        }
      }
      return hot;
    },
  );
}

export async function decompressLayerColdChunk(engine: BrushEngine, 
  chunk: LayerColdCompressedChunk,
): Promise<Uint8Array> {
  let firstError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const client = await engine.requireLayerColdCompressionClient(true);
      return await client.decompress(chunk);
    } catch (error) {
      firstError ??= error;
      engine.layerColdCompressionClient?.dispose();
      engine.layerColdCompressionClient = null;
    }
  }
  const message = firstError instanceof Error ? firstError.message : String(firstError);
  throw new Error(`Worker decompressione non recuperabile: ${message}`);
}

export async function ensureAdjacentLayerColdStorageResident(engine: BrushEngine): Promise<void> {
  const activeIndex = engine.layerStack.activeIndex;
  for (const index of [activeIndex - 1, activeIndex + 1]) {
    if (index < 0 || index >= engine.layerStack.count) {
      continue;
    }
    const record = engine.layerStack.at(index);
    if (!record.hasContent) {
      continue;
    }
    const gpu = engine.requireLayerGpu(record.id);
    if (gpu.compressed) {
      await ensureLayerColdStorageResident(engine, record, gpu);
    }
  }
}

export function evictReconstructibleLayerResources(engine: BrushEngine, record: LayerRecord): void {
  const gpu = engine.requireLayerGpu(record.id);
  if (record.hasContent && !gpu.cold && !gpu.compressed) {
    throw new Error(
      `Evizione livello ${record.id} rifiutata: storage autorevole mancante.`,
    );
  }
  engine.layerPresentationFrozen = true;
  engine.destroyLayerBake(gpu.bake);
  gpu.bake = null;
  gpu.bakeValid = false;
  destroyLayerHot(gpu.hot);
  gpu.hot = null;
}

export async function ensureActiveLayerHot(engine: BrushEngine, record: LayerRecord): Promise<void> {
  const gpu = engine.requireLayerGpu(record.id);
  if (gpu.hot) {
    return;
  }
  const hot = await createHydratedLayerTexture(engine, 
    record,
    gpu,
    `Reidrata livello ${record.id}`,
    true,
  );
  gpu.hot = hot;
  engine.liveLayerHydrationTextures.delete(hot.texture);
}

export function layerColdCompressionEngineIdle(engine: BrushEngine): boolean {
  return engine.initialized
    && !engine.layerColdCompressionInteractionActive
    && !engine.activeStroke
    && !engine.historyBusy
    && !engine.layerSwitchBusy
    && !engine.rasterStrokeBusy
    && !engine.rasterBevelBusy
    && !engine.rasterOuterShadowBusy
    && !engine.rasterInnerShadowBusy
    && !engine.effectsScratchHasQueuedWork()
    && engine.devReadbackActiveBytes === 0;
}

export function destroyTransientLayerHydration(engine: BrushEngine, hot: LayerTextureResources | null | undefined): void {
  if (!hot) {
    return;
  }
  engine.liveLayerHydrationTextures.delete(hot.texture);
  hot.texture.destroy();
}

export function clearLayerColdCompressionIdleTimer(engine: BrushEngine): void {
  if (engine.layerColdCompressionIdleTimer !== null) {
    window.clearTimeout(engine.layerColdCompressionIdleTimer);
    engine.layerColdCompressionIdleTimer = null;
  }
}

export function releaseActiveColdDuplicate(engine: BrushEngine): void {
  const gpu = engine.requireLayerGpu(engine.layerStack.active.id);
  destroyLayerColdStorage(gpu.cold);
  gpu.cold = null;
  gpu.compressed = null;
}

export function pauseLayerColdCompressionIdle(engine: BrushEngine): void {
  clearLayerColdCompressionIdleTimer(engine);
}
