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
  texturizedGrainShader,
  thicknessTailDisplayShader,
} from "./shaders";
import { rasterStrokeDisplayShader } from "./stroke-renderer";
import { LAYER_SIZE, MAX_STAMPS_PER_BATCH, VECTOR_TEXT_GPU_MAXIMUM_DRAWS } from "./engine-limits";
import {
  MIXED_SCENE_LINEAR_FORMAT,
  mixedSceneClearShader,
  mixedScenePresentShader,
  mixedSceneRasterSegmentShader,
  mixedSceneTextSegmentShader,
} from "./mixed-scene-compositor-shader";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { vectorTextDisplayShader } from "./vector-text-shader";
import { initializeVectorTextGpuRenderer } from "./engine-vector-text-runtime";
import { VECTOR_TEXT_GPU_UNIFORM_STRIDE } from "./vector-text-gpu-shader";
import { type ActiveStroke, type DirtyRect, type Stamp } from "./engine-stroke-types";
import { paintMipDimensions } from "./engine-geometry";
import { type BrushSettings, type LayerPoint } from "./engine-types";
import { clamp } from "./color";
import { startThicknessFactor } from "./thickness-dynamics";
import { flushClosingLightGlazeSessionBeforeNewStroke } from "./engine-glaze-runtime";
import { truncateRedoHistory } from "./engine-history-runtime";
import { normalizeViewRotation } from "./engine-math";
import {
  canvasOffsetToLayerOffset,
  clientToLayer,
  effectsScratchCanShrinkNow,
  invalidateActiveLayerBake,
} from "./engine-layer-runtime";
import { cloneDryBlendRenderBatch } from "./blend-renderer";
import { type RasterStrokeRect } from "./stroke-core";
import { type MixedSceneVectorKey } from "./mixed-scene-stack";
import { packStampsIntoUpload } from "./engine-stamp-upload";
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

