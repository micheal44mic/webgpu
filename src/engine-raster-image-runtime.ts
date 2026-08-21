/**
 * Importazione immagini come veri livelli raster autorevoli.
 *
 * Il decoder vive sul CPU soltanto fino all'ImageBitmap. Da quel momento la
 * conversione colore, il premultiply, l'eventuale riduzione e la scrittura nel
 * livello delle dimensioni del documento avvengono in WebGPU. Non viene creato
 * alcun RasterImageNode:
 * dopo la Promise l'immagine è un normale LayerRecord, immediatamente
 * modificabile da Paint, Blend, Fill ed effetti raster.
 */
import type { BrushEngine } from "./brush-engine";
import type {
  MixedSceneItem,
} from "./mixed-scene-stack";
import type { RasterImageDocument, RasterImageNode } from "./scene-image-model";
import {
  decodeRasterImage,
  releaseDecodedRasterImage,
  type RasterImageFormat,
} from "./raster-image-import";
import {
  RASTER_IMAGE_DECODED_BYTES_PER_PIXEL,
  rasterImageMipChainBytes,
  rasterImageMipLevelCount,
} from "./raster-image-budget";
import {
  RASTER_IMAGE_LAYER_IMPORT_STRATEGY,
  rasterImageLayerBlitShader,
  rasterImageLayerRebuildShader,
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
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_WIDTH,
  markLayerStorageRect,
} from "./layer-storage-study";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH, MEBIBYTE_BYTES } from "./engine-limits";
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
import { historyColdSeedResidentBytes } from "./history-cold-seed";
import {
  cloneRasterLayerSource,
  rasterLayerSourceBounds,
  type RasterLayerSource,
} from "./raster-layer-source";

export const RASTER_IMAGE_GPU_STORAGE_STRATEGY =
  RASTER_IMAGE_LAYER_IMPORT_STRATEGY;

export { RASTER_IMAGE_UNIFORM_BYTES } from "./raster-image-budget";
export const RASTER_IMAGE_MAXIMUM_ENCODED_BYTES = 64 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_GPU_BYTES = 256 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES = 256 * 1024 * 1024;

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
  readonly rasterSource: RasterLayerSource;
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

/** Immutable master pixels retained separately from the native raster cache. */
export interface RasterImageGpuResource {
  readonly assetId: string;
  readonly sourceBlob: Blob;
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly rebuildBindGroup: GPUBindGroup;
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
  readonly rebuildLayout: GPUBindGroupLayout;
  readonly premultiplyPipeline: GPURenderPipeline;
  readonly mipmapPipeline: GPURenderPipeline;
  readonly blitPipeline: GPURenderPipeline;
  readonly rebuildPipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
}

interface TransientImageTextures {
  readonly straightTexture: GPUTexture;
  readonly premultipliedTexture: GPUTexture;
  readonly mipLevelCount: number;
  destroy(): void;
}

const pipelineCache = new WeakMap<GPUDevice, Map<LayerFormat, NativeImportPipelines>>();

function allocateRasterLayerAssetId(engine: BrushEngine): string {
  let assetId: string;
  do {
    assetId = `raster-layer-source-${engine.nextRasterImageAssetId++}`;
  } while (engine.rasterImageGpuResources.has(assetId));
  return assetId;
}

