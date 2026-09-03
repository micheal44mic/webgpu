import type { BrushEngine } from "./brush-engine";
import {
  VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_QUALITY_MAX_SCALE,
  VECTOR_TEXT_GPU_QUALITY_SCALE,
  VECTOR_TEXT_GPU_QUALITY_TILE_SIZE,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
  VECTOR_TEXT_GPU_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_UNIFORM_STRIDE,
  vectorTextGpuBlurCompositeShader,
  vectorTextGpuTentBlurShader,
  vectorTextGpuShader,
} from "./vector-text-gpu-shader";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_SLUG_UNIFORM_BYTES,
  vectorTextSlugGpuShader,
} from "./vector-text-slug-gpu-shader";
import {
  VECTOR_TEXT_INNER_SHADOW_GPU_STRATEGY,
  vectorTextInnerShadowGpuShader,
} from "./vector-text-inner-shadow-gpu-shader";
import { assertShaderCompiled, createRenderPipelineAsync } from "./engine-gpu-utils";
import { VECTOR_TEXT_GPU_MAXIMUM_DRAWS } from "./engine-limits";
import {
  VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES,
  vectorTextRunCacheMemoryBytes,
  vectorTextRunCacheMipLevelCount,
  vectorTextGpuDrawUsesBlur,
  vectorTextGpuDrawUsesMesh,
  vectorTextGpuResourceKey,
  type MixedSceneActivePresentation,
  type VectorTextGpuBlurCacheResources,
  type VectorTextGpuDrawResources,
  type VectorTextGpuPendingRun,
  type VectorTextRunTextureResources,
} from "./engine-vector-text-resources";
import {
  type VectorTextGpuBlurSourceDraw,
  type VectorTextGpuDraw,
  type VectorTextPlacement,
  type VectorTextViewState,
} from "./vector-text-types";
import {
  vectorTextGpuClearBounds,
  vectorTextGpuRunBounds,
} from "./engine-geometry";
import {
  growVectorTextGpuCacheAxisCapacity,
  placeVectorTextGpuRunCache,
  vectorTextGpuRunCacheAllocationBounds,
  vectorTextGpuRunCacheContains,
} from "./vector-text-cache-roi";
import { type DirtyRect } from "./engine-stroke-types";
import { MIXED_SCENE_COMPOSITOR_STRATEGY, MIXED_SCENE_LINEAR_FORMAT } from "./mixed-scene-compositor-shader";
import {
  MixedSceneStack,
  type MixedSceneCompositionSegment,
  type MixedSceneItem,
  type MixedSceneRasterRunKey,
  type MixedSceneVectorHistoryState,
  type MixedSceneVectorKey,
} from "./mixed-scene-stack";
import {
  type MergedSurfaceResources,
  type MixedSceneRasterSegmentResources,
} from "./engine-layer-resources";
import {
  createVectorTextGpuMeshResources,
  createVectorTextGpuSlugResources,
  destroyVectorTextGpuResources,
} from "./vector-text-gpu-resources";
import { recordVectorHistoryAction } from "./engine-history-runtime";
import { rasterImageBindGroupForNode } from "./engine-raster-image-runtime";
import {
  LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
  writeLayerBlendCompositorUniforms,
  type LayerBlendCompositeOperator,
  type LayerBlendCompositorContext,
} from "./layer-blend-compositor";
import { LAYER_BLEND_MODE_ORDER } from "./layer-blend-modes";
import { layerTonalBlendIsDefault } from "./layer-composition.ts";
import type { LayerRecord } from "./layer-stack";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  mixedSceneRasterTransformPreviewHasSegmentedClipping,
  mixedSceneRasterTransformPreviewUsesSegmentedClipping,
} from "./engine-mixed-scene-raster-preview-runtime";
import {
  MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES,
  mixedSceneRasterSegmentUniformValues,
} from "./mixed-scene-raster-transform-preview";
import {
  vectorTextFastPresentationMode,
} from "./vector-text-adaptive-zoom";
import { rasterImageMipmapShader } from "./raster-image-shader";

const rasterLayerNeedsBackdropComposition = (record: LayerRecord): boolean => (
  record.blendMode !== "normal"
  || record.cutoutMode !== "off"
  || !layerTonalBlendIsDefault(record.tonalBlend)
);

type VectorTextGpuInitialization = {
  readonly device: GPUDevice;
  readonly promise: Promise<void>;
};

const vectorMeshFillGpuInitializations = new WeakMap<
  BrushEngine,
  VectorTextGpuInitialization
>();
const vectorTextAdvancedGpuInitializations = new WeakMap<
  BrushEngine,
  VectorTextGpuInitialization
>();

function vectorTextRunUsesEncodedSrgb(engine: BrushEngine): boolean {
  return engine.vectorRasterQualityMode === "coverage"
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied";
}

function vectorTextGpuRunUsesCoverageTiles(
  engine: BrushEngine,
  run: Readonly<VectorTextGpuPendingRun>,
): boolean {
  return engine.vectorRasterQualityMode === "coverage"
    && run.draws.some(vectorTextGpuDrawUsesMesh);
}

const vectorTextSourceOverBlend = (): GPUBlendState => ({
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
});

interface VectorTextRunDrawPipelines {
  readonly fill: GPURenderPipeline;
  readonly slug: GPURenderPipeline;
  readonly blurComposite: GPURenderPipeline;
  readonly innerShadowDirect: GPURenderPipeline;
  readonly innerShadowBlur: GPURenderPipeline;
  readonly meshInnerShadowBlur: GPURenderPipeline;
}

function encodeVectorTextRunDraws(
  engine: BrushEngine,
  pass: GPURenderPassEncoder,
  run: Readonly<VectorTextGpuPendingRun>,
  pipelines: Readonly<VectorTextRunDrawPipelines>,
  firstUniformIndex = 0,
  drawIndices: readonly number[] | null = null,
): void {
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  if (!uniformBindGroup) {
    throw new Error("The vector draw uniform binding is unavailable.");
  }
  const drawCount = drawIndices?.length ?? run.draws.length;
  for (let drawOrder = 0; drawOrder < drawCount; drawOrder += 1) {
    const index = drawIndices?.[drawOrder] ?? drawOrder;
    const draw = run.draws[index];
    const resourcesForDraw = run.drawResources[index];
    const blurResources = run.blurResources[index];
    if (draw.opacity <= 0) continue;
    const dynamicOffset = (firstUniformIndex + index) * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
    if (draw.mode === "slug-blur" || draw.mode === "mesh-blur") {
      if (!blurResources) throw new Error("The GPU vector-blur cache is missing.");
      pass.setPipeline(pipelines.blurComposite);
      pass.setBindGroup(0, blurResources.compositeBindGroup, [dynamicOffset]);
      pass.draw(6, 1, 0, 0);
    } else if (draw.mode === "slug-inner-shadow-direct") {
      if (resourcesForDraw.kind !== "slug") {
        throw new Error("The Slug resource does not match the GPU Inner Shadow.");
      }
      if (resourcesForDraw.curveCount === 0) continue;
      pass.setPipeline(pipelines.innerShadowDirect);
      pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
      pass.draw(6, 1, 0, 0);
    } else if (draw.mode === "slug-inner-shadow-blur") {
      if (!blurResources || resourcesForDraw.kind !== "slug") {
        throw new Error("The blurred Slug Inner Shadow resources are incomplete.");
      }
      if (resourcesForDraw.curveCount === 0) continue;
      pass.setPipeline(pipelines.innerShadowBlur);
      pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
      pass.setBindGroup(1, blurResources.innerShadowBindGroup);
      pass.draw(6, 1, 0, 0);
    } else if (draw.mode === "mesh-inner-shadow-blur") {
      if (!blurResources || resourcesForDraw.kind !== "mesh") {
        throw new Error("The mesh Inner Shadow resources are incomplete.");
      }
      if (resourcesForDraw.indexCount === 0) continue;
      pass.setPipeline(pipelines.meshInnerShadowBlur);
      pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
      pass.setBindGroup(1, blurResources.innerShadowBindGroup);
      pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
      pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
      pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
    } else if (draw.mode === "mesh-direct") {
      if (resourcesForDraw.kind !== "mesh") {
        throw new Error("The vector-mesh resource does not match the draw call.");
      }
      if (resourcesForDraw.indexCount === 0) continue;
      pass.setPipeline(pipelines.fill);
      pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
      pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
      pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
      pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
    } else {
      if (resourcesForDraw.kind !== "slug") {
        throw new Error("The text Slug resource does not match the draw call.");
      }
      if (resourcesForDraw.curveCount === 0) continue;
      pass.setPipeline(pipelines.slug);
      pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
      pass.draw(6, 1, 0, 0);
    }
  }
}

/**
 * Rebuilds every level above mip zero on the same GPU command stream as the
 * exact run redraw. Mip zero is already premultiplied in the cache's color
 * domain, so the shared exact-area pipeline can average it without a color
 * conversion.
 */
