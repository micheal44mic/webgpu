/**
 * Importazione immagini come veri livelli raster autorevoli.
 *
 * Il decoder vive sul CPU soltanto fino all'ImageBitmap. Da quel momento la
 * conversione colore, il premultiply, l'eventuale riduzione e la scrittura nel
 * livello 4096² avvengono in WebGPU. Non viene creato alcun RasterImageNode:
 * dopo la Promise l'immagine è un normale LayerRecord, immediatamente
 * modificabile da Paint, Blend, Fill ed effetti raster.
 */
import type { BrushEngine } from "./brush-engine";
import type {
  MixedSceneItem,
  RasterImageNode,
} from "./mixed-scene-stack";
import {
  decodeRasterImage,
  releaseDecodedRasterImage,
  type RasterImageFormat,
} from "./raster-image-import";
import {
  rasterImageMipChainBytes,
  rasterImageMipLevelCount,
  RASTER_IMAGE_UNIFORM_BYTES,
} from "./raster-image-budget";
import {
  RASTER_IMAGE_LAYER_IMPORT_STRATEGY,
  rasterImageLayerBlitShader,
  rasterImageLayerUploadShader,
} from "./raster-image-layer-import-shader";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  encodeLayerColdHydration,
} from "./engine-cold-storage";
import {
  allocateLayerGpuResources,
  destroyLayerGpuResources,
} from "./engine-layer-runtime";
import type {
  LayerColdStorageResources,
  LayerGpuResources,
  LayerTextureResources,
} from "./engine-layer-resources";
import type { LayerRecord } from "./layer-stack";
import { LAYER_STACK_MAXIMUM } from "./layer-stack";
import {
  countLayerStorageTiles,
  LAYER_STORAGE_TILE_SIZE,
  markLayerStorageRect,
} from "./layer-storage-study";
import { LAYER_SIZE, MEBIBYTE_BYTES } from "./engine-limits";
import type { DirtyRect } from "./engine-stroke-types";
import type { LayerFormat } from "./engine-types";
import type {
  RasterImportHistoryAction,
  RasterImportSourceMetadata,
} from "./engine-history-types";
import {
  clearVectorTextPresentationForTransaction,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";

export const RASTER_IMAGE_GPU_STORAGE_STRATEGY =
  RASTER_IMAGE_LAYER_IMPORT_STRATEGY;

export { RASTER_IMAGE_UNIFORM_BYTES } from "./raster-image-budget";
export const RASTER_IMAGE_MAXIMUM_ENCODED_BYTES = 64 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_GPU_BYTES = 256 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES = 256 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES = 384 * 1024 * 1024;

const rasterImageImportsInFlight = new WeakSet<BrushEngine>();

/**
 * Payload autorevole che il chiamante inserisce nell'azione strutturale di
 * Undo/Redo. Il cold seed è una seconda copia immutabile dei soli tile toccati;
 * non è un asset immagine semantico e non partecipa al compositing live.
 */
export interface NativeRasterImageHistorySeed {
  readonly layerRecord: LayerRecord;
  readonly rasterLayerIndex: number;
  readonly sceneIndex: number;
  readonly selectedKeyBefore: MixedSceneItem["key"];
  readonly activeRasterLayerIdBefore: number;
  readonly seed: LayerColdStorageResources;
  readonly baseBounds: DirtyRect;
  readonly baseTileMask: Uint32Array;
  readonly source: RasterImportSourceMetadata;
}

export interface NativeRasterImageImportResult {
  readonly layerId: number;
  readonly layerIndex: number;
  readonly name: string;
  readonly sourceName: string;
  readonly mimeType: string;
  readonly sourceFormat: RasterImageFormat;
  readonly sourceBytes: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly bounds: DirtyRect;
  readonly tileCount: number;
}

export type RasterImageImportResult = NativeRasterImageImportResult;

/** Compatibility shape while the old semantic-image fields are removed. */
export interface RasterImageGpuResource {
  readonly assetId: string;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly width: number;
  readonly height: number;
  readonly mipLevelCount: number;
  readonly memoryBytes: number;
  readonly uniformUpload: Float32Array;
  uniformInitialized: boolean;
}

interface NativeImportPipelines {
  readonly sourceLayout: GPUBindGroupLayout;
  readonly blitLayout: GPUBindGroupLayout;
  readonly premultiplyPipeline: GPURenderPipeline;
  readonly mipmapPipeline: GPURenderPipeline;
  readonly blitPipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
}

interface TransientImageTextures {
  readonly straightTexture: GPUTexture;
  readonly premultipliedTexture: GPUTexture;
  readonly mipLevelCount: number;
  destroy(): void;
}

const pipelineCache = new WeakMap<GPUDevice, Map<LayerFormat, NativeImportPipelines>>();

function outputBoundsForImage(width: number, height: number): DirtyRect {
  const longestSide = Math.max(width, height);
  const scale = Math.min(1, LAYER_SIZE * 0.8 / longestSide);
  const outputWidth = Math.max(1, Math.min(LAYER_SIZE, Math.round(width * scale)));
  const outputHeight = Math.max(1, Math.min(LAYER_SIZE, Math.round(height * scale)));
  return {
    x: Math.floor((LAYER_SIZE - outputWidth) * 0.5),
    y: Math.floor((LAYER_SIZE - outputHeight) * 0.5),
    width: outputWidth,
    height: outputHeight,
  };
}

function tileCountForBounds(bounds: DirtyRect): number {
  const mask = new Uint32Array(8);
  markLayerStorageRect(mask, bounds);
  return countLayerStorageTiles(mask);
}

function requiredImportMipLevelCount(
  width: number,
  height: number,
  bounds: DirtyRect,
): number {
  const reduction = Math.max(width / bounds.width, height / bounds.height, 1);
  const highestSampledLevel = Math.ceil(Math.log2(reduction));
  return Math.min(
    rasterImageMipLevelCount(width, height),
    highestSampledLevel + 1,
  );
}

function logicalNativeImportPeakBytes(
  width: number,
  height: number,
  sourceBytes: number,
  bounds: DirtyRect,
  format: LayerFormat,
): number {
  const sourceBaseBytes = width * height * 4;
  const sourceMipLevelCount = requiredImportMipLevelCount(width, height, bounds);
  const layerBytesPerPixel = format === "rgba16float" ? 8 : 4;
  const destinationLayerBytes = LAYER_SIZE * LAYER_SIZE * layerBytesPerPixel;
  const historySeedBytes = tileCountForBounds(bounds)
    * LAYER_STORAGE_TILE_SIZE
    * LAYER_STORAGE_TILE_SIZE
    * layerBytesPerPixel;
  // Inspection buffer + decoded bitmap + straight upload + premultiplied mip
  // chain + the new hot layer + its immutable sparse history seed.
  const peak = sourceBytes
    + sourceBaseBytes
    + sourceBaseBytes
    + rasterImageMipChainBytes(width, height, sourceMipLevelCount)
    + destinationLayerBytes
    + historySeedBytes;
  if (!Number.isSafeInteger(peak)) {
    throw new Error("Il picco logico dell’importazione supera l’intervallo sicuro.");
  }
  return peak;
}

function nativeRasterImportResidentBytes(engine: BrushEngine): number {
  const actions = new Set([
    ...engine.historyActions,
    ...engine.discardedRasterImportHistoryActions,
  ]);
  const importedLayerIds = new Set<number>();
  const seeds = new Set<LayerColdStorageResources>();
  let bytes = rasterImageGpuMemoryBytes(engine);
  for (const action of actions) {
    if (action.kind !== "raster-import") continue;
    importedLayerIds.add(action.layerId);
    seeds.add(action.seed);
  }
  for (const seed of seeds) bytes += seed.memoryBytes;
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  for (const layerId of importedLayerIds) {
    const gpu = engine.layerGpu.get(layerId);
    if (!gpu) continue;
    if (gpu.hot) bytes += LAYER_SIZE * LAYER_SIZE * bytesPerPixel;
    bytes += gpu.cold?.memoryBytes ?? 0;
  }
  return bytes;
}

function outgoingActiveColdPeakBytes(engine: BrushEngine): number {
  const gpu = engine.layerGpu.get(engine.layerStack.active.id);
  if (!gpu?.hot || gpu.cold || !engine.layerStack.active.hasContent) return 0;
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  return countLayerStorageTiles(engine.layerStack.active.storageTileMask)
    * LAYER_STORAGE_TILE_SIZE
    * LAYER_STORAGE_TILE_SIZE
    * bytesPerPixel;
}

function assertNativeRasterImportBudgets(
  engine: BrushEngine,
  width: number,
  height: number,
  sourceBytes: number,
  bounds: DirtyRect,
): void {
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const newPersistentBytes = LAYER_SIZE * LAYER_SIZE * bytesPerPixel
    + tileCountForBounds(bounds)
      * LAYER_STORAGE_TILE_SIZE
      * LAYER_STORAGE_TILE_SIZE
      * bytesPerPixel;
  const resultingImportResidentBytes = nativeRasterImportResidentBytes(engine)
    + newPersistentBytes;
  if (resultingImportResidentBytes > RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES) {
    throw new Error(
      `Importazioni raster oltre il limite residente di `
      + `${RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES / MEBIBYTE_BYTES} MiB `
      + `(previsti ${(resultingImportResidentBytes / MEBIBYTE_BYTES).toFixed(1)} MiB).`,
    );
  }

  const countedGpuBytes = Math.round(
    engine.getStats().gpuMemory.countedTotalMiB * MEBIBYTE_BYTES,
  );
  const aggregatePeakBytes = countedGpuBytes
    + outgoingActiveColdPeakBytes(engine)
    + logicalNativeImportPeakBytes(width, height, sourceBytes, bounds, engine.layerFormat);
  if (aggregatePeakBytes > RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES) {
    throw new Error(
      `Immagine troppo grande per lo stato corrente: picco aggregato previsto `
      + `${(aggregatePeakBytes / MEBIBYTE_BYTES).toFixed(1)} MiB; limite `
      + `${RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES / MEBIBYTE_BYTES} MiB.`,
    );
  }
}

async function ensureNativeImportPipelines(
  engine: BrushEngine,
): Promise<NativeImportPipelines> {
  let byFormat = pipelineCache.get(engine.device);
  const cached = byFormat?.get(engine.layerFormat);
  if (cached) return cached;

  const created = await runGpuAllocationTransaction(
    engine.device,
    `Pipeline import raster nativo ${engine.layerFormat}`,
    () => {
      const uploadModule = engine.device.createShaderModule({
        label: "Native raster import straight-sRGB upload WGSL",
        code: rasterImageLayerUploadShader,
      });
      const blitModule = engine.device.createShaderModule({
        label: "Native raster import layer blit WGSL",
        code: rasterImageLayerBlitShader,
      });
      const sourceLayout = engine.device.createBindGroupLayout({
        label: "Native raster import source layout",
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "2d" },
        }],
      });
      const blitLayout = engine.device.createBindGroupLayout({
        label: "Native raster import blit layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float", viewDimension: "2d" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" },
          },
        ],
      });
      const uploadPipelineLayout = engine.device.createPipelineLayout({
        label: "Native raster import upload pipeline layout",
        bindGroupLayouts: [sourceLayout],
      });
      const blitPipelineLayout = engine.device.createPipelineLayout({
        label: "Native raster import blit pipeline layout",
        bindGroupLayouts: [blitLayout],
      });
      const premultiplyPipeline = engine.device.createRenderPipeline({
        label: "Native raster import linear premultiply",
        layout: uploadPipelineLayout,
        vertex: { module: uploadModule, entryPoint: "vertexMain" },
        fragment: {
          module: uploadModule,
          entryPoint: "fragmentPremultiplyMain",
          targets: [{ format: "rgba8unorm-srgb" }],
        },
        primitive: { topology: "triangle-list" },
      });
      const mipmapPipeline = engine.device.createRenderPipeline({
        label: "Native raster import exact NPOT mipmap",
        layout: uploadPipelineLayout,
        vertex: { module: uploadModule, entryPoint: "vertexMain" },
        fragment: {
          module: uploadModule,
          entryPoint: "fragmentMipmapMain",
          targets: [{ format: "rgba8unorm-srgb" }],
        },
        primitive: { topology: "triangle-list" },
      });
      const blitPipeline = engine.device.createRenderPipeline({
        label: `Native raster import into ${engine.layerFormat} layer`,
        layout: blitPipelineLayout,
        vertex: { module: blitModule, entryPoint: "vertexMain" },
        fragment: {
          module: blitModule,
          entryPoint: "fragmentMain",
          targets: [{ format: engine.layerFormat }],
        },
        primitive: { topology: "triangle-strip", cullMode: "none" },
      });
      const sampler = engine.device.createSampler({
        label: "Native raster import trilinear sampler",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        minFilter: "linear",
        magFilter: "linear",
        mipmapFilter: "linear",
        maxAnisotropy: 8,
      });
      return {
        sourceLayout,
        blitLayout,
        premultiplyPipeline,
        mipmapPipeline,
        blitPipeline,
        sampler,
      };
    },
  );
  byFormat ??= new Map<LayerFormat, NativeImportPipelines>();
  byFormat.set(engine.layerFormat, created);
  pipelineCache.set(engine.device, byFormat);
  return created;
}

