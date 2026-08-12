import type { BrushEngine } from "./brush-engine";
import {
  type EffectsWorkbenchRetargetResult,
  type LayerBakeFaultPoint,
  type LayerCompositeFaultPoint,
  type LayerFormat,
} from "./engine-types";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { createRenderPipelineAsync } from "./engine-gpu-utils";
import {
  effectsRetargetCallerForHistoryReplay,
  type ActiveClippingGroupResources,
  type ActiveClippingSuffixStepResources,
  type DisplayPyramidResources,
  type EffectsRetargetCaller,
  type LayerBakeResources,
  type LayerColdStorageResources,
  type LayerCompressedColdStorageResources,
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
  decompressLayerColdChunk,
  destroyLayerColdStorage,
  destroyLayerHot,
  destroyTransientLayerHydration,
} from "./engine-cold-storage";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  LAYER_COMPOSITE_UNIFORM_BYTES,
  PAINT_DISPLAY_MIP_LEVEL_COUNT,
} from "./engine-limits";
import { destroyLightGlazeResources } from "./engine-glaze-runtime";
import {
  clearLayerStorageTileMask,
  LAYER_STORAGE_TILE_COUNT,
  LAYER_STORAGE_TILE_HEIGHT,
  LAYER_STORAGE_TILE_WIDTH,
} from "./layer-storage-study";
import {
  createMixedSceneRasterSegmentResources,
  destroyMixedSceneRasterSegment,
  ensureMixedSceneLinearTexture,
  mixedSceneItemIsVisible,
  prewarmMixedSceneLinearTextureForLayerBlend,
  publishMixedScene,
  rebuildVectorTextDisplayBindGroup,
} from "./engine-vector-text-runtime";
import { type DirtyRect } from "./engine-stroke-types";
import { layerEffectRendererRequirements, type LayerRecord } from "./layer-stack";
import {
  LAYER_BLEND_MODE_CODES,
  isLayerBlendMode,
  type LayerBlendMode,
} from "./layer-blend-modes";
import {
  LAYER_BLEND_FOLD_TILE_EXTENT,
  LAYER_BLEND_FOLD_UNIFORM_BYTES,
} from "./layer-blend-fold-shader";
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
import {
  type MixedSceneCompositionSegment,
  type MixedSceneItem,
  type MixedSceneRasterRunKey,
} from "./mixed-scene-stack";
import { type VectorTextViewState } from "./vector-text-types";
import { normalizeRasterBevelStyle } from "./bevel-core";
import { normalizeRasterInnerShadowStyle, normalizeRasterOuterShadowStyle } from "./shadow-core";
import { normalizeRasterStrokeStyle } from "./stroke-core";
import { normalizeRasterColorOverlayStyle } from "./raster-color-overlay-core";
import { effectsScratchCanShrink, effectsScratchShrinkIsWorthwhile } from "./effects-scratch-pool";
import {
  rasterEffectRendererReachability,
  type RasterEffectRendererReachability,
} from "./effects-resource-lifecycle";
import { historyFloorCursor } from "./history-maintenance-runtime";
import {
  destroyThicknessTailOverlayResources,
  ensureEffectRenderersForRecord,
  releaseRasterBevelRenderer,
  releaseRasterInnerShadowRenderer,
  releaseRasterOuterShadowRenderer,
  releaseRasterStrokeRenderer,
} from "./engine-resource-setup";
import {
  ensureLayerBlendTilePresentationResources,
  layerBlendTilePresentationRequired,
  releaseLayerBlendTilePresentationResources,
} from "./engine-layer-blend-tile-runtime";
import {
  bevelFieldBlocksScratchShrink,
  clientToCanvasPixels,
  encodeRasterStrokeDisplayPyramid,
  rasterBevelEffectRect,
  rasterInnerShadowEffectRect,
  rasterOuterShadowEffectRect,
  rasterStrokeEffectRect,
} from "./engine-runtime-misc";
import { combineCompressionHashes } from "./engine-math";
import { LAYER_COLD_TILE_COMPOSITE_BATCH_TILES } from "./layer-cold-tile-composite-shader";

export interface RecreateLayerResourcesOptions {
  /** Compile pixel-selection paint variants after the initial canvas is visible. */
  readonly deferSelectionPipelines?: boolean;
  /** Build the dry-blend renderer after the initial raster canvas is visible. */
  readonly deferBlendRenderer?: boolean;
}