function encodeVectorTextRunCacheMipChain(
  engine: BrushEngine,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  width: number,
  height: number,
  mipLevelCount: number,
  label: string,
): void {
  if (mipLevelCount <= 1) return;
  const layout = engine.rasterImageMipmapBindGroupLayout;
  const pipeline = engine.rasterImageMipmapPipeline;
  if (!layout || !pipeline) {
    throw new Error("The premultiplied run-cache mipmap pipeline is not ready.");
  }

  let destinationWidth = Math.max(1, Math.floor(width));
  let destinationHeight = Math.max(1, Math.floor(height));
  for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel += 1) {
    destinationWidth = Math.max(1, Math.floor(destinationWidth / 2));
    destinationHeight = Math.max(1, Math.floor(destinationHeight / 2));
    const sourceView = texture.createView({
      label: `${label} mip ${mipLevel - 1} source`,
      baseMipLevel: mipLevel - 1,
      mipLevelCount: 1,
    });
    const destinationView = texture.createView({
      label: `${label} mip ${mipLevel} target`,
      baseMipLevel: mipLevel,
      mipLevelCount: 1,
    });
    const bindGroup = engine.device.createBindGroup({
      label: `${label} mip ${mipLevel} bind group`,
      layout,
      entries: [{ binding: 0, resource: sourceView }],
    });
    const pass = encoder.beginRenderPass({
      label: `${label} exact-area mip ${mipLevel}`,
      colorAttachments: [{
        view: destinationView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setViewport(0, 0, destinationWidth, destinationHeight, 0, 1);
    pass.setScissorRect(0, 0, destinationWidth, destinationHeight);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
}

interface VectorTextCoverageTile {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly drawIndices: readonly number[];
}

function vectorTextCoverageTiles(
  bounds: Readonly<DirtyRect>,
  tileSize: number,
  drawBounds: readonly DirtyRect[],
): readonly VectorTextCoverageTile[] {
  const tiles: VectorTextCoverageTile[] = [];
  for (let offsetY = 0; offsetY < bounds.height; offsetY += tileSize) {
    for (let offsetX = 0; offsetX < bounds.width; offsetX += tileSize) {
      const tileBounds = {
        x: bounds.x + offsetX,
        y: bounds.y + offsetY,
        width: Math.min(tileSize, bounds.width - offsetX),
        height: Math.min(tileSize, bounds.height - offsetY),
      };
      const drawIndices: number[] = [];
      for (let index = 0; index < drawBounds.length; index += 1) {
        const draw = drawBounds[index];
        if (
          draw.x < tileBounds.x + tileBounds.width
          && draw.x + draw.width > tileBounds.x
          && draw.y < tileBounds.y + tileBounds.height
          && draw.y + draw.height > tileBounds.y
        ) {
          drawIndices.push(index);
        }
      }
      tiles.push({
        offsetX,
        offsetY,
        width: tileBounds.width,
        height: tileBounds.height,
        drawIndices,
      });
    }
  }
  return tiles;
}

/**
 * Re-rasterizes mesh-bearing runs in bounded high-resolution tiles. Exact 2x
 * area reductions turn 16–1024 deterministic subpixel samples into each native
 * cache pixel while preserving authored draw order and premultiplied color.
 */
function refineVectorTextGpuRunCoverage(
  engine: BrushEngine,
  run: Readonly<VectorTextGpuPendingRun>,
  pipelines: Readonly<VectorTextRunDrawPipelines>,
): void {
  if (!run.draws.some(vectorTextGpuDrawUsesMesh)) return;
  const qualityTexture = engine.vectorTextGpuQualityTexture;
  const qualityMipViews = engine.vectorTextGpuQualityMipViews;
  const downsampleBindGroups = engine.vectorTextGpuQualityDownsampleBindGroups;
  const downsamplePipeline = engine.rasterImageMipmapPipeline;
  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const qualityMipLevelCount = Math.log2(VECTOR_TEXT_GPU_QUALITY_MAX_SCALE) + 1;
  if (
    !qualityTexture
    || qualityMipViews.length !== qualityMipLevelCount
    || downsampleBindGroups.length !== qualityMipLevelCount - 1
    || !downsamplePipeline
    || !uniformBuffer
  ) {
    throw new Error("The tiled vector coverage resources are unavailable.");
  }
  if (run.draws.length === 0) return;

  const largestRunAxis = Math.max(run.bounds.width, run.bounds.height);
  const qualityScale = largestRunAxis <= 128
    ? VECTOR_TEXT_GPU_QUALITY_MAX_SCALE
    : largestRunAxis <= 256
      ? VECTOR_TEXT_GPU_QUALITY_MAX_SCALE / 2
      : VECTOR_TEXT_GPU_QUALITY_SCALE;
  const reductionCount = Math.round(Math.log2(qualityScale));
  const scratchDimension =
    VECTOR_TEXT_GPU_QUALITY_TILE_SIZE * VECTOR_TEXT_GPU_QUALITY_SCALE;
  const tileSize = scratchDimension / qualityScale;
  const drawBounds = run.draws.map((draw) => vectorTextGpuRunBounds([draw], run.view));
  const tiles = vectorTextCoverageTiles(run.bounds, tileSize, drawBounds);
  const tilesPerBatch = Math.max(
    1,
    Math.floor(VECTOR_TEXT_GPU_MAXIMUM_DRAWS / run.draws.length),
  );
  const scaledView: VectorTextViewState = {
    ...run.view,
    canvasWidth: run.view.canvasWidth * qualityScale,
    canvasHeight: run.view.canvasHeight * qualityScale,
    cssWidth: run.view.cssWidth * qualityScale,
    cssHeight: run.view.cssHeight * qualityScale,
    zoom: run.view.zoom * qualityScale,
  };

  for (let batchStart = 0; batchStart < tiles.length; batchStart += tilesPerBatch) {
    const batch = tiles.slice(batchStart, batchStart + tilesPerBatch);
    for (let tileIndex = 0; tileIndex < batch.length; tileIndex += 1) {
      const tile = batch[tileIndex];
      const scaledBounds: DirtyRect = {
        x: (run.bounds.x + tile.offsetX) * qualityScale,
        y: (run.bounds.y + tile.offsetY) * qualityScale,
        width: tile.width * qualityScale,
        height: tile.height * qualityScale,
      };
      const firstUniformIndex = tileIndex * run.draws.length;
      for (const drawIndex of tile.drawIndices) {
        writeVectorTextGpuDrawUniform(
          engine,
          run.draws[drawIndex],
          scaledView,
          firstUniformIndex + drawIndex,
          scaledBounds,
          scaledBounds.width,
          scaledBounds.height,
        );
      }
    }
    const uniformCount = batch.length * run.draws.length;
    engine.device.queue.writeBuffer(
      uniformBuffer,
      0,
      engine.vectorTextGpuUniformUpload,
      0,
      uniformCount * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
    );

    const encoder = engine.device.createCommandEncoder({
      label: `Vector coverage tiles ${batchStart + 1}-${batchStart + batch.length} ${run.placement}`,
    });
    for (let tileIndex = 0; tileIndex < batch.length; tileIndex += 1) {
      const tile = batch[tileIndex];
      const highWidth = tile.width * qualityScale;
      const highHeight = tile.height * qualityScale;
      const coveragePass = encoder.beginRenderPass({
        label: `Vector coverage tile ${tile.offsetX},${tile.offsetY}`,
        colorAttachments: [{
          view: qualityMipViews[0],
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      coveragePass.setViewport(0, 0, highWidth, highHeight, 0, 1);
      coveragePass.setScissorRect(0, 0, highWidth, highHeight);
      encodeVectorTextRunDraws(
        engine,
        coveragePass,
        run,
        pipelines,
        tileIndex * run.draws.length,
        tile.drawIndices,
      );
      coveragePass.end();

      let destinationWidth = highWidth;
      let destinationHeight = highHeight;
      for (let level = 0; level < reductionCount; level += 1) {
        destinationWidth = Math.max(1, Math.floor(destinationWidth / 2));
        destinationHeight = Math.max(1, Math.floor(destinationHeight / 2));
        const reducePass = encoder.beginRenderPass({
          label: `Vector coverage tile reduction ${level + 1}`,
          colorAttachments: [{
            view: qualityMipViews[level + 1],
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        reducePass.setViewport(0, 0, destinationWidth, destinationHeight, 0, 1);
        reducePass.setScissorRect(0, 0, destinationWidth, destinationHeight);
        reducePass.setPipeline(downsamplePipeline);
        reducePass.setBindGroup(0, downsampleBindGroups[level]);
        reducePass.draw(3, 1, 0, 0);
        reducePass.end();
      }

      encoder.copyTextureToTexture(
        {
          texture: qualityTexture,
          mipLevel: reductionCount,
          origin: { x: 0, y: 0, z: 0 },
        },
        {
          texture: run.targetTexture,
          origin: {
            x: run.bounds.x - run.targetBounds.x + tile.offsetX,
            y: run.bounds.y - run.targetBounds.y + tile.offsetY,
            z: 0,
          },
        },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      );
    }

    if (batchStart + batch.length === tiles.length) {
      encodeVectorTextRunCacheMipChain(
        engine,
        encoder,
        run.targetTexture,
        run.targetBounds.width,
        run.targetBounds.height,
        run.targetMipLevelCount,
        `Vector coverage ${run.target} ${run.placement} ROI`,
      );
    }
    engine.device.queue.submit([encoder.finish()]);
  }
}

/**
 * Builds the device-static resources needed by direct indexed vector meshes
 * and their shared exact-area reduction pass. Concurrent callers share one
 * promise, and engine fields are published only after every pipeline compiles.
 */
export function initializeVectorMeshFillGpuRenderer(engine: BrushEngine): Promise<void> {
  const device = engine.device;
  const existing = vectorMeshFillGpuInitializations.get(engine);
  if (existing?.device === device) {
    return existing.promise;
  }

  const promise = (async (): Promise<void> => {
    const clearShaderModule = engine.mixedSceneClearShaderModule;
    if (!clearShaderModule) {
      throw new Error("The transparent-clear shader is not initialized.");
    }
    const shaderModule = device.createShaderModule({
      label: `Vector text geometry WGSL · ${VECTOR_TEXT_GPU_RENDER_STRATEGY}`,
      code: vectorTextGpuShader,
    });
    const hasCompleteReductionResources = Boolean(
      engine.rasterImageMipmapShaderModule
        && engine.rasterImageMipmapBindGroupLayout
        && engine.rasterImageMipmapPipeline,
    );
    const reductionShaderModule = hasCompleteReductionResources
      ? engine.rasterImageMipmapShaderModule!
      : device.createShaderModule({
        label: "Shared premultiplied exact-area reduction WGSL",
        code: rasterImageMipmapShader,
      });
    await Promise.all([
      assertShaderCompiled(shaderModule, "vector text indexed geometry"),
      assertShaderCompiled(reductionShaderModule, "premultiplied exact-area reduction"),
    ]);

    const uniformBindGroupLayout = device.createBindGroupLayout({
      label: "Vector text dynamic draw uniform bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: VECTOR_TEXT_GPU_UNIFORM_BYTES,
          },
        },
      ],
    });
    const uniformBuffer = device.createBuffer({
      label: `Vector text dynamic uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
      size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const reductionBindGroupLayout = hasCompleteReductionResources
      ? engine.rasterImageMipmapBindGroupLayout!
      : device.createBindGroupLayout({
        label: "Shared premultiplied exact-area reduction bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ],
      });
    try {
      const uniformBindGroup = device.createBindGroup({
        label: "Vector text dynamic uniform bind group",
        layout: uniformBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: {
              buffer: uniformBuffer,
              offset: 0,
              size: VECTOR_TEXT_GPU_UNIFORM_BYTES,
            },
          },
        ],
      });
      const vertex: GPUVertexState = {
        module: shaderModule,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: "float32x2",
              },
            ],
          },
        ],
      };
      const textLayout = device.createPipelineLayout({
        label: "Vector text geometry pipeline layout",
        bindGroupLayouts: [uniformBindGroupLayout],
      });
      const clearLayout = device.createPipelineLayout({
        label: "Vector text cropped run transparent clear pipeline layout",
        bindGroupLayouts: [],
      });
      const reductionLayout = hasCompleteReductionResources
        ? null
        : device.createPipelineLayout({
          label: "Shared premultiplied exact-area reduction pipeline layout",
          bindGroupLayouts: [reductionBindGroupLayout],
        });
      const [fillPipeline, qualityFillPipeline, clearPipeline, reductionPipeline] = await Promise.all([
        createRenderPipelineAsync(device, {
          label: "Vector text indexed fill MSAA4 source-over pipeline",
          layout: textLayout,
          vertex,
          fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [
              {
                format: VECTOR_TEXT_GPU_TARGET_FORMAT,
                blend: vectorTextSourceOverBlend(),
              },
            ],
          },
          primitive: { topology: "triangle-list" },
          multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text indexed fill 4x coverage source-over pipeline",
          layout: textLayout,
          vertex,
          fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [
              {
                format: VECTOR_TEXT_GPU_TARGET_FORMAT,
                blend: vectorTextSourceOverBlend(),
              },
            ],
          },
          primitive: { topology: "triangle-list" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text cropped run transparent clear pipeline",
          layout: clearLayout,
          vertex: {
            module: clearShaderModule,
            entryPoint: "vertexMain",
          },
          fragment: {
            module: clearShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
        hasCompleteReductionResources
          ? Promise.resolve(engine.rasterImageMipmapPipeline!)
          : createRenderPipelineAsync(device, {
            label: "Shared premultiplied exact-area reduction pipeline",
            layout: reductionLayout!,
            vertex: {
              module: reductionShaderModule,
              entryPoint: "vertexMain",
            },
            fragment: {
              module: reductionShaderModule,
              entryPoint: "fragmentMain",
              targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT }],
            },
            primitive: { topology: "triangle-list" },
          }),
      ]);
      if (engine.device !== device) {
        throw new Error("The WebGPU device changed while vector mesh pipelines compiled.");
      }

      const previousUniformBuffer = engine.vectorTextGpuUniformBuffer;
      engine.vectorTextGpuShaderModule = shaderModule;
      engine.vectorTextGpuUniformBindGroupLayout = uniformBindGroupLayout;
      engine.vectorTextGpuUniformBuffer = uniformBuffer;
      engine.vectorTextGpuUniformBindGroup = uniformBindGroup;
      engine.vectorTextGpuFillPipeline = fillPipeline;
      engine.vectorTextGpuQualityFillPipeline = qualityFillPipeline;
      engine.vectorTextGpuClearPipeline = clearPipeline;
      engine.rasterImageMipmapShaderModule = reductionShaderModule;
      engine.rasterImageMipmapBindGroupLayout = reductionBindGroupLayout;
      engine.rasterImageMipmapPipeline = reductionPipeline;
      if (previousUniformBuffer !== uniformBuffer) {
        previousUniformBuffer?.destroy();
      }
    } catch (error) {
      uniformBuffer.destroy();
      throw error;
    }
  })();
  const initialization = { device, promise };
  vectorMeshFillGpuInitializations.set(engine, initialization);
  void promise.catch(() => {
    if (vectorMeshFillGpuInitializations.get(engine) === initialization) {
      vectorMeshFillGpuInitializations.delete(engine);
    }
  });
  return promise;
}

/** Builds analytic text, blur, and inner-shadow resources on top of mesh fill. */
export function initializeVectorTextGpuRenderer(engine: BrushEngine): Promise<void> {
  const device = engine.device;
  const existing = vectorTextAdvancedGpuInitializations.get(engine);
  if (existing?.device === device) {
    return existing.promise;
  }

  const promise = (async (): Promise<void> => {
    await initializeVectorMeshFillGpuRenderer(engine);
    if (engine.device !== device) {
      throw new Error("The WebGPU device changed before vector-text pipelines compiled.");
    }
    const geometryShaderModule = engine.vectorTextGpuShaderModule;
    const uniformBindGroupLayout = engine.vectorTextGpuUniformBindGroupLayout;
    if (!geometryShaderModule || !uniformBindGroupLayout) {
      throw new Error("The indexed vector-mesh renderer is not initialized.");
    }

    const slugShaderModule = device.createShaderModule({
      label: `Vector text Slug WGSL · ${VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY}`,
      code: vectorTextSlugGpuShader,
    });
    const tentBlurShaderModule = device.createShaderModule({
      label: "Vector effects GPU separable tent blur WGSL",
      code: vectorTextGpuTentBlurShader,
    });
    const blurCompositeShaderModule = device.createShaderModule({
      label: "Vector text GPU blurred mask composite WGSL",
      code: vectorTextGpuBlurCompositeShader,
    });
    const innerShadowShaderModule = device.createShaderModule({
      label: `Vector text inner shadow WGSL · ${VECTOR_TEXT_INNER_SHADOW_GPU_STRATEGY}`,
      code: vectorTextInnerShadowGpuShader,
    });
    await Promise.all([
      assertShaderCompiled(slugShaderModule, "vector text Slug analytic source fill"),
      assertShaderCompiled(tentBlurShaderModule, "vector effects separable tent blur"),
      assertShaderCompiled(blurCompositeShaderModule, "vector text blurred mask composite"),
      assertShaderCompiled(innerShadowShaderModule, "vector text inner shadow analytic clip"),
    ]);

    const blurFilterBindGroupLayout = device.createBindGroupLayout({
      label: "Vector text GPU blur filter bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    const blurCompositeBindGroupLayout = device.createBindGroupLayout({
      label: "Vector text GPU blur composite bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    const innerShadowBindGroupLayout = device.createBindGroupLayout({
      label: "Vector text GPU inner-shadow blurred mask layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });
    const slugBindGroupLayout = device.createBindGroupLayout({
      label: "Vector text Slug dynamic uniform and data textures layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: VECTOR_TEXT_SLUG_UNIFORM_BYTES,
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "uint" },
        },
      ],
    });
    const blurFilterUniformBuffer = device.createBuffer({
      label: `Vector text GPU blur filter uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
      size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    try {
      const blurSampler = device.createSampler({
        label: "Vector text GPU blur linear clamp sampler",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
      });
      const sourceOverBlend = vectorTextSourceOverBlend();
      const meshVertexBuffers: GPUVertexBufferLayout[] = [
        {
          arrayStride: 8,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x2",
            },
          ],
        },
      ];
      const textLayout = device.createPipelineLayout({
        label: "Vector text geometry pipeline layout",
        bindGroupLayouts: [uniformBindGroupLayout],
      });
      const slugLayout = device.createPipelineLayout({
        label: "Vector text Slug pipeline layout",
        bindGroupLayouts: [slugBindGroupLayout],
      });
      const blurFilterLayout = device.createPipelineLayout({
        label: "Vector effects GPU tent filter pipeline layout",
        bindGroupLayouts: [blurFilterBindGroupLayout],
      });
      const blurCompositeLayout = device.createPipelineLayout({
        label: "Vector text GPU blur composite pipeline layout",
        bindGroupLayouts: [blurCompositeBindGroupLayout],
      });
      const innerShadowBlurLayout = device.createPipelineLayout({
        label: "Vector text inner shadow blurred clip pipeline layout",
        bindGroupLayouts: [slugBindGroupLayout, innerShadowBindGroupLayout],
      });
      const meshInnerShadowLayout = device.createPipelineLayout({
        label: "Vector SVG inner shadow mesh pipeline layout",
        bindGroupLayouts: [uniformBindGroupLayout, innerShadowBindGroupLayout],
      });
      const [
        slugPipeline,
        qualitySlugPipeline,
        blurMaskPipeline,
        meshBlurMaskPipeline,
        blurHorizontalPipeline,
        blurVerticalPipeline,
        blurCompositePipeline,
        qualityBlurCompositePipeline,
        innerShadowDirectPipeline,
        qualityInnerShadowDirectPipeline,
        innerShadowBlurPipeline,
        qualityInnerShadowBlurPipeline,
        meshInnerShadowBlurPipeline,
        qualityMeshInnerShadowBlurPipeline,
      ] = await Promise.all([
        createRenderPipelineAsync(device, {
          label: "Vector text whole-node Slug source fill MSAA4 source-over pipeline",
          layout: slugLayout,
          vertex: { module: slugShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: slugShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text whole-node Slug 4x coverage source-over pipeline",
          layout: slugLayout,
          vertex: { module: slugShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: slugShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text analytic Slug mask for GPU blur",
          layout: slugLayout,
          vertex: { module: slugShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: slugShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector mesh union mask for GPU blur",
          layout: textLayout,
          vertex: {
            module: geometryShaderModule,
            entryPoint: "blurMaskVertexMain",
            buffers: meshVertexBuffers,
          },
          fragment: {
            module: geometryShaderModule,
            entryPoint: "blurMaskFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector effects GPU tent horizontal pipeline",
          layout: blurFilterLayout,
          vertex: { module: tentBlurShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: tentBlurShaderModule,
            entryPoint: "horizontalMain",
            targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector effects GPU tent vertical pipeline",
          layout: blurFilterLayout,
          vertex: { module: tentBlurShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: tentBlurShaderModule,
            entryPoint: "verticalMain",
            targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text GPU blurred mask MSAA4 source-over composite",
          layout: blurCompositeLayout,
          vertex: { module: blurCompositeShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: blurCompositeShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
          multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text blurred mask 4x coverage source-over composite",
          layout: blurCompositeLayout,
          vertex: { module: blurCompositeShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: blurCompositeShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text inner shadow direct Slug MSAA4 source-over",
          layout: slugLayout,
          vertex: { module: innerShadowShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: innerShadowShaderModule,
            entryPoint: "innerShadowDirectFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text inner shadow direct Slug 4x coverage source-over",
          layout: slugLayout,
          vertex: { module: innerShadowShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: innerShadowShaderModule,
            entryPoint: "innerShadowDirectFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text inner shadow blurred Slug clip MSAA4 source-over",
          layout: innerShadowBlurLayout,
          vertex: {
            module: innerShadowShaderModule,
            entryPoint: "innerShadowBlurVertexMain",
          },
          fragment: {
            module: innerShadowShaderModule,
            entryPoint: "innerShadowBlurFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector text inner shadow blurred Slug 4x coverage source-over",
          layout: innerShadowBlurLayout,
          vertex: {
            module: innerShadowShaderModule,
            entryPoint: "innerShadowBlurVertexMain",
          },
          fragment: {
            module: innerShadowShaderModule,
            entryPoint: "innerShadowBlurFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector SVG inner shadow mesh clip MSAA4 source-over",
          layout: meshInnerShadowLayout,
          vertex: {
            module: geometryShaderModule,
            entryPoint: "meshInnerShadowVertexMain",
            buffers: meshVertexBuffers,
          },
          fragment: {
            module: geometryShaderModule,
            entryPoint: "meshInnerShadowFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
        }),
        createRenderPipelineAsync(device, {
          label: "Vector SVG inner shadow mesh 4x coverage source-over",
          layout: meshInnerShadowLayout,
          vertex: {
            module: geometryShaderModule,
            entryPoint: "meshInnerShadowVertexMain",
            buffers: meshVertexBuffers,
          },
          fragment: {
            module: geometryShaderModule,
            entryPoint: "meshInnerShadowFragmentMain",
            targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
        }),
      ]);
      if (engine.device !== device) {
        throw new Error("The WebGPU device changed while vector-text pipelines compiled.");
      }

      const previousFilterUniformBuffer = engine.vectorTextGpuBlurFilterUniformBuffer;
      engine.vectorTextGpuSlugShaderModule = slugShaderModule;
      engine.vectorTextGpuTentBlurShaderModule = tentBlurShaderModule;
      engine.vectorTextGpuBlurCompositeShaderModule = blurCompositeShaderModule;
      engine.vectorTextGpuInnerShadowShaderModule = innerShadowShaderModule;
      engine.vectorTextGpuBlurFilterBindGroupLayout = blurFilterBindGroupLayout;
      engine.vectorTextGpuBlurCompositeBindGroupLayout = blurCompositeBindGroupLayout;
      engine.vectorTextGpuInnerShadowBindGroupLayout = innerShadowBindGroupLayout;
      engine.vectorTextGpuSlugBindGroupLayout = slugBindGroupLayout;
      engine.vectorTextGpuBlurFilterUniformBuffer = blurFilterUniformBuffer;
      engine.vectorTextGpuBlurSampler = blurSampler;
      engine.vectorTextGpuSlugPipeline = slugPipeline;
      engine.vectorTextGpuQualitySlugPipeline = qualitySlugPipeline;
      engine.vectorTextGpuBlurMaskPipeline = blurMaskPipeline;
      engine.vectorTextGpuMeshBlurMaskPipeline = meshBlurMaskPipeline;
      engine.vectorTextGpuBlurHorizontalPipeline = blurHorizontalPipeline;
      engine.vectorTextGpuBlurVerticalPipeline = blurVerticalPipeline;
      engine.vectorTextGpuBlurCompositePipeline = blurCompositePipeline;
      engine.vectorTextGpuQualityBlurCompositePipeline = qualityBlurCompositePipeline;
      engine.vectorTextGpuInnerShadowDirectPipeline = innerShadowDirectPipeline;
      engine.vectorTextGpuQualityInnerShadowDirectPipeline = qualityInnerShadowDirectPipeline;
      engine.vectorTextGpuInnerShadowBlurPipeline = innerShadowBlurPipeline;
      engine.vectorTextGpuQualityInnerShadowBlurPipeline = qualityInnerShadowBlurPipeline;
      engine.vectorTextGpuMeshInnerShadowBlurPipeline = meshInnerShadowBlurPipeline;
      engine.vectorTextGpuQualityMeshInnerShadowBlurPipeline =
        qualityMeshInnerShadowBlurPipeline;
      if (previousFilterUniformBuffer !== blurFilterUniformBuffer) {
        previousFilterUniformBuffer?.destroy();
      }
    } catch (error) {
      blurFilterUniformBuffer.destroy();
      throw error;
    }
  })();
  const initialization = { device, promise };
  vectorTextAdvancedGpuInitializations.set(engine, initialization);
  void promise.catch(() => {
    if (vectorTextAdvancedGpuInitializations.get(engine) === initialization) {
      vectorTextAdvancedGpuInitializations.delete(engine);
    }
  });
  return promise;
}

export function flushVectorTextGpuPresentations(engine: BrushEngine): void {
  if (engine.vectorTextGpuPendingRuns.length === 0) {
    return;
  }
  let scratchWidth = 1;
  let scratchHeight = 1;
  let blurScratchWidth = 0;
  let blurScratchHeight = 0;
  let requiresAdvancedPipelines = false;
  let requiresQualityTiles = false;
  for (const run of engine.vectorTextGpuPendingRuns) {
    const runUsesQualityTiles = vectorTextGpuRunUsesCoverageTiles(engine, run);
    if (!runUsesQualityTiles) {
      scratchWidth = Math.max(scratchWidth, run.bounds.width);
      scratchHeight = Math.max(scratchHeight, run.bounds.height);
    }
    requiresQualityTiles ||= runUsesQualityTiles;
    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const cache = run.blurResources[index];
      requiresAdvancedPipelines ||= draw.mode !== "mesh-direct";
      if (vectorTextGpuDrawUsesBlur(draw) && cache?.needsBuild) {
        blurScratchWidth = Math.max(blurScratchWidth, draw.blurWidth);
        blurScratchHeight = Math.max(blurScratchHeight, draw.blurHeight);
      }
    }
  }

  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  const filterUniformBuffer = engine.vectorTextGpuBlurFilterUniformBuffer;
  const fillPipeline = engine.vectorTextGpuFillPipeline;
  const qualityFillPipeline = engine.vectorTextGpuQualityFillPipeline;
  const slugPipeline = engine.vectorTextGpuSlugPipeline;
  const qualitySlugPipeline = engine.vectorTextGpuQualitySlugPipeline;
  const blurMaskPipeline = engine.vectorTextGpuBlurMaskPipeline;
  const meshBlurMaskPipeline = engine.vectorTextGpuMeshBlurMaskPipeline;
  const blurHorizontalPipeline = engine.vectorTextGpuBlurHorizontalPipeline;
  const blurVerticalPipeline = engine.vectorTextGpuBlurVerticalPipeline;
  const blurCompositePipeline = engine.vectorTextGpuBlurCompositePipeline;
  const qualityBlurCompositePipeline = engine.vectorTextGpuQualityBlurCompositePipeline;
  const innerShadowDirectPipeline = engine.vectorTextGpuInnerShadowDirectPipeline;
  const qualityInnerShadowDirectPipeline = engine.vectorTextGpuQualityInnerShadowDirectPipeline;
  const innerShadowBlurPipeline = engine.vectorTextGpuInnerShadowBlurPipeline;
  const qualityInnerShadowBlurPipeline = engine.vectorTextGpuQualityInnerShadowBlurPipeline;
  const meshInnerShadowBlurPipeline = engine.vectorTextGpuMeshInnerShadowBlurPipeline;
  const qualityMeshInnerShadowBlurPipeline =
    engine.vectorTextGpuQualityMeshInnerShadowBlurPipeline;
  const clearPipeline = engine.vectorTextGpuClearPipeline;
  if (
    !uniformBuffer
    || !uniformBindGroup
    || !fillPipeline
    || !clearPipeline
  ) {
    throw new Error("The indexed vector-mesh batch pipeline is not ready.");
  }
  if (
    requiresAdvancedPipelines
    && (
      !filterUniformBuffer
      || !slugPipeline
      || !blurMaskPipeline
      || !meshBlurMaskPipeline
      || !blurHorizontalPipeline
      || !blurVerticalPipeline
      || !blurCompositePipeline
      || !innerShadowDirectPipeline
      || !innerShadowBlurPipeline
      || !meshInnerShadowBlurPipeline
    )
  ) {
    throw new Error("The advanced GPU vector-text batch pipeline is not ready.");
  }
  if (
    requiresQualityTiles
    && (
      !qualityFillPipeline
      || requiresAdvancedPipelines
        && (
          !qualitySlugPipeline
          || !qualityBlurCompositePipeline
          || !qualityInnerShadowDirectPipeline
          || !qualityInnerShadowBlurPipeline
          || !qualityMeshInnerShadowBlurPipeline
        )
    )
  ) {
    throw new Error("The tiled vector coverage pipeline is not ready.");
  }

  ensureVectorTextGpuScratch(engine, scratchWidth, scratchHeight);
  if (requiresQualityTiles) {
    ensureVectorTextGpuQualityScratch(engine);
  }
  if (blurScratchWidth > 0 && blurScratchHeight > 0) {
    ensureVectorTextGpuBlurScratch(engine, blurScratchWidth, blurScratchHeight);
  }
  const msaaView = engine.vectorTextGpuMsaaView;
  const resolvedTexture = engine.vectorTextGpuResolvedTexture;
  const resolvedView = engine.vectorTextGpuResolvedView;
  if (!msaaView || !resolvedTexture || !resolvedView) {
    throw new Error("The GPU vector batch scratch memory is not ready.");
  }

  const totalMainDraws = engine.vectorTextGpuPendingRuns.reduce(
    (total, run) => total + run.draws.length,
    0,
  );
  if (totalMainDraws > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
    throw new Error(
      `GPU text batch exceeds ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} draw calls.`,
    );
  }
  let mainDrawIndex = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
    for (const draw of run.draws) {
      writeVectorTextGpuDrawUniform(engine, 
        draw,
        run.view,
        mainDrawIndex,
        run.bounds,
        run.bounds.width,
        run.bounds.height,
      );
      mainDrawIndex += 1;
    }
  }

  const blurBuilds: {
    draw: VectorTextGpuBlurSourceDraw;
    resources: VectorTextGpuDrawResources;
    cache: VectorTextGpuBlurCacheResources;
    sourceUniformIndex: number;
    filterIndex: number;
  }[] = [];
  const queuedCaches = new Set<VectorTextGpuBlurCacheResources>();
  let nextSourceUniformIndex = totalMainDraws;
  for (const run of engine.vectorTextGpuPendingRuns) {
    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const drawResources = run.drawResources[index];
      const cache = run.blurResources[index];
      if (
        !vectorTextGpuDrawUsesBlur(draw)
        || !cache?.needsBuild
        || queuedCaches.has(cache)
      ) {
        continue;
      }
      if (drawResources.kind !== (vectorTextGpuDrawUsesMesh(draw) ? "mesh" : "slug")) {
        throw new Error("The vector resource does not match the GPU blur mask.");
      }
      if (nextSourceUniformIndex >= VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
        throw new Error(
          `GPU text uniforms exceed ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} slots.`,
        );
      }
      const filterIndex = blurBuilds.length;
      writeVectorTextGpuBlurSourceUniform(engine, 
        draw,
        nextSourceUniformIndex,
      );
      writeVectorTextGpuBlurFilterUniform(engine, draw, filterIndex);
      blurBuilds.push({
        draw,
        resources: drawResources,
        cache,
        sourceUniformIndex: nextSourceUniformIndex,
        filterIndex,
      });
      queuedCaches.add(cache);
      nextSourceUniformIndex += 1;
    }
  }

  if (nextSourceUniformIndex > 0) {
    engine.device.queue.writeBuffer(
      uniformBuffer,
      0,
      engine.vectorTextGpuUniformUpload,
      0,
      nextSourceUniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
    );
  }
  if (blurBuilds.length > 0) {
    engine.device.queue.writeBuffer(
      filterUniformBuffer!,
      0,
      engine.vectorTextGpuBlurFilterUniformUpload,
      0,
      blurBuilds.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
    );
  }

  const encoder = engine.device.createCommandEncoder({
    label: `Vector text GPU batched exact redraw · ${engine.vectorTextGpuPendingRuns.length} runs`,
  });

  if (blurBuilds.length > 0) {
    const scratchATexture = engine.vectorTextGpuBlurScratchATexture;
    const scratchAView = engine.vectorTextGpuBlurScratchAView;
    const scratchBView = engine.vectorTextGpuBlurScratchBView;
    const filterAToB = engine.vectorTextGpuBlurFilterBindGroupAToB;
    const filterBToA = engine.vectorTextGpuBlurFilterBindGroupBToA;
    if (
      !scratchATexture
      || !scratchAView
      || !scratchBView
      || !filterAToB
      || !filterBToA
    ) {
      throw new Error("GPU text-blur scratch memory is not ready.");
    }
    for (const build of blurBuilds) {
      const width = build.draw.blurWidth;
      const height = build.draw.blurHeight;
      const sourcePass = encoder.beginRenderPass({
        label: `Vector text GPU blur analytic mask ${build.draw.blurKey}`,
        colorAttachments: [{
          view: scratchAView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      sourcePass.setViewport(0, 0, width, height, 0, 1);
      sourcePass.setScissorRect(0, 0, width, height);
      const sourceDynamicOffset =
        build.sourceUniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
      if (vectorTextGpuDrawUsesMesh(build.draw)) {
        if (build.resources.kind !== "mesh") {
          throw new Error("The SVG mesh does not match the GPU blur mask.");
        }
        sourcePass.setPipeline(meshBlurMaskPipeline!);
        sourcePass.setBindGroup(0, uniformBindGroup, [sourceDynamicOffset]);
        sourcePass.setVertexBuffer(0, build.resources.vertexBuffer);
        sourcePass.setIndexBuffer(build.resources.indexBuffer, "uint32");
        sourcePass.drawIndexed(build.resources.indexCount, 1, 0, 0, 0);
      } else {
        if (build.resources.kind !== "slug") {
          throw new Error("The Slug resource does not match the GPU blur mask.");
        }
        sourcePass.setPipeline(blurMaskPipeline!);
        sourcePass.setBindGroup(0, build.resources.bindGroup, [sourceDynamicOffset]);
        sourcePass.draw(6, 1, 0, 0);
      }
      sourcePass.end();

      const filterOffset = build.filterIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
      const horizontalPass = encoder.beginRenderPass({
        label: `Vector text GPU blur horizontal ${build.draw.blurKey}`,
        colorAttachments: [{
          view: scratchBView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      horizontalPass.setViewport(0, 0, width, height, 0, 1);
      horizontalPass.setScissorRect(0, 0, width, height);
      horizontalPass.setPipeline(blurHorizontalPipeline!);
      horizontalPass.setBindGroup(0, filterAToB, [filterOffset]);
      horizontalPass.draw(3, 1, 0, 0);
      horizontalPass.end();

      const verticalPass = encoder.beginRenderPass({
        label: `Vector text GPU blur vertical ${build.draw.blurKey}`,
        colorAttachments: [{
          view: scratchAView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      verticalPass.setViewport(0, 0, width, height, 0, 1);
      verticalPass.setScissorRect(0, 0, width, height);
      verticalPass.setPipeline(blurVerticalPipeline!);
      verticalPass.setBindGroup(0, filterBToA, [filterOffset]);
      verticalPass.draw(3, 1, 0, 0);
      verticalPass.end();

      encoder.copyTextureToTexture(
        { texture: scratchATexture },
        { texture: build.cache.texture },
        { width, height, depthOrArrayLayers: 1 },
      );
    }
  }

  const baselineDrawPipelines: VectorTextRunDrawPipelines = {
    fill: fillPipeline,
    slug: slugPipeline ?? fillPipeline,
    blurComposite: blurCompositePipeline ?? fillPipeline,
    innerShadowDirect: innerShadowDirectPipeline ?? fillPipeline,
    innerShadowBlur: innerShadowBlurPipeline ?? fillPipeline,
    meshInnerShadowBlur: meshInnerShadowBlurPipeline ?? fillPipeline,
  };
  const qualityDrawPipelines: VectorTextRunDrawPipelines | null = qualityFillPipeline
    ? {
        fill: qualityFillPipeline,
        slug: qualitySlugPipeline ?? qualityFillPipeline,
        blurComposite: qualityBlurCompositePipeline ?? qualityFillPipeline,
        innerShadowDirect: qualityInnerShadowDirectPipeline ?? qualityFillPipeline,
        innerShadowBlur: qualityInnerShadowBlurPipeline ?? qualityFillPipeline,
        meshInnerShadowBlur:
          qualityMeshInnerShadowBlurPipeline ?? qualityFillPipeline,
      }
    : null;

  let drawOffset = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
    const runUsesQualityTiles = vectorTextGpuRunUsesCoverageTiles(engine, run);
    if (!runUsesQualityTiles) {
      const pass = encoder.beginRenderPass({
        label: `Vector text GPU exact camera redraw ${run.placement}`,
        colorAttachments: [
          {
            view: msaaView,
            resolveTarget: resolvedView,
            loadOp: "clear",
            storeOp: "discard",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setViewport(0, 0, run.bounds.width, run.bounds.height, 0, 1);
      pass.setScissorRect(0, 0, run.bounds.width, run.bounds.height);
      encodeVectorTextRunDraws(engine, pass, run, baselineDrawPipelines, drawOffset);
      pass.end();
    }

    const isPrimary = run.target === "primary";
    const wasInitialized = isPrimary && run.resources.initialized;
    const clearBounds = vectorTextGpuClearBounds(run.resources.lastBounds, run.bounds);
    const clearPass = encoder.beginRenderPass({
      label: `Vector text GPU clear ${run.target} crop ${run.placement}`,
      colorAttachments: [
        {
          view: run.targetView,
          loadOp: wasInitialized ? "load" : "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    if (wasInitialized) {
      clearPass.setPipeline(clearPipeline);
      clearPass.setScissorRect(
        clearBounds.x - run.targetBounds.x,
        clearBounds.y - run.targetBounds.y,
        clearBounds.width,
        clearBounds.height,
      );
      clearPass.draw(3, 1, 0, 0);
    }
    clearPass.end();
    if (!vectorTextGpuRunCacheContains(run.targetBounds, run.bounds)) {
      throw new Error(`Vector text ROI does not contain ${run.placement}.`);
    }
    if (!runUsesQualityTiles) {
      encoder.copyTextureToTexture(
        {
          texture: resolvedTexture,
          origin: { x: 0, y: 0, z: 0 },
        },
        {
          texture: run.targetTexture,
          origin: {
            x: run.bounds.x - run.targetBounds.x,
            y: run.bounds.y - run.targetBounds.y,
            z: 0,
          },
        },
        {
          width: run.bounds.width,
          height: run.bounds.height,
          depthOrArrayLayers: 1,
        },
      );
      encodeVectorTextRunCacheMipChain(
        engine,
        encoder,
        run.targetTexture,
        run.targetBounds.width,
        run.targetBounds.height,
        run.targetMipLevelCount,
        `Vector text ${run.target} ${run.placement} ROI`,
      );
    }
    drawOffset += run.draws.length;
  }
  const completedRuns = engine.vectorTextGpuPendingRuns.slice();
  const previousPrimaryStates = new Map<
    VectorTextRunTextureResources,
    {
      readonly lastBounds: DirtyRect | null;
      readonly initialized: boolean;
      readonly encodedSrgb: boolean;
    }
  >();
  for (const run of completedRuns) {
    if (run.target !== "primary" || previousPrimaryStates.has(run.resources)) continue;
    previousPrimaryStates.set(run.resources, {
      lastBounds: run.resources.lastBounds,
      initialized: run.resources.initialized,
      encodedSrgb: run.resources.primaryEncodedSrgb,
    });
  }
  const previousBlurBuildStates = new Map(
    blurBuilds.map((build) => [build.cache, build.cache.needsBuild] as const),
  );
  let gpuWorkSubmitted = false;
  try {
    engine.device.queue.submit([encoder.finish()]);
    gpuWorkSubmitted = true;
    if (qualityDrawPipelines) {
      for (const run of completedRuns) {
        if (engine.vectorRasterQualityMode !== "coverage") break;
        if (vectorTextGpuRunUsesCoverageTiles(engine, run)) {
          refineVectorTextGpuRunCoverage(engine, run, qualityDrawPipelines);
        }
      }
    }
    if (
      completedRuns.length > engine.vectorTextGpuPendingRuns.length
      || completedRuns.some((run, index) => engine.vectorTextGpuPendingRuns[index] !== run)
    ) {
      throw new Error("The pending vector run batch changed before publication.");
    }
    for (const run of completedRuns) {
      if (run.target !== "primary") continue;
      run.resources.lastBounds = run.bounds;
      run.resources.initialized = true;
      run.resources.primaryEncodedSrgb = vectorTextRunUsesEncodedSrgb(engine);
      writeVectorTextRunCacheUniforms(engine, run.resources);
    }
    for (const build of blurBuilds) {
      build.cache.needsBuild = false;
    }
  } catch (error) {
    for (const [resources, previous] of previousPrimaryStates) {
      if (gpuWorkSubmitted) {
        // Once a command buffer has been accepted, the old cache may already
        // have been cleared or only partly refined. Keep the queued run as the
        // sole recovery source and prevent presentation of uncertain pixels.
        resources.lastBounds = null;
        resources.initialized = false;
        resources.primaryEncodedSrgb = false;
      } else {
        resources.lastBounds = previous.lastBounds;
        resources.initialized = previous.initialized;
        resources.primaryEncodedSrgb = previous.encodedSrgb;
      }
      try {
        writeVectorTextRunCacheUniforms(engine, resources);
      } catch {
        // Preserve the original failure while restoring every recoverable CPU field.
      }
    }
    for (const [cache, needsBuild] of previousBlurBuildStates) {
      cache.needsBuild = needsBuild;
    }
    throw error;
  }
  engine.vectorTextGpuPendingRuns.splice(0, completedRuns.length);
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.requestRender();
}

function mixedSceneSegmentContributesToDeepFloor(
  engine: BrushEngine,
  segment: MixedSceneCompositionSegment,
  activePresentation: MixedSceneActivePresentation,
): boolean {
  const scene = engine.mixedSceneStack;
  if (segment.kind === "shape-preview") return engine.shapePreviewVisible;
  const structuralKey = segment.kind === "active-raster" || segment.kind === "image"
    ? segment.item.key
    : segment.items.length === 1
      ? segment.items[0].key
      : null;
  // A clipping child never contributes independently: the completed group is
  // represented by its base segment and keeps the base alpha authoritative.
  if (
    structuralKey !== null
    && scene !== null
    && scene.clippingParentKey(structuralKey) !== null
    && (
      scene.clippingGroupRequiresSegmentedComposition(structuralKey)
      || mixedSceneRasterTransformPreviewUsesSegmentedClipping(engine, structuralKey)
    )
  ) {
    return false;
  }
  if (segment.kind === "text-run") {
    // Structural hidden/empty vector members deliberately keep their segment
    // boundary but have no live texture and therefore no visible floor.
    return engine.vectorTextRunTextures.get(segment.key)?.initialized === true;
  }
  if (segment.kind === "image") {
    const node = scene?.imageById(segment.item.imageNodeId);
    return Boolean(node?.visible && node.opacity > 0);
  }
  const rasterLayerId = segment.kind === "active-raster"
    ? segment.item.rasterLayerId
    : segment.items.find((item) => {
      const parent = engine.layerStack.clippingUnit(item.rasterLayerId)[0];
      return parent.visible && parent.opacity > 0 && parent.hasContent;
    })?.rasterLayerId;
  if (rasterLayerId === undefined) return false;
  const parent = engine.layerStack.clippingUnit(rasterLayerId)[0];
  return parent.visible
    && parent.opacity > 0
    && (
      parent.hasContent
      || segment.kind === "active-raster" && activePresentation.kind !== "base"
    );
}

function ensureMixedSceneTextEncodedCompositeScratch(
  engine: BrushEngine,
  width: number,
  height: number,
): void {
  const requiredWidth = Math.max(1, Math.floor(width));
  const requiredHeight = Math.max(1, Math.floor(height));
  if (
    engine.mixedSceneTextEncodedCompositeScratchTexture
    && engine.mixedSceneTextEncodedCompositeScratchView
    && engine.mixedSceneTextEncodedCompositeScratchWidth === requiredWidth
    && engine.mixedSceneTextEncodedCompositeScratchHeight === requiredHeight
  ) {
    return;
  }
  const texture = engine.device.createTexture({
    label: `Encoded vector backdrop scratch ${requiredWidth}×${requiredHeight}`,
    size: { width: requiredWidth, height: requiredHeight, depthOrArrayLayers: 1 },
    format: MIXED_SCENE_LINEAR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  let view: GPUTextureView;
  try {
    view = texture.createView({ label: "Encoded vector backdrop scratch view" });
  } catch (error) {
    texture.destroy();
    throw error;
  }
  const previous = engine.mixedSceneTextEncodedCompositeScratchTexture;
  engine.mixedSceneTextEncodedCompositeScratchTexture = texture;
  engine.mixedSceneTextEncodedCompositeScratchView = view;
  engine.mixedSceneTextEncodedCompositeScratchWidth = requiredWidth;
  engine.mixedSceneTextEncodedCompositeScratchHeight = requiredHeight;
  previous?.destroy();
}

function releaseMixedSceneTextEncodedCompositeScratch(engine: BrushEngine): void {
  engine.mixedSceneTextEncodedCompositeScratchTexture?.destroy();
  engine.mixedSceneTextEncodedCompositeScratchTexture = null;
  engine.mixedSceneTextEncodedCompositeScratchView = null;
  engine.mixedSceneTextEncodedCompositeScratchWidth = 0;
  engine.mixedSceneTextEncodedCompositeScratchHeight = 0;
}

export function encodeMixedSceneSegmentedPresentation(engine: BrushEngine, 
  encoder: GPUCommandEncoder,
  presentationDirtyRect: DirtyRect,
  requiresFullRebuild: boolean,
  activePresentation: MixedSceneActivePresentation,
  label: string,
): void {
  const linearView = engine.mixedSceneLinearView;
  const presentBindGroup = engine.mixedScenePresentBindGroup;
  const clearPipeline = engine.mixedSceneClearPipeline;
  const rasterPipeline = engine.mixedSceneRasterSegmentPipeline;
  const rasterSourceAtopPipeline = engine.mixedSceneRasterSegmentSourceAtopPipeline;
  const textPipeline = engine.mixedSceneTextSegmentPipeline;
  const textSourceAtopPipeline = engine.mixedSceneTextSegmentSourceAtopPipeline;
  const shapePreviewPipeline = engine.mixedSceneShapePreviewPipeline;
  const imagePipeline = engine.rasterImageMixedScenePipeline;
  const presentPipeline = engine.mixedScenePresentPipeline;
  const backgroundPipeline = engine.mixedSceneBackgroundPipeline;
  const backgroundBindGroup = engine.mixedSceneBackgroundBindGroup;
  const requiresRasterPipeline = engine.mixedSceneCompositionSegments.some(
    (segment) => segment.kind === "raster-run",
  );
  const requiresTextPipeline = engine.mixedSceneCompositionSegments.some(
    (segment) => segment.kind === "text-run",
  );
  const requiresImagePipeline = engine.mixedSceneCompositionSegments.some(
    (segment) => segment.kind === "image",
  );
  const requiresShapePreviewPipeline = engine.mixedSceneCompositionSegments.some(
    (segment) => segment.kind === "shape-preview",
  );
  const requiresEncodedVectorComposite = vectorTextRunUsesEncodedSrgb(engine)
    && requiresTextPipeline;
  if (
    !engine.usesOrderedScenePresentation()
    || !linearView
    || !presentBindGroup
    || !clearPipeline
    || (requiresRasterPipeline && !rasterPipeline)
    || (requiresTextPipeline && !textPipeline)
    || (requiresShapePreviewPipeline && !shapePreviewPipeline)
    || (requiresImagePipeline && !imagePipeline)
    || !presentPipeline
    || !backgroundPipeline
    || !backgroundBindGroup
    || requiresEncodedVectorComposite
      && (
        !engine.mixedSceneTextEncodedCompositePipeline
        || !engine.mixedSceneTextEncodedCompositeBindGroupLayout
      )
    || !engine.presentationCacheView
  ) {
    throw new Error("The segmented raster/text compositor is not ready.");
  }
  if (
    (
      engine.mixedSceneStack?.hasHeterogeneousClipping
      || mixedSceneRasterTransformPreviewHasSegmentedClipping(engine)
    )
    && (
      !rasterSourceAtopPipeline
      || !textSourceAtopPipeline
      || !engine.mixedSceneClippingScratchView
      || !engine.mixedSceneClippingScratchBindGroup
      || !engine.mixedSceneClippingScratchCompositePipeline
      || !engine.mixedSceneActiveSourceAtopDisplayPipeline
      || !engine.mixedSceneActiveRasterStrokeSourceAtopPipeline
      || !engine.mixedSceneActiveThicknessTailSourceAtopPipeline
      || !engine.mixedSceneActiveLightGlazeSourceAtopPipeline
    )
  ) {
    throw new Error("The heterogeneous clipping compositor is not ready.");
  }
  const deepCutoutEnabled = engine.layerStack.layers.some(
    (record) => record.cutoutMode === "document",
  );
  const deepFloorView = engine.mixedSceneBlendDeepFloorView;
  const deepFloorTexture = engine.mixedSceneBlendDeepFloorTexture;
  if (deepCutoutEnabled && (!deepFloorView || !deepFloorTexture)) {
    throw new Error("The ordered Deep floor is not ready.");
  }
  const deepFloorSegmentIndex = deepCutoutEnabled && !engine.documentBackground.visible
    ? engine.mixedSceneCompositionSegments.findIndex((segment) =>
      mixedSceneSegmentContributesToDeepFloor(engine, segment, activePresentation))
    : -1;

  const drawSegmentSource = (
    pass: GPURenderPassEncoder,
    segment: MixedSceneCompositionSegment,
    operator: LayerBlendCompositeOperator = "source-over",
    isolatedActive = false,
  ): void => {
    if (segment.kind === "raster-run") {
      const resources = engine.mixedSceneRasterSegments.find(
        (candidate) => candidate.key === segment.key,
      );
      if (resources) {
        pass.setPipeline(
          operator === "source-atop" ? rasterSourceAtopPipeline! : rasterPipeline!,
        );
        pass.setBindGroup(0, resources.bindGroup);
        pass.draw(3, 1, 0, 0);
      }
      return;
    }
    if (segment.kind === "text-run") {
      const resources = engine.vectorTextRunTextures.get(segment.key);
      if (resources) {
        pass.setPipeline(
          operator === "source-atop" ? textSourceAtopPipeline! : textPipeline!,
        );
        pass.setBindGroup(0, resources.bindGroup);
        pass.draw(3, 1, 0, 0);
      }
      return;
    }
    if (segment.kind === "image") {
      const scene = engine.mixedSceneStack;
      if (!scene) {
        throw new Error("Image node has no mixed scene.");
      }
      const node = scene.imageById(segment.item.imageNodeId);
      const bindGroup = rasterImageBindGroupForNode(engine, node);
      if (bindGroup) {
        pass.setPipeline(imagePipeline!);
        pass.setBindGroup(0, bindGroup);
        pass.draw(4, 1, 0, 0);
      }
      return;
    }
    if (segment.kind === "shape-preview") {
      if (!engine.mixedSceneShapePreviewBindGroup) {
        throw new Error("The live shape preview bindings are not ready.");
      }
      if (operator !== "source-over") {
        throw new Error("The live shape preview cannot be a clipping child.");
      }
      pass.setPipeline(shapePreviewPipeline!);
      pass.setBindGroup(0, engine.mixedSceneShapePreviewBindGroup);
      pass.draw(3, 1, 0, 0);
      return;
    }

    if (segment.kind !== "active-raster") {
      return;
    }
    if (isolatedActive) {
      drawActiveRasterSourceOnly(pass, operator);
      return;
    }
    if (operator !== "source-over") {
      throw new Error("Only isolated active raster sources can use source-atop.");
    }
    if (activePresentation.kind === "raster-stroke") {
      const pipeline = engine.mixedSceneActiveRasterStrokeDisplayPipeline;
      const sourceBindGroup = engine.rasterStrokeDisplayBindGroups.get(
        activePresentation.sourceMode,
      );
      if (!pipeline || !sourceBindGroup) {
        throw new Error("The active-raster effects pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.rasterStrokeDisplayScreenBindGroup);
      pass.setBindGroup(1, sourceBindGroup);
    } else if (activePresentation.kind === "thickness-tail") {
      const pipeline = engine.mixedSceneActiveThicknessTailDisplayPipeline;
      if (!pipeline || !engine.thicknessTailDisplayBindGroup) {
        throw new Error("The active-tail pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.thicknessTailDisplayBindGroup);
    } else if (activePresentation.kind === "light-glaze") {
      const pipeline = engine.mixedSceneActiveLightGlazeDisplayPipeline;
      if (!pipeline || !engine.lightGlazeDisplayBindGroup) {
        throw new Error("The active-raster Light Glaze pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.lightGlazeDisplayBindGroup);
    } else {
      const pipeline = engine.mixedSceneActiveDisplayPipeline;
      if (!pipeline) {
        throw new Error("The active-raster base pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.displayBindGroup);
    }
    pass.draw(3, 1, 0, 0);
  };

  const drawSegmentCutoutSource = (
    pass: GPURenderPassEncoder,
    segment: MixedSceneCompositionSegment,
    isolatedActive = false,
  ): void => {
    if (segment.kind === "raster-run") {
      const resources = engine.mixedSceneRasterSegments.find(
        (candidate) => candidate.key === segment.key,
      );
      if (resources) {
        pass.setPipeline(rasterPipeline!);
        pass.setBindGroup(0, resources.cutoutBindGroup ?? resources.bindGroup);
        pass.draw(3, 1, 0, 0);
      }
      return;
    }
    if (segment.kind !== "active-raster") {
      return;
    }
    if (isolatedActive) {
      drawActiveRasterCutoutSourceOnly(pass);
      return;
    }
    const parentCutout = engine.activeClippingGroup?.mode === "active-child"
      ? engine.activeClippingGroup.parentCutoutSegment
      : null;
    if (parentCutout) {
      pass.setPipeline(rasterPipeline!);
      pass.setBindGroup(0, parentCutout.bindGroup);
      pass.draw(3, 1, 0, 0);
      return;
    }
    if (activePresentation.kind === "raster-stroke") {
      const pipeline = engine.mixedSceneActiveRasterStrokeCutoutPipeline;
      const sourceBindGroup = engine.rasterStrokeDisplayBindGroups.get(
        activePresentation.sourceMode,
      );
      if (!pipeline || !sourceBindGroup) {
        throw new Error("The active Stroke authored-matte pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.rasterStrokeDisplayScreenBindGroup);
      pass.setBindGroup(1, sourceBindGroup);
      pass.draw(3, 1, 0, 0);
      return;
    }
    const pipeline = engine.mixedSceneActiveCutoutDisplayPipeline;
    if (!pipeline) {
      throw new Error("The active authored-matte pipeline is not ready.");
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, engine.displayBindGroup);
    pass.draw(3, 1, 0, 0);
  };

  const drawActiveRasterCutoutSourceOnly = (pass: GPURenderPassEncoder): void => {
    if (activePresentation.kind === "raster-stroke") {
      const pipeline = engine.mixedSceneActiveRasterStrokeCutoutPipeline;
      const sourceBindGroup = engine.rasterStrokeDisplayBindGroups.get(
        activePresentation.sourceMode,
      );
      if (!pipeline || !sourceBindGroup) {
        throw new Error("The active Stroke authored-matte pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.rasterStrokeDisplayScreenBindGroup);
      pass.setBindGroup(1, sourceBindGroup);
    } else {
      const pipeline = engine.mixedSceneActiveCutoutDisplayPipeline;
      if (!pipeline) {
        throw new Error("The active authored-matte pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.displayBindGroup);
    }
    pass.draw(3, 1, 0, 0);
  };

  const drawActiveRasterSourceOnly = (
    pass: GPURenderPassEncoder,
    operator: LayerBlendCompositeOperator = "source-over",
  ): void => {
    if (activePresentation.kind === "raster-stroke") {
      const pipeline = operator === "source-atop"
        ? engine.mixedSceneActiveRasterStrokeSourceAtopPipeline
        : engine.mixedSceneActiveRasterStrokeSourcePipeline;
      const sourceBindGroup = engine.rasterStrokeDisplayBindGroups.get(
        activePresentation.sourceMode,
      );
      if (!pipeline || !sourceBindGroup) {
        throw new Error("The active-raster source-only effects pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.rasterStrokeDisplayScreenBindGroup);
      pass.setBindGroup(1, sourceBindGroup);
    } else if (activePresentation.kind === "thickness-tail") {
      const pipeline = operator === "source-atop"
        ? engine.mixedSceneActiveThicknessTailSourceAtopPipeline
        : engine.mixedSceneActiveThicknessTailSourcePipeline;
      if (!pipeline || !engine.thicknessTailDisplayBindGroup) {
        throw new Error("The active-tail source-only pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.thicknessTailDisplayBindGroup);
    } else if (activePresentation.kind === "light-glaze") {
      const pipeline = operator === "source-atop"
        ? engine.mixedSceneActiveLightGlazeSourceAtopPipeline
        : engine.mixedSceneActiveLightGlazeSourcePipeline;
      if (!pipeline || !engine.lightGlazeDisplayBindGroup) {
        throw new Error("The active-raster glaze source-only pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.lightGlazeDisplayBindGroup);
    } else {
      const pipeline = operator === "source-atop"
        ? engine.mixedSceneActiveSourceAtopDisplayPipeline
        : engine.mixedSceneActiveSourceDisplayPipeline;
      if (!pipeline) {
        throw new Error("The active-raster source-only pipeline is not ready.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.displayBindGroup);
    }
    pass.draw(3, 1, 0, 0);
  };

  const setDirtyScissor = (pass: GPURenderPassEncoder): void => {
    pass.setScissorRect(
      presentationDirtyRect.x,
      presentationDirtyRect.y,
      presentationDirtyRect.width,
      presentationDirtyRect.height,
    );
  };
  if (deepCutoutEnabled) {
    const deepFloorPass = encoder.beginRenderPass({
      label: `${label} · seed Deep floor`,
      colorAttachments: [{
        view: deepFloorView!,
        loadOp: requiresFullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    setDirtyScissor(deepFloorPass);
    if (!requiresFullRebuild) {
      deepFloorPass.setPipeline(clearPipeline);
      deepFloorPass.draw(3, 1, 0, 0);
    }
    deepFloorPass.setPipeline(backgroundPipeline);
    deepFloorPass.setBindGroup(0, backgroundBindGroup);
    deepFloorPass.draw(3, 1, 0, 0);
    deepFloorPass.end();
  }
  const compositionRecordForSegment = (
    segment: MixedSceneCompositionSegment,
  ): LayerRecord | null => {
    if (segment.kind === "raster-run") {
      const first = segment.items[0];
      if (
        first
        && segment.items.length === 1
        && (
          engine.mixedSceneStack?.clippingGroupRequiresSegmentedComposition(first.key)
          || mixedSceneRasterTransformPreviewUsesSegmentedClipping(engine, first.key)
        )
      ) {
        return engine.layerStack.byId(first.rasterLayerId) ?? null;
      }
      return first
        ? engine.layerStack.clippingUnit(first.rasterLayerId)[0] ?? null
        : null;
    }
    if (segment.kind === "active-raster") {
      if (
        (
          engine.mixedSceneStack?.clippingGroupRequiresSegmentedComposition(
            segment.item.key,
          )
          || mixedSceneRasterTransformPreviewUsesSegmentedClipping(
            engine,
            segment.item.key,
          )
        )
      ) {
        return engine.layerStack.byId(segment.item.rasterLayerId) ?? null;
      }
      return engine.layerStack.clippingUnit(segment.item.rasterLayerId)[0] ?? null;
    }
    return null;
  };
  const rasterResourcesForSegment = (
    segment: MixedSceneCompositionSegment,
  ): MixedSceneRasterSegmentResources | null => segment.kind === "raster-run"
    ? engine.mixedSceneRasterSegments.find(
      (candidate) => candidate.key === segment.key,
    ) ?? null
    : null;
  let blendUniformSlot = 0;
  const writeBlendControls = (
    mode: LayerRecord["blendMode"],
    operator: LayerBlendCompositeOperator,
    record: LayerRecord | null,
    sourceOpacity = 1,
    context: LayerBlendCompositorContext = "direct",
    documentMaskOpacity = 1,
  ): number => {
    const uniformBuffer = engine.layerBlendCompositorUniformBuffer;
    const stride = engine.layerBlendCompositorUniformStride;
    if (!uniformBuffer || stride <= 0) {
      throw new Error("The ordered layer controls are unavailable.");
    }
    const capacity = LAYER_BLEND_MODE_ORDER.length * 2;
    if (blendUniformSlot >= capacity) {
      throw new Error("The ordered layer program exceeds its uniform capacity.");
    }
    const offset = blendUniformSlot * stride;
    blendUniformSlot += 1;
    const upload = new Uint32Array(LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE / 4);
    writeLayerBlendCompositorUniforms(
      upload,
      mode,
      operator,
      0,
      record,
      sourceOpacity,
      context,
      documentMaskOpacity,
      engine.documentStorageColorSpace === "encoded-srgb-premultiplied",
    );
    engine.device.queue.writeBuffer(uniformBuffer, offset, upload);
    return offset;
  };
  let currentIsCanonical = true;
  let firstCanonicalPass = true;
  const beginScenePass = (): GPURenderPassEncoder => {
    const initializesCanonicalBackdrop = firstCanonicalPass;
    const pass = encoder.beginRenderPass({
      label: `${label} · ${MIXED_SCENE_COMPOSITOR_STRATEGY}`,
      colorAttachments: [{
        view: currentIsCanonical
          ? linearView
          : engine.mixedSceneBlendScratchView!,
        loadOp: firstCanonicalPass && requiresFullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    setDirtyScissor(pass);
    if (initializesCanonicalBackdrop && !requiresFullRebuild) {
      pass.setPipeline(clearPipeline);
      pass.draw(3, 1, 0, 0);
    }
    if (initializesCanonicalBackdrop) {
      pass.setPipeline(backgroundPipeline);
      pass.setBindGroup(0, backgroundBindGroup);
      pass.draw(3, 1, 0, 0);
    }
    firstCanonicalPass = false;
    return pass;
  };

  let scenePass: GPURenderPassEncoder | null = beginScenePass();
  const captureDeepFloorAfter = (segmentIndex: number): void => {
    if (segmentIndex !== deepFloorSegmentIndex) return;
    scenePass?.end();
    scenePass = null;
    const sourceTexture = currentIsCanonical
      ? engine.mixedSceneLinearTexture
      : engine.mixedSceneBlendScratchTexture;
    if (!sourceTexture || !deepFloorTexture) {
      throw new Error("The ordered Deep floor snapshot source is unavailable.");
    }
    encoder.copyTextureToTexture(
      {
        texture: sourceTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        texture: deepFloorTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        width: presentationDirtyRect.width,
        height: presentationDirtyRect.height,
        depthOrArrayLayers: 1,
      },
    );
  };
  const itemKeyForSegment = (
    segment: MixedSceneCompositionSegment,
  ): MixedSceneItem["key"] | null => {
    if (segment.kind === "shape-preview") return null;
    if (segment.kind === "active-raster" || segment.kind === "image") {
      return segment.item.key;
    }
    return segment.items.length === 1 ? segment.items[0].key : null;
  };
  interface HeterogeneousClippingProgram {
    readonly baseKey: MixedSceneItem["key"];
    readonly segments: readonly MixedSceneCompositionSegment[];
    readonly endSegmentIndex: number;
  }
  const heterogeneousClippingProgramAt = (
    segmentIndex: number,
  ): HeterogeneousClippingProgram | null => {
    const scene = engine.mixedSceneStack;
    if (!scene) return null;
    const baseSegment = engine.mixedSceneCompositionSegments[segmentIndex];
    const baseKey = itemKeyForSegment(baseSegment);
    if (
      baseKey === null
      || scene.clippingParentKey(baseKey) !== null
      || !(
        scene.clippingGroupRequiresSegmentedComposition(baseKey)
        || mixedSceneRasterTransformPreviewUsesSegmentedClipping(engine, baseKey)
      )
    ) {
      return null;
    }
    const groupKeys = scene.clippingGroupKeys(baseKey);
    const segments = groupKeys.map((key, offset) => {
      const candidate = engine.mixedSceneCompositionSegments[segmentIndex + offset];
      if (!candidate || itemKeyForSegment(candidate) !== key) {
        throw new Error(`Clipping group ${baseKey} is not contiguous in the GPU program.`);
      }
      return candidate;
    });
    return {
      baseKey,
      segments,
      endSegmentIndex: segmentIndex + segments.length - 1,
    };
  };
  const heterogeneousClippingProgramIsSimple = (
    program: HeterogeneousClippingProgram,
  ): boolean => program.segments.every((candidate) => {
    const record = compositionRecordForSegment(candidate);
    const resources = rasterResourcesForSegment(candidate);
    const encodedTextCache = candidate.kind === "text-run"
      ? engine.vectorTextRunTextures.get(candidate.key) ?? null
      : null;
    const requiresEncodedTextFold = engine.documentStorageColorSpace
        === "encoded-srgb-premultiplied"
      && encodedTextCache !== null
      && (
        encodedTextCache.primaryEncodedSrgb
        || encodedTextCache.fallbackEncodedSrgb
      );
    return !requiresEncodedTextFold
      && (!record || !rasterLayerNeedsBackdropComposition(record))
      && !resources?.documentCutoutMaskSurface;
  });
  const encodeSimpleHeterogeneousClippingProgram = (
    program: HeterogeneousClippingProgram,
    baseSegmentIndex: number,
  ): void => {
    const scratchView = engine.mixedSceneClippingScratchView;
    const scratchBindGroup = engine.mixedSceneClippingScratchBindGroup;
    const compositePipeline = engine.mixedSceneClippingScratchCompositePipeline;
    if (!scratchView || !scratchBindGroup || !compositePipeline) {
      throw new Error("The fast clipping-group scratch is unavailable.");
    }
    scenePass?.end();
    scenePass = null;
    const groupPass = encoder.beginRenderPass({
      label: `${label} · clipping group ${program.baseKey}`,
      colorAttachments: [{
        view: scratchView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    setDirtyScissor(groupPass);
    groupPass.setPipeline(clearPipeline);
    groupPass.draw(3, 1, 0, 0);
    drawSegmentSource(groupPass, program.segments[0], "source-over", true);
    for (const child of program.segments.slice(1)) {
      drawSegmentSource(groupPass, child, "source-atop", true);
    }
    groupPass.end();

    scenePass = beginScenePass();
    scenePass.setPipeline(compositePipeline);
    scenePass.setBindGroup(0, scratchBindGroup);
    scenePass.draw(3, 1, 0, 0);
    captureDeepFloorAfter(baseSegmentIndex);
  };
  const encodeAdvancedHeterogeneousClippingProgram = (
    program: HeterogeneousClippingProgram,
    baseSegmentIndex: number,
  ): void => {
    scenePass?.end();
    scenePass = null;
    const scratchView = engine.mixedSceneBlendScratchView;
    const scratchTexture = engine.mixedSceneBlendScratchTexture;
    const operandView = engine.mixedSceneBlendOperandView;
    const operandTexture = engine.mixedSceneBlendOperandTexture;
    const cutoutView = engine.mixedSceneBlendCutoutView;
    const groupView = engine.mixedSceneBlendGroupView;
    const groupTexture = engine.mixedSceneBlendGroupTexture;
    const clippingBaseView = engine.mixedSceneBlendClippingBaseView;
    const documentMaskView = engine.mixedSceneBlendDocumentMaskView;
    const blendPipeline = engine.layerBlendCompositorPipeline;
    const documentMaskPipeline = engine.layerBlendViewportDocumentMaskPipeline;
    if (
      !scratchView
      || !scratchTexture
      || !operandView
      || !operandTexture
      || !cutoutView
      || !groupView
      || !groupTexture
      || !clippingBaseView
      || !documentMaskView
      || !blendPipeline
      || !documentMaskPipeline
      || !engine.mixedSceneBlendFromLinearBindGroup
      || !engine.mixedSceneBlendFromScratchBindGroup
      || !engine.mixedSceneBlendFromGroupBindGroup
      || engine.layerBlendCompositorUniformStride <= 0
    ) {
      throw new Error("The advanced heterogeneous clipping compositor is unavailable.");
    }
    const baseSegment = program.segments[0];
    const baseRecord = compositionRecordForSegment(baseSegment);
    const groupStartView = currentIsCanonical ? scratchView : linearView;
    const groupStartTexture = currentIsCanonical
      ? scratchTexture
      : engine.mixedSceneLinearTexture!;

    const basePass = encoder.beginRenderPass({
      label: `${label} · clipping base ${program.baseKey}`,
      colorAttachments: [{ view: groupStartView, loadOp: "load", storeOp: "store" }],
    });
    setDirtyScissor(basePass);
    basePass.setPipeline(clearPipeline);
    basePass.draw(3, 1, 0, 0);
    drawSegmentSource(basePass, baseSegment, "source-over", true);
    basePass.end();

    const immutableBasePass = encoder.beginRenderPass({
      label: `${label} · clipping immutable base ${program.baseKey}`,
      colorAttachments: [{ view: clippingBaseView, loadOp: "load", storeOp: "store" }],
    });
    setDirtyScissor(immutableBasePass);
    immutableBasePass.setPipeline(clearPipeline);
    immutableBasePass.draw(3, 1, 0, 0);
    drawSegmentSource(immutableBasePass, baseSegment, "source-over", true);
    immutableBasePass.end();

    const documentMaskSeedPass = encoder.beginRenderPass({
      label: `${label} · clipping document mask seed ${program.baseKey}`,
      colorAttachments: [{ view: documentMaskView, loadOp: "load", storeOp: "store" }],
    });
    setDirtyScissor(documentMaskSeedPass);
    documentMaskSeedPass.setPipeline(clearPipeline);
    documentMaskSeedPass.draw(3, 1, 0, 0);
    documentMaskSeedPass.end();

    let groupOnDedicatedTexture = false;
    for (const childSegment of program.segments.slice(1)) {
      const childRecord = compositionRecordForSegment(childSegment);
      const childResources = rasterResourcesForSegment(childSegment);
      const childNeedsAdvancedComposition = Boolean(
        childRecord && rasterLayerNeedsBackdropComposition(childRecord)
          || childResources?.documentCutoutMaskSurface,
      );
      if (!childNeedsAdvancedComposition) {
        const childPass = encoder.beginRenderPass({
          label: `${label} · clipping child ${itemKeyForSegment(childSegment) ?? "unknown"}`,
          colorAttachments: [{
            view: groupOnDedicatedTexture ? groupView : groupStartView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(childPass);
        drawSegmentSource(childPass, childSegment, "source-atop", true);
        childPass.end();
        continue;
      }
      if (!childRecord) {
        throw new Error("An advanced clipping child has no raster record.");
      }

      const operandPass = encoder.beginRenderPass({
        label: `${label} · clipping operand ${childRecord.id}`,
        colorAttachments: [{ view: operandView, loadOp: "load", storeOp: "store" }],
      });
      setDirtyScissor(operandPass);
      operandPass.setPipeline(clearPipeline);
      operandPass.draw(3, 1, 0, 0);
      drawSegmentSource(operandPass, childSegment, "source-over", true);
      operandPass.end();

      if (childRecord.cutoutMode !== "off") {
        const cutoutPass = encoder.beginRenderPass({
          label: `${label} · clipping authored matte ${childRecord.id}`,
          colorAttachments: [{ view: cutoutView, loadOp: "load", storeOp: "store" }],
        });
        setDirtyScissor(cutoutPass);
        cutoutPass.setPipeline(clearPipeline);
        cutoutPass.draw(3, 1, 0, 0);
        drawSegmentCutoutSource(cutoutPass, childSegment, true);
        cutoutPass.end();
      }

      const childBackdropBindGroup = groupOnDedicatedTexture
        ? engine.mixedSceneBlendFromGroupBindGroup
        : currentIsCanonical
          ? engine.mixedSceneBlendFromScratchBindGroup
          : engine.mixedSceneBlendFromLinearBindGroup;
      const childControls = writeBlendControls(
        childRecord.blendMode,
        "source-atop",
        childRecord,
        1,
        "clipping-child",
      );
      if (childRecord.cutoutMode === "document") {
        const documentMaskPass = encoder.beginRenderPass({
          label: `${label} · clipping document mask ${childRecord.id}`,
          colorAttachments: [{ view: documentMaskView, loadOp: "load", storeOp: "store" }],
        });
        setDirtyScissor(documentMaskPass);
        documentMaskPass.setPipeline(documentMaskPipeline);
        documentMaskPass.setBindGroup(0, childBackdropBindGroup, [childControls]);
        documentMaskPass.draw(3, 1, 0, 0);
        documentMaskPass.end();
      }

      const childBlendPass = encoder.beginRenderPass({
        label: `${label} · clipping blend ${childRecord.id}`,
        colorAttachments: [{
          view: groupOnDedicatedTexture ? groupStartView : groupView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(childBlendPass);
      childBlendPass.setPipeline(blendPipeline);
      childBlendPass.setBindGroup(0, childBackdropBindGroup, [childControls]);
      childBlendPass.draw(3, 1, 0, 0);
      childBlendPass.end();
      groupOnDedicatedTexture = !groupOnDedicatedTexture;
    }

    const completedGroupTexture = groupOnDedicatedTexture
      ? groupTexture
      : groupStartTexture;
    encoder.copyTextureToTexture(
      {
        texture: completedGroupTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        texture: operandTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        width: presentationDirtyRect.width,
        height: presentationDirtyRect.height,
        depthOrArrayLayers: 1,
      },
    );

    if (baseRecord?.cutoutMode !== undefined && baseRecord.cutoutMode !== "off") {
      const baseCutoutPass = encoder.beginRenderPass({
        label: `${label} · clipping base authored matte`,
        colorAttachments: [{ view: cutoutView, loadOp: "load", storeOp: "store" }],
      });
      setDirtyScissor(baseCutoutPass);
      baseCutoutPass.setPipeline(clearPipeline);
      baseCutoutPass.draw(3, 1, 0, 0);
      drawSegmentCutoutSource(baseCutoutPass, baseSegment, true);
      baseCutoutPass.end();
    }

    const outerBlendPass = encoder.beginRenderPass({
      label: `${label} · clipping group output ${program.baseKey}`,
      colorAttachments: [{ view: groupStartView, loadOp: "load", storeOp: "store" }],
    });
    setDirtyScissor(outerBlendPass);
    outerBlendPass.setPipeline(blendPipeline);
    outerBlendPass.setBindGroup(
      0,
      currentIsCanonical
        ? engine.mixedSceneBlendFromLinearBindGroup
        : engine.mixedSceneBlendFromScratchBindGroup,
      [writeBlendControls(
        baseRecord?.blendMode ?? "normal",
        "source-over",
        baseRecord,
        1,
        "clipping-outer",
        baseRecord?.opacity ?? 1,
      )],
    );
    outerBlendPass.draw(3, 1, 0, 0);
    outerBlendPass.end();
    currentIsCanonical = !currentIsCanonical;
    captureDeepFloorAfter(baseSegmentIndex);
  };
  for (
    let segmentIndex = 0;
    segmentIndex < engine.mixedSceneCompositionSegments.length;
    segmentIndex += 1
  ) {
    const segment = engine.mixedSceneCompositionSegments[segmentIndex];
    const heterogeneousClippingProgram = heterogeneousClippingProgramAt(segmentIndex);
    if (heterogeneousClippingProgram) {
      if (heterogeneousClippingProgramIsSimple(heterogeneousClippingProgram)) {
        encodeSimpleHeterogeneousClippingProgram(
          heterogeneousClippingProgram,
          segmentIndex,
        );
      } else {
        encodeAdvancedHeterogeneousClippingProgram(
          heterogeneousClippingProgram,
          segmentIndex,
        );
      }
      segmentIndex = heterogeneousClippingProgram.endSegmentIndex;
      continue;
    }
    const blendMode = engine.compositionSegmentBlendMode(segment);
    const compositionRecord = compositionRecordForSegment(segment);
    const rasterResources = rasterResourcesForSegment(segment);
    const activeClippingRecord = segment.kind === "active-raster"
      ? engine.layerStack.active
      : null;
    const explicitActiveChild = segment.kind === "active-raster"
      && engine.activeClippingGroup?.mode === "active-child"
      && (
        engine.activeClippingGroup.suffixSteps.length > 0
        || engine.activeClippingGroup.prefixDocumentMaskViewportSegment !== null
        || rasterLayerNeedsBackdropComposition(engine.layerStack.active)
      );
    const clippingSuffixSteps = segment.kind === "active-raster"
      ? engine.activeClippingGroup?.suffixSteps ?? []
      : [];
    if (clippingSuffixSteps.length > 0 || explicitActiveChild) {
      scenePass?.end();
      scenePass = null;
      const scratchView = engine.mixedSceneBlendScratchView;
      const scratchTexture = engine.mixedSceneBlendScratchTexture;
      const operandView = engine.mixedSceneBlendOperandView;
      const operandTexture = engine.mixedSceneBlendOperandTexture;
      const cutoutView = engine.mixedSceneBlendCutoutView;
      const groupView = engine.mixedSceneBlendGroupView;
      const groupTexture = engine.mixedSceneBlendGroupTexture;
      const clippingBaseView = engine.mixedSceneBlendClippingBaseView;
      const documentMaskView = engine.mixedSceneBlendDocumentMaskView;
      const blendPipeline = engine.layerBlendCompositorPipeline;
      const documentMaskPipeline = engine.layerBlendViewportDocumentMaskPipeline;
      const blendUniformStride = engine.layerBlendCompositorUniformStride;
      if (
        !scratchView
        || !scratchTexture
        || !operandView
        || !operandTexture
        || !cutoutView
        || !groupView
        || !groupTexture
        || !clippingBaseView
        || !documentMaskView
        || !blendPipeline
        || !documentMaskPipeline
        || blendUniformStride <= 0
        || !engine.mixedSceneBlendFromGroupBindGroup
      ) {
        throw new Error("Advanced clipping-group ping-pong is not ready.");
      }

      // Preserve the outer scene in its current target while constructing the
      // isolated clipping group in the otherwise-free peer plus one dedicated
      // group texture. The live active presenter supplies parent/prefix/active;
      // ordered suffix children are then folded source-atop one by one.
      const groupStartView = currentIsCanonical ? scratchView : linearView;
      const groupStartTexture = currentIsCanonical
        ? scratchTexture
        : engine.mixedSceneLinearTexture!;
      const groupStartPass = encoder.beginRenderPass({
        label: `${label} · live clipping-group base`,
        colorAttachments: [{
          view: groupStartView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(groupStartPass);
      groupStartPass.setPipeline(clearPipeline);
      groupStartPass.draw(3, 1, 0, 0);
      if (explicitActiveChild) {
        const prefixSegment = engine.activeClippingGroup?.prefixViewportSegment;
        if (prefixSegment) {
          groupStartPass.setPipeline(rasterPipeline!);
          groupStartPass.setBindGroup(0, prefixSegment.bindGroup);
          groupStartPass.draw(3, 1, 0, 0);
        }
      } else {
        // The active parent must enter its isolated group unscaled. Its
        // opacity belongs to the completed group and is applied once by the
        // outer compositor after every clipped child has been folded.
        drawActiveRasterSourceOnly(groupStartPass);
      }
      groupStartPass.end();

      const clippingBasePass = encoder.beginRenderPass({
        label: `${label} · live clipping immutable base`,
        colorAttachments: [{
          view: clippingBaseView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(clippingBasePass);
      clippingBasePass.setPipeline(clearPipeline);
      clippingBasePass.draw(3, 1, 0, 0);
      if (explicitActiveChild) {
        const baseSegment = engine.activeClippingGroup?.baseViewportSegment;
        if (!baseSegment) {
          throw new Error("The live clipping immutable base is unavailable.");
        }
        clippingBasePass.setPipeline(rasterPipeline!);
        clippingBasePass.setBindGroup(0, baseSegment.bindGroup);
        clippingBasePass.draw(3, 1, 0, 0);
      } else {
        drawActiveRasterSourceOnly(clippingBasePass);
      }
      clippingBasePass.end();

      const documentMaskSeedPass = encoder.beginRenderPass({
        label: `${label} · live clipping document-mask seed`,
        colorAttachments: [{
          view: documentMaskView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(documentMaskSeedPass);
      documentMaskSeedPass.setPipeline(clearPipeline);
      documentMaskSeedPass.draw(3, 1, 0, 0);
      const prefixDocumentMask = explicitActiveChild
        ? engine.activeClippingGroup?.prefixDocumentMaskViewportSegment
        : null;
      if (prefixDocumentMask) {
        documentMaskSeedPass.setPipeline(rasterPipeline!);
        documentMaskSeedPass.setBindGroup(0, prefixDocumentMask.bindGroup);
        documentMaskSeedPass.draw(3, 1, 0, 0);
      }
      documentMaskSeedPass.end();

      let groupOnDedicatedTexture = false;
      if (explicitActiveChild && activeClippingRecord) {
        const activeOperandPass = encoder.beginRenderPass({
          label: `${label} · active clipping source ${activeClippingRecord.id}`,
          colorAttachments: [{
            view: operandView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(activeOperandPass);
        activeOperandPass.setPipeline(clearPipeline);
        activeOperandPass.draw(3, 1, 0, 0);
        drawActiveRasterSourceOnly(activeOperandPass);
        activeOperandPass.end();

        if (activeClippingRecord.cutoutMode !== "off") {
          const activeCutoutPass = encoder.beginRenderPass({
            label: `${label} · active clipping authored matte ${activeClippingRecord.id}`,
            colorAttachments: [{
              view: cutoutView,
              loadOp: "load",
              storeOp: "store",
            }],
          });
          setDirtyScissor(activeCutoutPass);
          activeCutoutPass.setPipeline(clearPipeline);
          activeCutoutPass.draw(3, 1, 0, 0);
          drawActiveRasterCutoutSourceOnly(activeCutoutPass);
          activeCutoutPass.end();
        }

        const activeBackdropBindGroup = currentIsCanonical
          ? engine.mixedSceneBlendFromScratchBindGroup!
          : engine.mixedSceneBlendFromLinearBindGroup!;
        const activeBlendControls = writeBlendControls(
          activeClippingRecord.blendMode,
          "source-atop",
          activeClippingRecord,
          1,
          "clipping-child",
        );
        if (activeClippingRecord.cutoutMode === "document") {
          const activeDocumentMaskPass = encoder.beginRenderPass({
            label: `${label} · active clipping document mask ${activeClippingRecord.id}`,
            colorAttachments: [{
              view: documentMaskView,
              loadOp: "load",
              storeOp: "store",
            }],
          });
          setDirtyScissor(activeDocumentMaskPass);
          activeDocumentMaskPass.setPipeline(documentMaskPipeline);
          activeDocumentMaskPass.setBindGroup(
            0,
            activeBackdropBindGroup,
            [activeBlendControls],
          );
          activeDocumentMaskPass.draw(3, 1, 0, 0);
          activeDocumentMaskPass.end();
        }

        const activeBlendPass = encoder.beginRenderPass({
          label: `${label} · active clipping atop ${activeClippingRecord.blendMode}`,
          colorAttachments: [{
            view: groupView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(activeBlendPass);
        activeBlendPass.setPipeline(blendPipeline);
        activeBlendPass.setBindGroup(
          0,
          activeBackdropBindGroup,
          [activeBlendControls],
        );
        activeBlendPass.draw(3, 1, 0, 0);
        activeBlendPass.end();
        groupOnDedicatedTexture = true;
      }
      for (const step of clippingSuffixSteps) {
        const operandPass = encoder.beginRenderPass({
          label: `${label} · clipping source ${step.layerId} (${step.blendMode})`,
          colorAttachments: [{
            view: operandView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(operandPass);
        operandPass.setPipeline(clearPipeline);
        operandPass.draw(3, 1, 0, 0);
        operandPass.setPipeline(rasterPipeline!);
        operandPass.setBindGroup(0, step.viewportSegment.bindGroup);
        operandPass.draw(3, 1, 0, 0);
        operandPass.end();

        const stepRecord = engine.layerStack.byId(step.layerId);
        if (stepRecord?.cutoutMode !== undefined && stepRecord.cutoutMode !== "off") {
          const cutoutBindGroup = step.viewportSegment.cutoutBindGroup;
          if (!cutoutBindGroup) {
            throw new Error(`Layer ${step.layerId} authored matte is unavailable.`);
          }
          const cutoutPass = encoder.beginRenderPass({
            label: `${label} · clipping authored matte ${step.layerId}`,
            colorAttachments: [{
              view: cutoutView,
              loadOp: "load",
              storeOp: "store",
            }],
          });
          setDirtyScissor(cutoutPass);
          cutoutPass.setPipeline(clearPipeline);
          cutoutPass.draw(3, 1, 0, 0);
          cutoutPass.setPipeline(rasterPipeline!);
          cutoutPass.setBindGroup(0, cutoutBindGroup);
          cutoutPass.draw(3, 1, 0, 0);
          cutoutPass.end();
        }

        const stepBackdropBindGroup = groupOnDedicatedTexture
          ? engine.mixedSceneBlendFromGroupBindGroup
          : currentIsCanonical
            ? engine.mixedSceneBlendFromScratchBindGroup!
            : engine.mixedSceneBlendFromLinearBindGroup!;
        const stepBlendControls = writeBlendControls(
          step.blendMode,
          "source-atop",
          stepRecord,
          1,
          "clipping-child",
        );
        if (stepRecord?.cutoutMode === "document") {
          const stepDocumentMaskPass = encoder.beginRenderPass({
            label: `${label} · clipping document mask ${step.layerId}`,
            colorAttachments: [{
              view: documentMaskView,
              loadOp: "load",
              storeOp: "store",
            }],
          });
          setDirtyScissor(stepDocumentMaskPass);
          stepDocumentMaskPass.setPipeline(documentMaskPipeline);
          stepDocumentMaskPass.setBindGroup(
            0,
            stepBackdropBindGroup,
            [stepBlendControls],
          );
          stepDocumentMaskPass.draw(3, 1, 0, 0);
          stepDocumentMaskPass.end();
        }

        const groupBlendPass = encoder.beginRenderPass({
          label: `${label} · clipping atop ${step.blendMode}`,
          colorAttachments: [{
            view: groupOnDedicatedTexture ? groupStartView : groupView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(groupBlendPass);
        groupBlendPass.setPipeline(blendPipeline);
        groupBlendPass.setBindGroup(
          0,
          stepBackdropBindGroup,
          [stepBlendControls],
        );
        groupBlendPass.draw(3, 1, 0, 0);
        groupBlendPass.end();
        groupOnDedicatedTexture = !groupOnDedicatedTexture;
      }

      const completedGroupTexture = groupOnDedicatedTexture
        ? groupTexture
        : groupStartTexture;
      encoder.copyTextureToTexture(
        {
          texture: completedGroupTexture,
          origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
        },
        {
          texture: operandTexture,
          origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
        },
        {
          width: presentationDirtyRect.width,
          height: presentationDirtyRect.height,
          depthOrArrayLayers: 1,
        },
      );

      if (compositionRecord?.cutoutMode !== undefined && compositionRecord.cutoutMode !== "off") {
        const cutoutPass = encoder.beginRenderPass({
          label: `${label} · clipping-group authored matte`,
          colorAttachments: [{
            view: cutoutView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(cutoutPass);
        cutoutPass.setPipeline(clearPipeline);
        cutoutPass.draw(3, 1, 0, 0);
        drawSegmentCutoutSource(cutoutPass, segment);
        cutoutPass.end();
      }

      const outerBlendPass = encoder.beginRenderPass({
        label: `${label} · outer clipping group ${blendMode}`,
        colorAttachments: [{
          view: groupStartView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(outerBlendPass);
      outerBlendPass.setPipeline(blendPipeline);
      outerBlendPass.setBindGroup(
        0,
        currentIsCanonical
          ? engine.mixedSceneBlendFromLinearBindGroup!
          : engine.mixedSceneBlendFromScratchBindGroup!,
        [writeBlendControls(
          blendMode,
          "source-over",
          compositionRecord,
          engine.activeClippingGroup?.parentOpacity ?? 1,
          "clipping-outer",
          engine.activeClippingGroup?.parentOpacity ?? 1,
        )],
      );
      outerBlendPass.draw(3, 1, 0, 0);
      outerBlendPass.end();
      currentIsCanonical = !currentIsCanonical;
      captureDeepFloorAfter(segmentIndex);
      continue;
    }
    const usesCompactEncodedVectorComposite = segment.kind === "text-run"
      && vectorTextRunUsesEncodedSrgb(engine)
      && blendMode === "normal"
      && compositionRecord === null;
    if (usesCompactEncodedVectorComposite) {
      const resources = engine.vectorTextRunTextures.get(segment.key);
      if (resources?.initialized) {
        scenePass?.end();
        scenePass = null;
        ensureMixedSceneTextEncodedCompositeScratch(
          engine,
          engine.mixedSceneLinearWidth,
          engine.mixedSceneLinearHeight,
        );
        const scratchView = engine.mixedSceneTextEncodedCompositeScratchView;
        const scratchTexture = engine.mixedSceneTextEncodedCompositeScratchTexture;
        const layout = engine.mixedSceneTextEncodedCompositeBindGroupLayout;
        const pipeline = engine.mixedSceneTextEncodedCompositePipeline;
        const backdropTexture = currentIsCanonical
          ? engine.mixedSceneLinearTexture
          : engine.mixedSceneBlendScratchTexture;
        const backdropView = currentIsCanonical
          ? engine.mixedSceneLinearView
          : engine.mixedSceneBlendScratchView;
        if (
          !scratchView
          || !scratchTexture
          || !layout
          || !pipeline
          || !backdropTexture
          || !backdropView
        ) {
          throw new Error("The encoded vector backdrop compositor is unavailable.");
        }
        const bindGroup = engine.device.createBindGroup({
          label: `Encoded vector backdrop ${segment.key}`,
          layout,
          entries: [
            { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
            { binding: 1, resource: { buffer: engine.vectorTextCaptureUniformBuffer } },
            { binding: 2, resource: resources.view },
            { binding: 3, resource: engine.sampler },
            {
              binding: 4,
              resource: { buffer: engine.vectorTextFallbackCaptureUniformBuffer },
            },
            {
              binding: 5,
              resource: resources.fallbackView ?? engine.transparentLayerView,
            },
            { binding: 6, resource: { buffer: resources.cacheUniformBuffer } },
            { binding: 7, resource: backdropView },
          ],
        });
        const compositePass = encoder.beginRenderPass({
          label: `${label} · encoded vector backdrop ${segment.key}`,
          colorAttachments: [{
            view: scratchView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(compositePass);
        compositePass.setPipeline(pipeline);
        compositePass.setBindGroup(0, bindGroup);
        compositePass.draw(3, 1, 0, 0);
        compositePass.end();
        encoder.copyTextureToTexture(
          {
            texture: scratchTexture,
            origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
          },
          {
            texture: backdropTexture,
            origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
          },
          {
            width: presentationDirtyRect.width,
            height: presentationDirtyRect.height,
            depthOrArrayLayers: 1,
          },
        );
        scenePass = beginScenePass();
      }
      captureDeepFloorAfter(segmentIndex);
      continue;
    }
    const needsBackdropComposition = blendMode !== "normal"
      || compositionRecord?.cutoutMode !== undefined
        && compositionRecord.cutoutMode !== "off"
      || compositionRecord?.tonalBlend !== undefined
        && !layerTonalBlendIsDefault(compositionRecord.tonalBlend)
      || rasterResources?.documentCutoutMaskSurface !== null
        && rasterResources?.documentCutoutMaskSurface !== undefined;
    if (!needsBackdropComposition) {
      scenePass ??= beginScenePass();
      drawSegmentSource(scenePass, segment);
      captureDeepFloorAfter(segmentIndex);
      continue;
    }

    scenePass?.end();
    scenePass = null;
    const operandView = engine.mixedSceneBlendOperandView;
    const cutoutView = engine.mixedSceneBlendCutoutView;
    const targetView = currentIsCanonical
      ? engine.mixedSceneBlendScratchView
      : linearView;
    const blendBindGroup = currentIsCanonical
      ? engine.mixedSceneBlendFromLinearBindGroup
      : engine.mixedSceneBlendFromScratchBindGroup;
    const blendPipeline = engine.layerBlendCompositorPipeline;
    if (
      !operandView
      || !cutoutView
      || !targetView
      || !blendBindGroup
      || !blendPipeline
      || !engine.layerBlendCompositorUniformBuffer
      || engine.layerBlendCompositorUniformStride <= 0
    ) {
      throw new Error("WebGPU layer-blend ping-pong is not ready.");
    }

    const operandPass = encoder.beginRenderPass({
      label: `${label} · source ${blendMode}`,
      colorAttachments: [{
        view: operandView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    setDirtyScissor(operandPass);
    operandPass.setPipeline(clearPipeline);
    operandPass.draw(3, 1, 0, 0);
    drawSegmentSource(operandPass, segment);
    operandPass.end();

    if (compositionRecord?.cutoutMode !== undefined && compositionRecord.cutoutMode !== "off") {
      const cutoutPass = encoder.beginRenderPass({
        label: `${label} · authored matte`,
        colorAttachments: [{
          view: cutoutView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(cutoutPass);
      cutoutPass.setPipeline(clearPipeline);
      cutoutPass.draw(3, 1, 0, 0);
      drawSegmentCutoutSource(cutoutPass, segment);
      cutoutPass.end();
    }

    const hasDocumentCutoutResources = Boolean(
      rasterResources?.documentCutoutBaseSurface
        && rasterResources.documentCutoutMaskSurface
        && rasterResources.documentCutoutBaseBindGroup
        && rasterResources.documentCutoutMaskBindGroup,
    );
    if (
      rasterResources
      && (rasterResources.documentCutoutBaseSurface || rasterResources.documentCutoutMaskSurface)
      && !hasDocumentCutoutResources
    ) {
      throw new Error("The raster segment document-cutout resources are incomplete.");
    }
    if (hasDocumentCutoutResources) {
      const clippingBaseView = engine.mixedSceneBlendClippingBaseView;
      const documentMaskView = engine.mixedSceneBlendDocumentMaskView;
      if (!clippingBaseView || !documentMaskView) {
        throw new Error("The raster segment document-cutout targets are unavailable.");
      }
      const clippingBasePass = encoder.beginRenderPass({
        label: `${label} · raster clipping immutable base`,
        colorAttachments: [{
          view: clippingBaseView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(clippingBasePass);
      clippingBasePass.setPipeline(clearPipeline);
      clippingBasePass.draw(3, 1, 0, 0);
      clippingBasePass.setPipeline(rasterPipeline!);
      clippingBasePass.setBindGroup(0, rasterResources!.documentCutoutBaseBindGroup!);
      clippingBasePass.draw(3, 1, 0, 0);
      clippingBasePass.end();

      const documentMaskPass = encoder.beginRenderPass({
        label: `${label} · raster clipping document mask`,
        colorAttachments: [{
          view: documentMaskView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(documentMaskPass);
      documentMaskPass.setPipeline(clearPipeline);
      documentMaskPass.draw(3, 1, 0, 0);
      documentMaskPass.setPipeline(rasterPipeline!);
      documentMaskPass.setBindGroup(0, rasterResources!.documentCutoutMaskBindGroup!);
      documentMaskPass.draw(3, 1, 0, 0);
      documentMaskPass.end();
    }

    const blendPass = encoder.beginRenderPass({
      label: `${label} · blend ${blendMode}`,
      colorAttachments: [{
        view: targetView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    setDirtyScissor(blendPass);
    blendPass.setPipeline(blendPipeline);
    blendPass.setBindGroup(
      0,
      blendBindGroup,
      [writeBlendControls(
        blendMode,
        "source-over",
        compositionRecord,
        1,
        hasDocumentCutoutResources ? "clipping-outer" : "direct",
        rasterResources?.documentCutoutOpacity ?? 1,
      )],
    );
    blendPass.draw(3, 1, 0, 0);
    blendPass.end();
    currentIsCanonical = !currentIsCanonical;
    captureDeepFloorAfter(segmentIndex);
  }
  scenePass?.end();

  if (!currentIsCanonical) {
    const scratchTexture = engine.mixedSceneBlendScratchTexture;
    const canonicalTexture = engine.mixedSceneLinearTexture;
    if (!scratchTexture || !canonicalTexture) {
      throw new Error("The layer-blend compositor's final copy is not ready.");
    }
    encoder.copyTextureToTexture(
      {
        texture: scratchTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        texture: canonicalTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        width: presentationDirtyRect.width,
        height: presentationDirtyRect.height,
        depthOrArrayLayers: 1,
      },
    );
  }

  const presentPass = encoder.beginRenderPass({
    label: `${label} · final checker`,
    colorAttachments: [
      {
        view: engine.presentationCacheView,
        loadOp: requiresFullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
      },
    ],
  });
  presentPass.setPipeline(presentPipeline);
  presentPass.setBindGroup(0, presentBindGroup);
  presentPass.setScissorRect(
    presentationDirtyRect.x,
    presentationDirtyRect.y,
    presentationDirtyRect.width,
    presentationDirtyRect.height,
  );
  presentPass.draw(3, 1, 0, 0);
  presentPass.end();
}

function writeVectorTextRunCacheUniforms(
  engine: BrushEngine,
  resources: VectorTextRunTextureResources,
  primaryBounds: Readonly<DirtyRect> = resources.textureBounds,
  fallbackBounds: Readonly<DirtyRect> | null = resources.fallbackBounds,
): void {
  const nextValues = [
    primaryBounds.x,
    primaryBounds.y,
    fallbackBounds?.x ?? 0,
    fallbackBounds?.y ?? 0,
    resources.opacity,
    resources.primaryEncodedSrgb ? 1 : 0,
    resources.fallbackEncodedSrgb ? 1 : 0,
    0,
  ] as const;
  const previousValues = resources.cacheUniformUpload.slice();
  let changed = false;
  for (let index = 0; index < nextValues.length; index += 1) {
    const next = Math.fround(nextValues[index]);
    if (!Object.is(resources.cacheUniformUpload[index], next)) {
      resources.cacheUniformUpload[index] = next;
      changed = true;
    }
  }
  if (changed) {
    try {
      engine.device.queue.writeBuffer(
        resources.cacheUniformBuffer,
        0,
        resources.cacheUniformUpload,
      );
    } catch (error) {
      resources.cacheUniformUpload.set(previousValues);
      throw error;
    }
  }
}

function setVectorTextRunOpacity(
  engine: BrushEngine,
  resources: VectorTextRunTextureResources,
  opacity: number,
): void {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1));
  if (Object.is(resources.opacity, normalized)) return;
  const previous = resources.opacity;
  resources.opacity = normalized;
  try {
    writeVectorTextRunCacheUniforms(engine, resources);
  } catch (error) {
    resources.opacity = previous;
    throw error;
  }
}

function createVectorTextRunBindGroup(
  engine: BrushEngine,
  key: Extract<VectorTextPlacement, `text-run:${string}`>,
  sourceView: GPUTextureView,
  fallbackView: GPUTextureView | null,
  cacheUniformBuffer: GPUBuffer,
): GPUBindGroup {
  const layout = engine.mixedSceneTextSegmentBindGroupLayout;
  if (!layout) {
    throw new Error("The segmented-text cache layout is not initialized.");
  }
  return engine.device.createBindGroup({
    label: `Vector text ${key} dual-capture segment bind group`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: { buffer: engine.vectorTextCaptureUniformBuffer } },
      { binding: 2, resource: sourceView },
      { binding: 3, resource: engine.sampler },
      { binding: 4, resource: { buffer: engine.vectorTextFallbackCaptureUniformBuffer } },
      { binding: 5, resource: fallbackView ?? engine.transparentLayerView },
      { binding: 6, resource: { buffer: cacheUniformBuffer } },
    ],
  });
}

function rebuildVectorTextRunBindGroup(
  engine: BrushEngine,
  key: Extract<VectorTextPlacement, `text-run:${string}`>,
  resources: VectorTextRunTextureResources,
): void {
  resources.bindGroup = createVectorTextRunBindGroup(
    engine,
    key,
    resources.view,
    resources.fallbackView,
    resources.cacheUniformBuffer,
  );
}

export function clearVectorTextFallbackPresentation(engine: BrushEngine): void {
  let changed = engine.vectorTextFallbackCaptureView !== null;
  for (const [key, resources] of engine.vectorTextRunTextures) {
    if (resources.fallbackTexture) {
      const nextBindGroup = createVectorTextRunBindGroup(
        engine,
        key,
        resources.view,
        null,
        resources.cacheUniformBuffer,
      );
      const previousTexture = resources.fallbackTexture;
      resources.fallbackTexture = null;
      resources.fallbackView = null;
      resources.fallbackMipLevelCount = 0;
      resources.fallbackBounds = null;
      resources.fallbackEncodedSrgb = false;
      resources.bindGroup = nextBindGroup;
      writeVectorTextRunCacheUniforms(engine, resources, resources.textureBounds, null);
      previousTexture.destroy();
      changed = true;
    }
  }
  engine.vectorTextFallbackCaptureView = null;
  writeVectorTextFallbackCaptureUniforms(engine);
  writeVectorTextCaptureUniforms(engine);
  if (changed && engine.initialized) {
    engine.displayDirty = true;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.requestRender();
  }
}

export function vectorTextFallbackPresentationComplete(engine: BrushEngine): boolean {
  const capture = engine.vectorTextFallbackCaptureView;
  return capture !== null
    && engine.vectorTextRunTextures.size > 0
    && capture.canvasWidth === engine.vectorTextTextureWidth
    && capture.canvasHeight === engine.vectorTextTextureHeight
    && [...engine.vectorTextRunTextures.values()].every(
      (resources) => resources.fallbackTexture !== null
        && resources.fallbackView !== null
        && resources.fallbackMipLevelCount > 0
        && resources.fallbackBounds !== null,
    );
}

export function getVectorTextFallbackPresentationStats(engine: BrushEngine): {
  captureView: VectorTextViewState | null;
  textureCount: number;
  gpuMemoryMiB: number;
  complete: boolean;
} {
  const fallbackResources = [...engine.vectorTextRunTextures.values()].filter(
    (resources) => resources.fallbackTexture !== null && resources.fallbackBounds !== null,
  );
  const textureCount = fallbackResources.length;
  const gpuMemoryBytes = fallbackResources.reduce(
    (total, resources) => total
      + vectorTextRunCacheMemoryBytes(
        resources.fallbackBounds!.width,
        resources.fallbackBounds!.height,
      ),
    0,
  );
  return {
    captureView: engine.vectorTextFallbackCaptureView
      ? { ...engine.vectorTextFallbackCaptureView }
      : null,
    textureCount,
    gpuMemoryMiB: gpuMemoryBytes / (1024 * 1024),
    complete: vectorTextFallbackPresentationComplete(engine),
  };
}

interface VectorTextFallbackPublicationCandidate {
  readonly resources: VectorTextRunTextureResources;
  readonly texture: GPUTexture | null;
  readonly view: GPUTextureView | null;
  readonly mipLevelCount: number;
  readonly bounds: DirtyRect | null;
  readonly bindGroup: GPUBindGroup;
  readonly encodedSrgb: boolean;
}

/** Publishes one complete fallback generation or restores the previous one. */
function publishVectorTextFallbackGeneration(
  engine: BrushEngine,
  captureView: Readonly<VectorTextViewState>,
  candidates: ReadonlyMap<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    VectorTextFallbackPublicationCandidate
  >,
  refreshPrimaryCaptureUniform: boolean,
): void {
  if (
    candidates.size !== engine.vectorTextRunTextures.size
    || [...candidates].some(
      ([key, candidate]) => engine.vectorTextRunTextures.get(key) !== candidate.resources,
    )
  ) {
    for (const candidate of candidates.values()) candidate.texture?.destroy();
    throw new Error("GPU text runs changed before wide-cache publication.");
  }

  const previousCaptureView = engine.vectorTextFallbackCaptureView
    ? { ...engine.vectorTextFallbackCaptureView }
    : null;
  const previousStates = new Map<
    VectorTextRunTextureResources,
    {
      texture: GPUTexture | null;
      view: GPUTextureView | null;
      mipLevelCount: number;
      bounds: DirtyRect | null;
      bindGroup: GPUBindGroup;
      encodedSrgb: boolean;
    }
  >();
  for (const candidate of candidates.values()) {
    const resources = candidate.resources;
    previousStates.set(resources, {
      texture: resources.fallbackTexture,
      view: resources.fallbackView,
      mipLevelCount: resources.fallbackMipLevelCount,
      bounds: resources.fallbackBounds,
      bindGroup: resources.bindGroup,
      encodedSrgb: resources.fallbackEncodedSrgb,
    });
  }

  try {
    for (const candidate of candidates.values()) {
      const resources = candidate.resources;
      resources.fallbackTexture = candidate.texture;
      resources.fallbackView = candidate.view;
      resources.fallbackMipLevelCount = candidate.mipLevelCount;
      resources.fallbackBounds = candidate.bounds;
      resources.fallbackEncodedSrgb = candidate.encodedSrgb;
      resources.bindGroup = candidate.bindGroup;
      writeVectorTextRunCacheUniforms(engine, resources);
    }
    engine.vectorTextFallbackCaptureView = { ...captureView };
    writeVectorTextFallbackCaptureUniforms(engine);
    if (refreshPrimaryCaptureUniform) {
      writeVectorTextCaptureUniforms(engine);
    }
  } catch (error) {
    engine.vectorTextFallbackCaptureView = previousCaptureView;
    for (const [resources, previous] of previousStates) {
      resources.fallbackTexture = previous.texture;
      resources.fallbackView = previous.view;
      resources.fallbackMipLevelCount = previous.mipLevelCount;
      resources.fallbackBounds = previous.bounds;
      resources.fallbackEncodedSrgb = previous.encodedSrgb;
      resources.bindGroup = previous.bindGroup;
      try {
        writeVectorTextRunCacheUniforms(engine, resources);
      } catch {
        // Preserve the original publication failure; a lost device may also
        // reject the best-effort uniform restoration.
      }
    }
    try {
      writeVectorTextFallbackCaptureUniforms(engine);
      if (refreshPrimaryCaptureUniform) writeVectorTextCaptureUniforms(engine);
    } catch {
      // Same best-effort rollback rule as the per-run uniforms above.
    }
    for (const candidate of candidates.values()) candidate.texture?.destroy();
    throw error;
  }

  for (const previous of previousStates.values()) previous.texture?.destroy();
}

/**
 * Rebuilds every live text run into candidate fallback textures with a fixed
 * scene-relative camera. Candidate views and bind groups are published only
 * after the whole batch has been encoded and submitted, so a topology change
 * can never expose a half-old/half-new fallback generation.
 */
export function rebuildVectorTextGpuFallbackPresentation(
  engine: BrushEngine,
  captureView: Readonly<VectorTextViewState>,
  runs: readonly {
    placement: VectorTextPlacement;
    draws: readonly VectorTextGpuDraw[];
  }[],
): { textureCount: number; gpuMemoryMiB: number } {
  flushVectorTextGpuPresentations(engine);
  const width = engine.vectorTextTextureWidth;
  const height = engine.vectorTextTextureHeight;
  if (
    width < 1
    || height < 1
    || captureView.canvasWidth !== width
    || captureView.canvasHeight !== height
  ) {
    throw new Error("The wide view does not match the viewport vector caches.");
  }
  if (engine.vectorTextRunTextures.size === 0) {
    clearVectorTextFallbackPresentation(engine);
    return { textureCount: 0, gpuMemoryMiB: 0 };
  }

  const runByKey = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    readonly VectorTextGpuDraw[]
  >();
  for (const run of runs) {
    if (!run.placement.startsWith("text-run:")) {
      throw new Error("The wide cache accepts only segmented text runs.");
    }
    const key = run.placement as Extract<VectorTextPlacement, `text-run:${string}`>;
    if (runByKey.has(key)) {
      throw new Error(`Duplicate text run in the wide cache: ${key}.`);
    }
    runByKey.set(key, run.draws);
  }
  if (
    runByKey.size !== engine.vectorTextRunTextures.size
    || [...engine.vectorTextRunTextures.keys()].some((key) => !runByKey.has(key))
  ) {
    throw new Error("The wide cache must atomically cover every live text run.");
  }

  const candidates = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    VectorTextFallbackPublicationCandidate
  >();
  const pendingStart = engine.vectorTextGpuPendingRuns.length;
  try {
    for (const [key, draws] of runByKey) {
      const resources = engine.vectorTextRunTextures.get(key);
      if (!resources) {
        throw new Error(`GPU text run ${key} was removed while building the wide cache.`);
      }
      const runBounds = vectorTextGpuRunBounds(draws, captureView);
      const fallbackBounds = vectorTextGpuRunCacheAllocationBounds(
        runBounds,
        width,
        height,
        engine.vectorTextRoiCacheEnabled,
      );
      const mipLevelCount = vectorTextRunCacheMipLevelCount(
        fallbackBounds.width,
        fallbackBounds.height,
      );
      const texture = engine.device.createTexture({
        label: `Vector text ${key} automatic wide fallback ROI `
          + `${fallbackBounds.width}×${fallbackBounds.height}`,
        size: {
          width: fallbackBounds.width,
          height: fallbackBounds.height,
          depthOrArrayLayers: 1,
        },
        mipLevelCount,
        format: VECTOR_TEXT_GPU_TARGET_FORMAT,
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      try {
        const view = texture.createView({
          label: `Vector text ${key} automatic wide fallback view`,
        });
        const mipZeroView = texture.createView({
          label: `Vector text ${key} automatic wide fallback mip zero view`,
          baseMipLevel: 0,
          mipLevelCount: 1,
        });
        const bindGroup = createVectorTextRunBindGroup(
          engine,
          key,
          resources.view,
          view,
          resources.cacheUniformBuffer,
        );
        candidates.set(key, {
          texture,
          view,
          mipLevelCount,
          bindGroup,
          resources,
          bounds: fallbackBounds,
          encodedSrgb: vectorTextRunUsesEncodedSrgb(engine),
        });
        const drawResources = draws.map((draw) => ensureVectorTextGpuResource(engine, draw));
        const blurResources = draws.map((draw) =>
          vectorTextGpuDrawUsesBlur(draw)
            ? ensureVectorTextGpuBlurCache(engine, draw)
            : null,
        );
        engine.vectorTextGpuPendingRuns.push({
          placement: key,
          resources,
          target: "fallback",
          targetTexture: texture,
          targetView: mipZeroView,
          targetMipLevelCount: mipLevelCount,
          targetBounds: fallbackBounds,
          draws,
          drawResources,
          blurResources,
          view: { ...captureView },
          bounds: runBounds,
        });
      } catch (error) {
        candidates.delete(key);
        texture.destroy();
        throw error;
      }
    }
    flushVectorTextGpuPresentations(engine);
  } catch (error) {
    engine.vectorTextGpuPendingRuns.splice(pendingStart);
    for (const candidate of candidates.values()) candidate.texture?.destroy();
    throw error;
  }

  publishVectorTextFallbackGeneration(engine, captureView, candidates, true);
  return {
    textureCount: candidates.size,
    gpuMemoryMiB: [...candidates.values()].reduce(
      (total, candidate) => total
        + vectorTextRunCacheMemoryBytes(
          candidate.bounds!.width,
          candidate.bounds!.height,
        ),
      0,
    ) / (1024 * 1024),
  };
}

export function captureVectorTextFallbackPresentation(engine: BrushEngine): {
  textureCount: number;
  gpuMemoryMiB: number;
} {
  flushVectorTextGpuPresentations(engine);
  const width = engine.vectorTextTextureWidth;
  const height = engine.vectorTextTextureHeight;
  const sourceView = engine.vectorTextCaptureView;
  if (!sourceView || width < 1 || height < 1) {
    throw new Error("No exact vector presentation is available for use as coverage.");
  }
  const candidates = new Map<
    Extract<VectorTextPlacement, `text-run:${string}`>,
    VectorTextFallbackPublicationCandidate
  >();
  const encoder = engine.device.createCommandEncoder({
    label: "Vector text wide fallback capture copies",
  });
  try {
    for (const [key, resources] of engine.vectorTextRunTextures) {
      if (!resources.initialized) {
        candidates.set(key, {
          resources,
          texture: null,
          view: null,
          mipLevelCount: 0,
          bounds: null,
          bindGroup: createVectorTextRunBindGroup(
            engine,
            key,
            resources.view,
            null,
            resources.cacheUniformBuffer,
          ),
          encodedSrgb: false,
        });
        continue;
      }
      const fallbackBounds = { ...resources.textureBounds };
      const mipLevelCount = vectorTextRunCacheMipLevelCount(
        fallbackBounds.width,
        fallbackBounds.height,
      );
      const texture = engine.device.createTexture({
        label: `Vector text ${key} wide fallback ROI `
          + `${fallbackBounds.width}×${fallbackBounds.height}`,
        size: {
          width: fallbackBounds.width,
          height: fallbackBounds.height,
          depthOrArrayLayers: 1,
        },
        mipLevelCount,
        format: VECTOR_TEXT_GPU_TARGET_FORMAT,
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      try {
        const view = texture.createView({
          label: `Vector text ${key} wide fallback view`,
        });
        const bindGroup = createVectorTextRunBindGroup(
          engine,
          key,
          resources.view,
          view,
          resources.cacheUniformBuffer,
        );
        candidates.set(key, {
          resources,
          texture,
          view,
          mipLevelCount,
          bounds: fallbackBounds,
          bindGroup,
          encodedSrgb: resources.primaryEncodedSrgb,
        });
        encoder.copyTextureToTexture(
          { texture: resources.texture },
          { texture },
          {
            width: fallbackBounds.width,
            height: fallbackBounds.height,
            depthOrArrayLayers: 1,
          },
        );
        encodeVectorTextRunCacheMipChain(
          engine,
          encoder,
          texture,
          fallbackBounds.width,
          fallbackBounds.height,
          mipLevelCount,
          `Vector text ${key} captured fallback ROI`,
        );
      } catch (error) {
        candidates.delete(key);
        texture.destroy();
        throw error;
      }
    }
    if (![...candidates.values()].some((candidate) => candidate.texture !== null)) {
      throw new Error("The exact vector caches are not initialized yet.");
    }
    engine.device.queue.submit([encoder.finish()]);
  } catch (error) {
    for (const candidate of candidates.values()) candidate.texture?.destroy();
    throw error;
  }

  publishVectorTextFallbackGeneration(engine, sourceView, candidates, false);
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.requestRender();
  return {
    textureCount: [...candidates.values()].filter(
      (candidate) => candidate.texture !== null,
    ).length,
    gpuMemoryMiB: [...candidates.values()].reduce(
      (total, candidate) => total
        + (candidate.bounds
          ? vectorTextRunCacheMemoryBytes(
            candidate.bounds.width,
            candidate.bounds.height,
          )
          : 0),
      0,
    ) / (1024 * 1024),
  };
}

export async function probeVectorTextFallbackAlpha(
  engine: BrushEngine,
  layerPoints: readonly { x: number; y: number }[],
): Promise<{ runCount: number; alphaPixelCounts: number[] }> {
  const fallbackRuns = [...engine.vectorTextRunTextures.values()].filter(
    (resources) => resources.fallbackTexture !== null,
  );
  const capture = engine.vectorTextFallbackCaptureView;
  if (fallbackRuns.length !== 1 || !capture || layerPoints.length === 0) {
    throw new Error("Probe C requires exactly one run with ready GPU coverage.");
  }
  const fallbackRun = fallbackRuns[0];
  const texture = fallbackRun.fallbackTexture!;
  const cacheBounds = fallbackRun.fallbackBounds;
  if (!cacheBounds) {
    throw new Error("Probe C fallback ROI is missing.");
  }
  const probeSize = Math.max(
    1,
    Math.min(128, cacheBounds.width, cacheBounds.height),
  );
  const bytesPerPixel = VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL;
  const bytesPerRow = Math.ceil(probeSize * bytesPerPixel / 256) * 256;
  const bytesPerProbe = bytesPerRow * probeSize;
  const readback = engine.device.createBuffer({
    label: `Vector text C fallback alpha witnesses ${layerPoints.length}`,
    size: bytesPerProbe * layerPoints.length,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = engine.device.createCommandEncoder({
      label: "Vector text C fallback alpha witness readback",
    });
    layerPoints.forEach((point, index) => {
      const deltaX = point.x - capture.centerX;
      const deltaY = point.y - capture.centerY;
      const screenX = capture.canvasWidth * 0.5 + capture.zoom * (
        capture.rotationCos * deltaX - capture.rotationSin * deltaY
      );
      const screenY = capture.canvasHeight * 0.5 + capture.zoom * (
        capture.rotationSin * deltaX + capture.rotationCos * deltaY
      );
      const canvasOriginX = Math.max(
        cacheBounds.x,
        Math.min(
          cacheBounds.x + cacheBounds.width - probeSize,
          Math.round(screenX - probeSize * 0.5),
        ),
      );
      const canvasOriginY = Math.max(
        cacheBounds.y,
        Math.min(
          cacheBounds.y + cacheBounds.height - probeSize,
          Math.round(screenY - probeSize * 0.5),
        ),
      );
      encoder.copyTextureToBuffer(
        {
          texture,
          origin: {
            x: canvasOriginX - cacheBounds.x,
            y: canvasOriginY - cacheBounds.y,
            z: 0,
          },
        },
        {
          buffer: readback,
          offset: index * bytesPerProbe,
          bytesPerRow,
          rowsPerImage: probeSize,
        },
        { width: probeSize, height: probeSize, depthOrArrayLayers: 1 },
      );
    });
    engine.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const alphaPixelCounts = layerPoints.map((_, pointIndex) => {
      let alphaPixels = 0;
      const base = pointIndex * bytesPerProbe;
      for (let y = 0; y < probeSize; y += 1) {
        for (let x = 0; x < probeSize; x += 1) {
          const alphaOffset = base + y * bytesPerRow + x * bytesPerPixel + 6;
          if ((bytes[alphaOffset] | bytes[alphaOffset + 1]) !== 0) alphaPixels += 1;
        }
      }
      return alphaPixels;
    });
    readback.unmap();
    return { runCount: fallbackRuns.length, alphaPixelCounts };
  } finally {
    readback.destroy();
  }
}

/**
 * Reads the actual fast-mode mixed-scene result before the opaque checker pass.
 * Unlike the fallback-source probe, this exercises the current camera uniforms,
 * dual-capture bind group, mode-3 shader branch, and the compositor submission
 * that is copied to the visible presentation cache.
 */
export async function probeVectorTextFastCompositeAlpha(
  engine: BrushEngine,
  layerPoints: readonly { x: number; y: number }[],
): Promise<{ alphaPixelCounts: number[] }> {
  const texture = engine.mixedSceneLinearTexture;
  const view = engine.getVectorTextViewState();
  if (
    !engine.vectorTextFastPresentationEnabled
    || engine.vectorTextFastPresentationMode !== "reproject-fallback"
    || !texture
    || layerPoints.length === 0
  ) {
    throw new Error("Probe C requires active fast-fallback compositing.");
  }
  if (
    engine.mixedSceneLinearWidth !== view.canvasWidth
    || engine.mixedSceneLinearHeight !== view.canvasHeight
  ) {
    throw new Error("Linear cache C does not match the current viewport.");
  }

  const probeSize = Math.max(
    1,
    Math.min(128, Math.floor(view.canvasWidth), Math.floor(view.canvasHeight)),
  );
  const bytesPerPixel = 8;
  const bytesPerRow = Math.ceil(probeSize * bytesPerPixel / 256) * 256;
  const bytesPerProbe = bytesPerRow * probeSize;
  const readback = engine.device.createBuffer({
    label: `Vector text C fast composite alpha witnesses ${layerPoints.length}`,
    size: bytesPerProbe * layerPoints.length,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = engine.device.createCommandEncoder({
      label: "Vector text C fast composite alpha witness readback",
    });
    layerPoints.forEach((point, index) => {
      const deltaX = point.x - view.centerX;
      const deltaY = point.y - view.centerY;
      const screenX = view.canvasWidth * 0.5 + view.zoom * (
        view.rotationCos * deltaX - view.rotationSin * deltaY
      );
      const screenY = view.canvasHeight * 0.5 + view.zoom * (
        view.rotationSin * deltaX + view.rotationCos * deltaY
      );
      const originX = Math.max(
        0,
        Math.min(
          Math.floor(view.canvasWidth) - probeSize,
          Math.round(screenX - probeSize * 0.5),
        ),
      );
      const originY = Math.max(
        0,
        Math.min(
          Math.floor(view.canvasHeight) - probeSize,
          Math.round(screenY - probeSize * 0.5),
        ),
      );
      encoder.copyTextureToBuffer(
        { texture, origin: { x: originX, y: originY, z: 0 } },
        {
          buffer: readback,
          offset: index * bytesPerProbe,
          bytesPerRow,
          rowsPerImage: probeSize,
        },
        { width: probeSize, height: probeSize, depthOrArrayLayers: 1 },
      );
    });
    engine.device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(readback.getMappedRange());
    const alphaPixelCounts = layerPoints.map((_, pointIndex) => {
      let alphaPixels = 0;
      const base = pointIndex * bytesPerProbe;
      for (let y = 0; y < probeSize; y += 1) {
        for (let x = 0; x < probeSize; x += 1) {
          const alphaOffset = base + y * bytesPerRow + x * bytesPerPixel + 6;
          if ((bytes[alphaOffset] | bytes[alphaOffset + 1]) !== 0) alphaPixels += 1;
        }
      }
      return alphaPixels;
    });
    readback.unmap();
    return { alphaPixelCounts };
  } finally {
    readback.destroy();
  }
}

export function ensureVectorTextPresentationTexture(engine: BrushEngine, 
  width: number,
  height: number,
  placement: VectorTextPlacement,
  requestedBounds?: Readonly<DirtyRect>,
  opacity = 1,
): GPUTexture {
  if (
    engine.vectorTextTextureWidth !== width
    || engine.vectorTextTextureHeight !== height
  ) {
    const legacyBindingsChanged = Boolean(
      engine.vectorTextBelowTexture || engine.vectorTextAboveTexture,
    );
    engine.vectorTextBelowTexture?.destroy();
    engine.vectorTextAboveTexture?.destroy();
    for (const resources of engine.vectorTextRunTextures.values()) {
      resources.texture.destroy();
      resources.fallbackTexture?.destroy();
      resources.cacheUniformBuffer.destroy();
    }
    engine.vectorTextRunTextures.clear();
    engine.vectorTextBelowTexture = null;
    engine.vectorTextBelowView = null;
    engine.vectorTextAboveTexture = null;
    engine.vectorTextAboveView = null;
    engine.vectorTextFallbackCaptureView = null;
    writeVectorTextFallbackCaptureUniforms(engine);
    writeVectorTextCaptureUniforms(engine);
    engine.vectorTextTextureWidth = width;
    engine.vectorTextTextureHeight = height;
    if (legacyBindingsChanged) {
      rebuildVectorTextDisplayBindGroup(engine);
    }
  }

  if (placement.startsWith("text-run:")) {
    const key = placement as Extract<VectorTextPlacement, `text-run:${string}`>;
    const existingRun = engine.vectorTextRunTextures.get(key);
    if (existingRun) setVectorTextRunOpacity(engine, existingRun, opacity);
    const bounds = requestedBounds ?? { x: 0, y: 0, width, height };
    const recommendedBounds = vectorTextGpuRunCacheAllocationBounds(
      bounds,
      width,
      height,
      engine.vectorTextRoiCacheEnabled,
    );
    const shouldShrinkRunCache = Boolean(
      existingRun
      && recommendedBounds.width <= existingRun.textureBounds.width
      && recommendedBounds.height <= existingRun.textureBounds.height
      && recommendedBounds.width * recommendedBounds.height
        <= existingRun.textureBounds.width * existingRun.textureBounds.height * 0.25,
    );
    if (
      existingRun
      && !shouldShrinkRunCache
      && bounds.width <= existingRun.textureBounds.width
      && bounds.height <= existingRun.textureBounds.height
    ) {
      if (!vectorTextGpuRunCacheContains(existingRun.textureBounds, bounds)) {
        const repositionedBounds = placeVectorTextGpuRunCache(
          bounds,
          existingRun.textureBounds.width,
          existingRun.textureBounds.height,
          width,
          height,
        );
        // The texture is repainted below, so moving its screen-space origin is
        // a small uniform update rather than a GPU reallocation.
        writeVectorTextRunCacheUniforms(engine, existingRun, repositionedBounds);
        existingRun.textureBounds = repositionedBounds;
        existingRun.initialized = false;
        existingRun.lastBounds = null;
      }
      return existingRun.texture;
    }

    const capacityWidth = shouldShrinkRunCache
      ? recommendedBounds.width
      : growVectorTextGpuCacheAxisCapacity(
        existingRun?.textureBounds.width ?? 0,
        recommendedBounds.width,
        width,
      );
    const capacityHeight = shouldShrinkRunCache
      ? recommendedBounds.height
      : growVectorTextGpuCacheAxisCapacity(
        existingRun?.textureBounds.height ?? 0,
        recommendedBounds.height,
        height,
      );
    const textureBounds = placeVectorTextGpuRunCache(
      bounds,
      capacityWidth,
      capacityHeight,
      width,
      height,
    );
    const mipLevelCount = vectorTextRunCacheMipLevelCount(
      textureBounds.width,
      textureBounds.height,
    );
    const texture = engine.device.createTexture({
      label: `Vector text ${key} ROI cache ${textureBounds.width}×${textureBounds.height}`,
      size: {
        width: textureBounds.width,
        height: textureBounds.height,
        depthOrArrayLayers: 1,
      },
      mipLevelCount,
      format: VECTOR_TEXT_GPU_TARGET_FORMAT,
      usage:
        GPUTextureUsage.COPY_DST
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING,
    });
    let cacheUniformBuffer: GPUBuffer | null = null;
    try {
      const view = texture.createView({
        label: `Vector text ${key} ROI cache view`,
      });
      const mipZeroView = texture.createView({
        label: `Vector text ${key} ROI cache mip zero view`,
        baseMipLevel: 0,
        mipLevelCount: 1,
      });
      if (existingRun) {
        const bindGroup = createVectorTextRunBindGroup(
          engine,
          key,
          view,
          existingRun.fallbackView,
          existingRun.cacheUniformBuffer,
        );
        writeVectorTextRunCacheUniforms(engine, existingRun, textureBounds);
        const previousTexture = existingRun.texture;
        existingRun.texture = texture;
        existingRun.view = view;
        existingRun.mipZeroView = mipZeroView;
        existingRun.mipLevelCount = mipLevelCount;
        existingRun.textureBounds = textureBounds;
        existingRun.bindGroup = bindGroup;
        existingRun.lastBounds = null;
        existingRun.initialized = false;
        previousTexture.destroy();
        return texture;
      }

      cacheUniformBuffer = engine.device.createBuffer({
        label: `Vector text ${key} ROI origins`,
        size: VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const cacheUniformUpload = new Float32Array(
        VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT,
      );
      cacheUniformUpload.fill(Number.NaN);
      const resources: VectorTextRunTextureResources = {
        texture,
        view,
        mipZeroView,
        mipLevelCount,
        textureBounds,
        fallbackTexture: null,
        fallbackView: null,
        fallbackMipLevelCount: 0,
        fallbackBounds: null,
        cacheUniformBuffer,
        cacheUniformUpload,
        opacity: Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1)),
        primaryEncodedSrgb: false,
        fallbackEncodedSrgb: false,
        bindGroup: null as unknown as GPUBindGroup,
        lastBounds: null,
        initialized: false,
      };
      writeVectorTextRunCacheUniforms(engine, resources);
      rebuildVectorTextRunBindGroup(engine, key, resources);
      engine.vectorTextRunTextures.set(key, resources);
      return texture;
    } catch (error) {
      texture.destroy();
      cacheUniformBuffer?.destroy();
      throw error;
    }
  }

  const existing = placement === "below-active"
    ? engine.vectorTextBelowTexture
    : engine.vectorTextAboveTexture;
  if (existing) {
    return existing;
  }

  const texture = engine.device.createTexture({
    label: `Vector text ${placement} viewport cache ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: VECTOR_TEXT_GPU_TARGET_FORMAT,
    usage:
      GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView({
    label: `Vector text ${placement} viewport cache view`,
  });
  if (placement === "below-active") {
    engine.vectorTextBelowTexture = texture;
    engine.vectorTextBelowView = view;
  } else {
    engine.vectorTextAboveTexture = texture;
    engine.vectorTextAboveView = view;
  }
  rebuildVectorTextDisplayBindGroup(engine);
  return texture;
}

export async function mutateMixedScenePresentation<Result>(engine: BrushEngine, 
  mutate: (scene: MixedSceneStack) => Result,
  history?: {
    targetKey?: MixedSceneVectorKey;
    addedKey?: (result: Result) => MixedSceneVectorKey;
    /** Share only readonly SVG/image documents in the rollback snapshot. */
    shareImmutableDocuments?: boolean;
  },
): Promise<Result> {
  if (!engine.initialized) {
    throw new Error("The engine is not initialized yet.");
  }
  const scene = requireMixedSceneStack(engine);
  const absorbedByVectorEdit = history?.targetKey !== undefined
    && engine.activeVectorHistoryEdit?.key === history.targetKey
    && engine.activeVectorHistoryEdit.scope === "property";
  if (absorbedByVectorEdit) {
    if (engine.historyBusy || engine.layerSwitchBusy || engine.activeStroke !== null) {
      throw new Error("Finish the current vector property update first.");
    }
  } else {
    engine.assertLayerSwitchAllowed();
  }
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const shareImmutableDocuments = history?.shareImmutableDocuments === true;
  const previousState = scene.captureState(shareImmutableDocuments);
  const historyBefore = history?.targetKey && !absorbedByVectorEdit
    ? scene.captureVectorHistoryState(history.targetKey)
    : null;
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  try {
    engine.callbacks.onStatus?.("Preparing the raster/text scene…", "working");
    await engine.waitForIdle();
    const result = mutate(scene);
    const selected = scene.selected;
    engine.vectorTextPreviewExcludedNodeId = selected.kind === "text"
      ? selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.callbacks.onStatus?.("Compositing raster/text layers…", "working");
    await engine.rebuildMergedLayerSurfaces(
      "layer-switch",
      engine.getVectorTextViewState(),
      { reuseUnchangedRasterRuns: true },
    );
    engine.callbacks.onStatus?.("Raster/text scene ready.", "ok");
    if (history && !absorbedByVectorEdit) {
      const targetKey = history.targetKey ?? history.addedKey?.(result);
      if (!targetKey) {
        throw new Error("The vector target required by history is missing.");
      }
      const before = historyBefore ?? {
        key: targetKey,
        index: -1,
        selectedKey: previousState.selectedKey,
        node: null,
      } satisfies MixedSceneVectorHistoryState;
      recordVectorHistoryAction(engine, 
        before,
        scene.captureVectorHistoryState(targetKey),
      );
    }
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    return result;
  } catch (error) {
    scene.restoreState(previousState, shareImmutableDocuments);
    engine.vectorTextPreviewExcludedNodeId = previousExcludedNodeId;
    clearVectorTextPresentationForTransaction(engine);
    try {
      await engine.rebuildMergedLayerSurfaces(
        "layer-switch",
        engine.getVectorTextViewState(),
        { reuseUnchangedRasterRuns: true },
      );
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "The document became inconsistent after editing the mixed scene. Reload the page.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Scene edit failed (${originalMessage}) and recovery also failed `
        + `(${restoreMessage}). Reload the page.`,
      );
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    publishMixedScene(engine);
    engine.publishHistoryState();
    engine.publishStats();
  }
}

export function ensureVectorTextGpuBlurCache(engine: BrushEngine, 
  draw: VectorTextGpuBlurSourceDraw,
): VectorTextGpuBlurCacheResources {
  const existing = engine.vectorTextGpuBlurCaches.get(draw.blurKey);
  if (
    existing
    && existing.width === draw.blurWidth
    && existing.height === draw.blurHeight
  ) {
    return existing;
  }
  if (existing) {
    existing.texture.destroy();
    engine.vectorTextGpuBlurCaches.delete(draw.blurKey);
  }
  const layout = engine.vectorTextGpuBlurCompositeBindGroupLayout;
  const innerLayout = engine.vectorTextGpuInnerShadowBindGroupLayout;
  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const sampler = engine.vectorTextGpuBlurSampler;
  if (!layout || !innerLayout || !uniformBuffer || !sampler) {
    throw new Error("The GPU text-blur compositor is not initialized.");
  }
  const texture = engine.device.createTexture({
    label: `Vector text GPU blur cache ${draw.blurKey} ${draw.blurWidth}×${draw.blurHeight}`,
    size: {
      width: draw.blurWidth,
      height: draw.blurHeight,
      depthOrArrayLayers: 1,
    },
    format: VECTOR_TEXT_GPU_BLUR_FORMAT,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    const view = texture.createView({
      label: `Vector text GPU blur cache view ${draw.blurKey}`,
    });
    const compositeBindGroup = engine.device.createBindGroup({
      label: `Vector text GPU blur composite ${draw.blurKey}`,
      layout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
            offset: 0,
            size: VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
          },
        },
        { binding: 1, resource: view },
        { binding: 2, resource: sampler },
      ],
    });
    const innerShadowBindGroup = engine.device.createBindGroup({
      label: `Vector text GPU inner-shadow mask ${draw.blurKey}`,
      layout: innerLayout,
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: sampler },
      ],
    });
    const created: VectorTextGpuBlurCacheResources = {
      texture,
      view,
      compositeBindGroup,
      innerShadowBindGroup,
      width: draw.blurWidth,
      height: draw.blurHeight,
      memoryBytes: draw.blurWidth * draw.blurHeight
        * VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
      needsBuild: true,
    };
    engine.vectorTextGpuBlurCaches.set(draw.blurKey, created);
    return created;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export function ensureVectorTextGpuBlurScratch(engine: BrushEngine, width: number, height: number): void {
  const requiredWidth = Math.max(1, Math.ceil(width));
  const requiredHeight = Math.max(1, Math.ceil(height));
  if (
    engine.vectorTextGpuBlurScratchATexture
    && engine.vectorTextGpuBlurScratchAView
    && engine.vectorTextGpuBlurScratchBTexture
    && engine.vectorTextGpuBlurScratchBView
    && engine.vectorTextGpuBlurFilterBindGroupAToB
    && engine.vectorTextGpuBlurFilterBindGroupBToA
    && engine.vectorTextGpuBlurScratchWidth >= requiredWidth
    && engine.vectorTextGpuBlurScratchHeight >= requiredHeight
  ) {
    return;
  }
  releaseVectorTextGpuBlurScratch(engine);
  const layout = engine.vectorTextGpuBlurFilterBindGroupLayout;
  const uniformBuffer = engine.vectorTextGpuBlurFilterUniformBuffer;
  const sampler = engine.vectorTextGpuBlurSampler;
  if (!layout || !uniformBuffer || !sampler) {
    throw new Error("The GPU text-blur filter is not initialized.");
  }
  const textureDescriptor: GPUTextureDescriptor = {
    size: {
      width: requiredWidth,
      height: requiredHeight,
      depthOrArrayLayers: 1,
    },
    format: VECTOR_TEXT_GPU_BLUR_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC,
  };
  const textureA = engine.device.createTexture({
    ...textureDescriptor,
    label: `Vector text GPU blur scratch A ${requiredWidth}×${requiredHeight}`,
  });
  const textureB = engine.device.createTexture({
    ...textureDescriptor,
    label: `Vector text GPU blur scratch B ${requiredWidth}×${requiredHeight}`,
  });
  try {
    const viewA = textureA.createView({ label: "Vector text GPU blur scratch A view" });
    const viewB = textureB.createView({ label: "Vector text GPU blur scratch B view" });
    const uniformEntry: GPUBindGroupEntry = {
      binding: 0,
      resource: {
        buffer: uniformBuffer,
        offset: 0,
        size: VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
      },
    };
    engine.vectorTextGpuBlurFilterBindGroupAToB = engine.device.createBindGroup({
      label: "Vector text GPU blur horizontal A to B",
      layout,
      entries: [
        uniformEntry,
        { binding: 1, resource: viewA },
        { binding: 2, resource: sampler },
      ],
    });
    engine.vectorTextGpuBlurFilterBindGroupBToA = engine.device.createBindGroup({
      label: "Vector text GPU blur vertical B to A",
      layout,
      entries: [
        uniformEntry,
        { binding: 1, resource: viewB },
        { binding: 2, resource: sampler },
      ],
    });
    engine.vectorTextGpuBlurScratchATexture = textureA;
    engine.vectorTextGpuBlurScratchAView = viewA;
    engine.vectorTextGpuBlurScratchBTexture = textureB;
    engine.vectorTextGpuBlurScratchBView = viewB;
    engine.vectorTextGpuBlurScratchWidth = requiredWidth;
    engine.vectorTextGpuBlurScratchHeight = requiredHeight;
  } catch (error) {
    textureA.destroy();
    textureB.destroy();
    throw error;
  }
}

export function writeVectorTextGpuDrawUniform(engine: BrushEngine, 
  draw: VectorTextGpuDraw,
  view: VectorTextViewState,
  drawIndex: number,
  targetBounds: DirtyRect,
  targetWidth = engine.vectorTextGpuScratchWidth,
  targetHeight = engine.vectorTextGpuScratchHeight,
): void {
  const base = drawIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4;
  const upload = engine.vectorTextGpuUniformUpload;
  upload.fill(0, base, base + VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4);
  upload[base] = view.canvasWidth;
  upload[base + 1] = view.canvasHeight;
  upload[base + 2] = view.rotationCos;
  upload[base + 3] = view.rotationSin;
  upload[base + 4] = view.centerX;
  upload[base + 5] = view.centerY;
  upload[base + 6] = view.zoom;
  upload[base + 7] = vectorTextRunUsesEncodedSrgb(engine) ? 1 : 0;
  upload[base + 8] = draw.x;
  upload[base + 9] = draw.y;
  upload[base + 10] = Math.cos(draw.rotation);
  upload[base + 11] = Math.sin(draw.rotation);
  upload[base + 12] = draw.scaleX ?? draw.scale;
  upload[base + 13] = draw.localOffsetX;
  upload[base + 14] = draw.localOffsetY;
  upload[base + 15] = draw.scaleY ?? draw.scale;
  upload[base + 16] = draw.color[0];
  upload[base + 17] = draw.color[1];
  upload[base + 18] = draw.color[2];
  upload[base + 19] = draw.opacity;
  upload[base + 20] = targetBounds.x;
  upload[base + 21] = targetBounds.y;
  upload[base + 22] = targetWidth;
  upload[base + 23] = targetHeight;

  if (draw.gradient) {
    const gradient = draw.gradient;
    const unsigned = engine.vectorTextGpuUniformUploadUnsigned;
    unsigned[base + 32] = gradient.kind === "linear" ? 1 : 2;
    unsigned[base + 33] = gradient.spread === "reflect"
      ? 1
      : gradient.spread === "repeat"
        ? 2
        : 0;
    unsigned[base + 34] = Math.min(4, gradient.stops.length);
    upload[base + 36] = gradient.transform[0];
    upload[base + 37] = gradient.transform[1];
    upload[base + 38] = gradient.transform[2];
    upload[base + 39] = gradient.transform[3];
    upload[base + 40] = gradient.transform[4];
    upload[base + 41] = gradient.transform[5];
    upload[base + 44] = gradient.geometry[0];
    upload[base + 45] = gradient.geometry[1];
    upload[base + 46] = gradient.geometry[2];
    upload[base + 47] = gradient.geometry[3];
    upload[base + 48] = gradient.focal[0];
    upload[base + 49] = gradient.focal[1];
    for (let index = 0; index < Math.min(4, gradient.stops.length); index += 1) {
      const stop = gradient.stops[index];
      upload[base + 52 + index] = Math.min(1, Math.max(0, stop.offset));
      const red = Math.round(Math.min(1, Math.max(0, stop.color[0])) * 255);
      const green = Math.round(Math.min(1, Math.max(0, stop.color[1])) * 255);
      const blue = Math.round(Math.min(1, Math.max(0, stop.color[2])) * 255);
      const alpha = Math.round(Math.min(1, Math.max(0, stop.opacity)) * 255);
      unsigned[base + 56 + index] = (
        red
        | (green << 8)
        | (blue << 16)
        | (alpha << 24)
      ) >>> 0;
    }
  }

  if (vectorTextGpuDrawUsesMesh(draw)) {
    if (vectorTextGpuDrawUsesBlur(draw)) {
      upload[base + 24] = draw.blurBounds[0];
      upload[base + 25] = draw.blurBounds[1];
      upload[base + 26] = draw.blurBounds[2];
      upload[base + 27] = draw.blurBounds[3];
    }
    if (draw.mode === "mesh-inner-shadow-blur") {
      upload[base + 28] = draw.sampleOffsetX;
      upload[base + 29] = draw.sampleOffsetY;
    }
    return;
  }

  const shapeBounds = vectorTextGpuDrawUsesBlur(draw)
    ? draw.blurBounds
    : [draw.slug.left, draw.slug.top, draw.slug.right, draw.slug.bottom] as const;
  upload[base + 24] = shapeBounds[0];
  upload[base + 25] = shapeBounds[1];
  upload[base + 26] = shapeBounds[2];
  upload[base + 27] = shapeBounds[3];
  upload[base + 28] = draw.slug.bandScaleX;
  upload[base + 29] = draw.slug.bandScaleY;
  upload[base + 30] = draw.slug.bandOffsetX;
  upload[base + 31] = draw.slug.bandOffsetY;
  const unsigned = engine.vectorTextGpuUniformUploadUnsigned;
  unsigned[base + 32] = draw.slug.horizontalHeaderBase;
  unsigned[base + 33] = draw.slug.verticalHeaderBase;
  unsigned[base + 34] = draw.slug.horizontalBandCount;
  unsigned[base + 35] = draw.slug.verticalBandCount;
  unsigned[base + 36] = draw.slug.curveTexture.logWidth;
  unsigned[base + 37] = draw.slug.bandTexture.logWidth;
  if (
    draw.mode === "slug-inner-shadow-direct"
    || draw.mode === "slug-inner-shadow-blur"
  ) {
    upload[base + 40] = draw.sampleOffsetX;
    upload[base + 41] = draw.sampleOffsetY;
  }
}

type MixedSceneBlendScratchCandidate = {
  texture: GPUTexture;
  view: GPUTextureView;
  operandTexture: GPUTexture;
  operandView: GPUTextureView;
  cutoutTexture: GPUTexture;
  cutoutView: GPUTextureView;
  groupTexture: GPUTexture;
  groupView: GPUTextureView;
  clippingBaseTexture: GPUTexture;
  clippingBaseView: GPUTextureView;
  documentMaskTexture: GPUTexture;
  documentMaskView: GPUTextureView;
  deepFloorTexture: GPUTexture | null;
  deepFloorView: GPUTextureView | null;
  fromLinear: GPUBindGroup;
  fromScratch: GPUBindGroup;
  fromGroup: GPUBindGroup;
};

type MixedSceneClippingScratchCandidate = {
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  width: number;
  height: number;
};

const mixedSceneClippingScratchPrewarms = new WeakMap<BrushEngine, Promise<void>>();

function createMixedSceneBlendScratchCandidate(
  engine: BrushEngine,
  width: number,
  height: number,
  linearView: GPUTextureView,
  needsDeepFloor: boolean,
): MixedSceneBlendScratchCandidate {
  const blendLayout = engine.layerBlendCompositorBindGroupLayout;
  const blendUniformBuffer = engine.layerBlendCompositorUniformBuffer;
  if (!blendLayout || !blendUniformBuffer) {
    throw new Error("The GPU layer-blend compositor is not initialized.");
  }
  let texture: GPUTexture | null = null;
  let operandTexture: GPUTexture | null = null;
  let cutoutTexture: GPUTexture | null = null;
  let groupTexture: GPUTexture | null = null;
  let clippingBaseTexture: GPUTexture | null = null;
  let documentMaskTexture: GPUTexture | null = null;
  let deepFloorTexture: GPUTexture | null = null;
  try {
    texture = engine.device.createTexture({
      label: `Ordered layer blend ping-pong ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
    operandTexture = engine.device.createTexture({
      label: `Ordered layer blend operand ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST,
    });
    cutoutTexture = engine.device.createTexture({
      label: `Ordered layer raw matte ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    groupTexture = engine.device.createTexture({
      label: `Ordered clipping-group blend ping-pong ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC,
    });
    clippingBaseTexture = engine.device.createTexture({
      label: `Ordered clipping immutable base ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    documentMaskTexture = engine.device.createTexture({
      label: `Ordered clipping document mask ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    if (needsDeepFloor) {
      deepFloorTexture = engine.device.createTexture({
        label: `Ordered Deep floor ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: MIXED_SCENE_LINEAR_FORMAT,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_DST,
      });
    }
    const view = texture.createView({ label: "Ordered layer blend ping-pong view" });
    const operandView = operandTexture.createView({
      label: "Ordered layer blend operand view",
    });
    const cutoutView = cutoutTexture.createView({
      label: "Ordered layer raw matte view",
    });
    const groupView = groupTexture.createView({
      label: "Ordered clipping-group blend ping-pong view",
    });
    const clippingBaseView = clippingBaseTexture.createView({
      label: "Ordered clipping immutable base view",
    });
    const documentMaskView = documentMaskTexture.createView({
      label: "Ordered clipping document mask view",
    });
    const deepFloorView = deepFloorTexture?.createView({
      label: "Ordered Deep floor view",
    }) ?? null;
    const blendEntries = (backdrop: GPUTextureView): GPUBindGroupEntry[] => [
      { binding: 0, resource: backdrop },
      { binding: 1, resource: operandView },
      {
        binding: 2,
        resource: {
          buffer: blendUniformBuffer,
          offset: 0,
          size: LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
        },
      },
      { binding: 3, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 4, resource: cutoutView },
      { binding: 5, resource: clippingBaseView },
      { binding: 6, resource: documentMaskView },
      { binding: 7, resource: deepFloorView ?? engine.transparentLayerView },
    ];
    return {
      texture,
      view,
      operandTexture,
      operandView,
      cutoutTexture,
      cutoutView,
      groupTexture,
      groupView,
      clippingBaseTexture,
      clippingBaseView,
      documentMaskTexture,
      documentMaskView,
      deepFloorTexture,
      deepFloorView,
      fromLinear: engine.device.createBindGroup({
        label: "Layer blend canonical→ping-pong bind group",
        layout: blendLayout,
        entries: blendEntries(linearView),
      }),
      fromScratch: engine.device.createBindGroup({
        label: "Layer blend ping-pong→canonical bind group",
        layout: blendLayout,
        entries: blendEntries(view),
      }),
      fromGroup: engine.device.createBindGroup({
        label: "Clipping-group blend ping-pong bind group",
        layout: blendLayout,
        entries: blendEntries(groupView),
      }),
    };
  } catch (error) {
    texture?.destroy();
    operandTexture?.destroy();
    cutoutTexture?.destroy();
    groupTexture?.destroy();
    clippingBaseTexture?.destroy();
    documentMaskTexture?.destroy();
    deepFloorTexture?.destroy();
    throw error;
  }
}

function publishMixedSceneBlendScratchCandidate(
  engine: BrushEngine,
  candidate: MixedSceneBlendScratchCandidate | null,
): void {
  engine.mixedSceneBlendScratchTexture = candidate?.texture ?? null;
  engine.mixedSceneBlendScratchView = candidate?.view ?? null;
  engine.mixedSceneBlendOperandTexture = candidate?.operandTexture ?? null;
  engine.mixedSceneBlendOperandView = candidate?.operandView ?? null;
  engine.mixedSceneBlendCutoutTexture = candidate?.cutoutTexture ?? null;
  engine.mixedSceneBlendCutoutView = candidate?.cutoutView ?? null;
  engine.mixedSceneBlendGroupTexture = candidate?.groupTexture ?? null;
  engine.mixedSceneBlendGroupView = candidate?.groupView ?? null;
  engine.mixedSceneBlendClippingBaseTexture = candidate?.clippingBaseTexture ?? null;
  engine.mixedSceneBlendClippingBaseView = candidate?.clippingBaseView ?? null;
  engine.mixedSceneBlendDocumentMaskTexture = candidate?.documentMaskTexture ?? null;
  engine.mixedSceneBlendDocumentMaskView = candidate?.documentMaskView ?? null;
  engine.mixedSceneBlendDeepFloorTexture = candidate?.deepFloorTexture ?? null;
  engine.mixedSceneBlendDeepFloorView = candidate?.deepFloorView ?? null;
  engine.mixedSceneBlendFromLinearBindGroup = candidate?.fromLinear ?? null;
  engine.mixedSceneBlendFromScratchBindGroup = candidate?.fromScratch ?? null;
  engine.mixedSceneBlendFromGroupBindGroup = candidate?.fromGroup ?? null;
}

function releaseMixedSceneBlendScratchResources(engine: BrushEngine): void {
  const texture = engine.mixedSceneBlendScratchTexture;
  const operand = engine.mixedSceneBlendOperandTexture;
  const cutout = engine.mixedSceneBlendCutoutTexture;
  const group = engine.mixedSceneBlendGroupTexture;
  const clippingBase = engine.mixedSceneBlendClippingBaseTexture;
  const documentMask = engine.mixedSceneBlendDocumentMaskTexture;
  const deepFloor = engine.mixedSceneBlendDeepFloorTexture;
  publishMixedSceneBlendScratchCandidate(engine, null);
  texture?.destroy();
  operand?.destroy();
  cutout?.destroy();
  group?.destroy();
  clippingBase?.destroy();
  documentMask?.destroy();
  deepFloor?.destroy();
}

/** Releases viewport blend targets after a successful transition off that path. */
export function releaseUnusedMixedSceneBlendScratch(engine: BrushEngine): void {
  const stillRequired = !engine.usesLayerBlendTilePresentation()
    && engine.layerStack.layers.some(rasterLayerNeedsBackdropComposition);
  if (!stillRequired) {
    releaseMixedSceneBlendScratchResources(engine);
  }
}

/**
 * Validates every viewport-sized resource needed by a candidate blend mode
 * before its metadata/history entry is published. Restore can supply the
 * candidate Deep-floor requirement before saved records become live. Existing
 * resources stay authoritative until both WebGPU error scopes confirm the
 * replacement.
 */
export async function prewarmMixedSceneLinearTextureForLayerBlend(
  engine: BrushEngine,
  width: number,
  height: number,
  needsAdvancedBlend: boolean,
  candidateNeedsDeepFloor?: boolean,
): Promise<void> {
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout) {
    throw new Error("The mixed-scene presentation layout is not initialized.");
  }
  const needsDeepFloor = candidateNeedsDeepFloor ?? engine.layerStack.layers.some(
    (record) => record.cutoutMode === "document",
  );
  const sameLinearTexture = Boolean(
    engine.mixedSceneLinearTexture
      && engine.mixedSceneLinearView
      && engine.mixedSceneLinearWidth === width
      && engine.mixedSceneLinearHeight === height,
  );
  const scratchReady = Boolean(
    engine.mixedSceneBlendScratchTexture
      && engine.mixedSceneBlendScratchView
      && engine.mixedSceneBlendOperandTexture
      && engine.mixedSceneBlendOperandView
      && engine.mixedSceneBlendCutoutTexture
      && engine.mixedSceneBlendCutoutView
      && engine.mixedSceneBlendGroupTexture
      && engine.mixedSceneBlendGroupView
      && engine.mixedSceneBlendClippingBaseTexture
      && engine.mixedSceneBlendClippingBaseView
      && engine.mixedSceneBlendDocumentMaskTexture
      && engine.mixedSceneBlendDocumentMaskView
      && (!needsDeepFloor || (
        engine.mixedSceneBlendDeepFloorTexture
        && engine.mixedSceneBlendDeepFloorView
      ))
      && engine.mixedSceneBlendFromLinearBindGroup
      && engine.mixedSceneBlendFromScratchBindGroup
      && engine.mixedSceneBlendFromGroupBindGroup,
  );
  if (sameLinearTexture && (!needsAdvancedBlend || scratchReady)) {
    return;
  }

  const candidate = await runGpuAllocationTransaction(
    engine.device,
    `Layer-blend prewarm ${width}×${height}`,
    (transaction) => {
      if (sameLinearTexture) {
        const scratch = createMixedSceneBlendScratchCandidate(
          engine,
          width,
          height,
          engine.mixedSceneLinearView!,
          needsDeepFloor,
        );
        transaction.deferRollback(() => {
          scratch.texture.destroy();
          scratch.operandTexture.destroy();
          scratch.cutoutTexture.destroy();
          scratch.groupTexture.destroy();
          scratch.clippingBaseTexture.destroy();
          scratch.documentMaskTexture.destroy();
          scratch.deepFloorTexture?.destroy();
        });
        return { kind: "scratch" as const, scratch };
      }

      const texture = engine.device.createTexture({
        label: `Ordered mixed scene linear cache ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: MIXED_SCENE_LINEAR_FORMAT,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC,
      });
      transaction.deferRollback(() => texture.destroy());
      const view = texture.createView({ label: "Ordered mixed scene linear cache view" });
      const bindGroup = engine.device.createBindGroup({
        label: "Ordered mixed scene checker presentation bind group",
        layout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: view },
        ],
      });
      const scratch = needsAdvancedBlend
        ? createMixedSceneBlendScratchCandidate(
          engine,
          width,
          height,
          view,
          needsDeepFloor,
        )
        : null;
      if (scratch) {
        transaction.deferRollback(() => {
          scratch.texture.destroy();
          scratch.operandTexture.destroy();
          scratch.cutoutTexture.destroy();
          scratch.groupTexture.destroy();
          scratch.clippingBaseTexture.destroy();
          scratch.documentMaskTexture.destroy();
          scratch.deepFloorTexture?.destroy();
        });
      }

      return {
        kind: "linear" as const,
        texture,
        view,
        bindGroup,
        scratch,
      };
    },
  );

  const oldScratch = engine.mixedSceneBlendScratchTexture;
  const oldOperand = engine.mixedSceneBlendOperandTexture;
  const oldCutout = engine.mixedSceneBlendCutoutTexture;
  const oldGroup = engine.mixedSceneBlendGroupTexture;
  const oldClippingBase = engine.mixedSceneBlendClippingBaseTexture;
  const oldDocumentMask = engine.mixedSceneBlendDocumentMaskTexture;
  const oldDeepFloor = engine.mixedSceneBlendDeepFloorTexture;
  if (candidate.kind === "scratch") {
    publishMixedSceneBlendScratchCandidate(engine, candidate.scratch);
    oldScratch?.destroy();
    oldOperand?.destroy();
    oldCutout?.destroy();
    oldGroup?.destroy();
    oldClippingBase?.destroy();
    oldDocumentMask?.destroy();
    oldDeepFloor?.destroy();
    engine.presentationCacheNeedsFullRebuild = true;
    return;
  }

  const oldTexture = engine.mixedSceneLinearTexture;
  engine.mixedSceneLinearTexture = candidate.texture;
  engine.mixedSceneLinearView = candidate.view;
  engine.mixedSceneLinearWidth = width;
  engine.mixedSceneLinearHeight = height;
  engine.mixedScenePresentBindGroup = candidate.bindGroup;
  publishMixedSceneBlendScratchCandidate(engine, candidate.scratch);
  oldTexture?.destroy();
  oldScratch?.destroy();
  oldOperand?.destroy();
  oldCutout?.destroy();
  oldGroup?.destroy();
  oldClippingBase?.destroy();
  oldDocumentMask?.destroy();
  oldDeepFloor?.destroy();
  engine.presentationCacheNeedsFullRebuild = true;
}

function releaseMixedSceneClippingScratch(engine: BrushEngine): void {
  engine.mixedSceneClippingScratchTexture?.destroy();
  engine.mixedSceneClippingScratchTexture = null;
  engine.mixedSceneClippingScratchView = null;
  engine.mixedSceneClippingScratchBindGroup = null;
  engine.mixedSceneClippingScratchWidth = 0;
  engine.mixedSceneClippingScratchHeight = 0;
}

function mixedSceneClippingScratchNeeded(
  engine: BrushEngine,
  forceNeeded: boolean,
): boolean {
  return forceNeeded
    || engine.mixedSceneStack?.hasHeterogeneousClipping === true
    || mixedSceneRasterTransformPreviewHasSegmentedClipping(engine);
}

/** Releases the viewport clipping target after its last structural user commits. */
export function releaseUnusedMixedSceneClippingScratch(engine: BrushEngine): void {
  if (!mixedSceneClippingScratchNeeded(engine, false)) {
    releaseMixedSceneClippingScratch(engine);
  }
}

function mixedSceneClippingScratchReady(
  engine: BrushEngine,
  width: number,
  height: number,
): boolean {
  return Boolean(
    engine.mixedSceneClippingScratchTexture
      && engine.mixedSceneClippingScratchView
      && engine.mixedSceneClippingScratchBindGroup
      && engine.mixedSceneClippingScratchWidth === width
      && engine.mixedSceneClippingScratchHeight === height,
  );
}

function createMixedSceneClippingScratchCandidate(
  engine: BrushEngine,
  width: number,
  height: number,
): MixedSceneClippingScratchCandidate {
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout || !engine.mixedSceneClippingScratchCompositePipeline) {
    throw new Error("The mixed-scene clipping compositor is not initialized.");
  }
  const texture = engine.device.createTexture({
    label: `Mixed scene clipping scratch ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: MIXED_SCENE_LINEAR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    const view = texture.createView({ label: "Mixed scene clipping scratch view" });
    const bindGroup = engine.device.createBindGroup({
      label: "Mixed scene clipping scratch source bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: view },
      ],
    });
    return { texture, view, bindGroup, width, height };
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

function publishMixedSceneClippingScratchCandidate(
  engine: BrushEngine,
  candidate: MixedSceneClippingScratchCandidate,
): void {
  const previousTexture = engine.mixedSceneClippingScratchTexture;
  engine.mixedSceneClippingScratchTexture = candidate.texture;
  engine.mixedSceneClippingScratchView = candidate.view;
  engine.mixedSceneClippingScratchBindGroup = candidate.bindGroup;
  engine.mixedSceneClippingScratchWidth = candidate.width;
  engine.mixedSceneClippingScratchHeight = candidate.height;
  previousTexture?.destroy();
  engine.presentationCacheNeedsFullRebuild = true;
}

function ensureMixedSceneClippingScratch(
  engine: BrushEngine,
  width: number,
  height: number,
  forceNeeded = false,
): void {
  if (!mixedSceneClippingScratchNeeded(engine, forceNeeded)) {
    releaseMixedSceneClippingScratch(engine);
    return;
  }
  if (mixedSceneClippingScratchReady(engine, width, height)) {
    return;
  }
  publishMixedSceneClippingScratchCandidate(
    engine,
    createMixedSceneClippingScratchCandidate(engine, width, height),
  );
}

/**
 * Validates a prospective clipping target under WebGPU error scopes before it
 * can become reachable from preview, restore, or structural scene state.
 */
export async function prewarmMixedSceneClippingScratch(
  engine: BrushEngine,
  width: number,
  height: number,
  forceNeeded = false,
): Promise<void> {
  if (!mixedSceneClippingScratchNeeded(engine, forceNeeded)) {
    return;
  }
  if (mixedSceneClippingScratchReady(engine, width, height)) {
    return;
  }
  const existing = mixedSceneClippingScratchPrewarms.get(engine);
  if (existing) {
    await existing;
    await prewarmMixedSceneClippingScratch(engine, width, height, forceNeeded);
    return;
  }
  const initialization = (async (): Promise<void> => {
    const candidate = await runGpuAllocationTransaction(
      engine.device,
      `Mixed-scene clipping prewarm ${width}×${height}`,
      (transaction) => {
        const created = createMixedSceneClippingScratchCandidate(engine, width, height);
        transaction.deferRollback(() => created.texture.destroy());
        return created;
      },
    );
    publishMixedSceneClippingScratchCandidate(engine, candidate);
  })();
  mixedSceneClippingScratchPrewarms.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (mixedSceneClippingScratchPrewarms.get(engine) === initialization) {
      mixedSceneClippingScratchPrewarms.delete(engine);
    }
  }
}

/**
 * Allocates the viewport-sized targets for a prospective raster Transform
 * preview without depending on preview state already being published.
 */
export async function prewarmMixedSceneRasterTransformPreviewLinearResources(
  engine: BrushEngine,
  width: number,
  height: number,
  needsAdvancedBlend: boolean,
  needsSegmentedClipping: boolean,
): Promise<void> {
  await prewarmMixedSceneLinearTextureForLayerBlend(
    engine,
    width,
    height,
    needsAdvancedBlend,
  );
  await prewarmMixedSceneClippingScratch(
    engine,
    width,
    height,
    needsSegmentedClipping,
  );
}

export function ensureMixedSceneLinearTexture(engine: BrushEngine, width: number, height: number): void {
  if (!engine.usesOrderedScenePresentation()) {
    engine.mixedSceneLinearTexture?.destroy();
    releaseMixedSceneTextEncodedCompositeScratch(engine);
    releaseMixedSceneBlendScratchResources(engine);
    releaseMixedSceneClippingScratch(engine);
    engine.mixedSceneLinearTexture = null;
    engine.mixedSceneLinearView = null;
    engine.mixedSceneLinearWidth = 0;
    engine.mixedSceneLinearHeight = 0;
    engine.mixedScenePresentBindGroup = null;
    return;
  }
  ensureMixedSceneClippingScratch(engine, width, height);
  const needsAdvancedBlend = !engine.usesLayerBlendTilePresentation()
    && engine.layerStack.layers.some(rasterLayerNeedsBackdropComposition);
  const needsDeepFloor = engine.layerStack.layers.some(
    (record) => record.cutoutMode === "document",
  );
  const blendScratchReady = !needsAdvancedBlend || Boolean(
    engine.mixedSceneBlendScratchTexture
      && engine.mixedSceneBlendScratchView
      && engine.mixedSceneBlendOperandTexture
      && engine.mixedSceneBlendOperandView
      && engine.mixedSceneBlendCutoutTexture
      && engine.mixedSceneBlendCutoutView
      && engine.mixedSceneBlendGroupTexture
      && engine.mixedSceneBlendGroupView
      && engine.mixedSceneBlendClippingBaseTexture
      && engine.mixedSceneBlendClippingBaseView
      && engine.mixedSceneBlendDocumentMaskTexture
      && engine.mixedSceneBlendDocumentMaskView
      && (!needsDeepFloor || (
        engine.mixedSceneBlendDeepFloorTexture
        && engine.mixedSceneBlendDeepFloorView
      ))
      && engine.mixedSceneBlendFromLinearBindGroup
      && engine.mixedSceneBlendFromScratchBindGroup
      && engine.mixedSceneBlendFromGroupBindGroup,
  );
  if (
    engine.mixedSceneLinearTexture
    && engine.mixedSceneLinearView
    && engine.mixedSceneLinearWidth === width
    && engine.mixedSceneLinearHeight === height
    && blendScratchReady
  ) {
    if (!needsAdvancedBlend) {
      releaseMixedSceneBlendScratchResources(engine);
    }
    return;
  }
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout) {
    throw new Error("The mixed-scene presentation layout is not initialized.");
  }
  const oldTexture = engine.mixedSceneLinearTexture;
  const oldBlendScratch = engine.mixedSceneBlendScratchTexture;
  const oldBlendOperand = engine.mixedSceneBlendOperandTexture;
  const oldBlendCutout = engine.mixedSceneBlendCutoutTexture;
  const oldBlendGroup = engine.mixedSceneBlendGroupTexture;
  const oldBlendClippingBase = engine.mixedSceneBlendClippingBaseTexture;
  const oldBlendDocumentMask = engine.mixedSceneBlendDocumentMaskTexture;
  const oldBlendDeepFloor = engine.mixedSceneBlendDeepFloorTexture;
  const texture = engine.device.createTexture({
    label: `Ordered mixed scene linear cache ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: MIXED_SCENE_LINEAR_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.COPY_SRC,
  });
  let blendScratch: GPUTexture | null = null;
  let blendOperand: GPUTexture | null = null;
  let blendCutout: GPUTexture | null = null;
  let blendGroup: GPUTexture | null = null;
  let blendClippingBase: GPUTexture | null = null;
  let blendDocumentMask: GPUTexture | null = null;
  let blendDeepFloor: GPUTexture | null = null;
  try {
    const view = texture.createView({ label: "Ordered mixed scene linear cache view" });
    const bindGroup = engine.device.createBindGroup({
      label: "Ordered mixed scene checker presentation bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: view },
      ],
    });
    let blendScratchView: GPUTextureView | null = null;
    let blendOperandView: GPUTextureView | null = null;
    let blendCutoutView: GPUTextureView | null = null;
    let blendGroupView: GPUTextureView | null = null;
    let blendClippingBaseView: GPUTextureView | null = null;
    let blendDocumentMaskView: GPUTextureView | null = null;
    let blendDeepFloorView: GPUTextureView | null = null;
    let fromLinear: GPUBindGroup | null = null;
    let fromScratch: GPUBindGroup | null = null;
    let fromGroup: GPUBindGroup | null = null;
    if (needsAdvancedBlend) {
      const scratch = createMixedSceneBlendScratchCandidate(
        engine,
        width,
        height,
        view,
        needsDeepFloor,
      );
      blendScratch = scratch.texture;
      blendScratchView = scratch.view;
      blendOperand = scratch.operandTexture;
      blendOperandView = scratch.operandView;
      blendCutout = scratch.cutoutTexture;
      blendCutoutView = scratch.cutoutView;
      blendGroup = scratch.groupTexture;
      blendGroupView = scratch.groupView;
      blendClippingBase = scratch.clippingBaseTexture;
      blendClippingBaseView = scratch.clippingBaseView;
      blendDocumentMask = scratch.documentMaskTexture;
      blendDocumentMaskView = scratch.documentMaskView;
      blendDeepFloor = scratch.deepFloorTexture;
      blendDeepFloorView = scratch.deepFloorView;
      fromLinear = scratch.fromLinear;
      fromScratch = scratch.fromScratch;
      fromGroup = scratch.fromGroup;
    }
    engine.mixedSceneLinearTexture = texture;
    engine.mixedSceneLinearView = view;
    engine.mixedSceneLinearWidth = width;
    engine.mixedSceneLinearHeight = height;
    engine.mixedScenePresentBindGroup = bindGroup;
    engine.mixedSceneBlendScratchTexture = blendScratch;
    engine.mixedSceneBlendScratchView = blendScratchView;
    engine.mixedSceneBlendOperandTexture = blendOperand;
    engine.mixedSceneBlendOperandView = blendOperandView;
    engine.mixedSceneBlendCutoutTexture = blendCutout;
    engine.mixedSceneBlendCutoutView = blendCutoutView;
    engine.mixedSceneBlendGroupTexture = blendGroup;
    engine.mixedSceneBlendGroupView = blendGroupView;
    engine.mixedSceneBlendClippingBaseTexture = blendClippingBase;
    engine.mixedSceneBlendClippingBaseView = blendClippingBaseView;
    engine.mixedSceneBlendDocumentMaskTexture = blendDocumentMask;
    engine.mixedSceneBlendDocumentMaskView = blendDocumentMaskView;
    engine.mixedSceneBlendDeepFloorTexture = blendDeepFloor;
    engine.mixedSceneBlendDeepFloorView = blendDeepFloorView;
    engine.mixedSceneBlendFromLinearBindGroup = fromLinear;
    engine.mixedSceneBlendFromScratchBindGroup = fromScratch;
    engine.mixedSceneBlendFromGroupBindGroup = fromGroup;
    engine.presentationCacheNeedsFullRebuild = true;
    oldTexture?.destroy();
    oldBlendScratch?.destroy();
    oldBlendOperand?.destroy();
    oldBlendCutout?.destroy();
    oldBlendGroup?.destroy();
    oldBlendClippingBase?.destroy();
    oldBlendDocumentMask?.destroy();
    oldBlendDeepFloor?.destroy();
  } catch (error) {
    texture.destroy();
    blendScratch?.destroy();
    blendOperand?.destroy();
    blendCutout?.destroy();
    blendGroup?.destroy();
    blendClippingBase?.destroy();
    blendDocumentMask?.destroy();
    blendDeepFloor?.destroy();
    throw error;
  }
}

export function rebuildVectorTextDependentDisplayBindGroups(engine: BrushEngine): void {
  const belowView = engine.vectorTextBelowView ?? engine.transparentLayerView;
  const aboveView = engine.vectorTextAboveView ?? engine.transparentLayerView;
  engine.rasterStrokeDisplayScreenBindGroup = engine.device.createBindGroup({
    label: "Stroke display screen + semantic text bind group",
    layout: engine.rasterStrokeDisplayScreenBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: belowView },
      { binding: 2, resource: aboveView },
    ],
  });
  if (engine.thicknessTailView) {
    engine.thicknessTailDisplayBindGroup = engine.device.createBindGroup({
      label: "Predictive thickness tail mixed-scene display bind group",
      layout: engine.thicknessTailDisplayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: engine.layerView },
        { binding: 2, resource: engine.sampler },
        { binding: 3, resource: engine.thicknessTailView },
        { binding: 4, resource: { buffer: engine.thicknessTailDisplayUniformBuffer } },
        { binding: 5, resource: engine.activeLayerDisplayPyramid.samplingView },
        { binding: 6, resource: engine.mergedBelowView() },
        { binding: 7, resource: engine.mergedAboveView() },
        { binding: 8, resource: belowView },
        { binding: 9, resource: aboveView },
        { binding: 10, resource: engine.activeClippingPrefixView() },
        { binding: 11, resource: engine.activeClippingSuffixView() },
      ],
    });
    engine.thicknessTailMipBindGroup = engine.device.createBindGroup({
      label: "Document-aligned live Paint mip bind group",
      layout: engine.thicknessTailMipBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: engine.layerView },
        { binding: 3, resource: engine.thicknessTailView },
        { binding: 4, resource: { buffer: engine.thicknessTailDisplayUniformBuffer } },
        { binding: 6, resource: engine.mergedBelowView() },
        { binding: 7, resource: engine.mergedAboveView() },
        { binding: 10, resource: engine.activeClippingPrefixView() },
        { binding: 11, resource: engine.activeClippingSuffixView() },
      ],
    });
  }
  if (engine.lightGlazeView && engine.lightGlazeSamplingView) {
    engine.lightGlazeDisplayBindGroup = engine.device.createBindGroup({
      label: "Light Glaze mixed-scene live display bind group",
      layout: engine.lightGlazeDisplayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: engine.layerView },
        { binding: 2, resource: engine.lightGlazeView },
        { binding: 3, resource: engine.sampler },
        { binding: 4, resource: { buffer: engine.lightGlazeUniformBuffer } },
        { binding: 5, resource: engine.lightGlazeSamplingView },
        { binding: 6, resource: engine.mergedBelowView() },
        { binding: 7, resource: engine.mergedAboveView() },
        { binding: 8, resource: belowView },
        { binding: 9, resource: aboveView },
        { binding: 10, resource: engine.activeClippingPrefixView() },
        { binding: 11, resource: engine.activeClippingSuffixView() },
      ],
    });
  }
}

export function writeVectorTextGpuBlurSourceUniform(engine: BrushEngine, 
  draw: VectorTextGpuBlurSourceDraw,
  drawIndex: number,
): void {
  const base = drawIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4;
  const upload = engine.vectorTextGpuUniformUpload;
  const usesMesh = vectorTextGpuDrawUsesMesh(draw);
  // Slug coverage is evaluated in coordinates relative to its packing origin.
  // The source pass still centers the target on the absolute blur ROI below.
  const sourceBounds = usesMesh
    ? draw.blurBounds
    : [
      draw.blurBounds[0] - draw.slug.originX,
      draw.blurBounds[1] - draw.slug.originY,
      draw.blurBounds[2] - draw.slug.originX,
      draw.blurBounds[3] - draw.slug.originY,
    ] as const;
  upload.fill(0, base, base + VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4);
  upload[base] = draw.blurWidth;
  upload[base + 1] = draw.blurHeight;
  upload[base + 2] = 1;
  upload[base + 4] = (draw.blurBounds[0] + draw.blurBounds[2]) * 0.5;
  upload[base + 5] = (draw.blurBounds[1] + draw.blurBounds[3]) * 0.5;
  upload[base + 6] = draw.blurScale;
  upload[base + 10] = 1;
  upload[base + 12] = 1;
  upload[base + 15] = 1;
  upload[base + 16] = 1;
  upload[base + 17] = 1;
  upload[base + 18] = 1;
  upload[base + 19] = 1;
  upload[base + 22] = draw.blurWidth;
  upload[base + 23] = draw.blurHeight;
  upload[base + 24] = sourceBounds[0];
  upload[base + 25] = sourceBounds[1];
  upload[base + 26] = sourceBounds[2];
  upload[base + 27] = sourceBounds[3];
  if (usesMesh) {
    upload[base + 13] = draw.mesh.originX;
    upload[base + 14] = draw.mesh.originY;
    return;
  }
  upload[base + 13] = draw.slug.originX;
  upload[base + 14] = draw.slug.originY;
  upload[base + 28] = draw.slug.bandScaleX;
  upload[base + 29] = draw.slug.bandScaleY;
  upload[base + 30] = draw.slug.bandOffsetX;
  upload[base + 31] = draw.slug.bandOffsetY;
  const unsigned = engine.vectorTextGpuUniformUploadUnsigned;
  unsigned[base + 32] = draw.slug.horizontalHeaderBase;
  unsigned[base + 33] = draw.slug.verticalHeaderBase;
  unsigned[base + 34] = draw.slug.horizontalBandCount;
  unsigned[base + 35] = draw.slug.verticalBandCount;
  unsigned[base + 36] = draw.slug.curveTexture.logWidth;
  unsigned[base + 37] = draw.slug.bandTexture.logWidth;
}

export function createMixedSceneRasterSegmentResources(engine: BrushEngine, 
  key: MixedSceneRasterRunKey,
  surface: MergedSurfaceResources,
  opacity = 1,
  cutoutSurface: MergedSurfaceResources | null = null,
  documentCutoutBaseSurface: MergedSurfaceResources | null = null,
  documentCutoutMaskSurface: MergedSurfaceResources | null = null,
  documentCutoutOpacity = 1,
  rasterLayerId: number | null = null,
): MixedSceneRasterSegmentResources {
  const layout = engine.mixedSceneRasterSegmentBindGroupLayout;
  if (!layout) {
    throw new Error("The raster/text compositor layout is not initialized.");
  }
  const uniformBuffer = engine.device.createBuffer({
    label: `Mixed scene raster segment ${key} uniforms`,
    size: MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let documentCutoutBaseUniformBuffer: GPUBuffer | null = null;
  let documentCutoutMaskUniformBuffer: GPUBuffer | null = null;
  try {
    engine.device.queue.writeBuffer(
      uniformBuffer,
      0,
      mixedSceneRasterSegmentUniformValues(surface, opacity),
    );
    const bindGroup = engine.device.createBindGroup({
      label: `Mixed scene raster segment ${key} bind group`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: { buffer: uniformBuffer } },
        { binding: 2, resource: surface.samplingView },
        { binding: 3, resource: engine.sampler },
      ],
    });
    const cutoutBindGroup = cutoutSurface
      ? engine.device.createBindGroup({
        label: `Mixed scene raster segment ${key} cutout bind group`,
        layout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: { buffer: uniformBuffer } },
          { binding: 2, resource: cutoutSurface.samplingView },
          { binding: 3, resource: engine.sampler },
        ],
      })
      : null;
    const auxiliaryResources = (
      auxiliary: MergedSurfaceResources | null,
      suffix: string,
    ): { uniformBuffer: GPUBuffer; bindGroup: GPUBindGroup } | null => {
      if (!auxiliary) {
        return null;
      }
      const auxiliaryUniformBuffer = engine.device.createBuffer({
        label: `Mixed scene raster segment ${key} ${suffix} uniforms`,
        size: MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      try {
        engine.device.queue.writeBuffer(
          auxiliaryUniformBuffer,
          0,
          mixedSceneRasterSegmentUniformValues(auxiliary, 1),
        );
        const bindGroup = engine.device.createBindGroup({
          label: `Mixed scene raster segment ${key} ${suffix} bind group`,
          layout,
          entries: [
            { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
            { binding: 1, resource: { buffer: auxiliaryUniformBuffer } },
            { binding: 2, resource: auxiliary.samplingView },
            { binding: 3, resource: engine.sampler },
          ],
        });
        return { uniformBuffer: auxiliaryUniformBuffer, bindGroup };
      } catch (error) {
        auxiliaryUniformBuffer.destroy();
        throw error;
      }
    };
    const documentCutoutBaseResources = auxiliaryResources(
      documentCutoutBaseSurface,
      "document cutout base",
    );
    documentCutoutBaseUniformBuffer = documentCutoutBaseResources?.uniformBuffer ?? null;
    const documentCutoutBaseBindGroup = documentCutoutBaseResources?.bindGroup ?? null;
    const documentCutoutMaskResources = auxiliaryResources(
      documentCutoutMaskSurface,
      "document cutout mask",
    );
    documentCutoutMaskUniformBuffer = documentCutoutMaskResources?.uniformBuffer ?? null;
    const documentCutoutMaskBindGroup = documentCutoutMaskResources?.bindGroup ?? null;
    return {
      key,
      rasterLayerId,
      opacity: Math.min(1, Math.max(0, opacity)),
      surface,
      cutoutSurface,
      documentCutoutBaseSurface,
      documentCutoutMaskSurface,
      documentCutoutOpacity: Math.min(1, Math.max(0, documentCutoutOpacity)),
      uniformBuffer,
      bindGroup,
      cutoutBindGroup,
      documentCutoutBaseUniformBuffer,
      documentCutoutBaseBindGroup,
      documentCutoutMaskUniformBuffer,
      documentCutoutMaskBindGroup,
    };
  } catch (error) {
    documentCutoutBaseUniformBuffer?.destroy();
    documentCutoutMaskUniformBuffer?.destroy();
    uniformBuffer.destroy();
    throw error;
  }
}

export function ensureVectorTextGpuScratch(engine: BrushEngine, width: number, height: number): void {
  const requiredWidth = Math.max(1, Math.ceil(width));
  const requiredHeight = Math.max(1, Math.ceil(height));
  const currentWidth = engine.vectorTextGpuScratchWidth;
  const currentHeight = engine.vectorTextGpuScratchHeight;
  const resourcesReady = Boolean(
    engine.vectorTextGpuMsaaTexture
    && engine.vectorTextGpuMsaaView
    && engine.vectorTextGpuResolvedTexture
    && engine.vectorTextGpuResolvedView,
  );
  if (
    resourcesReady
    && currentWidth >= requiredWidth
    && currentHeight >= requiredHeight
  ) {
    return;
  }
  const maximumDimension = Math.max(
    1,
    Math.floor(engine.device.limits.maxTextureDimension2D),
  );
  const maximumWidth = Math.max(
    1,
    Math.min(Math.floor(engine.canvas.width), maximumDimension),
  );
  const maximumHeight = Math.max(
    1,
    Math.min(Math.floor(engine.canvas.height), maximumDimension),
  );
  const allocationWidth = growVectorTextGpuCacheAxisCapacity(
    currentWidth,
    requiredWidth,
    maximumWidth,
  );
  const allocationHeight = growVectorTextGpuCacheAxisCapacity(
    currentHeight,
    requiredHeight,
    maximumHeight,
  );

  let nextMsaaTexture: GPUTexture | null = null;
  let nextResolvedTexture: GPUTexture | null = null;
  let nextMsaaView: GPUTextureView;
  let nextResolvedView: GPUTextureView;
  try {
    nextMsaaTexture = engine.device.createTexture({
      label: `Vector text shared MSAA4 color ${allocationWidth}×${allocationHeight}`,
      size: { width: allocationWidth, height: allocationHeight, depthOrArrayLayers: 1 },
      sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT,
      format: VECTOR_TEXT_GPU_TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    nextMsaaView = nextMsaaTexture.createView({
      label: "Vector text shared MSAA4 color view",
    });
    nextResolvedTexture = engine.device.createTexture({
      label: `Vector text shared resolved crop ${allocationWidth}×${allocationHeight}`,
      size: { width: allocationWidth, height: allocationHeight, depthOrArrayLayers: 1 },
      format: VECTOR_TEXT_GPU_TARGET_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.COPY_SRC,
    });
    nextResolvedView = nextResolvedTexture.createView({
      label: "Vector text shared resolved crop view",
    });
  } catch (error) {
    nextMsaaTexture?.destroy();
    nextResolvedTexture?.destroy();
    throw error;
  }

  const previousMsaaTexture = engine.vectorTextGpuMsaaTexture;
  const previousResolvedTexture = engine.vectorTextGpuResolvedTexture;
  engine.vectorTextGpuMsaaTexture = nextMsaaTexture;
  engine.vectorTextGpuMsaaView = nextMsaaView;
  engine.vectorTextGpuResolvedTexture = nextResolvedTexture;
  engine.vectorTextGpuResolvedView = nextResolvedView;
  engine.vectorTextGpuScratchWidth = allocationWidth;
  engine.vectorTextGpuScratchHeight = allocationHeight;
  previousMsaaTexture?.destroy();
  previousResolvedTexture?.destroy();
}

function ensureVectorTextGpuQualityScratch(engine: BrushEngine): void {
  const mipLevelCount = Math.log2(VECTOR_TEXT_GPU_QUALITY_MAX_SCALE) + 1;
  if (
    engine.vectorTextGpuQualityTexture
    && engine.vectorTextGpuQualityMipViews.length === mipLevelCount
    && engine.vectorTextGpuQualityDownsampleBindGroups.length === mipLevelCount - 1
  ) {
    return;
  }
  const layout = engine.rasterImageMipmapBindGroupLayout;
  const pipeline = engine.rasterImageMipmapPipeline;
  if (!layout || !pipeline) {
    throw new Error("The exact-area vector coverage reducer is not ready.");
  }
  const dimension = VECTOR_TEXT_GPU_QUALITY_TILE_SIZE * VECTOR_TEXT_GPU_QUALITY_SCALE;
  const texture = engine.device.createTexture({
    label: `Vector coverage scratch ${dimension}×${dimension}`,
    size: { width: dimension, height: dimension, depthOrArrayLayers: 1 },
    mipLevelCount,
    format: VECTOR_TEXT_GPU_TARGET_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC,
  });
  try {
    const mipViews = Array.from({ length: mipLevelCount }, (_, mipLevel) => texture.createView({
      label: `Vector coverage scratch mip ${mipLevel}`,
      baseMipLevel: mipLevel,
      mipLevelCount: 1,
    }));
    const downsampleBindGroups = Array.from(
      { length: mipLevelCount - 1 },
      (_, sourceMip) =>
      engine.device.createBindGroup({
        label: `Vector coverage exact-area ${sourceMip}→${sourceMip + 1}`,
        layout,
        entries: [{ binding: 0, resource: mipViews[sourceMip] }],
      }),
    );
    const previous = engine.vectorTextGpuQualityTexture;
    engine.vectorTextGpuQualityTexture = texture;
    engine.vectorTextGpuQualityMipViews = mipViews;
    engine.vectorTextGpuQualityDownsampleBindGroups = downsampleBindGroups;
    previous?.destroy();
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export function ensureVectorTextGpuResource(engine: BrushEngine, 
  draw: VectorTextGpuDraw,
): VectorTextGpuDrawResources {
  const usesMesh = vectorTextGpuDrawUsesMesh(draw);
  const revision = usesMesh ? draw.mesh.revision : draw.slug.revision;
  const resourceKey = vectorTextGpuResourceKey(
    draw,
    engine.vectorGpuResourceSharingEnabled,
  );
  engine.vectorGeometryGpuCacheLookupCount += 1;
  const existing = engine.vectorTextGpuMeshes.get(resourceKey);
  if (
    existing
    && existing.revision === revision
    && existing.kind === (usesMesh ? "mesh" : "slug")
  ) {
    engine.vectorGeometryGpuCacheHitCount += 1;
    return existing;
  }
  engine.vectorGeometryGpuCacheMissCount += 1;
  let created: VectorTextGpuDrawResources;
  if (usesMesh) {
    const payloadBytes = draw.mesh.vertices.byteLength + draw.mesh.indices.byteLength;
    const allocatedBytes = Math.max(4, draw.mesh.vertices.byteLength)
      + Math.max(4, draw.mesh.indices.byteLength);
    created = {
      ...createVectorTextGpuMeshResources(engine.device, draw),
      payloadBytes,
      allocatedBytes,
    };
    engine.vectorGeometryGpuCreatedBufferCount += 2;
    engine.vectorGeometryGpuUploadBytes += payloadBytes;
  } else {
    const uniformBuffer = engine.vectorTextGpuUniformBuffer;
    const layout = engine.vectorTextGpuSlugBindGroupLayout;
    if (!uniformBuffer || !layout) {
      throw new Error("The vector-text Slug layout is not initialized.");
    }
    const payloadBytes = draw.slug.curveTexture.data.byteLength
      + draw.slug.bandTexture.data.byteLength;
    const allocatedBytes = (
      draw.slug.curveTexture.width * draw.slug.curveTexture.height
      + draw.slug.bandTexture.width * draw.slug.bandTexture.height
    ) * 16;
    created = {
      ...createVectorTextGpuSlugResources(
        engine.device,
        draw,
        uniformBuffer,
        layout,
        VECTOR_TEXT_SLUG_UNIFORM_BYTES,
      ),
      payloadBytes,
      allocatedBytes,
    };
    engine.vectorGeometryGpuCreatedTextureCount += 2;
    engine.vectorGeometryGpuUploadBytes += payloadBytes;
  }
  engine.vectorTextGpuMeshes.set(resourceKey, created);
  if (existing) {
    destroyVectorTextGpuResources(existing);
  }
  return created;
}

export function rebuildVectorTextDisplayBindGroup(engine: BrushEngine): void {
  const layout = engine.vectorTextDisplayBindGroupLayout;
  const belowView = engine.vectorTextBelowView;
  const aboveView = engine.vectorTextAboveView;
  if (!layout || (!belowView && !aboveView)) {
    engine.vectorTextDisplayBindGroup = null;
  } else {
    engine.vectorTextDisplayBindGroup = engine.device.createBindGroup({
      label: "Dual viewport vector text mixed-layer display bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: engine.layerView },
        { binding: 2, resource: engine.activeLayerDisplayPyramid.samplingView },
        { binding: 3, resource: engine.mergedBelowView() },
        { binding: 4, resource: engine.mergedAboveView() },
        { binding: 5, resource: engine.sampler },
        { binding: 6, resource: belowView ?? engine.transparentLayerView },
        { binding: 7, resource: aboveView ?? engine.transparentLayerView },
        { binding: 8, resource: engine.activeClippingPrefixView() },
        { binding: 9, resource: engine.activeClippingSuffixView() },
      ],
    });
  }
  rebuildVectorTextDependentDisplayBindGroups(engine);
}

export function writeVectorTextGpuBlurFilterUniform(engine: BrushEngine, 
  draw: VectorTextGpuBlurSourceDraw,
  filterIndex: number,
): void {
  const base = filterIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4;
  const upload = engine.vectorTextGpuBlurFilterUniformUpload;
  const unsigned = engine.vectorTextGpuBlurFilterUniformUploadUnsigned;
  upload.fill(0, base, base + VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4);
  unsigned[base] = draw.blurWidth;
  unsigned[base + 1] = draw.blurHeight;
  unsigned[base + 2] = draw.blurRadius;
  upload[base + 4] = Math.min(
    draw.blurRadius,
    Math.max(0, draw.blurSigmaPixels * 3),
  );
}

export function captureVectorTextPresentationView(engine: BrushEngine): void {
  const next = engine.getVectorTextViewState();
  const previous = engine.vectorTextCaptureView;
  if (
    previous
    && previous.canvasWidth === next.canvasWidth
    && previous.canvasHeight === next.canvasHeight
    && previous.centerX === next.centerX
    && previous.centerY === next.centerY
    && previous.zoom === next.zoom
    && previous.rotationCos === next.rotationCos
    && previous.rotationSin === next.rotationSin
  ) {
    return;
  }
  engine.vectorTextCaptureView = next;
  writeVectorTextCaptureUniforms(engine);
}

function writeCaptureViewUniform(
  engine: BrushEngine,
  view: Readonly<VectorTextViewState>,
  upload: Float32Array,
  buffer: GPUBuffer,
  fastMode: number,
): void {
  const nextValues = [
    view.canvasWidth,
    view.canvasHeight,
    view.rotationCos,
    view.rotationSin,
    view.centerX,
    view.centerY,
    view.zoom,
    fastMode,
  ] as const;
  let changed = false;
  for (let index = 0; index < nextValues.length; index += 1) {
    const next = Math.fround(nextValues[index]);
    if (!Object.is(upload[index], next)) {
      upload[index] = next;
      changed = true;
    }
  }
  if (changed) {
    engine.device.queue.writeBuffer(buffer, 0, upload);
  }
}

export function writeVectorTextFallbackCaptureUniforms(engine: BrushEngine): void {
  const view = engine.vectorTextFallbackCaptureView
    ?? engine.vectorTextCaptureView
    ?? engine.getVectorTextViewState();
  writeCaptureViewUniform(
    engine,
    view,
    engine.vectorTextFallbackCaptureUniformUpload,
    engine.vectorTextFallbackCaptureUniformBuffer,
    0,
  );
}

export function writeVectorTextCaptureUniforms(engine: BrushEngine): void {
  const view = engine.vectorTextCaptureView ?? engine.getVectorTextViewState();
  const currentView = engine.getVectorTextViewState();
  const completeFallback = vectorTextFallbackPresentationComplete(engine)
    && engine.vectorTextFallbackCaptureView?.canvasWidth === currentView.canvasWidth
    && engine.vectorTextFallbackCaptureView.canvasHeight === currentView.canvasHeight
    ? engine.vectorTextFallbackCaptureView
    : null;
  const presentationMode = engine.vectorTextFastPresentationEnabled
    ? vectorTextFastPresentationMode(
      engine.vectorTextCaptureView,
      currentView,
      completeFallback,
      engine.documentWidth,
      engine.documentHeight,
    )
    : "precise";
  engine.vectorTextFastPresentationMode = presentationMode;
  const fastMode = presentationMode === "reproject"
    ? 1
    : presentationMode === "reproject-fallback"
      ? 3
      : presentationMode === "reproject-clipped"
        ? 2
        : 0;
  writeCaptureViewUniform(
    engine,
    view,
    engine.vectorTextCaptureUniformUpload,
    engine.vectorTextCaptureUniformBuffer,
    fastMode,
  );
}

export function releaseVectorTextGpuBlurScratch(engine: BrushEngine): void {
  engine.vectorTextGpuBlurScratchATexture?.destroy();
  engine.vectorTextGpuBlurScratchBTexture?.destroy();
  engine.vectorTextGpuBlurScratchATexture = null;
  engine.vectorTextGpuBlurScratchAView = null;
  engine.vectorTextGpuBlurScratchBTexture = null;
  engine.vectorTextGpuBlurScratchBView = null;
  engine.vectorTextGpuBlurScratchWidth = 0;
  engine.vectorTextGpuBlurScratchHeight = 0;
  engine.vectorTextGpuBlurFilterBindGroupAToB = null;
  engine.vectorTextGpuBlurFilterBindGroupBToA = null;
}

export function releaseVectorTextGpuScratch(engine: BrushEngine): void {
  engine.vectorTextGpuMsaaTexture?.destroy();
  engine.vectorTextGpuResolvedTexture?.destroy();
  engine.vectorTextGpuMsaaTexture = null;
  engine.vectorTextGpuMsaaView = null;
  engine.vectorTextGpuResolvedTexture = null;
  engine.vectorTextGpuResolvedView = null;
  engine.vectorTextGpuQualityTexture?.destroy();
  engine.vectorTextGpuQualityTexture = null;
  engine.vectorTextGpuQualityMipViews = [];
  engine.vectorTextGpuQualityDownsampleBindGroups = [];
  releaseMixedSceneTextEncodedCompositeScratch(engine);
  engine.vectorTextGpuScratchWidth = 0;
  engine.vectorTextGpuScratchHeight = 0;
}

export function mixedSceneItemIsVisible(engine: BrushEngine, item: MixedSceneItem): boolean {
  if (item.kind !== "raster") {
    return false;
  }
  const record = engine.layerStack.byId(item.rasterLayerId);
  if (!record) {
    throw new Error(`Raster ${item.rasterLayerId} is missing during compositing.`);
  }
  return record.visible && record.opacity > 0 && record.hasContent;
}

export function publishMixedScene(engine: BrushEngine): void {
  const runtimeObserver = engine.callbacks.onMixedSceneRuntimeChange;
  if (runtimeObserver) {
    const runtimeSnapshot = engine.getMixedSceneRuntimeSnapshot();
    if (runtimeSnapshot) {
      try {
        runtimeObserver(runtimeSnapshot);
      } catch (error) {
        console.error(
          "Internal mixed-scene observer ignored to preserve the transaction:",
          error,
        );
      }
    }
  }

  const publicObserver = engine.callbacks.onMixedSceneChange;
  if (publicObserver) {
    const defensiveSnapshot = engine.getMixedSceneSnapshot();
    if (!defensiveSnapshot) return;
    try {
      publicObserver(defensiveSnapshot);
    } catch (error) {
      console.error("Mixed-scene observer ignored to preserve the transaction:", error);
    }
  }
}

export function destroyMixedSceneRasterSegment(engine: BrushEngine, 
  segment: MixedSceneRasterSegmentResources,
): void {
  segment.documentCutoutBaseUniformBuffer?.destroy();
  if (segment.documentCutoutMaskUniformBuffer !== segment.documentCutoutBaseUniformBuffer) {
    segment.documentCutoutMaskUniformBuffer?.destroy();
  }
  segment.uniformBuffer.destroy();
  engine.destroyMergedSurface(segment.surface);
  if (segment.cutoutSurface !== segment.surface) {
    engine.destroyMergedSurface(segment.cutoutSurface);
  }
  if (
    segment.documentCutoutBaseSurface !== segment.surface
    && segment.documentCutoutBaseSurface !== segment.cutoutSurface
  ) {
    engine.destroyMergedSurface(segment.documentCutoutBaseSurface);
  }
  if (
    segment.documentCutoutMaskSurface !== segment.surface
    && segment.documentCutoutMaskSurface !== segment.cutoutSurface
    && segment.documentCutoutMaskSurface !== segment.documentCutoutBaseSurface
  ) {
    engine.destroyMergedSurface(segment.documentCutoutMaskSurface);
  }
}

export function requireMixedSceneStack(engine: BrushEngine): MixedSceneStack {
  if (!engine.mixedSceneStack) {
    throw new Error("The raster/text scene is not enabled for this page.");
  }
  return engine.mixedSceneStack;
}

export function clearVectorTextPresentationForTransaction(engine: BrushEngine): void {
  // The transaction will rebuild bind groups and request one frame only after
  // all replacement resources are valid and presentation has been unfrozen.
  engine.clearVectorTextPresentation(undefined, true);
}
