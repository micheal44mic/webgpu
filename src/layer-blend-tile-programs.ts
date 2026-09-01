import {
  assertShaderCompiled,
  createRenderPipelineAsync,
} from "./engine-gpu-utils";
import { LAYER_COMPOSITE_UNIFORM_BYTES } from "./engine-limits";
import {
  LAYER_BLEND_FOLD_UNIFORM_BYTES,
  LAYER_BLEND_FOLD_WGSL,
} from "./layer-blend-fold-shader";
import {
  LAYER_BLEND_TILE_MIP_ONE_WGSL,
  LAYER_BLEND_TILE_MIP_UNIFORM_BYTES,
  LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES,
  LAYER_BLEND_TILE_PRESENT_WGSL,
  LAYER_BLEND_PYRAMID_PRESENT_WGSL,
} from "./layer-blend-tile-shader";
import { layerCompositeShader } from "./layer-composite-shader";
import {
  mixedSceneClearShader,
  mixedScenePresentShader,
} from "./mixed-scene-compositor-shader";

export type LayerBlendTileProgramFormat = "rgba8unorm" | "rgba16float";

/**
 * Device-scoped immutable programs used by every layer-blend tile instance.
 * These resources contain no document-sized textures, buffers or bind groups.
 */
export interface LayerBlendTilePrograms {
  readonly format: LayerBlendTileProgramFormat;
  readonly normalLayout: GPUBindGroupLayout;
  readonly advancedLayout: GPUBindGroupLayout;
  readonly presentLayout: GPUBindGroupLayout;
  readonly mipLayout: GPUBindGroupLayout;
  readonly backgroundLayout: GPUBindGroupLayout;
  readonly pyramidLayout: GPUBindGroupLayout;
  readonly normalOverPipeline: GPURenderPipeline;
  readonly normalAtopPipeline: GPURenderPipeline;
  readonly advancedPipeline: GPURenderPipeline;
  readonly documentMaskContributionPipeline: GPURenderPipeline;
  readonly tileClearPipeline: GPURenderPipeline;
  readonly tileBackgroundPipeline: GPURenderPipeline;
  readonly tilePresentPipeline: GPURenderPipeline;
  readonly mipOnePipeline: GPURenderPipeline;
  readonly pyramidPresentPipeline: GPURenderPipeline;
}

const sourceOverBlend: GPUBlendState = {
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
};

const sourceAtopBlend: GPUBlendState = {
  color: {
    operation: "add",
    srcFactor: "dst-alpha",
    dstFactor: "one-minus-src-alpha",
  },
  alpha: {
    operation: "add",
    srcFactor: "zero",
    dstFactor: "one",
  },
};

const programCache = new WeakMap<
  GPUDevice,
  Map<LayerBlendTileProgramFormat, Promise<LayerBlendTilePrograms>>
>();

