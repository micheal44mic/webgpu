import type { BrushEngine } from "./brush-engine";
import {
  type EffectsWorkbenchRetargetResult,
  type LayerBakeFaultPoint,
  type LayerCompositeFaultPoint,
  type LayerFormat,
} from "./engine-types";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  type DisplayPyramidResources,
  type EffectsRetargetCaller,
  type LayerBakeResources,
  type LayerEffectsRebuildDomain,
  type LayerGpuCompletionPolicy,
  type LayerGpuResources,
  type LayerTextureResources,
  type MergedSurfaceResources,
} from "./engine-layer-resources";
import { DryBlendRenderer } from "./blend-renderer";
import { EFFECTS_WORKING_SET_STRATEGY, EffectsWorkbench } from "./effects-workbench";
import {
  coldStorageMaskForRecord,
  createColdLayerGpuResources,
  createHydratedLayerTexture,
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
  destroyLayerHot,
  destroyTransientLayerHydration,
} from "./engine-cold-storage";
import {
  LAYER_COMPOSITE_UNIFORM_BYTES,
  LAYER_SIZE,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
} from "./engine-limits";
import { destroyLightGlazeResources } from "./engine-glaze-runtime";
import { clearLayerStorageTileMask } from "./layer-storage-study";
import {
  destroyMixedSceneRasterSegment,
  mixedSceneItemIsVisible,
  rebuildVectorTextDisplayBindGroup,
} from "./engine-vector-text-runtime";
import { type DirtyRect } from "./engine-stroke-types";
import { layerEffectRendererRequirements, type LayerRecord } from "./layer-stack";
import { mergeDirtyRects, normalizeLayerRect } from "./engine-geometry";
import {
  MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
  MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
  alignedMergedSurfaceBounds,
  intersectMergedSurfaceRects,
  mergedSurfaceMemoryBytes,
  mergedSurfaceMipLevelCount,
  mergedSurfacePhysicalRect,
  unionMergedSurfaceRects,
  type MergedSurfaceRect,
} from "./merged-surface-bounds";
import { type MixedSceneItem } from "./mixed-scene-stack";
import { type VectorTextViewState } from "./vector-text-types";
import { normalizeRasterBevelStyle } from "./bevel-core";
import { normalizeRasterInnerShadowStyle, normalizeRasterOuterShadowStyle } from "./shadow-core";
import { normalizeRasterStrokeStyle } from "./stroke-core";
import { normalizeRasterColorOverlayStyle } from "./raster-color-overlay-core";
import { effectsScratchCanShrink, effectsScratchShrinkIsWorthwhile } from "./effects-scratch-pool";
import {
  destroyThicknessTailOverlayResources,
  ensureEffectRenderersForRecord,
  releaseRasterBevelRenderer,
  releaseRasterInnerShadowRenderer,
  releaseRasterOuterShadowRenderer,
  releaseRasterStrokeRenderer,
} from "./engine-resource-setup";
import {
  bevelFieldBlocksScratchShrink,
  clientToCanvasPixels,
  encodeRasterStrokeDisplayPyramid,
  rasterBevelEffectRect,
  rasterInnerShadowEffectRect,
  rasterOuterShadowEffectRect,
  rasterStrokeEffectRect,
} from "./engine-runtime-misc";

