import type { BrushEngine } from "./brush-engine";
import { assertShaderCompiled, createRenderPipelineAsync } from "./engine-gpu-utils";
import { initializeVectorMeshFillGpuRenderer } from "./engine-vector-text-runtime";
import {
  MIXED_SCENE_LINEAR_FORMAT,
  mixedSceneRasterSegmentShader,
  mixedSceneShapePreviewShader,
  mixedSceneTextSegmentShader,
} from "./mixed-scene-compositor-shader";
import { ensureMixedScenePresentationResources } from "./mixed-scene-presentation-resources";

const shapePreviewCreationPromises = new WeakMap<BrushEngine, Promise<void>>();
const vectorShapeCreationPromises = new WeakMap<BrushEngine, Promise<void>>();

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

function shapePreviewResourcesReady(engine: BrushEngine): boolean {
  return Boolean(
    engine.mixedScenePresentPipeline
      && engine.mixedSceneClearPipeline
      && engine.mixedSceneBackgroundPipeline
      && engine.mixedSceneRasterSegmentPipeline
      && engine.mixedSceneActiveDisplayPipeline
      && engine.mixedSceneShapePreviewPipeline
      && engine.mixedSceneShapePreviewUniformBuffer
      && engine.mixedSceneShapePreviewBindGroup,
  );
}

function vectorShapeResourcesReady(engine: BrushEngine): boolean {
  return shapePreviewResourcesReady(engine)
    && Boolean(
      engine.mixedSceneTextSegmentPipeline
        && engine.mixedSceneTextSegmentBindGroupLayout
        && engine.mixedSceneTextEncodedCompositePipeline
        && engine.mixedSceneTextEncodedCompositeBindGroupLayout
        && engine.vectorTextGpuFillPipeline
        && engine.vectorTextGpuQualityFillPipeline
        && engine.vectorTextGpuClearPipeline
        && engine.rasterImageMipmapBindGroupLayout
        && engine.rasterImageMipmapPipeline,
    );
}

/**
 * Prepares only the ordered, 16-bit preview path used while a basic shape is
 * being dragged. Text, image, blend, blur and brush-effect programs remain out
 * of this interactive cold path.
 */
export async function ensureMixedSceneShapePreviewResources(
  engine: BrushEngine,
): Promise<void> {
  if (shapePreviewResourcesReady(engine)) return;
  const existing = shapePreviewCreationPromises.get(engine);
  if (existing) {
    await existing;
    if (!shapePreviewResourcesReady(engine)) {
      await ensureMixedSceneShapePreviewResources(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    await ensureMixedScenePresentationResources(engine);
    const presentShaderModule = engine.mixedScenePresentShaderModule;
    const clearShaderModule = engine.mixedSceneClearShaderModule;
    const backgroundBindGroupLayout = engine.mixedSceneBackgroundBindGroupLayout;
    const rasterSegmentBindGroupLayout = engine.mixedSceneRasterSegmentBindGroupLayout;
    if (
      !presentShaderModule
      || !clearShaderModule
      || !backgroundBindGroupLayout
      || !rasterSegmentBindGroupLayout
    ) {
      throw new Error("The shared mixed-scene presentation resources are unavailable.");
    }

    const rasterShaderModule = engine.mixedSceneRasterSegmentShaderModule
      ?? engine.device.createShaderModule({
        label: "Mixed scene raster segment WGSL",
        code: mixedSceneRasterSegmentShader,
      });
    const previewShaderModule = engine.mixedSceneShapePreviewShaderModule
      ?? engine.device.createShaderModule({
        label: "Mixed scene live shape preview WGSL",
        code: mixedSceneShapePreviewShader,
      });
    await Promise.all([
      assertShaderCompiled(rasterShaderModule, "mixed scene raster segment"),
      assertShaderCompiled(previewShaderModule, "mixed scene live shape preview"),
    ]);

    const previewBindGroupLayout = engine.mixedSceneShapePreviewBindGroupLayout
      ?? engine.device.createBindGroupLayout({
        label: "Mixed scene live shape preview bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
      });
    const ownsPreviewUniformBuffer = engine.mixedSceneShapePreviewUniformBuffer === null;
    const previewUniformBuffer = engine.mixedSceneShapePreviewUniformBuffer
      ?? engine.device.createBuffer({
        label: "Mixed scene live shape preview uniforms",
        size: engine.mixedSceneShapePreviewUniformUpload.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    const previewBindGroup = engine.mixedSceneShapePreviewBindGroup
      ?? engine.device.createBindGroup({
        label: "Mixed scene live shape preview bind group",
        layout: previewBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: { buffer: previewUniformBuffer } },
        ],
      });

    let compiledPipelines: readonly GPURenderPipeline[];
    try {
      compiledPipelines = await Promise.all([
      engine.mixedSceneClearPipeline
        ? Promise.resolve(engine.mixedSceneClearPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene partial transparent clear pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene partial transparent clear pipeline layout",
            bindGroupLayouts: [],
          }),
          vertex: { module: clearShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: clearShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneBackgroundPipeline
        ? Promise.resolve(engine.mixedSceneBackgroundPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene document background pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene document background pipeline layout",
            bindGroupLayouts: [backgroundBindGroupLayout],
          }),
          vertex: { module: presentShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: presentShaderModule,
            entryPoint: "backgroundFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneRasterSegmentPipeline
        ? Promise.resolve(engine.mixedSceneRasterSegmentPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene raster segment source-over pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene raster segment pipeline layout",
            bindGroupLayouts: [rasterSegmentBindGroupLayout],
          }),
          vertex: { module: rasterShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: rasterShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active base layer source-over pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene active base layer pipeline layout",
            bindGroupLayouts: [engine.displayBindGroupLayout],
          }),
          vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.displayShaderModule,
            entryPoint: "activeFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneShapePreviewPipeline
        ? Promise.resolve(engine.mixedSceneShapePreviewPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene live shape preview source-over pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene live shape preview pipeline layout",
            bindGroupLayouts: [previewBindGroupLayout],
          }),
          vertex: { module: previewShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: previewShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      ]);
      if (engine.deviceLostError) throw engine.deviceLostError;
    } catch (error) {
      if (ownsPreviewUniformBuffer) previewUniformBuffer.destroy();
      throw error;
    }
    const [
      clearPipeline,
      backgroundPipeline,
      rasterPipeline,
      activePipeline,
      previewPipeline,
    ] = compiledPipelines;
    engine.mixedSceneRasterSegmentShaderModule = rasterShaderModule;
    engine.mixedSceneShapePreviewShaderModule = previewShaderModule;
    engine.mixedSceneShapePreviewBindGroupLayout = previewBindGroupLayout;
    engine.mixedSceneShapePreviewUniformBuffer = previewUniformBuffer;
    engine.mixedSceneShapePreviewBindGroup = previewBindGroup;
    engine.mixedSceneClearPipeline = clearPipeline;
    engine.mixedSceneBackgroundPipeline = backgroundPipeline;
    engine.mixedSceneRasterSegmentPipeline = rasterPipeline;
    engine.mixedSceneActiveDisplayPipeline = activePipeline;
    engine.mixedSceneShapePreviewPipeline = previewPipeline;
  })();
  shapePreviewCreationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (shapePreviewCreationPromises.get(engine) === initialization) {
      shapePreviewCreationPromises.delete(engine);
    }
  }
  if (!shapePreviewResourcesReady(engine)) {
    throw new Error("The mixed-scene shape preview resources are unavailable.");
  }
}

