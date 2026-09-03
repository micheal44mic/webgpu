import type { BrushEngine } from "./brush-engine";
import { VECTOR_TEXT_GPU_MAXIMUM_DRAWS } from "./engine-limits";
import {
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
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
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_WIDTH,
  countLayerStorageTiles,
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
import {
  analyzeRasterTextureOccupancy,
  prepareRasterOccupancyAnalysis,
} from "./raster-occupancy-analysis";
import { rgba8SpatialQuantizationShader } from "./rgba8-spatial-quantization";
import { createRenderPipelineAsync } from "./engine-gpu-utils";

export const VECTOR_RASTERIZATION_STRATEGY =
  "semantic-vector-slug-mesh-webgpu-msaa4-domain-parity-rgba8-quantize-tile-paired-batched-chunks-history-seed-v6" as const;
export function vectorRasterChunkDimensions(): { width: number; height: number } {
  return {
    width: LAYER_STORAGE_TILE_WIDTH * 2,
    height: LAYER_STORAGE_TILE_HEIGHT * 2,
  };
}
export const VECTOR_RASTER_MAX_CHUNKS_PER_SUBMISSION = 8;
const ENCODED_VECTOR_RASTER_FINALIZE_UNIFORM_BYTES = 16;
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

interface EncodedVectorRasterScratch {
  readonly texture: GPUTexture;
  readonly view: GPUTextureView;
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly pipeline: GPURenderPipeline;
}

interface VectorRasterChunk {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visibleDrawIndices: readonly number[];
}

const pipelinesByDevice = new WeakMap<
  GPUDevice,
  Map<LayerFormat, Promise<VectorRasterPipelines>>
>();

const encodedFinalizePipelinesByDevice = new WeakMap<
  GPUDevice,
  Promise<GPURenderPipeline>
>();

const ENCODED_VECTOR_RASTER_FINALIZE_WGSL = /* wgsl */ `
${rgba8SpatialQuantizationShader}

struct FinalizeUniforms {
  documentOrigin: vec2<u32>,
  actionSeed: u32,
  _pad0: u32,
};

@group(0) @binding(0) var encodedTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> finalize: FinalizeUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  let local = vec2<i32>(fragmentPosition.xy);
  let documentCoordinate = finalize.documentOrigin + vec2<u32>(local);
  return quantizeRgba8SpatialAdjacent(
    textureLoad(encodedTexture, local, 0),
    documentCoordinate,
    finalize.actionSeed,
  );
}
`;

function synchronizeRasterClippingProjection(engine: BrushEngine): void {
  const scene = requireMixedSceneStack(engine);
  engine.layerStack.restoreClippingHistoryState(
    scene.rasterClippingProjection(
      engine.layerStack.layers.map((record) => record.id),
    ),
  );
}

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
  if (format === VECTOR_TEXT_GPU_TARGET_FORMAT) {
    const reused = {
      meshFill: engine.vectorTextGpuFillPipeline,
      slugFill: engine.vectorTextGpuSlugPipeline,
      blurComposite: engine.vectorTextGpuBlurCompositePipeline,
      slugInnerShadowDirect: engine.vectorTextGpuInnerShadowDirectPipeline,
      slugInnerShadowBlur: engine.vectorTextGpuInnerShadowBlurPipeline,
      meshInnerShadowBlur: engine.vectorTextGpuMeshInnerShadowBlurPipeline,
    };
    if (Object.values(reused).every((pipeline) => pipeline !== null)) {
      return reused as VectorRasterPipelines;
    }
  }
  let devicePipelines = pipelinesByDevice.get(engine.device);
  if (!devicePipelines) {
    devicePipelines = new Map();
    pipelinesByDevice.set(engine.device, devicePipelines);
  }
  const existing = devicePipelines.get(format);
  if (existing) return existing;
  const pending = runGpuAllocationTransaction(
    engine.device,
    `Vector rasterization pipeline ${format}`,
    async () => {
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
        throw new Error("The GPU vector renderer is not ready to rasterize the node.");
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
      const [
        meshFill,
        slugFill,
        blurComposite,
        slugInnerShadowDirect,
        slugInnerShadowBlur,
        meshInnerShadowBlur,
      ] = await Promise.all([
        createRenderPipelineAsync(engine.device, {
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
        }),
        createRenderPipelineAsync(engine.device, {
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
        }),
        createRenderPipelineAsync(engine.device, {
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
        }),
        createRenderPipelineAsync(engine.device, {
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
        }),
        createRenderPipelineAsync(engine.device, {
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
        }),
        createRenderPipelineAsync(engine.device, {
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
        }),
      ]);
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
      `The GPU does not support ${format} vector rasterization. `
      + `No RGBA8 fallback is allowed. Details: ${message}`,
    );
  }
}

