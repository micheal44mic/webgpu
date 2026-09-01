import type { BrushEngine } from "./brush-engine";
import {
  brushShader,
  displayShader,
  layerCompositeShader,
  lightGlazeCommitTileShader,
  lightGlazeCompositeMipShader,
  lightGlazeCompositeShader,
  lightGlazeDisplayShader,
  paintMipDownsampleShader,
  paintStackCompositeMipShader,
  singleRasterRgba16FloatDisplayShader,
  texturizedGrainShader,
  thicknessTailDisplayShader,
} from "./shaders";
import { rasterStrokeDisplayShader } from "./stroke-renderer";
import { LAYER_COLD_TILE_COMPOSITE_WGSL } from "./layer-cold-tile-composite-shader";
import {
  selectionBrushShader,
  selectionTexturizedGrainShader,
} from "./selection-clip-shaders";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  MAX_STAMPS_PER_BATCH,
  VECTOR_TEXT_GPU_MAXIMUM_DRAWS,
} from "./engine-limits";
import {
  MIXED_SCENE_LINEAR_FORMAT,
  mixedSceneClearShader,
  mixedScenePresentShader,
  mixedSceneRasterSegmentShader,
  mixedSceneShapePreviewShader,
  mixedSceneTextSegmentShader,
} from "./mixed-scene-compositor-shader";
import {
  rasterImageMipmapShader,
  rasterImageMixedSceneShader,
} from "./raster-image-shader";
import { assertShaderCompiled, createRenderPipelineAsync } from "./engine-gpu-utils";
import { vectorTextDisplayShader } from "./vector-text-shader";
import { initializeVectorTextGpuRenderer } from "./engine-vector-text-runtime";
import { VECTOR_TEXT_GPU_UNIFORM_STRIDE } from "./vector-text-gpu-shader";
import { MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES } from "./mixed-scene-raster-transform-preview";
import { type ActiveStroke, type DirtyRect, type Stamp } from "./engine-stroke-types";
import { paintMipDimensions } from "./engine-geometry";
import { type BrushSettings, type LayerPoint } from "./engine-types";
import { nextPaintStampSeed } from "./paint-stamp-generation-core";
import { usesStrokeGlazeRenderer } from "./engine-strategies";
import { clamp } from "./color";
import { startThicknessFactor } from "./thickness-dynamics";
import { flushClosingLightGlazeSessionBeforeNewStroke } from "./engine-glaze-runtime";
import { normalizeViewRotation } from "./engine-math";
import { ensureMixedScenePresentationResources } from "./mixed-scene-presentation-resources";
import { ensureMixedSceneVectorShapeResources } from "./mixed-scene-shape-resources";
import {
  ensureMixedSceneActiveBasePipelines,
  ensureMixedSceneActiveLightGlazePipelines,
  ensureMixedSceneActiveRasterStrokePipelines,
  ensureMixedSceneActiveThicknessTailPipelines,
} from "./mixed-scene-active-paint-resources";
import { strokeSymmetryCopiesIntersectDocument } from "./stroke-symmetry-core";
import {
  canvasOffsetToLayerOffset,
  clientToLayer,
  effectsScratchCanShrinkNow,
  invalidateActiveLayerBake,
} from "./engine-layer-runtime";
import { cloneDryBlendRenderBatch } from "./blend-renderer";
import { type RasterStrokeRect } from "./stroke-core";
import { type MixedSceneVectorKey } from "./mixed-scene-stack";
import {
  LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
  LAYER_BLEND_COMPOSITOR_WGSL,
  writeLayerBlendCompositorUniforms,
} from "./layer-blend-compositor";
import {
  LAYER_BLEND_MODE_CODES,
  LAYER_BLEND_MODE_ORDER,
} from "./layer-blend-modes";
import { LAYER_BLEND_FOLD_WGSL } from "./layer-blend-fold-shader";
import { packStampsIntoUpload } from "./engine-stamp-upload";
import { shapeLayerForStamp } from "./brush-shape-sequence-core.ts";
import {
  grainAssetIdForSettings,
  shapeAssetIdsForSettings,
  shapeAssetSequenceLengthForSettings,
  shapeAssetSequenceMatches,
  shapeInvertForSettings,
  shapeMaskFormatForSettings,
} from "./engine-brush-assets";
import {
  rasterBevelInfluenceBounds,
  rasterBevelVisualBounds,
  type RasterBevelRect,
  type RasterBevelStyle,
} from "./bevel-core";
import {
  rasterInnerShadowInfluenceBounds,
  rasterInnerShadowVisualBounds,
  rasterOuterShadowInfluenceBounds,
  rasterOuterShadowVisualBounds,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
  type RasterShadowRect,
} from "./shadow-core";