async function createTransientImageTextures(
  engine: BrushEngine,
  width: number,
  height: number,
  bounds: DirtyRect,
): Promise<TransientImageTextures> {
  const mipLevelCount = requiredImportMipLevelCount(width, height, bounds);
  return runGpuAllocationTransaction(
    engine.device,
    `Texture transitorie import ${width}×${height}`,
    (transaction) => {
      const straightTexture = engine.device.createTexture({
        label: `Native import straight-sRGB ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: "rgba8unorm-srgb",
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      transaction.deferRollback(() => straightTexture.destroy());
      const premultipliedTexture = engine.device.createTexture({
        label: `Native import premultiplied-sRGB mips ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        mipLevelCount,
        format: "rgba8unorm-srgb",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      transaction.deferRollback(() => premultipliedTexture.destroy());
      return {
        straightTexture,
        premultipliedTexture,
        mipLevelCount,
        destroy(): void {
          straightTexture.destroy();
          premultipliedTexture.destroy();
        },
      };
    },
  );
}

async function encodeBitmapIntoLayer(
  engine: BrushEngine,
  bitmap: ImageBitmap,
  destination: LayerTextureResources,
  bounds: DirtyRect,
): Promise<TransientImageTextures> {
  const pipelines = await ensureNativeImportPipelines(engine);
  const transient = await createTransientImageTextures(
    engine,
    bitmap.width,
    bitmap.height,
    bounds,
  );
  try {
    engine.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      {
        texture: transient.straightTexture,
        colorSpace: "srgb",
        premultipliedAlpha: false,
      },
      { width: bitmap.width, height: bitmap.height, depthOrArrayLayers: 1 },
    );

    const encoder = engine.device.createCommandEncoder({
      label: `Import bitmap ${bitmap.width}×${bitmap.height} nel livello raster`,
    });
    const straightBindGroup = engine.device.createBindGroup({
      label: "Native import straight source bind group",
      layout: pipelines.sourceLayout,
      entries: [{ binding: 0, resource: transient.straightTexture.createView() }],
    });
    const premultiplyPass = encoder.beginRenderPass({
      label: "Native import sRGB straight to linear-premultiplied base",
      colorAttachments: [{
        view: transient.premultipliedTexture.createView({
          baseMipLevel: 0,
          mipLevelCount: 1,
        }),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    premultiplyPass.setPipeline(pipelines.premultiplyPipeline);
    premultiplyPass.setBindGroup(0, straightBindGroup);
    premultiplyPass.draw(3, 1, 0, 0);
    premultiplyPass.end();

    for (let level = 1; level < transient.mipLevelCount; level += 1) {
      const sourceView = transient.premultipliedTexture.createView({
        baseMipLevel: level - 1,
        mipLevelCount: 1,
      });
      const destinationView = transient.premultipliedTexture.createView({
        baseMipLevel: level,
        mipLevelCount: 1,
      });
      const bindGroup = engine.device.createBindGroup({
        label: `Native import mip ${level} bind group`,
        layout: pipelines.sourceLayout,
        entries: [{ binding: 0, resource: sourceView }],
      });
      const pass = encoder.beginRenderPass({
        label: `Native import exact NPOT mip ${level}`,
        colorAttachments: [{
          view: destinationView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(pipelines.mipmapPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
    }

    const blitBindGroup = engine.device.createBindGroup({
      label: "Native import complete mip-chain bind group",
      layout: pipelines.blitLayout,
      entries: [
        { binding: 0, resource: transient.premultipliedTexture.createView() },
        { binding: 1, resource: pipelines.sampler },
      ],
    });
    const blitPass = encoder.beginRenderPass({
      label: "Native import commit to authoritative paint layer",
      colorAttachments: [{
        view: destination.view,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    blitPass.setViewport(bounds.x, bounds.y, bounds.width, bounds.height, 0, 1);
    blitPass.setScissorRect(bounds.x, bounds.y, bounds.width, bounds.height);
    blitPass.setPipeline(pipelines.blitPipeline);
    blitPass.setBindGroup(0, blitBindGroup);
    blitPass.draw(4, 1, 0, 0);
    blitPass.end();
    engine.device.queue.submit([encoder.finish()]);
    return transient;
  } catch (error) {
    transient.destroy();
    throw error;
  }
}

async function restoreOriginalActiveAfterFailure(
  engine: BrushEngine,
  originalActiveId: number,
  candidateLayerId: number,
): Promise<void> {
  const candidateIndex = engine.layerStack.indexOfId(candidateLayerId);
  const originalIndex = engine.layerStack.indexOfId(originalActiveId);
  if (originalIndex < 0) {
    throw new Error("Livello attivo originale perso durante il rollback import.");
  }
  engine.layerStack.setActiveIndex(originalIndex);
  await engine.activateLayer(
    candidateIndex >= 0 ? candidateIndex : originalIndex,
    "layer-switch",
  );
}

async function importRasterImageFileUnlocked(
  engine: BrushEngine,
  file: File,
  commitHistory: (history: NativeRasterImageHistorySeed) => void,
): Promise<Readonly<NativeRasterImageImportResult>> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (file.size > RASTER_IMAGE_MAXIMUM_ENCODED_BYTES) {
    throw new Error("File immagine oltre il limite di 64 MiB.");
  }
  if (engine.layerStack.count >= LAYER_STACK_MAXIMUM) {
    throw new Error(`Massimo ${LAYER_STACK_MAXIMUM} livelli raggiunto.`);
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  let decoded: Awaited<ReturnType<typeof decodeRasterImage>> | null = null;
  try {
    await engine.waitForIdle();
    const maximumDimension = engine.device.limits.maxTextureDimension2D;
    decoded = await decodeRasterImage(file, {
      sourceName: file.name,
      limits: {
        maximumSourceBytes: RASTER_IMAGE_MAXIMUM_ENCODED_BYTES,
        maximumWidth: maximumDimension,
        maximumHeight: maximumDimension,
        maximumPixels: Math.floor(RASTER_IMAGE_MAXIMUM_GPU_BYTES / 4),
      },
      preflight: (inspection) => {
        const bounds = outputBoundsForImage(
          inspection.encodedWidth,
          inspection.encodedHeight,
        );
        const sourceMipBytes = rasterImageMipChainBytes(
          inspection.encodedWidth,
          inspection.encodedHeight,
          requiredImportMipLevelCount(
            inspection.encodedWidth,
            inspection.encodedHeight,
            bounds,
          ),
        );
        if (sourceMipBytes > RASTER_IMAGE_MAXIMUM_GPU_BYTES) {
          throw new Error(
            `Immagine troppo grande: la sorgente GPU transitoria richiederebbe `
            + `${(sourceMipBytes / 1024 / 1024).toFixed(1)} MiB.`,
          );
        }
        assertNativeRasterImportBudgets(
          engine,
          inspection.encodedWidth,
          inspection.encodedHeight,
          inspection.sourceBytes,
          bounds,
        );
      },
    });

    const metadata = decoded.metadata;
    const bounds = outputBoundsForImage(metadata.width, metadata.height);
    const decodedMipBytes = rasterImageMipChainBytes(
      metadata.width,
      metadata.height,
      requiredImportMipLevelCount(metadata.width, metadata.height, bounds),
    );
    if (decodedMipBytes > RASTER_IMAGE_MAXIMUM_GPU_BYTES) {
      throw new Error(
        `Immagine decodificata troppo grande: la sorgente GPU transitoria `
        + `richiederebbe ${(decodedMipBytes / 1024 / 1024).toFixed(1)} MiB.`,
      );
    }
    assertNativeRasterImportBudgets(
      engine,
      metadata.width,
      metadata.height,
      metadata.sourceBytes,
      bounds,
    );
    const scene = requireMixedSceneStack(engine);
    const originalActiveId = engine.layerStack.active.id;
    const selectedKeyBefore = scene.selected.key;
    if (
      scene.selected.kind === "raster"
      && scene.selected.rasterLayerId !== originalActiveId
    ) {
      throw new Error(
        `Invariante import: raster selezionato ${scene.selected.rasterLayerId}, `
        + `ma raster attivo ${originalActiveId}.`,
      );
    }
    const excludedNodeBefore = engine.vectorTextPreviewExcludedNodeId;
    const sceneIndex = scene.indexOfKey(selectedKeyBefore) + 1;
    const rasterLayerIndex = scene.rasterIndexForSceneIndex(sceneIndex);
    let recordId: number | null = null;
    let gpu: LayerGpuResources | null = null;
    let seed: LayerColdStorageResources | null = null;
    let transient: TransientImageTextures | null = null;
    let sceneInserted = false;
    try {
      engine.persistActiveLayerState();
      await engine.prepareActiveLayerForSwitch();
      const insertedIndex = engine.layerStack.insertAt(
        rasterLayerIndex,
        metadata.sourceName || "Immagine raster",
      );
      const record = engine.layerStack.at(insertedIndex);
      recordId = record.id;
      gpu = await allocateLayerGpuResources(
        engine,
        engine.layerFormat,
        `Allocazione import raster livello ${record.id}`,
      );
      engine.layerGpu.set(record.id, gpu);
      const hot = gpu.hot;
      if (!hot) throw new Error("Texture hot del livello importato mancante.");

      transient = await encodeBitmapIntoLayer(engine, decoded.bitmap, hot, bounds);
      record.contentBounds = { ...bounds };
      record.hasContent = true;
      record.storageTileMask.fill(0);
      markLayerStorageRect(record.storageTileMask, bounds);
      seed = await createLayerColdStorageCandidate(
        engine,
        record,
        hot,
        record.storageTileMask.slice(),
        1,
      );
      transient.destroy();
      transient = null;

      scene.addRasterAboveSelection(record.id);
      sceneInserted = true;
      engine.vectorTextPreviewExcludedNodeId = null;
      clearVectorTextPresentationForTransaction(engine);
      const previousIndexAfterInsertion = engine.layerStack.indexOfId(originalActiveId);
      if (previousIndexAfterInsertion < 0) {
        throw new Error("Livello attivo precedente perso durante l’importazione.");
      }
      const activation = await engine.activateLayer(
        previousIndexAfterInsertion,
        "layer-switch",
      );
      engine.clearVectorTextPresentation();
      engine.publishActiveLayerChange();

      const historySeed: NativeRasterImageHistorySeed = {
        layerRecord: record,
        rasterLayerIndex,
        sceneIndex,
        selectedKeyBefore,
        activeRasterLayerIdBefore: originalActiveId,
        seed,
        baseBounds: { ...bounds },
        baseTileMask: record.storageTileMask.slice(),
        source: {
          sourceName: metadata.sourceName,
          mimeType: metadata.mimeType,
          width: metadata.width,
          height: metadata.height,
        },
      };
      const publicResult = Object.freeze({
        layerId: record.id,
        layerIndex: activation.toIndex,
        name: record.name,
        sourceName: metadata.sourceName,
        mimeType: metadata.mimeType,
        sourceFormat: metadata.format,
        sourceBytes: metadata.sourceBytes,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        bounds: { ...bounds },
        tileCount: countLayerStorageTiles(record.storageTileMask),
      });
      // Journal publication is the final transactional step. If it throws,
      // the enclosing catch still owns `seed` and removes the live layer.
      commitHistory(historySeed);
      seed = null;
      return publicResult;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      transient?.destroy();
      if (sceneInserted && recordId !== null) {
        try {
          scene.removeRaster(recordId, originalActiveId);
          scene.select(selectedKeyBefore);
          engine.vectorTextPreviewExcludedNodeId = excludedNodeBefore;
          clearVectorTextPresentationForTransaction(engine);
        } catch (sceneError) {
          rollbackErrors.push(sceneError);
        }
      }
      if (recordId !== null) {
        const candidateIndex = engine.layerStack.indexOfId(recordId);
        if (candidateIndex >= 0) {
          try {
            if (gpu) {
              await restoreOriginalActiveAfterFailure(
                engine,
                originalActiveId,
                recordId,
              );
            } else {
              engine.layerStack.remove(candidateIndex);
              const restoredOriginalIndex = engine.layerStack.indexOfId(originalActiveId);
              if (restoredOriginalIndex < 0) {
                throw new Error("Livello originale assente dopo il rollback import.");
              }
              engine.layerStack.setActiveIndex(restoredOriginalIndex);
              await engine.activateLayer(restoredOriginalIndex, "layer-switch");
            }
          } catch (restoreError) {
            rollbackErrors.push(restoreError);
          }
          const stillAttached = engine.layerStack.indexOfId(recordId);
          if (stillAttached >= 0 && engine.layerStack.active.id !== recordId) {
            engine.layerStack.remove(stillAttached);
          }
        }
        const candidateGpu = engine.layerGpu.get(recordId);
        if (candidateGpu) {
          engine.layerGpu.delete(recordId);
          destroyLayerGpuResources(engine, candidateGpu);
        }
      }
      destroyLayerColdStorage(seed);
      if (rollbackErrors.length > 0) {
        engine.latchDocumentStateInconsistent(
          "Importazione raster fallita e rollback incompleto: ricarica la pagina.",
        );
        const details = rollbackErrors.map((failure) =>
          failure instanceof Error ? failure.message : String(failure)
        ).join("; ");
        throw new Error(`Importazione raster fallita; rollback fallito: ${details}`);
      }
      throw error;
    }
  } finally {
    if (decoded) releaseDecodedRasterImage(decoded);
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    // Presentation callbacks are observers, not part of the import commit.
    // A UI exception must not report a failed import after layer+history are
    // already atomically published.
    try {
      engine.publishHistoryState();
      engine.publishStats();
      publishMixedScene(engine);
    } catch (publicationError) {
      console.error("Pubblicazione UI dopo import raster non riuscita", publicationError);
    }
  }
}

export async function importRasterImageFile(
  engine: BrushEngine,
  file: File,
  commitHistory: (history: NativeRasterImageHistorySeed) => void,
): Promise<Readonly<NativeRasterImageImportResult>> {
  if (rasterImageImportsInFlight.has(engine)) {
    throw new Error("È già in corso un’importazione immagine.");
  }
  rasterImageImportsInFlight.add(engine);
  try {
    return await importRasterImageFileUnlocked(engine, file, commitHistory);
  } finally {
    rasterImageImportsInFlight.delete(engine);
  }
}

async function switchActiveForRasterImportHistory(
  engine: BrushEngine,
  targetIndex: number,
): Promise<void> {
  if (engine.layerStack.activeIndex === targetIndex) return;
  const previousIndex = engine.layerStack.activeIndex;
  engine.persistActiveLayerState();
  await engine.prepareActiveLayerForSwitch();
  engine.layerStack.setActiveIndex(targetIndex);
  try {
    await engine.activateLayer(previousIndex, "structural-history");
  } catch (error) {
    engine.layerStack.setActiveIndex(previousIndex);
    try {
      await engine.activateLayer(targetIndex, "structural-history");
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "Cambio livello fallito durante Undo/Redo dell’importazione raster.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(`${first}; rollback cambio livello fallito: ${second}`);
    }
    throw error;
  }
}

async function hydrateRasterImportSeed(
  engine: BrushEngine,
  action: RasterImportHistoryAction,
): Promise<LayerGpuResources> {
  const gpu = await allocateLayerGpuResources(
    engine,
    engine.layerFormat,
    `Reidratazione import raster storico livello ${action.layerId}`,
  );
  const hot = gpu.hot;
  if (!hot) {
    destroyLayerGpuResources(engine, gpu);
    throw new Error("Texture hot della cronologia import raster mancante.");
  }
  try {
    const encoder = engine.device.createCommandEncoder({
      label: `Reidratazione seed import raster livello ${action.layerId}`,
    });
    encodeLayerColdHydration(encoder, action.seed, hot);
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped("Reidratazione import raster", 60_000);
    return gpu;
  } catch (error) {
    destroyLayerGpuResources(engine, gpu);
    throw error;
  }
}

async function undoRasterImport(
  engine: BrushEngine,
  action: RasterImportHistoryAction,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const sceneState = scene.captureState();
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  const originalActiveId = engine.layerStack.active.id;
  const targetIndex = engine.layerStack.indexOfId(action.layerId);
  if (targetIndex < 0) throw new Error("Livello importato da annullare non presente.");
  if (engine.layerStack.at(targetIndex) !== action.layerRecord) {
    throw new Error("Record dell’import raster storico sostituito inaspettatamente.");
  }
  const fallbackIndexBeforeSwitch = engine.layerStack.indexOfId(
    action.activeRasterLayerIdBefore,
  );
  if (fallbackIndexBeforeSwitch < 0 || action.activeRasterLayerIdBefore === action.layerId) {
    throw new Error("Raster attivo precedente all’importazione non più disponibile.");
  }
  const gpu = engine.layerGpu.get(action.layerId);
  if (!gpu) throw new Error("Risorse del livello importato da staccare mancanti.");
  const currentSceneIndex = scene.indexOfKey(`raster:${action.layerId}`);
  if (currentSceneIndex < 0) {
    throw new Error("Livello importato assente dalla scena mista durante Undo.");
  }
  await switchActiveForRasterImportHistory(engine, targetIndex);
  const activeTargetIndex = engine.layerStack.indexOfId(action.layerId);
  const fallbackIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
  try {
    scene.removeRaster(action.layerId, action.activeRasterLayerIdBefore);
    if (scene.indexOfKey(action.selectedKeyBefore) >= 0) {
      scene.select(action.selectedKeyBefore);
    }
    engine.vectorTextPreviewExcludedNodeId = scene.selected.kind === "text"
      ? scene.selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.layerStack.setActiveIndex(fallbackIndex);
    await engine.activateLayer(activeTargetIndex, "structural-history");
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      scene.restoreState(sceneState);
      engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      clearVectorTextPresentationForTransaction(engine);
      const restoredTargetIndex = engine.layerStack.indexOfId(action.layerId);
      if (engine.layerStack.active.id !== action.layerId) {
        const previousIndex = engine.layerStack.activeIndex;
        engine.layerStack.setActiveIndex(restoredTargetIndex);
        await engine.activateLayer(previousIndex, "structural-history");
      }
      if (originalActiveId !== action.layerId) {
        const originalIndex = engine.layerStack.indexOfId(originalActiveId);
        if (originalIndex < 0) throw new Error("Raster attivo originale perso nel rollback Undo.");
        await switchActiveForRasterImportHistory(engine, originalIndex);
      }
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    if (rollbackErrors.length > 0) {
      engine.latchDocumentStateInconsistent(
        "Undo import raster fallito e rollback incompleto: ricarica la pagina.",
      );
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      throw new Error(`${operationMessage}; rollback Undo import fallito: ${rollbackMessage}`);
    }
    throw error;
  }

  const detachedIndex = engine.layerStack.indexOfId(action.layerId);
  const detached = engine.layerStack.remove(detachedIndex);
  if (detached !== action.layerRecord) throw new Error("Detach import raster incoerente.");
  engine.layerGpu.delete(action.layerId);
  destroyLayerGpuResources(engine, gpu);
  // Layer additions/reorders are not journal actions. Capture the position at
  // the actual detach so Redo restores the order that existed just before Undo.
  action.rasterLayerIndex = targetIndex;
  action.sceneIndex = currentSceneIndex;
  engine.clearVectorTextPresentation();
  engine.publishActiveLayerChange();
}

async function redoRasterImport(
  engine: BrushEngine,
  action: RasterImportHistoryAction,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const sceneState = scene.captureState();
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  const originalActiveId = engine.layerStack.active.id;
  if (engine.layerStack.indexOfId(action.layerId) >= 0) {
    throw new Error("Livello importato già presente durante Redo.");
  }
  engine.persistActiveLayerState();
  await engine.prepareActiveLayerForSwitch();
  let gpu: LayerGpuResources | null = null;
  let attached = false;
  try {
    gpu = await hydrateRasterImportSeed(engine, action);
    action.layerRecord.contentBounds = { ...action.baseBounds };
    action.layerRecord.hasContent = true;
    action.layerRecord.storageTileMask.set(action.baseTileMask);
    const rasterInsertionIndex = Math.min(action.rasterLayerIndex, engine.layerStack.count);
    const sceneInsertionIndex = Math.min(action.sceneIndex, scene.items.length);
    engine.layerStack.attach(action.layerRecord, rasterInsertionIndex);
    attached = true;
    engine.layerGpu.set(action.layerId, gpu);
    scene.insertRasterAt(action.layerId, sceneInsertionIndex, true);
    engine.vectorTextPreviewExcludedNodeId = null;
    clearVectorTextPresentationForTransaction(engine);
    const previousIndexAfterInsertion = engine.layerStack.indexOfId(originalActiveId);
    await engine.activateLayer(previousIndexAfterInsertion, "structural-history");
    action.rasterLayerIndex = engine.layerStack.indexOfId(action.layerId);
    action.sceneIndex = scene.indexOfKey(`raster:${action.layerId}`);
    engine.clearVectorTextPresentation();
    engine.publishActiveLayerChange();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      scene.restoreState(sceneState);
      engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
      clearVectorTextPresentationForTransaction(engine);
      if (attached) {
        await restoreOriginalActiveAfterFailure(engine, originalActiveId, action.layerId);
        const index = engine.layerStack.indexOfId(action.layerId);
        if (index >= 0 && engine.layerStack.active.id !== action.layerId) {
          engine.layerStack.remove(index);
        }
      } else {
        const originalIndex = engine.layerStack.indexOfId(originalActiveId);
        if (originalIndex < 0) throw new Error("Raster attivo originale perso nel rollback Redo.");
        // prepareActiveLayerForSwitch() has already frozen presentation and may
        // have evicted mip 0 even though the selected id never changed. Always
        // run the complete activation path to rehydrate and rebind the original.
        const previousIndex = engine.layerStack.activeIndex;
        engine.layerStack.setActiveIndex(originalIndex);
        await engine.activateLayer(previousIndex, "structural-history");
      }
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    const candidateStillAttached = engine.layerStack.indexOfId(action.layerId) >= 0;
    if (!candidateStillAttached) {
      engine.layerGpu.delete(action.layerId);
      if (gpu) destroyLayerGpuResources(engine, gpu);
    }
    if (rollbackErrors.length > 0) {
      engine.latchDocumentStateInconsistent(
        "Redo import raster fallito e rollback incompleto: ricarica la pagina.",
      );
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      throw new Error(`${operationMessage}; rollback Redo import fallito: ${rollbackMessage}`);
    }
    throw error;
  }
}

export async function applyRasterImportHistory(
  engine: BrushEngine,
  action: RasterImportHistoryAction,
  delta: -1 | 1,
): Promise<void> {
  engine.layerSwitchBusy = true;
  try {
    if (delta < 0) await undoRasterImport(engine, action);
    else await redoRasterImport(engine, action);
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.publishStats();
    publishMixedScene(engine);
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
  }
}

export function destroyRasterImportHistorySeed(action: RasterImportHistoryAction): void {
  destroyLayerColdStorage(action.seed);
}

/*
 * Ponti temporanei per i chiamanti rimossi dalla migrazione. Non creano né
 * mutano nodi immagine: un eventuale uso indica che la UI sta ancora tentando
 * di percorrere il vecchio modello semantico.
 */
function semanticImageModelRemoved(): never {
  throw new Error("Le immagini importate sono livelli raster nativi, non nodi semantici.");
}

export function updateRasterImageNode(
  _engine: BrushEngine,
  _id: number,
  _update: Partial<
    Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">
  >,
): Readonly<RasterImageNode> {
  return semanticImageModelRemoved();
}

export async function setRasterImageNodeVisibility(
  _engine: BrushEngine,
  _id: number,
  _visible: boolean,
): Promise<boolean> {
  return semanticImageModelRemoved();
}

export async function setRasterImageNodeOpacity(
  _engine: BrushEngine,
  _id: number,
  _opacity: number,
): Promise<boolean> {
  return semanticImageModelRemoved();
}

export async function moveRasterImageNode(
  _engine: BrushEngine,
  _id: number,
  _delta: -1 | 1,
): Promise<boolean> {
  return semanticImageModelRemoved();
}

export async function deleteRasterImageNode(
  _engine: BrushEngine,
  _id: number,
): Promise<Readonly<RasterImageNode>> {
  return semanticImageModelRemoved();
}

export function rasterImageBindGroupForNode(
  _engine: BrushEngine,
  _node: Readonly<RasterImageNode>,
): GPUBindGroup | null {
  return semanticImageModelRemoved();
}

export function rasterImageGpuMemoryBytes(engine: BrushEngine): number {
  // Nuove importazioni non entrano mai in questo registro. Sommare eventuali
  // residui mantiene corretta la diagnostica durante HMR finché il campo viene
  // eliminato del tutto da BrushEngine.
  let bytes = 0;
  for (const resource of engine.rasterImageGpuResources.values()) {
    bytes += resource.memoryBytes;
  }
  return bytes;
}
