import { assertShaderCompiled, createRenderPipelineAsync } from "./engine-gpu-utils";
import type { LayerFormat } from "./engine-types";
import { rasterDeformShader } from "./raster-deform-shader";
import {
  RASTER_DEFORM_VERTEX_FLOATS,
  RASTER_TRANSFORM_UNIFORM_BYTES,
} from "./raster-transform-program-abi";
import {
  rasterSelectionTranslateShader,
  rasterTransformMipmapShader,
  rasterTransformShader,
} from "./raster-transform-shader";

export type RasterTransformProgramBundle = "affine" | "deform" | "mip" | "selection";

export type RasterTransformProgramWarmupTarget = "affine" | "deform" | "selection";

/**
 * Device-scoped Transform programs and their immutable binding objects.
 *
 * This cache intentionally owns no document texture or buffer. A Transform
 * transaction can therefore prepare it before a document exists and later
 * adopt the exact same objects when it allocates its per-operation resources.
 */
export interface RasterTransformProgramResources {
  readonly device: GPUDevice;
  readonly format: LayerFormat;
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly selectionMaskBindGroupLayout: GPUBindGroupLayout;
  readonly mipBindGroupLayout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  readonly selectionPipelineLayout: GPUPipelineLayout;
  readonly mipPipelineLayout: GPUPipelineLayout;
  readonly sampler: GPUSampler;
  pipeline: GPURenderPipeline | null;
  selectionPipeline: GPURenderPipeline | null;
  deformPipeline: GPURenderPipeline | null;
  clearPipeline: GPURenderPipeline | null;
  mipPipeline: GPURenderPipeline | null;
  readonly programPromises: Map<RasterTransformProgramBundle, Promise<void>>;
}

type CompiledRasterTransformProgramBundle =
  | { readonly kind: "affine"; readonly pipeline: GPURenderPipeline }
  | {
    readonly kind: "deform";
    readonly deformPipeline: GPURenderPipeline;
    readonly clearPipeline: GPURenderPipeline;
  }
  | { readonly kind: "mip"; readonly pipeline: GPURenderPipeline }
  | { readonly kind: "selection"; readonly pipeline: GPURenderPipeline };

const sharedResources = new WeakMap<
  GPUDevice,
  Map<LayerFormat, Promise<RasterTransformProgramResources>>
>();
interface RasterTransformProgramCompilationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

const programCompilationQueues = new WeakMap<GPUDevice, RasterTransformProgramCompilationQueue>();

function programCompilationQueue(device: GPUDevice): RasterTransformProgramCompilationQueue {
  let queue = programCompilationQueues.get(device);
  if (!queue) {
    let tail: Promise<void> = Promise.resolve();
    queue = {
      run<T>(operation: () => Promise<T>): Promise<T> {
        const result = tail.then(operation);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    programCompilationQueues.set(device, queue);
  }
  return queue;
}

async function createSharedResources(
  device: GPUDevice,
  format: LayerFormat,
): Promise<RasterTransformProgramResources> {
  const bindGroupLayout = device.createBindGroupLayout({
    label: "Native raster Transform bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform", minBindingSize: RASTER_TRANSFORM_UNIFORM_BYTES },
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
  const mipBindGroupLayout = device.createBindGroupLayout({
    label: "Native raster Transform mip bind group layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      texture: { sampleType: "float", viewDimension: "2d" },
    }],
  });
  const selectionMaskBindGroupLayout = device.createBindGroupLayout({
    label: "Native raster Transform selection mask bind group layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: "read-only-storage" },
    }],
  });
  const sampler = device.createSampler({
    label: "Native raster Transform linear sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "nearest",
    maxAnisotropy: 1,
  });
  return {
    device,
    format,
    bindGroupLayout,
    selectionMaskBindGroupLayout,
    mipBindGroupLayout,
    pipelineLayout: device.createPipelineLayout({
      label: "Native raster Transform pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    }),
    selectionPipelineLayout: device.createPipelineLayout({
      label: "Native raster selected-pixel translation pipeline layout",
      bindGroupLayouts: [bindGroupLayout, selectionMaskBindGroupLayout],
    }),
    mipPipelineLayout: device.createPipelineLayout({
      label: "Native raster Transform mip pipeline layout",
      bindGroupLayouts: [mipBindGroupLayout],
    }),
    sampler,
    pipeline: null,
    selectionPipeline: null,
    deformPipeline: null,
    clearPipeline: null,
    mipPipeline: null,
    programPromises: new Map(),
  };
}

function affinePipelineDescriptor(
  shared: RasterTransformProgramResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Transform ${shared.format}`,
    layout: shared.pipelineLayout,
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function deformPipelineDescriptor(
  shared: RasterTransformProgramResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Warp and Perspective ${shared.format}`,
    layout: shared.pipelineLayout,
    vertex: {
      module,
      entryPoint: "deformVertexMain",
      buffers: [{
        arrayStride: RASTER_DEFORM_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" },
          { shaderLocation: 1, offset: 16, format: "float32" },
        ],
      }],
    },
    fragment: {
      module,
      entryPoint: "deformFragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function clearPipelineDescriptor(
  shared: RasterTransformProgramResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Warp dirty clear ${shared.format}`,
    layout: shared.pipelineLayout,
    vertex: { module, entryPoint: "clearVertexMain" },
    fragment: {
      module,
      entryPoint: "clearFragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function mipPipelineDescriptor(
  shared: RasterTransformProgramResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster Transform exact mip ${shared.format}`,
    layout: shared.mipPipelineLayout,
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

function selectionPipelineDescriptor(
  shared: RasterTransformProgramResources,
  module: GPUShaderModule,
): GPURenderPipelineDescriptor {
  return {
    label: `Native raster selected-pixel translation ${shared.format}`,
    layout: shared.selectionPipelineLayout,
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: shared.format }],
    },
    primitive: { topology: "triangle-list" },
  };
}