export async function recreateLayerResources(engine: BrushEngine, format: LayerFormat): Promise<void> {
  const oldBlendRenderer = engine.blendRenderer;
  const oldEffectsWorkbench = engine.effectsWorkbench;
  const previousScratchPeakBytes = oldEffectsWorkbench?.scratchPool.peakBytes ?? 0;
  const {
    normalPipeline,
    additivePipeline,
    shapeNormalPipeline,
    shapeAdditivePipeline,
    shapeOccupancyNormalPipeline,
    shapeOccupancyAdditivePipeline,
    grainNormalPipeline,
    grainAdditivePipeline,
    grainShapeNormalPipeline,
    grainShapeAdditivePipeline,
    grainShapeOccupancyNormalPipeline,
    grainShapeOccupancyAdditivePipeline,
    uniformedGlazePipeline,
    uniformedGlazeShapePipeline,
    uniformedGlazeShapeOccupancyPipeline,
    grainUniformedGlazePipeline,
    grainUniformedGlazeShapePipeline,
    grainUniformedGlazeShapeOccupancyPipeline,
    intenseBlendingPipeline,
    intenseBlendingShapePipeline,
    intenseBlendingShapeOccupancyPipeline,
    grainIntenseBlendingPipeline,
    grainIntenseBlendingShapePipeline,
    grainIntenseBlendingShapeOccupancyPipeline,
    lightNoBuildUpPipeline,
    lightNoBuildUpShapePipeline,
    lightNoBuildUpShapeOccupancyPipeline,
    grainLightNoBuildUpPipeline,
    grainLightNoBuildUpShapePipeline,
    grainLightNoBuildUpShapeOccupancyPipeline,
    lightGlazeCompositeMipPipeline,
    lightGlazeCompositePipeline,
    lightGlazeCommitTilePipeline,
    paintMipDownsamplePipeline,
    paintStackCompositeMipPipeline,
    layerCompositePipeline,
  } = await runGpuAllocationTransaction(
    engine.device,
    `Pipeline formato layer ${format}`,
    () => {
  const brushPipelineLayout = engine.device.createPipelineLayout({
    label: `Brush legacy pipeline layout ${format}`,
    bindGroupLayouts: [engine.brushBindGroupLayout],
  });
  const brushOccupancyPipelineLayout = engine.device.createPipelineLayout({
    label: `Brush occupancy pipeline layout ${format}`,
    bindGroupLayouts: [engine.brushOccupancyBindGroupLayout],
  });
  const grainBrushPipelineLayout = engine.device.createPipelineLayout({
    label: `Texturized grain brush pipeline layout ${format}`,
    bindGroupLayouts: [engine.grainBrushBindGroupLayout],
  });
  const grainBrushOccupancyPipelineLayout = engine.device.createPipelineLayout({
    label: `Texturized grain occupancy pipeline layout ${format}`,
    bindGroupLayouts: [engine.grainBrushOccupancyBindGroupLayout],
  });
  const paintMipDownsamplePipelineLayout = engine.device.createPipelineLayout({
    label: `Paint display mip downsample pipeline layout ${format}`,
    bindGroupLayouts: [engine.paintMipDownsampleBindGroupLayout],
  });
  const paintStackCompositeMipPipelineLayout = engine.device.createPipelineLayout({
    label: `Final raster stack composited mip 1 pipeline layout ${format}`,
    bindGroupLayouts: [engine.paintStackCompositeMipBindGroupLayout],
  });
  const layerCompositePipelineLayout = engine.device.createPipelineLayout({
    label: `Layer source-over fold pipeline layout ${format}`,
    bindGroupLayouts: [engine.layerCompositeBindGroupLayout],
  });
  const lightGlazeCompositeMipPipelineLayout = engine.device.createPipelineLayout({
    label: `Light Glaze composited mip 1 pipeline layout ${format}`,
    bindGroupLayouts: [engine.lightGlazeCompositeMipBindGroupLayout],
  });
  const lightGlazeCompositePipelineLayout = engine.device.createPipelineLayout({
    label: `Light Glaze final composite pipeline layout ${format}`,
    bindGroupLayouts: [engine.lightGlazeCompositeBindGroupLayout],
  });
  const lightGlazeCommitTilePipelineLayout = engine.device.createPipelineLayout({
    label: `High precision glaze exact tile commit pipeline layout ${format}`,
    bindGroupLayouts: [engine.lightGlazeCommitTileBindGroupLayout],
  });

  const normalPipeline = engine.device.createRenderPipeline({
    label: `Brush normal ${format}`,
    layout: brushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.brushShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const additivePipeline = engine.device.createRenderPipeline({
    label: `Brush additive ${format}`,
    layout: brushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.brushShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const shapeNormalPipeline = engine.device.createRenderPipeline({
    label: `Brush shape 2K legacy normal ${format}`,
    layout: brushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.brushShaderModule,
      entryPoint: "shapeFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const shapeAdditivePipeline = engine.device.createRenderPipeline({
    label: `Brush shape 2K legacy additive ${format}`,
    layout: brushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.brushShaderModule,
      entryPoint: "shapeFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const shapeOccupancyNormalPipeline = engine.device.createRenderPipeline({
    label: `Brush shape 2K occupancy normal ${format}`,
    layout: brushOccupancyPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.brushShaderModule,
      entryPoint: "shapeOccupancyFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const shapeOccupancyAdditivePipeline = engine.device.createRenderPipeline({
    label: `Brush shape 2K occupancy additive ${format}`,
    layout: brushOccupancyPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.brushShaderModule,
      entryPoint: "shapeOccupancyFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const grainNormalPipeline = engine.device.createRenderPipeline({
    label: `Brush Texturized grain normal ${format}`,
    layout: grainBrushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const grainAdditivePipeline = engine.device.createRenderPipeline({
    label: `Brush Texturized grain additive ${format}`,
    layout: grainBrushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const grainShapeNormalPipeline = engine.device.createRenderPipeline({
    label: `Brush Shape 2K Texturized grain normal ${format}`,
    layout: grainBrushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: "shapeFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const grainShapeAdditivePipeline = engine.device.createRenderPipeline({
    label: `Brush Shape 2K Texturized grain additive ${format}`,
    layout: grainBrushPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: "shapeFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const grainShapeOccupancyNormalPipeline = engine.device.createRenderPipeline({
    label: `Brush Shape 2K occupancy Texturized grain normal ${format}`,
    layout: grainBrushOccupancyPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: "shapeOccupancyFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const grainShapeOccupancyAdditivePipeline = engine.device.createRenderPipeline({
    label: `Brush Shape 2K occupancy Texturized grain additive ${format}`,
    layout: grainBrushOccupancyPipelineLayout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: "shapeVertexMain",
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: "shapeOccupancyFragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });

  const createRgba16FloatGlazePipeline = (
    label: string,
    layout: GPUPipelineLayout,
    fragmentModule: GPUShaderModule,
    vertexEntryPoint: "vertexMain" | "shapeVertexMain",
    fragmentEntryPoint:
      | "fragmentMain"
      | "shapeFragmentMain"
      | "shapeOccupancyFragmentMain"
      | "encodedSrgbFragmentMain"
      | "encodedSrgbShapeFragmentMain"
      | "encodedSrgbShapeOccupancyFragmentMain",
  ): GPURenderPipeline => engine.device.createRenderPipeline({
    label,
    layout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: vertexEntryPoint,
    },
    fragment: {
      module: fragmentModule,
      entryPoint: fragmentEntryPoint,
      targets: [{
        format: "rgba16float",
        blend: {
          color: {
            operation: "add",
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
          },
          alpha: {
            operation: "add",
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
          },
        },
      }],
    },
    primitive: { topology: "triangle-strip" },
  });

  const uniformedGlazePipeline = createRgba16FloatGlazePipeline(
    "Uniformed Glaze circle linear source-over rgba16float",
    brushPipelineLayout,
    engine.brushShaderModule,
    "vertexMain",
    "fragmentMain",
  );
  const uniformedGlazeShapePipeline = createRgba16FloatGlazePipeline(
    "Uniformed Glaze Shape linear source-over rgba16float",
    brushPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "shapeFragmentMain",
  );
  const uniformedGlazeShapeOccupancyPipeline = createRgba16FloatGlazePipeline(
    "Uniformed Glaze Shape occupancy linear source-over rgba16float",
    brushOccupancyPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "shapeOccupancyFragmentMain",
  );
  const grainUniformedGlazePipeline = createRgba16FloatGlazePipeline(
    "Uniformed Glaze Texturized circle linear source-over rgba16float",
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "vertexMain",
    "fragmentMain",
  );
  const grainUniformedGlazeShapePipeline = createRgba16FloatGlazePipeline(
    "Uniformed Glaze Texturized Shape linear source-over rgba16float",
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "shapeFragmentMain",
  );
  const grainUniformedGlazeShapeOccupancyPipeline = createRgba16FloatGlazePipeline(
    "Uniformed Glaze Texturized Shape occupancy linear source-over rgba16float",
    grainBrushOccupancyPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "shapeOccupancyFragmentMain",
  );

  const intenseBlendingPipeline = createRgba16FloatGlazePipeline(
    "Intense Blending circle encoded-sRGB source-over rgba16float",
    brushPipelineLayout,
    engine.brushShaderModule,
    "vertexMain",
    "encodedSrgbFragmentMain",
  );
  const intenseBlendingShapePipeline = createRgba16FloatGlazePipeline(
    "Intense Blending Shape encoded-sRGB source-over rgba16float",
    brushPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "encodedSrgbShapeFragmentMain",
  );
  const intenseBlendingShapeOccupancyPipeline = createRgba16FloatGlazePipeline(
    "Intense Blending Shape occupancy encoded-sRGB source-over rgba16float",
    brushOccupancyPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "encodedSrgbShapeOccupancyFragmentMain",
  );
  const grainIntenseBlendingPipeline = createRgba16FloatGlazePipeline(
    "Intense Blending Texturized circle encoded-sRGB source-over rgba16float",
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "vertexMain",
    "encodedSrgbFragmentMain",
  );
  const grainIntenseBlendingShapePipeline = createRgba16FloatGlazePipeline(
    "Intense Blending Texturized Shape encoded-sRGB source-over rgba16float",
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "encodedSrgbShapeFragmentMain",
  );
  const grainIntenseBlendingShapeOccupancyPipeline = createRgba16FloatGlazePipeline(
    "Intense Blending Texturized Shape occupancy encoded-sRGB source-over rgba16float",
    grainBrushOccupancyPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "encodedSrgbShapeOccupancyFragmentMain",
  );
  const createLightNoBuildUpPipeline = (
    label: string,
    layout: GPUPipelineLayout,
    fragmentModule: GPUShaderModule,
    vertexEntryPoint: "vertexMain" | "shapeVertexMain",
    fragmentEntryPoint:
      | "coverageFragmentMain"
      | "shapeCoverageFragmentMain"
      | "shapeOccupancyCoverageFragmentMain",
  ): GPURenderPipeline => engine.device.createRenderPipeline({
    label,
    layout,
    vertex: {
      module: engine.brushShaderModule,
      entryPoint: vertexEntryPoint,
    },
    fragment: {
      module: fragmentModule,
      entryPoint: fragmentEntryPoint,
      targets: [
        {
          format: "r8unorm",
          blend: {
            color: {
              operation: "max",
              srcFactor: "one",
              dstFactor: "one",
            },
            alpha: {
              operation: "max",
              srcFactor: "one",
              dstFactor: "one",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-strip" },
  });
  const lightNoBuildUpPipeline = createLightNoBuildUpPipeline(
    `Light Glaze circle MAX per gesture r8unorm`,
    brushPipelineLayout,
    engine.brushShaderModule,
    "vertexMain",
    "coverageFragmentMain",
  );
  const lightNoBuildUpShapePipeline = createLightNoBuildUpPipeline(
    `Light Glaze Shape MAX per gesture r8unorm`,
    brushPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "shapeCoverageFragmentMain",
  );
  const lightNoBuildUpShapeOccupancyPipeline = createLightNoBuildUpPipeline(
    `Light Glaze Shape occupancy MAX per gesture r8unorm`,
    brushOccupancyPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "shapeOccupancyCoverageFragmentMain",
  );
  const grainLightNoBuildUpPipeline = createLightNoBuildUpPipeline(
    `Light Glaze Texturized circle MAX per gesture r8unorm`,
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "vertexMain",
    "coverageFragmentMain",
  );
  const grainLightNoBuildUpShapePipeline = createLightNoBuildUpPipeline(
    `Light Glaze Texturized Shape MAX per gesture r8unorm`,
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "shapeCoverageFragmentMain",
  );
  const grainLightNoBuildUpShapeOccupancyPipeline = createLightNoBuildUpPipeline(
    `Light Glaze Texturized Shape occupancy MAX per gesture r8unorm`,
    grainBrushOccupancyPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "shapeOccupancyCoverageFragmentMain",
  );

  const lightGlazeCompositeMipPipeline = engine.device.createRenderPipeline({
    label: `Light Glaze composited mip 1 ${format}`,
    layout: lightGlazeCompositeMipPipelineLayout,
    vertex: {
      module: engine.lightGlazeCompositeMipShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.lightGlazeCompositeMipShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });

  const lightGlazeCompositePipeline = engine.device.createRenderPipeline({
    label: `Light Glaze final source-over composite ${format}`,
    layout: lightGlazeCompositePipelineLayout,
    vertex: {
      module: engine.lightGlazeCompositeShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.lightGlazeCompositeShaderModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format,
          blend: {
            color: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
            alpha: {
              operation: "add",
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });

  const lightGlazeCommitTilePipeline = engine.device.createRenderPipeline({
    label: `High precision glaze exact tile commit ${format}`,
    layout: lightGlazeCommitTilePipelineLayout,
    vertex: {
      module: engine.lightGlazeCommitTileShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.lightGlazeCommitTileShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const paintMipDownsamplePipeline = engine.device.createRenderPipeline({
    label: `Paint display mip downsample ${format}`,
    layout: paintMipDownsamplePipelineLayout,
    vertex: {
      module: engine.paintMipDownsampleShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.paintMipDownsampleShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const paintStackCompositeMipPipeline = engine.device.createRenderPipeline({
    label: `Final raster stack composited mip 1 ${format}`,
    layout: paintStackCompositeMipPipelineLayout,
    vertex: {
      module: engine.paintStackCompositeMipShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.paintStackCompositeMipShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const layerCompositePipeline = engine.device.createRenderPipeline({
    label: `Layer source-over fold ${format}`,
    layout: layerCompositePipelineLayout,
    vertex: { module: engine.layerCompositeShaderModule, entryPoint: "vertexMain" },
    fragment: {
      module: engine.layerCompositeShaderModule,
      entryPoint: "fragmentMain",
      targets: [{
        format,
        blend: {
          color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
      return {
        normalPipeline,
        additivePipeline,
        shapeNormalPipeline,
        shapeAdditivePipeline,
        shapeOccupancyNormalPipeline,
        shapeOccupancyAdditivePipeline,
        grainNormalPipeline,
        grainAdditivePipeline,
        grainShapeNormalPipeline,
        grainShapeAdditivePipeline,
        grainShapeOccupancyNormalPipeline,
        grainShapeOccupancyAdditivePipeline,
        uniformedGlazePipeline,
        uniformedGlazeShapePipeline,
        uniformedGlazeShapeOccupancyPipeline,
        grainUniformedGlazePipeline,
        grainUniformedGlazeShapePipeline,
        grainUniformedGlazeShapeOccupancyPipeline,
        intenseBlendingPipeline,
        intenseBlendingShapePipeline,
        intenseBlendingShapeOccupancyPipeline,
        grainIntenseBlendingPipeline,
        grainIntenseBlendingShapePipeline,
        grainIntenseBlendingShapeOccupancyPipeline,
        lightNoBuildUpPipeline,
        lightNoBuildUpShapePipeline,
        lightNoBuildUpShapeOccupancyPipeline,
        grainLightNoBuildUpPipeline,
        grainLightNoBuildUpShapePipeline,
        grainLightNoBuildUpShapeOccupancyPipeline,
        lightGlazeCompositeMipPipeline,
        lightGlazeCompositePipeline,
        lightGlazeCommitTilePipeline,
        paintMipDownsamplePipeline,
        paintStackCompositeMipPipeline,
        layerCompositePipeline,
      };
    },
  );

  // A format change invalidates every layer's texture, not just the active one,
  // and setLayerFormat already tells the user the content is cleared.
  //
  // Allocate everything BEFORE destroying anything. Destroying first would mean
  // an OOM partway through the remaining layers left the document with neither
  // the old textures nor the new ones — losing content the caller was told it
  // could still recover, since setLayerFormat's error path restores the previous
  // format and expects the old resources to still be there.
  const replacement = new Map<number, LayerGpuResources>();
  let blendRenderer: DryBlendRenderer | null = null;
  let nextEffectsWorkbench: EffectsWorkbench | null = null;
  let nextDisplayPyramid: DisplayPyramidResources | null = null;
  let nextTransparentTexture: GPUTexture | null = null;
  let nextTransparentView: GPUTextureView | null = null;
  try {
    const displayInfrastructure = await runGpuAllocationTransaction(
      engine.device,
      `Display layer infrastructure ${format}`,
      (transaction) => {
        const pyramid = allocateActiveLayerDisplayPyramid(engine, format);
        transaction.deferRollback(() => pyramid.texture.destroy());
        const transparentTexture = engine.device.createTexture({
          label: `Transparent layer placeholder ${format}`,
          size: { width: 1, height: 1, depthOrArrayLayers: 1 },
          format,
          usage: GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => transparentTexture.destroy());
        return {
          pyramid,
          transparentTexture,
          transparentView: transparentTexture.createView(),
        };
      },
    );
    nextDisplayPyramid = displayInfrastructure.pyramid;
    nextTransparentTexture = displayInfrastructure.transparentTexture;
    nextTransparentView = displayInfrastructure.transparentView;
    for (const record of engine.layerStack.layers) {
      const gpu = record.id === engine.layerStack.active.id
        ? await allocateLayerGpuResources(engine, 
          format,
          `Cambio formato: livello ${record.id}`,
        )
        : createColdLayerGpuResources();
      replacement.set(record.id, gpu);
    }

    const activeGpu = replacement.get(engine.layerStack.active.id);
    const activeHot = activeGpu?.hot;
    if (!activeGpu || !activeHot) {
      throw new Error("Risorse candidate mancanti per il livello attivo.");
    }
    blendRenderer = await runGpuAllocationTransaction(
      engine.device,
      `Renderer Blend formato ${format}`,
      async (transaction) => {
        const candidate = await DryBlendRenderer.create({
          device: engine.device,
          documentWidth: LAYER_SIZE,
          documentHeight: LAYER_SIZE,
          layerFormat: format,
          layerView: activeHot.view,
          layerSamplingView: activeHot.samplingView,
          shapeMaskView: engine.shapeMaskView,
          shapeMaskSampler: engine.shapeMaskSampler,
          grainTextureView: engine.grainTextureView,
          grainSamplers: engine.grainSamplers,
        });
        transaction.deferRollback(() => candidate.destroy());
        return candidate;
      },
    );
    nextEffectsWorkbench = new EffectsWorkbench({
      device: engine.device,
      view: activeHot.view,
      format,
      canReallocateScratch: () => engine.activeStroke === null,
      initialScratchPeakBytes: previousScratchPeakBytes,
    });
  } catch (error) {
    // Nothing has been swapped in yet: every candidate is disposable and all
    // old textures/renderers still describe the intact document.
    nextEffectsWorkbench?.destroy();
    blendRenderer?.destroy();
    nextDisplayPyramid?.texture.destroy();
    nextTransparentTexture?.destroy();
    for (const gpu of replacement.values()) {
      destroyLayerGpuResources(engine, gpu);
    }
    throw error;
  }

  const activeGpu = replacement.get(engine.layerStack.active.id);
  const activeHot = activeGpu?.hot;
  if (
    !activeGpu
    || !activeHot
    || !blendRenderer
    || !nextEffectsWorkbench
    || !nextDisplayPyramid
    || !nextTransparentTexture
    || !nextTransparentView
  ) {
    nextEffectsWorkbench?.destroy();
    blendRenderer?.destroy();
    nextDisplayPyramid?.texture.destroy();
    nextTransparentTexture?.destroy();
    for (const gpu of replacement.values()) {
      destroyLayerGpuResources(engine, gpu);
    }
    throw new Error("Transazione cambio formato incompleta.");
  }
  const { texture, view, samplingView } = activeHot;

  destroyLightGlazeResources(engine);
  destroyThicknessTailOverlayResources(engine);
  const supersededLayerGpu = [...engine.layerGpu.values()];
  const supersededDisplayPyramid = engine.activeLayerDisplayPyramid;
  const supersededTransparentTexture = engine.transparentLayerTexture;
  const supersededMergedBelow = engine.mergedBelow;
  const supersededMergedAbove = engine.mergedAbove;
  const supersededMixedSceneRasterSegments = engine.mixedSceneRasterSegments;
  engine.layerGpu.clear();
  for (const [layerId, gpu] of replacement) {
    engine.layerGpu.set(layerId, gpu);
  }
  for (const other of engine.layerStack.layers) {
    if (other.id === engine.layerStack.active.id) {
      continue;
    }
    other.contentBounds = null;
    other.hasContent = false;
    clearLayerStorageTileMask(other.storageTileMask);
  }
  engine.layerTexture = texture;
  engine.layerView = view;
  engine.layerSamplingView = samplingView;
  engine.blendRenderer = blendRenderer;
  engine.activeLayerDisplayPyramid = nextDisplayPyramid;
  engine.transparentLayerTexture = nextTransparentTexture;
  engine.transparentLayerView = nextTransparentView;
  engine.mergedBelow = null;
  engine.mergedAbove = null;
  engine.mixedSceneRasterSegments = [];
  engine.mixedSceneCompositionSegments = engine.mixedSceneStack?.visibleSemanticCount
    ? engine.mixedSceneStack.compositionSegments(engine.layerStack.active.id)
    : [];
  engine.normalPipeline = normalPipeline;
  engine.additivePipeline = additivePipeline;
  engine.shapeNormalPipeline = shapeNormalPipeline;
  engine.shapeAdditivePipeline = shapeAdditivePipeline;
  engine.shapeOccupancyNormalPipeline = shapeOccupancyNormalPipeline;
  engine.shapeOccupancyAdditivePipeline = shapeOccupancyAdditivePipeline;
  engine.grainNormalPipeline = grainNormalPipeline;
  engine.grainAdditivePipeline = grainAdditivePipeline;
  engine.grainShapeNormalPipeline = grainShapeNormalPipeline;
  engine.grainShapeAdditivePipeline = grainShapeAdditivePipeline;
  engine.grainShapeOccupancyNormalPipeline = grainShapeOccupancyNormalPipeline;
  engine.grainShapeOccupancyAdditivePipeline = grainShapeOccupancyAdditivePipeline;
  engine.uniformedGlazePipeline = uniformedGlazePipeline;
  engine.uniformedGlazeShapePipeline = uniformedGlazeShapePipeline;
  engine.uniformedGlazeShapeOccupancyPipeline = uniformedGlazeShapeOccupancyPipeline;
  engine.grainUniformedGlazePipeline = grainUniformedGlazePipeline;
  engine.grainUniformedGlazeShapePipeline = grainUniformedGlazeShapePipeline;
  engine.grainUniformedGlazeShapeOccupancyPipeline = grainUniformedGlazeShapeOccupancyPipeline;
  engine.intenseBlendingPipeline = intenseBlendingPipeline;
  engine.intenseBlendingShapePipeline = intenseBlendingShapePipeline;
  engine.intenseBlendingShapeOccupancyPipeline = intenseBlendingShapeOccupancyPipeline;
  engine.grainIntenseBlendingPipeline = grainIntenseBlendingPipeline;
  engine.grainIntenseBlendingShapePipeline = grainIntenseBlendingShapePipeline;
  engine.grainIntenseBlendingShapeOccupancyPipeline = grainIntenseBlendingShapeOccupancyPipeline;
  engine.lightNoBuildUpPipeline = lightNoBuildUpPipeline;
  engine.lightNoBuildUpShapePipeline = lightNoBuildUpShapePipeline;
  engine.lightNoBuildUpShapeOccupancyPipeline = lightNoBuildUpShapeOccupancyPipeline;
  engine.grainLightNoBuildUpPipeline = grainLightNoBuildUpPipeline;
  engine.grainLightNoBuildUpShapePipeline = grainLightNoBuildUpShapePipeline;
  engine.grainLightNoBuildUpShapeOccupancyPipeline = grainLightNoBuildUpShapeOccupancyPipeline;
  engine.lightGlazeCompositeMipPipeline = lightGlazeCompositeMipPipeline;
  engine.lightGlazeCompositePipeline = lightGlazeCompositePipeline;
  engine.lightGlazeCommitTilePipeline = lightGlazeCommitTilePipeline;
  engine.paintMipDownsamplePipeline = paintMipDownsamplePipeline;
  engine.paintStackCompositeMipPipeline = paintStackCompositeMipPipeline;
  engine.layerCompositePipeline = layerCompositePipeline;
  engine.layerFormat = format;
  rebuildActiveLayerPyramidBindings(engine);
  rebuildLayerDisplayBindGroups(engine);
  // The direct Traccia LOD 0 path uses the format flag to reproduce the
  // quantization that the removed full-resolution styled texture applied.
  engine.writeLightGlazeUniforms(1, "source-over", null);
  engine.paintDisplayMipValidThroughLevel = 0;
  engine.paintDisplayPyramidContent = "active-only";
  engine.paintDisplaySelectedMipLevel = 0;
  engine.presentationCacheNeedsFullRebuild = true;
  releaseRasterStrokeRenderer(engine);
  releaseRasterBevelRenderer(engine);
  releaseRasterOuterShadowRenderer(engine);
  releaseRasterInnerShadowRenderer(engine);
  oldEffectsWorkbench?.destroy();
  engine.effectsWorkbench = nextEffectsWorkbench;
  oldBlendRenderer?.destroy();
  supersededDisplayPyramid?.texture.destroy();
  supersededTransparentTexture?.destroy();
  engine.destroyMergedSurface(supersededMergedBelow);
  engine.destroyMergedSurface(supersededMergedAbove);
  for (const segment of supersededMixedSceneRasterSegments) {
    destroyMixedSceneRasterSegment(engine, segment);
  }
  for (const gpu of supersededLayerGpu) {
    destroyLayerGpuResources(engine, gpu);
  }
}

export async function retargetEffectsWorkingSetInternal(engine: BrushEngine, 
  layerView: GPUTextureView,
  layerFormat: LayerFormat,
  contentBounds: DirtyRect | null | undefined,
  caller: EffectsRetargetCaller,
  styles: Pick<
    LayerRecord,
    | "strokeStyle"
    | "bevelStyle"
    | "outerShadowStyle"
    | "innerShadowStyle"
    | "colorOverlayStyle"
  > | null = null,
  publish = true,
  maintainDisplayPyramid = true,
  completionPolicy: LayerGpuCompletionPolicy = "await-immediately",
  rebuildDomain: LayerEffectsRebuildDomain = "full-document",
): Promise<EffectsWorkbenchRetargetResult> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  // Each caller's exemption is spelled out rather than hidden behind booleans.
  // A layer switch legitimately runs while layerSwitchBusy is its own flag;
  // cross-layer replay and structural vector history legitimately run while
  // historyBusy is high because each is the current history transaction, so
  // neither can go through the public method.
  const duringLayerSwitch = caller !== "public";
  const duringHistoryTransaction =
    caller === "history-replay" || caller === "structural-history";
  if (
    engine.activeStroke
    || (!duringHistoryTransaction && engine.historyBusy)
    || (!duringLayerSwitch && engine.layerSwitchBusy)
    || engine.rasterStrokeBusy
    || engine.rasterBevelBusy
    || engine.rasterOuterShadowBusy
    || engine.rasterInnerShadowBusy
  ) {
    throw new Error("Il banco effetti può cambiare sorgente solo a motore fermo.");
  }
  const workbench = engine.requireEffectsWorkbench();
  if (layerFormat !== engine.layerFormat || layerFormat !== workbench.sourceFormat) {
    throw new Error(
      `Formato banco effetti ${workbench.sourceFormat} incompatibile con ${layerFormat}; `
      + "usa setLayerFormat() per il fallback con ricreazione completa.",
    );
  }

  if (completionPolicy === "await-immediately") {
    await engine.waitForIdle();
  }
  const strokeStyle = styles?.strokeStyle ?? engine.rasterStrokeStyle;
  const bevelStyle = styles?.bevelStyle ?? engine.rasterBevelStyle;
  const outerShadowStyle = styles?.outerShadowStyle ?? engine.rasterOuterShadowStyle;
  const innerShadowStyle = styles?.innerShadowStyle ?? engine.rasterInnerShadowStyle;
  const colorOverlayStyle = styles?.colorOverlayStyle
    ?? engine.rasterColorOverlayStyle;
  const fullDocumentRect: DirtyRect = {
    x: 0,
    y: 0,
    width: LAYER_SIZE,
    height: LAYER_SIZE,
  };
  // Omitted preserves the pre-PR3 contract; explicit null means an empty source.
  const normalizedContentBounds = contentBounds === undefined
    ? fullDocumentRect
    : normalizeLayerRect(contentBounds);
  const boundedContentRect = normalizedContentBounds ?? fullDocumentRect;
  const styleStackRetargetBounds = rebuildDomain === "content-bounds"
    ? boundedContentRect
    : fullDocumentRect;
  const bevelRetargetContentBounds = engine.bevelBoundingFieldEnabled
    ? normalizedContentBounds
    : fullDocumentRect;
  engine.rasterStrokeBusy = true;
  engine.rasterBevelBusy = true;
  engine.rasterOuterShadowBusy = true;
  engine.rasterInnerShadowBusy = true;
  const startedAt = performance.now();
  try {
    const generation = workbench.retarget({ view: layerView, format: layerFormat });
    engine.rebuildRasterStrokeDisplayBindGroups();
    engine.rasterStrokeCoverageValid = false;
    engine.rasterStrokeStyledInitialized = false;
    engine.rasterStrokeMipValidThroughLevel = 0;
    engine.rasterStrokePendingComposeRect = null;
    engine.rasterStrokeLastEncode = null;
    engine.rasterBevelHeightValid = false;
    engine.rasterBevelHeightSourceMode = null;
    engine.rasterBevelPendingComposeRect = null;
    engine.rasterBevelLastEncode = null;
    engine.rasterOuterShadowMatteValid = false;
    engine.rasterOuterShadowSourceMode = null;
    engine.rasterOuterShadowPendingComposeRect = null;
    engine.rasterOuterShadowLastEncode = null;
    engine.rasterInnerShadowMatteValid = false;
    engine.rasterInnerShadowSourceMode = null;
    engine.rasterInnerShadowPendingComposeRect = null;
    engine.rasterInnerShadowLastEncode = null;

    const encoder = engine.device.createCommandEncoder({
      label: engine.bevelBoundingFieldEnabled
        ? `Banco effetti retarget #${generation}: rebuild campo bbox`
        : `Banco effetti retarget #${generation}: rebuild documento completo`,
    });
    // Public/active retargets preserve the full-document rebuild contract.
    // Fold-only materialization may use the conservative visual-domain input:
    // every buffer is still document-addressed, only dispatched work is bounded.
    const update = engine.encodeRasterStrokeUpdate(
      encoder,
      "permanent",
      styleStackRetargetBounds,
      styleStackRetargetBounds,
      true,
      bevelRetargetContentBounds,
      engine.bevelBoundingFieldEnabled,
      strokeStyle,
      bevelStyle,
      outerShadowStyle,
      innerShadowStyle,
      normalizedContentBounds,
      colorOverlayStyle,
    );
    if (maintainDisplayPyramid) {
      encodeRasterStrokeDisplayPyramid(engine, 
        encoder,
        update.dirtyRect,
        engine.paintDisplaySelectedMipLevel,
      );
    }
    engine.device.queue.submit([encoder.finish()]);
    const submittedAt = performance.now();
    if (completionPolicy === "await-immediately") {
      await engine.waitForGpuCapped(`Retarget banco effetti #${generation}`);
    }
    const completedAt = performance.now();
    const result: EffectsWorkbenchRetargetResult = {
      strategy: EFFECTS_WORKING_SET_STRATEGY,
      generation,
      layerFormat,
      contentBounds: normalizedContentBounds ? { ...normalizedContentBounds } : null,
      contentPixels: normalizedContentBounds
        ? normalizedContentBounds.width * normalizedContentBounds.height
        : 0,
      fullDocumentPixels: LAYER_SIZE * LAYER_SIZE,
      cpuRetargetAndEncodeMs: submittedAt - startedAt,
      queueCompletionMs: completedAt - submittedAt,
      totalMs: completedAt - startedAt,
      stroke: update.timing,
      bevel: engine.rasterBevelLastEncode,
      outerShadow: engine.rasterOuterShadowLastEncode,
      innerShadow: engine.rasterInnerShadowLastEncode,
    };
    if (publish) {
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
      engine.publishStats();
    }
    if (import.meta.env.DEV && completionPolicy === "await-immediately") {
      console.info(
        engine.bevelBoundingFieldEnabled
          ? "[EffectsWorkbench] retarget con campo Smusso bbox completato"
          : "[EffectsWorkbench] retarget 4096² completato",
        result,
      );
    }
    return result;
  } finally {
    engine.rasterStrokeBusy = false;
    engine.rasterBevelBusy = false;
    engine.rasterOuterShadowBusy = false;
    engine.rasterInnerShadowBusy = false;
  }
}

export async function foldRasterRecordIntoMergedSurface(engine: BrushEngine, 
  surface: MergedSurfaceResources,
  record: LayerRecord,
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  first: boolean,
): Promise<boolean> {
  const source = await materializeLayerCompositeSource(engine, record, caller);
  const sourceRect = intersectMergedSurfaceRects(
    source.nonTransparentBounds,
    surface.bounds,
    LAYER_SIZE,
  );
  if (!sourceRect) {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
    return false;
  }
  const destinationRect = mergedSurfacePhysicalRect(
    sourceRect,
    surface.bounds,
    surface.resolutionScale,
  );
  surface.foldedPixels += destinationRect.width * destinationRect.height;
  surface.analyticBakePixels += source.analyticBakePixels;
  try {
    const encoder = engine.device.createCommandEncoder({
      label: `Fold layer ${record.id} into merged ${side}`,
    });
    if (first && record.opacity >= 1 && surface.resolutionScale === 1) {
      // A fresh WebGPU texture is zero-initialized. For the common
      // singleton/opaque side at 1x, copy only the visible source rectangle.
      encoder.copyTextureToTexture(
        {
          texture: source.texture,
          origin: { x: sourceRect.x, y: sourceRect.y, z: 0 },
        },
        {
          texture: surface.texture,
          origin: { x: destinationRect.x, y: destinationRect.y, z: 0 },
        },
        {
          width: sourceRect.width,
          height: sourceRect.height,
          depthOrArrayLayers: 1,
        },
      );
    } else {
      const uniformUpload = new ArrayBuffer(LAYER_COMPOSITE_UNIFORM_BYTES);
      const uniformU32 = new Uint32Array(uniformUpload);
      const uniformF32 = new Float32Array(uniformUpload);
      uniformF32[0] = surface.bounds.x;
      uniformF32[1] = surface.bounds.y;
      uniformF32[2] = surface.resolutionScale;
      uniformF32[3] = record.opacity;
      uniformU32[4] = LAYER_SIZE;
      uniformU32[5] = LAYER_SIZE;
      engine.device.queue.writeBuffer(
        engine.layerCompositeUniformBuffer,
        0,
        uniformUpload,
      );
      const bindGroup = engine.device.createBindGroup({
        label: `Fold layer ${record.id} into merged ${side}`,
        layout: engine.layerCompositeBindGroupLayout,
        entries: [
          { binding: 0, resource: source.view },
          { binding: 1, resource: { buffer: engine.layerCompositeUniformBuffer } },
        ],
      });
      const pass = encoder.beginRenderPass({
        label: `Source-over layer ${record.id} into merged ${side}`,
        colorAttachments: [{
          view: surface.mipViews[0],
          loadOp: first ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(engine.layerCompositePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setScissorRect(
        destinationRect.x,
        destinationRect.y,
        destinationRect.width,
        destinationRect.height,
      );
      pass.draw(3, 1, 0, 0);
      pass.end();
    }
    engine.device.queue.submit([encoder.finish()]);
    // Queue order owns hydration, effect rebuild, analytic bake and fold.
    // Keeping one bounded fence releases each record's full temporaries
    // before the following scene item is materialized.
    await engine.waitForGpuCapped(`Fold livello ${record.id}`);
    return true;
  } finally {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
  }
}

export async function buildMixedMergedSurfaceCandidate(engine: BrushEngine, 
  items: readonly MixedSceneItem[],
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  view: VectorTextViewState,
): Promise<MergedSurfaceResources | null> {
  const rasterItems = items.filter(
    (item): item is Extract<MixedSceneItem, { kind: "raster" }> => item.kind === "raster",
  );
  const boundedItems = rasterItems
    .filter((item) => mixedSceneItemIsVisible(engine, item))
    .map((item) => {
      const record = engine.layerStack.byId(item.rasterLayerId);
      if (!record) {
        throw new Error(`Raster ${item.rasterLayerId} assente durante il calcolo bounds.`);
      }
      return { item, bounds: layerCompositeVisualBounds(engine, record) };
    })
    .filter((entry): entry is {
      item: Extract<MixedSceneItem, { kind: "raster" }>;
      bounds: DirtyRect;
    } => entry.bounds !== null);
  if (boundedItems.length === 0) {
    return null;
  }

  const contentBounds = unionMergedSurfaceRects(
    boundedItems.map((entry) => entry.bounds as MergedSurfaceRect),
    LAYER_SIZE,
  );
  if (!contentBounds) {
    return null;
  }
  const allocation = {
    bounds: alignedMergedSurfaceBounds(contentBounds, LAYER_SIZE),
    resolutionScale: 1,
  } as const;
  const visibleItems = boundedItems.filter((entry) =>
    intersectMergedSurfaceRects(entry.bounds, allocation.bounds, LAYER_SIZE) !== null
  );
  if (visibleItems.length === 0) {
    return null;
  }

  const requiredInitialMip = Math.min(
    MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
    Math.ceil(Math.max(0, Math.log2(1 / Math.max(view.zoom, 1e-6)))),
  );
  if (mergedSurfaceMipLevelCount(allocation.bounds) <= requiredInitialMip) {
    throw new Error("Superficie merged raster priva dei mip display richiesti.");
  }
  const surface = await runGpuAllocationTransaction(
    engine.device,
    `Merged raster ${side} allocation · ${MIXED_MERGED_SURFACE_STORAGE_STRATEGY}`,
    (transaction) => {
      const allocated = allocateMergedSurface(engine, 
        engine.layerFormat,
        side,
        visibleItems.length,
        allocation.bounds,
        allocation.resolutionScale,
      );
      transaction.deferRollback(() => engine.destroyMergedSurface(allocated));
      return allocated;
    },
  );
  try {
    let first = true;
    for (const { item } of visibleItems) {
      const record = engine.layerStack.byId(item.rasterLayerId);
      if (!record) {
        throw new Error(`Raster ${item.rasterLayerId} assente durante il fold.`);
      }
      const didFold = await foldRasterRecordIntoMergedSurface(engine, 
        surface,
        record,
        side,
        caller,
        first,
      );
      first = first && !didFold;
    }
    if (first) {
      engine.destroyMergedSurface(surface);
      return null;
    }
    const initialMipLevel = requiredMergedSurfaceMipLevel(engine, surface);
    if (initialMipLevel > 0) {
      const encoder = engine.device.createCommandEncoder({
        label: `Build merged raster ${side} display pyramid`,
      });
      encodeMergedSurfacePyramid(engine, encoder, surface, initialMipLevel);
      engine.device.queue.submit([encoder.finish()]);
      await engine.waitForGpuCapped(`Piramide merged raster ${side}`);
    }
    return surface;
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  }
}

export async function materializeLayerCompositeSource(engine: BrushEngine, 
  record: LayerRecord,
  caller: EffectsRetargetCaller,
): Promise<{
  texture: GPUTexture;
  view: GPUTextureView;
  transientBake: LayerBakeResources | null;
  transientHydration: LayerTextureResources | null;
  nonTransparentBounds: DirtyRect;
  analyticBakePixels: number;
}> {
  const gpu = engine.requireLayerGpu(record.id);
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  if (gpu.bake && gpu.bakeValid) {
    return {
      texture: gpu.bake.texture,
      view: gpu.bake.samplingView,
      transientBake: null,
      transientHydration: null,
      nonTransparentBounds: { ...gpu.bake.nonTransparentBounds },
      analyticBakePixels:
        gpu.bake.nonTransparentBounds.width * gpu.bake.nonTransparentBounds.height,
    };
  }

  const transientHydration = gpu.hot
    ? null
    : await createHydratedLayerTexture(engine, 
      record,
      gpu,
      `Fold reidratazione livello ${record.id}`,
      false,
      "defer-to-fold-fence",
    );
  const hot = gpu.hot ?? transientHydration;
  if (!hot) {
    throw new Error(`Fold livello ${record.id}: sorgente full-canvas mancante.`);
  }
  if (!requirements.needsStrokeRenderer) {
    return {
      texture: hot.texture,
      view: hot.view,
      transientBake: null,
      transientHydration,
      nonTransparentBounds: normalizeLayerRect(record.contentBounds) ?? {
        x: 0,
        y: 0,
        width: LAYER_SIZE,
        height: LAYER_SIZE,
      },
      analyticBakePixels: 0,
    };
  }

  try {
    await ensureEffectRenderersForRecord(engine, record);
    await retargetEffectsWorkingSetInternal(engine, 
      hot.view,
      engine.layerFormat,
      record.contentBounds,
      caller,
      record,
      false,
      false,
      "defer-to-fold-fence",
      "content-bounds",
    );
    const transientBake = await engine.createLayerBakeCandidate(
      record,
      1,
      false,
      "defer-to-fold-fence",
    );
    return {
      texture: transientBake.texture,
      view: transientBake.samplingView,
      transientBake,
      transientHydration,
      nonTransparentBounds: { ...transientBake.nonTransparentBounds },
      analyticBakePixels:
        transientBake.nonTransparentBounds.width * transientBake.nonTransparentBounds.height,
    };
  } catch (error) {
    destroyTransientLayerHydration(engine, transientHydration);
    throw error;
  }
}

export function allocateMergedSurface(engine: BrushEngine, 
  format: LayerFormat,
  side: "below" | "above",
  layerCount: number,
  bounds: DirtyRect = { x: 0, y: 0, width: LAYER_SIZE, height: LAYER_SIZE },
  resolutionScale = 1,
): MergedSurfaceResources {
  const normalizedBounds = normalizeLayerRect(bounds);
  if (!normalizedBounds) {
    throw new Error(`Merged ${side}: bounds di allocazione non validi.`);
  }
  if (
    !Number.isInteger(resolutionScale)
    || resolutionScale < 1
    || resolutionScale > 64
  ) {
    throw new Error(`Merged ${side}: densità ${resolutionScale} non valida.`);
  }
  const textureWidth = normalizedBounds.width * resolutionScale;
  const textureHeight = normalizedBounds.height * resolutionScale;
  const maximumTextureExtent = engine.device.limits.maxTextureDimension2D;
  if (textureWidth > maximumTextureExtent || textureHeight > maximumTextureExtent) {
    throw new Error(
      `Merged ${side}: ${textureWidth}×${textureHeight} supera il limite `
      + `${maximumTextureExtent} della GPU.`,
    );
  }
  const physicalBounds = { width: textureWidth, height: textureHeight };
  const mipLevelCount = mergedSurfaceMipLevelCount(physicalBounds);
  const memory = mergedSurfaceMemoryBytes(
    physicalBounds,
    format === "rgba16float" ? 8 : 4,
  );
  const texture = engine.device.createTexture({
    label:
      `Merged ${side} surface (${layerCount} layers) ${format} `
      + `${textureWidth}×${textureHeight} (${normalizedBounds.width}×`
      + `${normalizedBounds.height} doc @ ${resolutionScale}x) `
      + `@ ${normalizedBounds.x},${normalizedBounds.y}`,
    size: { width: textureWidth, height: textureHeight, depthOrArrayLayers: 1 },
    mipLevelCount,
    format,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.COPY_SRC,
  });
  try {
    const samplingView = texture.createView({
      label: `Merged ${side} sampling chain ${format}`,
    });
    const mipViews = Array.from(
      { length: mipLevelCount },
      (_, mipLevel) => texture.createView({
        label: `Merged ${side} mip ${mipLevel} ${format}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }),
    );
    const mipDownsampleBindGroups = mipViews.slice(0, -1).map(
      (sourceView, sourceMipLevel) => engine.device.createBindGroup({
        label: `Merged ${side} mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
        layout: engine.paintMipDownsampleBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }),
    );
    const surface: MergedSurfaceResources = {
      texture,
      samplingView,
      mipViews,
      mipDownsampleBindGroups,
      bounds: { ...normalizedBounds },
      resolutionScale,
      textureWidth,
      textureHeight,
      mip0MemoryBytes: memory.mip0Bytes,
      mipChainMemoryBytes: memory.mipChainBytes,
      validThroughLevel: 0,
      layerCount,
      foldedPixels: 0,
      analyticBakePixels: 0,
    };
    engine.liveMergedSurfaceTextures.set(texture, surface);
    return surface;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export async function setLayerPresentation(engine: BrushEngine, 
  index: number,
  visible: boolean | undefined,
  opacity: number | undefined,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const record = engine.layerStack.at(index);
  const nextVisible = visible ?? record.visible;
  const nextOpacity = opacity ?? record.opacity;
  if (nextVisible === record.visible && nextOpacity === record.opacity) {
    return false;
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const previousVisible = record.visible;
  const previousOpacity = record.opacity;
  try {
    await engine.waitForIdle();
    record.visible = nextVisible;
    record.opacity = nextOpacity;
    // In final-stack mode the active opacity/visibility is baked into mip 1;
    // inactive-layer changes rebuild the merged view below. Both cases must
    // invalidate the shared display pyramid before the next presentation.
    engine.paintDisplayMipValidThroughLevel = 0;
    if (index !== engine.layerStack.activeIndex) {
      await engine.rebuildMergedLayerSurfaces();
    }
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    engine.publishStats();
    return true;
  } catch (error) {
    record.visible = previousVisible;
    record.opacity = previousOpacity;
    try {
      // The old merged textures were deliberately evicted before allocation.
      // Rebuild the reverted presentation from authoritative raw storage; the
      // injected fault queue was cleared by the failed attempt.
      await engine.rebuildMergedLayerSurfaces("layer-switch");
    } catch (restoreError) {
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo il compositing: ricarica prima di continuare.",
      );
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        `Compositing non riuscito (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
      );
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
  }
}

export function resolveFillSource(engine: BrushEngine): {
  record: LayerRecord;
  view: GPUTextureView;
} {
  const reference = engine.layerStack.reference;
  const record = reference === null ? engine.layerStack.active : reference;
  // `reference` throws for a stale identity and requireLayerHot throws for a
  // non-resident texture. Neither invariant violation may degrade to sampling
  // the active destination: no fallback is part of the public strategy.
  return {
    record,
    view: requireLayerHot(engine, record.id).samplingView,
  };
}

export function retargetFillRendererSource(engine: BrushEngine): void {
  if (!engine.fillRenderer) {
    return;
  }
  engine.fillRenderer.setSourceSamplingView(resolveFillSource(engine).view);
}

interface ReferenceLayerDemotion {
  readonly record: LayerRecord;
  readonly gpu: LayerGpuResources;
  readonly hot: LayerTextureResources;
  readonly cold: Awaited<ReturnType<typeof createLayerColdStorageCandidate>> | null;
  readonly mask: Uint32Array;
}

async function createReferenceLayerDemotion(
  engine: BrushEngine,
  record: LayerRecord,
): Promise<ReferenceLayerDemotion> {
  const gpu = engine.requireLayerGpu(record.id);
  const hot = requireLayerHot(engine, record.id);
  const mask = coldStorageMaskForRecord(record);
  if (!record.hasContent) {
    return { record, gpu, hot, cold: null, mask };
  }
  const generation = Math.max(
    gpu.cold?.generation ?? 0,
    gpu.compressed?.generation ?? 0,
  ) + 1;
  const cold = await createLayerColdStorageCandidate(
    engine,
    record,
    hot,
    mask,
    generation,
  );
  return { record, gpu, hot, cold, mask };
}

/**
 * Promotes only the active raster layer to Reference. When another reference
 * was kept full-resident, it is packed to authoritative cold tiles before its
 * hot texture is released. Any allocation failure leaves the old reference and
 * both source bindings untouched: there is deliberately no slower fallback.
 */
export async function setLayerReference(
  engine: BrushEngine,
  index: number,
  enabled: boolean,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const requested = engine.layerStack.at(index);
  const previousReference = engine.layerStack.reference;
  if (enabled && previousReference?.id === requested.id) {
    return false;
  }
  if (!enabled && previousReference?.id !== requested.id) {
    return false;
  }
  if (requested.id !== engine.layerStack.active.id) {
    throw new Error("Seleziona il livello raster prima di impostarlo come Riferimento.");
  }

  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  let demotion: ReferenceLayerDemotion | null = null;
  let referenceChanged = false;
  try {
    await engine.waitForIdle();
    if (
      enabled
      && previousReference
      && previousReference.id !== requested.id
    ) {
      demotion = await createReferenceLayerDemotion(engine, previousReference);
    }

    engine.layerStack.setReferenceIndex(enabled ? index : null);
    referenceChanged = true;
    retargetFillRendererSource(engine);

    if (demotion) {
      const supersededCold = demotion.gpu.cold;
      demotion.gpu.cold = demotion.cold;
      demotion.gpu.compressed = null;
      demotion.record.storageTileMask.set(demotion.mask);
      destroyLayerColdStorage(supersededCold);
      destroyLayerHot(demotion.hot);
      demotion.gpu.hot = null;
      // Ownership moved into gpu.cold; the catch path must not destroy it.
      demotion = null;
    }
    referenceChanged = false;
    engine.publishStats();
    return true;
  } catch (error) {
    if (referenceChanged) {
      const previousIndex = previousReference
        ? engine.layerStack.indexOfId(previousReference.id)
        : -1;
      engine.layerStack.setReferenceIndex(previousIndex >= 0 ? previousIndex : null);
      retargetFillRendererSource(engine);
    }
    if (demotion?.cold) {
      destroyLayerColdStorage(demotion.cold);
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
  }
}

export async function shrinkEffectsScratchAfterIdle(engine: BrushEngine): Promise<void> {
  if (
    engine.effectsScratchShrinkInFlight
    || bevelFieldBlocksScratchShrink(engine)
    || !effectsScratchNeedsShrink(engine)
  ) {
    engine.scheduleBevelFieldShrink();
    return;
  }
  if (!effectsScratchCanShrinkNow(engine)) {
    engine.scheduleEffectsScratchShrink();
    return;
  }

  engine.effectsScratchShrinkInFlight = true;
  try {
    await engine.device.queue.onSubmittedWorkDone();
    if (
      !effectsScratchCanShrinkNow(engine)
      || bevelFieldBlocksScratchShrink(engine)
    ) {
      engine.scheduleBevelFieldShrink();
      return;
    }

    const pool = engine.effectsWorkbench?.scratchPool;
    if (!pool) {
      return;
    }
    const before = pool.snapshot();
    const retainedWithoutBevel = Math.max(
      0,
      ...Object.entries(before.requirements)
        .filter(([effectId]) => effectId !== "bevel")
        .map(([, bytes]) => bytes),
    );
    if ((before.requirements.bevel ?? 0) > retainedWithoutBevel) {
      engine.rasterBevelRenderer?.releaseIdleWorkspace();
    }
    const shrunk = pool.shrinkToFit();
    if (shrunk) {
      engine.publishStats();
    }
  } finally {
    engine.effectsScratchShrinkInFlight = false;
    if (effectsScratchNeedsShrink(engine)) {
      engine.scheduleEffectsScratchShrink();
    }
  }
}

export function layerCompositeVisualBounds(engine: BrushEngine, record: LayerRecord): DirtyRect {
  const fullDocumentRect: DirtyRect = {
    x: 0,
    y: 0,
    width: LAYER_SIZE,
    height: LAYER_SIZE,
  };
  const contentBounds = normalizeLayerRect(record.contentBounds);
  if (!contentBounds) {
    // `hasContent` with no bounds is inconsistent metadata. Preserve pixels by
    // falling back to the old full-document contract.
    return fullDocumentRect;
  }

  let bounds: DirtyRect | null = contentBounds;
  const strokeStyle = normalizeRasterStrokeStyle(record.strokeStyle);
  if (strokeStyle.enabled && strokeStyle.width > 0) {
    bounds = mergeDirtyRects(
      bounds,
      rasterStrokeEffectRect(engine, contentBounds, strokeStyle.width),
    );
  }

  const bevelStyle = normalizeRasterBevelStyle(record.bevelStyle);
  if (bevelStyle.enabled) {
    bounds = mergeDirtyRects(
      bounds,
      rasterBevelEffectRect(engine, contentBounds, bevelStyle),
    );
  }

  const outerShadowStyle = normalizeRasterOuterShadowStyle(record.outerShadowStyle);
  if (outerShadowStyle.enabled) {
    bounds = mergeDirtyRects(
      bounds,
      rasterOuterShadowEffectRect(engine, contentBounds, outerShadowStyle),
    );
  }

  const innerShadowStyle = normalizeRasterInnerShadowStyle(record.innerShadowStyle);
  if (innerShadowStyle.enabled) {
    bounds = mergeDirtyRects(
      bounds,
      rasterInnerShadowEffectRect(engine, contentBounds, innerShadowStyle),
    );
  }
  return normalizeLayerRect(bounds) ?? fullDocumentRect;
}

export async function buildMergedSurfaceCandidate(engine: BrushEngine, 
  records: readonly LayerRecord[],
  side: "below" | "above",
  caller: EffectsRetargetCaller,
): Promise<MergedSurfaceResources | null> {
  const visibleRecords = records.filter(
    (record) => record.visible && record.opacity > 0 && record.hasContent,
  );
  if (visibleRecords.length === 0) {
    return null;
  }

  return runGpuAllocationTransaction(
    engine.device,
    `Merged ${side} surface transaction`,
    async (transaction) => {
      const surface = allocateMergedSurface(engine, 
        engine.layerFormat,
        side,
        visibleRecords.length,
      );
      transaction.deferRollback(() => engine.destroyMergedSurface(surface));

      let first = true;
      for (const record of visibleRecords) {
        await foldRasterRecordIntoMergedSurface(engine, surface, record, side, caller, first);
        first = false;
      }

      if (engine.paintDisplaySelectedMipLevel > 0) {
        const encoder = engine.device.createCommandEncoder({
          label: `Build merged ${side} display pyramid`,
        });
        encodeMergedSurfacePyramid(engine, 
          encoder,
          surface,
          engine.paintDisplaySelectedMipLevel,
        );
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped(`Piramide merged ${side}`);
      }
      return surface;
    },
  );
}

export async function bakeActiveLayerForSwitchAttempt(engine: BrushEngine): Promise<void> {
  const record = engine.layerStack.active;
  const gpu = engine.requireLayerGpu(record.id);
  const hot = requireLayerHot(engine, record.id);
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  if (!engine.layerHasContent || !requirements.needsStrokeRenderer) {
    const previous = gpu.bake;
    gpu.bake = null;
    gpu.bakeValid = false;
    engine.destroyLayerBake(previous);
    return;
  }

  const faultForcesCandidate = import.meta.env.DEV
    && engine.layerBakeFaultQueue[0] === "after-candidate-submit";
  if (gpu.bake && gpu.bakeValid && !faultForcesCandidate) {
    return;
  }

  const workbench = engine.effectsWorkbench;
  if (!engine.rasterStrokeRenderer || !workbench) {
    throw new Error("Bake impossibile: compositore effetti non disponibile.");
  }
  if (
    engine.layerView !== hot.view
    || workbench.sourceView !== hot.view
    || engine.layerStack.active.id !== record.id
  ) {
    throw new Error("Bake rifiutato: il banco effetti non punta al livello uscente.");
  }

  const previous = gpu.bake;
  const generation = (previous?.generation ?? 0) + 1;
  const completed = await engine.createLayerBakeCandidate(record, generation, true);
  gpu.bake = completed;
  gpu.bakeValid = true;
  engine.destroyLayerBake(previous);
}

export function layerDirtyRectToPresentationRect(engine: BrushEngine, 
  dirtyRect: DirtyRect,
  selectedMipLevel: number,
): DirtyRect | null {
  const width = engine.canvas.width;
  const height = engine.canvas.height;
  if (width <= 0 || height <= 0) {
    return null;
  }

  // Il display usa filtraggio lineare sul mip selezionato: un texel derivato
  // copre 2^LOD pixel layer e può contribuire anche al campione adiacente.
  // Il margine 2^(LOD+1), più un pixel canvas, è conservativo anche rispetto
  // agli arrotondamenti f32 e ai confini interi dello scissor.
  const layerMargin = Math.max(2, 2 ** (selectedMipLevel + 1));
  const canvasMargin = 1;
  const layerLeft = dirtyRect.x - layerMargin;
  const layerTop = dirtyRect.y - layerMargin;
  const layerRight = dirtyRect.x + dirtyRect.width + layerMargin;
  const layerBottom = dirtyRect.y + dirtyRect.height + layerMargin;
  const topLeft = layerToCanvasPixels(engine, layerLeft, layerTop);
  const topRight = layerToCanvasPixels(engine, layerRight, layerTop);
  const bottomLeft = layerToCanvasPixels(engine, layerLeft, layerBottom);
  const bottomRight = layerToCanvasPixels(engine, layerRight, layerBottom);
  const canvasLeft = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const canvasTop = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
  const canvasRight = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
  const canvasBottom = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

  const x = Math.max(0, Math.floor(Math.min(canvasLeft, canvasRight)) - canvasMargin);
  const y = Math.max(0, Math.floor(Math.min(canvasTop, canvasBottom)) - canvasMargin);
  const right = Math.min(width, Math.ceil(Math.max(canvasLeft, canvasRight)) + canvasMargin);
  const bottom = Math.min(height, Math.ceil(Math.max(canvasTop, canvasBottom)) + canvasMargin);
  const dirtyWidth = Math.max(0, right - x);
  const dirtyHeight = Math.max(0, bottom - y);
  return dirtyWidth > 0 && dirtyHeight > 0
    ? { x, y, width: dirtyWidth, height: dirtyHeight }
    : null;
}

export function encodeMergedSurfacePyramid(engine: BrushEngine, 
  encoder: GPUCommandEncoder,
  surface: MergedSurfaceResources,
  selectedMipLevel: number,
): number {
  let passes = 0;
  const targetMipLevel = Math.min(
    selectedMipLevel,
    surface.mipViews.length - 1,
  );
  for (
    let mipLevel = surface.validThroughLevel + 1;
    mipLevel <= targetMipLevel;
    mipLevel += 1
  ) {
    const pass = encoder.beginRenderPass({
      label: `Build merged surface mip ${mipLevel}`,
      colorAttachments: [{
        view: surface.mipViews[mipLevel],
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(engine.paintMipDownsamplePipeline);
    pass.setBindGroup(0, surface.mipDownsampleBindGroups[mipLevel - 1]);
    pass.draw(3, 1, 0, 0);
    pass.end();
    passes += 1;
  }
  surface.validThroughLevel = Math.max(surface.validThroughLevel, targetMipLevel);
  return passes;
}

export function encodeMergedDisplayPyramids(engine: BrushEngine, 
  encoder: GPUCommandEncoder,
  selectedMipLevel: number,
): number {
  let passes = 0;
  if (engine.mergedBelow) {
    passes += encodeMergedSurfacePyramid(engine, 
      encoder,
      engine.mergedBelow,
      Math.max(selectedMipLevel, requiredMergedSurfaceMipLevel(engine, engine.mergedBelow)),
    );
  }
  if (engine.mergedAbove) {
    passes += encodeMergedSurfacePyramid(engine, 
      encoder,
      engine.mergedAbove,
      Math.max(selectedMipLevel, requiredMergedSurfaceMipLevel(engine, engine.mergedAbove)),
    );
  }
  for (const segment of engine.mixedSceneRasterSegments) {
    passes += encodeMergedSurfacePyramid(engine, 
      encoder,
      segment.surface,
      Math.max(
        selectedMipLevel,
        requiredMergedSurfaceMipLevel(engine, segment.surface),
      ),
    );
  }
  return passes;
}

export async function freezeActiveLayerToCold(engine: BrushEngine): Promise<void> {
  const record = engine.layerStack.active;
  const gpu = engine.requireLayerGpu(record.id);
  const hot = requireLayerHot(engine, record.id);
  const previous = gpu.cold;
  const previousCompressed = gpu.compressed;
  if (!record.hasContent) {
    gpu.cold = null;
    gpu.compressed = null;
    destroyLayerColdStorage(previous);
    return;
  }
  const mask = coldStorageMaskForRecord(record);
  const generation = Math.max(
    previous?.generation ?? 0,
    previousCompressed?.generation ?? 0,
  ) + 1;
  const candidate = await createLayerColdStorageCandidate(engine, 
    record,
    hot,
    mask,
    generation,
  );
  gpu.cold = candidate;
  gpu.compressed = null;
  record.storageTileMask.set(mask);
  destroyLayerColdStorage(previous);
}

export function allocateActiveLayerDisplayPyramid(engine: BrushEngine, format: LayerFormat): DisplayPyramidResources {
  const texture = engine.device.createTexture({
    label: `Single active-layer display pyramid ${format}`,
    size: { width: LAYER_SIZE >> 1, height: LAYER_SIZE >> 1, depthOrArrayLayers: 1 },
    mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    const samplingView = texture.createView({ label: `Active logical mips 1–12 ${format}` });
    const mipViews = Array.from(
      { length: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1 },
      (_, mipLevel) => texture.createView({
        label: `Active logical mip ${mipLevel + 1} ${format}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }),
    );
    return { texture, samplingView, mipViews };
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export async function restoreEffectsWorkbenchToActiveLayer(engine: BrushEngine, 
  caller: EffectsRetargetCaller = "layer-switch",
  force = false,
): Promise<void> {
  const record = engine.layerStack.active;
  const hot = requireLayerHot(engine, record.id);
  if (!force && engine.effectsWorkbench?.sourceView === hot.view) {
    return;
  }
  await ensureEffectRenderersForRecord(engine, record);
  await retargetEffectsWorkingSetInternal(engine, 
    hot.view,
    engine.layerFormat,
    record.contentBounds,
    caller,
    record,
    false,
    true,
  );
}

export function effectsScratchNeedsShrink(engine: BrushEngine): boolean {
  const snapshot = engine.effectsWorkbench?.scratchPool.snapshot();
  if (!snapshot || snapshot.currentBytes === 0) {
    return false;
  }
  let retainedBytes = 0;
  for (const [effectId, bytes] of Object.entries(snapshot.requirements)) {
    if (effectId !== "bevel") {
      retainedBytes = Math.max(retainedBytes, bytes);
    }
  }
  // Releasing the Smusso workspace only pays off when it actually reclaims
  // something material. When the Smusso footprint merely exceeds the Traccia
  // one by a little — reachable from the shipped UI with a hard chisel at a
  // large size — an unconditional comparison stays true in steady state and
  // turns every idle gap between two strokes into a free/regrow cycle.
  return effectsScratchShrinkIsWorthwhile(snapshot.currentBytes, retainedBytes);
}

export function rebuildLayerDisplayBindGroups(engine: BrushEngine): void {
  engine.displayBindGroup = engine.device.createBindGroup({
    label: "Three-surface layer display bind group",
    layout: engine.displayBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: engine.layerView },
      { binding: 2, resource: engine.activeLayerDisplayPyramid.samplingView },
      { binding: 3, resource: engine.mergedBelowView() },
      { binding: 4, resource: engine.mergedAboveView() },
      { binding: 5, resource: engine.sampler },
    ],
  });
  engine.paintStackCompositeMipBindGroup = engine.device.createBindGroup({
    label: "Final raster stack composited mip 1 bind group",
    layout: engine.paintStackCompositeMipBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: engine.layerView },
      { binding: 2, resource: engine.mergedBelowView() },
      { binding: 3, resource: engine.mergedAboveView() },
    ],
  });
  // Mip 1 may currently contain a fold of the previous active/merged views.
  // Resource retargeting therefore invalidates the shared pyramid regardless
  // of its current content mode.
  engine.paintDisplayMipValidThroughLevel = 0;
  rebuildVectorTextDisplayBindGroup(engine);
  engine.rebuildRasterStrokeDisplayBindGroups();
}

export function commitActiveLayerResidency(engine: BrushEngine, fromIndex: number): void {
  const activeGpu = engine.requireLayerGpu(engine.layerStack.active.id);
  requireLayerHot(engine, engine.layerStack.active.id);
  destroyLayerColdStorage(activeGpu.cold);
  activeGpu.cold = null;
  activeGpu.compressed = null;

  const previousRecord = engine.layerStack.at(fromIndex);
  if (previousRecord.id === engine.layerStack.active.id) {
    return;
  }
  if (previousRecord.id === engine.layerStack.referenceLayerId) {
    // Fill must sample the reference immediately on every target layer. Its
    // authoritative mip 0 therefore remains full-resident by contract.
    return;
  }
  const previousGpu = engine.requireLayerGpu(previousRecord.id);
  destroyLayerHot(previousGpu.hot);
  previousGpu.hot = null;
}

export function rebuildActiveLayerPyramidBindings(engine: BrushEngine): void {
  engine.paintMipViews = [engine.layerView, ...engine.activeLayerDisplayPyramid.mipViews];
  const sources = [
    engine.layerView,
    ...engine.activeLayerDisplayPyramid.mipViews.slice(0, -1),
  ];
  engine.paintMipDownsampleBindGroups = sources.map((sourceView, sourceMipLevel) =>
    engine.device.createBindGroup({
      label: `Active display logical mip ${sourceMipLevel} to ${sourceMipLevel + 1}`,
      layout: engine.paintMipDownsampleBindGroupLayout,
      entries: [{ binding: 0, resource: sourceView }],
    })
  );
}

export function effectsScratchCanShrinkNow(engine: BrushEngine): boolean {
  return effectsScratchCanShrink({
    initialized: engine.initialized,
    activeStroke: engine.activeStroke !== null,
    historyBusy: engine.historyBusy,
    rasterStrokeBusy: engine.rasterStrokeBusy,
    rasterBevelBusy: engine.rasterBevelBusy,
    rasterOuterShadowBusy: engine.rasterOuterShadowBusy,
    rasterInnerShadowBusy: engine.rasterInnerShadowBusy,
    queuedWork: engine.effectsScratchHasQueuedWork(),
  });
}

export async function bakeActiveLayerForSwitch(engine: BrushEngine): Promise<void> {
  try {
    await bakeActiveLayerForSwitchAttempt(engine);
  } finally {
    if (import.meta.env.DEV) {
      // A fault that was not reached by this attempt must not ambush a later,
      // unrelated switch.
      engine.layerBakeFaultQueue = [];
    }
  }
}

export function clientToLayer(engine: BrushEngine, clientX: number, clientY: number): { x: number; y: number } {
  const screen = clientToCanvasPixels(engine, clientX, clientY);
  const offset = canvasOffsetToLayerOffset(engine, 
    screen.x - engine.canvas.width * 0.5,
    screen.y - engine.canvas.height * 0.5,
  );
  return {
    x: engine.viewCenterX + offset.x,
    y: engine.viewCenterY + offset.y,
  };
}

export async function allocateLayerGpuResources(engine: BrushEngine, 
  format: LayerFormat,
  label: string,
): Promise<LayerGpuResources> {
  return runGpuAllocationTransaction(engine.device, label, (transaction) => {
    const hot = engine.allocateLayerTexture(format);
    transaction.deferRollback(() => hot.texture.destroy());
    return { hot, cold: null, compressed: null, bake: null, bakeValid: false };
  });
}

export function destroyLayerGpuResources(engine: BrushEngine, gpu: LayerGpuResources): void {
  engine.destroyLayerBake(gpu.bake);
  destroyLayerColdStorage(gpu.cold);
  destroyLayerHot(gpu.hot);
  gpu.bake = null;
  gpu.bakeValid = false;
  gpu.cold = null;
  gpu.compressed = null;
  gpu.hot = null;
}

export function layerToCanvasPixels(engine: BrushEngine, layerX: number, layerY: number): { x: number; y: number } {
  const offset = layerOffsetToCanvasOffset(engine, 
    layerX - engine.viewCenterX,
    layerY - engine.viewCenterY,
  );
  return {
    x: engine.canvas.width * 0.5 + offset.x,
    y: engine.canvas.height * 0.5 + offset.y,
  };
}

export function invalidateActiveLayerBake(engine: BrushEngine): void {
  if (!engine.initialized) {
    return;
  }
  const gpu = engine.layerGpu.get(engine.layerStack.active.id);
  if (gpu) {
    gpu.bakeValid = false;
  }
}

export function bindActiveLayerResources(engine: BrushEngine): void {
  const hot = requireLayerHot(engine, engine.layerStack.active.id);
  engine.layerTexture = hot.texture;
  engine.layerView = hot.view;
  engine.layerSamplingView = hot.samplingView;
  rebuildActiveLayerPyramidBindings(engine);
  rebuildLayerDisplayBindGroups(engine);
}

export function canvasOffsetToLayerOffset(engine: BrushEngine, deltaX: number, deltaY: number): { x: number; y: number } {
  const scaledX = deltaX / engine.zoom;
  const scaledY = deltaY / engine.zoom;
  return {
    x: engine.viewRotationCos * scaledX + engine.viewRotationSin * scaledY,
    y: -engine.viewRotationSin * scaledX + engine.viewRotationCos * scaledY,
  };
}

export function cancelEffectsScratchShrink(engine: BrushEngine): void {
  if (engine.effectsScratchShrinkTimer === null) {
    return;
  }
  window.clearTimeout(engine.effectsScratchShrinkTimer);
  engine.effectsScratchShrinkTimer = null;
}

export function requireLayerHot(engine: BrushEngine, layerId: number): LayerTextureResources {
  const hot = engine.requireLayerGpu(layerId).hot;
  if (!hot) {
    throw new Error(`Texture full-canvas del livello ${layerId} non residente.`);
  }
  return hot;
}

export function maybeInjectLayerBakeFault(engine: BrushEngine, point: LayerBakeFaultPoint): void {
  if (!import.meta.env.DEV || engine.layerBakeFaultQueue[0] !== point) {
    return;
  }
  engine.layerBakeFaultQueue.shift();
  throw new Error(`Guasto iniettato nel bake: ${point}.`);
}

export function maybeInjectLayerCompositeFault(engine: BrushEngine, point: LayerCompositeFaultPoint): void {
  if (!import.meta.env.DEV || engine.layerCompositeFaultQueue[0] !== point) {
    return;
  }
  engine.layerCompositeFaultQueue.shift();
  throw new Error(`Guasto iniettato nel compositing: ${point}.`);
}

export function releaseFusedLayerBakes(engine: BrushEngine): void {
  for (const gpu of engine.layerGpu.values()) {
    engine.destroyLayerBake(gpu.bake);
    gpu.bake = null;
    gpu.bakeValid = false;
  }
}

export function mergedSurfaceSamplingLod(engine: BrushEngine, surface: MergedSurfaceResources): number {
  return Math.max(
    0,
    Math.log2(surface.resolutionScale / Math.max(engine.zoom, 1e-6)),
  );
}

export function requiredMergedSurfaceMipLevel(engine: BrushEngine, surface: MergedSurfaceResources): number {
  return Math.min(
    surface.mipViews.length - 1,
    Math.ceil(mergedSurfaceSamplingLod(engine, surface)),
  );
}

export function layerOffsetToCanvasOffset(engine: BrushEngine, deltaX: number, deltaY: number): { x: number; y: number } {
  return {
    x: (engine.viewRotationCos * deltaX - engine.viewRotationSin * deltaY) * engine.zoom,
    y: (engine.viewRotationSin * deltaX + engine.viewRotationCos * deltaY) * engine.zoom,
  };
}

export function destroyLayerBakeTexture(engine: BrushEngine, texture: GPUTexture): void {
  engine.liveLayerBakeTextures.delete(texture);
  texture.destroy();
}

export function destroyMergedSurfaceTexture(engine: BrushEngine, texture: GPUTexture): void {
  engine.liveMergedSurfaceTextures.delete(texture);
  texture.destroy();
}