export async function finishStaticResourceCreation(engine: BrushEngine): Promise<void> {
  engine.brushShaderModule = engine.device.createShaderModule({ label: "Brush WGSL", code: brushShader });
  engine.texturizedGrainShaderModule = engine.device.createShaderModule({
    label: "Texturized grain fragment WGSL",
    code: texturizedGrainShader,
  });
  engine.displayShaderModule = engine.device.createShaderModule({ label: "Display WGSL", code: displayShader });
  engine.rasterStrokeDisplayShaderModule = engine.device.createShaderModule({
    label: "Traccia direct LOD 0 and coarse mip display WGSL",
    code: rasterStrokeDisplayShader(
      LAYER_SIZE,
      LAYER_SIZE,
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
  await Promise.all([
    assertShaderCompiled(engine.brushShaderModule, "brush"),
    assertShaderCompiled(engine.texturizedGrainShaderModule, "Texturized grain fragment"),
    assertShaderCompiled(engine.displayShaderModule, "display"),
    assertShaderCompiled(engine.rasterStrokeDisplayShaderModule, "Traccia display"),
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
  engine.lightGlazeClearR8Pipeline = createLightGlazeClearPipeline(
    "Light Glaze R8 stale dirty-region clear pipeline",
    "r8unorm",
  );
  engine.lightGlazeClearRgba16FloatPipeline = createLightGlazeClearPipeline(
    "Uniformed/Intense RGBA16F stale dirty-region clear pipeline",
    "rgba16float",
  );
  const displayPipelineLayout = engine.device.createPipelineLayout({
    label: "Display pipeline layout",
    bindGroupLayouts: [engine.displayBindGroupLayout],
  });

  engine.displayPipeline = engine.device.createRenderPipeline({
    label: "Display pipeline",
    layout: displayPipelineLayout,
    vertex: {
      module: engine.displayShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.displayShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: engine.canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  engine.finalRasterStackDisplayPipeline = engine.device.createRenderPipeline({
    label: "Final raster stack mip display pipeline",
    layout: displayPipelineLayout,
    vertex: {
      module: engine.displayShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.displayShaderModule,
      entryPoint: "finalStackFragmentMain",
      targets: [{ format: engine.canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });

  if (engine.vectorTextPrototypeEnabled) {
    engine.vectorTextDisplayShaderModule = engine.device.createShaderModule({
      label: "Dual viewport vector text mixed-layer display WGSL",
      code: vectorTextDisplayShader,
    });
    engine.mixedSceneRasterSegmentShaderModule = engine.device.createShaderModule({
      label: "Mixed scene raster segment WGSL",
      code: mixedSceneRasterSegmentShader,
    });
    engine.mixedSceneTextSegmentShaderModule = engine.device.createShaderModule({
      label: "Mixed scene text segment WGSL",
      code: mixedSceneTextSegmentShader,
    });
    engine.mixedSceneClearShaderModule = engine.device.createShaderModule({
      label: "Mixed scene partial clear WGSL",
      code: mixedSceneClearShader,
    });
    engine.mixedScenePresentShaderModule = engine.device.createShaderModule({
      label: "Mixed scene checker presentation WGSL",
      code: mixedScenePresentShader,
    });
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
      assertShaderCompiled(engine.mixedSceneClearShaderModule, "mixed scene partial clear"),
      assertShaderCompiled(
        engine.mixedScenePresentShaderModule,
        "mixed scene checker presentation",
      ),
    ]);
    await initializeVectorTextGpuRenderer(engine);
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
      ],
    });
    engine.mixedSceneRasterSegmentBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Mixed scene raster segment bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    engine.mixedSceneTextSegmentBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Mixed scene text segment bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    engine.mixedScenePresentBindGroupLayout = engine.device.createBindGroupLayout({
      label: "Mixed scene presentation bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    const vectorTextPipelineLayout = engine.device.createPipelineLayout({
      label: "Dual viewport vector text mixed-layer display pipeline layout",
      bindGroupLayouts: [engine.vectorTextDisplayBindGroupLayout],
    });
    engine.vectorTextDisplayPipeline = engine.device.createRenderPipeline({
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
    const mixedRasterPipelineLayout = engine.device.createPipelineLayout({
      label: "Mixed scene raster segment pipeline layout",
      bindGroupLayouts: [engine.mixedSceneRasterSegmentBindGroupLayout],
    });
    engine.mixedSceneRasterSegmentPipeline = engine.device.createRenderPipeline({
      label: "Mixed scene raster segment source-over pipeline",
      layout: mixedRasterPipelineLayout,
      vertex: { module: engine.mixedSceneRasterSegmentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneRasterSegmentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mixedTextPipelineLayout = engine.device.createPipelineLayout({
      label: "Mixed scene text segment pipeline layout",
      bindGroupLayouts: [engine.mixedSceneTextSegmentBindGroupLayout],
    });
    engine.mixedSceneTextSegmentPipeline = engine.device.createRenderPipeline({
      label: "Mixed scene text segment source-over pipeline",
      layout: mixedTextPipelineLayout,
      vertex: { module: engine.mixedSceneTextSegmentShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.mixedSceneTextSegmentShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
    engine.mixedSceneClearPipeline = engine.device.createRenderPipeline({
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
    engine.mixedScenePresentPipeline = engine.device.createRenderPipeline({
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
    engine.mixedSceneActiveDisplayPipeline = engine.device.createRenderPipeline({
      label: "Mixed scene active base layer source-over pipeline",
      layout: displayPipelineLayout,
      vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.displayShaderModule,
        entryPoint: "activeFragmentMain",
        targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
      },
      primitive: { topology: "triangle-list" },
    });
  }
  const rasterStrokeDisplayPipelineLayout = engine.device.createPipelineLayout({
    label: "Traccia display pipeline layout",
    bindGroupLayouts: [
      engine.rasterStrokeDisplayScreenBindGroupLayout,
      engine.rasterStrokeDisplaySourceBindGroupLayout,
    ],
  });
  engine.rasterStrokeDisplayPipeline = engine.device.createRenderPipeline({
    label: "Traccia direct LOD 0 and coarse mip display pipeline",
    layout: rasterStrokeDisplayPipelineLayout,
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
  if (engine.vectorTextPrototypeEnabled) {
    engine.mixedSceneActiveRasterStrokeDisplayPipeline = engine.device.createRenderPipeline({
      label: "Mixed scene active Traccia/effects source-over pipeline",
      layout: rasterStrokeDisplayPipelineLayout,
      vertex: { module: engine.rasterStrokeDisplayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.rasterStrokeDisplayShaderModule,
        entryPoint: "activeFragmentMain",
        targets: [{
          format: MIXED_SCENE_LINEAR_FORMAT,
          blend: {
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
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  const thicknessTailDisplayPipelineLayout = engine.device.createPipelineLayout({
    label: "Predictive thickness tail display pipeline layout",
    bindGroupLayouts: [engine.thicknessTailDisplayBindGroupLayout],
  });
  engine.thicknessTailDisplayPipeline = engine.device.createRenderPipeline({
    label: "Predictive thickness tail display pipeline",
    layout: thicknessTailDisplayPipelineLayout,
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
  if (engine.vectorTextPrototypeEnabled) {
    engine.mixedSceneActiveThicknessTailDisplayPipeline = engine.device.createRenderPipeline({
      label: "Mixed scene active thickness tail source-over pipeline",
      layout: thicknessTailDisplayPipelineLayout,
      vertex: { module: engine.thicknessTailDisplayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.thicknessTailDisplayShaderModule,
        entryPoint: "activeFragmentMain",
        targets: [{
          format: MIXED_SCENE_LINEAR_FORMAT,
          blend: {
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
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  const lightGlazeDisplayPipelineLayout = engine.device.createPipelineLayout({
    label: "Light Glaze live display pipeline layout",
    bindGroupLayouts: [engine.lightGlazeDisplayBindGroupLayout],
  });
  engine.lightGlazeDisplayPipeline = engine.device.createRenderPipeline({
    label: "Light Glaze live display pipeline",
    layout: lightGlazeDisplayPipelineLayout,
    vertex: {
      module: engine.lightGlazeDisplayShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: engine.lightGlazeDisplayShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: engine.canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  if (engine.vectorTextPrototypeEnabled) {
    engine.mixedSceneActiveLightGlazeDisplayPipeline = engine.device.createRenderPipeline({
      label: "Mixed scene active Light Glaze source-over pipeline",
      layout: lightGlazeDisplayPipelineLayout,
      vertex: { module: engine.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: engine.lightGlazeDisplayShaderModule,
        entryPoint: "activeFragmentMain",
        targets: [{
          format: MIXED_SCENE_LINEAR_FORMAT,
          blend: {
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
          },
        }],
      },
      primitive: { topology: "triangle-list" },
    });
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
        ? `Build full Traccia styled logical mip ${mipLevel}`
        : `Update Traccia styled logical mip ${mipLevel} dirty rect`,
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
  const generationSettings = stroke.lightGlazeSettings ?? engine.settings;
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
  const seed = (Math.imul(engine.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0;
  const stamp: Stamp = {
    x: point.x,
    y: point.y,
    radius,
    pressure,
    seed,
    directionX,
    directionY,
    historyActionId: stroke.historyActionId,
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
      throw new Error("Impossibile finalizzare gli stamp prima del cambio impostazioni.");
    }
  }
}

export function commitThicknessStamp(engine: BrushEngine, stamp: Stamp, stroke: ActiveStroke): void {
  if (stamp.radius <= 0) {
    return;
  }
  const generationSettings = stroke.lightGlazeSettings ?? engine.settings;
  const jitterReach = stamp.radius * 2 * (
    generationSettings.positionJitterLinear + generationSettings.positionJitterLateral
  );

  if (
    stamp.x + stamp.radius + jitterReach < 0 ||
    stamp.y + stamp.radius + jitterReach < 0 ||
    stamp.x - stamp.radius - jitterReach >= LAYER_SIZE ||
    stamp.y - stamp.radius - jitterReach >= LAYER_SIZE
  ) {
    return;
  }

  if (!stroke.historyCommitted) {
    truncateRedoHistory(engine);
    engine.historyActions.push({ id: stroke.historyActionId, kind: "stroke", layerId: engine.layerStack.active.id });
    engine.historyCursor = engine.historyActions.length;
    stroke.historyCommitted = true;
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
  }

  engine.pendingStamps.push(stamp);
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
      if (!stroke.historyCommitted) {
        truncateRedoHistory(engine);
        engine.historyActions.push({ id: stroke.historyActionId, kind: "stroke", layerId: engine.layerStack.active.id });
        engine.historyCursor = engine.historyActions.length;
        stroke.historyCommitted = true;
        if (engine.activeStrokeProfile) {
          engine.activeStrokeProfile.historyCommittedActions += 1;
        }
      }
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
    engine.historyStateInconsistent = true;
    engine.historyBusy = true;
    engine.invalidateAdaptivePreview();
    engine.publishHistoryState();
    engine.callbacks.onStatus?.(
      `Rendering WebGPU interrotto: ${normalized.message}. Ricarica la pagina.`,
      "error",
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
  const right = Math.min(LAYER_SIZE, Math.ceil(rect.x + rect.width) + margin);
  const bottom = Math.min(LAYER_SIZE, Math.ceil(rect.y + rect.height) + margin);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

export function assertVectorUpdateAllowed(engine: BrushEngine, key: MixedSceneVectorKey): void {
  if (
    !engine.initialized
    || engine.activeStroke !== null
    || engine.lightGlazeSession !== null
    || engine.historyBusy
    || engine.layerSwitchBusy
    || engine.historyStateInconsistent
  ) {
    throw new Error("La modifica vettoriale richiede il motore fermo.");
  }
  if (engine.activeVectorHistoryEdit && engine.activeVectorHistoryEdit.key !== key) {
    throw new Error("Concludi prima la modifica vettoriale corrente.");
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
    || engine.thicknessTailPresentedRect !== null;
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
  if (engine.grainResident || engine.grainLoadingPromise) {
    return;
  }
  void engine.ensureGrainResources().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Grain M1 non disponibile: ${message}`, "error");
  });
}

export function requestShapeLoad(engine: BrushEngine): void {
  if (engine.shapeResident || engine.shapeLoadingPromise) {
    return;
  }
  void engine.ensureShapeResources().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    engine.callbacks.onStatus?.(`Shape 2K non disponibile: ${message}`, "error");
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
  return rasterBevelVisualBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
}

export function rasterBevelInfluenceRect(engine: BrushEngine, 
  rect: DirtyRect | RasterBevelRect | null,
  style: RasterBevelStyle = engine.rasterBevelStyle,
): DirtyRect | null {
  return rasterBevelInfluenceBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
}

export function rasterOuterShadowEffectRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterOuterShadowStyle = engine.rasterOuterShadowStyle,
): DirtyRect | null {
  return rasterOuterShadowVisualBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
}

export function rasterOuterShadowInfluenceRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterOuterShadowStyle = engine.rasterOuterShadowStyle,
): DirtyRect | null {
  return rasterOuterShadowInfluenceBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
}

export function rasterInnerShadowEffectRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterInnerShadowStyle = engine.rasterInnerShadowStyle,
): DirtyRect | null {
  return rasterInnerShadowVisualBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
}

export function rasterInnerShadowInfluenceRect(engine: BrushEngine, 
  rect: DirtyRect | RasterShadowRect | null,
  style: RasterInnerShadowStyle = engine.rasterInnerShadowStyle,
): DirtyRect | null {
  return rasterInnerShadowInfluenceBounds(rect, style, LAYER_SIZE, LAYER_SIZE);
}

export function recordStampGenerationTime(engine: BrushEngine, startTime: number): void {
  if (startTime > 0 && engine.activeStrokeProfile) {
    engine.activeStrokeProfile.stampGenerationMs += performance.now() - startTime;
  }
}

export function bevelFieldTargetBounds(engine: BrushEngine): DirtyRect | null {
  return rasterBevelInfluenceRect(engine, engine.layerContentBounds);
}