export async function recreateLayerResources(
  engine: BrushEngine,
  format: LayerFormat,
  options: RecreateLayerResourcesOptions = {},
): Promise<void> {
  const oldBlendRenderer = engine.blendRenderer;
  const oldEffectsWorkbench = engine.effectsWorkbench;
  const previousScratchPeakBytes = oldEffectsWorkbench?.scratchPool.peakBytes ?? 0;
  const {
    selectionPipelineByBase,
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
    lightGlazeFinalRasterStackCompositeMipPipeline,
    lightGlazeCompositePipeline,
    lightGlazeCommitTilePipeline,
    paintMipDownsamplePipeline,
    paintStackCompositeMipPipeline,
    activeClippingGroupMipPipeline,
    layerCompositePipeline,
    layerSourceAtopPipeline,
    layerColdTileCompositePipeline,
    layerColdTileSourceAtopPipeline,
    layerBlendFoldPipeline,
    warmSelectionPipelines,
  } = await runGpuAllocationTransaction(
    engine.device,
    `Pipeline formato layer ${format}`,
    async () => {
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
  const selectionBrushPipelineLayout = engine.device.createPipelineLayout({
    label: `Brush con clip Selezione pixel ${format}`,
    bindGroupLayouts: [engine.brushBindGroupLayout, engine.selectionMaskBindGroupLayout],
  });
  const selectionBrushOccupancyPipelineLayout = engine.device.createPipelineLayout({
    label: `Brush occupancy con clip Selezione pixel ${format}`,
    bindGroupLayouts: [engine.brushOccupancyBindGroupLayout, engine.selectionMaskBindGroupLayout],
  });
  const selectionGrainBrushPipelineLayout = engine.device.createPipelineLayout({
    label: `Grain con clip Selezione pixel ${format}`,
    bindGroupLayouts: [engine.grainBrushBindGroupLayout, engine.selectionMaskBindGroupLayout],
  });
  const selectionGrainBrushOccupancyPipelineLayout = engine.device.createPipelineLayout({
    label: `Grain occupancy con clip Selezione pixel ${format}`,
    bindGroupLayouts: [
      engine.grainBrushOccupancyBindGroupLayout,
      engine.selectionMaskBindGroupLayout,
    ],
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
  const layerColdTileCompositePipelineLayout = engine.device.createPipelineLayout({
    label: `Direct cold tile fold pipeline layout ${format}`,
    bindGroupLayouts: [engine.layerColdTileCompositeBindGroupLayout],
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
          format: "r16float",
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
    `Light Glaze circle MAX per gesture r16float`,
    brushPipelineLayout,
    engine.brushShaderModule,
    "vertexMain",
    "coverageFragmentMain",
  );
  const lightNoBuildUpShapePipeline = createLightNoBuildUpPipeline(
    `Light Glaze Shape MAX per gesture r16float`,
    brushPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "shapeCoverageFragmentMain",
  );
  const lightNoBuildUpShapeOccupancyPipeline = createLightNoBuildUpPipeline(
    `Light Glaze Shape occupancy MAX per gesture r16float`,
    brushOccupancyPipelineLayout,
    engine.brushShaderModule,
    "shapeVertexMain",
    "shapeOccupancyCoverageFragmentMain",
  );
  const grainLightNoBuildUpPipeline = createLightNoBuildUpPipeline(
    `Light Glaze Texturized circle MAX per gesture r16float`,
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "vertexMain",
    "coverageFragmentMain",
  );
  const grainLightNoBuildUpShapePipeline = createLightNoBuildUpPipeline(
    `Light Glaze Texturized Shape MAX per gesture r16float`,
    grainBrushPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "shapeCoverageFragmentMain",
  );
  const grainLightNoBuildUpShapeOccupancyPipeline = createLightNoBuildUpPipeline(
    `Light Glaze Texturized Shape occupancy MAX per gesture r16float`,
    grainBrushOccupancyPipelineLayout,
    engine.texturizedGrainShaderModule,
    "shapeVertexMain",
    "shapeOccupancyCoverageFragmentMain",
  );

  const selectionPipelineByBase = new Map<GPURenderPipeline, GPURenderPipeline>();
  const sourceOverBlend: GPUBlendState = {
    color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
  const additiveBlend: GPUBlendState = {
    color: { operation: "add", srcFactor: "one", dstFactor: "one" },
    alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
  const maximumBlend: GPUBlendState = {
    color: { operation: "max", srcFactor: "one", dstFactor: "one" },
    alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
  };
  interface SelectionPipelineVariant {
    readonly base: GPURenderPipeline;
    readonly label: string;
    readonly layout: GPUPipelineLayout;
    readonly fragmentModule: GPUShaderModule;
    readonly vertexEntryPoint: string;
    readonly fragmentEntryPoint: string;
    readonly targetFormat: GPUTextureFormat;
    readonly blend: GPUBlendState;
  }
  const registerSelectionPipeline = async (
    variant: SelectionPipelineVariant,
  ): Promise<void> => {
    const selectedPipeline = await createRenderPipelineAsync(engine.device, {
      label: `${variant.label} · clip Selezione pixel`,
      layout: variant.layout,
      vertex: {
        module: engine.brushShaderModule,
        entryPoint: variant.vertexEntryPoint,
      },
      fragment: {
        module: variant.fragmentModule,
        entryPoint: variant.fragmentEntryPoint,
        targets: [{ format: variant.targetFormat, blend: variant.blend }],
      },
      primitive: { topology: "triangle-strip" },
    });
    selectionPipelineByBase.set(variant.base, selectedPipeline);
  };
  const brushVariant = (
    base: GPURenderPipeline,
    label: string,
    layout: GPUPipelineLayout,
    vertexEntryPoint: string,
    fragmentEntryPoint: string,
    blend: GPUBlendState,
  ): SelectionPipelineVariant => ({
    base,
    label,
    layout,
    fragmentModule: engine.selectionBrushShaderModule,
    vertexEntryPoint,
    fragmentEntryPoint,
    targetFormat: format,
    blend,
  });
  const grainVariant = (
    base: GPURenderPipeline,
    label: string,
    layout: GPUPipelineLayout,
    vertexEntryPoint: string,
    fragmentEntryPoint: string,
    blend: GPUBlendState,
  ): SelectionPipelineVariant => ({
    base,
    label,
    layout,
    fragmentModule: engine.selectionTexturizedGrainShaderModule,
    vertexEntryPoint,
    fragmentEntryPoint,
    targetFormat: format,
    blend,
  });
  const selectionVariants: SelectionPipelineVariant[] = [
    brushVariant(normalPipeline, "Brush normal", selectionBrushPipelineLayout, "vertexMain", "fragmentMain", sourceOverBlend),
    brushVariant(additivePipeline, "Brush additive", selectionBrushPipelineLayout, "vertexMain", "fragmentMain", additiveBlend),
    brushVariant(shapeNormalPipeline, "Brush Shape normal", selectionBrushPipelineLayout, "shapeVertexMain", "shapeFragmentMain", sourceOverBlend),
    brushVariant(shapeAdditivePipeline, "Brush Shape additive", selectionBrushPipelineLayout, "shapeVertexMain", "shapeFragmentMain", additiveBlend),
    brushVariant(shapeOccupancyNormalPipeline, "Brush Shape occupancy normal", selectionBrushOccupancyPipelineLayout, "shapeVertexMain", "shapeOccupancyFragmentMain", sourceOverBlend),
    brushVariant(shapeOccupancyAdditivePipeline, "Brush Shape occupancy additive", selectionBrushOccupancyPipelineLayout, "shapeVertexMain", "shapeOccupancyFragmentMain", additiveBlend),
    grainVariant(grainNormalPipeline, "Brush Grain normal", selectionGrainBrushPipelineLayout, "vertexMain", "fragmentMain", sourceOverBlend),
    grainVariant(grainAdditivePipeline, "Brush Grain additive", selectionGrainBrushPipelineLayout, "vertexMain", "fragmentMain", additiveBlend),
    grainVariant(grainShapeNormalPipeline, "Brush Grain Shape normal", selectionGrainBrushPipelineLayout, "shapeVertexMain", "shapeFragmentMain", sourceOverBlend),
    grainVariant(grainShapeAdditivePipeline, "Brush Grain Shape additive", selectionGrainBrushPipelineLayout, "shapeVertexMain", "shapeFragmentMain", additiveBlend),
    grainVariant(grainShapeOccupancyNormalPipeline, "Brush Grain Shape occupancy normal", selectionGrainBrushOccupancyPipelineLayout, "shapeVertexMain", "shapeOccupancyFragmentMain", sourceOverBlend),
    grainVariant(grainShapeOccupancyAdditivePipeline, "Brush Grain Shape occupancy additive", selectionGrainBrushOccupancyPipelineLayout, "shapeVertexMain", "shapeOccupancyFragmentMain", additiveBlend),
  ];
  const addGlazeVariant = (
    base: GPURenderPipeline,
    label: string,
    layout: GPUPipelineLayout,
    fragmentModule: GPUShaderModule,
    vertexEntryPoint: string,
    fragmentEntryPoint: string,
  ): void => {
    selectionVariants.push({
      base,
      label,
      layout,
      fragmentModule,
      vertexEntryPoint,
      fragmentEntryPoint,
      targetFormat: "rgba16float",
      blend: sourceOverBlend,
    });
  };
  addGlazeVariant(uniformedGlazePipeline, "Uniformed circle", selectionBrushPipelineLayout, engine.selectionBrushShaderModule, "vertexMain", "fragmentMain");
  addGlazeVariant(uniformedGlazeShapePipeline, "Uniformed Shape", selectionBrushPipelineLayout, engine.selectionBrushShaderModule, "shapeVertexMain", "shapeFragmentMain");
  addGlazeVariant(uniformedGlazeShapeOccupancyPipeline, "Uniformed Shape occupancy", selectionBrushOccupancyPipelineLayout, engine.selectionBrushShaderModule, "shapeVertexMain", "shapeOccupancyFragmentMain");
  addGlazeVariant(grainUniformedGlazePipeline, "Uniformed Grain circle", selectionGrainBrushPipelineLayout, engine.selectionTexturizedGrainShaderModule, "vertexMain", "fragmentMain");
  addGlazeVariant(grainUniformedGlazeShapePipeline, "Uniformed Grain Shape", selectionGrainBrushPipelineLayout, engine.selectionTexturizedGrainShaderModule, "shapeVertexMain", "shapeFragmentMain");
  addGlazeVariant(grainUniformedGlazeShapeOccupancyPipeline, "Uniformed Grain Shape occupancy", selectionGrainBrushOccupancyPipelineLayout, engine.selectionTexturizedGrainShaderModule, "shapeVertexMain", "shapeOccupancyFragmentMain");
  addGlazeVariant(intenseBlendingPipeline, "Intense circle", selectionBrushPipelineLayout, engine.selectionBrushShaderModule, "vertexMain", "encodedSrgbFragmentMain");
  addGlazeVariant(intenseBlendingShapePipeline, "Intense Shape", selectionBrushPipelineLayout, engine.selectionBrushShaderModule, "shapeVertexMain", "encodedSrgbShapeFragmentMain");
  addGlazeVariant(intenseBlendingShapeOccupancyPipeline, "Intense Shape occupancy", selectionBrushOccupancyPipelineLayout, engine.selectionBrushShaderModule, "shapeVertexMain", "encodedSrgbShapeOccupancyFragmentMain");
  addGlazeVariant(grainIntenseBlendingPipeline, "Intense Grain circle", selectionGrainBrushPipelineLayout, engine.selectionTexturizedGrainShaderModule, "vertexMain", "encodedSrgbFragmentMain");
  addGlazeVariant(grainIntenseBlendingShapePipeline, "Intense Grain Shape", selectionGrainBrushPipelineLayout, engine.selectionTexturizedGrainShaderModule, "shapeVertexMain", "encodedSrgbShapeFragmentMain");
  addGlazeVariant(grainIntenseBlendingShapeOccupancyPipeline, "Intense Grain Shape occupancy", selectionGrainBrushOccupancyPipelineLayout, engine.selectionTexturizedGrainShaderModule, "shapeVertexMain", "encodedSrgbShapeOccupancyFragmentMain");

  const addLightVariant = (
    base: GPURenderPipeline,
    label: string,
    layout: GPUPipelineLayout,
    fragmentModule: GPUShaderModule,
    vertexEntryPoint: string,
    fragmentEntryPoint: string,
  ): void => {
    selectionVariants.push({
      base,
      label,
      layout,
      fragmentModule,
      vertexEntryPoint,
      fragmentEntryPoint,
      targetFormat: "r16float",
      blend: maximumBlend,
    });
  };
  addLightVariant(lightNoBuildUpPipeline, "Light circle", selectionBrushPipelineLayout, engine.selectionBrushShaderModule, "vertexMain", "coverageFragmentMain");
  addLightVariant(lightNoBuildUpShapePipeline, "Light Shape", selectionBrushPipelineLayout, engine.selectionBrushShaderModule, "shapeVertexMain", "shapeCoverageFragmentMain");
  addLightVariant(lightNoBuildUpShapeOccupancyPipeline, "Light Shape occupancy", selectionBrushOccupancyPipelineLayout, engine.selectionBrushShaderModule, "shapeVertexMain", "shapeOccupancyCoverageFragmentMain");
  addLightVariant(grainLightNoBuildUpPipeline, "Light Grain circle", selectionGrainBrushPipelineLayout, engine.selectionTexturizedGrainShaderModule, "vertexMain", "coverageFragmentMain");
  addLightVariant(grainLightNoBuildUpShapePipeline, "Light Grain Shape", selectionGrainBrushPipelineLayout, engine.selectionTexturizedGrainShaderModule, "shapeVertexMain", "shapeCoverageFragmentMain");
  addLightVariant(grainLightNoBuildUpShapeOccupancyPipeline, "Light Grain Shape occupancy", selectionGrainBrushOccupancyPipelineLayout, engine.selectionTexturizedGrainShaderModule, "shapeVertexMain", "shapeOccupancyCoverageFragmentMain");
  const warmSelectionPipelines = async (): Promise<void> => {
    if (selectionPipelineByBase.size === selectionVariants.length) return;
    const chunkSize = 4;
    for (let index = 0; index < selectionVariants.length; index += chunkSize) {
      const pending = selectionVariants
        .slice(index, index + chunkSize)
        .filter((variant) => !selectionPipelineByBase.has(variant.base));
      await Promise.all(
        pending.map(registerSelectionPipeline),
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  };
  if (!options.deferSelectionPipelines) {
    await warmSelectionPipelines();
  }

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
  const lightGlazeFinalRasterStackCompositeMipPipeline = engine.device.createRenderPipeline({
    label: `Light Glaze final raster stack composited mip 1 ${format}`,
    layout: lightGlazeCompositeMipPipelineLayout,
    vertex: {
      module: engine.lightGlazeCompositeMipShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.lightGlazeCompositeMipShaderModule,
      entryPoint: "finalStackFragmentMain",
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
  const layerBlendFoldPipelineLayout = engine.device.createPipelineLayout({
    label: `Advanced layer blend fold pipeline layout ${format}`,
    bindGroupLayouts: [engine.layerBlendFoldBindGroupLayout],
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
  const activeClippingGroupMipPipeline = engine.device.createRenderPipeline({
    label: `Active clipping group composited mip 1 ${format}`,
    layout: paintStackCompositeMipPipelineLayout,
    vertex: {
      module: engine.paintStackCompositeMipShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.paintStackCompositeMipShaderModule,
      entryPoint: "activeGroupFragmentMain",
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
  const layerSourceAtopPipeline = engine.device.createRenderPipeline({
    label: `Clipping child source-atop fold ${format}`,
    layout: layerCompositePipelineLayout,
    vertex: { module: engine.layerCompositeShaderModule, entryPoint: "vertexMain" },
    fragment: {
      module: engine.layerCompositeShaderModule,
      entryPoint: "fragmentMain",
      targets: [{
        format,
        blend: {
          color: {
            operation: "add",
            srcFactor: "dst-alpha",
            dstFactor: "one-minus-src-alpha",
          },
          alpha: { operation: "add", srcFactor: "zero", dstFactor: "one" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const layerColdTileCompositePipeline = engine.device.createRenderPipeline({
    label: `Direct cold tile source-over fold ${format}`,
    layout: layerColdTileCompositePipelineLayout,
    vertex: {
      module: engine.layerColdTileCompositeShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.layerColdTileCompositeShaderModule,
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
  const layerColdTileSourceAtopPipeline = engine.device.createRenderPipeline({
    label: `Direct cold tile source-atop fold ${format}`,
    layout: layerColdTileCompositePipelineLayout,
    vertex: {
      module: engine.layerColdTileCompositeShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.layerColdTileCompositeShaderModule,
      entryPoint: "fragmentMain",
      targets: [{
        format,
        blend: {
          color: {
            operation: "add",
            srcFactor: "dst-alpha",
            dstFactor: "one-minus-src-alpha",
          },
          alpha: { operation: "add", srcFactor: "zero", dstFactor: "one" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const layerBlendFoldPipeline = engine.device.createRenderPipeline({
    label: `Advanced document-space layer blend fold ${format}`,
    layout: layerBlendFoldPipelineLayout,
    vertex: { module: engine.layerBlendFoldShaderModule, entryPoint: "vertexMain" },
    fragment: {
      module: engine.layerBlendFoldShaderModule,
      entryPoint: "fragmentMain",
      // The shader returns the complete premultiplied result. Fixed-function
      // blending must stay disabled because the destination was sampled from
      // the separate canonical texture.
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
      return {
        selectionPipelineByBase,
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
        lightGlazeFinalRasterStackCompositeMipPipeline,
        lightGlazeCompositePipeline,
        lightGlazeCommitTilePipeline,
        paintMipDownsamplePipeline,
        paintStackCompositeMipPipeline,
        activeClippingGroupMipPipeline,
        layerCompositePipeline,
        layerSourceAtopPipeline,
        layerColdTileCompositePipeline,
        layerColdTileSourceAtopPipeline,
        layerBlendFoldPipeline,
        warmSelectionPipelines,
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
    if (!options.deferBlendRenderer) {
      blendRenderer = await runGpuAllocationTransaction(
        engine.device,
        `Renderer Blend formato ${format}`,
        async (transaction) => {
          const candidate = await DryBlendRenderer.create({
            device: engine.device,
            documentWidth: DOCUMENT_WIDTH,
            documentHeight: DOCUMENT_HEIGHT,
            layerFormat: format,
            layerView: activeHot.view,
            layerSamplingView: activeHot.samplingView,
            shapeMaskView: engine.shapeMaskView,
            shapeMaskSampler: engine.shapeMaskSampler,
            grainTextureView: engine.grainTextureView,
            grainTextureWidth: engine.grainTextureWidth,
            grainTextureMipLevelCount: engine.grainTextureMipLevelCount,
            grainSamplers: engine.grainSamplers,
          });
          transaction.deferRollback(() => candidate.destroy());
          return candidate;
        },
      );
    }
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
    || (!blendRenderer && !options.deferBlendRenderer)
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
  engine.blendRendererWarmup = options.deferBlendRenderer
    ? async (): Promise<void> => {
      if (engine.blendRenderer) return;
      const candidate = await runGpuAllocationTransaction(
        engine.device,
        `Renderer Blend differito formato ${engine.layerFormat}`,
        async (transaction) => {
          const renderer = await DryBlendRenderer.create({
            device: engine.device,
            documentWidth: DOCUMENT_WIDTH,
            documentHeight: DOCUMENT_HEIGHT,
            layerFormat: engine.layerFormat,
            layerView: engine.layerView,
            layerSamplingView: engine.layerSamplingView,
            shapeMaskView: engine.shapeMaskView,
            shapeMaskSampler: engine.shapeMaskSampler,
            grainTextureView: engine.grainTextureView,
            grainTextureWidth: engine.grainTextureWidth,
            grainTextureMipLevelCount: engine.grainTextureMipLevelCount,
            grainSamplers: engine.grainSamplers,
          });
          transaction.deferRollback(() => renderer.destroy());
          return renderer;
        },
      );
      if (engine.blendRenderer) {
        candidate.destroy();
        return;
      }
      // A deferred compile can overlap a layer activation. DryBlendRenderer
      // captured the views that were current when create() started; retarget to
      // the authoritative views again at publication so its very first stroke
      // cannot sample or write the outgoing layer.
      candidate.retarget(engine.layerView, engine.layerSamplingView);
      candidate.setShapeMaskView(engine.shapeMaskView);
      candidate.setGrainTextureView(
        engine.grainTextureView,
        engine.grainTextureWidth,
        engine.grainTextureMipLevelCount,
      );
      engine.blendRenderer = candidate;
      engine.blendRendererWarmup = null;
      engine.publishStats();
    }
    : null;
  engine.activeLayerDisplayPyramid = nextDisplayPyramid;
  engine.transparentLayerTexture = nextTransparentTexture;
  engine.transparentLayerView = nextTransparentView;
  engine.mergedBelow = null;
  engine.mergedAbove = null;
  destroyActiveClippingGroupResources(engine, engine.activeClippingGroup);
  engine.activeClippingGroup = null;
  engine.mixedSceneRasterSegments = [];
  engine.mixedSceneCompositionSegments = engine.mixedSceneStack?.visibleSemanticCount
    ? engine.mixedSceneStack.compositionSegments(
      engine.layerStack.active.id,
      engine.layerStack.clippingUnit(engine.layerStack.active.id).map((record) => record.id),
    )
    : [];
  engine.normalPipeline = normalPipeline;
  engine.selectionPipelineByBase = selectionPipelineByBase;
  engine.selectionPipelinesReady = !options.deferSelectionPipelines;
  engine.selectionPipelineWarmup = options.deferSelectionPipelines
    ? warmSelectionPipelines
    : null;
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
  engine.lightGlazeFinalRasterStackCompositeMipPipeline =
    lightGlazeFinalRasterStackCompositeMipPipeline;
  engine.lightGlazeCompositePipeline = lightGlazeCompositePipeline;
  engine.lightGlazeCommitTilePipeline = lightGlazeCommitTilePipeline;
  engine.paintMipDownsamplePipeline = paintMipDownsamplePipeline;
  engine.paintStackCompositeMipPipeline = paintStackCompositeMipPipeline;
  engine.activeClippingGroupMipPipeline = activeClippingGroupMipPipeline;
  engine.layerCompositePipeline = layerCompositePipeline;
  engine.layerSourceAtopPipeline = layerSourceAtopPipeline;
  engine.layerColdTileCompositePipeline = layerColdTileCompositePipeline;
  engine.layerColdTileSourceAtopPipeline = layerColdTileSourceAtopPipeline;
  engine.layerBlendFoldPipeline = layerBlendFoldPipeline;
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
  releaseLayerBlendTilePresentationResources(engine);
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
  if (layerBlendTilePresentationRequired(engine)) {
    await ensureLayerBlendTilePresentationResources(engine);
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
      + "operazione rifiutata: il documento RGBA16F non ammette fallback di formato.",
    );
  }

  if (completionPolicy === "await-immediately") {
    await engine.waitForIdle({
      allowFrozenDerivedPresentation: caller !== "public",
    });
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
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
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
      fullDocumentPixels: DOCUMENT_WIDTH * DOCUMENT_HEIGHT,
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
          : `[EffectsWorkbench] retarget ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT} completato`,
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

function packLayerCompositeUniforms(
  upload: ArrayBuffer,
  byteOffset: number,
  destinationOrigin: { x: number; y: number },
  destinationScale: number,
  sourceOrigin: { x: number; y: number },
  sourceScale: number,
  sourceWidth: number,
  sourceHeight: number,
  opacity: number,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
): void {
  const f32 = new Float32Array(upload, byteOffset, LAYER_COMPOSITE_UNIFORM_BYTES / 4);
  const u32 = new Uint32Array(upload, byteOffset, LAYER_COMPOSITE_UNIFORM_BYTES / 4);
  f32[0] = destinationOrigin.x;
  f32[1] = destinationOrigin.y;
  f32[2] = destinationScale;
  f32[3] = opacity;
  f32[4] = sourceOrigin.x;
  f32[5] = sourceOrigin.y;
  f32[6] = sourceScale;
  u32[8] = sourceWidth;
  u32[9] = sourceHeight;
  u32[10] = LAYER_BLEND_MODE_CODES[blendMode];
  u32[11] = operator === "source-atop" ? 1 : 0;
}

function writeLayerCompositeUniforms(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  sourceOrigin: { x: number; y: number },
  sourceScale: number,
  sourceWidth: number,
  sourceHeight: number,
  opacity: number,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
): void {
  const upload = new ArrayBuffer(LAYER_COMPOSITE_UNIFORM_BYTES);
  packLayerCompositeUniforms(
    upload,
    0,
    destination.bounds,
    destination.resolutionScale,
    sourceOrigin,
    sourceScale,
    sourceWidth,
    sourceHeight,
    opacity,
    blendMode,
    operator,
  );
  engine.device.queue.writeBuffer(engine.layerCompositeUniformBuffer, 0, upload);
}

type LayerFoldCompositeOperator = "source-over" | "source-atop";

async function ensureLayerBlendFoldScratch(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  label: string,
): Promise<void> {
  if (
    destination.blendFoldBackdropScratchTexture
    && destination.blendFoldBackdropScratchView
    && destination.blendFoldScratchTexture
    && destination.blendFoldScratchView
    && destination.blendFoldUniformBuffer
    && destination.blendFoldUniformStride > 0
  ) {
    return;
  }
  releaseLayerBlendFoldScratch(destination);
  const tileWidth = Math.min(LAYER_BLEND_FOLD_TILE_EXTENT, destination.textureWidth);
  const tileHeight = Math.min(LAYER_BLEND_FOLD_TILE_EXTENT, destination.textureHeight);
  const uniformAlignment = engine.device.limits.minUniformBufferOffsetAlignment;
  const uniformStride = Math.ceil(
    LAYER_BLEND_FOLD_UNIFORM_BYTES / uniformAlignment,
  ) * uniformAlignment;
  const tileCapacity = Math.ceil(destination.textureWidth / tileWidth)
    * Math.ceil(destination.textureHeight / tileHeight);
  const scratch = await runGpuAllocationTransaction(
    engine.device,
    `${label} · scratch fusione tile ${tileWidth}×${tileHeight}`,
    (transaction) => {
      const backdropTexture = engine.device.createTexture({
        label:
          `Advanced layer blend backdrop tile ${tileWidth}×${tileHeight} `
          + engine.layerFormat,
        size: {
          width: tileWidth,
          height: tileHeight,
          depthOrArrayLayers: 1,
        },
        format: engine.layerFormat,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      transaction.deferRollback(() => backdropTexture.destroy());
      const outputTexture = engine.device.createTexture({
        label:
          `Advanced layer blend output tile ${tileWidth}×${tileHeight} `
          + engine.layerFormat,
        size: { width: tileWidth, height: tileHeight, depthOrArrayLayers: 1 },
        format: engine.layerFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      transaction.deferRollback(() => outputTexture.destroy());
      const uniformBuffer = engine.device.createBuffer({
        label: `Advanced layer blend tile uniforms ${tileCapacity}×${uniformStride} B`,
        size: tileCapacity * uniformStride,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      transaction.deferRollback(() => uniformBuffer.destroy());
      return {
        backdropTexture,
        backdropView: backdropTexture.createView({
          label: "Advanced layer blend backdrop tile view",
        }),
        outputTexture,
        outputView: outputTexture.createView({
          label: "Advanced layer blend output tile view",
        }),
        uniformBuffer,
      };
    },
  );
  destination.blendFoldBackdropScratchTexture = scratch.backdropTexture;
  destination.blendFoldBackdropScratchView = scratch.backdropView;
  destination.blendFoldScratchTexture = scratch.outputTexture;
  destination.blendFoldScratchView = scratch.outputView;
  destination.blendFoldUniformBuffer = scratch.uniformBuffer;
  destination.blendFoldUniformStride = uniformStride;
  destination.blendFoldTileWidth = tileWidth;
  destination.blendFoldTileHeight = tileHeight;
}

export function releaseLayerBlendFoldScratch(destination: MergedSurfaceResources): void {
  destination.blendFoldBackdropScratchTexture?.destroy();
  destination.blendFoldScratchTexture?.destroy();
  destination.blendFoldUniformBuffer?.destroy();
  destination.blendFoldBackdropScratchTexture = null;
  destination.blendFoldBackdropScratchView = null;
  destination.blendFoldScratchTexture = null;
  destination.blendFoldScratchView = null;
  destination.blendFoldUniformBuffer = null;
  destination.blendFoldUniformStride = 0;
  destination.blendFoldTileWidth = 0;
  destination.blendFoldTileHeight = 0;
}

type AuthoritativeColdTileCompositeSource = {
  recordId: number;
  gpu: LayerGpuResources;
  cold: LayerColdStorageResources | null;
  compressed: LayerCompressedColdStorageResources | null;
  nonTransparentBounds: DirtyRect;
};

function authoritativeColdTileCompositeSource(
  engine: BrushEngine,
  record: LayerRecord,
  blendMode: LayerBlendMode,
): AuthoritativeColdTileCompositeSource | null {
  if (!engine.layerColdTileCompositeEnabled || blendMode !== "normal") {
    return null;
  }
  const gpu = engine.requireLayerGpu(record.id);
  if (gpu.hot || (gpu.bake && gpu.bakeValid)) {
    return null;
  }
  const cold = gpu.cold;
  const compressed = gpu.compressed;
  if (Boolean(cold) === Boolean(compressed)) {
    return null;
  }
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  if (requirements.needsStrokeRenderer) {
    return null;
  }
  const format = cold?.format ?? compressed?.format;
  if (format !== engine.layerFormat) {
    throw new Error(
      `Fold tile livello ${record.id}: formato ${format ?? "assente"} incompatibile con `
      + `${engine.layerFormat}.`,
    );
  }
  if (compressed) {
    const bytesPerPixel = compressed.format === "rgba16float" ? 8 : 4;
    const tileBytes = LAYER_STORAGE_TILE_WIDTH * LAYER_STORAGE_TILE_HEIGHT * bytesPerPixel;
    const chunksFitBoundedScratch = compressed.tileIndices.length > 0
      && compressed.chunks.length > 0
      && compressed.chunks.every((chunk) => (
        chunk.rawBytes > 0
        && chunk.rawBytes % tileBytes === 0
        && chunk.rawBytes <= LAYER_COLD_TILE_COMPOSITE_BATCH_TILES * tileBytes
      ));
    if (!chunksFitBoundedScratch) {
      return null;
    }
  }
  return {
    recordId: record.id,
    gpu,
    cold,
    compressed,
    nonTransparentBounds: normalizeLayerRect(record.contentBounds) ?? {
      x: 0,
      y: 0,
      width: DOCUMENT_WIDTH,
      height: DOCUMENT_HEIGHT,
    },
  };
}

function coldTileCompositeSourceIsCurrent(
  source: AuthoritativeColdTileCompositeSource,
): boolean {
  return source.gpu.hot === null
    && source.gpu.cold === source.cold
    && source.gpu.compressed === source.compressed;
}

function writeColdTileCompositeUniforms(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  opacity: number,
): void {
  if (
    destination.resolutionScale !== 1
    || destination.textureWidth !== destination.bounds.width
    || destination.textureHeight !== destination.bounds.height
    || !Number.isInteger(destination.bounds.x)
    || !Number.isInteger(destination.bounds.y)
  ) {
    throw new Error("Il fold cold tile richiede una superficie mip0 1:1 intera.");
  }
  const upload = new ArrayBuffer(32);
  const i32 = new Int32Array(upload);
  const u32 = new Uint32Array(upload);
  const f32 = new Float32Array(upload);
  i32[0] = destination.bounds.x;
  i32[1] = destination.bounds.y;
  u32[2] = destination.textureWidth;
  u32[3] = destination.textureHeight;
  f32[4] = Math.min(1, Math.max(0, opacity));
  engine.device.queue.writeBuffer(engine.layerColdTileCompositeUniformBuffer, 0, upload);
}

async function foldAuthoritativeColdTilesIntoMergedSurface(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  source: AuthoritativeColdTileCompositeSource,
  opacity: number,
  operator: LayerFoldCompositeOperator,
  clearDestination: boolean,
  documentRect: DirtyRect,
  label: string,
): Promise<void> {
  writeColdTileCompositeUniforms(engine, destination, opacity);
  if (!coldTileCompositeSourceIsCurrent(source)) {
    throw new Error(`Fold tile livello ${source.recordId}: sorgente diventata stale.`);
  }

  let submitted = false;
  let completed = false;
  let submissionCount = 0;
  const submitBatch = (
    sourceView: GPUTextureView,
    tileIndices: readonly number[],
    clear: boolean,
    batchLabel: string,
  ): void => {
    if (tileIndices.length < 1 || tileIndices.length > LAYER_STORAGE_TILE_COUNT) {
      throw new RangeError(`${batchLabel}: conteggio tile ${tileIndices.length} non valido.`);
    }
    engine.device.queue.writeBuffer(
      engine.layerColdTileCompositeIndicesBuffer,
      0,
      new Uint32Array(tileIndices),
    );
    const bindGroup = engine.device.createBindGroup({
      label: batchLabel,
      layout: engine.layerColdTileCompositeBindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: { buffer: engine.layerColdTileCompositeIndicesBuffer } },
        { binding: 2, resource: { buffer: engine.layerColdTileCompositeUniformBuffer } },
      ],
    });
    const encoder = engine.device.createCommandEncoder({ label: batchLabel });
    const pass = encoder.beginRenderPass({
      label: batchLabel,
      colorAttachments: [{
        view: destination.mipViews[0],
        loadOp: clear ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(
      operator === "source-atop"
        ? engine.layerColdTileSourceAtopPipeline
        : engine.layerColdTileCompositePipeline,
    );
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, tileIndices.length, 0, 0);
    pass.end();
    engine.device.queue.submit([encoder.finish()]);
    submitted = true;
    submissionCount += 1;
  };

  let scratchTexture: GPUTexture | null = null;
  let scratchBytes = 0;
  let foldedTileCount = 0;
  try {
    if (source.cold) {
      const cold = source.cold;
      submitBatch(
        cold.texture.createView({
          label: `${label} · cold array view`,
          dimension: "2d-array",
          baseArrayLayer: 0,
          arrayLayerCount: cold.tileIndices.length,
        }),
        cold.tileIndices,
        clearDestination,
        label,
      );
      foldedTileCount = cold.tileIndices.length;
    } else {
      const compressed = source.compressed!;
      const bytesPerPixel = compressed.format === "rgba16float" ? 8 : 4;
      const tileBytes = LAYER_STORAGE_TILE_WIDTH * LAYER_STORAGE_TILE_HEIGHT * bytesPerPixel;
      const chunkTileCounts = compressed.chunks.map((chunk, index) => {
        if (
          chunk.rawBytes <= 0
          || chunk.rawBytes % tileBytes !== 0
          || chunk.rawBytes / tileBytes > LAYER_STORAGE_TILE_COUNT
        ) {
          throw new Error(`Fold tile livello ${source.recordId}: chunk ${index} non valido.`);
        }
        return chunk.rawBytes / tileBytes;
      });
      const scratchLayerCount = Math.min(
        compressed.tileIndices.length,
        Math.max(LAYER_COLD_TILE_COMPOSITE_BATCH_TILES, ...chunkTileCounts),
      );
      scratchBytes = scratchLayerCount * tileBytes;
      scratchTexture = engine.device.createTexture({
        label: `Scratch direct cold tile composite livello ${source.recordId}`,
        size: {
          width: LAYER_STORAGE_TILE_WIDTH,
          height: LAYER_STORAGE_TILE_HEIGHT,
          depthOrArrayLayers: scratchLayerCount,
        },
        format: compressed.format,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      engine.layerColdTileCompositeScratchActiveBytes += scratchBytes;
      engine.layerColdTileCompositeScratchPeakBytes = Math.max(
        engine.layerColdTileCompositeScratchPeakBytes,
        engine.layerColdTileCompositeScratchActiveBytes,
      );
      const scratchView = scratchTexture.createView({
        label: `${label} · scratch array view`,
        dimension: "2d-array",
        baseArrayLayer: 0,
        arrayLayerCount: scratchLayerCount,
      });
      let chunkIndex = 0;
      let firstTile = 0;
      let restoredBytes = 0;
      let restoredHash = 0x811c9dc5;
      let clear = clearDestination;
      while (chunkIndex < compressed.chunks.length) {
        const batchIndices: number[] = [];
        const uploads: Array<{ bytes: Uint8Array; arrayLayer: number; tileCount: number }> = [];
        while (chunkIndex < compressed.chunks.length) {
          const chunk = compressed.chunks[chunkIndex];
          const chunkTileCount = chunkTileCounts[chunkIndex];
          if (batchIndices.length > 0 && batchIndices.length + chunkTileCount > scratchLayerCount) {
            break;
          }
          const restored = await decompressLayerColdChunk(engine, chunk);
          if (
            !coldTileCompositeSourceIsCurrent(source)
            || restored.byteLength !== chunk.rawBytes
            || firstTile + chunkTileCount > compressed.tileIndices.length
          ) {
            throw new Error(`Fold tile livello ${source.recordId}: chunk diventato stale.`);
          }
          uploads.push({
            bytes: restored,
            arrayLayer: batchIndices.length,
            tileCount: chunkTileCount,
          });
          batchIndices.push(
            ...compressed.tileIndices.slice(firstTile, firstTile + chunkTileCount),
          );
          firstTile += chunkTileCount;
          restoredBytes += restored.byteLength;
          restoredHash = combineCompressionHashes(
            restoredHash,
            chunk.sourceHash,
            restored.byteLength,
          );
          chunkIndex += 1;
        }
        for (const upload of uploads) {
          engine.device.queue.writeTexture(
            { texture: scratchTexture, origin: { x: 0, y: 0, z: upload.arrayLayer } },
            upload.bytes,
            {
              bytesPerRow: LAYER_STORAGE_TILE_WIDTH * bytesPerPixel,
              rowsPerImage: LAYER_STORAGE_TILE_HEIGHT,
            },
            {
              width: LAYER_STORAGE_TILE_WIDTH,
              height: LAYER_STORAGE_TILE_HEIGHT,
              depthOrArrayLayers: upload.tileCount,
            },
          );
        }
        submitBatch(
          scratchView,
          batchIndices,
          clear,
          `${label} · batch ${submissionCount + 1}`,
        );
        clear = false;
      }
      if (
        !coldTileCompositeSourceIsCurrent(source)
        || firstTile !== compressed.tileIndices.length
        || restoredBytes !== compressed.rawBytes
        || restoredHash !== compressed.sourceHash
      ) {
        throw new Error(`Fold tile livello ${source.recordId}: integrità aggregata non valida.`);
      }
      foldedTileCount = firstTile;
    }
    await engine.waitForGpuCapped(label);
    completed = true;
    if (!coldTileCompositeSourceIsCurrent(source)) {
      throw new Error(`Fold tile livello ${source.recordId}: autorità cambiata dopo il submit.`);
    }
    destination.foldedPixels += documentRect.width * documentRect.height;
    engine.layerColdTileCompositeFoldCount += 1;
    engine.layerColdTileCompositeResidentFoldCount += source.cold ? 1 : 0;
    engine.layerColdTileCompositeCompressedFoldCount += source.compressed ? 1 : 0;
    engine.layerColdTileCompositeTileCount += foldedTileCount;
    engine.layerColdTileCompositeSubmissionCount += submissionCount;
    engine.layerColdTileCompositeAvoidedHydrationBytes += DOCUMENT_WIDTH * DOCUMENT_HEIGHT
      * (engine.layerFormat === "rgba16float" ? 8 : 4);
  } finally {
    if (submitted && !completed) {
      try {
        await engine.waitForGpuCapped(`${label} · drain rollback`);
      } catch {
        // Device-loss/timeout already makes the render path unusable. Resource
        // destruction below is still the only safe local cleanup available.
      }
    }
    scratchTexture?.destroy();
    engine.layerColdTileCompositeScratchActiveBytes = Math.max(
      0,
      engine.layerColdTileCompositeScratchActiveBytes - scratchBytes,
    );
  }
}

async function tryFoldAuthoritativeColdTilesIntoMergedSurface(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  record: LayerRecord,
  opacity: number,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
  clearDestination: boolean,
  label: string,
): Promise<boolean | null> {
  if (destination.resolutionScale !== 1) {
    return null;
  }
  const source = authoritativeColdTileCompositeSource(engine, record, blendMode);
  if (!source) {
    return null;
  }
  const rect = intersectMergedSurfaceRects(
    source.nonTransparentBounds,
    destination.bounds,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!rect) {
    return false;
  }
  await foldAuthoritativeColdTilesIntoMergedSurface(
    engine,
    destination,
    source,
    opacity,
    operator,
    clearDestination,
    rect,
    label,
  );
  return true;
}

export async function foldViewIntoMergedSurface(
  engine: BrushEngine,
  destination: MergedSurfaceResources,
  sourceView: GPUTextureView,
  sourceOrigin: { x: number; y: number },
  sourceScale: number,
  sourceWidth: number,
  sourceHeight: number,
  opacity: number,
  documentRect: DirtyRect,
  blendMode: LayerBlendMode,
  operator: LayerFoldCompositeOperator,
  clearDestination: boolean,
  label: string,
): Promise<void> {
  const clipped = intersectMergedSurfaceRects(
    documentRect,
    destination.bounds,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!clipped) {
    return;
  }
  const physicalRect = mergedSurfacePhysicalRect(
    clipped,
    destination.bounds,
    destination.resolutionScale,
  );
  if (blendMode === "normal") {
    // Preserve the original single-pass fixed-function path exactly. It is
    // faster, associative, and does not require a backdrop texture or scratch.
    writeLayerCompositeUniforms(
      engine,
      destination,
      sourceOrigin,
      sourceScale,
      sourceWidth,
      sourceHeight,
      opacity,
      blendMode,
      operator,
    );
    const encoder = engine.device.createCommandEncoder({ label });
    const bindGroup = engine.device.createBindGroup({
      label,
      layout: engine.layerCompositeBindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: { buffer: engine.layerCompositeUniformBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: destination.mipViews[0],
        loadOp: clearDestination ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(
      operator === "source-atop"
        ? engine.layerSourceAtopPipeline
        : engine.layerCompositePipeline,
    );
    pass.setBindGroup(0, bindGroup);
    pass.setScissorRect(
      physicalRect.x,
      physicalRect.y,
      physicalRect.width,
      physicalRect.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
    engine.device.queue.submit([encoder.finish()]);
  } else {
    await ensureLayerBlendFoldScratch(engine, destination, label);
    const backdropScratchTexture = destination.blendFoldBackdropScratchTexture!;
    const backdropScratchView = destination.blendFoldBackdropScratchView!;
    const outputScratchTexture = destination.blendFoldScratchTexture!;
    const outputScratchView = destination.blendFoldScratchView!;
    const uniformBuffer = destination.blendFoldUniformBuffer!;
    const uniformStride = destination.blendFoldUniformStride;
    const tiles: DirtyRect[] = [];
    const maximumY = physicalRect.y + physicalRect.height;
    const maximumX = physicalRect.x + physicalRect.width;
    for (
      let y = physicalRect.y;
      y < maximumY;
      y += destination.blendFoldTileHeight
    ) {
      for (
        let x = physicalRect.x;
        x < maximumX;
        x += destination.blendFoldTileWidth
      ) {
        tiles.push({
          x,
          y,
          width: Math.min(destination.blendFoldTileWidth, maximumX - x),
          height: Math.min(destination.blendFoldTileHeight, maximumY - y),
        });
      }
    }
    const uniformUpload = new ArrayBuffer(tiles.length * uniformStride);
    tiles.forEach((tile, index) => {
      packLayerCompositeUniforms(
        uniformUpload,
        index * uniformStride,
        {
          x: destination.bounds.x + tile.x / destination.resolutionScale,
          y: destination.bounds.y + tile.y / destination.resolutionScale,
        },
        destination.resolutionScale,
        sourceOrigin,
        sourceScale,
        sourceWidth,
        sourceHeight,
        opacity,
        blendMode,
        operator,
      );
    });
    engine.device.queue.writeBuffer(uniformBuffer, 0, uniformUpload);
    const bindGroup = engine.device.createBindGroup({
      label: `${label} · advanced tile backdrop/source`,
      layout: engine.layerBlendFoldBindGroupLayout,
      entries: [
        { binding: 0, resource: backdropScratchView },
        { binding: 1, resource: sourceView },
        {
          binding: 2,
          resource: {
            buffer: uniformBuffer,
            offset: 0,
            size: LAYER_BLEND_FOLD_UNIFORM_BYTES,
          },
        },
      ],
    });
    const encoder = engine.device.createCommandEncoder({ label });
    if (clearDestination) {
      // The advanced shader samples the canonical destination. Match the old
      // first-fold clear semantics before exposing it as the backdrop.
      const clearPass = encoder.beginRenderPass({
        label: `${label} · clear canonical backdrop`,
        colorAttachments: [{
          view: destination.mipViews[0],
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      clearPass.end();
    }
    tiles.forEach((tile, tileIndex) => {
      encoder.copyTextureToTexture(
        {
          texture: destination.texture,
          mipLevel: 0,
          origin: { x: tile.x, y: tile.y, z: 0 },
        },
        {
          texture: backdropScratchTexture,
          origin: { x: 0, y: 0, z: 0 },
        },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      );
      const pass = encoder.beginRenderPass({
        label: `${label} · advanced tile ${tileIndex + 1}/${tiles.length}`,
        colorAttachments: [{
          view: outputScratchView,
          // Initialize the reusable attachment once; every copied pixel is
          // then overwritten by the fullscreen triangle.
          loadOp: tileIndex === 0 ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(engine.layerBlendFoldPipeline);
      pass.setBindGroup(0, bindGroup, [tileIndex * uniformStride]);
      pass.setScissorRect(0, 0, tile.width, tile.height);
      pass.draw(3, 1, 0, 0);
      pass.end();
      encoder.copyTextureToTexture(
        { texture: outputScratchTexture, origin: { x: 0, y: 0, z: 0 } },
        {
          texture: destination.texture,
          mipLevel: 0,
          origin: { x: tile.x, y: tile.y, z: 0 },
        },
        { width: tile.width, height: tile.height, depthOrArrayLayers: 1 },
      );
    });
    engine.device.queue.submit([encoder.finish()]);
  }
  await engine.waitForGpuCapped(label);
  destination.foldedPixels += physicalRect.width * physicalRect.height;
}

function recordHasLiveContent(engine: BrushEngine, record: LayerRecord): boolean {
  return record.id === engine.layerStack.active.id
    ? engine.layerHasContent
    : record.hasContent;
}

function recordRawBounds(engine: BrushEngine, record: LayerRecord): DirtyRect | null {
  return normalizeLayerRect(
    record.id === engine.layerStack.active.id
      ? engine.layerContentBounds
      : record.contentBounds,
  );
}

async function finalizeClippingAuxiliarySurface(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  maintainMips: boolean,
  label: string,
): Promise<MergedSurfaceResources> {
  releaseLayerBlendFoldScratch(surface);
  if (!maintainMips) {
    return surface;
  }
  const targetMip = requiredMergedSurfaceMipLevel(engine, surface);
  if (targetMip <= 0) {
    return surface;
  }
  const encoder = engine.device.createCommandEncoder({ label: `${label} mip` });
  encodeMergedSurfacePyramid(engine, encoder, surface, targetMip);
  engine.device.queue.submit([encoder.finish()]);
  await engine.waitForGpuCapped(`${label} mip`);
  return surface;
}

async function buildClippingOverlaySurface(
  engine: BrushEngine,
  records: readonly LayerRecord[],
  caller: EffectsRetargetCaller,
  requestedBounds: DirtyRect | null,
  maintainMips: boolean,
  label: string,
): Promise<MergedSurfaceResources | null> {
  const visible = records.filter(
    (record) => record.visible
      && record.opacity > 0
      && recordHasLiveContent(engine, record),
  );
  if (visible.length === 0) {
    return null;
  }
  const visualBounds = unionMergedSurfaceRects(
    visible.map((record) => layerCompositeVisualBounds(engine, record)),
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  const bounded = requestedBounds
    ? visualBounds && intersectMergedSurfaceRects(
      visualBounds,
      requestedBounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    )
    : visualBounds;
  if (!bounded) {
    return null;
  }
  const surface = allocateMergedSurface(
    engine,
    engine.layerFormat,
    "above",
    visible.length,
    alignedMergedSurfaceBounds(bounded, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT),
    1,
  );
  let first = true;
  try {
    for (const record of visible) {
      const directTileFold = await tryFoldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        record,
        record.opacity,
        "normal",
        "source-over",
        first,
        `${label} · layer ${record.id} direct cold tiles`,
      );
      if (directTileFold !== null) {
        first = first && !directTileFold;
        continue;
      }
      const source = await materializeLayerCompositeSource(engine, record, caller);
      try {
        const rect = intersectMergedSurfaceRects(
          source.nonTransparentBounds,
          surface.bounds,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        if (!rect) {
          continue;
        }
        await foldViewIntoMergedSurface(
          engine,
          surface,
          source.view,
          { x: 0, y: 0 },
          1,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
          record.opacity,
          rect,
          "normal",
          "source-over",
          first,
          `${label} · layer ${record.id} source-over`,
        );
        surface.analyticBakePixels += source.analyticBakePixels;
        first = false;
      } finally {
        engine.destroyLayerBake(source.transientBake);
        destroyTransientLayerHydration(engine, source.transientHydration);
      }
    }
    if (first) {
      engine.destroyMergedSurface(surface);
      return null;
    }
    return await finalizeClippingAuxiliarySurface(
      engine,
      surface,
      maintainMips,
      label,
    );
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  }
}

type ActiveClippingSuffixBuild = {
  suffix: MergedSurfaceResources | null;
  suffixSteps: ActiveClippingSuffixStepResources[];
};

/**
 * Materialize one clipping child without baking its layer opacity. The live
 * document-tile compositor owns both opacity and blend mode, so it can apply
 * every source-atop operation against the result of the preceding child.
 * These operands are mip-0-only: they are never presented directly and are
 * sampled at document resolution exclusively by the exact tile path.
 */
async function buildClippingSuffixStepSurface(
  engine: BrushEngine,
  record: LayerRecord,
  caller: EffectsRetargetCaller,
  requestedBounds: DirtyRect,
  label: string,
): Promise<MergedSurfaceResources | null> {
  const directSource = authoritativeColdTileCompositeSource(engine, record, "normal");
  const source = directSource
    ? null
    : await materializeLayerCompositeSource(engine, record, caller);
  let surface: MergedSurfaceResources | null = null;
  try {
    const bounded = intersectMergedSurfaceRects(
      directSource?.nonTransparentBounds ?? source!.nonTransparentBounds,
      requestedBounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    if (!bounded) {
      return null;
    }
    surface = await runGpuAllocationTransaction(
      engine.device,
      `${label} · allocazione mip0`,
      (transaction) => {
        const candidate = allocateMergedSurface(
          engine,
          engine.layerFormat,
          "above",
          1,
          alignedMergedSurfaceBounds(bounded, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT),
          1,
          false,
        );
        transaction.deferRollback(() => engine.destroyMergedSurface(candidate));
        return candidate;
      },
    );
    if (directSource) {
      await foldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        directSource,
        1,
        "source-over",
        true,
        bounded,
        `${label} · direct cold tiles`,
      );
    } else {
      await foldViewIntoMergedSurface(
        engine,
        surface,
        source!.view,
        { x: 0, y: 0 },
        1,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
        1,
        bounded,
        "normal",
        "source-over",
        true,
        label,
      );
      surface.analyticBakePixels += source!.analyticBakePixels;
    }
    return await finalizeClippingAuxiliarySurface(engine, surface, false, label);
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  } finally {
    engine.destroyLayerBake(source?.transientBake);
    destroyTransientLayerHydration(engine, source?.transientHydration);
  }
}

async function buildActiveClippingSuffixResources(
  engine: BrushEngine,
  records: readonly LayerRecord[],
  caller: EffectsRetargetCaller,
  aggregateRequestedBounds: DirtyRect | null,
  stepRequestedBounds: DirtyRect | null,
  label: string,
): Promise<ActiveClippingSuffixBuild> {
  const visible = records.filter(
    (record) => record.visible
      && record.opacity > 0
      && recordHasLiveContent(engine, record),
  );
  if (visible.length === 0) {
    return { suffix: null, suffixSteps: [] };
  }

  // Keep the pre-existing single-surface path byte-for-byte for the common
  // all-Normal case. Per-child operands exist only when stack order needs an
  // advanced backdrop-dependent operation.
  if (visible.every((record) => record.blendMode === "normal")) {
    const suffix = await buildClippingOverlaySurface(
      engine,
      records,
      caller,
      aggregateRequestedBounds,
      true,
      label,
    );
    return { suffix, suffixSteps: [] };
  }

  // No clipped child can contribute without a parent matte. Avoid allocating
  // operand textures for an empty active parent.
  if (!stepRequestedBounds) {
    return { suffix: null, suffixSteps: [] };
  }

  const suffixSteps: ActiveClippingSuffixStepResources[] = [];
  try {
    for (const record of visible) {
      const surface = await buildClippingSuffixStepSurface(
        engine,
        record,
        caller,
        stepRequestedBounds,
        `${label} · operand child ${record.id}`,
      );
      if (!surface) {
        continue;
      }
      try {
        suffixSteps.push({
          layerId: record.id,
          blendMode: record.blendMode,
          opacity: record.opacity,
          surface,
          viewportSegment: createMixedSceneRasterSegmentResources(
            engine,
            `raster-run:${record.id}@clipping-step` as MixedSceneRasterRunKey,
            surface,
            record.opacity,
          ),
        });
      } catch (error) {
        engine.destroyMergedSurface(surface);
        throw error;
      }
    }
    return { suffix: null, suffixSteps };
  } catch (error) {
    suffixSteps.forEach((step) => {
      step.viewportSegment.uniformBuffer.destroy();
      engine.destroyMergedSurface(step.surface);
    });
    throw error;
  }
}

export async function buildClippingPrefixSurface(
  engine: BrushEngine,
  parent: LayerRecord,
  children: readonly LayerRecord[],
  caller: EffectsRetargetCaller,
  maintainMips: boolean,
  label: string,
): Promise<MergedSurfaceResources | null> {
  if (!recordHasLiveContent(engine, parent)) {
    return null;
  }
  const directParentSource = authoritativeColdTileCompositeSource(engine, parent, "normal");
  const parentSource = directParentSource
    ? null
    : await materializeLayerCompositeSource(engine, parent, caller);
  const parentBounds = normalizeLayerRect(
    directParentSource?.nonTransparentBounds ?? parentSource!.nonTransparentBounds,
  );
  if (!parentBounds) {
    engine.destroyLayerBake(parentSource?.transientBake);
    destroyTransientLayerHydration(engine, parentSource?.transientHydration);
    return null;
  }
  let surface: MergedSurfaceResources | null = null;
  try {
    surface = allocateMergedSurface(
      engine,
      engine.layerFormat,
      "below",
      1 + children.length,
      alignedMergedSurfaceBounds(parentBounds, DOCUMENT_WIDTH, 64, 64, DOCUMENT_HEIGHT),
      1,
      maintainMips,
    );
    if (directParentSource) {
      await foldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        directParentSource,
        1,
        "source-over",
        true,
        parentBounds,
        `${label} · parent ${parent.id} direct cold tiles`,
      );
    } else {
      await foldViewIntoMergedSurface(
        engine,
        surface,
        parentSource!.view,
        { x: 0, y: 0 },
        1,
        DOCUMENT_WIDTH,
        DOCUMENT_HEIGHT,
        1,
        parentBounds,
        "normal",
        "source-over",
        true,
        `${label} · styled parent ${parent.id}`,
      );
      surface.analyticBakePixels += parentSource!.analyticBakePixels;
    }

    for (const child of children) {
      if (!child.visible || child.opacity <= 0 || !recordHasLiveContent(engine, child)) {
        continue;
      }
      const directTileFold = await tryFoldAuthoritativeColdTilesIntoMergedSurface(
        engine,
        surface,
        child,
        child.opacity,
        child.blendMode,
        "source-atop",
        false,
        `${label} · child ${child.id} direct cold tiles`,
      );
      if (directTileFold !== null) {
        continue;
      }
      const source = await materializeLayerCompositeSource(engine, child, caller);
      try {
        const rect = intersectMergedSurfaceRects(
          source.nonTransparentBounds,
          surface.bounds,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
        );
        if (!rect) {
          continue;
        }
        await foldViewIntoMergedSurface(
          engine,
          surface,
          source.view,
          { x: 0, y: 0 },
          1,
          DOCUMENT_WIDTH,
          DOCUMENT_HEIGHT,
          child.opacity,
          rect,
          child.blendMode,
          "source-atop",
          false,
          `${label} · child ${child.id} source-atop`,
        );
        surface.analyticBakePixels += source.analyticBakePixels;
      } finally {
        engine.destroyLayerBake(source.transientBake);
        destroyTransientLayerHydration(engine, source.transientHydration);
      }
    }
    return await finalizeClippingAuxiliarySurface(
      engine,
      surface,
      maintainMips,
      label,
    );
  } catch (error) {
    engine.destroyMergedSurface(surface);
    throw error;
  } finally {
    engine.destroyLayerBake(parentSource?.transientBake);
    destroyTransientLayerHydration(engine, parentSource?.transientHydration);
  }
}

export async function buildActiveClippingGroupResources(
  engine: BrushEngine,
  caller: EffectsRetargetCaller,
): Promise<ActiveClippingGroupResources | null> {
  const unit = engine.layerStack.clippingUnit(engine.layerStack.active.id);
  if (unit.length <= 1) {
    return null;
  }
  const parent = unit[0];
  const activeIndex = unit.findIndex((record) => record.id === engine.layerStack.active.id);
  if (activeIndex < 0) {
    throw new Error("Raster attivo assente dalla propria unità di ritaglio.");
  }
  const parentOpacity = parent.visible ? Math.min(1, Math.max(0, parent.opacity)) : 0;
  const parentBounds = recordRawBounds(engine, parent);
  if (activeIndex === 0) {
    const { suffix, suffixSteps } = await buildActiveClippingSuffixResources(
      engine,
      unit.slice(1),
      caller,
      null,
      parentBounds,
      `Gruppo ritaglio live parent ${parent.id}`,
    );
    return {
      parentId: parent.id,
      activeLayerId: parent.id,
      mode: "active-parent",
      parentOpacity,
      prefix: null,
      suffix,
      suffixSteps,
    };
  }

  const prefix = await buildClippingPrefixSurface(
    engine,
    parent,
    unit.slice(1, activeIndex),
    caller,
    true,
    `Gruppo ritaglio live prefix ${parent.id}→${engine.layerStack.active.id}`,
  );
  try {
    const { suffix, suffixSteps } = await buildActiveClippingSuffixResources(
      engine,
      unit.slice(activeIndex + 1),
      caller,
      parentBounds,
      parentBounds,
      `Gruppo ritaglio live suffix ${engine.layerStack.active.id}`,
    );
    return {
      parentId: parent.id,
      activeLayerId: engine.layerStack.active.id,
      mode: "active-child",
      parentOpacity,
      prefix,
      suffix,
      suffixSteps,
    };
  } catch (error) {
    engine.destroyMergedSurface(prefix);
    throw error;
  }
}

export function destroyActiveClippingGroupResources(
  engine: BrushEngine,
  group: ActiveClippingGroupResources | null | undefined,
): void {
  if (!group) {
    return;
  }
  engine.destroyMergedSurface(group.prefix);
  engine.destroyMergedSurface(group.suffix);
  group.suffixSteps.forEach((step) => {
    step.viewportSegment.uniformBuffer.destroy();
    engine.destroyMergedSurface(step.surface);
  });
}

export async function foldClippingGroupIntoMergedSurface(
  engine: BrushEngine,
  surface: MergedSurfaceResources,
  unit: readonly LayerRecord[],
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  first: boolean,
  externalBlendMode: LayerBlendMode = unit[0].blendMode,
): Promise<boolean> {
  const parent = unit[0];
  if (!parent.visible || parent.opacity <= 0) {
    return false;
  }
  const group = await buildClippingPrefixSurface(
    engine,
    parent,
    unit.slice(1),
    caller,
    false,
    `Fold gruppo ritaglio ${parent.id}`,
  );
  if (!group) {
    return false;
  }
  try {
    const rect = intersectMergedSurfaceRects(
      group.bounds,
      surface.bounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    if (!rect) {
      return false;
    }
    await foldViewIntoMergedSurface(
      engine,
      surface,
      group.samplingView,
      group.bounds,
      group.resolutionScale,
      group.textureWidth,
      group.textureHeight,
      parent.opacity,
      rect,
      externalBlendMode,
      "source-over",
      first,
      `Fold gruppo ritaglio ${parent.id} into merged ${side}`,
    );
    surface.analyticBakePixels += group.analyticBakePixels;
    return true;
  } finally {
    engine.destroyMergedSurface(group);
  }
}

export async function foldRasterRecordIntoMergedSurface(engine: BrushEngine, 
  surface: MergedSurfaceResources,
  record: LayerRecord,
  side: "below" | "above",
  caller: EffectsRetargetCaller,
  first: boolean,
  externalBlendMode: LayerBlendMode = record.blendMode,
): Promise<boolean> {
  if (record.clippingParentId !== null) {
    throw new Error(`Il child ${record.id} deve essere foldato con il proprio gruppo.`);
  }
  const directTileFold = await tryFoldAuthoritativeColdTilesIntoMergedSurface(
    engine,
    surface,
    record,
    record.opacity,
    externalBlendMode,
    "source-over",
    first,
    `Fold tile cold livello ${record.id} into merged ${side}`,
  );
  if (directTileFold !== null) {
    return directTileFold;
  }
  const source = await materializeLayerCompositeSource(engine, record, caller);
  const sourceRect = intersectMergedSurfaceRects(
    source.nonTransparentBounds,
    surface.bounds,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!sourceRect) {
    engine.destroyLayerBake(source.transientBake);
    destroyTransientLayerHydration(engine, source.transientHydration);
    return false;
  }
  surface.analyticBakePixels += source.analyticBakePixels;
  try {
    await foldViewIntoMergedSurface(
      engine,
      surface,
      source.view,
      { x: 0, y: 0 },
      1,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
      record.opacity,
      sourceRect,
      externalBlendMode,
      "source-over",
      first,
      `Fold livello ${record.id} into merged ${side}`,
    );
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
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!contentBounds) {
    return null;
  }
  const allocation = {
    bounds: alignedMergedSurfaceBounds(
      contentBounds,
      DOCUMENT_WIDTH,
      64,
      64,
      DOCUMENT_HEIGHT,
    ),
    resolutionScale: 1,
  } as const;
  const visibleItems = boundedItems.filter((entry) =>
    intersectMergedSurfaceRects(
      entry.bounds,
      allocation.bounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) !== null
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
    const foldedGroupMembers = new Set<number>();
    for (const { item } of visibleItems) {
      const record = engine.layerStack.byId(item.rasterLayerId);
      if (!record) {
        throw new Error(`Raster ${item.rasterLayerId} assente durante il fold.`);
      }
      if (foldedGroupMembers.has(record.id)) {
        continue;
      }
      const unit = engine.layerStack.clippingUnit(record.id);
      const didFold: boolean = unit.length > 1
        ? await foldClippingGroupIntoMergedSurface(
          engine,
          surface,
          unit,
          side,
          caller,
          first,
          "normal",
        )
        : await foldRasterRecordIntoMergedSurface(
          engine,
          surface,
          record,
          side,
          caller,
          first,
          "normal",
        );
      if (unit.length > 1) {
        unit.forEach((member) => foldedGroupMembers.add(member.id));
      }
      first = first && !didFold;
    }
    if (first) {
      engine.destroyMergedSurface(surface);
      return null;
    }
    releaseLayerBlendFoldScratch(surface);
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
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
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

/**
 * Non-Normal layer modes need the real backdrop and therefore cannot be
 * hidden inside an independently flattened raster run. Keep consecutive
 * Normal clipping units fused, but isolate every unit whose parent owns an
 * advanced mode. A clipping unit remains atomic: child modes are evaluated
 * while its isolated source is built, and the parent's mode is applied later
 * to the complete group by the ordered viewport compositor.
 */
export function splitMixedSceneRasterRunsForLayerBlend(
  engine: BrushEngine,
  segments: readonly MixedSceneCompositionSegment[],
): readonly MixedSceneCompositionSegment[] {
  const result: MixedSceneCompositionSegment[] = [];
  for (const segment of segments) {
    if (segment.kind !== "raster-run") {
      result.push(segment);
      continue;
    }

    const itemByLayerId = new Map(
      segment.items.map((item) => [item.rasterLayerId, item] as const),
    );
    const consumed = new Set<number>();
    let normalItems: (MixedSceneItem & { kind: "raster" })[] = [];
    const flushNormal = () => {
      if (normalItems.length === 0) {
        return;
      }
      const items = normalItems;
      normalItems = [];
      result.push({
        key: `raster-run:${items.map((item) => item.rasterLayerId).join(",")}`,
        kind: "raster-run",
        items,
      });
    };

    for (const item of segment.items) {
      if (consumed.has(item.rasterLayerId)) {
        continue;
      }
      const unit = engine.layerStack.clippingUnit(item.rasterLayerId);
      const parent = unit[0];
      const unitItems = unit
        .map((record) => itemByLayerId.get(record.id))
        .filter((candidate): candidate is MixedSceneItem & { kind: "raster" } => (
          candidate !== undefined
        ));
      if (unitItems.length !== unit.length) {
        throw new Error(
          `Unità di ritaglio ${parent.id} spezzata durante il programma fusione livelli.`,
        );
      }
      unit.forEach((record) => consumed.add(record.id));
      if (parent.blendMode === "normal") {
        normalItems.push(...unitItems);
        continue;
      }
      flushNormal();
      result.push({
        key: (
          `raster-run:${unitItems.map((candidate) => candidate.rasterLayerId).join(",")}`
          + `@blend=${parent.blendMode}`
        ) as `raster-run:${string}`,
        kind: "raster-run",
        items: unitItems,
      });
    }
    flushNormal();
  }
  return result;
}

export function mixedSceneSegmentLayerBlendMode(
  engine: BrushEngine,
  segment: MixedSceneCompositionSegment,
): LayerBlendMode {
  if (segment.kind === "raster-run") {
    const first = segment.items[0];
    if (!first) {
      return "normal";
    }
    return engine.layerStack.clippingUnit(first.rasterLayerId)[0].blendMode;
  }
  if (segment.kind === "active-raster") {
    return engine.layerStack.clippingUnit(segment.item.rasterLayerId)[0].blendMode;
  }
  return "normal";
}

export function orderedLayerBlendPresentationRequired(engine: BrushEngine): boolean {
  return engine.layerStack.layers.some((record) => record.blendMode !== "normal");
}

export function allocateMergedSurface(engine: BrushEngine, 
  format: LayerFormat,
  side: "below" | "above",
  layerCount: number,
  bounds: DirtyRect = { x: 0, y: 0, width: DOCUMENT_WIDTH, height: DOCUMENT_HEIGHT },
  resolutionScale = 1,
  maintainMipChain = true,
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
  const fullMipLevelCount = mergedSurfaceMipLevelCount(physicalBounds);
  const mipLevelCount = maintainMipChain ? fullMipLevelCount : 1;
  const memory = mergedSurfaceMemoryBytes(
    physicalBounds,
    format === "rgba16float" ? 8 : 4,
  );
  const texture = engine.device.createTexture({
    label:
      `Merged ${side} surface (${layerCount} layers) ${format} `
      + `${textureWidth}×${textureHeight} (${normalizedBounds.width}×`
      + `${normalizedBounds.height} doc @ ${resolutionScale}x) `
      + `@ ${normalizedBounds.x},${normalizedBounds.y}`
      + (maintainMipChain ? "" : " · mip0-only"),
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
      blendFoldBackdropScratchTexture: null,
      blendFoldBackdropScratchView: null,
      blendFoldScratchTexture: null,
      blendFoldScratchView: null,
      blendFoldUniformBuffer: null,
      blendFoldUniformStride: 0,
      blendFoldTileWidth: 0,
      blendFoldTileHeight: 0,
      bounds: { ...normalizedBounds },
      resolutionScale,
      textureWidth,
      textureHeight,
      mip0MemoryBytes: memory.mip0Bytes,
      mipChainMemoryBytes: maintainMipChain ? memory.mipChainBytes : 0,
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

function assertMixedSceneClippingMergeIsAdjacent(
  engine: BrushEngine,
  index: number,
): void {
  const scene = engine.mixedSceneStack;
  if (!scene) {
    return;
  }
  const record = engine.layerStack.at(index);
  if (record.clippingParentId !== null) {
    return;
  }
  if (index === 0) {
    throw new Error(
      "Per creare una maschera serve un livello raster immediatamente sotto.",
    );
  }
  const lowerUnit = engine.layerStack.clippingUnit(engine.layerStack.at(index - 1));
  const upperUnit = engine.layerStack.clippingUnit(record);
  const lowerIndices = lowerUnit.map((member) =>
    scene.indexOfKey(`raster:${member.id}` as const));
  const upperIndices = upperUnit.map((member) =>
    scene.indexOfKey(`raster:${member.id}` as const));
  const isConsecutive = (indices: readonly number[]) =>
    indices.every((candidate, offset) => (
      candidate >= 0 && candidate === indices[0] + offset
    ));
  if (
    !isConsecutive(lowerIndices)
    || !isConsecutive(upperIndices)
    || upperIndices[0] !== lowerIndices[lowerIndices.length - 1] + 1
  ) {
    throw new Error(
      "La maschera richiede un raster immediatamente sotto: sposta prima eventuali "
      + "livelli vettoriali che separano i due gruppi.",
    );
  }
}

/**
 * Changes only clipping structure; authoritative pixels, tile masks and layer
 * residency remain untouched. The two merged sides and the active prefix /
 * suffix are rebuilt transactionally from those authoritative resources.
 */
export async function setLayerClipping(
  engine: BrushEngine,
  index: number,
  enabled: boolean,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  const record = engine.layerStack.at(index);
  const previousEnabled = record.clippingParentId !== null;
  if (previousEnabled === enabled) {
    return false;
  }
  engine.assertLayerSwitchAllowed();
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  let changed = false;
  try {
    await engine.waitForIdle();
    if (enabled) {
      assertMixedSceneClippingMergeIsAdjacent(engine, index);
    }
    engine.persistActiveLayerState();
    changed = engine.layerStack.setClippingEnabled(index, enabled);
    await engine.rebuildMergedLayerSurfaces();
    engine.paintDisplayMipValidThroughLevel = 0;
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    return changed;
  } catch (error) {
    if (changed) {
      try {
        engine.layerStack.setClippingEnabled(index, previousEnabled);
        await engine.rebuildMergedLayerSurfaces("layer-switch");
        engine.paintDisplayMipValidThroughLevel = 0;
        engine.presentationCacheNeedsFullRebuild = true;
        engine.displayDirty = true;
        engine.requestRender();
      } catch (restoreError) {
        engine.latchDocumentStateInconsistent(
          "Stato incoerente dopo il cambio maschera: ricarica prima di continuare.",
        );
        const originalMessage = error instanceof Error ? error.message : String(error);
        const restoreMessage = restoreError instanceof Error
          ? restoreError.message
          : String(restoreError);
        throw new Error(
          `Maschera non aggiornata (${originalMessage}) e ripristino fallito `
          + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
        );
      }
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
    publishMixedScene(engine);
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
    if (
      index !== engine.layerStack.activeIndex
      || engine.layerStack.clippingDependents(record.id).length > 0
    ) {
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

/**
 * Publishes one non-destructive raster blend-mode change transactionally.
 *
 * The mode is CPU metadata; every derived merged surface is rebuilt by the
 * WebGPU compositor before the new value becomes visible. Undo/Redo sets
 * `historyReplay` because the global history gate is intentionally held while
 * it crosses this action. Pixel history is never replayed for a mode change.
 */
export async function setLayerBlendMode(
  engine: BrushEngine,
  index: number,
  blendMode: LayerBlendMode,
  historyReplay = false,
): Promise<boolean> {
  if (!engine.initialized) {
    throw new Error("Il motore non è ancora inizializzato.");
  }
  if (!isLayerBlendMode(blendMode)) {
    throw new RangeError(`Modalità fusione livello non valida: ${String(blendMode)}.`);
  }
  const record = engine.layerStack.at(index);
  if (record.blendMode === blendMode) {
    return false;
  }
  if (historyReplay) {
    if (!engine.historyBusy || engine.layerSwitchBusy || engine.activeStroke) {
      throw new Error("Transazione storica della fusione livello non valida.");
    }
  } else {
    engine.assertLayerSwitchAllowed();
  }
  engine.cancelLayerColdCompressionIdle();
  engine.layerSwitchBusy = true;
  const previousBlendMode = record.blendMode;
  const rebuildCaller = effectsRetargetCallerForHistoryReplay(historyReplay);
  const hadTileCompositor = engine.layerBlendTileCompositor !== null;
  try {
    await engine.waitForIdle();
    const candidateAdvanced = blendMode !== "normal"
      || engine.layerStack.layers.some(
        (candidate) => candidate.id !== record.id && candidate.blendMode !== "normal",
      );
    const visibleSemantics = Boolean(engine.mixedSceneStack?.visibleSemanticCount);
    const candidateNeedsTile = candidateAdvanced && !visibleSemantics;
    const candidateNeedsViewportBlend = candidateAdvanced && visibleSemantics;
    if (candidateAdvanced) {
      // The screen-linear cache is also the destination of the exact tile
      // path. With semantic nodes, validate its two RGBA16F ping-pong peers as
      // well. No mode/history metadata is visible until every scope succeeds.
      await prewarmMixedSceneLinearTextureForLayerBlend(
        engine,
        Math.max(1, engine.canvas.width),
        Math.max(1, engine.canvas.height),
        candidateNeedsViewportBlend,
      );
    }
    if (candidateNeedsTile) {
      // Allocate and validate the bounded live working set before metadata is
      // published. An OOM therefore leaves both the mode and history untouched.
      await ensureLayerBlendTilePresentationResources(engine);
    }
    record.blendMode = blendMode;
    engine.paintDisplayMipValidThroughLevel = 0;
    await engine.rebuildMergedLayerSurfaces(rebuildCaller);
    if (engine.layerStack.layers.every((candidate) => candidate.blendMode === "normal")) {
      releaseLayerBlendTilePresentationResources(engine);
    }
    ensureMixedSceneLinearTexture(
      engine,
      Math.max(1, engine.canvas.width),
      Math.max(1, engine.canvas.height),
    );
    engine.presentationCacheNeedsFullRebuild = true;
    engine.displayDirty = true;
    engine.requestRender();
    return true;
  } catch (error) {
    record.blendMode = previousBlendMode;
    if (
      !hadTileCompositor
      && engine.layerStack.layers.every((candidate) => candidate.blendMode === "normal")
    ) {
      releaseLayerBlendTilePresentationResources(engine);
    }
    try {
      await engine.rebuildMergedLayerSurfaces(rebuildCaller);
      ensureMixedSceneLinearTexture(
        engine,
        Math.max(1, engine.canvas.width),
        Math.max(1, engine.canvas.height),
      );
      engine.paintDisplayMipValidThroughLevel = 0;
      engine.presentationCacheNeedsFullRebuild = true;
      engine.displayDirty = true;
      engine.requestRender();
    } catch (restoreError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const restoreMessage = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      const combined = new Error(
        `Fusione livello non aggiornata (${originalMessage}) e ripristino fallito `
        + `(${restoreMessage}). Ricarica la pagina prima di continuare.`,
      );
      engine.latchDocumentStateInconsistent(
        "Stato incoerente dopo la fusione livello: ricarica prima di continuare.",
        combined,
      );
      throw combined;
    }
    throw error;
  } finally {
    engine.layerSwitchBusy = false;
    engine.scheduleLayerColdCompression();
    engine.publishStats();
    publishMixedScene(engine);
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

interface EffectsRendererReleasePlan {
  readonly stroke: boolean;
  readonly bevel: boolean;
  readonly outerShadow: boolean;
  readonly innerShadow: boolean;
  readonly any: boolean;
}

interface EffectsReachabilityLiveLayerCacheEntry {
  readonly record: LayerRecord;
  readonly effectMask: number;
}

interface EffectsReachabilityCacheEntry {
  readonly historyActions: BrushEngine["historyActions"];
  readonly historyLength: number;
  readonly historyLastAction: BrushEngine["historyActions"][number] | null;
  readonly historyFloorCursor: number;
  readonly openMetadataEdit: BrushEngine["activeRasterLayerMetadataHistoryEdit"];
  readonly liveLayers: readonly EffectsReachabilityLiveLayerCacheEntry[];
  readonly reachable: RasterEffectRendererReachability;
}

const effectsReachabilityCache = new WeakMap<BrushEngine, EffectsReachabilityCacheEntry>();

function layerEffectReachabilityMask(record: LayerRecord): number {
  return Number(record.strokeStyle.enabled && record.strokeStyle.width > 0)
    | (Number(record.bevelStyle.enabled) << 1)
    | (Number(record.outerShadowStyle.enabled) << 2)
    | (Number(record.innerShadowStyle.enabled) << 3)
    | (Number(
      record.colorOverlayStyle.enabled && record.colorOverlayStyle.opacity > 0,
    ) << 4);
}

function effectsReachabilityCacheMatchesLiveLayers(
  cached: EffectsReachabilityCacheEntry,
  liveLayers: readonly LayerRecord[],
): boolean {
  if (cached.liveLayers.length !== liveLayers.length) return false;
  for (let index = 0; index < liveLayers.length; index += 1) {
    const live = liveLayers[index];
    const previous = cached.liveLayers[index];
    if (
      previous.record !== live
      || previous.effectMask !== layerEffectReachabilityMask(live)
    ) {
      return false;
    }
  }
  return true;
}

function reachableEffectRenderers(engine: BrushEngine): RasterEffectRendererReachability {
  const liveLayers = engine.layerStack.layers;
  const actions = engine.historyActions;
  const floorCursor = historyFloorCursor(engine);
  const lastAction = actions.at(-1) ?? null;
  const cached = effectsReachabilityCache.get(engine);
  if (
    cached
    && cached.historyActions === actions
    && cached.historyLength === actions.length
    && cached.historyLastAction === lastAction
    && cached.historyFloorCursor === floorCursor
    && cached.openMetadataEdit === engine.activeRasterLayerMetadataHistoryEdit
    && effectsReachabilityCacheMatchesLiveLayers(cached, liveLayers)
  ) {
    return cached.reachable;
  }
  const reachable = rasterEffectRendererReachability(
    liveLayers,
    actions,
    engine.activeRasterLayerMetadataHistoryEdit,
    floorCursor,
  );
  effectsReachabilityCache.set(engine, {
    historyActions: actions,
    historyLength: actions.length,
    historyLastAction: lastAction,
    historyFloorCursor: floorCursor,
    openMetadataEdit: engine.activeRasterLayerMetadataHistoryEdit,
    liveLayers: liveLayers.map((record) => ({
      record,
      effectMask: layerEffectReachabilityMask(record),
    })),
    reachable,
  });
  return reachable;
}

function effectsRendererReleasePlan(engine: BrushEngine): EffectsRendererReleasePlan {
  if (
    !engine.rasterStrokeRenderer
    && !engine.rasterBevelRenderer
    && !engine.rasterOuterShadowRenderer
    && !engine.rasterInnerShadowRenderer
  ) {
    return {
      stroke: false,
      bevel: false,
      outerShadow: false,
      innerShadow: false,
      any: false,
    };
  }
  const reachable = reachableEffectRenderers(engine);
  const bevel = Boolean(engine.rasterBevelRenderer && !reachable.bevel);
  const outerShadow = Boolean(
    engine.rasterOuterShadowRenderer && !reachable.outerShadow,
  );
  const innerShadow = Boolean(
    engine.rasterInnerShadowRenderer && !reachable.innerShadow,
  );
  // Advanced live layer blending borrows the shared style compositor even
  // when no raster effect is reachable. Its release helper deliberately keeps
  // that renderer resident; excluding it here also prevents an idle retry loop.
  const stroke = Boolean(
    engine.rasterStrokeRenderer
    && !reachable.stroke
    && !engine.layerBlendTileCompositor,
  );
  return {
    stroke,
    bevel,
    outerShadow,
    innerShadow,
    any: stroke || bevel || outerShadow || innerShadow,
  };
}

function bevelFieldBlocksEffectsReclaim(
  engine: BrushEngine,
  releasePlan: EffectsRendererReleasePlan,
): boolean {
  // An unreachable Bevel renderer is destroyed whole, including its field; it
  // does not need the final field-shrink encode reserved for a reachable one.
  return !releasePlan.bevel && bevelFieldBlocksScratchShrink(engine);
}

export async function shrinkEffectsScratchAfterIdle(engine: BrushEngine): Promise<void> {
  const initialReleasePlan = effectsRendererReleasePlan(engine);
  if (
    engine.effectsScratchShrinkInFlight
    || bevelFieldBlocksEffectsReclaim(engine, initialReleasePlan)
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
    const releasePlan = effectsRendererReleasePlan(engine);
    if (
      !effectsScratchCanShrinkNow(engine)
      || bevelFieldBlocksEffectsReclaim(engine, releasePlan)
    ) {
      engine.scheduleBevelFieldShrink();
      return;
    }

    // Destroy effect-owned persistent textures/buffers first. Each destroy()
    // also drops its scratch requirement; the one physical pool can then be
    // resized once, after every unreachable owner has gone away.
    if (releasePlan.outerShadow) releaseRasterOuterShadowRenderer(engine);
    if (releasePlan.innerShadow) releaseRasterInnerShadowRenderer(engine);
    if (releasePlan.bevel) releaseRasterBevelRenderer(engine);
    if (releasePlan.stroke) releaseRasterStrokeRenderer(engine);

    const pool = engine.effectsWorkbench?.scratchPool;
    if (!pool) {
      if (releasePlan.any) engine.publishStats();
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
    if (releasePlan.any || shrunk) {
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
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
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
  const contentBounds = unionMergedSurfaceRects(
    visibleRecords.map(
      (record) => layerCompositeVisualBounds(engine, record) as MergedSurfaceRect,
    ),
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  );
  if (!contentBounds) {
    return null;
  }
  const allocationBounds = alignedMergedSurfaceBounds(
    contentBounds,
    DOCUMENT_WIDTH,
    64,
    64,
    DOCUMENT_HEIGHT,
  );

  return runGpuAllocationTransaction(
    engine.device,
    `Merged ${side} surface transaction`,
    async (transaction) => {
      const surface = allocateMergedSurface(engine, 
        engine.layerFormat,
        side,
        visibleRecords.length,
        allocationBounds,
      );
      transaction.deferRollback(() => engine.destroyMergedSurface(surface));

      let first = true;
      const foldedGroupMembers = new Set<number>();
      for (const record of visibleRecords) {
        if (foldedGroupMembers.has(record.id)) {
          continue;
        }
        const unit = engine.layerStack.clippingUnit(record.id);
        const didFold: boolean = unit.length > 1
          ? await foldClippingGroupIntoMergedSurface(
            engine,
            surface,
            unit,
            side,
            caller,
            first,
          )
          : await foldRasterRecordIntoMergedSurface(
            engine,
            surface,
            record,
            side,
            caller,
            first,
          );
        if (unit.length > 1) {
          unit.forEach((member) => foldedGroupMembers.add(member.id));
        }
        first = first && !didFold;
      }

      if (first) {
        engine.destroyMergedSurface(surface);
        return null;
      }
      releaseLayerBlendFoldScratch(surface);

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
    size: {
      width: Math.max(1, DOCUMENT_WIDTH >> 1),
      height: Math.max(1, DOCUMENT_HEIGHT >> 1),
      depthOrArrayLayers: 1,
    },
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
  rebuildDomain: LayerEffectsRebuildDomain = "full-document",
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
    "await-immediately",
    rebuildDomain,
  );
}

export function effectsScratchNeedsShrink(engine: BrushEngine): boolean {
  if (effectsRendererReleasePlan(engine).any) {
    return true;
  }
  const snapshot = engine.effectsWorkbench?.scratchPool.snapshot();
  if (!snapshot || snapshot.currentBytes === 0) {
    return false;
  }
  if (!Object.values(snapshot.requirements).some((bytes) => bytes > 0)) {
    // Once the last owner is gone, even a sub-threshold allocation is useless:
    // return the physical pool all the way to zero instead of treating it as a
    // warm cache for an effect that no reachable state can request.
    return true;
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
      { binding: 6, resource: engine.activeClippingPrefixView() },
      { binding: 7, resource: engine.activeClippingSuffixView() },
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
      { binding: 4, resource: engine.activeClippingPrefixView() },
      { binding: 5, resource: engine.activeClippingSuffixView() },
    ],
  });
  if (engine.lightGlazeView) {
    engine.lightGlazeCompositeMipBindGroup = engine.device.createBindGroup({
      label: "Light Glaze group-aware composited logical mip 1",
      layout: engine.lightGlazeCompositeMipBindGroupLayout,
      entries: [
        { binding: 0, resource: engine.layerView },
        { binding: 1, resource: engine.lightGlazeView },
        { binding: 2, resource: { buffer: engine.lightGlazeUniformBuffer } },
        { binding: 3, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 4, resource: engine.activeClippingPrefixView() },
        { binding: 5, resource: engine.activeClippingSuffixView() },
        { binding: 6, resource: engine.mergedBelowView() },
        { binding: 7, resource: engine.mergedAboveView() },
      ],
    });
  }
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
    layerSwitchBusy: engine.layerSwitchBusy,
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
  engine.selectionRenderer?.setSourceSamplingView(hot.samplingView);
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
  const surface = engine.liveMergedSurfaceTextures.get(texture);
  if (surface) {
    releaseLayerBlendFoldScratch(surface);
  }
  engine.liveMergedSurfaceTextures.delete(texture);
  texture.destroy();
}
