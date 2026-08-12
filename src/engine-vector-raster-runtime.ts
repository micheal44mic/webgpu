import type { BrushEngine } from "./brush-engine";
import { VECTOR_TEXT_GPU_MAXIMUM_DRAWS } from "./engine-limits";
import {
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_UNIFORM_STRIDE,
} from "./vector-text-gpu-shader";
import type { VectorRasterizeHistoryAction } from "./engine-history-types";
import type { LayerFormat } from "./engine-types";
import type { MixedSceneVectorKey } from "./mixed-scene-stack";
import type {
  EffectsRetargetCaller,
  LayerGpuResources,
  LayerTextureResources,
} from "./engine-layer-resources";
import {
  vectorTextGpuDrawUsesBlur,
  vectorTextGpuDrawUsesMesh,
  type VectorTextGpuBlurCacheResources,
  type VectorTextGpuDrawResources,
} from "./engine-vector-text-resources";
import type {
  VectorTextGpuBlurSourceDraw,
  VectorTextGpuDraw,
  VectorTextViewState,
} from "./vector-text-types";
import {
  clearVectorTextPresentationForTransaction,
  ensureVectorTextGpuBlurCache,
  ensureVectorTextGpuBlurScratch,
  ensureVectorTextGpuResource,
  publishMixedScene,
  requireMixedSceneStack,
  writeVectorTextGpuBlurFilterUniform,
  writeVectorTextGpuBlurSourceUniform,
  writeVectorTextGpuDrawUniform,
} from "./engine-vector-text-runtime";
import { vectorTextGpuRunBounds } from "./engine-geometry";
import {
  LAYER_STORAGE_TILE_SIZE,
  countLayerStorageTiles,
  markLayerStorageRect,
} from "./layer-storage-study";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  encodeLayerColdHydration,
} from "./engine-cold-storage";
import {
  allocateLayerGpuResources,
  destroyLayerGpuResources,
} from "./engine-layer-runtime";
import { LAYER_STACK_MAXIMUM } from "./layer-stack";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";

export const VECTOR_RASTERIZATION_STRATEGY =
  "semantic-vector-slug-mesh-webgpu-linear-layer-format-msaa4-512-tile-chunks-history-seed-v3" as const;
export const VECTOR_RASTER_CHUNK_SIZE = LAYER_STORAGE_TILE_SIZE * 2;
/** Permanent authoritative default; runtime resources still follow engine.layerFormat. */
export const VECTOR_RASTER_FORMAT = "rgba16float" as const;

interface VectorRasterPipelines {
  meshFill: GPURenderPipeline;
  slugFill: GPURenderPipeline;
  blurComposite: GPURenderPipeline;
  slugInnerShadowDirect: GPURenderPipeline;
  slugInnerShadowBlur: GPURenderPipeline;
  meshInnerShadowBlur: GPURenderPipeline;
}

export interface VectorRasterConversionResult {
  readonly history: Omit<VectorRasterizeHistoryAction, "id" | "kind">;
  readonly chunkCount: number;
  readonly tileCount: number;
  readonly format: LayerFormat;
}

interface VectorRasterScratch {
  readonly msaaTexture: GPUTexture;
  readonly resolvedTexture: GPUTexture;
  readonly msaaView: GPUTextureView;
  readonly resolvedView: GPUTextureView;
}

const pipelinesByDevice = new WeakMap<
  GPUDevice,
  Map<LayerFormat, Promise<VectorRasterPipelines>>
>();

function sourceOverBlend(): GPUBlendState {
  return {
    color: {
      srcFactor: "one",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    },
    alpha: {
      srcFactor: "one",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    },
  };
}

