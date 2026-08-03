import type { BrushEngine } from "./brush-engine";
import {
  VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_FILTER_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
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
} from "./engine-vector-text-resources";
import {
  type VectorTextGpuBlurSourceDraw,
  type VectorTextGpuDraw,
  type VectorTextPlacement,
  type VectorTextViewState,
} from "./vector-text-types";
import { vectorTextGpuClearBounds } from "./engine-geometry";
import { type DirtyRect } from "./engine-stroke-types";
import { MIXED_SCENE_COMPOSITOR_STRATEGY, MIXED_SCENE_LINEAR_FORMAT } from "./mixed-scene-compositor-shader";
import {
  MixedSceneStack,
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
    throw new Error("Shader clear trasparente non inizializzato.");
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
    throw new Error("Pipeline batch del testo vettoriale GPU non pronta.");
  }

  const totalMainDraws = engine.vectorTextGpuPendingRuns.reduce(
    (total, run) => total + run.draws.length,
    0,
  );
  if (totalMainDraws > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
    throw new Error(
      `Batch testo GPU oltre ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} draw call.`,
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
        throw new Error("Risorsa vettoriale incoerente con la mask blur GPU.");
      }
      if (nextSourceUniformIndex >= VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
        throw new Error(
          `Uniform testo GPU oltre ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} slot.`,
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
      throw new Error("Scratch GPU del blur testo non pronto.");
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
          throw new Error("Mesh SVG incoerente con la mask blur GPU.");
        }
        sourcePass.setPipeline(meshBlurMaskPipeline);
        sourcePass.setBindGroup(0, uniformBindGroup, [sourceDynamicOffset]);
        sourcePass.setVertexBuffer(0, build.resources.vertexBuffer);
        sourcePass.setIndexBuffer(build.resources.indexBuffer, "uint32");
        sourcePass.drawIndexed(build.resources.indexCount, 1, 0, 0, 0);
      } else {
        if (build.resources.kind !== "slug") {
          throw new Error("Slug incoerente con la mask blur GPU.");
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
          throw new Error("Cache GPU del blur vettoriale mancante.");
        }
        pass.setPipeline(blurCompositePipeline);
        pass.setBindGroup(0, blurResources.compositeBindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "slug-inner-shadow-direct") {
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("Risorsa Slug incoerente con l’ombra interna GPU.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(innerShadowDirectPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "slug-inner-shadow-blur") {
        if (!blurResources) {
          throw new Error("Cache GPU dell’ombra interna sfocata mancante.");
        }
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("Risorsa Slug incoerente con l’ombra interna sfocata.");
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
          throw new Error("Cache GPU dell’ombra interna SVG mancante.");
        }
        if (resourcesForDraw.kind !== "mesh") {
          throw new Error("Risorsa mesh incoerente con l’ombra interna SVG.");
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
          throw new Error("Risorsa mesh vettoriale incoerente con la draw call.");
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
          throw new Error("Risorsa Slug testo incoerente con la draw call.");
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

    const wasInitialized = run.resources.initialized;
    const clearBounds = vectorTextGpuClearBounds(
      run.resources.lastBounds,
      run.bounds,
    );
    const clearPass = encoder.beginRenderPass({
      label: `Vector text GPU clear old crop ${run.placement}`,
      colorAttachments: [
        {
          view: run.resources.view,
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
        texture: run.resources.texture,
        origin: { x: run.bounds.x, y: run.bounds.y, z: 0 },
      },
      {
        width: run.bounds.width,
        height: run.bounds.height,
        depthOrArrayLayers: 1,
      },
    );
    run.resources.lastBounds = run.bounds;
    run.resources.initialized = true;
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
  if (
    !engine.mixedSceneStack?.visibleSemanticCount
    || !linearView
    || !presentBindGroup
    || !clearPipeline
    || !rasterPipeline
    || !textPipeline
    || !imagePipeline
    || !presentPipeline
    || !engine.presentationCacheView
  ) {
    throw new Error("Compositore segmentato raster/testo non pronto.");
  }

  const scenePass = encoder.beginRenderPass({
    label: `${label} · ${MIXED_SCENE_COMPOSITOR_STRATEGY}`,
    colorAttachments: [
      {
        view: linearView,
        loadOp: requiresFullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      },
    ],
  });
  scenePass.setScissorRect(
    presentationDirtyRect.x,
    presentationDirtyRect.y,
    presentationDirtyRect.width,
    presentationDirtyRect.height,
  );
  if (!requiresFullRebuild) {
    scenePass.setPipeline(clearPipeline);
    scenePass.draw(3, 1, 0, 0);
  }

  for (const segment of engine.mixedSceneCompositionSegments) {
    if (segment.kind === "raster-run") {
      const resources = engine.mixedSceneRasterSegments.find(
        (candidate) => candidate.key === segment.key,
      );
      if (resources) {
        scenePass.setPipeline(rasterPipeline);
        scenePass.setBindGroup(0, resources.bindGroup);
        scenePass.draw(3, 1, 0, 0);
      }
      continue;
    }
    if (segment.kind === "text-run") {
      const resources = engine.vectorTextRunTextures.get(segment.key);
      if (resources) {
        scenePass.setPipeline(textPipeline);
        scenePass.setBindGroup(0, resources.bindGroup);
        scenePass.draw(3, 1, 0, 0);
      }
      continue;
    }
    if (segment.kind === "image") {
      const node = engine.mixedSceneStack.imageById(segment.item.imageNodeId);
      const bindGroup = rasterImageBindGroupForNode(engine, node);
      if (bindGroup) {
        scenePass.setPipeline(imagePipeline);
        scenePass.setBindGroup(0, bindGroup);
        scenePass.draw(4, 1, 0, 0);
      }
      continue;
    }

    if (segment.kind !== "active-raster") {
      continue;
    }
    if (activePresentation.kind === "raster-stroke") {
      const pipeline = engine.mixedSceneActiveRasterStrokeDisplayPipeline;
      const sourceBindGroup = engine.rasterStrokeDisplayBindGroups.get(
        activePresentation.sourceMode,
      );
      if (!pipeline || !sourceBindGroup) {
        throw new Error("Pipeline del raster attivo con effetti non pronta.");
      }
      scenePass.setPipeline(pipeline);
      scenePass.setBindGroup(0, engine.rasterStrokeDisplayScreenBindGroup);
      scenePass.setBindGroup(1, sourceBindGroup);
    } else if (activePresentation.kind === "thickness-tail") {
      const pipeline = engine.mixedSceneActiveThicknessTailDisplayPipeline;
      if (!pipeline || !engine.thicknessTailDisplayBindGroup) {
        throw new Error("Pipeline del tail attivo non pronta.");
      }
      scenePass.setPipeline(pipeline);
      scenePass.setBindGroup(0, engine.thicknessTailDisplayBindGroup);
    } else if (activePresentation.kind === "light-glaze") {
      const pipeline = engine.mixedSceneActiveLightGlazeDisplayPipeline;
      if (!pipeline || !engine.lightGlazeDisplayBindGroup) {
        throw new Error("Pipeline Light Glaze del raster attivo non pronta.");
      }
      scenePass.setPipeline(pipeline);
      scenePass.setBindGroup(0, engine.lightGlazeDisplayBindGroup);
    } else {
      const pipeline = engine.mixedSceneActiveDisplayPipeline;
      if (!pipeline) {
        throw new Error("Pipeline base del raster attivo non pronta.");
      }
      scenePass.setPipeline(pipeline);
      scenePass.setBindGroup(0, engine.displayBindGroup);
    }
    scenePass.draw(3, 1, 0, 0);
  }
  scenePass.end();

  const presentPass = encoder.beginRenderPass({
    label: `${label} · checker finale`,
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
    }
    engine.vectorTextRunTextures.clear();
    engine.vectorTextBelowTexture = null;
    engine.vectorTextBelowView = null;
    engine.vectorTextAboveTexture = null;
    engine.vectorTextAboveView = null;
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
    const layout = engine.mixedSceneTextSegmentBindGroupLayout;
    if (!layout) {
      throw new Error("Layout delle cache testo segmentate non inizializzato.");
    }
    const texture = engine.device.createTexture({
      label: `Vector text ${key} viewport cache ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: "rgba8unorm-srgb",
      usage:
        GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING,
    });
    try {
      const view = texture.createView({
        label: `Vector text ${key} viewport cache view`,
      });
      const bindGroup = engine.device.createBindGroup({
        label: `Vector text ${key} segment bind group`,
        layout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: { buffer: engine.vectorTextCaptureUniformBuffer } },
          { binding: 2, resource: view },
          { binding: 3, resource: engine.sampler },
        ],
      });
      engine.vectorTextRunTextures.set(key, {
        texture,
        view,
        bindGroup,
        lastBounds: null,
        initialized: false,
      });
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
    format: "rgba8unorm-srgb",
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
  },
): Promise<Result> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const scene = requireMixedSceneStack(engine);
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const previousState = scene.captureState();
  const historyBefore = history?.targetKey
    ? scene.captureVectorHistoryState(history.targetKey)
    : null;
  const previousExcludedNodeId = engine.vectorTextPreviewExcludedNodeId;
  try {
    engine.callbacks.onStatus?.("Preparazione della scena raster/testo…", "working");
    await engine.waitForIdle();
    const result = mutate(scene);
    const selected = scene.selected;
    engine.vectorTextPreviewExcludedNodeId = selected.kind === "text"
      ? selected.textNodeId
      : null;
    clearVectorTextPresentationForTransaction(engine);
    engine.callbacks.onStatus?.("Composizione dei livelli raster/testo…", "working");
    await engine.rebuildMergedLayerSurfaces(
      "layer-switch",
      engine.getVectorTextViewState(),
      { reuseUnchangedRasterRuns: true },
    );
    engine.callbacks.onStatus?.("Scena raster/testo pronta.", "ok");
    if (history) {
      const targetKey = history.targetKey ?? history.addedKey?.(result);
      if (!targetKey) {
        throw new Error("Target vettoriale mancante per la cronologia.");
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
    scene.restoreState(previousState);
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
        "Stato incoerente dopo la modifica della scena mista: ricarica la pagina.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Modifica scena fallita (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina.`,
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
    throw new Error("Compositore GPU del blur testo non inizializzato.");
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
      memoryBytes: draw.blurWidth * draw.blurHeight,
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
    throw new Error("Filtro GPU del blur testo non inizializzato.");
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

export function ensureMixedSceneLinearTexture(engine: BrushEngine, width: number, height: number): void {
  if (!engine.mixedSceneStack?.visibleSemanticCount) {
    engine.mixedSceneLinearTexture?.destroy();
    engine.mixedSceneLinearTexture = null;
    engine.mixedSceneLinearView = null;
    engine.mixedSceneLinearWidth = 0;
    engine.mixedSceneLinearHeight = 0;
    engine.mixedScenePresentBindGroup = null;
    return;
  }
  if (
    engine.mixedSceneLinearTexture
    && engine.mixedSceneLinearView
    && engine.mixedSceneLinearWidth === width
    && engine.mixedSceneLinearHeight === height
  ) {
    return;
  }
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout) {
    throw new Error("Layout di presentazione della scena mista non inizializzato.");
  }
  const oldTexture = engine.mixedSceneLinearTexture;
  const texture = engine.device.createTexture({
    label: `Ordered mixed scene linear cache ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: MIXED_SCENE_LINEAR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
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
    engine.mixedSceneLinearTexture = texture;
    engine.mixedSceneLinearView = view;
    engine.mixedSceneLinearWidth = width;
    engine.mixedSceneLinearHeight = height;
    engine.mixedScenePresentBindGroup = bindGroup;
    engine.presentationCacheNeedsFullRebuild = true;
    oldTexture?.destroy();
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export function rebuildVectorTextDependentDisplayBindGroups(engine: BrushEngine): void {
  const belowView = engine.vectorTextBelowView ?? engine.transparentLayerView;
  const aboveView = engine.vectorTextAboveView ?? engine.transparentLayerView;
  engine.rasterStrokeDisplayScreenBindGroup = engine.device.createBindGroup({
    label: "Traccia display screen + semantic text bind group",
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
  upload[base + 24] = draw.blurBounds[0];
  upload[base + 25] = draw.blurBounds[1];
  upload[base + 26] = draw.blurBounds[2];
  upload[base + 27] = draw.blurBounds[3];
  if (vectorTextGpuDrawUsesMesh(draw)) {
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
): MixedSceneRasterSegmentResources {
  const layout = engine.mixedSceneRasterSegmentBindGroupLayout;
  if (!layout) {
    throw new Error("Layout del compositore raster/testo non inizializzato.");
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
        0,
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
      throw new Error("Layout Slug del testo vettoriale non inizializzato.");
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

export function writeVectorTextCaptureUniforms(engine: BrushEngine): void {
  const view = engine.vectorTextCaptureView ?? engine.getVectorTextViewState();
  const upload = engine.vectorTextCaptureUniformUpload;
  upload[0] = view.canvasWidth;
  upload[1] = view.canvasHeight;
  upload[2] = view.rotationCos;
  upload[3] = view.rotationSin;
  upload[4] = view.centerX;
  upload[5] = view.centerY;
  upload[6] = view.zoom;
  upload[7] = engine.vectorTextFastPresentationEnabled ? 1 : 0;
  engine.device.queue.writeBuffer(
    engine.vectorTextCaptureUniformBuffer,
    0,
    upload,
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
    throw new Error(`Raster ${item.rasterLayerId} assente durante il compositing.`);
  }
  return record.visible && record.opacity > 0 && record.hasContent;
}

export function publishMixedScene(engine: BrushEngine): void {
  const snapshot = engine.createMixedSceneSnapshot();
  if (snapshot) {
    try {
      engine.callbacks.onMixedSceneChange?.(snapshot);
    } catch (error) {
      console.error("Observer scena mista ignorato per preservare la transazione:", error);
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
    throw new Error("Scena raster/testo non abilitata per questa pagina.");
  }
  return engine.mixedSceneStack;
}

export function clearVectorTextPresentationForTransaction(engine: BrushEngine): void {
  // The transaction will rebuild bind groups and request one frame only after
  // all replacement resources are valid and presentation has been unfrozen.
  engine.clearVectorTextPresentation(undefined, true);
}
