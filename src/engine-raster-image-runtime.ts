/**
 * Native raster-image assets for the heterogeneous scene.
 *
 * Decode happens once in the browser image decoder. From the first upload on,
 * pixels, mip generation, transformed display and compositing stay in WebGPU;
 * there is intentionally no Canvas2D or CPU-rendering fallback.
 */
import type { BrushEngine } from "./brush-engine";
import {
  cloneRasterImageNode,
  type RasterImageNode,
} from "./mixed-scene-stack";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  decodeRasterImage,
  releaseDecodedRasterImage,
} from "./raster-image-import";
import {
  mutateMixedScenePresentation,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";
import { recordVectorHistoryAction } from "./engine-history-runtime";
import { assertVectorUpdateAllowed } from "./engine-runtime-misc";
import { mergeDirtyRects } from "./engine-geometry";
import type { DirtyRect } from "./engine-stroke-types";
import {
  planRasterImageAggregateMemory,
  RASTER_IMAGE_UNIFORM_BYTES,
} from "./raster-image-budget";

export const RASTER_IMAGE_GPU_STORAGE_STRATEGY =
  "immutable-rgba8unorm-srgb-linear-premultiplied-full-mips-history-reachable-sweep-v2" as const;

export { RASTER_IMAGE_UNIFORM_BYTES } from "./raster-image-budget";
export const RASTER_IMAGE_MAXIMUM_ENCODED_BYTES = 64 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_GPU_BYTES = 256 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES = 256 * 1024 * 1024;
export const RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES = 384 * 1024 * 1024;

const rasterImageImportsInFlight = new WeakSet<BrushEngine>();

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

function normalizedTransformUpdate(
  update: Partial<
    Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">
  >,
): typeof update {
  const normalized = { ...update };
  if (normalized.x !== undefined && !Number.isFinite(normalized.x)) delete normalized.x;
  if (normalized.y !== undefined && !Number.isFinite(normalized.y)) delete normalized.y;
  if (normalized.scale !== undefined) {
    normalized.scale = Number.isFinite(normalized.scale)
      ? Math.min(64, Math.max(0.01, normalized.scale))
      : 1;
  }
  if (normalized.rotation !== undefined) {
    normalized.rotation = Number.isFinite(normalized.rotation)
      ? Math.atan2(Math.sin(normalized.rotation), Math.cos(normalized.rotation))
      : 0;
  }
  return normalized;
}

function rasterImageLayerBounds(
  node: Readonly<RasterImageNode>,
): DirtyRect | null {
  if (!node.visible || node.opacity <= 0) return null;
  const halfWidth = Math.abs(node.document.width * node.scale * 0.5);
  const halfHeight = Math.abs(node.document.height * node.scale * 0.5);
  const cosine = Math.abs(Math.cos(node.rotation));
  const sine = Math.abs(Math.sin(node.rotation));
  const extentX = cosine * halfWidth + sine * halfHeight + 2;
  const extentY = sine * halfWidth + cosine * halfHeight + 2;
  const x = Math.floor(node.x - extentX);
  const y = Math.floor(node.y - extentY);
  const right = Math.ceil(node.x + extentX);
  const bottom = Math.ceil(node.y + extentY);
  if (![x, y, right, bottom].every(Number.isFinite)) return null;
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

async function createRasterImageGpuResource(
  engine: BrushEngine,
  assetId: string,
  bitmap: ImageBitmap,
  sourceBytes: number,
): Promise<RasterImageGpuResource> {
  const width = bitmap.width;
  const height = bitmap.height;
  const budget = planRasterImageAggregateMemory(
    rasterImageGpuMemoryBytes(engine),
    width,
    height,
    sourceBytes,
  );
  const levels = budget.asset.mipLevelCount;
  const memoryBytes = budget.asset.residentGpuBytes;
  const importPeakBytes = budget.aggregateLogicalImportPeakBytes;
  if (width > engine.device.limits.maxTextureDimension2D
    || height > engine.device.limits.maxTextureDimension2D) {
    throw new Error(
      `Immagine ${width}×${height}: il limite di questa GPU è `
      + `${engine.device.limits.maxTextureDimension2D} px per lato.`,
    );
  }
  if (memoryBytes > RASTER_IMAGE_MAXIMUM_GPU_BYTES) {
    throw new Error(
      `Immagine troppo grande: texture e mipmap richiederebbero `
      + `${(memoryBytes / 1024 / 1024).toFixed(1)} MiB; limite ${RASTER_IMAGE_MAXIMUM_GPU_BYTES / 1024 / 1024} MiB.`,
    );
  }
  if (budget.resultingResidentBytes > RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES) {
    throw new Error(
      `Immagini troppo grandi nel complesso: scena e cronologia richiederebbero `
      + `${(budget.resultingResidentBytes / 1024 / 1024).toFixed(1)} MiB GPU; limite `
      + `${RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES / 1024 / 1024} MiB.`,
    );
  }
  if (importPeakBytes > RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES) {
    throw new Error(
      `Immagine troppo grande: decoder, ispezione, upload e texture/mipmap richiederebbero `
      + `${(importPeakBytes / 1024 / 1024).toFixed(1)} MiB di picco; limite `
      + `${RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES / 1024 / 1024} MiB.`,
    );
  }
  const mipLayout = engine.rasterImageMipmapBindGroupLayout;
  const imageLayout = engine.rasterImageMixedSceneBindGroupLayout;
  const mipPipeline = engine.rasterImageMipmapPipeline;
  const premultiplyPipeline = engine.rasterImagePremultiplyPipeline;
  const sampler = engine.rasterImageSampler;
  if (!mipLayout || !imageLayout || !mipPipeline || !premultiplyPipeline || !sampler) {
    throw new Error("Pipeline WebGPU delle immagini non inizializzata.");
  }

  return runGpuAllocationTransaction(
    engine.device,
    `Allocazione immagine ${width}×${height}`,
    async (transaction) => {
      const texture = engine.device.createTexture({
        label: `Raster image ${assetId} ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        mipLevelCount: levels,
        format: "rgba8unorm-srgb",
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      transaction.deferRollback(() => texture.destroy());
      const uploadTexture = engine.device.createTexture({
        label: `Raster image ${assetId} straight-sRGB upload`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: "rgba8unorm-srgb",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      transaction.deferRollback(() => uploadTexture.destroy());
      const uniformBuffer = engine.device.createBuffer({
        label: `Raster image transform ${assetId}`,
        size: RASTER_IMAGE_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => uniformBuffer.destroy());

      engine.device.queue.copyExternalImageToTexture(
        { source: bitmap },
        {
          texture: uploadTexture,
          mipLevel: 0,
          colorSpace: "srgb",
          premultipliedAlpha: false,
        },
        { width, height, depthOrArrayLayers: 1 },
      );

      const encoder = engine.device.createCommandEncoder({
        label: `Raster image premultiply and mipmap encoder ${assetId}`,
      });
      const uploadView = uploadTexture.createView({
        label: `Raster image ${assetId} straight-sRGB source view`,
      });
      const premultiplyBindGroup = engine.device.createBindGroup({
        label: `Raster image ${assetId} premultiply bind group`,
        layout: mipLayout,
        entries: [{ binding: 0, resource: uploadView }],
      });
      const basePass = encoder.beginRenderPass({
        label: `Raster image ${assetId} linear-premultiply base mip`,
        colorAttachments: [{
          view: texture.createView({
            label: `Raster image ${assetId} mip 0 target`,
            baseMipLevel: 0,
            mipLevelCount: 1,
          }),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      basePass.setPipeline(premultiplyPipeline);
      basePass.setBindGroup(0, premultiplyBindGroup);
      basePass.draw(3, 1, 0, 0);
      basePass.end();

      if (levels > 1) {
        for (let level = 1; level < levels; level += 1) {
          const sourceView = texture.createView({
            label: `Raster image ${assetId} mip ${level - 1} source`,
            baseMipLevel: level - 1,
            mipLevelCount: 1,
          });
          const destinationView = texture.createView({
            label: `Raster image ${assetId} mip ${level} target`,
            baseMipLevel: level,
            mipLevelCount: 1,
          });
          const bindGroup = engine.device.createBindGroup({
            label: `Raster image ${assetId} mip ${level} bind group`,
            layout: mipLayout,
            entries: [{ binding: 0, resource: sourceView }],
          });
          const pass = encoder.beginRenderPass({
            label: `Raster image ${assetId} build mip ${level}`,
            colorAttachments: [{
              view: destinationView,
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            }],
          });
          pass.setPipeline(mipPipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3, 1, 0, 0);
          pass.end();
        }
      }
      engine.device.queue.submit([encoder.finish()]);

      const view = texture.createView({
        label: `Raster image ${assetId} full mip view`,
      });
      const bindGroup = engine.device.createBindGroup({
        label: `Raster image ${assetId} mixed-scene bind group`,
        layout: imageLayout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: { buffer: uniformBuffer } },
          { binding: 2, resource: view },
          { binding: 3, resource: sampler },
        ],
      });
      await engine.device.queue.onSubmittedWorkDone();
      uploadTexture.destroy();
      return {
        assetId,
        texture,
        view,
        uniformBuffer,
        bindGroup,
        width,
        height,
        mipLevelCount: levels,
        memoryBytes,
        uniformUpload: new Float32Array(8),
        uniformInitialized: false,
      };
    },
  );
}

async function importRasterImageFileUnlocked(
  engine: BrushEngine,
  file: File,
): Promise<Readonly<RasterImageNode>> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (file.size > RASTER_IMAGE_MAXIMUM_ENCODED_BYTES) {
    throw new Error("File immagine oltre il limite di 64 MiB.");
  }
  engine.assertLayerSwitchAllowed();
  await engine.waitForIdle();
  engine.sweepRasterImageGpuResources();
  const maximumDimension = engine.device.limits.maxTextureDimension2D;
  const decoded = await decodeRasterImage(file, {
    sourceName: file.name,
    limits: {
      maximumSourceBytes: RASTER_IMAGE_MAXIMUM_ENCODED_BYTES,
      maximumWidth: maximumDimension,
      maximumHeight: maximumDimension,
      maximumPixels: Math.floor(RASTER_IMAGE_MAXIMUM_GPU_BYTES / 4),
    },
    preflight: (inspection) => {
      const budget = planRasterImageAggregateMemory(
        rasterImageGpuMemoryBytes(engine),
        inspection.encodedWidth,
        inspection.encodedHeight,
        inspection.sourceBytes,
      );
      const exactMipBytes = budget.asset.residentGpuBytes;
      const exactImportPeakBytes = budget.aggregateLogicalImportPeakBytes;
      if (exactMipBytes > RASTER_IMAGE_MAXIMUM_GPU_BYTES) {
        throw new Error(
          `Immagine troppo grande: texture e mipmap richiederebbero `
          + `${(exactMipBytes / 1024 / 1024).toFixed(1)} MiB; limite `
          + `${RASTER_IMAGE_MAXIMUM_GPU_BYTES / 1024 / 1024} MiB.`,
        );
      }
      if (budget.resultingResidentBytes > RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES) {
        throw new Error(
          `Immagini troppo grandi nel complesso: scena e cronologia richiederebbero `
          + `${(budget.resultingResidentBytes / 1024 / 1024).toFixed(1)} MiB GPU; limite `
          + `${RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES / 1024 / 1024} MiB.`,
        );
      }
      if (exactImportPeakBytes > RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES) {
        throw new Error(
          `Immagine troppo grande: decoder, ispezione, upload e texture/mipmap richiederebbero `
          + `${(exactImportPeakBytes / 1024 / 1024).toFixed(1)} MiB di picco; limite `
          + `${RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES / 1024 / 1024} MiB.`,
        );
      }
    },
  });
  const assetId = `raster-image-${engine.nextRasterImageAssetId++}`;
  let resource!: RasterImageGpuResource;
  try {
    resource = await createRasterImageGpuResource(
      engine,
      assetId,
      decoded.bitmap,
      decoded.metadata.sourceBytes,
    );
  } finally {
    releaseDecodedRasterImage(decoded);
  }
  engine.rasterImageGpuResources.set(assetId, resource);
  try {
    const metadata = decoded.metadata;
    const longestSide = Math.max(metadata.width, metadata.height);
    const node = await mutateMixedScenePresentation(
      engine,
      (scene) => scene.addImageAboveSelection({
        document: {
          assetId,
          sourceName: metadata.sourceName,
          mimeType: metadata.mimeType,
          sourceBytes: metadata.sourceBytes,
          width: metadata.width,
          height: metadata.height,
        },
        x: engine.layerSize * 0.5,
        y: engine.layerSize * 0.5,
        scale: Math.min(1, engine.layerSize * 0.8 / longestSide),
        rotation: 0,
      }, metadata.sourceName),
      { addedKey: (added) => `image:${added.id}` },
    );
    return cloneRasterImageNode(node);
  } catch (error) {
    engine.rasterImageGpuResources.delete(assetId);
    resource.uniformBuffer.destroy();
    resource.texture.destroy();
    throw error;
  }
}

export async function importRasterImageFile(
  engine: BrushEngine,
  file: File,
): Promise<Readonly<RasterImageNode>> {
  if (rasterImageImportsInFlight.has(engine)) {
    throw new Error("È già in corso un’importazione immagine.");
  }
  rasterImageImportsInFlight.add(engine);
  try {
    return await importRasterImageFileUnlocked(engine, file);
  } finally {
    rasterImageImportsInFlight.delete(engine);
  }
}

export function updateRasterImageNode(
  engine: BrushEngine,
  id: number,
  update: Partial<
    Omit<RasterImageNode, "id" | "kind" | "document" | "visible" | "opacity">
  >,
): Readonly<RasterImageNode> {
  const scene = requireMixedSceneStack(engine);
  const key = `image:${id}` as const;
  assertVectorUpdateAllowed(engine, key, Object.keys(update));
  const selected = scene.selected;
  if (selected.kind !== "image" || selected.imageNodeId !== id) {
    throw new Error("È modificabile soltanto l’immagine selezionata.");
  }
  const before = engine.activeVectorHistoryEdit
    ? null
    : scene.captureVectorHistoryState(key);
  const previousBounds = rasterImageLayerBounds(scene.imageById(id));
  const node = scene.updateImage(id, normalizedTransformUpdate(update));
  const nextBounds = rasterImageLayerBounds(node);
  if (before) {
    recordVectorHistoryAction(engine, before, scene.captureVectorHistoryState(key));
    engine.publishHistoryState();
  }
  publishMixedScene(engine);
  engine.semanticPresentationDirtyRect = mergeDirtyRects(
    engine.semanticPresentationDirtyRect,
    mergeDirtyRects(previousBounds, nextBounds),
  );
  engine.displayDirty = true;
  engine.requestRender();
  return cloneRasterImageNode(node);
}

export async function setRasterImageNodeVisibility(
  engine: BrushEngine,
  id: number,
  visible: boolean,
): Promise<boolean> {
  return mutateMixedScenePresentation(
    engine,
    (scene) => scene.setImageVisibility(id, Boolean(visible)),
    { targetKey: `image:${id}` },
  );
}

export async function setRasterImageNodeOpacity(
  engine: BrushEngine,
  id: number,
  opacity: number,
): Promise<boolean> {
  return mutateMixedScenePresentation(
    engine,
    (scene) => scene.setImageOpacity(id, opacity),
    { targetKey: `image:${id}` },
  );
}

export async function moveRasterImageNode(
  engine: BrushEngine,
  id: number,
  delta: -1 | 1,
): Promise<boolean> {
  return mutateMixedScenePresentation(
    engine,
    (scene) => scene.moveImage(id, delta),
    { targetKey: `image:${id}` },
  );
}

export async function deleteRasterImageNode(
  engine: BrushEngine,
  id: number,
): Promise<Readonly<RasterImageNode>> {
  const removed = await mutateMixedScenePresentation(
    engine,
    (scene) => scene.deleteImage(id, engine.layerStack.active.id),
    { targetKey: `image:${id}` },
  );
  // The asset deliberately remains resident while Undo/Redo may reference it.
  return cloneRasterImageNode(removed);
}

export function rasterImageBindGroupForNode(
  engine: BrushEngine,
  node: Readonly<RasterImageNode>,
): GPUBindGroup | null {
  if (!node.visible || node.opacity <= 0) return null;
  const resource = engine.rasterImageGpuResources.get(node.document.assetId);
  if (!resource) {
    throw new Error(`Texture GPU dell’immagine ${node.name} non disponibile.`);
  }
  const upload = resource.uniformUpload;
  const centerX = Math.fround(node.x);
  const centerY = Math.fround(node.y);
  const halfWidth = Math.fround(node.document.width * node.scale * 0.5);
  const halfHeight = Math.fround(node.document.height * node.scale * 0.5);
  const rotationCosine = Math.fround(Math.cos(node.rotation));
  const rotationSine = Math.fround(Math.sin(node.rotation));
  const opacity = Math.fround(node.opacity);
  const changed = !resource.uniformInitialized
    || upload[0] !== centerX
    || upload[1] !== centerY
    || upload[2] !== halfWidth
    || upload[3] !== halfHeight
    || upload[4] !== rotationCosine
    || upload[5] !== rotationSine
    || upload[6] !== opacity;
  if (changed) {
    upload[0] = centerX;
    upload[1] = centerY;
    upload[2] = halfWidth;
    upload[3] = halfHeight;
    upload[4] = rotationCosine;
    upload[5] = rotationSine;
    upload[6] = opacity;
    upload[7] = 0;
    engine.device.queue.writeBuffer(resource.uniformBuffer, 0, upload);
    resource.uniformInitialized = true;
  }
  return resource.bindGroup;
}

export function rasterImageGpuMemoryBytes(engine: BrushEngine): number {
  let total = 0;
  for (const resource of engine.rasterImageGpuResources.values()) {
    total += resource.memoryBytes;
  }
  return total;
}