async function createVectorRasterScratch(
  engine: BrushEngine,
  format: LayerFormat,
  chunkWidth: number,
  chunkHeight: number,
): Promise<VectorRasterScratch> {
  try {
    return await runGpuAllocationTransaction(
      engine.device,
      `Vector raster scratch ${format} MSAA${VECTOR_TEXT_GPU_SAMPLE_COUNT}`,
      (transaction) => {
        const msaaTexture = engine.device.createTexture({
          label: `Vector raster ${format} MSAA4 ${chunkWidth}x${chunkHeight} tile-aligned scratch`,
          size: {
            width: chunkWidth,
            height: chunkHeight,
            depthOrArrayLayers: 1,
          },
          sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        transaction.deferRollback(() => msaaTexture.destroy());
        const resolvedTexture = engine.device.createTexture({
          label: `Vector raster ${format} resolved ${chunkWidth}x${chunkHeight} tile-aligned scratch`,
          size: {
            width: chunkWidth,
            height: chunkHeight,
            depthOrArrayLayers: 1,
          },
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT
            | GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.TEXTURE_BINDING,
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
      `The GPU does not support ${format} vector raster scratch. `
      + `No RGBA8 fallback is allowed. Details: ${message}`,
    );
  }
}

async function ensureEncodedVectorRasterFinalizePipeline(
  engine: BrushEngine,
): Promise<GPURenderPipeline> {
  const existing = encodedFinalizePipelinesByDevice.get(engine.device);
  if (existing) return existing;
  const module = engine.device.createShaderModule({
    label: "Vector raster encoded RGBA8 quantization WGSL",
    code: ENCODED_VECTOR_RASTER_FINALIZE_WGSL,
  });
  const pending = createRenderPipelineAsync(engine.device, {
    label: "Vector raster encoded RGBA8 quantization",
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  encodedFinalizePipelinesByDevice.set(engine.device, pending);
  try {
    return await pending;
  } catch (error) {
    if (encodedFinalizePipelinesByDevice.get(engine.device) === pending) {
      encodedFinalizePipelinesByDevice.delete(engine.device);
    }
    throw error;
  }
}

function createEncodedVectorRasterScratch(
  engine: BrushEngine,
  pipeline: GPURenderPipeline,
  linearView: GPUTextureView,
  width: number,
  height: number,
): EncodedVectorRasterScratch {
  const texture = engine.device.createTexture({
    label: `Vector raster encoded RGBA8 finalize ${width}x${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const uniformBuffer = engine.device.createBuffer({
    label: "Vector raster encoded RGBA8 finalize uniforms",
    size: ENCODED_VECTOR_RASTER_FINALIZE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    const view = texture.createView({
      label: "Vector raster encoded RGBA8 finalize view",
    });
    const bindGroup = engine.device.createBindGroup({
      label: "Vector raster encoded RGBA8 finalize bindings",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: linearView },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    });
    return { texture, view, uniformBuffer, bindGroup, pipeline };
  } catch (error) {
    uniformBuffer.destroy();
    texture.destroy();
    throw error;
  }
}

function requireVectorDraws(draws: readonly VectorTextGpuDraw[]): void {
  if (draws.length === 0) {
    throw new Error("The vector node contains no rasterizable draws.");
  }
  if (draws.length > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
    throw new Error(
      `The vector exceeds the limit of ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} draw calls.`,
    );
  }
}

function vectorRasterBoundsIntersect(
  first: Readonly<VectorRasterizeHistoryAction["baseBounds"]>,
  second: Readonly<VectorRasterizeHistoryAction["baseBounds"]>,
): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
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
    throw new Error("Too many vector blur caches to prepare.");
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
    throw new Error("The vector blur GPU resources are not ready.");
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
    label: "Prepare high-precision vector blur cache for rasterization",
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
        throw new Error("The mesh resource does not match the vector blur mask.");
      }
      sourcePass.setPipeline(meshMaskPipeline);
      sourcePass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
      sourcePass.setVertexBuffer(0, build.resources.vertexBuffer);
      sourcePass.setIndexBuffer(build.resources.indexBuffer, "uint32");
      sourcePass.drawIndexed(build.resources.indexCount, 1, 0, 0, 0);
    } else {
      if (build.resources.kind !== "slug") {
        throw new Error("The Slug resource does not match the vector blur mask.");
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
  outputDomain: "document-storage" | "linear-premultiplied" = "document-storage",
): Promise<{ bounds: VectorRasterizeHistoryAction["baseBounds"]; chunkCount: number }> {
  requireVectorDraws(draws);
  const linearWorkingOutput = outputDomain === "linear-premultiplied";
  if (!linearWorkingOutput && destination.format !== engine.layerFormat) {
    throw new Error(
      `Vector raster destination ${destination.format} is incompatible with document `
      + `${engine.layerFormat}.`,
    );
  }
  if (linearWorkingOutput && destination.format !== "rgba16float") {
    throw new Error("Linear vector raster output requires an RGBA16F destination.");
  }
  const format = destination.format;
  const storedEncodedSrgb =
    !linearWorkingOutput
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied";
  if (storedEncodedSrgb && format !== "rgba8unorm") {
    throw new Error("Encoded-sRGB vector raster storage requires an RGBA8 destination.");
  }
  // RGBA16F keeps the live renderer's encoded-premultiplied draw values exact
  // through blending and MSAA resolve. The final pass only quantizes those
  // values into permanent RGBA8 storage, so overlapping translucent paints
  // retain the same source-over result before and after rasterization.
  const renderFormat: LayerFormat = storedEncodedSrgb ? "rgba16float" : format;
  const [pipelines, encodedFinalizePipeline] = await Promise.all([
    ensureVectorRasterPipelines(engine, renderFormat),
    storedEncodedSrgb
      ? ensureEncodedVectorRasterFinalizePipeline(engine)
      : Promise.resolve(null),
  ]);
  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  if (!uniformBuffer || !uniformBindGroup) {
    throw new Error("The vector GPU uniforms are not initialized.");
  }
  const drawResources = draws.map((draw) => ensureVectorTextGpuResource(engine, draw));
  const blurResources = draws.map((draw) =>
    vectorTextGpuDrawUsesBlur(draw)
      ? ensureVectorTextGpuBlurCache(engine, draw)
      : null
  );
  encodeMissingBlurCaches(engine, draws, drawResources, blurResources);

  const bounds = vectorTextGpuRunBounds(draws, view);
  const drawBounds = draws.map((draw) => vectorTextGpuRunBounds([draw], view));
  const { width: chunkWidth, height: chunkHeight } = vectorRasterChunkDimensions();
  const firstChunkX = Math.floor(bounds.x / chunkWidth) * chunkWidth;
  const firstChunkY = Math.floor(bounds.y / chunkHeight) * chunkHeight;
  const lastChunkX = Math.ceil((bounds.x + bounds.width) / chunkWidth) * chunkWidth;
  const lastChunkY = Math.ceil((bounds.y + bounds.height) / chunkHeight) * chunkHeight;
  const chunks: VectorRasterChunk[] = [];
  for (let y = firstChunkY; y < lastChunkY; y += chunkHeight) {
    for (let x = firstChunkX; x < lastChunkX; x += chunkWidth) {
      const width = Math.min(chunkWidth, view.canvasWidth - x);
      const height = Math.min(chunkHeight, view.canvasHeight - y);
      if (width <= 0 || height <= 0) continue;
      const chunk = { x, y, width, height };
      const visibleDrawIndices: number[] = [];
      draws.forEach((draw, index) => {
        if (
          draw.opacity > 0
          && vectorRasterBoundsIntersect(drawBounds[index], chunk)
        ) {
          visibleDrawIndices.push(index);
        }
      });
      if (visibleDrawIndices.length > 0) {
        chunks.push({ ...chunk, visibleDrawIndices });
      }
    }
  }
  const { msaaTexture, resolvedTexture, msaaView, resolvedView } =
    await createVectorRasterScratch(engine, renderFormat, chunkWidth, chunkHeight);
  const encodedScratch = storedEncodedSrgb
    ? createEncodedVectorRasterScratch(
      engine,
      encodedFinalizePipeline!,
      resolvedView,
      chunkWidth,
      chunkHeight,
    )
    : null;
  const maximumVisibleDraws = chunks.reduce(
    (maximum, chunk) => Math.max(maximum, chunk.visibleDrawIndices.length),
    0,
  );
  const batchedUploadSlotCount = chunks.length > 1
    ? Math.min(VECTOR_RASTER_MAX_CHUNKS_PER_SUBMISSION, chunks.length)
    : 0;
  const drawUniformSlotBytes = maximumVisibleDraws * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
  const uploadSlotBytes = drawUniformSlotBytes
    + (encodedScratch ? ENCODED_VECTOR_RASTER_FINALIZE_UNIFORM_BYTES : 0);
  let batchedUploadBuffer: GPUBuffer | null = null;
  const finalizeUniformUpload = encodedScratch ? new Uint32Array(4) : null;
  let chunkCount = 0;
  let batchChunkCount = 0;
  let batchIndex = 0;
  let batchEncoder: GPUCommandEncoder | null = null;
  const flushBatch = (): void => {
    if (!batchEncoder) return;
    engine.device.queue.submit([batchEncoder.finish()]);
    batchEncoder = null;
    batchChunkCount = 0;
    batchIndex += 1;
  };
  try {
    if (batchedUploadSlotCount > 0) {
      batchedUploadBuffer = engine.device.createBuffer({
        label: `Vector raster uniforms for ${batchedUploadSlotCount}-chunk submissions`,
        size: batchedUploadSlotCount * uploadSlotBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
    }
    for (const chunk of chunks) {
        const { x, y, width, height, visibleDrawIndices } = chunk;
        visibleDrawIndices.forEach((index, uniformIndex) => {
          writeVectorTextGpuDrawUniform(
            engine,
            draws[index],
            view,
            uniformIndex,
            chunk,
            width,
            height,
            storedEncodedSrgb ? "document-storage" : "linear-premultiplied",
          );
        });
        const drawUniformBytes = visibleDrawIndices.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
        if (!batchEncoder) {
          batchEncoder = engine.device.createCommandEncoder({
            label: `Vector raster ${renderFormat} chunk batch ${batchIndex + 1}`,
          });
        }
        const encoder = batchEncoder;
        const uploadSlotOffset = batchChunkCount * uploadSlotBytes;
        if (batchedUploadBuffer) {
          engine.device.queue.writeBuffer(
            batchedUploadBuffer,
            uploadSlotOffset,
            engine.vectorTextGpuUniformUpload,
            0,
            drawUniformBytes / 4,
          );
          encoder.copyBufferToBuffer(
            batchedUploadBuffer,
            uploadSlotOffset,
            uniformBuffer,
            0,
            drawUniformBytes,
          );
        } else {
          engine.device.queue.writeBuffer(
            uniformBuffer,
            0,
            engine.vectorTextGpuUniformUpload,
            0,
            drawUniformBytes / 4,
          );
        }
        const pass = encoder.beginRenderPass({
          label: `Vector raster ${renderFormat} MSAA4 chunk ${x},${y}`,
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
        for (let uniformIndex = 0; uniformIndex < visibleDrawIndices.length; uniformIndex += 1) {
          const index = visibleDrawIndices[uniformIndex];
          const draw = draws[index];
          const resources = drawResources[index];
          const blur = blurResources[index];
          const dynamicOffset = uniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
          if (draw.mode === "slug-blur" || draw.mode === "mesh-blur") {
            if (!blur) throw new Error("The vector shadow cache is missing.");
            pass.setPipeline(pipelines.blurComposite);
            pass.setBindGroup(0, blur.compositeBindGroup, [dynamicOffset]);
            pass.draw(6, 1, 0, 0);
          } else if (draw.mode === "slug-inner-shadow-direct") {
            if (resources.kind !== "slug") {
              throw new Error("The Slug resource does not match the inner shadow.");
            }
            if (resources.curveCount === 0) continue;
            pass.setPipeline(pipelines.slugInnerShadowDirect);
            pass.setBindGroup(0, resources.bindGroup, [dynamicOffset]);
            pass.draw(6, 1, 0, 0);
          } else if (draw.mode === "slug-inner-shadow-blur") {
            if (!blur) throw new Error("The Slug inner-shadow cache is missing.");
            if (resources.kind !== "slug") {
              throw new Error("The Slug resource does not match the blurred inner shadow.");
            }
            if (resources.curveCount === 0) continue;
            pass.setPipeline(pipelines.slugInnerShadowBlur);
            pass.setBindGroup(0, resources.bindGroup, [dynamicOffset]);
            pass.setBindGroup(1, blur.innerShadowBindGroup);
            pass.draw(6, 1, 0, 0);
          } else if (draw.mode === "mesh-inner-shadow-blur") {
            if (!blur) throw new Error("The mesh inner-shadow cache is missing.");
            if (resources.kind !== "mesh") {
              throw new Error("The mesh resource does not match the blurred inner shadow.");
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
              throw new Error("The mesh resource does not match the vector draw.");
            }
            if (resources.indexCount === 0) continue;
            pass.setPipeline(pipelines.meshFill);
            pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
            pass.setVertexBuffer(0, resources.vertexBuffer);
            pass.setIndexBuffer(resources.indexBuffer, "uint32");
            pass.drawIndexed(resources.indexCount, 1, 0, 0, 0);
          } else {
            if (resources.kind !== "slug") {
              throw new Error("The Slug resource does not match the vector draw.");
            }
            if (resources.curveCount === 0) continue;
            pass.setPipeline(pipelines.slugFill);
            pass.setBindGroup(0, resources.bindGroup, [dynamicOffset]);
            pass.draw(6, 1, 0, 0);
          }
        }
        pass.end();
        if (encodedScratch) {
          finalizeUniformUpload![0] = x;
          finalizeUniformUpload![1] = y;
          finalizeUniformUpload![2] = engine.nextHistoryActionId;
          finalizeUniformUpload![3] = 0;
          if (batchedUploadBuffer) {
            const finalizeUploadOffset = uploadSlotOffset + drawUniformSlotBytes;
            engine.device.queue.writeBuffer(
              batchedUploadBuffer,
              finalizeUploadOffset,
              finalizeUniformUpload!,
            );
            encoder.copyBufferToBuffer(
              batchedUploadBuffer,
              finalizeUploadOffset,
              encodedScratch.uniformBuffer,
              0,
              ENCODED_VECTOR_RASTER_FINALIZE_UNIFORM_BYTES,
            );
          } else {
            engine.device.queue.writeBuffer(
              encodedScratch.uniformBuffer,
              0,
              finalizeUniformUpload!,
            );
          }
          const finalizePass = encoder.beginRenderPass({
            label: `Vector raster encoded RGBA8 finalize ${x},${y}`,
            colorAttachments: [{
              view: encodedScratch.view,
              loadOp: "clear",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            }],
          });
          finalizePass.setViewport(0, 0, width, height, 0, 1);
          finalizePass.setScissorRect(0, 0, width, height);
          finalizePass.setPipeline(encodedScratch.pipeline);
          finalizePass.setBindGroup(0, encodedScratch.bindGroup);
          finalizePass.draw(3, 1, 0, 0);
          finalizePass.end();
        }
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
              texture: encodedScratch?.texture ?? resolvedTexture,
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
        chunkCount += 1;
        batchChunkCount += 1;
        if (batchChunkCount >= VECTOR_RASTER_MAX_CHUNKS_PER_SUBMISSION) {
          flushBatch();
        }
      }
    flushBatch();
    await engine.waitForGpuCapped(
      `Vector rasterization ${renderFormat} MSAA4${storedEncodedSrgb ? " → encoded RGBA8" : ""}`,
      60_000,
    );
  } finally {
    batchedUploadBuffer?.destroy();
    encodedScratch?.uniformBuffer.destroy();
    encodedScratch?.texture.destroy();
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
      `Vector raster seed ${action.seed.format} is incompatible with document `
      + `${engine.layerFormat}; Redo refused.`,
    );
  }
  const gpu = await allocateLayerGpuResources(
    engine,
    action.seed.format,
    `Hydrate historical vector raster layer ${action.layerId}`,
  );
  const hot = gpu.hot;
  if (!hot) {
    destroyLayerGpuResources(engine, gpu);
    throw new Error("The historical vector raster hot texture is missing.");
  }
  try {
    const encoder = engine.device.createCommandEncoder({
      label: `Copy tiled vector raster seed for layer ${action.layerId}`,
    });
    encodeLayerColdHydration(encoder, action.seed, hot);
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped(
      `Hydrate vector raster layer ${action.layerId}`,
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
    throw new Error("The original active layer was lost during vector rollback.");
  }
  engine.layerStack.setActiveIndex(originalIndexBeforeDetach);

  if (candidateLayerId !== null) {
    const candidateIndex = engine.layerStack.indexOfId(candidateLayerId);
    if (candidateIndex >= 0) {
      const detached = engine.layerStack.remove(candidateIndex);
      if (detached.id !== candidateLayerId) {
        throw new Error("The candidate record was replaced during vector rollback.");
      }
    }
    if (engine.layerStack.indexOfId(candidateLayerId) >= 0) {
      throw new Error(`Candidate layer ${candidateLayerId} cannot be detached during rollback.`);
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
    throw new Error("The original active layer was lost after detaching the vector candidate.");
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

/**
 * Starts the small program set that is unique to permanent vector output.
 * Vector creation calls this without awaiting it, so a later conversion can
 * reuse the in-flight work instead of paying compilation cost after the click.
 */
export async function prepareVectorRasterizationResources(
  engine: BrushEngine,
): Promise<void> {
  const storedEncodedSrgb = engine.documentStorageColorSpace
    === "encoded-srgb-premultiplied";
  const rasterRenderFormat: LayerFormat = storedEncodedSrgb
    ? "rgba16float"
    : engine.layerFormat;
  await Promise.all([
    ensureVectorRasterPipelines(engine, rasterRenderFormat),
    storedEncodedSrgb
      ? ensureEncodedVectorRasterFinalizePipeline(engine)
      : Promise.resolve(null),
    prepareRasterOccupancyAnalysis(engine),
  ]);
}

export async function rasterizeVectorNodeToLayer(
  engine: BrushEngine,
  sourceKind: VectorRasterizeHistoryAction["sourceKind"],
  sourceId: number,
  draws: readonly VectorTextGpuDraw[],
): Promise<VectorRasterConversionResult> {
  if (!engine.initialized) throw new Error("The engine is not initialized.");
  const format = engine.layerFormat;
  if (engine.layerStack.count >= LAYER_STACK_MAXIMUM) {
    throw new Error(`The maximum of ${LAYER_STACK_MAXIMUM} layers has been reached.`);
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
        ? "Select the text to rasterize."
        : "Select the SVG to rasterize.",
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
    await Promise.all([
      engine.waitForIdle(),
      prepareVectorRasterizationResources(engine),
    ]);
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
      `Vector raster allocation for layer ${record.id}`,
    );
    engine.layerGpu.set(record.id, gpu);
    const hot = gpu.hot;
    if (!hot) throw new Error(`The ${format} vector raster texture is missing.`);

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
    const occupancy = await analyzeRasterTextureOccupancy(
      engine,
      hot.texture,
      rendered.bounds,
      `Rasterize ${sourceKind} ${sourceId}`,
    );
    if (!occupancy.bounds || occupancy.occupiedTileCount === 0) {
      throw new Error(
        sourceKind === "svg"
          ? "The SVG contains no visible pixels to rasterize."
          : "The text contains no visible pixels to rasterize.",
      );
    }
    record.contentBounds = { ...occupancy.bounds };
    record.hasContent = true;
    record.storageTileMask.set(occupancy.tileMask);
    scene.replaceVectorWithRaster(vectorKey, record.id);
    synchronizeRasterClippingProjection(engine);
    engine.vectorTextPreviewExcludedNodeId = null;
    clearVectorTextPresentationForTransaction(engine);
    const previousIndexAfterInsertion = engine.layerStack.indexOfId(originalActiveId);
    if (previousIndexAfterInsertion < 0) {
      throw new Error("The previously active layer was lost during vector conversion.");
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
        baseBounds: { ...occupancy.bounds },
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
        synchronizeRasterClippingProjection(engine);
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
        `Vector rasterization failed (${operationMessage}); rollback failed: ${details}`,
      );
      engine.latchDocumentStateInconsistent(
        "Vector rasterization failed and rollback is incomplete: reload the page.",
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
    synchronizeRasterClippingProjection(engine);
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
      const combined = new Error(`${first}; layer change rollback failed: ${second}`);
      engine.latchDocumentStateInconsistent(
        "Layer change failed during vector rasterization Undo/Redo.",
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
  if (targetIndex < 0) throw new Error("The vector raster to undo is not present.");
  await switchActiveForStructuralHistory(engine, targetIndex);
  const activeTargetIndex = engine.layerStack.indexOfId(action.layerId);
  const fallbackIndex = engine.layerStack.indexOfId(action.activeRasterLayerIdBefore);
  if (fallbackIndex < 0 || action.activeRasterLayerIdBefore === action.layerId) {
    throw new Error(
      "The raster active before rasterization is unavailable.",
    );
  }

  // Crossing this structural action means every later raster edit has already
  // been undone. The immutable tiled seed is therefore authoritative for the
  // generated layer, which is about to leave the scene; packing that same hot
  // texture into a second cold copy would only add a GPU fence and memory peak.
  scene.replaceRasterWithVector(action.layerId, action.vectorState);
  synchronizeRasterClippingProjection(engine);
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
      synchronizeRasterClippingProjection(engine);
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
        `Rasterization Undo failed (${originalMessage}); rollback failed: ${rollbackMessage}`,
      );
      engine.latchDocumentStateInconsistent(
        "Vector rasterization Undo failed and rollback is incomplete.",
        combined,
      );
      throw combined;
    }
    throw error;
  }

  const detachedIndex = engine.layerStack.indexOfId(action.layerId);
  const detached = engine.layerStack.remove(detachedIndex);
  if (detached !== action.layerRecord) {
    throw new Error("The historical vector raster record was replaced unexpectedly.");
  }
  const gpu = engine.layerGpu.get(action.layerId);
  if (!gpu) throw new Error("Resources for the vector raster to detach are missing.");
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
    throw new Error("The vector raster is already present during Redo.");
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
    synchronizeRasterClippingProjection(engine);
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
        synchronizeRasterClippingProjection(engine);
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
        `Rasterization Redo failed (${originalMessage}); rollback failed: ${rollbackMessage}`,
      );
      engine.latchDocumentStateInconsistent(
        "Vector rasterization Redo failed and rollback is incomplete.",
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
    throw new Error("Inconsistent source type in vector raster history.");
  }
  if (action.seed.format !== engine.layerFormat) {
    throw new Error(
      `Vector raster history ${action.seed.format} is incompatible with document `
      + `${engine.layerFormat}.`,
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
