import type {
  BrushEngine,
} from "./brush-engine";
import {
  VECTOR_TEXT_GPU_BLUR_COMPOSITE_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
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
import {
  assertShaderCompiled,
} from "./engine-gpu-utils";
import {
  VECTOR_TEXT_GPU_MAXIMUM_DRAWS,
} from "./engine-limits";
import {
  vectorTextGpuDrawUsesBlur,
  vectorTextGpuDrawUsesMesh,
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
import {
  type DirtyRect,
} from "./engine-stroke-types";
import {
  MixedSceneStack,
  type MixedSceneItem,
  type MixedSceneRasterRunKey,
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


export function createVectorTextRunBindGroup(
  engine: BrushEngine,
  key: Extract<VectorTextPlacement, `text-run:${string}`>,
  sourceView: GPUTextureView,
  fallbackView: GPUTextureView | null,
): GPUBindGroup {
  const layout = engine.mixedSceneTextSegmentBindGroupLayout;
  if (!layout) {
    throw new Error("Layout delle cache testo segmentate non inizializzato.");
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

export function rebuildVectorTextRunBindGroup(
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
