import type { BrushEngine } from "./brush-engine";
import {
  VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
  VECTOR_TEXT_GPU_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_UNIFORM_STRIDE,
  vectorTextGpuBlurCompositeShader,
  vectorTextGpuGaussianBlurShader,
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
import { assertShaderCompiled } from "./engine-gpu-utils";
import { VECTOR_TEXT_GPU_MAXIMUM_DRAWS } from "./engine-limits";
import {
  vectorTextGpuDrawUsesBlur,
  vectorTextGpuDrawUsesMesh,
  type MixedSceneActivePresentation,
  type VectorTextGpuBlurCacheResources,
  type VectorTextGpuDrawResources,
  type VectorTextRunTextureResources,
} from "./engine-vector-text-resources";
import {
  type VectorTextGpuBlurSourceDraw,
  type VectorTextGpuDraw,
  type VectorTextPlacement,
  type VectorTextViewState,
} from "./vector-text-types";
import { vectorTextGpuClearBounds, vectorTextGpuRunBounds } from "./engine-geometry";
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
import { LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE } from "./layer-blend-compositor";
import { LAYER_BLEND_MODE_CODES, LAYER_BLEND_MODE_ORDER } from "./layer-blend-modes";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  vectorTextFastPresentationMode,
} from "./vector-text-adaptive-zoom";