async function ensureVectorRasterPipelines(
  engine: BrushEngine,
  format: LayerFormat,
): Promise<VectorRasterPipelines> {
  let devicePipelines = pipelinesByDevice.get(engine.device);
  if (!devicePipelines) {
    devicePipelines = new Map();
    pipelinesByDevice.set(engine.device, devicePipelines);
  }
  const existing = devicePipelines.get(format);
  if (existing) return existing;
  const pending = runGpuAllocationTransaction(
    engine.device,
    `Pipeline raster vettoriale ${format}`,
    () => {
  const meshShader = engine.vectorTextGpuShaderModule;
  const slugShader = engine.vectorTextGpuSlugShaderModule;
  const blurShader = engine.vectorTextGpuBlurCompositeShaderModule;
  const innerShader = engine.vectorTextGpuInnerShadowShaderModule;
  const meshLayout = engine.vectorTextGpuUniformBindGroupLayout;
  const slugLayout = engine.vectorTextGpuSlugBindGroupLayout;
  const blurLayout = engine.vectorTextGpuBlurCompositeBindGroupLayout;
  const innerLayout = engine.vectorTextGpuInnerShadowBindGroupLayout;
  if (
    !meshShader
    || !slugShader
    || !blurShader
    || !innerShader
    || !meshLayout
    || !slugLayout
    || !blurLayout
    || !innerLayout
  ) {
    throw new Error("Renderer vettoriale GPU non pronto per rasterizzare il nodo.");
  }
  const blend = sourceOverBlend();
  const vertexBuffers: GPUVertexBufferLayout[] = [{
    arrayStride: 8,
    attributes: [{
      shaderLocation: 0,
      offset: 0,
      format: "float32x2",
    }],
  }];
  const meshFill = engine.device.createRenderPipeline({
    label: `Vector raster ${format} linear mesh fill MSAA4`,
    layout: engine.device.createPipelineLayout({
      label: `Vector raster ${format} mesh layout`,
      bindGroupLayouts: [meshLayout],
    }),
    vertex: { module: meshShader, entryPoint: "vertexMain", buffers: vertexBuffers },
    fragment: {
      module: meshShader,
      entryPoint: "fragmentMain",
      targets: [{ format, blend }],
    },
    primitive: { topology: "triangle-list" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const slugFill = engine.device.createRenderPipeline({
    label: `Vector raster ${format} linear Slug fill MSAA4`,
    layout: engine.device.createPipelineLayout({
      label: `Vector raster ${format} Slug layout`,
      bindGroupLayouts: [slugLayout],
    }),
    vertex: { module: slugShader, entryPoint: "vertexMain" },
    fragment: {
      module: slugShader,
      entryPoint: "fragmentMain",
      targets: [{ format, blend }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const blurComposite = engine.device.createRenderPipeline({
    label: `Vector raster ${format} linear blur composite MSAA4`,
    layout: engine.device.createPipelineLayout({
      label: `Vector raster ${format} blur layout`,
      bindGroupLayouts: [blurLayout],
    }),
    vertex: { module: blurShader, entryPoint: "vertexMain" },
    fragment: {
      module: blurShader,
      entryPoint: "fragmentMain",
      targets: [{ format, blend }],
    },
    primitive: { topology: "triangle-list" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const slugInnerShadowDirect = engine.device.createRenderPipeline({
    label: `Vector raster ${format} Slug inner shadow direct MSAA4`,
    layout: engine.device.createPipelineLayout({
      label: `Vector raster ${format} Slug inner-shadow direct layout`,
      bindGroupLayouts: [slugLayout],
    }),
    vertex: { module: innerShader, entryPoint: "vertexMain" },
    fragment: {
      module: innerShader,
      entryPoint: "innerShadowDirectFragmentMain",
      targets: [{ format, blend }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const slugInnerShadowBlur = engine.device.createRenderPipeline({
    label: `Vector raster ${format} Slug inner shadow blur MSAA4`,
    layout: engine.device.createPipelineLayout({
      label: `Vector raster ${format} Slug inner-shadow blur layout`,
      bindGroupLayouts: [slugLayout, innerLayout],
    }),
    vertex: { module: innerShader, entryPoint: "innerShadowBlurVertexMain" },
    fragment: {
      module: innerShader,
      entryPoint: "innerShadowBlurFragmentMain",
      targets: [{ format, blend }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const meshInnerShadowBlur = engine.device.createRenderPipeline({
    label: `Vector raster ${format} mesh inner shadow blur MSAA4`,
    layout: engine.device.createPipelineLayout({
      label: `Vector raster ${format} mesh inner-shadow layout`,
      bindGroupLayouts: [meshLayout, innerLayout],
    }),
    vertex: {
      module: meshShader,
      entryPoint: "meshInnerShadowVertexMain",
      buffers: vertexBuffers,
    },
    fragment: {
      module: meshShader,
      entryPoint: "meshInnerShadowFragmentMain",
      targets: [{ format, blend }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const created = {
    meshFill,
    slugFill,
    blurComposite,
    slugInnerShadowDirect,
    slugInnerShadowBlur,
    meshInnerShadowBlur,
  };
      return created;
    },
  );
  devicePipelines.set(format, pending);
  try {
    return await pending;
  } catch (error) {
    if (devicePipelines.get(format) === pending) {
      devicePipelines.delete(format);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Rasterizzazione vettoriale ${format} non supportata dalla GPU. `
      + `Nessun fallback RGBA8 è consentito. Dettaglio: ${message}`,
    );
  }
}

async function createVectorRasterScratch(
  engine: BrushEngine,
  format: LayerFormat,
): Promise<VectorRasterScratch> {
  try {
    return await runGpuAllocationTransaction(
      engine.device,
      `Scratch raster vettoriale ${format} MSAA${VECTOR_TEXT_GPU_SAMPLE_COUNT}`,
      (transaction) => {
        const msaaTexture = engine.device.createTexture({
          label: `Vector raster ${format} MSAA4 512 tile-aligned scratch`,
          size: {
            width: VECTOR_RASTER_CHUNK_SIZE,
            height: VECTOR_RASTER_CHUNK_SIZE,
            depthOrArrayLayers: 1,
          },
          sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        transaction.deferRollback(() => msaaTexture.destroy());
        const resolvedTexture = engine.device.createTexture({
          label: `Vector raster ${format} resolved 512 tile-aligned scratch`,
          size: {
            width: VECTOR_RASTER_CHUNK_SIZE,
            height: VECTOR_RASTER_CHUNK_SIZE,
            depthOrArrayLayers: 1,
          },
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        transaction.deferRollback(() => resolvedTexture.destroy());
        return {
          msaaTexture,
          resolvedTexture,
          msaaView: msaaTexture.createView(),
          resolvedView: resolvedTexture.createView(),
        };
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Scratch raster vettoriale ${format} non supportato dalla GPU. `
      + `Nessun fallback RGBA8 è consentito. Dettaglio: ${message}`,
    );
  }
}

function requireVectorDraws(draws: readonly VectorTextGpuDraw[]): void {
  if (draws.length === 0) {
    throw new Error("Il nodo vettoriale non contiene draw rasterizzabili.");
  }
  if (draws.length > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
    throw new Error(
      `Vettore oltre il limite di ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} draw call.`,
    );
  }
}
function encodeMissingBlurCaches(
  engine: BrushEngine,
  draws: readonly VectorTextGpuDraw[],
  drawResources: readonly VectorTextGpuDrawResources[],
  blurResources: readonly (VectorTextGpuBlurCacheResources | null)[],
): void {
  const builds: {
    draw: VectorTextGpuBlurSourceDraw;
    resources: VectorTextGpuDrawResources;
    cache: VectorTextGpuBlurCacheResources;
  }[] = [];
  const queued = new Set<VectorTextGpuBlurCacheResources>();
  let scratchWidth = 0;
  let scratchHeight = 0;
  for (let index = 0; index < draws.length; index += 1) {
    const draw = draws[index];
    const cache = blurResources[index];
    if (!vectorTextGpuDrawUsesBlur(draw) || !cache?.needsBuild || queued.has(cache)) {
      continue;
    }
    builds.push({ draw, resources: drawResources[index], cache });
    queued.add(cache);
    scratchWidth = Math.max(scratchWidth, draw.blurWidth);
    scratchHeight = Math.max(scratchHeight, draw.blurHeight);
  }
  if (builds.length === 0) return;
  if (builds.length > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
    throw new Error("Troppe cache blur vettoriali da preparare.");
  }
  ensureVectorTextGpuBlurScratch(engine, scratchWidth, scratchHeight);
  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  const filterBuffer = engine.vectorTextGpuBlurFilterUniformBuffer;
  const scratchATexture = engine.vectorTextGpuBlurScratchATexture;
  const scratchAView = engine.vectorTextGpuBlurScratchAView;
  const scratchBView = engine.vectorTextGpuBlurScratchBView;
  const filterAToB = engine.vectorTextGpuBlurFilterBindGroupAToB;
  const filterBToA = engine.vectorTextGpuBlurFilterBindGroupBToA;
  const meshMaskPipeline = engine.vectorTextGpuMeshBlurMaskPipeline;
  const slugMaskPipeline = engine.vectorTextGpuBlurMaskPipeline;
  const horizontalPipeline = engine.vectorTextGpuBlurHorizontalPipeline;
  const verticalPipeline = engine.vectorTextGpuBlurVerticalPipeline;
  if (
    !uniformBuffer
    || !uniformBindGroup
    || !filterBuffer
    || !scratchATexture
    || !scratchAView
    || !scratchBView
    || !filterAToB
    || !filterBToA
    || !meshMaskPipeline
    || !slugMaskPipeline
    || !horizontalPipeline
    || !verticalPipeline
  ) {
    throw new Error("Risorse GPU blur vettoriali non pronte.");
  }
  builds.forEach((build, index) => {
    writeVectorTextGpuBlurSourceUniform(engine, build.draw, index);
    writeVectorTextGpuBlurFilterUniform(engine, build.draw, index);
  });
  engine.device.queue.writeBuffer(
    uniformBuffer,
    0,
    engine.vectorTextGpuUniformUpload,
    0,
    builds.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
  );
  engine.device.queue.writeBuffer(
    filterBuffer,
    0,
    engine.vectorTextGpuBlurFilterUniformUpload,
    0,
    builds.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
  );
  const encoder = engine.device.createCommandEncoder({
    label: "Preparazione cache blur vettoriale ad alta precisione per raster",
  });
  builds.forEach((build, index) => {
    const width = build.draw.blurWidth;
    const height = build.draw.blurHeight;
    const dynamicOffset = index * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
    const sourcePass = encoder.beginRenderPass({
      label: `Vector raster blur mask ${build.draw.blurKey}`,
      colorAttachments: [{
        view: scratchAView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    sourcePass.setViewport(0, 0, width, height, 0, 1);
    sourcePass.setScissorRect(0, 0, width, height);
    if (vectorTextGpuDrawUsesMesh(build.draw)) {
      if (build.resources.kind !== "mesh") {
        throw new Error("Risorsa mesh incoerente con la mask blur vettoriale.");
      }
      sourcePass.setPipeline(meshMaskPipeline);
      sourcePass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
      sourcePass.setVertexBuffer(0, build.resources.vertexBuffer);
      sourcePass.setIndexBuffer(build.resources.indexBuffer, "uint32");
      sourcePass.drawIndexed(build.resources.indexCount, 1, 0, 0, 0);
    } else {
      if (build.resources.kind !== "slug") {
        throw new Error("Risorsa Slug incoerente con la mask blur vettoriale.");
      }
      sourcePass.setPipeline(slugMaskPipeline);
      sourcePass.setBindGroup(0, build.resources.bindGroup, [dynamicOffset]);
      sourcePass.draw(6, 1, 0, 0);
    }
    sourcePass.end();

    const horizontalPass = encoder.beginRenderPass({
      label: `Vector raster blur horizontal ${build.draw.blurKey}`,
      colorAttachments: [{
        view: scratchBView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    horizontalPass.setViewport(0, 0, width, height, 0, 1);
    horizontalPass.setScissorRect(0, 0, width, height);
    horizontalPass.setPipeline(horizontalPipeline);
    horizontalPass.setBindGroup(0, filterAToB, [dynamicOffset]);
    horizontalPass.draw(3, 1, 0, 0);
    horizontalPass.end();

    const verticalPass = encoder.beginRenderPass({
      label: `Vector raster blur vertical ${build.draw.blurKey}`,
      colorAttachments: [{
        view: scratchAView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    verticalPass.setViewport(0, 0, width, height, 0, 1);
    verticalPass.setScissorRect(0, 0, width, height);
    verticalPass.setPipeline(verticalPipeline);
    verticalPass.setBindGroup(0, filterBToA, [dynamicOffset]);
    verticalPass.draw(3, 1, 0, 0);
    verticalPass.end();

    encoder.copyTextureToTexture(
      { texture: scratchATexture },
      { texture: build.cache.texture },
      { width, height, depthOrArrayLayers: 1 },
    );
    build.cache.needsBuild = false;
  });
  engine.device.queue.submit([encoder.finish()]);
}
export async function renderVectorDrawsToTexture(
  engine: BrushEngine,
  draws: readonly VectorTextGpuDraw[],
  view: VectorTextViewState,
  destination: Pick<LayerTextureResources, "texture" | "format">,
  destinationDocumentBounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = {
    x: 0,
    y: 0,
    width: view.canvasWidth,
    height: view.canvasHeight,
  },
): Promise<{ bounds: VectorRasterizeHistoryAction["baseBounds"]; chunkCount: number }> {
  requireVectorDraws(draws);
  if (destination.format !== engine.layerFormat) {
    throw new Error(
      `Destinazione raster vettoriale ${destination.format} incompatibile con documento `
      + `${engine.layerFormat}.`,
    );
  }
  const format = destination.format;
  const pipelines = await ensureVectorRasterPipelines(engine, format);
  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  if (!uniformBuffer || !uniformBindGroup) {
    throw new Error("Uniform GPU vettoriali non inizializzate.");
  }
  const drawResources = draws.map((draw) => ensureVectorTextGpuResource(engine, draw));
  const blurResources = draws.map((draw) =>
    vectorTextGpuDrawUsesBlur(draw)
      ? ensureVectorTextGpuBlurCache(engine, draw)
      : null
  );
  encodeMissingBlurCaches(engine, draws, drawResources, blurResources);

  const bounds = vectorTextGpuRunBounds(draws, view);
  const firstChunkX = Math.floor(bounds.x / VECTOR_RASTER_CHUNK_SIZE)
    * VECTOR_RASTER_CHUNK_SIZE;
  const firstChunkY = Math.floor(bounds.y / VECTOR_RASTER_CHUNK_SIZE)
    * VECTOR_RASTER_CHUNK_SIZE;
  const lastChunkX = Math.ceil((bounds.x + bounds.width) / VECTOR_RASTER_CHUNK_SIZE)
    * VECTOR_RASTER_CHUNK_SIZE;
  const lastChunkY = Math.ceil((bounds.y + bounds.height) / VECTOR_RASTER_CHUNK_SIZE)
    * VECTOR_RASTER_CHUNK_SIZE;
  const { msaaTexture, resolvedTexture, msaaView, resolvedView } =
    await createVectorRasterScratch(engine, format);
  let chunkCount = 0;
  try {
    for (let y = firstChunkY; y < lastChunkY; y += VECTOR_RASTER_CHUNK_SIZE) {
      for (let x = firstChunkX; x < lastChunkX; x += VECTOR_RASTER_CHUNK_SIZE) {
        const width = Math.min(VECTOR_RASTER_CHUNK_SIZE, view.canvasWidth - x);
        const height = Math.min(VECTOR_RASTER_CHUNK_SIZE, view.canvasHeight - y);
        if (width <= 0 || height <= 0) continue;
        const chunk = { x, y, width, height };
        draws.forEach((draw, index) => {
          writeVectorTextGpuDrawUniform(
            engine,
            draw,
            view,
            index,
            chunk,
            width,
            height,
          );
        });
        engine.device.queue.writeBuffer(
          uniformBuffer,
          0,
          engine.vectorTextGpuUniformUpload,
          0,
          draws.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
        );
        const encoder = engine.device.createCommandEncoder({
          label: `Vector raster ${format} chunk ${x},${y} ${width}x${height}`,
        });
        const pass = encoder.beginRenderPass({
          label: `Vector raster ${format} MSAA4 chunk ${x},${y}`,
          colorAttachments: [{
            view: msaaView,
            resolveTarget: resolvedView,
            loadOp: "clear",
            storeOp: "discard",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        pass.setViewport(0, 0, width, height, 0, 1);
        pass.setScissorRect(0, 0, width, height);
        for (let index = 0; index < draws.length; index += 1) {
          const draw = draws[index];
          if (draw.opacity <= 0) continue;
          const resources = drawResources[index];
          const blur = blurResources[index];
          const dynamicOffset = index * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
          if (draw.mode === "slug-blur" || draw.mode === "mesh-blur") {
            if (!blur) throw new Error("Cache ombra vettoriale mancante.");
            pass.setPipeline(pipelines.blurComposite);
            pass.setBindGroup(0, blur.compositeBindGroup, [dynamicOffset]);
            pass.draw(6, 1, 0, 0);
          } else if (draw.mode === "slug-inner-shadow-direct") {
            if (resources.kind !== "slug") {
              throw new Error("Risorsa Slug incoerente con l'ombra interna.");
            }
            if (resources.curveCount === 0) continue;
            pass.setPipeline(pipelines.slugInnerShadowDirect);
            pass.setBindGroup(0, resources.bindGroup, [dynamicOffset]);
            pass.draw(6, 1, 0, 0);
          } else if (draw.mode === "slug-inner-shadow-blur") {
            if (!blur) throw new Error("Cache ombra interna Slug mancante.");
            if (resources.kind !== "slug") {
              throw new Error("Risorsa Slug incoerente con l'ombra interna sfocata.");
            }
            if (resources.curveCount === 0) continue;
            pass.setPipeline(pipelines.slugInnerShadowBlur);
            pass.setBindGroup(0, resources.bindGroup, [dynamicOffset]);
            pass.setBindGroup(1, blur.innerShadowBindGroup);
            pass.draw(6, 1, 0, 0);
          } else if (draw.mode === "mesh-inner-shadow-blur") {
            if (!blur) throw new Error("Cache ombra interna mesh mancante.");
            if (resources.kind !== "mesh") {
              throw new Error("Risorsa mesh incoerente con l'ombra interna sfocata.");
            }
            if (resources.indexCount === 0) continue;
            pass.setPipeline(pipelines.meshInnerShadowBlur);
            pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
            pass.setBindGroup(1, blur.innerShadowBindGroup);
            pass.setVertexBuffer(0, resources.vertexBuffer);
            pass.setIndexBuffer(resources.indexBuffer, "uint32");
            pass.drawIndexed(resources.indexCount, 1, 0, 0, 0);
          } else if (draw.mode === "mesh-direct") {
            if (resources.kind !== "mesh") {
              throw new Error("Risorsa mesh incoerente con la draw vettoriale.");
            }
            if (resources.indexCount === 0) continue;
            pass.setPipeline(pipelines.meshFill);
            pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
            pass.setVertexBuffer(0, resources.vertexBuffer);
            pass.setIndexBuffer(resources.indexBuffer, "uint32");
            pass.drawIndexed(resources.indexCount, 1, 0, 0, 0);
          } else {
            if (resources.kind !== "slug") {
              throw new Error("Risorsa Slug incoerente con la draw vettoriale.");
            }
            if (resources.curveCount === 0) continue;
            pass.setPipeline(pipelines.slugFill);
            pass.setBindGroup(0, resources.bindGroup, [dynamicOffset]);
            pass.draw(6, 1, 0, 0);
          }
        }
        pass.end();
        const copyLeft = Math.max(x, destinationDocumentBounds.x);
        const copyTop = Math.max(y, destinationDocumentBounds.y);
        const copyRight = Math.min(
          x + width,
          destinationDocumentBounds.x + destinationDocumentBounds.width,
        );
        const copyBottom = Math.min(
          y + height,
          destinationDocumentBounds.y + destinationDocumentBounds.height,
        );
        if (copyRight > copyLeft && copyBottom > copyTop) {
          encoder.copyTextureToTexture(
            {
              texture: resolvedTexture,
              origin: { x: copyLeft - x, y: copyTop - y, z: 0 },
            },
            {
              texture: destination.texture,
              origin: {
                x: copyLeft - destinationDocumentBounds.x,
                y: copyTop - destinationDocumentBounds.y,
                z: 0,
              },
            },
            {
              width: copyRight - copyLeft,
              height: copyBottom - copyTop,
              depthOrArrayLayers: 1,
            },
          );
        }
        engine.device.queue.submit([encoder.finish()]);
        chunkCount += 1;
      }
    }
    await engine.waitForGpuCapped(
      `Rasterizzazione vettoriale ${format} MSAA4`,
      60_000,
    );
  } finally {
    msaaTexture.destroy();
    resolvedTexture.destroy();
  }
  return { bounds, chunkCount };
}

async function renderVectorDrawsToLayer(
  engine: BrushEngine,
  draws: readonly VectorTextGpuDraw[],
  view: VectorTextViewState,
  destination: LayerTextureResources,
): Promise<{ bounds: VectorRasterizeHistoryAction["baseBounds"]; chunkCount: number }> {
  return renderVectorDrawsToTexture(engine, draws, view, destination);
}

async function hydrateHistorySeed(
  engine: BrushEngine,
  action: VectorRasterizeHistoryAction,
): Promise<LayerGpuResources> {
  if (action.seed.format !== engine.layerFormat) {
    throw new Error(
      `Seed raster vettoriale ${action.seed.format} incompatibile con documento `
      + `${engine.layerFormat}; Redo rifiutato.`,
    );
  }
  const gpu = await allocateLayerGpuResources(
    engine,
    action.seed.format,
    `Reidratazione raster vettoriale storico livello ${action.layerId}`,
  );
  const hot = gpu.hot;
  if (!hot) {
    destroyLayerGpuResources(engine, gpu);
    throw new Error("Texture hot del raster vettoriale storico mancante.");
  }
  try {
    const encoder = engine.device.createCommandEncoder({
      label: `Copia seed tiled raster vettoriale livello ${action.layerId}`,
    });
    encodeLayerColdHydration(encoder, action.seed, hot);
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped(
      `Reidratazione raster vettoriale livello ${action.layerId}`,
      60_000,
    );
    return gpu;
  } catch (error) {
    destroyLayerGpuResources(engine, gpu);
    throw error;
  }
}

async function discardVectorRasterCandidateAndRestoreOriginalActive(
  engine: BrushEngine,
  originalActiveId: number,
  candidateLayerId: number | null,
  candidateGpu: LayerGpuResources | null,
  caller: EffectsRetargetCaller = "layer-switch",
): Promise<void> {
  // A late activation/seed failure can leave the candidate bound to live engine
  // fields while presentation is otherwise valid. Freeze first: the structural
  // rollback below deliberately destroys those bindings before activateLayer()
  // publishes replacements for the original raster.
  engine.layerPresentationFrozen = true;
  const originalIndexBeforeDetach = engine.layerStack.indexOfId(originalActiveId);
  if (originalIndexBeforeDetach < 0) {
    throw new Error("Livello attivo originale perso durante il rollback vettoriale.");
  }
  engine.layerStack.setActiveIndex(originalIndexBeforeDetach);

  if (candidateLayerId !== null) {
    const candidateIndex = engine.layerStack.indexOfId(candidateLayerId);
    if (candidateIndex >= 0) {
      const detached = engine.layerStack.remove(candidateIndex);
      if (detached.id !== candidateLayerId) {
        throw new Error("Record candidato sostituito durante il rollback vettoriale.");
      }
    }
    if (engine.layerStack.indexOfId(candidateLayerId) >= 0) {
      throw new Error(`Livello candidato ${candidateLayerId} non staccabile durante il rollback.`);
    }

    const registeredGpu = engine.layerGpu.get(candidateLayerId) ?? null;
    if (registeredGpu) engine.layerGpu.delete(candidateLayerId);
    // Every vector render, cold pack and composite candidate crosses an awaited
    // GPU fence before it can reach this rollback boundary. Destruction is thus
    // safe here and, crucially, happens before rehydrating the original raster.
    if (registeredGpu) destroyLayerGpuResources(engine, registeredGpu);
    if (candidateGpu && candidateGpu !== registeredGpu) {
      destroyLayerGpuResources(engine, candidateGpu);
    }
  } else if (candidateGpu) {
    destroyLayerGpuResources(engine, candidateGpu);
  }

  const originalIndex = engine.layerStack.indexOfId(originalActiveId);
  if (originalIndex < 0) {
    throw new Error("Livello attivo originale perso dopo lo stacco del candidato vettoriale.");
  }
  engine.layerStack.setActiveIndex(originalIndex);
  // The candidate no longer belongs to the stack. Passing its stale index would
  // make commitActiveLayerResidency dereference the raster now occupying it.
  await engine.activateLayer(originalIndex, caller);
}

async function freezeVectorRasterPresentationForRollback(engine: BrushEngine): Promise<void> {
  if (engine.layerPresentationFrozen) return;
  try {
    // A completed activation requests one valid frame. Drain it while scene,
    // stack and GPU ownership still agree, then freeze before mutating them.
    await engine.waitForIdle();
  } finally {
    // Even a failed drain must stop further presentation: the caller will either
    // rebuild a coherent original state or latch the document inconsistent.
    engine.layerPresentationFrozen = true;
  }
}

export async function rasterizeVectorNodeToLayer(
  engine: BrushEngine,
  sourceKind: VectorRasterizeHistoryAction["sourceKind"],
  sourceId: number,
  draws: readonly VectorTextGpuDraw[],
): Promise<VectorRasterConversionResult> {
  if (!engine.initialized) throw new Error("Il motore non è inizializzato.");
  const format = engine.layerFormat;
  if (engine.layerStack.count >= LAYER_STACK_MAXIMUM) {
    throw new Error(`Massimo ${LAYER_STACK_MAXIMUM} livelli raggiunto.`);
  }
  engine.assertLayerSwitchAllowed();
  requireVectorDraws(draws);
  const scene = requireMixedSceneStack(engine);
  const selected = scene.selected;
  const selectedMatches = sourceKind === "text"
    ? selected.kind === "text" && selected.textNodeId === sourceId
    : selected.kind === "svg" && selected.svgNodeId === sourceId;
  if (!selectedMatches) {
    throw new Error(
      sourceKind === "text"
        ? "Seleziona il testo da rasterizzare."
        : "Seleziona l’SVG da rasterizzare.",
    );
  }

  const vectorKey = (sourceKind + ":" + sourceId) as MixedSceneVectorKey;
  const originalActiveId = engine.layerStack.active.id;
  const originalSceneState = scene.captureState();
  const originalExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  let recordId: number | null = null;
  let seed: VectorRasterizeHistoryAction["seed"] | null = null;
  let gpu: LayerGpuResources | null = null;
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  try {
    await engine.waitForIdle();
    const node = sourceKind === "text"
      ? scene.textById(sourceId)
      : scene.svgById(sourceId);
    const vectorState = scene.captureVectorHistoryState(vectorKey);
    const sceneIndex = vectorState.index;
    const rasterLayerIndex = scene.rasterIndexForSceneIndex(sceneIndex);
    engine.persistActiveLayerState();
    await engine.prepareActiveLayerForSwitch();

    const insertedIndex = engine.layerStack.insertAt(
      rasterLayerIndex,
      `${node.name} · raster`,
    );
    const record = engine.layerStack.at(insertedIndex);
    recordId = record.id;
    record.visible = node.visible;
    record.opacity = node.opacity;
    gpu = await allocateLayerGpuResources(
      engine,
      format,
      `Allocazione raster vettoriale livello ${record.id}`,
    );
    engine.layerGpu.set(record.id, gpu);
    const hot = gpu.hot;
    if (!hot) throw new Error(`Texture ${format} del raster vettoriale mancante.`);

    const view: VectorTextViewState = {
      canvasWidth: engine.documentWidth,
      canvasHeight: engine.documentHeight,
      cssWidth: engine.documentWidth,
      cssHeight: engine.documentHeight,
      centerX: engine.documentWidth * 0.5,
      centerY: engine.documentHeight * 0.5,
      zoom: 1,
      rotationRadians: 0,
      rotationCos: 1,
      rotationSin: 0,
    };
    const rendered = await renderVectorDrawsToLayer(engine, draws, view, hot);
    record.contentBounds = { ...rendered.bounds };
    record.hasContent = true;
    record.storageTileMask.fill(0);
    markLayerStorageRect(record.storageTileMask, rendered.bounds);
    scene.replaceVectorWithRaster(vectorKey, record.id);
    engine.vectorTextPreviewExcludedNodeId = null;
    clearVectorTextPresentationForTransaction(engine);
    const previousIndexAfterInsertion = engine.layerStack.indexOfId(originalActiveId);
    if (previousIndexAfterInsertion < 0) {
      throw new Error("Livello attivo precedente perso durante la conversione vettoriale.");
    }
    await engine.activateLayer(previousIndexAfterInsertion, "layer-switch");
    engine.clearVectorTextPresentation();
    // Capture the immutable Undo authority only after activation has retired its
    // transient composite resources. Holding both peaks at once can exhaust an
    // older mobile GPU and was the source of the apparent permanent lock.
    seed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      record.storageTileMask.slice(),
      1,
      "history",
    );
    engine.publishActiveLayerChange();
    return {
      history: {
        sourceKind,
        layerId: record.id,
        layerRecord: record,
        rasterLayerIndex,
        vectorState,
        activeRasterLayerIdBefore: originalActiveId,
        seed,
        baseBounds: { ...rendered.bounds },
        baseTileMask: record.storageTileMask.slice(),
      },
      chunkCount: rendered.chunkCount,
      tileCount: countLayerStorageTiles(record.storageTileMask),
      format: seed.format,
    };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    let rollbackPrepared = false;
    try {
      await freezeVectorRasterPresentationForRollback(engine);
      rollbackPrepared = true;
    } catch (drainError) {
      rollbackErrors.push(drainError);
    }
    if (rollbackPrepared) {
      try {
        scene.restoreState(originalSceneState);
        engine.vectorTextPreviewExcludedNodeId = originalExcludedNodeId;
        clearVectorTextPresentationForTransaction(engine);
      } catch (restoreSceneError) {
        rollbackErrors.push(restoreSceneError);
      }
      try {
        destroyLayerColdStorage(seed);
        seed = null;
      } catch (releaseSeedError) {
        rollbackErrors.push(releaseSeedError);
      }
      try {
        await discardVectorRasterCandidateAndRestoreOriginalActive(
          engine,
          originalActiveId,
          recordId,
          gpu,
        );
      } catch (restoreLayerError) {
        rollbackErrors.push(restoreLayerError);
      }
    }
    if (rollbackErrors.length > 0) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const details = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      const combined = new Error(
        `Rasterizzazione vettoriale fallita (${operationMessage}); rollback fallito: ${details}`,
      );
      engine.latchDocumentStateInconsistent(
        "Rasterizzazione vettoriale fallita e rollback incompleto: ricarica la pagina.",
        combined,
      );
      throw combined;
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
}

/**
 * A successful conversion is visible before its journal action is appended. If
 * that CPU-only publication fails, retire the unpublished candidate and seed
 * before rehydrating the original raster, keeping the rollback below the same
 * mobile memory peak as the forward operation.
 */
export async function rollbackUnpublishedVectorRasterization(
  engine: BrushEngine,
  action: VectorRasterizeHistoryAction,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const candidateGpu = engine.layerGpu.get(action.layerId) ?? null;
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  try {
    await freezeVectorRasterPresentationForRollback(engine);
    scene.replaceRasterWithVector(action.layerId, action.vectorState);
    const restoredSelection = scene.selected;
    engine.vectorTextPreviewExcludedNodeId = restoredSelection.kind === "text"
      ? restoredSelection.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    destroyLayerColdStorage(action.seed);
    await discardVectorRasterCandidateAndRestoreOriginalActive(
      engine,
      action.activeRasterLayerIdBefore,
      action.layerId,
      candidateGpu,
      "structural-history",
    );
    engine.clearVectorTextPresentation();
    engine.publishActiveLayerChange();
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

async function switchActiveForStructuralHistory(
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
      const first = error instanceof Error ? error.message : String(error);
      const second = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      const combined = new Error(`${first}; rollback cambio livello fallito: ${second}`);
      engine.latchDocumentStateInconsistent(
        "Cambio livello fallito durante Undo/Redo della rasterizzazione vettoriale.",
        combined,
      );
      throw combined;
    }
    throw error;
  }
}

async function undoVectorRasterization(
  engine: BrushEngine,
  action: VectorRasterizeHistoryAction,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const sceneState = scene.captureState();
  const originalActiveId = engine.layerStack.active.id;
  const targetIndex = engine.layerStack.indexOfId(action.layerId);
  if (targetIndex < 0) throw new Error("Raster vettoriale da annullare non presente.");
  await switchActiveForStructuralHistory(engine, targetIndex);
  const activeTargetIndex = engine.layerStack.indexOfId(action.layerId);
  const fallbackIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
  if (fallbackIndex < 0 || action.activeRasterLayerIdBefore === action.layerId) {
    throw new Error(
      "Raster attivo precedente alla rasterizzazione non disponibile.",
    );
  }

  // Crossing this structural action means every later raster edit has already
  // been undone. The immutable tiled seed is therefore authoritative for the
  // generated layer, which is about to leave the scene; packing that same hot
  // texture into a second cold copy would only add a GPU fence and memory peak.
  scene.replaceRasterWithVector(action.layerId, action.vectorState);
  const restoredSelection = scene.selected;
  engine.vectorTextPreviewExcludedNodeId = restoredSelection.kind === "text"
    ? restoredSelection.textNodeId
    : null;
  clearVectorTextPresentationForTransaction(engine);
  engine.layerStack.setActiveIndex(fallbackIndex);
  try {
    await engine.activateLayer(activeTargetIndex, "structural-history");
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      scene.restoreState(sceneState);
      clearVectorTextPresentationForTransaction(engine);
      const restoredTargetIndex = engine.layerStack.indexOfId(action.layerId);
      engine.layerStack.setActiveIndex(restoredTargetIndex);
      await engine.activateLayer(fallbackIndex, "structural-history");
      if (originalActiveId !== action.layerId) {
        const originalIndex = engine.layerStack.indexOfId(originalActiveId);
        await switchActiveForStructuralHistory(engine, originalIndex);
      }
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    if (rollbackErrors.length > 0) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      const combined = new Error(
        `Undo rasterizzazione fallito (${originalMessage}); rollback fallito: ${rollbackMessage}`,
      );
      engine.latchDocumentStateInconsistent(
        "Undo della rasterizzazione vettoriale fallito e rollback incompleto.",
        combined,
      );
      throw combined;
    }
    throw error;
  }

  const detachedIndex = engine.layerStack.indexOfId(action.layerId);
  const detached = engine.layerStack.remove(detachedIndex);
  if (detached !== action.layerRecord) {
    throw new Error("Record raster vettoriale storico sostituito inaspettatamente.");
  }
  const gpu = engine.layerGpu.get(action.layerId);
  if (!gpu) throw new Error("Risorse del raster vettoriale da staccare mancanti.");
  engine.layerGpu.delete(action.layerId);
  destroyLayerGpuResources(engine, gpu);
  engine.clearVectorTextPresentation();
  engine.publishActiveLayerChange();
}

async function redoVectorRasterization(
  engine: BrushEngine,
  action: VectorRasterizeHistoryAction,
): Promise<void> {
  const scene = requireMixedSceneStack(engine);
  const sceneState = scene.captureState();
  const originalActiveId = engine.layerStack.active.id;
  const originalExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  if (engine.layerStack.indexOfId(action.layerId) >= 0) {
    throw new Error("Raster vettoriale già presente durante Redo.");
  }
  engine.persistActiveLayerState();
  await engine.prepareActiveLayerForSwitch();
  let gpu: LayerGpuResources | null = null;
  try {
    gpu = await hydrateHistorySeed(engine, action);
    action.layerRecord.contentBounds = { ...action.baseBounds };
    action.layerRecord.hasContent = true;
    action.layerRecord.storageTileMask.set(action.baseTileMask);
    engine.layerStack.attach(action.layerRecord, action.rasterLayerIndex);
    engine.layerGpu.set(action.layerId, gpu);
    scene.replaceVectorWithRaster(action.vectorState.key, action.layerId);
    engine.vectorTextPreviewExcludedNodeId = null;
    clearVectorTextPresentationForTransaction(engine);
    const previousIndexAfterInsertion = engine.layerStack.indexOfId(originalActiveId);
    await engine.activateLayer(previousIndexAfterInsertion, "structural-history");
    engine.clearVectorTextPresentation();
    engine.publishActiveLayerChange();
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    let rollbackPrepared = false;
    try {
      await freezeVectorRasterPresentationForRollback(engine);
      rollbackPrepared = true;
    } catch (drainError) {
      rollbackErrors.push(drainError);
    }
    if (rollbackPrepared) {
      try {
        scene.restoreState(sceneState);
        engine.vectorTextPreviewExcludedNodeId = originalExcludedNodeId;
        clearVectorTextPresentationForTransaction(engine);
      } catch (restoreError) {
        rollbackErrors.push(restoreError);
      }
      try {
        await discardVectorRasterCandidateAndRestoreOriginalActive(
          engine,
          originalActiveId,
          action.layerId,
          gpu,
          "structural-history",
        );
      } catch (restoreError) {
        rollbackErrors.push(restoreError);
      }
    }
    if (rollbackErrors.length > 0) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((failure) =>
        failure instanceof Error ? failure.message : String(failure)
      ).join("; ");
      const combined = new Error(
        `Redo rasterizzazione fallito (${originalMessage}); rollback fallito: ${rollbackMessage}`,
      );
      engine.latchDocumentStateInconsistent(
        "Redo della rasterizzazione vettoriale fallito e rollback incompleto.",
        combined,
      );
      throw combined;
    }
    throw error;
  }
}

export async function applyVectorRasterizeHistory(
  engine: BrushEngine,
  action: VectorRasterizeHistoryAction,
  delta: -1 | 1,
): Promise<void> {
  if (!action.vectorState.key.startsWith(action.sourceKind + ":")) {
    throw new Error("Tipo sorgente incoerente nella cronologia raster vettoriale.");
  }
  if (action.seed.format !== engine.layerFormat) {
    throw new Error(
      `La cronologia raster vettoriale ${action.seed.format} non è compatibile con il `
      + `documento ${engine.layerFormat}.`,
    );
  }
  engine.layerSwitchBusy = true;
  try {
    if (delta < 0) {
      await undoVectorRasterization(engine, action);
    } else {
      await redoVectorRasterization(engine, action);
    }
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

export function destroyVectorRasterHistorySeed(
  action: VectorRasterizeHistoryAction,
): void {
  destroyLayerColdStorage(action.seed);
}