/** Prepares the additional mesh-fill path needed to publish plain SVG shapes. */
export async function ensureMixedSceneVectorShapeResources(
  engine: BrushEngine,
): Promise<void> {
  if (vectorShapeResourcesReady(engine)) return;
  const existing = vectorShapeCreationPromises.get(engine);
  if (existing) {
    await existing;
    if (!vectorShapeResourcesReady(engine)) {
      await ensureMixedSceneVectorShapeResources(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    await ensureMixedSceneShapePreviewResources(engine);
    const textShaderModule = engine.mixedSceneTextSegmentShaderModule
      ?? engine.device.createShaderModule({
        label: "Mixed scene text segment WGSL",
        code: mixedSceneTextSegmentShader,
      });
    await assertShaderCompiled(textShaderModule, "mixed scene text segment");
    const textBindGroupLayout = engine.mixedSceneTextSegmentBindGroupLayout
      ?? engine.device.createBindGroupLayout({
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
    const encodedCompositeBindGroupLayout = engine.mixedSceneTextEncodedCompositeBindGroupLayout
      ?? engine.device.createBindGroupLayout({
        label: "Mixed scene encoded vector composite bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          {
            binding: 7,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "unfilterable-float" },
          },
        ],
      });
    const [textPipeline, encodedCompositePipeline] = await Promise.all([
      engine.mixedSceneTextSegmentPipeline
        ? Promise.resolve(engine.mixedSceneTextSegmentPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene text segment source-over pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene text segment pipeline layout",
            bindGroupLayouts: [textBindGroupLayout],
          }),
          vertex: { module: textShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: textShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneTextEncodedCompositePipeline
        ? Promise.resolve(engine.mixedSceneTextEncodedCompositePipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene encoded vector backdrop composite pipeline",
          layout: engine.device.createPipelineLayout({
            label: "Mixed scene encoded vector backdrop composite pipeline layout",
            bindGroupLayouts: [encodedCompositeBindGroupLayout],
          }),
          vertex: { module: textShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: textShaderModule,
            entryPoint: "encodedCompositeFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
      initializeVectorMeshFillGpuRenderer(engine),
    ]);

    if (engine.deviceLostError) throw engine.deviceLostError;
    engine.mixedSceneTextSegmentShaderModule = textShaderModule;
    engine.mixedSceneTextSegmentBindGroupLayout = textBindGroupLayout;
    engine.mixedSceneTextSegmentPipeline = textPipeline;
    engine.mixedSceneTextEncodedCompositeBindGroupLayout = encodedCompositeBindGroupLayout;
    engine.mixedSceneTextEncodedCompositePipeline = encodedCompositePipeline;
  })();
  vectorShapeCreationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (vectorShapeCreationPromises.get(engine) === initialization) {
      vectorShapeCreationPromises.delete(engine);
    }
  }
  if (!vectorShapeResourcesReady(engine)) {
    throw new Error("The mixed-scene vector shape resources are unavailable.");
  }
}