export async function initializeVectorTextGpuRenderer(engine: BrushEngine): Promise<void> {
  engine.vectorTextGpuShaderModule = engine.device.createShaderModule({
    label: `Vector text geometry WGSL · ${VECTOR_TEXT_GPU_RENDER_STRATEGY}`,
    code: vectorTextGpuShader,
  });
  engine.vectorTextGpuSlugShaderModule = engine.device.createShaderModule({
    label: `Vector text Slug WGSL · ${VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY}`,
    code: vectorTextSlugGpuShader,
  });

  engine.vectorTextGpuGaussianBlurShaderModule = engine.device.createShaderModule({
    label: "Vector text GPU separable Gaussian blur WGSL",
    code: vectorTextGpuGaussianBlurShader,
  });
  engine.vectorTextGpuBlurCompositeShaderModule = engine.device.createShaderModule({
    label: "Vector text GPU blurred mask composite WGSL",
    code: vectorTextGpuBlurCompositeShader,
  });
  engine.vectorTextGpuInnerShadowShaderModule = engine.device.createShaderModule({
    label: `Vector text inner shadow WGSL · ${VECTOR_TEXT_INNER_SHADOW_GPU_STRATEGY}`,
    code: vectorTextInnerShadowGpuShader,
  });
  await Promise.all([
    assertShaderCompiled(
      engine.vectorTextGpuShaderModule,
      "vector text indexed geometry",
    ),
    assertShaderCompiled(
      engine.vectorTextGpuSlugShaderModule,
      "vector text Slug analytic source fill",
    ),

    assertShaderCompiled(
      engine.vectorTextGpuGaussianBlurShaderModule,
      "vector text separable Gaussian blur",
    ),
    assertShaderCompiled(
      engine.vectorTextGpuBlurCompositeShaderModule,
      "vector text blurred mask composite",
    ),
    assertShaderCompiled(
      engine.vectorTextGpuInnerShadowShaderModule,
      "vector text inner shadow analytic clip",
    ),
  ]);

  engine.vectorTextGpuUniformBindGroupLayout =
    engine.device.createBindGroupLayout({
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

  engine.vectorTextGpuBlurFilterBindGroupLayout =
    engine.device.createBindGroupLayout({
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
      ],
    });
  engine.vectorTextGpuBlurCompositeBindGroupLayout =
    engine.device.createBindGroupLayout({
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
  engine.vectorTextGpuInnerShadowBindGroupLayout =
    engine.device.createBindGroupLayout({
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
  engine.vectorTextGpuSlugBindGroupLayout =
    engine.device.createBindGroupLayout({
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

  engine.vectorTextGpuUniformBuffer = engine.device.createBuffer({
    label: `Vector text dynamic uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
    size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.vectorTextGpuUniformBindGroup = engine.device.createBindGroup({
    label: "Vector text dynamic uniform bind group",
    layout: engine.vectorTextGpuUniformBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: engine.vectorTextGpuUniformBuffer,
          offset: 0,
          size: VECTOR_TEXT_GPU_UNIFORM_BYTES,
        },
      },
    ],
  });

  engine.vectorTextGpuBlurFilterUniformBuffer = engine.device.createBuffer({
    label: `Vector text GPU blur filter uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
    size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.vectorTextGpuBlurSampler = engine.device.createSampler({
    label: "Vector text GPU blur linear clamp sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: "linear",
    minFilter: "linear",
  });

  const sourceOverBlend: GPUBlendState = {
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
  const vertex: GPUVertexState = {
    module: engine.vectorTextGpuShaderModule,
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
  const textLayout = engine.device.createPipelineLayout({
    label: "Vector text geometry pipeline layout",
    bindGroupLayouts: [engine.vectorTextGpuUniformBindGroupLayout],
  });

  engine.vectorTextGpuFillPipeline = engine.device.createRenderPipeline({
    label: "Vector text indexed fill MSAA4 source-over pipeline",
    layout: textLayout,
    vertex,
    fragment: {
      module: engine.vectorTextGpuShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
      ],
    },
    primitive: { topology: "triangle-list" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });

  const slugLayout = engine.device.createPipelineLayout({
    label: "Vector text Slug pipeline layout",
    bindGroupLayouts: [engine.vectorTextGpuSlugBindGroupLayout],
  });
  engine.vectorTextGpuSlugPipeline = engine.device.createRenderPipeline({
    label: "Vector text whole-node Slug source fill MSAA4 source-over pipeline",
    layout: slugLayout,
    vertex: {
      module: engine.vectorTextGpuSlugShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuSlugShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });

  engine.vectorTextGpuBlurMaskPipeline = engine.device.createRenderPipeline({
    label: "Vector text analytic Slug mask for GPU blur",
    layout: slugLayout,
    vertex: {
      module: engine.vectorTextGpuSlugShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuSlugShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
  engine.vectorTextGpuMeshBlurMaskPipeline = engine.device.createRenderPipeline({
    label: "Vector mesh union mask for GPU blur",
    layout: textLayout,
    vertex: {
      module: engine.vectorTextGpuShaderModule,
      entryPoint: "blurMaskVertexMain",
      buffers: vertex.buffers,
    },
    fragment: {
      module: engine.vectorTextGpuShaderModule,
      entryPoint: "blurMaskFragmentMain",
      targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });

  const blurFilterLayout = engine.device.createPipelineLayout({
    label: "Vector text GPU Gaussian filter pipeline layout",
    bindGroupLayouts: [engine.vectorTextGpuBlurFilterBindGroupLayout],
  });
  engine.vectorTextGpuBlurHorizontalPipeline = engine.device.createRenderPipeline({
    label: "Vector text GPU Gaussian horizontal pipeline",
    layout: blurFilterLayout,
    vertex: {
      module: engine.vectorTextGpuGaussianBlurShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuGaussianBlurShaderModule,
      entryPoint: "horizontalMain",
      targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  });
  engine.vectorTextGpuBlurVerticalPipeline = engine.device.createRenderPipeline({
    label: "Vector text GPU Gaussian vertical pipeline",
    layout: blurFilterLayout,
    vertex: {
      module: engine.vectorTextGpuGaussianBlurShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuGaussianBlurShaderModule,
      entryPoint: "verticalMain",
      targets: [{ format: VECTOR_TEXT_GPU_BLUR_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  });
  engine.vectorTextGpuBlurCompositePipeline = engine.device.createRenderPipeline({
    label: "Vector text GPU blurred mask MSAA4 source-over composite",
    layout: engine.device.createPipelineLayout({
      label: "Vector text GPU blur composite pipeline layout",
      bindGroupLayouts: [engine.vectorTextGpuBlurCompositeBindGroupLayout],
    }),
    vertex: {
      module: engine.vectorTextGpuBlurCompositeShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuBlurCompositeShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
      ],
    },
    primitive: { topology: "triangle-list" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  engine.vectorTextGpuInnerShadowDirectPipeline = engine.device.createRenderPipeline({
    label: "Vector text inner shadow direct Slug MSAA4 source-over",
    layout: slugLayout,
    vertex: {
      module: engine.vectorTextGpuInnerShadowShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuInnerShadowShaderModule,
      entryPoint: "innerShadowDirectFragmentMain",
      targets: [
        { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  const innerShadowBlurLayout = engine.device.createPipelineLayout({
    label: "Vector text inner shadow blurred clip pipeline layout",
    bindGroupLayouts: [
      engine.vectorTextGpuSlugBindGroupLayout,
      engine.vectorTextGpuInnerShadowBindGroupLayout,
    ],
  });
  engine.vectorTextGpuInnerShadowBlurPipeline = engine.device.createRenderPipeline({
    label: "Vector text inner shadow blurred Slug clip MSAA4 source-over",
    layout: innerShadowBlurLayout,
    vertex: {
      module: engine.vectorTextGpuInnerShadowShaderModule,
      entryPoint: "innerShadowBlurVertexMain",
    },
    fragment: {
      module: engine.vectorTextGpuInnerShadowShaderModule,
      entryPoint: "innerShadowBlurFragmentMain",
      targets: [
        { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  engine.vectorTextGpuMeshInnerShadowBlurPipeline = engine.device.createRenderPipeline({
    label: "Vector SVG inner shadow mesh clip MSAA4 source-over",
    layout: engine.device.createPipelineLayout({
      label: "Vector SVG inner shadow mesh pipeline layout",
      bindGroupLayouts: [
        engine.vectorTextGpuUniformBindGroupLayout,
        engine.vectorTextGpuInnerShadowBindGroupLayout,
      ],
    }),
    vertex: {
      module: engine.vectorTextGpuShaderModule,
      entryPoint: "meshInnerShadowVertexMain",
      buffers: vertex.buffers,
    },
    fragment: {
      module: engine.vectorTextGpuShaderModule,
      entryPoint: "meshInnerShadowFragmentMain",
      targets: [
        { format: VECTOR_TEXT_GPU_TARGET_FORMAT, blend: sourceOverBlend },
      ],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: VECTOR_TEXT_GPU_SAMPLE_COUNT },
  });
  if (!engine.mixedSceneClearShaderModule) {
    throw new Error("The transparent-clear shader is not initialized.");
  }
  engine.vectorTextGpuClearPipeline = engine.device.createRenderPipeline({
    label: "Vector text cropped run transparent clear pipeline",
    layout: engine.device.createPipelineLayout({
      label: "Vector text cropped run transparent clear pipeline layout",
      bindGroupLayouts: [],
    }),
    vertex: {
      module: engine.mixedSceneClearShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.mixedSceneClearShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: VECTOR_TEXT_GPU_TARGET_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  });
}

export function flushVectorTextGpuPresentations(engine: BrushEngine): void {
  if (engine.vectorTextGpuPendingRuns.length === 0) {
    return;
  }
  let scratchWidth = 1;
  let scratchHeight = 1;
  let blurScratchWidth = 0;
  let blurScratchHeight = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
    scratchWidth = Math.max(scratchWidth, run.bounds.width);
    scratchHeight = Math.max(scratchHeight, run.bounds.height);
    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const cache = run.blurResources[index];
      if (vectorTextGpuDrawUsesBlur(draw) && cache?.needsBuild) {
        blurScratchWidth = Math.max(blurScratchWidth, draw.blurWidth);
        blurScratchHeight = Math.max(blurScratchHeight, draw.blurHeight);
      }
    }
  }
  ensureVectorTextGpuScratch(engine, scratchWidth, scratchHeight);
  if (blurScratchWidth > 0 && blurScratchHeight > 0) {
    ensureVectorTextGpuBlurScratch(engine, blurScratchWidth, blurScratchHeight);
  }

  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  const filterUniformBuffer = engine.vectorTextGpuBlurFilterUniformBuffer;
  const msaaView = engine.vectorTextGpuMsaaView;
  const resolvedTexture = engine.vectorTextGpuResolvedTexture;
  const resolvedView = engine.vectorTextGpuResolvedView;
  const fillPipeline = engine.vectorTextGpuFillPipeline;
  const slugPipeline = engine.vectorTextGpuSlugPipeline;
  const blurMaskPipeline = engine.vectorTextGpuBlurMaskPipeline;
  const meshBlurMaskPipeline = engine.vectorTextGpuMeshBlurMaskPipeline;
  const blurHorizontalPipeline = engine.vectorTextGpuBlurHorizontalPipeline;
  const blurVerticalPipeline = engine.vectorTextGpuBlurVerticalPipeline;
  const blurCompositePipeline = engine.vectorTextGpuBlurCompositePipeline;
  const innerShadowDirectPipeline = engine.vectorTextGpuInnerShadowDirectPipeline;
  const innerShadowBlurPipeline = engine.vectorTextGpuInnerShadowBlurPipeline;
  const meshInnerShadowBlurPipeline = engine.vectorTextGpuMeshInnerShadowBlurPipeline;
  const clearPipeline = engine.vectorTextGpuClearPipeline;
  if (
    !uniformBuffer
    || !uniformBindGroup
    || !filterUniformBuffer
    || !msaaView
    || !resolvedTexture
    || !resolvedView
    || !fillPipeline
    || !slugPipeline
    || !blurMaskPipeline
    || !meshBlurMaskPipeline
    || !blurHorizontalPipeline
    || !blurVerticalPipeline
    || !blurCompositePipeline
    || !innerShadowDirectPipeline
    || !innerShadowBlurPipeline
    || !meshInnerShadowBlurPipeline
    || !clearPipeline
  ) {
    throw new Error("The GPU vector-text batch pipeline is not ready.");
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
      filterUniformBuffer,
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
        sourcePass.setPipeline(meshBlurMaskPipeline);
        sourcePass.setBindGroup(0, uniformBindGroup, [sourceDynamicOffset]);
        sourcePass.setVertexBuffer(0, build.resources.vertexBuffer);
        sourcePass.setIndexBuffer(build.resources.indexBuffer, "uint32");
        sourcePass.drawIndexed(build.resources.indexCount, 1, 0, 0, 0);
      } else {
        if (build.resources.kind !== "slug") {
          throw new Error("The Slug resource does not match the GPU blur mask.");
        }
        sourcePass.setPipeline(blurMaskPipeline);
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
      horizontalPass.setPipeline(blurHorizontalPipeline);
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
      verticalPass.setPipeline(blurVerticalPipeline);
      verticalPass.setBindGroup(0, filterBToA, [filterOffset]);
      verticalPass.draw(3, 1, 0, 0);
      verticalPass.end();

      encoder.copyTextureToTexture(
        { texture: scratchATexture },
        { texture: build.cache.texture },
        { width, height, depthOrArrayLayers: 1 },
      );
      build.cache.needsBuild = false;
    }
  }

  let drawOffset = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
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

    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const resourcesForDraw = run.drawResources[index];
      const blurResources = run.blurResources[index];
      const uniformIndex = drawOffset + index;
      if (draw.opacity <= 0) {
        continue;
      }
      const dynamicOffset = uniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
      if (draw.mode === "slug-blur" || draw.mode === "mesh-blur") {
        if (!blurResources) {
          throw new Error("The GPU vector-blur cache is missing.");
        }
        pass.setPipeline(blurCompositePipeline);
        pass.setBindGroup(0, blurResources.compositeBindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "slug-inner-shadow-direct") {
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("The Slug resource does not match the GPU Inner Shadow.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(innerShadowDirectPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "slug-inner-shadow-blur") {
        if (!blurResources) {
          throw new Error("The blurred Inner Shadow GPU cache is missing.");
        }
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("The Slug resource does not match the blurred Inner Shadow.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(innerShadowBlurPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.setBindGroup(1, blurResources.innerShadowBindGroup);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "mesh-inner-shadow-blur") {
        if (!blurResources) {
          throw new Error("The SVG Inner Shadow GPU cache is missing.");
        }
        if (resourcesForDraw.kind !== "mesh") {
          throw new Error("The mesh resource does not match the SVG Inner Shadow.");
        }
        if (resourcesForDraw.indexCount === 0) {
          continue;
        }
        pass.setPipeline(meshInnerShadowBlurPipeline);
        pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
        pass.setBindGroup(1, blurResources.innerShadowBindGroup);
        pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
        pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
        pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
      } else if (draw.mode === "mesh-direct") {
        if (resourcesForDraw.kind !== "mesh") {
          throw new Error("The vector-mesh resource does not match the draw call.");
        }
        if (resourcesForDraw.indexCount === 0) {
          continue;
        }
        pass.setPipeline(fillPipeline);
        pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
        pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
        pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
        pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
      } else {
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("The text Slug resource does not match the draw call.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(slugPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      }
    }
    pass.end();

    const isPrimary = run.target === "primary";
    const wasInitialized = isPrimary && run.resources.initialized;
    const clearBounds = isPrimary
      ? vectorTextGpuClearBounds(run.resources.lastBounds, run.bounds)
      : run.bounds;
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
        clearBounds.x,
        clearBounds.y,
        clearBounds.width,
        clearBounds.height,
      );
      clearPass.draw(3, 1, 0, 0);
    }
    clearPass.end();
    encoder.copyTextureToTexture(
      {
        texture: resolvedTexture,
        origin: { x: 0, y: 0, z: 0 },
      },
      {
        texture: run.targetTexture,
        origin: { x: run.bounds.x, y: run.bounds.y, z: 0 },
      },
      {
        width: run.bounds.width,
        height: run.bounds.height,
        depthOrArrayLayers: 1,
      },
    );
    if (isPrimary) {
      run.resources.lastBounds = run.bounds;
      run.resources.initialized = true;
    }
    drawOffset += run.draws.length;
  }
  engine.vectorTextGpuPendingRuns.length = 0;
  engine.device.queue.submit([encoder.finish()]);
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.requestRender();
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
  const textPipeline = engine.mixedSceneTextSegmentPipeline;
  const imagePipeline = engine.rasterImageMixedScenePipeline;
  const presentPipeline = engine.mixedScenePresentPipeline;
  const backgroundPipeline = engine.mixedSceneBackgroundPipeline;
  const backgroundBindGroup = engine.mixedSceneBackgroundBindGroup;
  if (
    !engine.usesOrderedScenePresentation()
    || !linearView
    || !presentBindGroup
    || !clearPipeline
    || !rasterPipeline
    || !textPipeline
    || !imagePipeline
    || !presentPipeline
    || !backgroundPipeline
    || !backgroundBindGroup
    || !engine.presentationCacheView
  ) {
    throw new Error("The segmented raster/text compositor is not ready.");
  }

  const drawSegmentSource = (
    pass: GPURenderPassEncoder,
    segment: MixedSceneCompositionSegment,
  ): void => {
    if (segment.kind === "raster-run") {
      const resources = engine.mixedSceneRasterSegments.find(
        (candidate) => candidate.key === segment.key,
      );
      if (resources) {
        pass.setPipeline(rasterPipeline);
        pass.setBindGroup(0, resources.bindGroup);
        pass.draw(3, 1, 0, 0);
      }
      return;
    }
    if (segment.kind === "text-run") {
      const resources = engine.vectorTextRunTextures.get(segment.key);
      if (resources) {
        pass.setPipeline(textPipeline);
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
        pass.setPipeline(imagePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(4, 1, 0, 0);
      }
      return;
    }

    if (segment.kind !== "active-raster") {
      return;
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

  const setDirtyScissor = (pass: GPURenderPassEncoder): void => {
    pass.setScissorRect(
      presentationDirtyRect.x,
      presentationDirtyRect.y,
      presentationDirtyRect.width,
      presentationDirtyRect.height,
    );
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
  for (const segment of engine.mixedSceneCompositionSegments) {
    const blendMode = engine.compositionSegmentBlendMode(segment);
    const clippingSuffixSteps = segment.kind === "active-raster"
      ? engine.activeClippingGroup?.suffixSteps ?? []
      : [];
    if (clippingSuffixSteps.length > 0) {
      scenePass?.end();
      scenePass = null;
      const scratchView = engine.mixedSceneBlendScratchView;
      const scratchTexture = engine.mixedSceneBlendScratchTexture;
      const operandView = engine.mixedSceneBlendOperandView;
      const operandTexture = engine.mixedSceneBlendOperandTexture;
      const groupView = engine.mixedSceneBlendGroupView;
      const groupTexture = engine.mixedSceneBlendGroupTexture;
      const blendPipeline = engine.layerBlendCompositorPipeline;
      const blendUniformStride = engine.layerBlendCompositorUniformStride;
      if (
        !scratchView
        || !scratchTexture
        || !operandView
        || !operandTexture
        || !groupView
        || !groupTexture
        || !blendPipeline
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
      drawSegmentSource(groupStartPass, segment);
      groupStartPass.end();

      let groupOnDedicatedTexture = false;
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
        operandPass.setPipeline(rasterPipeline);
        operandPass.setBindGroup(0, step.viewportSegment.bindGroup);
        operandPass.draw(3, 1, 0, 0);
        operandPass.end();

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
          groupOnDedicatedTexture
            ? engine.mixedSceneBlendFromGroupBindGroup
            : currentIsCanonical
              ? engine.mixedSceneBlendFromScratchBindGroup!
              : engine.mixedSceneBlendFromLinearBindGroup!,
          [
            (
              LAYER_BLEND_MODE_ORDER.length
              + LAYER_BLEND_MODE_CODES[step.blendMode]
            ) * blendUniformStride,
          ],
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
        [LAYER_BLEND_MODE_CODES[blendMode] * blendUniformStride],
      );
      outerBlendPass.draw(3, 1, 0, 0);
      outerBlendPass.end();
      currentIsCanonical = !currentIsCanonical;
      continue;
    }
    if (blendMode === "normal") {
      scenePass ??= beginScenePass();
      drawSegmentSource(scenePass, segment);
      continue;
    }

    scenePass?.end();
    scenePass = null;
    const operandView = engine.mixedSceneBlendOperandView;
    const targetView = currentIsCanonical
      ? engine.mixedSceneBlendScratchView
      : linearView;
    const blendBindGroup = currentIsCanonical
      ? engine.mixedSceneBlendFromLinearBindGroup
      : engine.mixedSceneBlendFromScratchBindGroup;
    const blendPipeline = engine.layerBlendCompositorPipeline;
    if (
      !operandView
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
      [LAYER_BLEND_MODE_CODES[blendMode] * engine.layerBlendCompositorUniformStride],
    );
    blendPass.draw(3, 1, 0, 0);
    blendPass.end();
    currentIsCanonical = !currentIsCanonical;
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

function createVectorTextRunBindGroup(
  engine: BrushEngine,
  key: Extract<VectorTextPlacement, `text-run:${string}`>,
  sourceView: GPUTextureView,
  fallbackView: GPUTextureView | null,
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
  );
}

export function clearVectorTextFallbackPresentation(engine: BrushEngine): void {
  let changed = engine.vectorTextFallbackCaptureView !== null;
  for (const [key, resources] of engine.vectorTextRunTextures) {
    if (resources.fallbackTexture) {
      resources.fallbackTexture.destroy();
      resources.fallbackTexture = null;
      resources.fallbackView = null;
      changed = true;
      rebuildVectorTextRunBindGroup(engine, key, resources);
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
      (resources) => resources.fallbackTexture !== null && resources.fallbackView !== null,
    );
}

export function getVectorTextFallbackPresentationStats(engine: BrushEngine): {
  captureView: VectorTextViewState | null;
  textureCount: number;
  gpuMemoryMiB: number;
  complete: boolean;
} {
  const textureCount = [...engine.vectorTextRunTextures.values()].filter(
    (resources) => resources.fallbackTexture !== null,
  ).length;
  return {
    captureView: engine.vectorTextFallbackCaptureView
      ? { ...engine.vectorTextFallbackCaptureView }
      : null,
    textureCount,
    gpuMemoryMiB:
      textureCount
      * engine.vectorTextTextureWidth
      * engine.vectorTextTextureHeight
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL
      / (1024 * 1024),
    complete: vectorTextFallbackPresentationComplete(engine),
  };
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
    {
      texture: GPUTexture;
      view: GPUTextureView;
      bindGroup: GPUBindGroup;
      resources: VectorTextRunTextureResources;
    }
  >();
  const pendingStart = engine.vectorTextGpuPendingRuns.length;
  try {
    for (const [key, draws] of runByKey) {
      const resources = engine.vectorTextRunTextures.get(key);
      if (!resources) {
        throw new Error(`GPU text run ${key} was removed while building the wide cache.`);
      }
      const texture = engine.device.createTexture({
        label: `Vector text ${key} automatic wide fallback ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
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
        const bindGroup = createVectorTextRunBindGroup(
          engine,
          key,
          resources.view,
          view,
        );
        candidates.set(key, { texture, view, bindGroup, resources });
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
          targetView: view,
          draws,
          drawResources,
          blurResources,
          view: { ...captureView },
          bounds: vectorTextGpuRunBounds(draws, captureView),
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
    for (const candidate of candidates.values()) candidate.texture.destroy();
    throw error;
  }

  const previousTextures: GPUTexture[] = [];
  for (const [key, candidate] of candidates) {
    if (candidate.resources.fallbackTexture) {
      previousTextures.push(candidate.resources.fallbackTexture);
    }
    candidate.resources.fallbackTexture = candidate.texture;
    candidate.resources.fallbackView = candidate.view;
    candidate.resources.bindGroup = candidate.bindGroup;
    if (!engine.vectorTextRunTextures.has(key)) {
      throw new Error(`GPU text run ${key} was removed before wide-cache publication.`);
    }
  }
  engine.vectorTextFallbackCaptureView = { ...captureView };
  writeVectorTextFallbackCaptureUniforms(engine);
  writeVectorTextCaptureUniforms(engine);
  for (const texture of previousTextures) texture.destroy();
  return {
    textureCount: candidates.size,
    gpuMemoryMiB: candidates.size * width * height
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL / (1024 * 1024),
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
    { texture: GPUTexture; view: GPUTextureView }
  >();
  const encoder = engine.device.createCommandEncoder({
    label: "Vector text wide fallback capture copies",
  });
  try {
    for (const [key, resources] of engine.vectorTextRunTextures) {
      if (!resources.initialized) continue;
      const texture = engine.device.createTexture({
        label: `Vector text ${key} wide fallback ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: VECTOR_TEXT_GPU_TARGET_FORMAT,
        usage:
          GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.TEXTURE_BINDING,
      });
      const view = texture.createView({
        label: `Vector text ${key} wide fallback view`,
      });
      candidates.set(key, { texture, view });
      encoder.copyTextureToTexture(
        { texture: resources.texture },
        { texture },
        { width, height, depthOrArrayLayers: 1 },
      );
    }
    if (candidates.size === 0) {
      throw new Error("The exact vector caches are not initialized yet.");
    }
    engine.device.queue.submit([encoder.finish()]);
  } catch (error) {
    for (const candidate of candidates.values()) candidate.texture.destroy();
    throw error;
  }

  const previousTextures: GPUTexture[] = [];
  for (const [key, resources] of engine.vectorTextRunTextures) {
    const candidate = candidates.get(key);
    if (resources.fallbackTexture) previousTextures.push(resources.fallbackTexture);
    resources.fallbackTexture = candidate?.texture ?? null;
    resources.fallbackView = candidate?.view ?? null;
  }
  engine.vectorTextFallbackCaptureView = { ...sourceView };
  writeVectorTextFallbackCaptureUniforms(engine);
  for (const [key, resources] of engine.vectorTextRunTextures) {
    rebuildVectorTextRunBindGroup(engine, key, resources);
  }
  for (const texture of previousTextures) texture.destroy();
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.requestRender();
  return {
    textureCount: candidates.size,
    gpuMemoryMiB: candidates.size * width * height
      * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL / (1024 * 1024),
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
  const texture = fallbackRuns[0].fallbackTexture!;
  const probeSize = Math.max(
    1,
    Math.min(128, Math.floor(capture.canvasWidth), Math.floor(capture.canvasHeight)),
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
      const originX = Math.max(
        0,
        Math.min(
          Math.floor(capture.canvasWidth) - probeSize,
          Math.round(screenX - probeSize * 0.5),
        ),
      );
      const originY = Math.max(
        0,
        Math.min(
          Math.floor(capture.canvasHeight) - probeSize,
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
    if (existingRun) {
      return existingRun.texture;
    }
    const texture = engine.device.createTexture({
      label: `Vector text ${key} viewport cache ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: VECTOR_TEXT_GPU_TARGET_FORMAT,
      usage:
        GPUTextureUsage.COPY_DST
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING,
    });
    try {
      const view = texture.createView({
        label: `Vector text ${key} viewport cache view`,
      });
      const resources: VectorTextRunTextureResources = {
        texture,
        view,
        fallbackTexture: null,
        fallbackView: null,
        bindGroup: null as unknown as GPUBindGroup,
        lastBounds: null,
        initialized: false,
      };
      rebuildVectorTextRunBindGroup(engine, key, resources);
      engine.vectorTextRunTextures.set(key, resources);
      return texture;
    } catch (error) {
      texture.destroy();
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
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const shareImmutableDocuments = history?.shareImmutableDocuments === true;
  const previousState = scene.captureState(shareImmutableDocuments);
  const historyBefore = history?.targetKey
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
    if (history) {
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
  if (!layout || !uniformBuffer) {
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
      entries: [uniformEntry, { binding: 1, resource: viewA }],
    });
    engine.vectorTextGpuBlurFilterBindGroupBToA = engine.device.createBindGroup({
      label: "Vector text GPU blur vertical B to A",
      layout,
      entries: [uniformEntry, { binding: 1, resource: viewB }],
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
  upload[base + 8] = draw.x;
  upload[base + 9] = draw.y;
  upload[base + 10] = Math.cos(draw.rotation);
  upload[base + 11] = Math.sin(draw.rotation);
  upload[base + 12] = draw.scale;
  upload[base + 13] = draw.localOffsetX;
  upload[base + 14] = draw.localOffsetY;
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
  groupTexture: GPUTexture;
  groupView: GPUTextureView;
  fromLinear: GPUBindGroup;
  fromScratch: GPUBindGroup;
  fromGroup: GPUBindGroup;
};

function createMixedSceneBlendScratchCandidate(
  engine: BrushEngine,
  width: number,
  height: number,
  linearView: GPUTextureView,
): MixedSceneBlendScratchCandidate {
  const blendLayout = engine.layerBlendCompositorBindGroupLayout;
  const blendUniformBuffer = engine.layerBlendCompositorUniformBuffer;
  if (!blendLayout || !blendUniformBuffer) {
    throw new Error("The GPU layer-blend compositor is not initialized.");
  }
  let texture: GPUTexture | null = null;
  let operandTexture: GPUTexture | null = null;
  let groupTexture: GPUTexture | null = null;
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
    groupTexture = engine.device.createTexture({
      label: `Ordered clipping-group blend ping-pong ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView({ label: "Ordered layer blend ping-pong view" });
    const operandView = operandTexture.createView({
      label: "Ordered layer blend operand view",
    });
    const groupView = groupTexture.createView({
      label: "Ordered clipping-group blend ping-pong view",
    });
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
    ];
    return {
      texture,
      view,
      operandTexture,
      operandView,
      groupTexture,
      groupView,
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
    groupTexture?.destroy();
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
  engine.mixedSceneBlendGroupTexture = candidate?.groupTexture ?? null;
  engine.mixedSceneBlendGroupView = candidate?.groupView ?? null;
  engine.mixedSceneBlendFromLinearBindGroup = candidate?.fromLinear ?? null;
  engine.mixedSceneBlendFromScratchBindGroup = candidate?.fromScratch ?? null;
  engine.mixedSceneBlendFromGroupBindGroup = candidate?.fromGroup ?? null;
}

/**
 * Validates every viewport-sized resource needed by a candidate blend mode
 * before its metadata/history entry is published. Existing resources stay
 * authoritative until both WebGPU error scopes confirm the replacement.
 */
export async function prewarmMixedSceneLinearTextureForLayerBlend(
  engine: BrushEngine,
  width: number,
  height: number,
  needsAdvancedBlend: boolean,
): Promise<void> {
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout) {
    throw new Error("The mixed-scene presentation layout is not initialized.");
  }
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
      && engine.mixedSceneBlendGroupTexture
      && engine.mixedSceneBlendGroupView
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
        );
        transaction.deferRollback(() => {
          scratch.texture.destroy();
          scratch.operandTexture.destroy();
          scratch.groupTexture.destroy();
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
        ? createMixedSceneBlendScratchCandidate(engine, width, height, view)
        : null;
      if (scratch) {
        transaction.deferRollback(() => {
          scratch.texture.destroy();
          scratch.operandTexture.destroy();
          scratch.groupTexture.destroy();
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
  const oldGroup = engine.mixedSceneBlendGroupTexture;
  if (candidate.kind === "scratch") {
    publishMixedSceneBlendScratchCandidate(engine, candidate.scratch);
    oldScratch?.destroy();
    oldOperand?.destroy();
    oldGroup?.destroy();
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
  oldGroup?.destroy();
  engine.presentationCacheNeedsFullRebuild = true;
}

export function ensureMixedSceneLinearTexture(engine: BrushEngine, width: number, height: number): void {
  const releaseBlendScratch = () => {
    engine.mixedSceneBlendScratchTexture?.destroy();
    engine.mixedSceneBlendOperandTexture?.destroy();
    engine.mixedSceneBlendGroupTexture?.destroy();
    engine.mixedSceneBlendScratchTexture = null;
    engine.mixedSceneBlendScratchView = null;
    engine.mixedSceneBlendOperandTexture = null;
    engine.mixedSceneBlendOperandView = null;
    engine.mixedSceneBlendGroupTexture = null;
    engine.mixedSceneBlendGroupView = null;
    engine.mixedSceneBlendFromLinearBindGroup = null;
    engine.mixedSceneBlendFromScratchBindGroup = null;
    engine.mixedSceneBlendFromGroupBindGroup = null;
  };
  if (!engine.usesOrderedScenePresentation()) {
    engine.mixedSceneLinearTexture?.destroy();
    releaseBlendScratch();
    engine.mixedSceneLinearTexture = null;
    engine.mixedSceneLinearView = null;
    engine.mixedSceneLinearWidth = 0;
    engine.mixedSceneLinearHeight = 0;
    engine.mixedScenePresentBindGroup = null;
    return;
  }
  const needsAdvancedBlend = !engine.usesLayerBlendTilePresentation()
    && engine.layerStack.layers.some((record) => record.blendMode !== "normal");
  const blendScratchReady = !needsAdvancedBlend || Boolean(
    engine.mixedSceneBlendScratchTexture
      && engine.mixedSceneBlendScratchView
      && engine.mixedSceneBlendOperandTexture
      && engine.mixedSceneBlendOperandView
      && engine.mixedSceneBlendGroupTexture
      && engine.mixedSceneBlendGroupView
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
      releaseBlendScratch();
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
  const oldBlendGroup = engine.mixedSceneBlendGroupTexture;
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
  let blendGroup: GPUTexture | null = null;
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
    let blendGroupView: GPUTextureView | null = null;
    let fromLinear: GPUBindGroup | null = null;
    let fromScratch: GPUBindGroup | null = null;
    let fromGroup: GPUBindGroup | null = null;
    if (needsAdvancedBlend) {
      const scratch = createMixedSceneBlendScratchCandidate(engine, width, height, view);
      blendScratch = scratch.texture;
      blendScratchView = scratch.view;
      blendOperand = scratch.operandTexture;
      blendOperandView = scratch.operandView;
      blendGroup = scratch.groupTexture;
      blendGroupView = scratch.groupView;
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
    engine.mixedSceneBlendGroupTexture = blendGroup;
    engine.mixedSceneBlendGroupView = blendGroupView;
    engine.mixedSceneBlendFromLinearBindGroup = fromLinear;
    engine.mixedSceneBlendFromScratchBindGroup = fromScratch;
    engine.mixedSceneBlendFromGroupBindGroup = fromGroup;
    engine.presentationCacheNeedsFullRebuild = true;
    oldTexture?.destroy();
    oldBlendScratch?.destroy();
    oldBlendOperand?.destroy();
    oldBlendGroup?.destroy();
  } catch (error) {
    texture.destroy();
    blendScratch?.destroy();
    blendOperand?.destroy();
    blendGroup?.destroy();
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
): MixedSceneRasterSegmentResources {
  const layout = engine.mixedSceneRasterSegmentBindGroupLayout;
  if (!layout) {
    throw new Error("The raster/text compositor layout is not initialized.");
  }
  const uniformBuffer = engine.device.createBuffer({
    label: `Mixed scene raster segment ${key} uniforms`,
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    engine.device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([
        surface.bounds.x,
        surface.bounds.y,
        surface.resolutionScale,
        Math.min(1, Math.max(0, opacity)),
      ]),
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
    return { key, surface, uniformBuffer, bindGroup };
  } catch (error) {
    uniformBuffer.destroy();
    throw error;
  }
}

export function ensureVectorTextGpuScratch(engine: BrushEngine, width: number, height: number): void {
  if (
    engine.vectorTextGpuMsaaTexture
    && engine.vectorTextGpuMsaaView
    && engine.vectorTextGpuResolvedTexture
    && engine.vectorTextGpuResolvedView
    && engine.vectorTextGpuScratchWidth === width
    && engine.vectorTextGpuScratchHeight === height
  ) {
    return;
  }
  engine.vectorTextGpuMsaaTexture?.destroy();
  engine.vectorTextGpuResolvedTexture?.destroy();
  engine.vectorTextGpuMsaaTexture = engine.device.createTexture({
    label: `Vector text shared MSAA4 color ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT,
    format: VECTOR_TEXT_GPU_TARGET_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  engine.vectorTextGpuMsaaView = engine.vectorTextGpuMsaaTexture.createView({
    label: "Vector text shared MSAA4 color view",
  });
  engine.vectorTextGpuResolvedTexture = engine.device.createTexture({
    label: `Vector text shared resolved crop ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: VECTOR_TEXT_GPU_TARGET_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.COPY_SRC,
  });
  engine.vectorTextGpuResolvedView = engine.vectorTextGpuResolvedTexture.createView({
    label: "Vector text shared resolved crop view",
  });
  engine.vectorTextGpuScratchWidth = width;
  engine.vectorTextGpuScratchHeight = height;
}

export function ensureVectorTextGpuResource(engine: BrushEngine, 
  draw: VectorTextGpuDraw,
): VectorTextGpuDrawResources {
  const usesMesh = vectorTextGpuDrawUsesMesh(draw);
  const revision = usesMesh ? draw.mesh.revision : draw.slug.revision;
  const existing = engine.vectorTextGpuMeshes.get(draw.meshKey);
  if (
    existing
    && existing.revision === revision
    && existing.kind === (usesMesh ? "mesh" : "slug")
  ) {
    return existing;
  }
  let created: VectorTextGpuDrawResources;
  if (usesMesh) {
    created = createVectorTextGpuMeshResources(engine.device, draw);
  } else {
    const uniformBuffer = engine.vectorTextGpuUniformBuffer;
    const layout = engine.vectorTextGpuSlugBindGroupLayout;
    if (!uniformBuffer || !layout) {
      throw new Error("The vector-text Slug layout is not initialized.");
    }
    created = createVectorTextGpuSlugResources(
      engine.device,
      draw,
      uniformBuffer,
      layout,
      VECTOR_TEXT_SLUG_UNIFORM_BYTES,
    );
  }
  engine.vectorTextGpuMeshes.set(draw.meshKey, created);
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
  const sigma = Math.max(0.01, draw.blurSigmaPixels);
  const weights = new Float64Array(draw.blurRadius + 1);
  let normalizer = 0;
  for (let index = 0; index <= draw.blurRadius; index += 1) {
    const weight = Math.exp(-0.5 * (index / sigma) ** 2);
    weights[index] = weight;
    normalizer += index === 0 ? weight : weight * 2;
  }
  for (let index = 0; index <= draw.blurRadius; index += 1) {
    upload[base + 4 + index] = weights[index] / normalizer;
  }
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
  const snapshot = engine.createMixedSceneSnapshot();
  if (snapshot) {
    try {
      engine.callbacks.onMixedSceneChange?.(snapshot);
    } catch (error) {
      console.error("Mixed-scene observer ignored to preserve the transaction:", error);
    }
  }
}

export function destroyMixedSceneRasterSegment(engine: BrushEngine, 
  segment: MixedSceneRasterSegmentResources,
): void {
  segment.uniformBuffer.destroy();
  engine.destroyMergedSurface(segment.surface);
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
