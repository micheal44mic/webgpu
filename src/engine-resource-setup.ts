import type { BrushEngine } from "./brush-engine";
import {
  BRUSH_UNIFORM_BYTES,
  DISPLAY_UNIFORM_BYTES,
  GRAIN_TEXTURE_MIP_LEVEL_COUNT,
  GRAIN_TEXTURE_SIZE,
  GRAIN_UNIFORM_BYTES,
  LAYER_COMPOSITE_UNIFORM_BYTES,
  LAYER_SIZE,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES,
  LIGHT_GLAZE_UNIFORM_BYTES,
  MAX_STAMPS_PER_BATCH,
  SHAPE_MASK_SIZE,
  SHAPE_OCCUPANCY_MAP_BYTES,
  SHAPE_OCCUPANCY_MAP_COUNT,
  SHAPE_OCCUPANCY_MAX_MIP,
  SHAPE_OCCUPANCY_WORDS_PER_MAP,
  STAMP_STRIDE_BYTES,
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  THICKNESS_TAIL_TEXTURE_QUANTUM,
  THICKNESS_TAIL_UNIFORM_BYTES,
  VECTOR_TEXT_CAPTURE_UNIFORM_BYTES,
} from "./engine-limits";
import { type GrainFiltering } from "./engine-types";
import type { BrushGrainAssetId, BrushShapeAssetId } from "./engine-types";
import { type GrainTextureResources, type ShapeMaskResources } from "./engine-paint-resources";
import {
  grainAssetDescriptor,
  mipLevelCountForSize,
  r16MipChainBytes,
  shapeAssetDescriptor,
} from "./engine-brush-assets";
import { grainLumaShader, grainMipShader } from "./shaders";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { hashBytes } from "./engine-math";
import {
  SHAPE_CANVAS_DECODE_STRATEGY,
  SHAPE_DIRECT_DECODE_STRATEGY,
  isTexturizedGrainActive,
  usesBlendRenderer,
  type ShapeMaskDecodeStrategy,
} from "./engine-strategies";
import { decodeGrayscalePng8 } from "./png-mask";
import { decodeShapeMaskWithCanvas } from "./shape-mask-decode";
import { buildShapeOccupancyMaps } from "./shape-occupancy";
import { clamp } from "./color";
import { RasterStrokeRenderer } from "./stroke-renderer";
import {
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
  rasterStrokeScratchExtentForRenderer,
} from "./stroke-core";
import { layerEffectRendererRequirements, type LayerRecord } from "./layer-stack";
import { normalizeRasterBevelStyle } from "./bevel-core";
import { normalizeRasterInnerShadowStyle, normalizeRasterOuterShadowStyle } from "./shadow-core";
import {
  RASTER_COLOR_OVERLAY_EFFECT_ID,
  normalizeRasterColorOverlayStyle,
} from "./raster-color-overlay-core";
import { THICKNESS_TAPER_WINDOW_MS, endThicknessRadius } from "./thickness-dynamics";
import { RasterShadowRenderer } from "./shadow-renderer";
import { RasterBevelRenderer } from "./bevel-renderer";
import { ensureMixedSceneLinearTexture } from "./engine-vector-text-runtime";
import {
  cancelBevelFieldShrink,
  commitThicknessStamp,
  finishStaticResourceCreation,
  setRasterStrokeGeometryEnabled,
} from "./engine-runtime-misc";
import { prepareAdaptivePreviewShapePalette } from "./engine-adaptive-preview-runtime";