function outputBoundsForImage(width: number, height: number): DirtyRect {
  const scale = Math.min(1, DOCUMENT_WIDTH / width, DOCUMENT_HEIGHT / height);
  const outputWidth = Math.max(1, Math.min(DOCUMENT_WIDTH, Math.round(width * scale)));
  const outputHeight = Math.max(1, Math.min(DOCUMENT_HEIGHT, Math.round(height * scale)));
  return {
    x: Math.floor((DOCUMENT_WIDTH - outputWidth) * 0.5),
    y: Math.floor((DOCUMENT_HEIGHT - outputHeight) * 0.5),
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
  _bounds: DirtyRect,
): number {
  // Keep the complete master pyramid. Future matrix-only transforms may make
  // the element much smaller than its initial placement and must never derive
  // a missing tier from the already-resampled document cache.
  return rasterImageMipLevelCount(width, height);
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
  for (const seed of seeds) bytes += historyColdSeedResidentBytes(seed);
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  for (const layerId of importedLayerIds) {
    const gpu = engine.layerGpu.get(layerId);
    if (!gpu) continue;
    if (gpu.hot) bytes += DOCUMENT_WIDTH * DOCUMENT_HEIGHT * bytesPerPixel;
    bytes += gpu.cold?.memoryBytes ?? 0;
  }
  return bytes;
}

function assertNativeRasterImportResidentBudget(
  engine: BrushEngine,
  bounds: DirtyRect,
  immutableSourceBytes = 0,
): void {
  const bytesPerPixel = engine.layerFormat === "rgba16float" ? 8 : 4;
  const newPersistentBytes = DOCUMENT_WIDTH * DOCUMENT_HEIGHT * bytesPerPixel
    + tileCountForBounds(bounds)
      * LAYER_STORAGE_TILE_WIDTH
      * LAYER_STORAGE_TILE_HEIGHT
      * bytesPerPixel
    + immutableSourceBytes;
  const resultingImportResidentBytes = nativeRasterImportResidentBytes(engine)
    + newPersistentBytes;
  if (resultingImportResidentBytes > RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES) {
    throw new Error(
      `Raster imports exceed the resident limit of `
      + `${RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES / MEBIBYTE_BYTES} MiB `
      + `(projected ${(resultingImportResidentBytes / MEBIBYTE_BYTES).toFixed(1)} MiB).`,
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
    `Native raster import pipeline ${engine.layerFormat}`,
    () => {
      const uploadModule = engine.device.createShaderModule({
        label: "Native raster import straight-sRGB upload WGSL",
        code: rasterImageLayerUploadShader,
      });
      const blitModule = engine.device.createShaderModule({
        label: "Native raster import layer blit WGSL",
        code: rasterImageLayerBlitShader,
      });
      const rebuildModule = engine.device.createShaderModule({
        label: "Immutable raster master document rebuild WGSL",
        code: rasterImageLayerRebuildShader,
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
      const rebuildLayout = engine.device.createBindGroupLayout({
        label: "Immutable raster master rebuild layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float", viewDimension: "2d" },
          },
          {
            binding: 2,
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
      const rebuildPipelineLayout = engine.device.createPipelineLayout({
        label: "Immutable raster master rebuild pipeline layout",
        bindGroupLayouts: [rebuildLayout],
      });
      const premultiplyPipeline = engine.device.createRenderPipeline({
        label: "Native raster import linear premultiply",
        layout: uploadPipelineLayout,
        vertex: { module: uploadModule, entryPoint: "vertexMain" },
        fragment: {
          module: uploadModule,
          entryPoint: "fragmentPremultiplyMain",
          targets: [{ format: "rgba16float" }],
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
          targets: [{ format: "rgba16float" }],
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
      const rebuildPipeline = engine.device.createRenderPipeline({
        label: `Immutable raster master rebuild into ${engine.layerFormat}`,
        layout: rebuildPipelineLayout,
        vertex: { module: rebuildModule, entryPoint: "vertexMain" },
        fragment: {
          module: rebuildModule,
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
        rebuildLayout,
        premultiplyPipeline,
        mipmapPipeline,
        blitPipeline,
        rebuildPipeline,
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
    `Transient import textures ${width}×${height}`,
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
        label: `Immutable gamma-premultiplied RGBA16F master mips ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        mipLevelCount,
        format: "rgba16float",
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
      label: `Import ${bitmap.width}×${bitmap.height} bitmap into raster layer`,
    });
    const straightBindGroup = engine.device.createBindGroup({
      label: "Native import straight source bind group",
      layout: pipelines.sourceLayout,
      entries: [{ binding: 0, resource: transient.straightTexture.createView() }],
    });
    const premultiplyPass = encoder.beginRenderPass({
      label: "Native import straight sRGB to gamma-premultiplied master base",
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

async function encodeBitmapToImmutableMaster(
  engine: BrushEngine,
  bitmap: ImageBitmap,
): Promise<TransientImageTextures> {
  const pipelines = await ensureNativeImportPipelines(engine);
  const transient = await createTransientImageTextures(
    engine,
    bitmap.width,
    bitmap.height,
    outputBoundsForImage(bitmap.width, bitmap.height),
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
      label: `Restore immutable raster master ${bitmap.width}×${bitmap.height}`,
    });
    const baseBindGroup = engine.device.createBindGroup({
      label: "Restored immutable raster master base bind group",
      layout: pipelines.sourceLayout,
      entries: [{ binding: 0, resource: transient.straightTexture.createView() }],
    });
    const basePass = encoder.beginRenderPass({
      label: "Restored straight sRGB to gamma-premultiplied master base",
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
    basePass.setPipeline(pipelines.premultiplyPipeline);
    basePass.setBindGroup(0, baseBindGroup);
    basePass.draw(3, 1, 0, 0);
    basePass.end();
    for (let level = 1; level < transient.mipLevelCount; level += 1) {
      const bindGroup = engine.device.createBindGroup({
        label: `Restored immutable raster master mip ${level} bind group`,
        layout: pipelines.sourceLayout,
        entries: [{
          binding: 0,
          resource: transient.premultipliedTexture.createView({
            baseMipLevel: level - 1,
            mipLevelCount: 1,
          }),
        }],
      });
      const pass = encoder.beginRenderPass({
        label: `Restored immutable raster master exact mip ${level}`,
        colorAttachments: [{
          view: transient.premultipliedTexture.createView({
            baseMipLevel: level,
            mipLevelCount: 1,
          }),
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
    engine.device.queue.submit([encoder.finish()]);
    return transient;
  } catch (error) {
    transient.destroy();
    throw error;
  }
}

function createRasterImageGpuResource(
  engine: BrushEngine,
  assetId: string,
  sourceBlob: Blob,
  source: TransientImageTextures,
  width: number,
  height: number,
  pipelines: NativeImportPipelines,
): RasterImageGpuResource {
  const uniformBuffer = engine.device.createBuffer({
    label: `Immutable raster master matrix ${assetId}`,
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const view = source.premultipliedTexture.createView({
    label: `Immutable raster master complete mip view ${assetId}`,
  });
  const rebuildBindGroup = engine.device.createBindGroup({
    label: `Immutable raster master rebuild bind group ${assetId}`,
    layout: pipelines.rebuildLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: view },
      { binding: 2, resource: pipelines.sampler },
    ],
  });
  return {
    assetId,
    sourceBlob,
    texture: source.premultipliedTexture,
    view,
    uniformBuffer,
    // Semantic image nodes have been removed. Keep this compatibility field
    // pointing at the same immutable-source binding until that ABI disappears.
    bindGroup: rebuildBindGroup,
    rebuildBindGroup,
    width,
    height,
    mipLevelCount: source.mipLevelCount,
    memoryBytes: rasterImageMipChainBytes(width, height, source.mipLevelCount) + 32,
    uniformUpload: new Float32Array(8),
    uniformInitialized: false,
  };
}

function initialRasterLayerSource(
  document: RasterImageDocument,
  bounds: DirtyRect,
): RasterLayerSource {
  return {
    document: { ...document },
    x: bounds.x + bounds.width * 0.5,
    y: bounds.y + bounds.height * 0.5,
    scale: Math.min(
      bounds.width / document.width,
      bounds.height / document.height,
    ),
    rotation: 0,
  };
}

function writeRasterSourceUniform(
  engine: BrushEngine,
  resource: RasterImageGpuResource,
  source: Readonly<RasterLayerSource>,
): void {
  const upload = resource.uniformUpload;
  upload[0] = Math.fround(source.x);
  upload[1] = Math.fround(source.y);
  upload[2] = Math.fround(source.document.width * source.scale * 0.5);
  upload[3] = Math.fround(source.document.height * source.scale * 0.5);
  upload[4] = Math.fround(Math.cos(source.rotation));
  upload[5] = Math.fround(Math.sin(source.rotation));
  upload[6] = 0;
  upload[7] = 0;
  engine.device.queue.writeBuffer(resource.uniformBuffer, 0, upload);
  resource.uniformInitialized = true;
}

/**
 * Rebuilds the active layer's native Paint/Fill cache from its immutable
 * imported master. The source texture is never a render target.
 */
export async function rebuildRasterLayerFromImmutableSource(
  engine: BrushEngine,
  record: LayerRecord,
): Promise<DirtyRect | null> {
  const source = record.rasterSource;
  if (!source) throw new Error(`Layer ${record.name} has no immutable raster master.`);
  if (engine.layerStack.active.id !== record.id) {
    throw new Error("The raster cache can only be rebuilt on the active layer.");
  }
  const resource = engine.rasterImageGpuResources.get(source.document.assetId);
  if (!resource) {
    throw new Error(`Raster master ${source.document.assetId} is unavailable.`);
  }
  const hot = engine.requireLayerGpu(record.id).hot;
  if (!hot) throw new Error("The raster layer hot texture required for rebuilding is missing.");
  const pipelines = await ensureNativeImportPipelines(engine);
  const previousBounds = record.contentBounds ? { ...record.contentBounds } : null;
  const bounds = rasterLayerSourceBounds(source, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
  writeRasterSourceUniform(engine, resource, source);
  const encoder = engine.device.createCommandEncoder({
    label: `Rebuild raster layer ${record.id} from immutable master`,
  });
  const pass = encoder.beginRenderPass({
    label: `Immutable master to native raster cache ${record.id}`,
    colorAttachments: [{
      view: hot.view,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  if (bounds) {
    pass.setPipeline(pipelines.rebuildPipeline);
    pass.setBindGroup(0, resource.rebuildBindGroup);
    pass.draw(4, 1, 0, 0);
  }
  pass.end();
  engine.device.queue.submit([encoder.finish()]);

  record.contentBounds = bounds ? { ...bounds } : null;
  record.hasContent = Boolean(bounds);
  record.storageTileMask.fill(0);
  if (bounds) markLayerStorageRect(record.storageTileMask, bounds);
  engine.layerContentBounds = bounds ? { ...bounds } : null;
  engine.layerHasContent = Boolean(bounds);
  engine.paintDisplayMipValidThroughLevel = 0;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.displayDirty = true;
  engine.requestRender();

  if (!previousBounds) return bounds ? { ...bounds } : null;
  if (!bounds) return previousBounds;
  const left = Math.min(previousBounds.x, bounds.x);
  const top = Math.min(previousBounds.y, bounds.y);
  const right = Math.max(previousBounds.x + previousBounds.width, bounds.x + bounds.width);
  const bottom = Math.max(previousBounds.y + previousBounds.height, bounds.y + bounds.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Restores one project/history master without touching any document layer. */
export async function installRasterLayerSourceResource(
  engine: BrushEngine,
  source: Readonly<RasterLayerSource>,
  sourceBlob: Blob,
): Promise<RasterImageGpuResource> {
  const existing = engine.rasterImageGpuResources.get(source.document.assetId);
  if (existing) {
    if (
      existing.width !== source.document.width
      || existing.height !== source.document.height
    ) {
      throw new Error(`Inconsistent duplicate raster asset: ${source.document.assetId}.`);
    }
    return existing;
  }
  if (sourceBlob.size !== source.document.sourceBytes) {
    throw new Error(`Raster master ${source.document.assetId} has inconsistent byte length.`);
  }
  let decoded: Awaited<ReturnType<typeof decodeRasterImage>> | null = null;
  let transient: TransientImageTextures | null = null;
  let resource: RasterImageGpuResource | null = null;
  try {
    decoded = await decodeRasterImage(sourceBlob, {
      sourceName: source.document.sourceName,
      limits: {
        maximumSourceBytes: RASTER_IMAGE_MAXIMUM_ENCODED_BYTES,
        maximumWidth: engine.device.limits.maxTextureDimension2D,
        maximumHeight: engine.device.limits.maxTextureDimension2D,
        maximumPixels: Math.floor(
          RASTER_IMAGE_MAXIMUM_GPU_BYTES / RASTER_IMAGE_DECODED_BYTES_PER_PIXEL,
        ),
      },
    });
    if (
      decoded.metadata.width !== source.document.width
      || decoded.metadata.height !== source.document.height
      || decoded.metadata.mimeType !== source.document.mimeType
    ) {
      throw new Error(`Raster master ${source.document.assetId} has inconsistent metadata.`);
    }
    transient = await encodeBitmapToImmutableMaster(engine, decoded.bitmap);
    releaseDecodedRasterImage(decoded);
    decoded = null;
    await engine.waitForGpuCapped("Restore raster master", 60_000);
    resource = createRasterImageGpuResource(
      engine,
      source.document.assetId,
      sourceBlob.slice(0, sourceBlob.size, source.document.mimeType),
      transient,
      source.document.width,
      source.document.height,
      await ensureNativeImportPipelines(engine),
    );
    transient.straightTexture.destroy();
    transient = null;
    engine.rasterImageGpuResources.set(resource.assetId, resource);
    return resource;
  } catch (error) {
    if (decoded) releaseDecodedRasterImage(decoded);
    transient?.destroy();
    if (resource) {
      resource.uniformBuffer.destroy();
      resource.texture.destroy();
    }
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
    throw new Error("The original active layer was lost during import rollback.");
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
  if (!engine.initialized) throw new Error("The engine is not initialized yet.");
  if (file.size > RASTER_IMAGE_MAXIMUM_ENCODED_BYTES) {
    throw new Error("The image file exceeds the 64 MiB limit.");
  }
  if (engine.layerStack.count >= LAYER_STACK_MAXIMUM) {
    throw new Error(`The maximum of ${LAYER_STACK_MAXIMUM} layers has been reached.`);
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
        maximumPixels: Math.floor(
          RASTER_IMAGE_MAXIMUM_GPU_BYTES / RASTER_IMAGE_DECODED_BYTES_PER_PIXEL,
        ),
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
        const transientGpuBytes = sourceMipBytes
          + inspection.encodedWidth * inspection.encodedHeight
            * RASTER_IMAGE_DECODED_BYTES_PER_PIXEL;
        if (transientGpuBytes > RASTER_IMAGE_MAXIMUM_GPU_BYTES) {
          throw new Error(
            `Image is too large: the transient GPU source would require `
            + `${(transientGpuBytes / 1024 / 1024).toFixed(1)} MiB.`,
          );
        }
        assertNativeRasterImportResidentBudget(engine, bounds, sourceMipBytes + 32);
      },
    });

    const metadata = decoded.metadata;
    const bounds = outputBoundsForImage(metadata.width, metadata.height);
    const decodedMipBytes = rasterImageMipChainBytes(
      metadata.width,
      metadata.height,
      requiredImportMipLevelCount(metadata.width, metadata.height, bounds),
    );
    const decodedTransientGpuBytes = decodedMipBytes
      + metadata.width * metadata.height * RASTER_IMAGE_DECODED_BYTES_PER_PIXEL;
    if (decodedTransientGpuBytes > RASTER_IMAGE_MAXIMUM_GPU_BYTES) {
      throw new Error(
        `Decoded image is too large: the transient GPU source would require `
        + `${(decodedTransientGpuBytes / 1024 / 1024).toFixed(1)} MiB.`,
      );
    }
    assertNativeRasterImportResidentBudget(engine, bounds, decodedMipBytes + 32);
    const scene = requireMixedSceneStack(engine);
    const originalActiveId = engine.layerStack.active.id;
    const selectedKeyBefore = scene.selected.key;
    if (
      scene.selected.kind === "raster"
      && scene.selected.rasterLayerId !== originalActiveId
    ) {
      throw new Error(
        `Import invariant: selected raster ${scene.selected.rasterLayerId}, `
        + `but active raster is ${originalActiveId}.`,
      );
    }
    const excludedNodeBefore = engine.vectorTextPreviewExcludedNodeId;
    const sceneIndex = scene.indexOfKey(selectedKeyBefore) + 1;
    const rasterLayerIndex = scene.rasterIndexForSceneIndex(sceneIndex);
    const assetId = allocateRasterLayerAssetId(engine);
    let recordId: number | null = null;
    let gpu: LayerGpuResources | null = null;
    let seed: LayerColdStorageResources | null = null;
    let transient: TransientImageTextures | null = null;
    let resource: RasterImageGpuResource | null = null;
    let sceneInserted = false;
    try {
      engine.persistActiveLayerState();
      await engine.prepareActiveLayerForSwitch();
      const insertedIndex = engine.layerStack.insertAt(
        rasterLayerIndex,
        metadata.sourceName || "Raster Image",
      );
      const record = engine.layerStack.at(insertedIndex);
      recordId = record.id;
      gpu = await allocateLayerGpuResources(
        engine,
        engine.layerFormat,
        `Allocate raster import layer ${record.id}`,
      );
      engine.layerGpu.set(record.id, gpu);
      const hot = gpu.hot;
      if (!hot) throw new Error("The imported layer hot texture is missing.");

      transient = await encodeBitmapIntoLayer(engine, decoded.bitmap, hot, bounds);
      // copyExternalImageToTexture captures the source at call time. Releasing
      // the decoded surface here prevents it from overlapping the immutable
      // Undo/Redo seed without adding a GPU fence to the import path.
      releaseDecodedRasterImage(decoded);
      decoded = null;
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
        "history",
      );
      const document: RasterImageDocument = {
        assetId,
        sourceName: metadata.sourceName,
        mimeType: metadata.mimeType,
        sourceBytes: metadata.sourceBytes,
        width: metadata.width,
        height: metadata.height,
      };
      resource = createRasterImageGpuResource(
        engine,
        assetId,
        file.slice(0, file.size, metadata.mimeType),
        transient,
        metadata.width,
        metadata.height,
        await ensureNativeImportPipelines(engine),
      );
      // Mip 0+ now belong to the immutable asset registry. Only the one-shot
      // browser upload surface can be released.
      transient.straightTexture.destroy();
      transient = null;
      engine.rasterImageGpuResources.set(assetId, resource);
      record.rasterSource = initialRasterLayerSource(document, bounds);

      scene.addRasterAboveSelection(record.id);
      sceneInserted = true;
      engine.vectorTextPreviewExcludedNodeId = null;
      clearVectorTextPresentationForTransaction(engine);
      const previousIndexAfterInsertion = engine.layerStack.indexOfId(originalActiveId);
      if (previousIndexAfterInsertion < 0) {
        throw new Error("The previous active layer was lost during import.");
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
        rasterSource: cloneRasterLayerSource(record.rasterSource)!,
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
      if (resource) {
        engine.rasterImageGpuResources.delete(resource.assetId);
        resource.uniformBuffer.destroy();
        resource.texture.destroy();
        resource = null;
      }
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
                throw new Error("The original layer is missing after import rollback.");
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
          "Raster import failed and rollback was incomplete. Reload the page.",
        );
        const details = rollbackErrors.map((failure) =>
          failure instanceof Error ? failure.message : String(failure)
        ).join("; ");
        throw new Error(`Raster import failed; rollback failed: ${details}`);
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
      console.error("Failed to publish UI state after raster import", publicationError);
    }
  }
}

export async function importRasterImageFile(
  engine: BrushEngine,
  file: File,
  commitHistory: (history: NativeRasterImageHistorySeed) => void,
): Promise<Readonly<NativeRasterImageImportResult>> {
  if (rasterImageImportsInFlight.has(engine)) {
    throw new Error("An image import is already in progress.");
  }
  rasterImageImportsInFlight.add(engine);
  try {
    return await importRasterImageFileUnlocked(engine, file, commitHistory);
  } finally {
    rasterImageImportsInFlight.delete(engine);
  }
}

/**
 * Sposta il livello attivo durante una mutazione strutturale, con rollback
 * completo se l'attivazione fallisce. Non ha nulla di specifico dell'import:
 * cancellazione e ricreazione di un livello usano lo stesso percorso, e
 * duplicarlo creerebbe due strade che possono divergere.
 */
export async function switchActiveForStructuralHistory(
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
        "Layer switch failed during a structural layer mutation.",
      );
      const first = error instanceof Error ? error.message : String(error);
      const second = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(`${first}; layer-switch rollback failed: ${second}`);
    }
    throw error;
  }
}

/**
 * Alloca le risorse di un livello e ne reidrata i pixel da un seed di cold
 * storage. Condivisa da import raster e da ripristino di un livello cancellato.
 */
export async function hydrateLayerFromSeed(
  engine: BrushEngine,
  layerId: number,
  seed: LayerColdStorageResources,
): Promise<LayerGpuResources> {
  const gpu = await allocateLayerGpuResources(
    engine,
    engine.layerFormat,
    `Hydrate historical layer ${layerId}`,
  );
  const hot = gpu.hot;
  if (!hot) {
    destroyLayerGpuResources(engine, gpu);
    throw new Error("The raster-import history hot texture is missing.");
  }
  try {
    const encoder = engine.device.createCommandEncoder({
      label: `Hydrate seed for layer ${layerId}`,
    });
    encodeLayerColdHydration(encoder, seed, hot);
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped("Hydrate layer from seed", 60_000);
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
  if (targetIndex < 0) throw new Error("The imported layer to undo is missing.");
  if (engine.layerStack.at(targetIndex) !== action.layerRecord) {
    throw new Error("The historical raster-import record was unexpectedly replaced.");
  }
  const fallbackIndexBeforeSwitch = engine.layerStack.indexOfId(
    action.activeRasterLayerIdBefore,
  );
  if (fallbackIndexBeforeSwitch < 0 || action.activeRasterLayerIdBefore === action.layerId) {
    throw new Error("The raster layer active before import is no longer available.");
  }
  const gpu = engine.layerGpu.get(action.layerId);
  if (!gpu) throw new Error("Resources for the imported layer to detach are missing.");
  const currentSceneIndex = scene.indexOfKey(`raster:${action.layerId}`);
  if (currentSceneIndex < 0) {
    throw new Error("The imported layer is missing from the mixed scene during Undo.");
  }
  await switchActiveForStructuralHistory(engine, targetIndex);
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
        if (originalIndex < 0) throw new Error("The original active raster was lost during Undo rollback.");
        await switchActiveForStructuralHistory(engine, originalIndex);
      }
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    if (rollbackErrors.length > 0) {
      engine.latchDocumentStateInconsistent(
        "Raster-import Undo failed and rollback was incomplete. Reload the page.",
      );
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      throw new Error(`${operationMessage}; raster-import Undo rollback failed: ${rollbackMessage}`);
    }
    throw error;
  }

  const detachedIndex = engine.layerStack.indexOfId(action.layerId);
  const detached = engine.layerStack.remove(detachedIndex);
  if (detached !== action.layerRecord) throw new Error("Inconsistent raster-import detach.");
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
    throw new Error("The imported layer is already present during Redo.");
  }
  engine.persistActiveLayerState();
  await engine.prepareActiveLayerForSwitch();
  let gpu: LayerGpuResources | null = null;
  let attached = false;
  try {
    gpu = await hydrateLayerFromSeed(engine, action.layerId, action.seed);
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
        if (originalIndex < 0) throw new Error("The original active raster was lost during Redo rollback.");
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
        "Raster-import Redo failed and rollback was incomplete. Reload the page.",
      );
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      throw new Error(`${operationMessage}; raster-import Redo rollback failed: ${rollbackMessage}`);
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
  throw new Error("Imported images are native raster layers, not semantic nodes.");
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
