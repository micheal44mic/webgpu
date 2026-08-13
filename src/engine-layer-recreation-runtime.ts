import type {
  BrushEngine,
} from "./brush-engine";
import {
  type LayerFormat,
} from "./engine-types";
import {
  runGpuAllocationTransaction,
} from "./gpu-allocation-transaction";
import {
  createRenderPipelineAsync,
} from "./engine-gpu-utils";
import {
  type DisplayPyramidResources,
  type LayerGpuResources,
} from "./engine-layer-resources";
import {
  DryBlendRenderer,
} from "./blend-renderer";
import {
  EffectsWorkbench,
} from "./effects-workbench";
import {
  createColdLayerGpuResources,
} from "./engine-cold-storage";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
} from "./engine-limits";
import {
  destroyLightGlazeResources,
} from "./engine-glaze-runtime";
import {
  clearLayerStorageTileMask,
} from "./layer-storage-study";
import {
  destroyMixedSceneRasterSegment,
} from "./engine-vector-text-resources-runtime";
import {
  destroyThicknessTailOverlayResources,
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

import { destroyActiveClippingGroupResources } from "./engine-layer-clipping-runtime";
import {
  allocateActiveLayerDisplayPyramid,
  allocateLayerGpuResources,
  destroyLayerGpuResources,
  rebuildActiveLayerPyramidBindings,
  rebuildLayerDisplayBindGroups,
} from "./engine-layer-residency-runtime";

export interface RecreateLayerResourcesOptions {
  /** Compile pixel-selection paint variants after the initial canvas is visible. */
  readonly deferSelectionPipelines?: boolean;
  /** Build the dry-blend renderer after the initial raster canvas is visible. */
  readonly deferBlendRenderer?: boolean;
}

async function createLayerPipelineBundle(
  engine: BrushEngine,
  format: LayerFormat,
  options: RecreateLayerResourcesOptions,
) {
  return await runGpuAllocationTransaction(
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
}

async function allocateLayerResourceCandidate(
  engine: BrushEngine,
  format: LayerFormat,
  options: RecreateLayerResourcesOptions,
  previousScratchPeakBytes: number,
) {
  // Recreating the document invalidates every layer's texture, not just the
  // active one. Allocate the complete replacement transactionally.
  //
  // Allocate everything BEFORE destroying anything. Destroying first would mean
  // an OOM partway through the remaining layers left the document with neither
  // the old textures nor the new ones. Callers rely on the old resources still
  // being valid if this transaction fails.
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
  return {
    replacement,
    blendRenderer,
    nextEffectsWorkbench,
    nextDisplayPyramid,
    nextTransparentTexture,
    nextTransparentView,
    texture,
    view,
    samplingView,
  };
}

async function publishLayerResourceCandidate(
  engine: BrushEngine,
  format: LayerFormat,
  options: RecreateLayerResourcesOptions,
  pipelines: Awaited<ReturnType<typeof createLayerPipelineBundle>>,
  candidate: Awaited<ReturnType<typeof allocateLayerResourceCandidate>>,
  oldBlendRenderer: DryBlendRenderer | null,
  oldEffectsWorkbench: EffectsWorkbench | null,
): Promise<void> {
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
  } = pipelines;
  const {
    replacement,
    blendRenderer,
    nextEffectsWorkbench,
    nextDisplayPyramid,
    nextTransparentTexture,
    nextTransparentView,
    texture,
    view,
    samplingView,
  } = candidate;
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

export async function recreateLayerResources(
  engine: BrushEngine,
  format: LayerFormat,
  options: RecreateLayerResourcesOptions = {},
): Promise<void> {
  const oldBlendRenderer = engine.blendRenderer;
  const oldEffectsWorkbench = engine.effectsWorkbench;
  const pipelines = await createLayerPipelineBundle(engine, format, options);
  const candidate = await allocateLayerResourceCandidate(
    engine,
    format,
    options,
    oldEffectsWorkbench?.scratchPool.peakBytes ?? 0,
  );
  await publishLayerResourceCandidate(
    engine,
    format,
    options,
    pipelines,
    candidate,
    oldBlendRenderer,
    oldEffectsWorkbench,
  );
}