export async function createStaticResources(engine: BrushEngine): Promise<void> {
  engine.brushUniformBuffer = engine.device.createBuffer({
    label: "Brush uniforms",
    size: BRUSH_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.thicknessTailBrushUniformBuffer = engine.device.createBuffer({
    label: "Predictive thickness tail brush uniforms",
    size: BRUSH_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.grainUniformBuffer = engine.device.createBuffer({
    label: "Texturized grain uniforms",
    size: GRAIN_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.displayUniformBuffer = engine.device.createBuffer({
    label: "Display uniforms",
    size: DISPLAY_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.vectorTextCaptureUniformBuffer = engine.device.createBuffer({
    label: "Adaptive vector text capture view uniforms",
    size: VECTOR_TEXT_CAPTURE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.vectorTextFallbackCaptureUniformBuffer = engine.device.createBuffer({
    label: "Adaptive vector text wide capture view uniforms",
    size: VECTOR_TEXT_CAPTURE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.layerCompositeUniformBuffer = engine.device.createBuffer({
    label: "Layer composite opacity",
    size: LAYER_COMPOSITE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.thicknessTailDisplayUniformBuffer = engine.device.createBuffer({
    label: "Predictive thickness tail display uniforms",
    size: THICKNESS_TAIL_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.lightGlazeUniformBuffer = engine.device.createBuffer({
    label: "Light Glaze stroke opacity",
    size: LIGHT_GLAZE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.lightGlazeCommitTileUniformBuffer = engine.device.createBuffer({
    label: "High precision glaze commit tile source origin",
    size: LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  engine.instanceBuffer = engine.device.createBuffer({
    label: "Stamp instance storage",
    size: MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  engine.thicknessTailInstanceBuffer = engine.device.createBuffer({
    label: "Predictive thickness tail instance storage",
    size: MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  engine.sampler = engine.device.createSampler({
    label: "Layer linear sampler",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  engine.shapeMaskSampler = engine.device.createSampler({
    label: "Shape 2K mask sampler",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  const createGrainSamplerSet = (
    mode: "fixed" | "moving",
    addressMode: GPUAddressMode,
  ): Record<GrainFiltering, GPUSampler> => ({
    no: engine.device.createSampler({
      label: `Grain ${mode} no filtering`,
      magFilter: "nearest",
      minFilter: "nearest",
      // A linear mip declaration makes this sampler valid for the common
      // filtering binding. WGSL supplies a rounded integer LOD, so the
      // effective mip and texel choices both remain nearest.
      mipmapFilter: "linear",
      addressModeU: addressMode,
      addressModeV: addressMode,
    }),
    classic: engine.device.createSampler({
      label: `Grain ${mode} classic filtering`,
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: addressMode,
      addressModeV: addressMode,
    }),
    improved: engine.device.createSampler({
      label: `Grain ${mode} improved filtering`,
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: addressMode,
      addressModeV: addressMode,
    }),
  });
  engine.grainSamplers = {
    fixed: createGrainSamplerSet("fixed", "repeat"),
    moving: createGrainSamplerSet("moving", "clamp-to-edge"),
  };
  // Il Grain non viene caricato allo startup: la texture vera arriva
  // con ensureGrainResources alla selezione di un grain mode. Il placeholder
  // bianco (identità del multiply) mantiene validi tutti i bind group.
  engine.grainPlaceholderTexture = engine.device.createTexture({
    label: "Grain placeholder 1×1 while released",
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  engine.device.queue.writeTexture(
    { texture: engine.grainPlaceholderTexture },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 256, rowsPerImage: 1 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  );
  engine.grainPlaceholderView = engine.grainPlaceholderTexture.createView({
    label: "Grain placeholder view",
  });
  engine.grainTextureView = engine.grainPlaceholderView;
  // La Shape 2K non viene più caricata allo startup: la maschera vera
  // arriva con ensureShapeResources alla selezione della Shape. Il
  // placeholder 1×1 bianco tiene validi i bind group; le mappe di
  // occupazione restano a zero finché la decodifica non le riempie (mai
  // consultate vuote: i tratti Shape senza maschera vengono rifiutati).
  engine.shapeMaskPlaceholderTexture = engine.device.createTexture({
    label: "Shape placeholder 1×1 while released",
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  engine.device.queue.writeTexture(
    { texture: engine.shapeMaskPlaceholderTexture },
    new Uint8Array(256).fill(255),
    { bytesPerRow: 256, rowsPerImage: 1 },
    { width: 1, height: 1, depthOrArrayLayers: 1 },
  );
  engine.shapeMaskPlaceholderView = engine.shapeMaskPlaceholderTexture.createView({
    label: "Shape placeholder view",
  });
  engine.shapeMaskView = engine.shapeMaskPlaceholderView;
  engine.shapeOccupancyUniformBuffers = Array.from(
    { length: SHAPE_OCCUPANCY_MAP_COUNT },
    (_, mipLevel) => engine.device.createBuffer({
      label: `Shape conservative occupancy bitmask mip ${mipLevel}`,
      size: SHAPE_OCCUPANCY_MAP_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  );

  const brushLayoutEntries: GPUBindGroupLayoutEntry[] = [
    {
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    },
    {
      binding: 1,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "read-only-storage" },
    },
    {
      binding: 2,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d" },
    },
    {
      binding: 3,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: "filtering" },
    },
  ];
  engine.brushBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Brush legacy bind group layout",
    entries: brushLayoutEntries,
  });
  engine.brushOccupancyBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Brush occupancy bind group layout",
    entries: [
      ...brushLayoutEntries,
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  engine.selectionMaskBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Clip Paint · maschera Selezione pixel",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "read-only-storage" },
    }],
  });

  engine.displayBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Three-surface layer display bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  engine.rasterStrokeDisplayScreenBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Traccia display screen bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  engine.rasterStrokeDisplaySourceBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Traccia direct LOD 0 and coarse mip display source layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      {
        binding: 8,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 9,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 10,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 11,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 12,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 13,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 14,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 16, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 17, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 18, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  engine.lightGlazeDisplayBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Light Glaze live display bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  engine.thicknessTailDisplayBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Predictive thickness tail display bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  const grainLayoutEntries: GPUBindGroupLayoutEntry[] = [
    ...brushLayoutEntries,
    {
      binding: 5,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d" },
    },
    {
      binding: 6,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: "filtering" },
    },
    {
      binding: 7,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "uniform" },
    },
  ];
  engine.grainBrushBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Texturized grain brush bind group layout",
    entries: grainLayoutEntries,
  });
  engine.grainBrushOccupancyBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Texturized grain occupancy brush bind group layout",
    entries: [
      ...grainLayoutEntries,
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  engine.lightGlazeCompositeMipBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Light Glaze composited mip 1 bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  engine.lightGlazeCompositeBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Light Glaze final composite bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  engine.lightGlazeCommitTileBindGroupLayout = engine.device.createBindGroupLayout({
    label: "High precision glaze exact tile commit bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES,
        },
      },
    ],
  });
  engine.paintMipDownsampleBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Paint display mip downsample bind group layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d" },
    }],
  });
  engine.paintStackCompositeMipBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Final raster stack composited mip 1 bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
    ],
  });
  engine.layerCompositeBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Layer source-over fold bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
    ],
  });
  engine.layerBlendFoldBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Advanced layer blend fold bind group layout",
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
          minBindingSize: LAYER_COMPOSITE_UNIFORM_BYTES,
        },
      },
    ],
  });

  rebuildShapeBrushBindGroups(engine);
  rebuildGrainBrushBindGroups(engine);
  // Text/vector/raster-image pipelines are not needed to show the initial
  // raster canvas. They are completed after the editor is interactive.
  await finishStaticResourceCreation(engine, "core");
}

export async function createGrainTextureResources(
  engine: BrushEngine,
  assetId: BrushGrainAssetId,
): Promise<GrainTextureResources> {
  const customAsset = engine.customBrushAssets.resolveGrain(assetId);
  let width: number;
  let height: number;
  let sourceLabel: string;
  let sourceIdentity: number;
  let externalSource: ImageBitmap | HTMLCanvasElement;
  let closeExternalSource: (() => void) | null = null;
  let decodeMs = 0;

  if (customAsset) {
    width = customAsset.width;
    height = customAsset.height;
    sourceLabel = customAsset.name;
    sourceIdentity = hashBytes(customAsset.rgba);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossibile preparare il Grain custom.");
    context.putImageData(
      new ImageData(new Uint8ClampedArray(customAsset.rgba), width, height),
      0,
      0,
    );
    externalSource = canvas;
  } else {
    const asset = grainAssetDescriptor(assetId);
    const response = await fetch(asset.url);
    if (!response.ok) {
      throw new Error(`Impossibile caricare ${asset.sourceFile} (${response.status}).`);
    }
    const source = await response.arrayBuffer();
    const decodeStart = performance.now();
    // Let the browser decode the original RGBA PNG,
    // including its embedded color profile, without premultiplying alpha.
    const bitmap = await createImageBitmap(new Blob([source], { type: "image/png" }), {
      colorSpaceConversion: "default",
      premultiplyAlpha: "none",
    });
    decodeMs = performance.now() - decodeStart;
    if (bitmap.width !== asset.width || bitmap.height !== asset.height) {
      bitmap.close();
      throw new Error(
        `${asset.sourceFile} deve restare ${asset.width}×${asset.height}px; `
        + `trovata ${bitmap.width}×${bitmap.height}px.`,
      );
    }
    width = asset.width;
    height = asset.height;
    sourceLabel = asset.sourceFile;
    sourceIdentity = hashBytes(new Uint8Array(source));
    externalSource = bitmap;
    closeExternalSource = () => bitmap.close();
  }

  const mipLevelCount = mipLevelCountForSize(width, height);
  // Campo scalare a mezza precisione: lo shader di pittura consuma una sola
  // luma e ignora l'alpha, quindi tre canali su quattro erano peso morto.
  const texture = engine.device.createTexture({
    label: `${sourceLabel} scalar R16F grain`,
    size: {
      width,
      height,
      depthOrArrayLayers: 1,
    },
    mipLevelCount,
    format: "r16float",
    usage:
      GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Staging RGBA senza catena mip: esiste solo per il tempo di una passata di
  // conversione e viene distrutto subito, cosi' il picco di carico non porta
  // due catene complete insieme.
  const uploadStart = performance.now();
  const stagingTexture = engine.device.createTexture({
    label: `${sourceLabel} grain RGBA staging`,
    size: { width, height, depthOrArrayLayers: 1 },
    mipLevelCount: 1,
    format: "rgba8unorm",
    // copyExternalImageToTexture esige COPY_DST e RENDER_ATTACHMENT sulla
    // destinazione; TEXTURE_BINDING serve poi alla passata di conversione.
    usage:
      GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  engine.device.queue.copyExternalImageToTexture(
    { source: externalSource },
    { texture: stagingTexture, mipLevel: 0, premultipliedAlpha: false, colorSpace: "srgb" },
    {
      width,
      height,
      depthOrArrayLayers: 1,
    },
  );
  const uploadMs = performance.now() - uploadStart;

  const previewSize = 128;
  const previewSprite = document.createElement("canvas");
  previewSprite.width = previewSize;
  previewSprite.height = previewSize;
  const previewContext = previewSprite.getContext("2d");
  if (previewContext) {
    previewContext.imageSmoothingEnabled = true;
    previewContext.imageSmoothingQuality = "high";
    previewContext.drawImage(externalSource, 0, 0, previewSize, previewSize);
  }
  closeExternalSource?.();

  // Conversione texel a texel della sorgente RGBA nel campo scalare. Gli stessi
  // pesi di luma che il fragment shader di pittura applicava a ogni
  // campionamento, applicati una volta sola qui.
  const lumaShaderModule = engine.device.createShaderModule({
    label: "Grain scalar luma WGSL",
    code: grainLumaShader,
  });
  await assertShaderCompiled(lumaShaderModule, "Grain scalar luma");
  const lumaBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Grain scalar luma bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
    ],
  });
  const lumaPipeline = engine.device.createRenderPipeline({
    label: "Grain scalar luma pipeline",
    layout: engine.device.createPipelineLayout({
      label: "Grain scalar luma pipeline layout",
      bindGroupLayouts: [lumaBindGroupLayout],
    }),
    vertex: { module: lumaShaderModule, entryPoint: "vertexMain" },
    fragment: {
      module: lumaShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: "r16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  const lumaEncoder = engine.device.createCommandEncoder({
    label: "Grain scalar luma encoder",
  });
  const lumaPass = lumaEncoder.beginRenderPass({
    label: "Grain scalar luma mip 0",
    colorAttachments: [
      {
        view: texture.createView({
          label: "Grain scalar luma mip 0 target",
          baseMipLevel: 0,
          mipLevelCount: 1,
        }),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      },
    ],
  });
  lumaPass.setPipeline(lumaPipeline);
  lumaPass.setBindGroup(
    0,
    engine.device.createBindGroup({
      label: "Grain scalar luma bind group",
      layout: lumaBindGroupLayout,
      entries: [{ binding: 0, resource: stagingTexture.createView() }],
    }),
  );
  lumaPass.draw(3, 1, 0, 0);
  lumaPass.end();
  engine.device.queue.submit([lumaEncoder.finish()]);
  await engine.device.queue.onSubmittedWorkDone();
  // Lo staging ha esaurito il suo scopo: fuori subito, prima che la catena mip
  // aggiunga il proprio costo.
  stagingTexture.destroy();

  const mipBuildStart = performance.now();
  const mipShaderModule = engine.device.createShaderModule({
    label: "Grain mip generation WGSL",
    code: grainMipShader,
  });
  await assertShaderCompiled(mipShaderModule, "Grain mip generation");
  const mipBindGroupLayout = engine.device.createBindGroupLayout({
    label: "Grain mip generation bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ],
  });
  const mipPipeline = engine.device.createRenderPipeline({
    label: "Grain mip generation pipeline",
    layout: engine.device.createPipelineLayout({
      label: "Grain mip generation pipeline layout",
      bindGroupLayouts: [mipBindGroupLayout],
    }),
    vertex: { module: mipShaderModule, entryPoint: "vertexMain" },
    fragment: {
      module: mipShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: "r16float" }],
    },
    primitive: { topology: "triangle-list" },
  });
  const mipSampler = engine.device.createSampler({
    label: "Grain mip generation linear sampler",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  const encoder = engine.device.createCommandEncoder({
    label: "Grain full mip chain encoder",
  });
  for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel += 1) {
    const sourceView = texture.createView({
      label: `Grain mip ${mipLevel - 1} source`,
      baseMipLevel: mipLevel - 1,
      mipLevelCount: 1,
    });
    const targetView = texture.createView({
      label: `Grain mip ${mipLevel} target`,
      baseMipLevel: mipLevel,
      mipLevelCount: 1,
    });
    const bindGroup = engine.device.createBindGroup({
      label: `Grain mip ${mipLevel} bind group`,
      layout: mipBindGroupLayout,
      entries: [
        { binding: 0, resource: sourceView },
        { binding: 1, resource: mipSampler },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: `Grain build mip ${mipLevel}`,
      colorAttachments: [
        {
          view: targetView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    pass.setPipeline(mipPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
  engine.device.queue.submit([encoder.finish()]);
  await engine.device.queue.onSubmittedWorkDone();
  const mipBuildMs = performance.now() - mipBuildStart;

  return {
    assetId,
    texture,
    identity: sourceIdentity,
    width,
    height,
    mipLevelCount,
    memoryBytes: r16MipChainBytes(width, height),
    previewSprite,
    decodeMs,
    mipBuildMs,
    uploadMs,
  };
}

export async function createShapeMaskResources(
  engine: BrushEngine,
  assetId: BrushShapeAssetId,
  shapeInvert: boolean,
): Promise<ShapeMaskResources> {
  let baseMask: Uint8Array;
  let decodeStrategy: ShapeMaskDecodeStrategy;
  let authoredInvert = false;
  let polarityAlreadyApplied = false;
  let sourceLabel: string;
  const customAsset = engine.customBrushAssets.resolveShape(assetId);
  if (customAsset) {
    sourceLabel = customAsset.name;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = customAsset.width;
    sourceCanvas.height = customAsset.height;
    const sourceContext = sourceCanvas.getContext("2d");
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = SHAPE_MASK_SIZE;
    maskCanvas.height = SHAPE_MASK_SIZE;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext || !maskContext) {
      throw new Error("Impossibile preparare la Shape custom.");
    }
    sourceContext.putImageData(
      new ImageData(
        new Uint8ClampedArray(customAsset.rgba),
        customAsset.width,
        customAsset.height,
      ),
      0,
      0,
    );
    maskContext.imageSmoothingEnabled = true;
    maskContext.imageSmoothingQuality = "high";
    maskContext.drawImage(sourceCanvas, 0, 0, SHAPE_MASK_SIZE, SHAPE_MASK_SIZE);
    const rgba = maskContext.getImageData(0, 0, SHAPE_MASK_SIZE, SHAPE_MASK_SIZE).data;
    baseMask = new Uint8Array(SHAPE_MASK_SIZE * SHAPE_MASK_SIZE);
    for (
      let pixelIndex = 0, rgbaIndex = 0;
      pixelIndex < baseMask.length;
      pixelIndex += 1, rgbaIndex += 4
    ) {
      const luminance = Math.round(
        rgba[rgbaIndex] * 0.2126
        + rgba[rgbaIndex + 1] * 0.7152
        + rgba[rgbaIndex + 2] * 0.0722,
      );
      const coverageLuminance = shapeInvert ? 255 - luminance : luminance;
      baseMask[pixelIndex] = Math.round(
        (coverageLuminance * rgba[rgbaIndex + 3]) / 255,
      );
    }
    polarityAlreadyApplied = true;
    decodeStrategy = SHAPE_CANVAS_DECODE_STRATEGY;
  } else {
    const asset = shapeAssetDescriptor(assetId);
    sourceLabel = asset.sourceFile;
    authoredInvert = asset.decode.invertLuminance;
    const response = await fetch(asset.url);
    if (!response.ok) {
      throw new Error(`Impossibile caricare ${asset.sourceFile} (${response.status}).`);
    }
    const source = await response.arrayBuffer();
    try {
      const decoded = await decodeGrayscalePng8(source);
      if (decoded.width !== asset.width || decoded.height !== asset.height) {
        throw new Error(
          `${asset.sourceFile} deve restare ${asset.width}×${asset.height}px; `
          + `trovata ${decoded.width}×${decoded.height}px.`,
        );
      }
      baseMask = decoded.pixels;
      decodeStrategy = SHAPE_DIRECT_DECODE_STRATEGY;
    } catch {
      baseMask = await decodeShapeMaskWithCanvas(source, authoredInvert !== shapeInvert);
      decodeStrategy = SHAPE_CANVAS_DECODE_STRATEGY;
      polarityAlreadyApplied = true;
    }
  }

  if (baseMask.length !== SHAPE_MASK_SIZE * SHAPE_MASK_SIZE) {
    throw new Error(
      `${sourceLabel} deve produrre una maschera ${SHAPE_MASK_SIZE}×${SHAPE_MASK_SIZE}.`,
    );
  }
  if (!polarityAlreadyApplied && authoredInvert !== shapeInvert) {
    for (let index = 0; index < baseMask.length; index += 1) {
      baseMask[index] = 255 - baseMask[index];
    }
  }

  const mipLevelCount = Math.log2(SHAPE_MASK_SIZE) + 1;
  const texture = engine.device.createTexture({
    label: "Shape 2K white-times-alpha mask",
    size: {
      width: SHAPE_MASK_SIZE,
      height: SHAPE_MASK_SIZE,
      depthOrArrayLayers: 1,
    },
    mipLevelCount,
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  let levelMask = baseMask;
  let levelSize = SHAPE_MASK_SIZE;
  const occupancyMipMasks: Uint8Array[] = [];
  for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel += 1) {
    if (mipLevel <= SHAPE_OCCUPANCY_MAX_MIP) {
      occupancyMipMasks.push(levelMask);
    }
    const bytesPerRow = Math.ceil(levelSize / 256) * 256;
    let upload = levelMask;
    if (bytesPerRow !== levelSize) {
      upload = new Uint8Array(bytesPerRow * levelSize);
      for (let row = 0; row < levelSize; row += 1) {
        upload.set(levelMask.subarray(row * levelSize, (row + 1) * levelSize), row * bytesPerRow);
      }
    }

    engine.device.queue.writeTexture(
      { texture, mipLevel },
      upload,
      { offset: 0, bytesPerRow, rowsPerImage: levelSize },
      { width: levelSize, height: levelSize, depthOrArrayLayers: 1 },
    );

    if (levelSize === 1) {
      continue;
    }

    const nextSize = levelSize / 2;
    const nextMask = new Uint8Array(nextSize * nextSize);
    for (let y = 0; y < nextSize; y += 1) {
      for (let x = 0; x < nextSize; x += 1) {
        const sourceIndex = y * 2 * levelSize + x * 2;
        nextMask[y * nextSize + x] = Math.round(
          (
            levelMask[sourceIndex]
            + levelMask[sourceIndex + 1]
            + levelMask[sourceIndex + levelSize]
            + levelMask[sourceIndex + levelSize + 1]
          ) / 4,
        );
      }
    }
    levelMask = nextMask;
    levelSize = nextSize;
  }

  const occupancy = buildShapeOccupancyMaps(occupancyMipMasks);
  const previewMask = occupancyMipMasks[SHAPE_OCCUPANCY_MAX_MIP];
  const previewSize = SHAPE_MASK_SIZE >> SHAPE_OCCUPANCY_MAX_MIP;
  const previewSprite = document.createElement("canvas");
  previewSprite.width = previewSize;
  previewSprite.height = previewSize;
  const previewContext = previewSprite.getContext("2d");
  if (previewContext && previewMask) {
    const image = previewContext.createImageData(previewSize, previewSize);
    for (let index = 0; index < previewMask.length; index += 1) {
      const rgbaIndex = index * 4;
      image.data[rgbaIndex] = 255;
      image.data[rgbaIndex + 1] = 255;
      image.data[rgbaIndex + 2] = 255;
      image.data[rgbaIndex + 3] = previewMask[index];
    }
    previewContext.putImageData(image, 0, 0);
  }
  return {
    assetId,
    invert: shapeInvert,
    texture,
    decodeStrategy,
    identity: hashBytes(baseMask),
    occupancyWords: occupancy.words,
    occupancyActiveCells: occupancy.activeCells,
    occupancyCoverageRatios: occupancy.coverageRatios,
    previewSprite,
  };
}

export function destroyShapeMaskResources(resources: ShapeMaskResources | null): void {
  resources?.texture.destroy();
}

export function destroyGrainTextureResources(resources: GrainTextureResources | null): void {
  resources?.texture.destroy();
}

export function applyShapeMaskResources(
  engine: BrushEngine,
  resources: ShapeMaskResources | null,
): void {
  engine.shapeResourceSet = resources;
  engine.shapeMaskTexture = resources?.texture ?? null;
  engine.shapeMaskView = resources
    ? resources.texture.createView({ label: `${resources.assetId} mask view` })
    : engine.shapeMaskPlaceholderView;
  engine.shapeResident = resources !== null;
  engine.shapeLoadedAssetId = resources?.assetId ?? null;
  engine.shapeLoadedInvert = resources?.invert ?? null;
  engine.shapeMaskDecodeStrategy = resources?.decodeStrategy ?? SHAPE_CANVAS_DECODE_STRATEGY;
  engine.shapeMaskIdentity = resources?.identity ?? 0;

  if (resources) {
    engine.shapeOccupancyActiveCells = resources.occupancyActiveCells;
    engine.shapeOccupancyCoverageRatios = resources.occupancyCoverageRatios;
    engine.adaptivePreviewShapeSprite = resources.previewSprite;
    engine.shapeOccupancyUniformBuffers.forEach((buffer, mipLevel) => {
      const wordOffset = mipLevel * SHAPE_OCCUPANCY_WORDS_PER_MAP;
      engine.device.queue.writeBuffer(
        buffer,
        0,
        resources.occupancyWords.subarray(
          wordOffset,
          wordOffset + SHAPE_OCCUPANCY_WORDS_PER_MAP,
        ),
      );
    });
  } else {
    engine.shapeOccupancyActiveCells = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(0);
    engine.shapeOccupancyCoverageRatios = new Array<number>(SHAPE_OCCUPANCY_MAP_COUNT).fill(1);
    engine.adaptivePreviewShapeSprite = null;
  }
  engine.adaptivePreviewShapePalette = [];
  engine.adaptivePreviewShapePaletteKey = "";
  rebuildShapeBrushBindGroups(engine);
  rebuildGrainBrushBindGroups(engine);
  engine.blendRenderer?.setShapeMaskView(engine.shapeMaskView);
  prepareAdaptivePreviewShapePalette(engine, engine.settings);
}

export function applyGrainTextureResources(
  engine: BrushEngine,
  resources: GrainTextureResources | null,
): void {
  engine.grainResourceSet = resources;
  engine.grainTexture = resources?.texture ?? null;
  engine.grainTextureView = resources
    ? resources.texture.createView({ label: `${resources.assetId} full mip view` })
    : engine.grainPlaceholderView;
  engine.grainResident = resources !== null;
  engine.grainLoadedAssetId = resources?.assetId ?? null;
  engine.grainTextureIdentity = resources?.identity ?? 0;
  engine.grainTextureWidth = resources?.width ?? 1;
  engine.grainTextureHeight = resources?.height ?? 1;
  engine.grainTextureMipLevelCount = resources?.mipLevelCount ?? 1;
  engine.grainTextureMemoryBytes = resources?.memoryBytes ?? 0;
  engine.grainPreviewSprite = resources?.previewSprite ?? null;
  engine.grainStartupDecodeMs = resources?.decodeMs ?? 0;
  engine.grainStartupMipBuildMs = resources?.mipBuildMs ?? 0;
  engine.grainStartupUploadMs = resources?.uploadMs ?? 0;
  rebuildGrainBrushBindGroups(engine);
  engine.blendRenderer?.setGrainTextureView(
    engine.grainTextureView,
    engine.grainTextureWidth,
    engine.grainTextureMipLevelCount,
  );
  if (resources && isTexturizedGrainActive(engine.settings)) {
    engine.writeGrainUniforms(engine.settings);
  }
}

export function rebuildGrainBrushBindGroups(engine: BrushEngine): void {
  const grainFilteringModes: GrainFiltering[] = ["no", "classic", "improved"];
  const grainCoordinateModes = ["fixed", "moving"] as const;
  engine.grainBrushBindGroups = Object.fromEntries(
    grainCoordinateModes.map((mode) => [
      mode,
      Object.fromEntries(
        grainFilteringModes.map((filtering) => [
          filtering,
          engine.device.createBindGroup({
            label: `Texturized grain ${mode} brush bind group ${filtering}`,
            layout: engine.grainBrushBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: engine.brushUniformBuffer } },
              { binding: 1, resource: { buffer: engine.instanceBuffer } },
              { binding: 2, resource: engine.shapeMaskView },
              { binding: 3, resource: engine.shapeMaskSampler },
              { binding: 5, resource: engine.grainTextureView },
              { binding: 6, resource: engine.grainSamplers[mode][filtering] },
              { binding: 7, resource: { buffer: engine.grainUniformBuffer } },
            ],
          }),
        ]),
      ) as Record<GrainFiltering, GPUBindGroup>,
    ]),
  ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup>>;
  engine.grainBrushOccupancyBindGroups = Object.fromEntries(
    grainCoordinateModes.map((mode) => [
      mode,
      Object.fromEntries(
        grainFilteringModes.map((filtering) => [
          filtering,
          engine.shapeOccupancyUniformBuffers.map((buffer, mipLevel) => engine.device.createBindGroup({
            label: `Texturized grain ${mode} occupancy bind group ${filtering} mip ${mipLevel}`,
            layout: engine.grainBrushOccupancyBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: engine.brushUniformBuffer } },
              { binding: 1, resource: { buffer: engine.instanceBuffer } },
              { binding: 2, resource: engine.shapeMaskView },
              { binding: 3, resource: engine.shapeMaskSampler },
              { binding: 4, resource: { buffer } },
              { binding: 5, resource: engine.grainTextureView },
              { binding: 6, resource: engine.grainSamplers[mode][filtering] },
              { binding: 7, resource: { buffer: engine.grainUniformBuffer } },
            ],
          })),
        ]),
      ) as Record<GrainFiltering, GPUBindGroup[]>,
    ]),
  ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup[]>>;
  engine.thicknessTailGrainBrushBindGroups = Object.fromEntries(
    grainCoordinateModes.map((mode) => [
      mode,
      Object.fromEntries(
        grainFilteringModes.map((filtering) => [
          filtering,
          engine.device.createBindGroup({
            label: `Predictive thickness tail ${mode} grain bind group ${filtering}`,
            layout: engine.grainBrushBindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: engine.thicknessTailBrushUniformBuffer } },
              { binding: 1, resource: { buffer: engine.thicknessTailInstanceBuffer } },
              { binding: 2, resource: engine.shapeMaskView },
              { binding: 3, resource: engine.shapeMaskSampler },
              { binding: 5, resource: engine.grainTextureView },
              { binding: 6, resource: engine.grainSamplers[mode][filtering] },
              { binding: 7, resource: { buffer: engine.grainUniformBuffer } },
            ],
          }),
        ]),
      ) as Record<GrainFiltering, GPUBindGroup>,
    ]),
  ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup>>;
  engine.thicknessTailGrainBrushOccupancyBindGroups = Object.fromEntries(
    grainCoordinateModes.map((mode) => [
      mode,
      Object.fromEntries(
        grainFilteringModes.map((filtering) => [
          filtering,
          engine.shapeOccupancyUniformBuffers.map((buffer, mipLevel) =>
            engine.device.createBindGroup({
              label:
                `Predictive thickness tail ${mode} grain occupancy ${filtering} mip ${mipLevel}`,
              layout: engine.grainBrushOccupancyBindGroupLayout,
              entries: [
                { binding: 0, resource: { buffer: engine.thicknessTailBrushUniformBuffer } },
                { binding: 1, resource: { buffer: engine.thicknessTailInstanceBuffer } },
                { binding: 2, resource: engine.shapeMaskView },
                { binding: 3, resource: engine.shapeMaskSampler },
                { binding: 4, resource: { buffer } },
                { binding: 5, resource: engine.grainTextureView },
                { binding: 6, resource: engine.grainSamplers[mode][filtering] },
                { binding: 7, resource: { buffer: engine.grainUniformBuffer } },
              ],
            }),
          ),
        ]),
      ) as Record<GrainFiltering, GPUBindGroup[]>,
    ]),
  ) as Record<"fixed" | "moving", Record<GrainFiltering, GPUBindGroup[]>>;
}

export function ensureThicknessTailOverlayResources(engine: BrushEngine, 
  minimumWidth: number,
  minimumHeight: number,
): void {
  const roundedWidth = clamp(
    Math.ceil(Math.max(1, minimumWidth) / THICKNESS_TAIL_TEXTURE_QUANTUM)
      * THICKNESS_TAIL_TEXTURE_QUANTUM,
    THICKNESS_TAIL_TEXTURE_QUANTUM,
    THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  );
  const roundedHeight = clamp(
    Math.ceil(Math.max(1, minimumHeight) / THICKNESS_TAIL_TEXTURE_QUANTUM)
      * THICKNESS_TAIL_TEXTURE_QUANTUM,
    THICKNESS_TAIL_TEXTURE_QUANTUM,
    THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION,
  );
  if (
    engine.thicknessTailTexture
    && engine.thicknessTailView
    && engine.thicknessTailDisplayBindGroup
    && engine.thicknessTailTextureWidth >= roundedWidth
    && engine.thicknessTailTextureHeight >= roundedHeight
  ) {
    return;
  }

  const width = Math.max(engine.thicknessTailTextureWidth, roundedWidth);
  const height = Math.max(engine.thicknessTailTextureHeight, roundedHeight);
  const texture = engine.device.createTexture({
    label: `Predictive thickness tail ${width}×${height} ${engine.layerFormat}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: engine.layerFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView({ label: "Predictive thickness tail view" });
  const displayBindGroup = engine.device.createBindGroup({
    label: "Predictive thickness tail display bind group",
    layout: engine.thicknessTailDisplayBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
      { binding: 1, resource: engine.layerSamplingView },
      { binding: 2, resource: engine.sampler },
      { binding: 3, resource: view },
      { binding: 4, resource: { buffer: engine.thicknessTailDisplayUniformBuffer } },
      { binding: 5, resource: engine.activeLayerDisplayPyramid.samplingView },
      { binding: 6, resource: engine.mergedBelowView() },
      { binding: 7, resource: engine.mergedAboveView() },
      { binding: 8, resource: engine.vectorTextBelowView ?? engine.transparentLayerView },
      { binding: 9, resource: engine.vectorTextAboveView ?? engine.transparentLayerView },
      { binding: 10, resource: engine.activeClippingPrefixView() },
      { binding: 11, resource: engine.activeClippingSuffixView() },
    ],
  });

  const oldTexture = engine.thicknessTailTexture;
  engine.thicknessTailTexture = texture;
  engine.thicknessTailView = view;
  engine.thicknessTailDisplayBindGroup = displayBindGroup;
  engine.thicknessTailTextureWidth = width;
  engine.thicknessTailTextureHeight = height;
  engine.rasterStrokeRenderer?.setThicknessTailView(view);
  engine.rasterBevelRenderer?.setThicknessTailView(view);
  engine.rasterOuterShadowRenderer?.setThicknessTailView(view);
  engine.rasterInnerShadowRenderer?.setThicknessTailView(view);
  engine.rebuildRasterStrokeDisplayBindGroups();
  oldTexture?.destroy();
}

export async function ensureRasterStrokeRenderer(engine: BrushEngine, 
  styleWidth = engine.rasterStrokeStyle.width,
  strokeGeometryActive =
    engine.rasterStrokeStyle.enabled && styleWidth > 0,
): Promise<RasterStrokeRenderer> {
  if (engine.rasterStrokeRenderer) {
    await setRasterStrokeGeometryEnabled(engine, strokeGeometryActive);
    return engine.rasterStrokeRenderer;
  }
  const scratchExtent = rasterStrokeScratchExtentForRenderer(
    strokeGeometryActive,
    styleWidth,
  );
  const renderer = await RasterStrokeRenderer.create({
    device: engine.device,
    documentWidth: LAYER_SIZE,
    documentHeight: LAYER_SIZE,
    layerFormat: engine.layerFormat,
    layerView: engine.layerView,
    lightGlazeUniformBuffer: engine.lightGlazeUniformBuffer,
    thicknessTailUniformBuffer: engine.thicknessTailDisplayUniformBuffer,
    scratchExtent,
    strokeGeometryEnabled: strokeGeometryActive,
    scratchPool: engine.requireEffectsWorkbench().scratchPool,
    bevelBoundingFieldEnabled: engine.bevelBoundingFieldEnabled,
  });
  renderer.setLightGlazeView(engine.lightGlazeView);
  renderer.setThicknessTailView(engine.thicknessTailView);
  renderer.setBevelResources(
    engine.rasterBevelRenderer?.heightView ?? null,
    engine.rasterBevelRenderer?.glossView ?? null,
  );
  if (engine.rasterBevelRenderer) {
    renderer.updateBevelFieldParameters(engine.rasterBevelRenderer.fieldState);
  }
  renderer.updateBevelParameters(engine.rasterBevelStyle);
  renderer.setShadowResources(
    "outer",
    engine.rasterOuterShadowRenderer?.coverageBuffer ?? null,
    engine.rasterOuterShadowRenderer?.compositionUniformBuffer ?? null,
  );
  renderer.setShadowResources(
    "inner",
    engine.rasterInnerShadowRenderer?.coverageBuffer ?? null,
    engine.rasterInnerShadowRenderer?.compositionUniformBuffer ?? null,
  );
  engine.requireEffectsWorkbench().attachStrokeRenderer(renderer);
  engine.rebuildRasterStrokeDisplayBindGroups();
  engine.rasterStrokeMipDownsampleBindGroups = renderer.mipViews
    .slice(0, -1)
    .map((sourceView, sourceMipIndex) => engine.device.createBindGroup({
      label: `Traccia styled logical mip ${sourceMipIndex + 1} to ${sourceMipIndex + 2}`,
      layout: engine.paintMipDownsampleBindGroupLayout,
      entries: [{ binding: 0, resource: sourceView }],
    }));
  engine.rasterStrokeCoverageValid = false;
  engine.rasterStrokeStyledInitialized = false;
  engine.rasterStrokeMipValidThroughLevel = 0;
  engine.rasterStrokeLastEncode = null;
  return renderer;
}

export async function ensureEffectRenderersForRecord(engine: BrushEngine, record: LayerRecord): Promise<void> {
  const requirements = layerEffectRendererRequirements(
    record.strokeStyle,
    normalizeRasterBevelStyle(record.bevelStyle),
    normalizeRasterOuterShadowStyle(record.outerShadowStyle),
    normalizeRasterInnerShadowStyle(record.innerShadowStyle),
    normalizeRasterColorOverlayStyle(record.colorOverlayStyle),
  );
  const scratchPool = engine.requireEffectsWorkbench().scratchPool;
  if (requirements.needsColorOverlayRenderer) {
    scratchPool.declareEffect(RASTER_COLOR_OVERLAY_EFFECT_ID, []);
  } else {
    scratchPool.releaseRequirement(RASTER_COLOR_OVERLAY_EFFECT_ID);
  }
  if (requirements.needsBevelRenderer && !engine.rasterBevelRenderer) {
    await ensureRasterBevelRenderer(engine);
  }
  if (requirements.needsOuterShadowRenderer && !engine.rasterOuterShadowRenderer) {
    await ensureRasterOuterShadowRenderer(engine);
  }
  if (requirements.needsInnerShadowRenderer && !engine.rasterInnerShadowRenderer) {
    await ensureRasterInnerShadowRenderer(engine);
  }
  if (requirements.needsStrokeRenderer) {
    const strokeGeometryActive =
      record.strokeStyle.enabled && record.strokeStyle.width > 0;
    const scratchExtent = rasterStrokeScratchExtentForRenderer(
      strokeGeometryActive,
      requirements.strokeWidth,
    );
    const renderer = await ensureRasterStrokeRenderer(engine, 
      requirements.strokeWidth,
      strokeGeometryActive,
    );
    if (renderer.scratchExtent !== scratchExtent) {
      renderer.resizeScratch(scratchExtent);
    }
  } else if (engine.rasterStrokeRenderer) {
    await setRasterStrokeGeometryEnabled(engine, false);
    if (engine.rasterStrokeRenderer.scratchExtent !== RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT) {
      engine.rasterStrokeRenderer.resizeScratch(RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT);
    }
  }
  engine.rasterOuterShadowRenderer?.updateStyle(record.outerShadowStyle);
  engine.rasterInnerShadowRenderer?.updateStyle(record.innerShadowStyle);
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setShadowResources(
      "outer",
      engine.rasterOuterShadowRenderer?.coverageBuffer ?? null,
      engine.rasterOuterShadowRenderer?.compositionUniformBuffer ?? null,
    );
    engine.rasterStrokeRenderer.setShadowResources(
      "inner",
      engine.rasterInnerShadowRenderer?.coverageBuffer ?? null,
      engine.rasterInnerShadowRenderer?.compositionUniformBuffer ?? null,
    );
  }
}

export function rebuildShapeBrushBindGroups(engine: BrushEngine): void {
  engine.brushBindGroup = engine.device.createBindGroup({
    label: "Brush legacy bind group",
    layout: engine.brushBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.brushUniformBuffer } },
      { binding: 1, resource: { buffer: engine.instanceBuffer } },
      { binding: 2, resource: engine.shapeMaskView },
      { binding: 3, resource: engine.shapeMaskSampler },
    ],
  });
  engine.brushOccupancyBindGroups = engine.shapeOccupancyUniformBuffers.map(
    (buffer, mipLevel) => engine.device.createBindGroup({
      label: `Brush occupancy bind group mip ${mipLevel}`,
      layout: engine.brushOccupancyBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.brushUniformBuffer } },
        { binding: 1, resource: { buffer: engine.instanceBuffer } },
        { binding: 2, resource: engine.shapeMaskView },
        { binding: 3, resource: engine.shapeMaskSampler },
        { binding: 4, resource: { buffer } },
      ],
    }),
  );
  engine.thicknessTailBrushBindGroup = engine.device.createBindGroup({
    label: "Predictive thickness tail brush legacy bind group",
    layout: engine.brushBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: engine.thicknessTailBrushUniformBuffer } },
      { binding: 1, resource: { buffer: engine.thicknessTailInstanceBuffer } },
      { binding: 2, resource: engine.shapeMaskView },
      { binding: 3, resource: engine.shapeMaskSampler },
    ],
  });
  engine.thicknessTailBrushOccupancyBindGroups = engine.shapeOccupancyUniformBuffers.map(
    (buffer, mipLevel) => engine.device.createBindGroup({
      label: `Predictive thickness tail brush occupancy bind group mip ${mipLevel}`,
      layout: engine.brushOccupancyBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: engine.thicknessTailBrushUniformBuffer } },
        { binding: 1, resource: { buffer: engine.thicknessTailInstanceBuffer } },
        { binding: 2, resource: engine.shapeMaskView },
        { binding: 3, resource: engine.shapeMaskSampler },
        { binding: 4, resource: { buffer } },
      ],
    }),
  );
}

export function releaseHeldThicknessStamps(engine: BrushEngine, referenceTimeMs: number, atLift: boolean): void {
  const stroke = engine.activeStroke;
  if (!stroke || !stroke.thicknessTailHoldback) {
    return;
  }

  const held = stroke.heldThicknessStamps;
  let released = 0;
  while (stroke.heldThicknessHead < held.length) {
    const candidate = held[stroke.heldThicknessHead];
    const millisecondsBeforeReference = Math.max(0, referenceTimeMs - candidate.timeMs);
    if (!atLift && millisecondsBeforeReference < THICKNESS_TAPER_WINDOW_MS) {
      break;
    }

    candidate.stamp.radius = atLift
      ? endThicknessRadius(
        candidate.baseRadius,
        candidate.liveThicknessFactor,
        stroke.thicknessSettings.endThickness,
        millisecondsBeforeReference,
      )
      : candidate.baseRadius * candidate.liveThicknessFactor;
    commitThicknessStamp(engine, candidate.stamp, stroke);
    stroke.heldThicknessHead += 1;
    released += 1;
  }

  if (released > 0 && engine.activeStrokeProfile) {
    if (atLift) {
      engine.activeStrokeProfile.thicknessDynamicsReleasedAtLift += released;
    } else {
      engine.activeStrokeProfile.thicknessDynamicsReleasedDuringStroke += released;
    }
  }

  if (stroke.heldThicknessHead === held.length) {
    stroke.heldThicknessStamps = [];
    stroke.heldThicknessHead = 0;
  } else if (stroke.heldThicknessHead >= 1024) {
    stroke.heldThicknessStamps = held.slice(stroke.heldThicknessHead);
    stroke.heldThicknessHead = 0;
  }
}

export async function ensureRasterOuterShadowRenderer(engine: BrushEngine): Promise<RasterShadowRenderer> {
  if (engine.rasterOuterShadowRenderer) {
    return engine.rasterOuterShadowRenderer;
  }
  const renderer = await RasterShadowRenderer.create({
    device: engine.device,
    scratchPool: engine.requireEffectsWorkbench().scratchPool,
    kind: "outer",
    documentWidth: LAYER_SIZE,
    documentHeight: LAYER_SIZE,
    layerView: engine.layerView,
    lightGlazeUniformBuffer: engine.lightGlazeUniformBuffer,
    thicknessTailUniformBuffer: engine.thicknessTailDisplayUniformBuffer,
  });
  try {
    renderer.setLightGlazeView(engine.lightGlazeView);
    renderer.setThicknessTailView(engine.thicknessTailView);
    renderer.updateStyle(engine.rasterOuterShadowStyle);
  } catch (error) {
    renderer.destroy();
    throw error;
  }
  engine.requireEffectsWorkbench().attachOuterShadowRenderer(renderer);
  engine.rasterOuterShadowMatteValid = false;
  engine.rasterOuterShadowSourceMode = null;
  engine.rasterOuterShadowLastEncode = null;
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setShadowResources(
      "outer",
      renderer.coverageBuffer,
      renderer.compositionUniformBuffer,
    );
    engine.rebuildRasterStrokeDisplayBindGroups();
  }
  return renderer;
}

export async function ensureRasterInnerShadowRenderer(engine: BrushEngine): Promise<RasterShadowRenderer> {
  if (engine.rasterInnerShadowRenderer) {
    return engine.rasterInnerShadowRenderer;
  }
  const renderer = await RasterShadowRenderer.create({
    device: engine.device,
    scratchPool: engine.requireEffectsWorkbench().scratchPool,
    kind: "inner",
    documentWidth: LAYER_SIZE,
    documentHeight: LAYER_SIZE,
    layerView: engine.layerView,
    lightGlazeUniformBuffer: engine.lightGlazeUniformBuffer,
    thicknessTailUniformBuffer: engine.thicknessTailDisplayUniformBuffer,
  });
  try {
    renderer.setLightGlazeView(engine.lightGlazeView);
    renderer.setThicknessTailView(engine.thicknessTailView);
    renderer.updateStyle(engine.rasterInnerShadowStyle);
  } catch (error) {
    renderer.destroy();
    throw error;
  }
  engine.requireEffectsWorkbench().attachInnerShadowRenderer(renderer);
  engine.rasterInnerShadowMatteValid = false;
  engine.rasterInnerShadowSourceMode = null;
  engine.rasterInnerShadowLastEncode = null;
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setShadowResources(
      "inner",
      renderer.coverageBuffer,
      renderer.compositionUniformBuffer,
    );
    engine.rebuildRasterStrokeDisplayBindGroups();
  }
  return renderer;
}

export async function ensureRasterBevelRenderer(engine: BrushEngine): Promise<RasterBevelRenderer> {
  if (engine.rasterBevelRenderer) {
    return engine.rasterBevelRenderer;
  }
  const renderer = await RasterBevelRenderer.create({
    device: engine.device,
    documentWidth: LAYER_SIZE,
    documentHeight: LAYER_SIZE,
    layerView: engine.layerView,
    lightGlazeUniformBuffer: engine.lightGlazeUniformBuffer,
    thicknessTailUniformBuffer: engine.thicknessTailDisplayUniformBuffer,
    scratchPool: engine.requireEffectsWorkbench().scratchPool,
    boundingFieldEnabled: engine.bevelBoundingFieldEnabled,
  });
  renderer.setLightGlazeView(engine.lightGlazeView);
  renderer.setThicknessTailView(engine.thicknessTailView);
  renderer.updateStyleResources(engine.rasterBevelStyle);
  engine.requireEffectsWorkbench().attachBevelRenderer(renderer);
  engine.rasterBevelHeightValid = false;
  engine.rasterBevelHeightSourceMode = null;
  engine.rasterBevelLastEncode = null;
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setBevelResources(renderer.heightView, renderer.glossView);
    engine.rasterStrokeRenderer.updateBevelFieldParameters(renderer.fieldState);
    engine.rasterStrokeRenderer.updateBevelParameters(engine.rasterBevelStyle);
    engine.rebuildRasterStrokeDisplayBindGroups();
  }
  return renderer;
}

export function ensurePresentationCacheTexture(engine: BrushEngine): void {
  const width = Math.max(1, engine.canvas.width);
  const height = Math.max(1, engine.canvas.height);
  ensureMixedSceneLinearTexture(engine, width, height);
  if (
    engine.presentationCacheTexture
    && engine.presentationCacheView
    && engine.presentationCacheWidth === width
    && engine.presentationCacheHeight === height
  ) {
    return;
  }

  const oldTexture = engine.presentationCacheTexture;
  const texture = engine.device.createTexture({
    label: `Persistent presentation cache ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: engine.canvasFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  engine.presentationCacheTexture = texture;
  engine.presentationCacheView = texture.createView({ label: "Persistent presentation cache view" });
  engine.presentationCacheWidth = width;
  engine.presentationCacheHeight = height;
  engine.presentationCacheNeedsFullRebuild = true;
  oldTexture?.destroy();
}

export function maybeReleaseIdleShapeResources(engine: BrushEngine): void {
  if (
    !engine.initialized
    || !engine.shapeResident
    || engine.shapeLoadingPromise !== null
    || engine.settings.shape === "shape"
    || engine.activeStroke !== null
    || engine.lightGlazeSession !== null
    || engine.historyBusy
    || engine.pendingStamps.length > 0
    || engine.pendingBlendBatches.length > 0
  ) {
    return;
  }
  const previous = engine.shapeResourceSet;
  applyShapeMaskResources(engine, null);
  destroyShapeMaskResources(previous);
  engine.publishStats();
}

export function maybeReleaseIdleGrainResources(engine: BrushEngine): void {
  if (
    !engine.initialized
    || !engine.grainResident
    || engine.grainLoadingPromise !== null
    || engine.settings.grainMode !== "off"
    || engine.activeStroke !== null
    || engine.lightGlazeSession !== null
    || engine.historyBusy
    || engine.pendingStamps.length > 0
    || engine.pendingBlendBatches.length > 0
  ) {
    return;
  }
  const previous = engine.grainResourceSet;
  applyGrainTextureResources(engine, null);
  destroyGrainTextureResources(previous);
  engine.publishStats();
}

export function maybeReleaseIdleBlendScratch(engine: BrushEngine): void {
  if (
    !engine.initialized
    || usesBlendRenderer(engine.settings)
    || engine.activeStroke !== null
    || engine.historyBusy
    || engine.pendingBlendBatches.length > 0
  ) {
    return;
  }
  if (engine.blendRenderer?.releaseScratch()) {
    engine.publishStats();
  }
}

export function destroyThicknessTailOverlayResources(engine: BrushEngine): void {
  engine.rasterStrokeRenderer?.setThicknessTailView(null);
  engine.rasterBevelRenderer?.setThicknessTailView(null);
  engine.rasterOuterShadowRenderer?.setThicknessTailView(null);
  engine.rasterInnerShadowRenderer?.setThicknessTailView(null);
  engine.rebuildRasterStrokeDisplayBindGroups();
  engine.thicknessTailTexture?.destroy();
  engine.thicknessTailTexture = null;
  engine.thicknessTailView = null;
  engine.thicknessTailDisplayBindGroup = null;
  engine.thicknessTailTextureWidth = 0;
  engine.thicknessTailTextureHeight = 0;
  engine.thicknessTailPresentedRect = null;
}

export function releaseRasterBevelRenderer(engine: BrushEngine): void {
  cancelBevelFieldShrink(engine);
  engine.effectsWorkbench?.releaseBevelRenderer();
  engine.rasterBevelHeightValid = false;
  engine.rasterBevelHeightSourceMode = null;
  engine.rasterBevelLastEncode = null;
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setBevelResources(null, null);
    engine.rasterStrokeRenderer.updateBevelParameters(engine.rasterBevelStyle);
    engine.rebuildRasterStrokeDisplayBindGroups();
  }
}

export function releaseRasterOuterShadowRenderer(engine: BrushEngine): void {
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setShadowResources("outer", null, null);
  }
  engine.effectsWorkbench?.releaseOuterShadowRenderer();
  engine.rasterOuterShadowMatteValid = false;
  engine.rasterOuterShadowSourceMode = null;
  engine.rasterOuterShadowLastEncode = null;
  if (engine.rasterStrokeRenderer) {
    engine.rebuildRasterStrokeDisplayBindGroups();
  }
}

export function releaseRasterInnerShadowRenderer(engine: BrushEngine): void {
  if (engine.rasterStrokeRenderer) {
    engine.rasterStrokeRenderer.setShadowResources("inner", null, null);
  }
  engine.effectsWorkbench?.releaseInnerShadowRenderer();
  engine.rasterInnerShadowMatteValid = false;
  engine.rasterInnerShadowSourceMode = null;
  engine.rasterInnerShadowLastEncode = null;
  if (engine.rasterStrokeRenderer) {
    engine.rebuildRasterStrokeDisplayBindGroups();
  }
}

export function releaseRasterStrokeRenderer(engine: BrushEngine, force = false): void {
  if (engine.layerBlendTileCompositor && !force) {
    // The live document-space compositor uses the same authoritative style
    // shader to materialize only its current tile. Keep the compositor-only
    // renderer resident while any advanced layer mode owns that working set.
    return;
  }
  engine.effectsWorkbench?.releaseStrokeRenderer();
  engine.rasterStrokeDisplayBindGroups.clear();
  engine.rasterStrokeMipDownsampleBindGroups = [];
  engine.rasterStrokeCoverageValid = false;
  engine.rasterStrokeStyledInitialized = false;
  engine.rasterStrokeMipValidThroughLevel = 0;
  engine.rasterStrokePendingComposeRect = null;
  engine.rasterStrokeLastEncode = null;
}

export function destroyTrackedReadbackBuffer(engine: BrushEngine, buffer: GPUBuffer, size: number): void {
  buffer.destroy();
  engine.devReadbackActiveBytes -= size;
  if (engine.devReadbackActiveBytes < 0) {
    engine.devReadbackActiveBytes = 0;
    throw new Error("Contabilità readback GPU negativa.");
  }
}