const mixedSceneSourceOverBlend: GPUBlendState = {
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

const mixedSceneSourceAtopBlend: GPUBlendState = {
  color: {
    srcFactor: "dst-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    // The clipping base owns the group's coverage. Preserve it exactly so
    // repeated children cannot accumulate floating-point alpha drift.
    srcFactor: "zero",
    dstFactor: "one",
    operation: "add",
  },
};

export type StaticResourceCreationPhase = "all" | "core" | "optional";

export async function finishStaticResourceCreation(
  engine: BrushEngine,
  phase: StaticResourceCreationPhase = "all",
): Promise<void> {
  const createCore = phase !== "optional";
  const createOptional = phase !== "core" && engine.mixedSceneEnabled;

  if (createCore) {
  engine.brushShaderModule = engine.device.createShaderModule({ label: "Brush WGSL", code: brushShader });
  engine.texturizedGrainShaderModule = engine.device.createShaderModule({
    label: "Texturized grain fragment WGSL",
    code: texturizedGrainShader,
  });
  engine.selectionBrushShaderModule = engine.device.createShaderModule({
    label: "Pixel Selection clipped brush WGSL",
    code: selectionBrushShader,
  });
  engine.selectionTexturizedGrainShaderModule = engine.device.createShaderModule({
    label: "Pixel Selection clipped grain WGSL",
    code: selectionTexturizedGrainShader,
  });
  engine.singleRasterDisplayShaderModule = engine.device.createShaderModule({
    label: "Single raster RGBA16F display WGSL",
    code: singleRasterRgba16FloatDisplayShader,
  });
  engine.displayShaderModule = engine.device.createShaderModule({ label: "Display WGSL", code: displayShader });
  engine.rasterStrokeDisplayShaderModule = engine.device.createShaderModule({
    label: "Stroke direct LOD 0 and coarse mip display WGSL",
    code: rasterStrokeDisplayShader(
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
      engine.bevelBoundingFieldEnabled,
    ),
  });
  engine.thicknessTailDisplayShaderModule = engine.device.createShaderModule({
    label: "Predictive thickness tail display WGSL",
    code: thicknessTailDisplayShader,
  });
  engine.lightGlazeDisplayShaderModule = engine.device.createShaderModule({
    label: "Light Glaze live display WGSL",
    code: lightGlazeDisplayShader,
  });
  engine.lightGlazeCompositeMipShaderModule = engine.device.createShaderModule({
    label: "Light Glaze composited mip 1 WGSL",
    code: lightGlazeCompositeMipShader,
  });
  engine.lightGlazeCompositeShaderModule = engine.device.createShaderModule({
    label: "Light Glaze final composite WGSL",
    code: lightGlazeCompositeShader,
  });
  engine.lightGlazeCommitTileShaderModule = engine.device.createShaderModule({
    label: "High precision glaze exact tile commit WGSL",
    code: lightGlazeCommitTileShader,
  });
  engine.lightGlazeClearShaderModule = engine.device.createShaderModule({
    label: "Rendering glaze dirty-region clear WGSL",
    code: mixedSceneClearShader,
  });
  engine.paintMipDownsampleShaderModule = engine.device.createShaderModule({
    label: "Paint display mip downsample WGSL",
    code: paintMipDownsampleShader,
  });
  engine.paintStackCompositeMipShaderModule = engine.device.createShaderModule({
    label: "Final raster stack composited mip 1 WGSL",
    code: paintStackCompositeMipShader,
  });
  engine.layerCompositeShaderModule = engine.device.createShaderModule({
    label: "Layer source-over fold WGSL",
    code: layerCompositeShader,
  });
  engine.layerColdTileCompositeShaderModule = engine.device.createShaderModule({
    label: "Direct authoritative cold tile fold WGSL",
    code: LAYER_COLD_TILE_COMPOSITE_WGSL,
  });
  engine.layerBlendFoldShaderModule = engine.device.createShaderModule({
    label: "Advanced document-space layer blend fold WGSL",
    code: LAYER_BLEND_FOLD_WGSL,
  });
  await Promise.all([
    assertShaderCompiled(engine.brushShaderModule, "brush"),
    assertShaderCompiled(engine.texturizedGrainShaderModule, "Texturized grain fragment"),
    assertShaderCompiled(engine.selectionBrushShaderModule, "Pixel Selection clipped brush"),
    assertShaderCompiled(
      engine.selectionTexturizedGrainShaderModule,
      "Pixel Selection clipped texturized grain",
    ),
    assertShaderCompiled(engine.singleRasterDisplayShaderModule, "single raster RGBA16F display"),
    assertShaderCompiled(engine.displayShaderModule, "display"),
    assertShaderCompiled(engine.rasterStrokeDisplayShaderModule, "Stroke display"),
    assertShaderCompiled(
      engine.thicknessTailDisplayShaderModule,
      "predictive thickness tail display",
    ),
    assertShaderCompiled(engine.lightGlazeDisplayShaderModule, "Light Glaze live display"),
    assertShaderCompiled(
      engine.lightGlazeCompositeMipShaderModule,
      "Light Glaze composited mip 1",
    ),
    assertShaderCompiled(engine.lightGlazeCompositeShaderModule, "Light Glaze final composite"),
    assertShaderCompiled(
      engine.lightGlazeCommitTileShaderModule,
      "High precision glaze exact tile commit",
    ),
    assertShaderCompiled(
      engine.lightGlazeClearShaderModule,
      "rendering glaze dirty-region clear",
    ),
    assertShaderCompiled(engine.paintMipDownsampleShaderModule, "paint display mip downsample"),
    assertShaderCompiled(
      engine.paintStackCompositeMipShaderModule,
      "final raster stack composited mip 1",
    ),
    assertShaderCompiled(engine.layerCompositeShaderModule, "layer source-over fold"),
    assertShaderCompiled(
      engine.layerColdTileCompositeShaderModule,
      "direct authoritative cold tile fold",
    ),
    assertShaderCompiled(
      engine.layerBlendFoldShaderModule,
      "advanced document-space layer blend fold",
    ),
  ]);

  const lightGlazeClearPipelineLayout = engine.device.createPipelineLayout({
    label: "Rendering glaze dirty-region clear pipeline layout",
    bindGroupLayouts: [],
  });
  const createLightGlazeClearPipeline = (
    label: string,
    format: GPUTextureFormat,
  ): GPURenderPipeline => engine.device.createRenderPipeline({
    label,
    layout: lightGlazeClearPipelineLayout,
    vertex: {
      module: engine.lightGlazeClearShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.lightGlazeClearShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  engine.lightGlazeClearR16Pipeline = createLightGlazeClearPipeline(
    "Light Glaze R16F stale dirty-region clear pipeline",
    "r16float",
  );
  engine.lightGlazeClearRgba16FloatPipeline = createLightGlazeClearPipeline(
    "Uniformed/Intense RGBA16F stale dirty-region clear pipeline",
    "rgba16float",
  );
  }

  const displayPipelineLayout = engine.device.createPipelineLayout({
    label: "Display pipeline layout",
    bindGroupLayouts: [engine.displayBindGroupLayout],
  });

  if (createCore) {
  engine.displayPipeline = engine.device.createRenderPipeline({
    label: "Single raster RGBA16F display pipeline",
    layout: displayPipelineLayout,
    vertex: {
      module: engine.singleRasterDisplayShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.singleRasterDisplayShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: engine.canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  }

  if (createOptional) {
    await ensureMixedSceneVectorShapeResources(engine);
    await ensureMixedScenePresentationResources(engine);
    engine.vectorTextDisplayShaderModule = engine.device.createShaderModule({
      label: "Dual viewport vector text mixed-layer display WGSL",
      code: vectorTextDisplayShader,
    });
    engine.mixedSceneRasterSegmentShaderModule ??= engine.device.createShaderModule({
      label: "Mixed scene raster segment WGSL",
      code: mixedSceneRasterSegmentShader,
    });
    engine.mixedSceneTextSegmentShaderModule ??= engine.device.createShaderModule({
      label: "Mixed scene text segment WGSL",
      code: mixedSceneTextSegmentShader,
    });
    engine.mixedSceneShapePreviewShaderModule ??= engine.device.createShaderModule({
      label: "Mixed scene live shape preview WGSL",
      code: mixedSceneShapePreviewShader,
    });
    engine.mixedSceneClearShaderModule ??= engine.device.createShaderModule({
      label: "Mixed scene partial clear WGSL",
      code: mixedSceneClearShader,
    });
    engine.mixedScenePresentShaderModule ??= engine.device.createShaderModule({
      label: "Mixed scene checker presentation WGSL",
      code: mixedScenePresentShader,
    });
    engine.layerBlendCompositorShaderModule = engine.device.createShaderModule({
      label: "Ordered layer blend ping-pong WGSL",
      code: LAYER_BLEND_COMPOSITOR_WGSL,
    });
    engine.rasterImageMipmapShaderModule = engine.device.createShaderModule({
      label: "Raster image premultiplied sRGB mipmap WGSL",
      code: rasterImageMipmapShader,
    });
    engine.rasterImageMixedSceneShaderModule = engine.device.createShaderModule({
      label: "Raster image mixed-scene WGSL",
      code: rasterImageMixedSceneShader,
    });
    const vectorTextGpuRendererPromise = initializeVectorTextGpuRenderer(engine);
    await Promise.all([
      assertShaderCompiled(
        engine.vectorTextDisplayShaderModule,
        "dual viewport vector text mixed-layer display",
      ),
      assertShaderCompiled(
        engine.mixedSceneRasterSegmentShaderModule,
        "mixed scene raster segment",
      ),
      assertShaderCompiled(
        engine.mixedSceneTextSegmentShaderModule,
        "mixed scene text segment",
      ),
      assertShaderCompiled(
        engine.mixedSceneShapePreviewShaderModule,
        "mixed scene live shape preview",
      ),
      assertShaderCompiled(engine.mixedSceneClearShaderModule, "mixed scene partial clear"),
      assertShaderCompiled(
        engine.mixedScenePresentShaderModule,
        "mixed scene checker presentation",
      ),
      assertShaderCompiled(
        engine.layerBlendCompositorShaderModule,
        "ordered layer blend ping-pong",
      ),
      assertShaderCompiled(
        engine.rasterImageMipmapShaderModule,
        "raster image premultiplied mipmap",
      ),
      assertShaderCompiled(
        engine.rasterImageMixedSceneShaderModule,
        "raster image mixed-scene compositor",
      ),
      vectorTextGpuRendererPromise,
    ]);
    engine.vectorTextDisplayBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Dual viewport vector text mixed-layer display bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    engine.mixedSceneRasterSegmentBindGroupLayout ??= engine.device.createBindGroupLayout({
      label: "Mixed scene raster segment bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            minBindingSize: MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES,
          },
        },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    engine.mixedSceneTextSegmentBindGroupLayout ??= engine.device.createBindGroupLayout({
      label: "Mixed scene text segment bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    engine.mixedSceneShapePreviewBindGroupLayout ??= engine.device.createBindGroupLayout({
      label: "Mixed scene live shape preview bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    engine.mixedSceneShapePreviewUniformBuffer ??= engine.device.createBuffer({
      label: "Mixed scene live shape preview uniforms",
      size: engine.mixedSceneShapePreviewUniformUpload.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    engine.mixedSceneShapePreviewBindGroup ??= engine.device.createBindGroup({
      label: "Mixed scene live shape preview bind group",
      layout: engine.mixedSceneShapePreviewBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: { buffer: engine.mixedSceneShapePreviewUniformBuffer } },
      ],
    });
    engine.mixedScenePresentBindGroupLayout ??= engine.device.createBindGroupLayout({
      label: "Mixed scene presentation bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    engine.mixedSceneBackgroundBindGroupLayout ??= engine.device.createBindGroupLayout({
      label: "Mixed scene document background bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    engine.mixedSceneBackgroundBindGroup ??= engine.device.createBindGroup({
      label: "Mixed scene document background bind group",
      layout: engine.mixedSceneBackgroundBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      ],
    });
    engine.layerBlendCompositorBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Ordered layer blend ping-pong bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
      ],
    });
    const blendUniformAlignment = engine.device.limits.minUniformBufferOffsetAlignment;
    engine.layerBlendCompositorUniformStride = Math.ceil(
      LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE / blendUniformAlignment,
    ) * blendUniformAlignment;
    const blendUniformRecordCount = LAYER_BLEND_MODE_ORDER.length * 2;
    const blendUniformBytes = engine.layerBlendCompositorUniformStride
      * blendUniformRecordCount;
    engine.layerBlendCompositorUniformBuffer = engine.device.createBuffer({
      label: `Ordered layer blend uniforms ${blendUniformRecordCount} records`,
      size: blendUniformBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const blendUniformUpload = new Uint32Array(blendUniformBytes / 4);
    const blendUniformWordStride = engine.layerBlendCompositorUniformStride / 4;
    (["source-over", "source-atop"] as const).forEach((operator, operatorIndex) => {
      LAYER_BLEND_MODE_ORDER.forEach((mode) => {
        writeLayerBlendCompositorUniforms(
          blendUniformUpload,
          mode,
          operator,
          (operatorIndex * LAYER_BLEND_MODE_ORDER.length + LAYER_BLEND_MODE_CODES[mode])
            * blendUniformWordStride,
        );
      });
    });
    engine.device.queue.writeBuffer(
      engine.layerBlendCompositorUniformBuffer,
      0,
      blendUniformUpload,
    );
    engine.rasterImageMipmapBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Raster image mipmap bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    engine.rasterImageMixedSceneBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Raster image mixed-scene bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    engine.rasterImageSampler = engine.device.createSampler({
      label: "Raster image trilinear clamp sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      maxAnisotropy: 8,
    });
    const vectorTextPipelineLayout = engine.device.createPipelineLayout({
      label: "Dual viewport vector text mixed-layer display pipeline layout",
      bindGroupLayouts: [engine.vectorTextDisplayBindGroupLayout],
    });
    const vectorTextDisplayPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Dual viewport vector text mixed-layer display pipeline",
      layout: vectorTextPipelineLayout,
      vertex: {
        module: engine.vectorTextDisplayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.vectorTextDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    engine.vectorTextGpuBlurFilterUniformBuffer ??= engine.device.createBuffer({
      label: `Vector text GPU blur filter uniforms ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS}`,
      size: VECTOR_TEXT_GPU_MAXIMUM_DRAWS * VECTOR_TEXT_GPU_UNIFORM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    engine.vectorTextGpuBlurSampler ??= engine.device.createSampler({
      label: "Vector text GPU blur linear clamp sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });
    const mixedRasterPipelineLayout = engine.device.createPipelineLayout({
      label: "Mixed scene raster segment pipeline layout",
      bindGroupLayouts: [engine.mixedSceneRasterSegmentBindGroupLayout],
    });
    const mixedSceneRasterSegmentPipelinePromise = engine.mixedSceneRasterSegmentPipeline
      ? Promise.resolve(engine.mixedSceneRasterSegmentPipeline)
      : createRenderPipelineAsync(engine.device, {
      label: "Mixed scene raster segment source-over pipeline",
      layout: mixedRasterPipelineLayout,
      vertex: { module: engine.mixedSceneRasterSegmentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneRasterSegmentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedSceneRasterSegmentSourceAtopPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Mixed scene raster segment source-atop pipeline",
      layout: mixedRasterPipelineLayout,
      vertex: { module: engine.mixedSceneRasterSegmentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneRasterSegmentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceAtopBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedTextPipelineLayout = engine.device.createPipelineLayout({
      label: "Mixed scene text segment pipeline layout",
      bindGroupLayouts: [engine.mixedSceneTextSegmentBindGroupLayout],
    });
    const mixedSceneTextSegmentPipelinePromise = engine.mixedSceneTextSegmentPipeline
      ? Promise.resolve(engine.mixedSceneTextSegmentPipeline)
      : createRenderPipelineAsync(engine.device, {
      label: "Mixed scene text segment source-over pipeline",
      layout: mixedTextPipelineLayout,
      vertex: { module: engine.mixedSceneTextSegmentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneTextSegmentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedSceneTextSegmentSourceAtopPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Mixed scene vector segment source-atop pipeline",
      layout: mixedTextPipelineLayout,
      vertex: { module: engine.mixedSceneTextSegmentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneTextSegmentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceAtopBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedSceneShapePreviewPipelinePromise = engine.mixedSceneShapePreviewPipeline
      ? Promise.resolve(engine.mixedSceneShapePreviewPipeline)
      : createRenderPipelineAsync(engine.device, {
      label: "Mixed scene live shape preview source-over pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Mixed scene live shape preview pipeline layout",
        bindGroupLayouts: [engine.mixedSceneShapePreviewBindGroupLayout],
      }),
      vertex: {
        module: engine.mixedSceneShapePreviewShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.mixedSceneShapePreviewShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const rasterImageMipmapPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Raster image premultiplied sRGB mipmap pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Raster image mipmap pipeline layout",
        bindGroupLayouts: [engine.rasterImageMipmapBindGroupLayout],
      }),
      vertex: {
        module: engine.rasterImageMipmapShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.rasterImageMipmapShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const rasterImagePremultiplyPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Raster image straight-sRGB to linear-premultiplied pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Raster image premultiply pipeline layout",
        bindGroupLayouts: [engine.rasterImageMipmapBindGroupLayout],
      }),
      vertex: {
        module: engine.rasterImageMipmapShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.rasterImageMipmapShaderModule,
        entryPoint: "fragmentPremultiplyMain",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const rasterImageMixedScenePipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Raster image mixed-scene trilinear source-over pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Raster image mixed-scene pipeline layout",
        bindGroupLayouts: [engine.rasterImageMixedSceneBindGroupLayout],
      }),
      vertex: {
        module: engine.rasterImageMixedSceneShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.rasterImageMixedSceneShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceOverBlend }],
      },
      primitive: { topology: "triangle-strip", cullMode: "none" },
    });
    const mixedSceneClearPipelinePromise = engine.mixedSceneClearPipeline
      ? Promise.resolve(engine.mixedSceneClearPipeline)
      : createRenderPipelineAsync(engine.device, {
      label: "Mixed scene partial transparent clear pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Mixed scene partial transparent clear pipeline layout",
        bindGroupLayouts: [],
      }),
      vertex: { module: engine.mixedSceneClearShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneClearShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedScenePresentPipelinePromise = engine.mixedScenePresentPipeline
      ? Promise.resolve(engine.mixedScenePresentPipeline)
      : createRenderPipelineAsync(engine.device, {
      label: "Mixed scene checker presentation pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Mixed scene checker presentation pipeline layout",
        bindGroupLayouts: [engine.mixedScenePresentBindGroupLayout],
      }),
      vertex: { module: engine.mixedScenePresentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedScenePresentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedSceneBackgroundPipelinePromise = engine.mixedSceneBackgroundPipeline
      ? Promise.resolve(engine.mixedSceneBackgroundPipeline)
      : createRenderPipelineAsync(engine.device, {
      label: "Mixed scene document background pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Mixed scene document background pipeline layout",
        bindGroupLayouts: [engine.mixedSceneBackgroundBindGroupLayout],
      }),
      vertex: { module: engine.mixedScenePresentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedScenePresentShaderModule,
        entryPoint: "backgroundFragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedSceneClippingScratchCompositePipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Mixed scene clipping scratch source-over pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Mixed scene clipping scratch pipeline layout",
        bindGroupLayouts: [engine.mixedScenePresentBindGroupLayout],
      }),
      vertex: { module: engine.mixedScenePresentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedScenePresentShaderModule,
        entryPoint: "sourceFragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const layerBlendCompositorPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Ordered layer blend ping-pong pipeline",
      layout: engine.device.createPipelineLayout({
        label: "Ordered layer blend ping-pong pipeline layout",
        bindGroupLayouts: [engine.layerBlendCompositorBindGroupLayout!],
      }),
      vertex: {
        module: engine.layerBlendCompositorShaderModule!,
        entryPoint: "layerBlendCompositorVertexMain",
      },
      fragment: {
        module: engine.layerBlendCompositorShaderModule!,
        entryPoint: "layerBlendCompositorFragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    const layerBlendViewportDocumentMaskPipelinePromise = createRenderPipelineAsync(engine.device, {
      label: "Ordered clipping document-mask accumulator",
      layout: engine.device.createPipelineLayout({
        label: "Ordered clipping document-mask pipeline layout",
        bindGroupLayouts: [engine.layerBlendCompositorBindGroupLayout!],
      }),
      vertex: {
        module: engine.layerBlendCompositorShaderModule!,
        entryPoint: "layerBlendCompositorVertexMain",
      },
      fragment: {
        module: engine.layerBlendCompositorShaderModule!,
        entryPoint: "layerBlendDocumentMaskFragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: mixedSceneSourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    // These programs are independent and use asynchronous WebGPU compilation.
    // Starting them as one batch removes the sum of their individual waits
    // from semantic-document startup while preserving atomic publication.
    const [
      vectorTextDisplayPipeline,
      mixedSceneRasterSegmentPipeline,
      mixedSceneRasterSegmentSourceAtopPipeline,
      mixedSceneTextSegmentPipeline,
      mixedSceneTextSegmentSourceAtopPipeline,
      mixedSceneShapePreviewPipeline,
      rasterImageMipmapPipeline,
      rasterImagePremultiplyPipeline,
      rasterImageMixedScenePipeline,
      mixedSceneClearPipeline,
      mixedScenePresentPipeline,
      mixedSceneBackgroundPipeline,
      mixedSceneClippingScratchCompositePipeline,
      layerBlendCompositorPipeline,
      layerBlendViewportDocumentMaskPipeline,
    ] = await Promise.all([
      vectorTextDisplayPipelinePromise,
      mixedSceneRasterSegmentPipelinePromise,
      mixedSceneRasterSegmentSourceAtopPipelinePromise,
      mixedSceneTextSegmentPipelinePromise,
      mixedSceneTextSegmentSourceAtopPipelinePromise,
      mixedSceneShapePreviewPipelinePromise,
      rasterImageMipmapPipelinePromise,
      rasterImagePremultiplyPipelinePromise,
      rasterImageMixedScenePipelinePromise,
      mixedSceneClearPipelinePromise,
      mixedScenePresentPipelinePromise,
      mixedSceneBackgroundPipelinePromise,
      mixedSceneClippingScratchCompositePipelinePromise,
      layerBlendCompositorPipelinePromise,
      layerBlendViewportDocumentMaskPipelinePromise,
      ensureMixedSceneActiveBasePipelines(engine),
      ensureMixedSceneActiveRasterStrokePipelines(engine),
      ensureMixedSceneActiveThicknessTailPipelines(engine),
      ensureMixedSceneActiveLightGlazePipelines(engine),
    ]);
    if (engine.deviceLostError) throw engine.deviceLostError;
    engine.vectorTextDisplayPipeline = vectorTextDisplayPipeline;
    engine.mixedSceneRasterSegmentPipeline = mixedSceneRasterSegmentPipeline;
    engine.mixedSceneRasterSegmentSourceAtopPipeline =
      mixedSceneRasterSegmentSourceAtopPipeline;
    engine.mixedSceneTextSegmentPipeline = mixedSceneTextSegmentPipeline;
    engine.mixedSceneTextSegmentSourceAtopPipeline = mixedSceneTextSegmentSourceAtopPipeline;
    engine.mixedSceneShapePreviewPipeline = mixedSceneShapePreviewPipeline;
    engine.rasterImageMipmapPipeline = rasterImageMipmapPipeline;
    engine.rasterImagePremultiplyPipeline = rasterImagePremultiplyPipeline;
    engine.rasterImageMixedScenePipeline = rasterImageMixedScenePipeline;
    engine.mixedSceneClearPipeline = mixedSceneClearPipeline;
    engine.mixedScenePresentPipeline = mixedScenePresentPipeline;
    engine.mixedSceneBackgroundPipeline = mixedSceneBackgroundPipeline;
    engine.mixedSceneClippingScratchCompositePipeline =
      mixedSceneClippingScratchCompositePipeline;
    engine.layerBlendCompositorPipeline = layerBlendCompositorPipeline;
    engine.layerBlendViewportDocumentMaskPipeline =
      layerBlendViewportDocumentMaskPipeline;
  }
}

export async function ensureAdvancedCanvasPresentationPipelines(
  engine: BrushEngine,
): Promise<void> {
  if (engine.advancedCanvasPresentationPipelinesReady) return;
  if (engine.advancedCanvasPresentationPipelinesPromise) {
    await engine.advancedCanvasPresentationPipelinesPromise;
    return;
  }
  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Advanced canvas display pipeline layout",
      bindGroupLayouts: [engine.displayBindGroupLayout],
    });
    const displayPipeline = await createRenderPipelineAsync(engine.device, {
      label: "Composite canvas display pipeline",
      layout,
      vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.displayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    const finalRasterStackDisplayPipeline = await createRenderPipelineAsync(engine.device, {
      label: "Final raster stack mip display pipeline",
      layout,
      vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.displayShaderModule,
        entryPoint: "finalStackFragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    engine.displayPipeline = displayPipeline;
    engine.finalRasterStackDisplayPipeline = finalRasterStackDisplayPipeline;
    engine.advancedCanvasPresentationPipelinesReady = true;
  })();
  engine.advancedCanvasPresentationPipelinesPromise = initialization;
  try {
    await initialization;
  } finally {
    if (engine.advancedCanvasPresentationPipelinesPromise === initialization) {
      engine.advancedCanvasPresentationPipelinesPromise = null;
    }
  }
}

export async function ensureRasterStrokePresentationPipeline(
  engine: BrushEngine,
): Promise<void> {
  if (engine.rasterStrokePresentationPipelineReady) return;
  if (engine.rasterStrokePresentationPipelinePromise) {
    await engine.rasterStrokePresentationPipelinePromise;
    return;
  }
  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Stroke display pipeline layout",
      bindGroupLayouts: [
        engine.rasterStrokeDisplayScreenBindGroupLayout,
        engine.rasterStrokeDisplaySourceBindGroupLayout,
      ],
    });
    engine.rasterStrokeDisplayPipeline = await createRenderPipelineAsync(engine.device, {
      label: "Stroke direct LOD 0 and coarse mip display pipeline",
      layout,
      vertex: {
        module: engine.rasterStrokeDisplayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.rasterStrokeDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    engine.rasterStrokePresentationPipelineReady = true;
  })();
  engine.rasterStrokePresentationPipelinePromise = initialization;
  try {
    await initialization;
  } finally {
    if (engine.rasterStrokePresentationPipelinePromise === initialization) {
      engine.rasterStrokePresentationPipelinePromise = null;
    }
  }
}

export async function ensureThicknessTailPresentationPipeline(
  engine: BrushEngine,
): Promise<void> {
  if (engine.thicknessTailPresentationPipelineReady) return;
  if (engine.thicknessTailPresentationPipelinePromise) {
    await engine.thicknessTailPresentationPipelinePromise;
    return;
  }
  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Predictive thickness tail display pipeline layout",
      bindGroupLayouts: [engine.thicknessTailDisplayBindGroupLayout],
    });
    engine.thicknessTailDisplayPipeline = await createRenderPipelineAsync(engine.device, {
      label: "Predictive thickness tail display pipeline",
      layout,
      vertex: {
        module: engine.thicknessTailDisplayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: engine.thicknessTailDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    engine.thicknessTailPresentationPipelineReady = true;
  })();
  engine.thicknessTailPresentationPipelinePromise = initialization;
  try {
    await initialization;
  } finally {
    if (engine.thicknessTailPresentationPipelinePromise === initialization) {
      engine.thicknessTailPresentationPipelinePromise = null;
    }
  }
}

export async function ensureLightGlazePresentationPipelines(
  engine: BrushEngine,
): Promise<void> {
  if (engine.lightGlazePresentationPipelinesReady) return;
  if (engine.lightGlazePresentationPipelinesPromise) {
    await engine.lightGlazePresentationPipelinesPromise;
    return;
  }
  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Glaze display pipeline layout",
      bindGroupLayouts: [engine.lightGlazeDisplayBindGroupLayout],
    });
    const lightGlazeDisplayPipeline = await createRenderPipelineAsync(engine.device, {
      label: "Glaze live display pipeline",
      layout,
      vertex: { module: engine.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.lightGlazeDisplayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    const lightGlazeFinalRasterStackDisplayPipeline = await createRenderPipelineAsync(
      engine.device,
      {
        label: "Glaze live final raster stack display pipeline",
        layout,
        vertex: { module: engine.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: engine.lightGlazeDisplayShaderModule,
          entryPoint: "finalStackFragmentMain",
          targets: [{ format: engine.canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      },
    );
    engine.lightGlazeDisplayPipeline = lightGlazeDisplayPipeline;
    engine.lightGlazeFinalRasterStackDisplayPipeline =
      lightGlazeFinalRasterStackDisplayPipeline;
    engine.lightGlazePresentationPipelinesReady = true;
  })();
  engine.lightGlazePresentationPipelinesPromise = initialization;
  try {
    await initialization;
  } finally {
    if (engine.lightGlazePresentationPipelinesPromise === initialization) {
      engine.lightGlazePresentationPipelinesPromise = null;
    }
  }
}

export function encodeRasterStrokeDisplayPyramid(engine: BrushEngine, 
  encoder: GPUCommandEncoder,
  baseDirtyRect: DirtyRect | null,
  selectedMipLevel: number,
): { passes: number; updatedPixels: number } {
  const renderer = engine.rasterStrokeRenderer;
  if (!renderer || !engine.styleStackActive()) {
    return { passes: 0, updatedPixels: 0 };
  }
  const previousValidThroughLevel = engine.rasterStrokeMipValidThroughLevel;
  const baseChanged = baseDirtyRect !== null;
  let sourceDirtyRect = baseDirtyRect
    ? engine.downsampleDirtyRect(baseDirtyRect, 1)
    : null;
  let passes = 0;
  let updatedPixels = 0;

  // Il renderer materializza già il mip logico 1 direttamente da layer +
  // coverage. Solo i livelli 2+ vengono derivati e conservati nella catena.
  for (let mipLevel = 2; mipLevel <= selectedMipLevel; mipLevel += 1) {
    const dimensions = paintMipDimensions(mipLevel);
    const needsFullBuild = mipLevel > previousValidThroughLevel;
    const targetDirtyRect = needsFullBuild
      ? { x: 0, y: 0, ...dimensions }
      : sourceDirtyRect
        ? engine.downsampleDirtyRect(sourceDirtyRect, mipLevel)
        : null;
    if (!targetDirtyRect || targetDirtyRect.width <= 0 || targetDirtyRect.height <= 0) {
      sourceDirtyRect = null;
      continue;
    }

    const pass = encoder.beginRenderPass({
      label: needsFullBuild
        ? `Build full Stroke styled logical mip ${mipLevel}`
        : `Update Stroke styled logical mip ${mipLevel} dirty rect`,
      colorAttachments: [{
        view: renderer.mipViews[mipLevel - 1],
        loadOp: needsFullBuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(engine.paintMipDownsamplePipeline);
    pass.setBindGroup(0, engine.rasterStrokeMipDownsampleBindGroups[mipLevel - 2]);
    if (!needsFullBuild) {
      pass.setScissorRect(
        targetDirtyRect.x,
        targetDirtyRect.y,
        targetDirtyRect.width,
        targetDirtyRect.height,
      );
    }
    pass.draw(3, 1, 0, 0);
    pass.end();
    passes += 1;
    updatedPixels += targetDirtyRect.width * targetDirtyRect.height;
    sourceDirtyRect = targetDirtyRect;
  }

  if (baseChanged) {
    engine.rasterStrokeMipValidThroughLevel = Math.max(1, selectedMipLevel);
  } else if (selectedMipLevel > previousValidThroughLevel) {
    engine.rasterStrokeMipValidThroughLevel = selectedMipLevel;
  }
  return { passes, updatedPixels };
}

export function emitStamp(engine: BrushEngine, point: LayerPoint, directionX: number, directionY: number): void {
  const stroke = engine.activeStroke;
  if (!stroke) {
    return;
  }
  const generationSettings = stroke.renderSettings;
  const pressure = clamp(point.pressure, 0.01, 1);
  const baseRadius = Math.max(0.5, generationSettings.size * 0.5);
  const liveThicknessFactor = stroke.thicknessDynamicsNeutral
    ? 1
    : startThicknessFactor(
      stroke.thicknessSettings.startThickness,
      Math.max(0, point.timeMs - stroke.startedAtMs),
    );
  const radius = stroke.thicknessDynamicsNeutral
    ? baseRadius
    : baseRadius * liveThicknessFactor;
  const stampOrdinal = Math.max(0, engine.seedSequence - stroke.seedSequenceBeforeStroke);
  const seed = nextPaintStampSeed(engine.seedSequence++);
  const shapeLayerCount = shapeAssetSequenceLengthForSettings(generationSettings);
  const stamp: Stamp = {
    x: point.x,
    y: point.y,
    radius,
    pressure,
    seed,
    shapeLayer: shapeLayerForStamp(
      generationSettings.shapeSequenceMode,
      stampOrdinal,
      seed,
      shapeLayerCount,
    ),
    directionX,
    directionY,
    historyActionId: stroke.historyActionId,
    symmetryMode: stroke.symmetryMode,
    symmetryAngleRadians: stroke.symmetryAngleRadians,
  };

  if (stroke.thicknessTailHoldback) {
    stroke.heldThicknessStamps.push({
      stamp,
      timeMs: point.timeMs,
      baseRadius,
      liveThicknessFactor,
    });
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.thicknessDynamicsHeldBaseStamps += 1;
      engine.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps = Math.max(
        engine.activeStrokeProfile.thicknessDynamicsMaximumHeldBaseStamps,
        stroke.heldThicknessStamps.length - stroke.heldThicknessHead,
      );
    }
    // The permanent layer still waits for the exact lift time, but the
    // predictive WebGPU tail must be presented immediately.
    engine.displayDirty = true;
    engine.requestRender();
    return;
  }

  commitThicknessStamp(engine, stamp, stroke);
}

export async function waitForRenderPump(engine: BrushEngine): Promise<void> {
  throwIfRenderUnavailable(engine);
  if (
    hasPendingRenderWork(engine)
    && !engine.layerPresentationFrozen
    && engine.frameRequest === null
  ) {
    engine.requestRender();
  }
  let timer = 0;
  let wakeFrame = 0;
  let timedOut = false;
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        wakeFrame = requestAnimationFrame(() => {
          wakeFrame = 0;
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        timer = window.setTimeout(() => {
          timedOut = true;
          timer = 0;
          resolve();
        }, 50);
      }),
      engine.deviceLostSignal.then((error) => Promise.reject(error)),
    ]);
  } finally {
    if (timer !== 0) window.clearTimeout(timer);
    if (wakeFrame !== 0) cancelAnimationFrame(wakeFrame);
  }
  if (
    timedOut
    && hasPendingRenderWork(engine)
    && !engine.layerPresentationFrozen
  ) {
    if (engine.frameRequest !== null) {
      cancelAnimationFrame(engine.frameRequest);
      engine.frameRequest = null;
    }
    runRenderFrame(engine, performance.now());
  }
  throwIfRenderUnavailable(engine);
}

export function flushPendingWorkBeforeSettingsChange(engine: BrushEngine): void {
  if (!engine.initialized || engine.activeStroke || engine.historyBusy) {
    return;
  }

  // Pointer-up may leave the last interactive batch queued until the next
  // animation frame. Preserve the settings that produced those stamps before
  // a control change can replace them. For Light Glaze this also guarantees
  // that the old accumulator is committed before another blend mode starts.
  flushClosingLightGlazeSessionBeforeNewStroke(engine);
  if (
    engine.lightGlazeSession
    || (engine.pendingStamps.length === 0 && engine.pendingBlendBatches.length === 0)
  ) {
    return;
  }

  let iterations = 0;
  // Il drenaggio Blend è a budget di pixel: nel caso peggiore (ROI enormi)
  // un frame consuma un solo batch, quindi il tetto usa quel minimo garantito.
  const maximumIterations = Math.ceil(engine.pendingStamps.length / MAX_STAMPS_PER_BATCH)
    + engine.pendingBlendBatches.length
    + 2;
  const previousForcedDrain = engine.forceSynchronousBlendDrain;
  engine.forceSynchronousBlendDrain = true;
  try {
    while (engine.pendingStamps.length > 0 || engine.pendingBlendBatches.length > 0) {
      if (engine.frameRequest !== null) {
        cancelAnimationFrame(engine.frameRequest);
        engine.frameRequest = null;
      }
      const pendingBeforeRender = engine.pendingStamps.length + engine.pendingBlendBatches.length;
      engine.renderFrame(performance.now());
      iterations += 1;
      if (
        engine.pendingStamps.length + engine.pendingBlendBatches.length >= pendingBeforeRender
        || iterations > maximumIterations
      ) {
        throw new Error("Unable to finalize stamps before changing settings.");
      }
    }
  } finally {
    engine.forceSynchronousBlendDrain = previousForcedDrain;
  }
}

export function commitThicknessStamp(engine: BrushEngine, stamp: Stamp, stroke: ActiveStroke): void {
  if (stamp.radius <= 0) {
    return;
  }
  const generationSettings = stroke.renderSettings;
  const jitterReach = stamp.radius * 2 * (
    generationSettings.positionJitterLinear + generationSettings.positionJitterLateral
  );

  const conservativeReach = stamp.radius + jitterReach;
  if (!strokeSymmetryCopiesIntersectDocument(
    stamp.x,
    stamp.y,
    conservativeReach,
    conservativeReach,
    stroke.symmetryMode,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
    stroke.symmetryAngleRadians,
  )) {
    return;
  }

  const deferredPreview = engine.deferredStrokePreview;
  if (
    stroke.deferredPreview
    && deferredPreview?.historyActionId === stroke.historyActionId
  ) {
    if (deferredPreview.stamps.length >= MAX_STAMPS_PER_BATCH) {
      throw new Error(
        `Quick Line preview exceeds ${MAX_STAMPS_PER_BATCH.toLocaleString()} stamps.`,
      );
    }
    deferredPreview.stamps.push(stamp);
    if (usesStrokeGlazeRenderer(deferredPreview.settings)) {
      engine.pendingStamps.push(stamp);
    }
  } else {
    engine.pendingStamps.push(stamp);
  }
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.baseStamps += 1;
  }
  engine.displayDirty = true;
  engine.requestRender();
}

export function applyViewRotation(engine: BrushEngine, 
  angle: number,
  anchorClientX?: number,
  anchorClientY?: number,
): void {
  const normalizedAngle = normalizeViewRotation(angle);
  if (Math.abs(normalizedAngle - engine.viewRotation) < 1e-12) {
    return;
  }
  engine.invalidateAdaptivePreview();
  const rectangle = engine.canvas.getBoundingClientRect();
  const resolvedAnchorX = anchorClientX ?? rectangle.left + rectangle.width * 0.5;
  const resolvedAnchorY = anchorClientY ?? rectangle.top + rectangle.height * 0.5;
  const anchorBefore = clientToLayer(engine, resolvedAnchorX, resolvedAnchorY);
  const screen = clientToCanvasPixels(engine, resolvedAnchorX, resolvedAnchorY);

  engine.viewRotation = normalizedAngle;
  engine.viewRotationCos = Math.cos(normalizedAngle);
  engine.viewRotationSin = Math.sin(normalizedAngle);
  const anchorOffset = canvasOffsetToLayerOffset(engine, 
    screen.x - engine.canvas.width * 0.5,
    screen.y - engine.canvas.height * 0.5,
  );
  engine.viewCenterX = anchorBefore.x - anchorOffset.x;
  engine.viewCenterY = anchorBefore.y - anchorOffset.y;
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.callbacks.onViewRotationChange?.(
    engine.getViewRotationDegrees(),
    engine.viewRotationSnappedToZero,
  );
  engine.notifyViewChange();
  engine.requestRender();
}

export function drainBlendPlanner(engine: BrushEngine, stroke: ActiveStroke): void {
  const planner = stroke.blendPlanner;
  const settings = stroke.blendSettings;
  if (!planner || !settings) {
    return;
  }
  let batch = planner.buildNextBatch();
  while (batch) {
    if (!batch.empty) {
      engine.pendingBlendBatches.push({
        actionId: stroke.historyActionId,
        settings,
        batch: cloneDryBlendRenderBatch(batch),
      });
      if (engine.activeStrokeProfile) {
        engine.activeStrokeProfile.baseStamps += 1;
      }
    }
    batch = planner.buildNextBatch();
  }
  if (engine.pendingBlendBatches.length > 0) {
    engine.displayDirty = true;
    engine.requestRender();
  }
}

export async function armBevelFieldShrinkAfterIdle(engine: BrushEngine): Promise<void> {
  if (engine.bevelFieldShrinkInFlight) {
    return;
  }
  if (!bevelFieldNeedsShrink(engine)) {
    engine.scheduleEffectsScratchShrink();
    return;
  }
  if (!effectsScratchCanShrinkNow(engine)) {
    engine.scheduleBevelFieldShrink();
    return;
  }

  engine.bevelFieldShrinkInFlight = true;
  try {
    await engine.device.queue.onSubmittedWorkDone();
    if (!effectsScratchCanShrinkNow(engine) || !bevelFieldNeedsShrink(engine)) {
      return;
    }
    // The next regular frame replaces the texture before the first command
    // that can read or write the heightfield, then rebuilds the whole new bbox.
    engine.bevelFieldShrinkOnNextEncode = true;
    engine.displayDirty = true;
    engine.requestRender();
  } finally {
    engine.bevelFieldShrinkInFlight = false;
    if (bevelFieldNeedsShrink(engine)) {
      engine.scheduleBevelFieldShrink();
    }
  }
}

export function handleRenderFrameError(engine: BrushEngine, error: unknown): void {
  const normalized = error instanceof Error
    ? error
    : new Error(String(error));
  if (engine.frameRequest !== null) {
    cancelAnimationFrame(engine.frameRequest);
    engine.frameRequest = null;
  }
  if (!engine.renderFrameError) {
    engine.renderFrameError = normalized;
    engine.invalidateAdaptivePreview();
    engine.latchDocumentStateInconsistent(
      `WebGPU rendering stopped: ${normalized.message}. Reload the page.`,
      normalized,
    );
  }
}

export function rasterStrokeEffectRect(engine: BrushEngine, 
  rect: DirtyRect | RasterStrokeRect | null,
  width = engine.rasterStrokeStyle.width,
): DirtyRect | null {
  if (!rect) {
    return null;
  }
  const margin = Math.ceil(Math.max(0, width) + 1.5);
  const x = Math.max(0, Math.floor(rect.x) - margin);
  const y = Math.max(0, Math.floor(rect.y) - margin);
  const right = Math.min(DOCUMENT_WIDTH, Math.ceil(rect.x + rect.width) + margin);
  const bottom = Math.min(DOCUMENT_HEIGHT, Math.ceil(rect.y + rect.height) + margin);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function assertVectorUpdateAllowed(
  engine: BrushEngine,
  key: MixedSceneVectorKey,
  updatedKeys: readonly string[] = [],
): void {
  if (
    !engine.initialized
    || engine.activeStroke !== null
    || engine.lightGlazeSession !== null
    || engine.historyBusy
    || engine.layerSwitchBusy
    || engine.historyStateInconsistent
  ) {
    throw new Error("Vector editing requires the engine to be idle.");
  }
  if (engine.activeVectorHistoryEdit && engine.activeVectorHistoryEdit.key !== key) {
    throw new Error("Finish the current vector edit first.");
  }
  if (
    engine.activeVectorHistoryEdit?.scope === "transform"
    && updatedKeys.some((updatedKey) => ![
      "x",
      "y",
      "scale",
      "scaleX",
      "scaleY",
      "rotation",
      "distortPoints",
    ].includes(updatedKey))
  ) {
    throw new Error("Transform only accepts geometry changes until Apply or Cancel.");
  }
}

export function deferRasterStrokeMutation(engine: BrushEngine, cleared: boolean): void {
  invalidateActiveLayerBake(engine);
  engine.rasterStrokeCoverageValid = false;
  engine.rasterBevelHeightValid = false;
  engine.rasterBevelHeightSourceMode = null;
  engine.rasterOuterShadowMatteValid = false;
  engine.rasterOuterShadowSourceMode = null;
  engine.rasterInnerShadowMatteValid = false;
  engine.rasterInnerShadowSourceMode = null;
  if (cleared) {
    engine.rasterStrokeStyledInitialized = false;
    engine.rasterStrokeMipValidThroughLevel = 0;
  }
}

export async function setRasterStrokeGeometryEnabled(engine: BrushEngine, enabled: boolean): Promise<boolean> {
  const renderer = engine.rasterStrokeRenderer;
  if (!renderer) {
    return false;
  }
  const changed = await renderer.setStrokeGeometryEnabled(enabled);
  if (!changed) {
    return false;
  }
  engine.rasterStrokeCoverageValid = false;
  engine.rebuildRasterStrokeDisplayBindGroups();
  return true;
}

export function hasPendingRenderWork(engine: BrushEngine): boolean {
  return engine.frameRequest !== null
    || engine.pendingStamps.length > 0
    || engine.pendingBlendBatches.length > 0
    || engine.clearRequested
    || engine.displayDirty
    || Boolean(engine.lightGlazeSession?.commitRequested)
    || Boolean(engine.lightGlazeSession?.endRequested)
    || engine.thicknessTailPreviewEligible()
    || engine.thicknessTailPresentationNeedsRefresh();
}

export function packStamps(engine: BrushEngine, stamps: readonly Stamp[], settings: BrushSettings): DirtyRect | null {
  const packed = packStampsIntoUpload(
    stamps,
    settings,
    engine.instanceUploadF32,
    engine.instanceUploadU32,
  );
  engine.packedMinimumRadius = packed.minimumRadius;
  return packed.dirtyRect;
}

export function requestGrainLoad(engine: BrushEngine): void {
  const assetId = grainAssetIdForSettings(engine.settings);
  engine.grainDesiredAssetId = assetId;
  if (
    (engine.grainResident && engine.grainLoadedAssetId === assetId)
    || (engine.grainLoadingPromise && engine.grainLoadingAssetId === assetId)
  ) {
    return;
  }
  void engine.ensureGrainResources(assetId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Grain is unavailable: ${message}`, "error");
  });
}

export function requestShapeLoad(engine: BrushEngine): void {
  const assetIds = shapeAssetIdsForSettings(engine.settings);
  const assetId = assetIds[0];
  const invert = shapeInvertForSettings(engine.settings);
  const format = shapeMaskFormatForSettings(engine.settings);
  engine.shapeDesiredAssetId = assetId;
  engine.shapeDesiredAssetIds = [...assetIds];
  engine.shapeDesiredInvert = invert;
  engine.shapeDesiredFormat = format;
  if (
    (
      engine.shapeResident
      && shapeAssetSequenceMatches(engine.shapeLoadedAssetIds, assetIds)
      && engine.shapeLoadedInvert === invert
      && engine.shapeLoadedFormat === format
    )
    || (
      engine.shapeLoadingPromise
      && shapeAssetSequenceMatches(engine.shapeLoadingAssetIds, assetIds)
      && engine.shapeLoadingInvert === invert
      && engine.shapeLoadingFormat === format
    )
  ) {
    return;
  }
  void engine.ensureShapeResources(assetIds, invert, format).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Shape 2K is unavailable: ${message}`, "error");
  });
}

export function bevelFieldNeedsShrink(engine: BrushEngine): boolean {
  if (!engine.bevelBoundingFieldEnabled || !engine.rasterBevelStyle.enabled) {
    return false;
  }
  return engine.rasterBevelRenderer?.fieldNeedsShrink(
    bevelFieldTargetBounds(engine),
  ) ?? false;
}

export function throwIfRenderUnavailable(engine: BrushEngine): void {
  if (engine.deviceLostError) {
    throw engine.deviceLostError;
  }
  if (engine.renderFrameError) {
    throw engine.renderFrameError;
  }
}

export function rasterStrokeActive(engine: BrushEngine): boolean {
  return Boolean(
    engine.rasterStrokeRenderer
    && engine.rasterStrokeStyle.enabled
    && engine.rasterStrokeStyle.width > 0,
  );
}

export function cancelBevelFieldShrink(engine: BrushEngine): void {
  if (engine.bevelFieldShrinkTimer !== null) {
    window.clearTimeout(engine.bevelFieldShrinkTimer);
    engine.bevelFieldShrinkTimer = null;
  }
  engine.bevelFieldShrinkOnNextEncode = false;
}

export function clientToCanvasPixels(engine: BrushEngine, clientX: number, clientY: number): { x: number; y: number } {
  const rectangle = engine.canvas.getBoundingClientRect();
  return {
    x: ((clientX - rectangle.left) / Math.max(1, rectangle.width)) * engine.canvas.width,
    y: ((clientY - rectangle.top) / Math.max(1, rectangle.height)) * engine.canvas.height,
  };
}

export function thicknessTailReferenceTimeMs(engine: BrushEngine): number {
  const stroke = engine.activeStroke;
  if (!stroke) {
    return performance.now();
  }
  return Math.max(stroke.lastInput.timeMs, performance.now());
}

export function runRenderFrame(engine: BrushEngine, timestamp: number): void {
  try {
    engine.renderFrame(timestamp);
  } catch (error) {
    handleRenderFrameError(engine, error);
  }
}

export function rasterBevelActive(engine: BrushEngine): boolean {
  return Boolean(
    engine.rasterBevelRenderer
    && engine.rasterBevelStyle.enabled,
  );
}

export function rasterOuterShadowActive(engine: BrushEngine): boolean {
  return Boolean(
    engine.rasterOuterShadowRenderer
    && engine.rasterOuterShadowStyle.enabled,
  );
}

export function rasterInnerShadowActive(engine: BrushEngine): boolean {
  return Boolean(
    engine.rasterInnerShadowRenderer
    && engine.rasterInnerShadowStyle.enabled,
  );
}

export function bevelFieldBlocksScratchShrink(engine: BrushEngine): boolean {
  return engine.bevelFieldShrinkTimer !== null
    || engine.bevelFieldShrinkInFlight
    || engine.bevelFieldShrinkOnNextEncode
    || bevelFieldNeedsShrink(engine);
}

export function rasterBevelEffectRect(engine: BrushEngine, 
  rect: DirtyRect | RasterBevelRect | null,
  style: RasterBevelStyle = engine.rasterBevelStyle,
): DirtyRect | null {
  return rasterBevelVisualBounds(rect, style, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
}

export function rasterBevelInfluenceRect(engine: BrushEngine, 
  rect: DirtyRect | RasterBevelRect | null,
  style: RasterBevelStyle = engine.rasterBevelStyle,
): DirtyRect | null {
  return rasterBevelInfluenceBounds(rect, style, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
}

export function rasterOuterShadowEffectRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterOuterShadowStyle = engine.rasterOuterShadowStyle,
): DirtyRect | null {
  return rasterOuterShadowVisualBounds(rect, style, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
}

export function rasterOuterShadowInfluenceRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterOuterShadowStyle = engine.rasterOuterShadowStyle,
): DirtyRect | null {
  return rasterOuterShadowInfluenceBounds(rect, style, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
}

export function rasterInnerShadowEffectRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterInnerShadowStyle = engine.rasterInnerShadowStyle,
): DirtyRect | null {
  return rasterInnerShadowVisualBounds(rect, style, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
}

export function rasterInnerShadowInfluenceRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterInnerShadowStyle = engine.rasterInnerShadowStyle,
): DirtyRect | null {
  return rasterInnerShadowInfluenceBounds(rect, style, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
}

export function recordStampGenerationTime(engine: BrushEngine, startTime: number): void {
  if (startTime > 0 && engine.activeStrokeProfile) {
    engine.activeStrokeProfile.stampGenerationMs += performance.now() - startTime;
  }
}

export function bevelFieldTargetBounds(engine: BrushEngine): DirtyRect | null {
  return rasterBevelInfluenceRect(engine, engine.layerContentBounds);
}