async function createLayerBlendTilePrograms(
  device: GPUDevice,
  format: LayerBlendTileProgramFormat,
): Promise<LayerBlendTilePrograms> {
  const normalLayout = device.createBindGroupLayout({
    label: "Layer blend tile Normal layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LAYER_COMPOSITE_UNIFORM_BYTES,
        },
      },
    ],
  });
  const advancedLayout = device.createBindGroupLayout({
    label: "Layer blend tile advanced layout",
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
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LAYER_BLEND_FOLD_UNIFORM_BYTES,
        },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 6,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
    ],
  });
  const presentLayout = device.createBindGroupLayout({
    label: "Layer blend tile screen present layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: 96 },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES,
        },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
    ],
  });
  const mipLayout = device.createBindGroupLayout({
    label: "Layer blend tile mip-1 layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: LAYER_BLEND_TILE_MIP_UNIFORM_BYTES,
        },
      },
    ],
  });
  const backgroundLayout = device.createBindGroupLayout({
    label: "Layer blend tile document background layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pyramidLayout = device.createBindGroupLayout({
    label: "Layer blend final pyramid present layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: 96 },
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
    ],
  });

  const layerCompositeShaderModule = device.createShaderModule({
    label: "Layer blend tile Normal WGSL",
    code: layerCompositeShader,
  });
  const layerBlendFoldShaderModule = device.createShaderModule({
    label: "Layer blend tile advanced fold WGSL",
    code: LAYER_BLEND_FOLD_WGSL,
  });
  const clearShaderModule = device.createShaderModule({
    label: "Layer blend tile bounded transparent clear WGSL",
    code: mixedSceneClearShader,
  });
  const backgroundShaderModule = device.createShaderModule({
    label: "Layer blend tile bounded document background WGSL",
    code: mixedScenePresentShader,
  });
  const presentShaderModule = device.createShaderModule({
    label: "Layer blend tile screen present WGSL",
    code: LAYER_BLEND_TILE_PRESENT_WGSL,
  });
  const mipShaderModule = device.createShaderModule({
    label: "Layer blend tile mip-1 WGSL",
    code: LAYER_BLEND_TILE_MIP_ONE_WGSL,
  });
  const pyramidShaderModule = device.createShaderModule({
    label: "Layer blend final pyramid present WGSL",
    code: LAYER_BLEND_PYRAMID_PRESENT_WGSL,
  });
  await Promise.all([
    assertShaderCompiled(layerCompositeShaderModule, "layer blend tile Normal"),
    assertShaderCompiled(layerBlendFoldShaderModule, "layer blend tile advanced fold"),
    assertShaderCompiled(clearShaderModule, "layer blend tile bounded transparent clear"),
    assertShaderCompiled(backgroundShaderModule, "layer blend tile bounded document background"),
    assertShaderCompiled(presentShaderModule, "layer blend tile screen present"),
    assertShaderCompiled(mipShaderModule, "layer blend tile mip 1"),
    assertShaderCompiled(pyramidShaderModule, "layer blend final pyramid present"),
  ]);

  const pipeline = (
    label: string,
    layout: GPUBindGroupLayout,
    module: GPUShaderModule,
    fragmentEntryPoint: string,
    targetFormat: GPUTextureFormat,
    blend?: GPUBlendState,
  ): Promise<GPURenderPipeline> => createRenderPipelineAsync(device, {
    label,
    layout: device.createPipelineLayout({
      label: `${label} pipeline layout`,
      bindGroupLayouts: [layout],
    }),
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: fragmentEntryPoint,
      targets: [{ format: targetFormat, ...(blend ? { blend } : {}) }],
    },
    primitive: { topology: "triangle-list" },
  });

  const pipelineResults = await Promise.allSettled([
    pipeline(
      "Layer blend tile Normal source-over",
      normalLayout,
      layerCompositeShaderModule,
      "fragmentMain",
      format,
      sourceOverBlend,
    ),
    pipeline(
      "Layer blend tile Normal source-atop",
      normalLayout,
      layerCompositeShaderModule,
      "fragmentMain",
      format,
      sourceAtopBlend,
    ),
    pipeline(
      "Layer blend tile advanced fold",
      advancedLayout,
      layerBlendFoldShaderModule,
      "fragmentMain",
      format,
    ),
    pipeline(
      "Layer blend tile document-mask contribution",
      advancedLayout,
      layerBlendFoldShaderModule,
      "documentMaskContributionFragmentMain",
      format,
      sourceOverBlend,
    ),
    createRenderPipelineAsync(device, {
      label: "Layer blend tile bounded transparent clear",
      layout: device.createPipelineLayout({
        label: "Layer blend tile bounded transparent clear pipeline layout",
        bindGroupLayouts: [],
      }),
      vertex: { module: clearShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: clearShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    }),
    createRenderPipelineAsync(device, {
      label: "Layer blend tile bounded document background",
      layout: device.createPipelineLayout({
        label: "Layer blend tile bounded document background pipeline layout",
        bindGroupLayouts: [backgroundLayout],
      }),
      vertex: { module: backgroundShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: backgroundShaderModule,
        entryPoint: "backgroundFragmentMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    }),
    pipeline(
      "Layer blend tile to linear presentation",
      presentLayout,
      presentShaderModule,
      "fragmentMain",
      "rgba16float",
    ),
    pipeline(
      "Layer blend tile exact mip 1",
      mipLayout,
      mipShaderModule,
      "fragmentMain",
      format,
    ),
    pipeline(
      "Layer blend final pyramid to linear presentation",
      pyramidLayout,
      pyramidShaderModule,
      "fragmentMain",
      "rgba16float",
    ),
  ]);
  const pipelineErrors = pipelineResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []);
  if (pipelineErrors.length > 0) {
    throw new AggregateError(pipelineErrors, "Layer blend pipeline creation failed.");
  }
  const pipelines = pipelineResults.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const [
    normalOverPipeline,
    normalAtopPipeline,
    advancedPipeline,
    documentMaskContributionPipeline,
    tileClearPipeline,
    tileBackgroundPipeline,
    tilePresentPipeline,
    mipOnePipeline,
    pyramidPresentPipeline,
  ] = pipelines;

  return {
    format,
    normalLayout,
    advancedLayout,
    presentLayout,
    mipLayout,
    backgroundLayout,
    pyramidLayout,
    normalOverPipeline,
    normalAtopPipeline,
    advancedPipeline,
    documentMaskContributionPipeline,
    tileClearPipeline,
    tileBackgroundPipeline,
    tilePresentPipeline,
    mipOnePipeline,
    pyramidPresentPipeline,
  };
}

/**
 * Compiles and caches only immutable layer-blend programs for one stable device
 * identity and working format. Concurrent callers receive the same promise;
 * a rejected attempt is evicted so a later call can retry.
 */
export function prewarmLayerBlendTilePrograms(
  device: GPUDevice,
  format: LayerBlendTileProgramFormat,
): Promise<LayerBlendTilePrograms> {
  let byFormat = programCache.get(device);
  if (!byFormat) {
    byFormat = new Map();
    programCache.set(device, byFormat);
  }
  const cached = byFormat.get(format);
  if (cached) return cached;

  const creation = createLayerBlendTilePrograms(device, format);
  byFormat.set(format, creation);
  void creation.catch(() => {
    if (byFormat?.get(format) !== creation) return;
    byFormat.delete(format);
    if (byFormat.size === 0) programCache.delete(device);
  });
  return creation;
}