export function rasterTransformProgramBundleReady(
  shared: RasterTransformProgramResources,
  bundle: RasterTransformProgramBundle,
): boolean {
  if (bundle === "affine") return shared.pipeline !== null;
  if (bundle === "deform") {
    return shared.deformPipeline !== null && shared.clearPipeline !== null;
  }
  if (bundle === "mip") return shared.mipPipeline !== null;
  return shared.selectionPipeline !== null;
}

async function createProgramBundle(
  shared: RasterTransformProgramResources,
  bundle: RasterTransformProgramBundle,
): Promise<void> {
  // Some drivers compile independent async pipelines effectively serially and
  // become less responsive when several cold tools contend at once. Bound the
  // compiler work per device while retaining concurrency inside one bundle.
  const compiled = await programCompilationQueue(shared.device).run(
    async (): Promise<CompiledRasterTransformProgramBundle> => {
      if (bundle === "affine") {
        const module = shared.device.createShaderModule({
          label: "Native raster Transform WGSL",
          code: rasterTransformShader,
        });
        await assertShaderCompiled(module, "Native raster Transform");
        return {
          kind: "affine",
          pipeline: await createRenderPipelineAsync(
            shared.device,
            affinePipelineDescriptor(shared, module),
          ),
        };
      }
      if (bundle === "deform") {
        const module = shared.device.createShaderModule({
          label: "Native raster Warp and Perspective WGSL",
          code: rasterDeformShader,
        });
        await assertShaderCompiled(module, "Native raster Warp and Perspective");
        const [deformPipeline, clearPipeline] = await Promise.all([
          createRenderPipelineAsync(shared.device, deformPipelineDescriptor(shared, module)),
          createRenderPipelineAsync(shared.device, clearPipelineDescriptor(shared, module)),
        ]);
        return { kind: "deform", deformPipeline, clearPipeline };
      }
      if (bundle === "mip") {
        const module = shared.device.createShaderModule({
          label: "Native raster Transform exact mip WGSL",
          code: rasterTransformMipmapShader,
        });
        await assertShaderCompiled(module, "Native raster Transform mip");
        return {
          kind: "mip",
          pipeline: await createRenderPipelineAsync(
            shared.device,
            mipPipelineDescriptor(shared, module),
          ),
        };
      }
      const module = shared.device.createShaderModule({
        label: "Native raster selected-pixel translation WGSL",
        code: rasterSelectionTranslateShader,
      });
      await assertShaderCompiled(module, "Native raster selected-pixel translation");
      return {
        kind: "selection",
        pipeline: await createRenderPipelineAsync(
          shared.device,
          selectionPipelineDescriptor(shared, module),
        ),
      };
    },
  );

  // Publish only after every pipeline in the requested bundle is valid. A
  // rejected compilation therefore leaves the bundle absent and retryable.
  if (compiled.kind === "affine") shared.pipeline = compiled.pipeline;
  else if (compiled.kind === "deform") {
    shared.deformPipeline = compiled.deformPipeline;
    shared.clearPipeline = compiled.clearPipeline;
  } else if (compiled.kind === "mip") shared.mipPipeline = compiled.pipeline;
  else shared.selectionPipeline = compiled.pipeline;
}

export async function ensureRasterTransformProgramBundle(
  shared: RasterTransformProgramResources,
  bundle: RasterTransformProgramBundle,
): Promise<void> {
  if (rasterTransformProgramBundleReady(shared, bundle)) return;
  let promise = shared.programPromises.get(bundle);
  if (!promise) {
    promise = createProgramBundle(shared, bundle);
    shared.programPromises.set(bundle, promise);
  }
  try {
    await promise;
  } catch (error) {
    if (shared.programPromises.get(bundle) === promise) {
      shared.programPromises.delete(bundle);
    }
    throw error;
  }
  if (!rasterTransformProgramBundleReady(shared, bundle)) {
    shared.programPromises.delete(bundle);
    throw new Error(`Raster Transform ${bundle} programs were not published.`);
  }
}

export async function requireRasterTransformProgramResources(
  device: GPUDevice,
  format: LayerFormat,
  bundles: readonly RasterTransformProgramBundle[],
): Promise<RasterTransformProgramResources> {
  let byFormat = sharedResources.get(device);
  byFormat ??= new Map<LayerFormat, Promise<RasterTransformProgramResources>>();
  let promise = byFormat.get(format);
  if (!promise) {
    promise = createSharedResources(device, format);
    byFormat.set(format, promise);
    sharedResources.set(device, byFormat);
  }
  let shared: RasterTransformProgramResources;
  try {
    shared = await promise;
  } catch (error) {
    byFormat.delete(format);
    if (byFormat.size === 0) sharedResources.delete(device);
    throw error;
  }
  for (const bundle of new Set(bundles)) {
    await ensureRasterTransformProgramBundle(shared, bundle);
  }
  return shared;
}

/**
 * Compiles only device-scoped Transform programs. The cache is shared by every
 * raster layer and document using the same device/format pair; no document
 * texture or buffer is allocated here.
 */
export async function prewarmRasterTransformProgramsForDevice(
  device: GPUDevice,
  format: LayerFormat,
  targets: readonly RasterTransformProgramWarmupTarget[] = [
    "affine",
    "deform",
    "selection",
  ],
): Promise<void> {
  const bundles = new Set<RasterTransformProgramBundle>();
  for (const target of targets) {
    bundles.add(target);
    if (target !== "selection") bundles.add("mip");
  }
  await requireRasterTransformProgramResources(device, format, [...bundles]);
}
