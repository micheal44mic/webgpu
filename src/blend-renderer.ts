import {
  blendBlurDownsampleShader,
  blendBlurHorizontalShader,
  blendBlurReducedHorizontalShader,
  blendBlurReducedVerticalShader,
  blendBlurUpsampleShader,
  blendBlurVerticalShader,
  blendDepositShader,
  blendGatherShader,
  blendPickupShader,
  blendScatterShader,
} from "./blend-shaders";
import {
  DRY_BLEND_CORE_BUILD,
  DRY_BLEND_BLUR_MAX_SUPPORT_PX,
  DRY_BLEND_DEFAULT_SCRATCH_SIZE,
  blendBlurSamplingScale,
  blendBlurSupportRadius,
  blendPaintCoefficient,
  blendStretchCoefficient,
  type BlendRect,
  type DryBlendBatch,
  type DryBlendStep,
} from "./blend-core";
import { shapeLayerForStamp } from "./brush-shape-sequence-core.ts";
import { destructiveGaussianBlurKernel } from "./gaussian-blur-core";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { brushColorLinearRgb } from "./brush-color.ts";
import {
  assertShaderCompiled,
  createComputePipelineAsync,
  createRenderPipelineAsync,
} from "./engine-gpu-utils";
import type { DocumentStorageColorSpace } from "./engine-types";

const BLEND_UNIFORM_BYTES = 192;
const BLEND_MAX_BATCHES_PER_SUBMIT = 256;
// Ring of persistent carrier slots: slot i feeds step i, the step writes i+1.
// The ring only needs to out-size a single submit so read/write never collide.
const BLEND_CARRIER_SLOT_COUNT = 4096;
const BLEND_BLUR_WORKGROUP_SIZE = 64;
const BLEND_BLUR_WEIGHT_VEC4_COUNT = Math.ceil(
  (DRY_BLEND_BLUR_MAX_SUPPORT_PX + 1) / 4,
);
const BLEND_BLUR_UNIFORM_BYTES = 16 + BLEND_BLUR_WEIGHT_VEC4_COUNT * 16;

export const DRY_BLEND_RENDERER_BUILD =
  "dry-blend-webgpu-v9-linear-f32-packed-unorm16-rgba8-srgb-boundaries";

export interface DryBlendRenderSettings {
  size: number;
  shape: "circle" | "shape";
  shapeAssetIds?: readonly string[];
  shapeSequenceMode: "ordered" | "random";
  grainMode: "off" | "texturized" | "moving";
  grainScale: number;
  grainMovement: number;
  grainDepth: number;
  grainBrightness: number;
  grainContrast: number;
  grainInvert: boolean;
  grainFiltering: "no" | "classic" | "improved";
  color: string;
  shapeMaskFormat: "r8unorm" | "r16float";
  hardness: number;
  blendStretch: number;
  blendPaint: number;
  blendBlur: number;
}

export interface DryBlendRenderBatch {
  readonly build: typeof DRY_BLEND_CORE_BUILD;
  readonly stepCount: 1;
  readonly steps: readonly [DryBlendStep];
  readonly empty: boolean;
  readonly readRect: BlendRect;
  readonly writeRect: BlendRect;
}
export interface DryBlendHistoryGeometry {
  readonly build: typeof DRY_BLEND_CORE_BUILD;
  readonly stepCount: 1;
  readonly empty: boolean;
  readonly readRect: BlendRect;
  readonly writeRect: BlendRect;
}

export interface DryBlendGpuCopyRegion {
  readonly buffer: GPUBuffer;
  readonly offsetBytes: number;
  readonly sizeBytes: number;
}

export interface DryBlendHistoryTransfer {
  readonly capture?: DryBlendGpuCopyRegion;
  readonly replay?: DryBlendGpuCopyRegion;
}


export interface DryBlendSubmitResult {
  dirtyRect: BlendRect | null;
  batchCount: number;
  passCount: number;
  scratchAllocated: boolean;
  cpuMs: number;
}

interface DryBlendRendererOptions {
  device: GPUDevice;
  documentWidth: number;
  documentHeight: number;
  layerFormat: GPUTextureFormat;
  documentStorageColorSpace: DocumentStorageColorSpace;
  layerView: GPUTextureView;
  layerSamplingView: GPUTextureView;
  shapeMaskView: GPUTextureView;
  shapeMaskSampler: GPUSampler;
  grainTextureView: GPUTextureView;
  grainTextureWidth: number;
  grainTextureMipLevelCount: number;
  grainSamplers: Record<
    "fixed" | "moving",
    Record<"no" | "classic" | "improved", GPUSampler>
  >;
  scratchSize?: number;
}

export interface DryBlendDocumentTarget {
  documentWidth: number;
  documentHeight: number;
  documentStorageColorSpace: DocumentStorageColorSpace;
  layerView: GPUTextureView;
  layerSamplingView: GPUTextureView;
}

interface ScratchResources {
  stateBuffer: GPUBuffer;
  coverageBuffer: GPUBuffer;
  carrierBuffer: GPUBuffer;
  blur: {
    buffer: GPUBuffer;
    reducedBuffer: GPUBuffer;
    horizontalBindGroup: GPUBindGroup;
    verticalBindGroup: GPUBindGroup;
    downsampleBindGroup: GPUBindGroup;
    reducedHorizontalBindGroup: GPUBindGroup;
    reducedVerticalBindGroup: GPUBindGroup;
    upsampleBindGroup: GPUBindGroup;
  } | null;
  gatherBindGroup: GPUBindGroup;
  pickupBindGroup: GPUBindGroup;
  depositBindGroups: Record<
    "fixed" | "moving",
    Record<"no" | "classic" | "improved", GPUBindGroup>
  >;
  scatterBindGroup: GPUBindGroup;
}

interface BlendShaderModules {
  readonly gather: GPUShaderModule;
  readonly pickup: GPUShaderModule;
  readonly blurHorizontal: GPUShaderModule;
  readonly blurVertical: GPUShaderModule;
  readonly deposit: GPUShaderModule;
  readonly scatter: GPUShaderModule;
  readonly blurDownsample: GPUShaderModule;
  readonly blurReducedHorizontal: GPUShaderModule;
  readonly blurReducedVertical: GPUShaderModule;
  readonly blurUpsample: GPUShaderModule;
}

// Consecutive sweep segments overlap heavily; sharing one gather/scatter pair
// across a group whose united ROI still fits the scratch keeps the per-step
// cost down to two small compute dispatches.
interface BlendStepGroup {
  start: number;
  count: number;
  readRect: BlendRect;
  writeRect: BlendRect;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertDryBlendStorageContract(
  layerFormat: GPUTextureFormat,
  colorSpace: DocumentStorageColorSpace,
): void {
  if (
    colorSpace !== "linear-premultiplied"
    && colorSpace !== "encoded-srgb-premultiplied"
  ) {
    throw new TypeError("Blend received an unsupported document storage color space.");
  }
  if (colorSpace === "encoded-srgb-premultiplied" && layerFormat !== "rgba8unorm") {
    throw new Error("Blend encoded-sRGB storage requires an RGBA8 UNORM layer.");
  }
}

function mergeRects(left: BlendRect | null, right: BlendRect): BlendRect {
  if (!left) {
    return { ...right };
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maximumX = Math.max(left.x + left.width, right.x + right.width);
  const maximumY = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: maximumX - x,
    height: maximumY - y,
  };
}

function cloneRect(rect: BlendRect): BlendRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function cloneDryBlendRenderBatch(batch: DryBlendBatch): DryBlendRenderBatch {
  return {
    build: batch.build,
    stepCount: 1,
    steps: [{ ...batch.steps[0] }],
    empty: batch.empty,
    readRect: cloneRect(batch.readRect),
    writeRect: cloneRect(batch.writeRect),
  };
}

export function compactDryBlendHistoryGeometry(
  batch: DryBlendRenderBatch,
): DryBlendHistoryGeometry {
  return {
    empty: batch.empty,
    build: batch.build,
    stepCount: 1,
    readRect: cloneRect(batch.readRect),
    writeRect: cloneRect(batch.writeRect),
  };
}

function isDryBlendRenderBatch(
  batch: DryBlendRenderBatch | DryBlendHistoryGeometry,
): batch is DryBlendRenderBatch {
  return "steps" in batch;
}

async function assertShaderModules(
  modules: readonly { label: string; module: GPUShaderModule }[],
): Promise<void> {
  await Promise.all(
    modules.map(({ label, module }) => assertShaderCompiled(module, label)),
  );
}

export class DryBlendRenderer {
  static async create(options: DryBlendRendererOptions): Promise<DryBlendRenderer> {
    const renderer = new DryBlendRenderer(options);
    try {
      await renderer.initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  readonly build = DRY_BLEND_RENDERER_BUILD;
  readonly maximumBatchesPerSubmit = BLEND_MAX_BATCHES_PER_SUBMIT;

  private readonly device: GPUDevice;
  private documentWidth: number;
  private documentHeight: number;
  private readonly layerFormat: GPUTextureFormat;
  private documentStorageColorSpace: DocumentStorageColorSpace;
  private layerView: GPUTextureView;
  private layerSamplingView: GPUTextureView;
  private shapeMaskView: GPUTextureView;
  private readonly shapeMaskSampler: GPUSampler;
  private grainTextureView: GPUTextureView;
  private grainTextureWidth: number;
  private grainTextureMipLevelCount: number;
  private readonly grainSamplers: DryBlendRendererOptions["grainSamplers"];
  private readonly scratchSize: number;
  private readonly uniformStride: number;
  private readonly uniformUpload: ArrayBuffer;
  private readonly uniformFloatViews: readonly Float32Array[];
  private readonly uniformUnsignedViews: readonly Uint32Array[];
  private readonly uniformBuffer: GPUBuffer;
  private readonly blurKernelUpload = new ArrayBuffer(BLEND_BLUR_UNIFORM_BYTES);
  private readonly blurKernelFloats = new Float32Array(this.blurKernelUpload);
  private readonly blurKernelUnsigned = new Uint32Array(this.blurKernelUpload);
  private readonly blurKernelBuffer: GPUBuffer;
  private blurKernelRadius = -1;
  private blurSamplingScale = 1;
  private shaderModules!: BlendShaderModules;

  private gatherBindGroupLayout!: GPUBindGroupLayout;
  private blurHorizontalBindGroupLayout!: GPUBindGroupLayout;
  private blurVerticalBindGroupLayout!: GPUBindGroupLayout;
  private pickupBindGroupLayout!: GPUBindGroupLayout;
  private depositBindGroupLayout!: GPUBindGroupLayout;
  private scatterBindGroupLayout!: GPUBindGroupLayout;
  private gatherPipeline!: GPUComputePipeline;
  private blurHorizontalPipeline: GPUComputePipeline | null = null;
  private blurVerticalPipeline: GPUComputePipeline | null = null;
  private blurDownsamplePipeline: GPUComputePipeline | null = null;
  private blurReducedHorizontalPipeline: GPUComputePipeline | null = null;
  private blurReducedVerticalPipeline: GPUComputePipeline | null = null;
  private blurUpsamplePipeline: GPUComputePipeline | null = null;
  private pickupPipeline!: GPUComputePipeline;
  private depositPipelines: Record<
    DryBlendRenderSettings["shape"],
    Record<"off" | "on", GPUComputePipeline | null>
  > = {
    circle: { off: null, on: null },
    shape: { off: null, on: null },
  };
  private scatterPipeline!: GPURenderPipeline;
  private variantPipelineCompilationPromise: Promise<void> | null = null;
  private scratch: ScratchResources | null = null;
  private scratchMaterialized = false;
  private blurScratchMaterialized = false;
  private activeHistoryActionId: number | null = null;
  private carrierCursor = 0;
  private shapeSequenceCursor = 0;
  private carrierValid = false;
  private destroyed = false;

  private constructor(options: DryBlendRendererOptions) {
    assertDryBlendStorageContract(options.layerFormat, options.documentStorageColorSpace);
    this.device = options.device;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.layerFormat = options.layerFormat;
    this.documentStorageColorSpace = options.documentStorageColorSpace;
    this.layerView = options.layerView;
    this.layerSamplingView = options.layerSamplingView;
    this.shapeMaskView = options.shapeMaskView;
    this.shapeMaskSampler = options.shapeMaskSampler;
    this.grainTextureView = options.grainTextureView;
    this.grainTextureWidth = Math.max(1, Math.round(options.grainTextureWidth));
    this.grainTextureMipLevelCount = Math.max(
      1,
      Math.round(options.grainTextureMipLevelCount),
    );
    this.grainSamplers = options.grainSamplers;
    this.scratchSize = options.scratchSize ?? DRY_BLEND_DEFAULT_SCRATCH_SIZE;
    this.uniformStride = Math.ceil(
      BLEND_UNIFORM_BYTES / this.device.limits.minUniformBufferOffsetAlignment,
    ) * this.device.limits.minUniformBufferOffsetAlignment;
    this.uniformUpload = new ArrayBuffer(
      this.uniformStride * BLEND_MAX_BATCHES_PER_SUBMIT,
    );
    this.uniformFloatViews = Array.from(
      { length: BLEND_MAX_BATCHES_PER_SUBMIT },
      (_, index) => new Float32Array(
        this.uniformUpload,
        index * this.uniformStride,
        BLEND_UNIFORM_BYTES / 4,
      ),
    );
    this.uniformUnsignedViews = Array.from(
      { length: BLEND_MAX_BATCHES_PER_SUBMIT },
      (_, index) => new Uint32Array(
        this.uniformUpload,
        index * this.uniformStride,
        BLEND_UNIFORM_BYTES / 4,
      ),
    );
    this.uniformBuffer = this.device.createBuffer({
      label: "Blend dry dynamic uniforms",
      size: this.uniformUpload.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.blurKernelBuffer = this.device.createBuffer({
      label: "Blend local Gaussian kernel",
      size: BLEND_BLUR_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private async initialize(): Promise<void> {
    const dynamicUniformEntry = (
      visibility: GPUShaderStageFlags,
    ): GPUBindGroupLayoutEntry => ({
      binding: 0,
      visibility,
      buffer: {
        type: "uniform",
        hasDynamicOffset: true,
        minBindingSize: BLEND_UNIFORM_BYTES,
      },
    });
    const storageEntry = (
      binding: number,
      visibility: GPUShaderStageFlags,
      readOnly: boolean,
    ): GPUBindGroupLayoutEntry => ({
      binding,
      visibility,
      buffer: { type: readOnly ? "read-only-storage" : "storage" },
    });
    const computeTexture = (
      binding: number,
      viewDimension: GPUTextureViewDimension = "2d",
    ): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      texture: {
        sampleType: "float",
        viewDimension,
        multisampled: false,
      },
    });
    const computeSampler = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      sampler: { type: "filtering" },
    });

    this.gatherBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry gather bind group layout",
      entries: [
        dynamicUniformEntry(GPUShaderStage.COMPUTE),
        computeTexture(1),
        storageEntry(2, GPUShaderStage.COMPUTE, false),
        storageEntry(3, GPUShaderStage.COMPUTE, false),
      ],
    });
    const blurKernelEntry: GPUBindGroupLayoutEntry = {
      binding: 3,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "uniform", minBindingSize: BLEND_BLUR_UNIFORM_BYTES },
    };
    this.blurHorizontalBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend local Gaussian horizontal bind group layout",
      entries: [
        dynamicUniformEntry(GPUShaderStage.COMPUTE),
        storageEntry(1, GPUShaderStage.COMPUTE, true),
        storageEntry(2, GPUShaderStage.COMPUTE, false),
        blurKernelEntry,
      ],
    });
    this.blurVerticalBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend local Gaussian vertical bind group layout",
      entries: [
        dynamicUniformEntry(GPUShaderStage.COMPUTE),
        storageEntry(1, GPUShaderStage.COMPUTE, true),
        storageEntry(2, GPUShaderStage.COMPUTE, false),
        blurKernelEntry,
      ],
    });
    this.pickupBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry pickup bind group layout",
      entries: [
        dynamicUniformEntry(GPUShaderStage.COMPUTE),
        storageEntry(1, GPUShaderStage.COMPUTE, true),
        storageEntry(2, GPUShaderStage.COMPUTE, false),
      ],
    });
    this.depositBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry deposit bind group layout",
      entries: [
        dynamicUniformEntry(GPUShaderStage.COMPUTE),
        storageEntry(1, GPUShaderStage.COMPUTE, false),
        storageEntry(2, GPUShaderStage.COMPUTE, false),
        storageEntry(3, GPUShaderStage.COMPUTE, true),
        computeTexture(4, "2d-array"),
        computeSampler(5),
        computeTexture(6),
        computeSampler(7),
      ],
    });
    this.scatterBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry scatter bind group layout",
      entries: [
        dynamicUniformEntry(GPUShaderStage.FRAGMENT),
        storageEntry(1, GPUShaderStage.FRAGMENT, true),
        storageEntry(2, GPUShaderStage.FRAGMENT, true),
      ],
    });

    const modules = [
      {
        label: "Blend gather",
        module: this.device.createShaderModule({
          label: "Blend gather WGSL",
          code: blendGatherShader,
        }),
      },
      {
        label: "Blend pickup",
        module: this.device.createShaderModule({
          label: "Blend pickup WGSL",
          code: blendPickupShader,
        }),
      },
      {
        label: "Blend Gaussian horizontal",
        module: this.device.createShaderModule({
          label: "Blend Gaussian horizontal WGSL",
          code: blendBlurHorizontalShader,
        }),
      },
      {
        label: "Blend Gaussian vertical",
        module: this.device.createShaderModule({
          label: "Blend Gaussian vertical WGSL",
          code: blendBlurVerticalShader,
        }),
      },
      {
        label: "Blend deposit",
        module: this.device.createShaderModule({
          label: "Blend deposit WGSL",
          code: blendDepositShader,
        }),
      },
      {
        label: "Blend scatter",
        module: this.device.createShaderModule({
          label: "Blend scatter WGSL",
          code: blendScatterShader,
        }),
      },
      {
        label: "Blend Gaussian reduced-grid downsample",
        module: this.device.createShaderModule({
          label: "Blend Gaussian reduced-grid downsample WGSL",
          code: blendBlurDownsampleShader,
        }),
      },
      {
        label: "Blend Gaussian reduced-grid horizontal",
        module: this.device.createShaderModule({
          label: "Blend Gaussian reduced-grid horizontal WGSL",
          code: blendBlurReducedHorizontalShader,
        }),
      },
      {
        label: "Blend Gaussian reduced-grid vertical",
        module: this.device.createShaderModule({
          label: "Blend Gaussian reduced-grid vertical WGSL",
          code: blendBlurReducedVerticalShader,
        }),
      },
      {
        label: "Blend Gaussian reduced-grid restore",
        module: this.device.createShaderModule({
          label: "Blend Gaussian reduced-grid restore WGSL",
          code: blendBlurUpsampleShader,
        }),
      },
    ] as const;
    await assertShaderModules(modules);
    this.shaderModules = {
      gather: modules[0].module,
      pickup: modules[1].module,
      blurHorizontal: modules[2].module,
      blurVertical: modules[3].module,
      deposit: modules[4].module,
      scatter: modules[5].module,
      blurDownsample: modules[6].module,
      blurReducedHorizontal: modules[7].module,
      blurReducedVertical: modules[8].module,
      blurUpsample: modules[9].module,
    };

    const core = await runGpuAllocationTransaction(
      this.device,
      "Invalid WebGPU Blend pipeline",
      async () => {
        const gather = await this.createBlendComputePipeline(
          "Blend dry gather ROI",
          this.gatherBindGroupLayout,
          this.shaderModules.gather,
          "gatherMain",
        );
        const pickup = await this.createBlendComputePipeline(
          "Blend dry 8x8 weighted pigment pickup",
          this.pickupBindGroupLayout,
          this.shaderModules.pickup,
          "pickupMain",
        );
        const scatter = await createRenderPipelineAsync(this.device, {
          label: "Blend dry scatter to canonical layer",
          layout: this.createBlendPipelineLayout(
            "Blend dry scatter pipeline layout",
            this.scatterBindGroupLayout,
          ),
          vertex: {
            module: this.shaderModules.scatter,
            entryPoint: "fullscreenVertex",
          },
          fragment: {
            module: this.shaderModules.scatter,
            entryPoint: "scatterFragment",
            targets: [{ format: this.layerFormat }],
          },
          primitive: { topology: "triangle-list" },
        });
        return { gather, pickup, scatter };
      },
    );
    this.gatherPipeline = core.gather;
    this.pickupPipeline = core.pickup;
    this.scatterPipeline = core.scatter;
  }

  private createBlendPipelineLayout(
    label: string,
    layout: GPUBindGroupLayout,
  ): GPUPipelineLayout {
    return this.device.createPipelineLayout({ label, bindGroupLayouts: [layout] });
  }

  private createBlendComputePipeline(
    label: string,
    layout: GPUBindGroupLayout,
    module: GPUShaderModule,
    entryPoint: string,
    constants?: Record<string, GPUPipelineConstantValue>,
  ): Promise<GPUComputePipeline> {
    return createComputePipelineAsync(this.device, {
      label,
      layout: this.createBlendPipelineLayout(`${label} pipeline layout`, layout),
      compute: { module, entryPoint, constants },
    });
  }

  private createBlendDepositPipeline(
    shape: DryBlendRenderSettings["shape"],
    grain: "off" | "on",
  ): Promise<GPUComputePipeline> {
    return this.createBlendComputePipeline(
      `Blend dry ${shape} ${grain} fused sweep and pigment deposit`,
      this.depositBindGroupLayout,
      this.shaderModules.deposit,
      "depositMain",
      {
        blendCustomShape: shape === "shape" ? 1 : 0,
        blendGrainEnabled: grain === "on" ? 1 : 0,
      },
    );
  }

  selectedVariantPipelinesReady(settings: DryBlendRenderSettings): boolean {
    const grain = settings.grainMode === "off" ? "off" : "on";
    if (!this.depositPipelines[settings.shape][grain]) return false;
    if (settings.blendBlur <= 0) return true;
    if (blendBlurSamplingScale(settings.blendBlur, settings.size) === 1) {
      return Boolean(this.blurHorizontalPipeline && this.blurVerticalPipeline);
    }
    return Boolean(
      this.blurDownsamplePipeline
      && this.blurReducedHorizontalPipeline
      && this.blurReducedVerticalPipeline
      && this.blurUpsamplePipeline
    );
  }

  /** Compiles only the Shape, Grain and blur branches selected by this brush. */
  async ensureVariantPipelines(settings: DryBlendRenderSettings): Promise<void> {
    this.assertAlive();
    if (this.selectedVariantPipelinesReady(settings)) return;
    if (this.variantPipelineCompilationPromise) {
      await this.variantPipelineCompilationPromise;
      await this.ensureVariantPipelines(settings);
      return;
    }

    const shape = settings.shape;
    const grain = settings.grainMode === "off" ? "off" : "on";
    const blurScale = settings.blendBlur > 0
      ? blendBlurSamplingScale(settings.blendBlur, settings.size)
      : 0;
    const initialization = (async (): Promise<void> => {
      const candidates = await runGpuAllocationTransaction(
        this.device,
        "Invalid selected WebGPU Blend pipeline",
        async () => {
          const deposit = this.depositPipelines[shape][grain]
            ?? await this.createBlendDepositPipeline(shape, grain);
          let blurHorizontal = this.blurHorizontalPipeline;
          let blurVertical = this.blurVerticalPipeline;
          let blurDownsample = this.blurDownsamplePipeline;
          let blurReducedHorizontal = this.blurReducedHorizontalPipeline;
          let blurReducedVertical = this.blurReducedVerticalPipeline;
          let blurUpsample = this.blurUpsamplePipeline;
          if (blurScale === 1) {
            blurHorizontal ??= await this.createBlendComputePipeline(
              "Blend local Gaussian horizontal",
              this.blurHorizontalBindGroupLayout,
              this.shaderModules.blurHorizontal,
              "blurHorizontalMain",
            );
            blurVertical ??= await this.createBlendComputePipeline(
              "Blend local Gaussian vertical",
              this.blurVerticalBindGroupLayout,
              this.shaderModules.blurVertical,
              "blurVerticalMain",
            );
          } else if (blurScale > 1) {
            blurDownsample ??= await this.createBlendComputePipeline(
              "Blend local Gaussian reduced-grid downsample",
              this.blurHorizontalBindGroupLayout,
              this.shaderModules.blurDownsample,
              "blurDownsampleMain",
            );
            blurReducedHorizontal ??= await this.createBlendComputePipeline(
              "Blend local Gaussian reduced-grid horizontal",
              this.blurHorizontalBindGroupLayout,
              this.shaderModules.blurReducedHorizontal,
              "blurReducedHorizontalMain",
            );
            blurReducedVertical ??= await this.createBlendComputePipeline(
              "Blend local Gaussian reduced-grid vertical",
              this.blurHorizontalBindGroupLayout,
              this.shaderModules.blurReducedVertical,
              "blurReducedVerticalMain",
            );
            blurUpsample ??= await this.createBlendComputePipeline(
              "Blend local Gaussian reduced-grid restore",
              this.blurHorizontalBindGroupLayout,
              this.shaderModules.blurUpsample,
              "blurUpsampleMain",
            );
          }
          return {
            deposit,
            blurHorizontal,
            blurVertical,
            blurDownsample,
            blurReducedHorizontal,
            blurReducedVertical,
            blurUpsample,
          };
        },
      );
      this.assertAlive();
      this.depositPipelines[shape][grain] = candidates.deposit;
      this.blurHorizontalPipeline = candidates.blurHorizontal;
      this.blurVerticalPipeline = candidates.blurVertical;
      this.blurDownsamplePipeline = candidates.blurDownsample;
      this.blurReducedHorizontalPipeline = candidates.blurReducedHorizontal;
      this.blurReducedVerticalPipeline = candidates.blurReducedVertical;
      this.blurUpsamplePipeline = candidates.blurUpsample;
    })();
    this.variantPipelineCompilationPromise = initialization;
    try {
      await initialization;
    } finally {
      if (this.variantPipelineCompilationPromise === initialization) {
        this.variantPipelineCompilationPromise = null;
      }
    }
  }

  beginStroke(historyActionId: number): void {
    this.assertAlive();
    this.activeHistoryActionId = historyActionId;
    this.carrierCursor = 0;
    this.shapeSequenceCursor = 0;
    this.carrierValid = false;
  }

  submit(
    batches: readonly (DryBlendRenderBatch | DryBlendHistoryGeometry)[],
    settings: DryBlendRenderSettings,
    historyActionId: number,
    clearLayer: boolean,
    historyTransfer: DryBlendHistoryTransfer | null = null,
  ): DryBlendSubmitResult {
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({
      label: "Blend dry frame encoder",
    });
    const result = this.encode(
      encoder,
      batches,
      settings,
      historyActionId,
      clearLayer,
      historyTransfer,
    );
    if (clearLayer || result.batchCount > 0) {
      this.device.queue.submit([encoder.finish()]);
    }
    return {
      ...result,
      cpuMs: performance.now() - startedAt,
    };
  }

  /**
   * Encodes Blend into a caller-owned command buffer. The interactive engine
   * uses this path to place Blend, mip maintenance and presentation in one GPU
   * submission; submit() remains the bounded fallback for multi-chunk replay.
   */
  encode(
    encoder: GPUCommandEncoder,
    batches: readonly (DryBlendRenderBatch | DryBlendHistoryGeometry)[],
    settings: DryBlendRenderSettings,
    historyActionId: number,
    clearLayer: boolean,
    historyTransfer: DryBlendHistoryTransfer | null = null,
  ): DryBlendSubmitResult {
    this.assertAlive();
    if (batches.length > BLEND_MAX_BATCHES_PER_SUBMIT) {
      throw new RangeError(
        `Dry Blend accepts at most ${BLEND_MAX_BATCHES_PER_SUBMIT} batches per submission.`,
      );
    }
    if (this.activeHistoryActionId !== historyActionId) {
      this.beginStroke(historyActionId);
    }
    const startedAt = performance.now();
    const scratch = this.ensureScratchResources();
    const renderable = batches.filter((batch) => !batch.empty);
    for (const batch of renderable) {
      this.validateBatch(batch);
    }
    const groups = this.buildStepGroups(renderable);
    const blurAmount = clamp(settings.blendBlur, 0, 1);
    const blurScratch = blurAmount > 0 && groups.length > 0
      ? this.ensureBlurScratchResources(scratch)
      : null;
    let blurScale = 1;
    if (blurScratch) {
      blurScale = this.updateBlurKernel(blurAmount, settings.size);
    }
    const historyBytes = renderable.length * this.uniformStride;
    if (historyTransfer?.capture && historyTransfer.replay) {
      throw new Error("Blend transfer cannot capture and replay at the same time.");
    }
    if (historyTransfer?.replay) {
      if (historyTransfer.replay.sizeBytes !== historyBytes) {
        throw new Error(
          `Historical Blend payload is ${historyTransfer.replay.sizeBytes} B; expected ${historyBytes} B.`,
        );
      }
    } else {
      if (!renderable.every(isDryBlendRenderBatch)) {
        throw new Error("Blend replay is missing the GPU uniform payload.");
      }
      this.populateUniforms(renderable, groups, settings);
    }
    if (renderable.length > 0 && !historyTransfer?.replay) {
      this.device.queue.writeBuffer(
        this.uniformBuffer,
        0,
        this.uniformUpload,
        0,
        renderable.length * this.uniformStride,
      );
    }

    let passCount = 0;
    let dirtyRect: BlendRect | null = null;
    if (historyTransfer?.replay && historyBytes > 0) {
      encoder.copyBufferToBuffer(
        historyTransfer.replay.buffer,
        historyTransfer.replay.offsetBytes,
        this.uniformBuffer,
        0,
        historyBytes,
      );
    } else if (historyTransfer?.capture && historyBytes > 0) {
      if (historyTransfer.capture.sizeBytes !== historyBytes) {
        throw new Error(
          `Historical Blend destination is ${historyTransfer.capture.sizeBytes} B; `
          + `expected ${historyBytes} B.`,
        );
      }
      encoder.copyBufferToBuffer(
        this.uniformBuffer,
        0,
        historyTransfer.capture.buffer,
        historyTransfer.capture.offsetBytes,
        historyBytes,
      );
    }


    if (clearLayer) {
      const clearPass = encoder.beginRenderPass({
        label: "Blend dry clear canonical layer",
        colorAttachments: [{
          view: this.layerView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      clearPass.end();
      passCount += 1;
    }

    const workgroups = (pixels: number): number => Math.ceil(pixels / 8);
    const blurWorkgroups = (pixels: number): number =>
      Math.ceil(pixels / BLEND_BLUR_WORKGROUP_SIZE);
    // Both Moving and Texturized can cross tile boundaries once Scale is
    // applied. Their corrected coordinate mappings therefore share repeat.
    const grainMode = "fixed" as const;
    const depositPipeline = this.depositPipelines[settings.shape][
      settings.grainMode === "off" ? "off" : "on"
    ];
    if (!depositPipeline) {
      throw new Error("The selected Blend Shape/Grain pipeline is not prepared.");
    }
    const blurHorizontalPipeline = this.blurHorizontalPipeline;
    const blurVerticalPipeline = this.blurVerticalPipeline;
    const blurDownsamplePipeline = this.blurDownsamplePipeline;
    const blurReducedHorizontalPipeline = this.blurReducedHorizontalPipeline;
    const blurReducedVerticalPipeline = this.blurReducedVerticalPipeline;
    const blurUpsamplePipeline = this.blurUpsamplePipeline;
    if (
      blurScratch
      && blurScale === 1
      && (!blurHorizontalPipeline || !blurVerticalPipeline)
    ) {
      throw new Error("The selected full-resolution Blend blur pipeline is not prepared.");
    }
    if (
      blurScratch
      && blurScale > 1
      && (
        !blurDownsamplePipeline
        || !blurReducedHorizontalPipeline
        || !blurReducedVerticalPipeline
        || !blurUpsamplePipeline
      )
    ) {
      throw new Error("The selected reduced-resolution Blend blur pipeline is not prepared.");
    }
    for (const group of groups) {
      const groupOffset = group.start * this.uniformStride;
      const computePass = encoder.beginComputePass({
        label: "Blend dry gather + fused sweep steps",
      });
      computePass.setPipeline(this.gatherPipeline);
      computePass.setBindGroup(0, scratch.gatherBindGroup, [groupOffset]);
      computePass.dispatchWorkgroups(
        workgroups(group.readRect.width),
        workgroups(group.readRect.height),
      );
      if (blurScratch) {
        if (blurScale === 1) {
          computePass.setPipeline(blurHorizontalPipeline!);
          computePass.setBindGroup(0, blurScratch.horizontalBindGroup, [groupOffset]);
          computePass.dispatchWorkgroups(
            blurWorkgroups(group.readRect.width),
            group.readRect.height,
          );
          computePass.setPipeline(blurVerticalPipeline!);
          computePass.setBindGroup(0, blurScratch.verticalBindGroup, [groupOffset]);
          computePass.dispatchWorkgroups(
            blurWorkgroups(group.readRect.height),
            group.readRect.width,
          );
        } else {
          const phaseX = ((group.readRect.x % blurScale) + blurScale) % blurScale;
          const phaseY = ((group.readRect.y % blurScale) + blurScale) % blurScale;
          const reducedWidth = Math.ceil((group.readRect.width + phaseX) / blurScale);
          const reducedHeight = Math.ceil((group.readRect.height + phaseY) / blurScale);
          computePass.setPipeline(blurDownsamplePipeline!);
          computePass.setBindGroup(0, blurScratch.downsampleBindGroup, [groupOffset]);
          computePass.dispatchWorkgroups(workgroups(reducedWidth), workgroups(reducedHeight));
          computePass.setPipeline(blurReducedHorizontalPipeline!);
          computePass.setBindGroup(0, blurScratch.reducedHorizontalBindGroup, [groupOffset]);
          computePass.dispatchWorkgroups(workgroups(reducedWidth), workgroups(reducedHeight));
          computePass.setPipeline(blurReducedVerticalPipeline!);
          computePass.setBindGroup(0, blurScratch.reducedVerticalBindGroup, [groupOffset]);
          computePass.dispatchWorkgroups(workgroups(reducedWidth), workgroups(reducedHeight));
          computePass.setPipeline(blurUpsamplePipeline!);
          computePass.setBindGroup(0, blurScratch.upsampleBindGroup, [groupOffset]);
          computePass.dispatchWorkgroups(
            workgroups(group.readRect.width),
            workgroups(group.readRect.height),
          );
        }
      }
      for (let index = 0; index < group.count; index += 1) {
        const batch = renderable[group.start + index];
        const dynamicOffset = (group.start + index) * this.uniformStride;
        computePass.setPipeline(this.pickupPipeline);
        computePass.setBindGroup(0, scratch.pickupBindGroup, [dynamicOffset]);
        computePass.dispatchWorkgroups(1);
        computePass.setPipeline(depositPipeline);
        computePass.setBindGroup(
          0,
          scratch.depositBindGroups[grainMode][settings.grainFiltering],
          [dynamicOffset],
        );
        computePass.dispatchWorkgroups(
          workgroups(batch.writeRect.width),
          workgroups(batch.writeRect.height),
        );
      }
      computePass.end();

      const scatterPass = encoder.beginRenderPass({
        label: "Blend dry scatter ROI to canonical layer",
        colorAttachments: [{
          view: this.layerView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      scatterPass.setPipeline(this.scatterPipeline);
      scatterPass.setBindGroup(0, scratch.scatterBindGroup, [groupOffset]);
      scatterPass.setScissorRect(
        group.writeRect.x,
        group.writeRect.y,
        group.writeRect.width,
        group.writeRect.height,
      );
      scatterPass.draw(3);
      scatterPass.end();

      passCount += 2;
      dirtyRect = mergeRects(dirtyRect, group.writeRect);
    }

    if (renderable.length > 0) {
      this.carrierValid = true;
    }
    return {
      dirtyRect,
      batchCount: renderable.length,
      passCount,
      scratchAllocated: this.scratch !== null,
      cpuMs: performance.now() - startedAt,
    };
  }

  memoryMiB(): number {
    if (!this.scratch) {
      return 0;
    }
    const pixels = this.scratchSize * this.scratchSize;
    const stateBytes = pixels * 16;
    const coverageBytes = pixels * 4;
    const carrierBytes = BLEND_CARRIER_SLOT_COUNT * 16;
    const reducedSide = Math.ceil((this.scratchSize + 1) / 2);
    const blurBytes = this.scratch.blur
      ? pixels * 8 + reducedSide * reducedSide * 8
      : 0;
    return (
      stateBytes
      + coverageBytes
      + carrierBytes
      + blurBytes
      + this.uniformUpload.byteLength
      + BLEND_BLUR_UNIFORM_BYTES
    )
      / (1024 * 1024);
  }

  allocatedMemoryMiB(): number {
    return this.scratch
      ? this.memoryMiB()
      : (this.uniformUpload.byteLength + BLEND_BLUR_UNIFORM_BYTES) / (1024 * 1024);
  }
  historyUniformBytes(
    batches: readonly DryBlendHistoryGeometry[],
  ): number {
    return batches.filter((batch) => !batch.empty).length * this.uniformStride;
  }


  prewarmScratch(): boolean {
    this.assertAlive();
    const wasAllocated = this.scratch !== null;
    this.ensureScratchResources();
    return !wasAllocated;
  }

  /**
   * Executes the selected Blend pipeline bundle without touching the canonical
   * layer. A zero-flow 1×1 batch still samples the selected Shape/Grain and
   * runs every compute stage, while scatter targets a private texture.
   */
  async prewarmSelectedVariant(settings: DryBlendRenderSettings): Promise<void> {
    this.assertAlive();
    await this.ensureVariantPipelines(settings);
    this.assertAlive();
    const scratch = this.ensureScratchResources();
    const rect: BlendRect = { x: 0, y: 0, width: 1, height: 1 };
    const step: DryBlendStep = {
      fromX: 0.5,
      fromY: 0.5,
      toX: 0.5,
      toY: 0.5,
      dirX: 1,
      dirY: 0,
      distance: 0,
      fromDiameter: 1,
      toDiameter: 1,
      diameter: 1,
      fromHalfWidth: 0.5,
      fromHalfHeight: 0.5,
      toHalfWidth: 0.5,
      toHalfHeight: 0.5,
      fromAngle: 0,
      toAngle: 0,
      angle: 0,
      warpStrength: 0,
      flow: 0,
      spacing: 0,
      arcStart: 0,
      arcEnd: 0,
      speed: 0,
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      maxHalo: 0,
    };
    const batch: DryBlendRenderBatch = {
      build: DRY_BLEND_CORE_BUILD,
      stepCount: 1,
      steps: [step],
      empty: false,
      readRect: rect,
      writeRect: rect,
    };
    const group: BlendStepGroup = {
      start: 0,
      count: 1,
      readRect: rect,
      writeRect: rect,
    };
    const previousCarrierCursor = this.carrierCursor;
    const previousCarrierValid = this.carrierValid;
    const previousShapeSequenceCursor = this.shapeSequenceCursor;
    this.carrierCursor = 0;
    this.shapeSequenceCursor = 0;
    this.carrierValid = false;
    try {
      this.populateUniforms([batch], [group], settings);
    } finally {
      this.carrierCursor = previousCarrierCursor;
      this.carrierValid = previousCarrierValid;
      this.shapeSequenceCursor = previousShapeSequenceCursor;
    }
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformUpload,
      0,
      this.uniformStride,
    );

    const blurScratch = settings.blendBlur > 0
      ? this.ensureBlurScratchResources(scratch)
      : null;
    let blurScale = 1;
    if (blurScratch) {
      blurScale = this.updateBlurKernel(settings.blendBlur, settings.size);
    }
    const target = this.device.createTexture({
      label: "Selected Blend warm-up scatter target",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: this.layerFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const encoder = this.device.createCommandEncoder({
      label: "Prewarm selected Blend variant",
    });
    const materializeScratch = !this.scratchMaterialized;
    const materializeBlur = Boolean(blurScratch) && !this.blurScratchMaterialized;
    if (materializeScratch) {
      encoder.clearBuffer(scratch.stateBuffer);
      encoder.clearBuffer(scratch.coverageBuffer);
      encoder.clearBuffer(scratch.carrierBuffer);
    }
    if (materializeBlur) {
      encoder.clearBuffer(blurScratch!.buffer);
    }

    const computePass = encoder.beginComputePass({
      label: "Warm selected Blend gather, blur, pickup and deposit",
    });
    computePass.setPipeline(this.gatherPipeline);
    computePass.setBindGroup(0, scratch.gatherBindGroup, [0]);
    computePass.dispatchWorkgroups(1, 1, 1);
    if (blurScratch) {
      if (blurScale === 1) {
        computePass.setPipeline(this.blurHorizontalPipeline!);
        computePass.setBindGroup(0, blurScratch.horizontalBindGroup, [0]);
        computePass.dispatchWorkgroups(1, 1, 1);
        computePass.setPipeline(this.blurVerticalPipeline!);
        computePass.setBindGroup(0, blurScratch.verticalBindGroup, [0]);
        computePass.dispatchWorkgroups(1, 1, 1);
      } else {
        computePass.setPipeline(this.blurDownsamplePipeline!);
        computePass.setBindGroup(0, blurScratch.downsampleBindGroup, [0]);
        computePass.dispatchWorkgroups(1, 1, 1);
        computePass.setPipeline(this.blurReducedHorizontalPipeline!);
        computePass.setBindGroup(0, blurScratch.reducedHorizontalBindGroup, [0]);
        computePass.dispatchWorkgroups(1, 1, 1);
        computePass.setPipeline(this.blurReducedVerticalPipeline!);
        computePass.setBindGroup(0, blurScratch.reducedVerticalBindGroup, [0]);
        computePass.dispatchWorkgroups(1, 1, 1);
        computePass.setPipeline(this.blurUpsamplePipeline!);
        computePass.setBindGroup(0, blurScratch.upsampleBindGroup, [0]);
        computePass.dispatchWorkgroups(1, 1, 1);
      }
    }
    computePass.setPipeline(this.pickupPipeline);
    computePass.setBindGroup(0, scratch.pickupBindGroup, [0]);
    computePass.dispatchWorkgroups(1, 1, 1);
    computePass.setPipeline(
      this.depositPipelines[settings.shape][settings.grainMode === "off" ? "off" : "on"]!,
    );
    computePass.setBindGroup(
      0,
      scratch.depositBindGroups.fixed[settings.grainFiltering],
      [0],
    );
    computePass.dispatchWorkgroups(1, 1, 1);
    computePass.end();

    const scatterPass = encoder.beginRenderPass({
      label: "Warm selected Blend scatter on private target",
      colorAttachments: [{
        view: target.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    scatterPass.setPipeline(this.scatterPipeline);
    scatterPass.setBindGroup(0, scratch.scatterBindGroup, [0]);
    scatterPass.draw(3, 1, 0, 0);
    scatterPass.end();

    try {
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      if (materializeScratch) this.scratchMaterialized = true;
      if (materializeBlur) this.blurScratchMaterialized = true;
    } finally {
      target.destroy();
    }
  }

  // Il chiamante garantisce che nessun tratto Blend sia attivo o in coda:
  // il carrier ring vive nello scratch e non sopravvive al rilascio.
  releaseScratch(): boolean {
    if (this.destroyed || !this.scratch) {
      return false;
    }
    this.scratch.stateBuffer.destroy();
    this.scratch.coverageBuffer.destroy();
    this.scratch.carrierBuffer.destroy();
    this.scratch.blur?.buffer.destroy();
    this.scratch.blur?.reducedBuffer.destroy();
    this.scratch = null;
    this.carrierValid = false;
    this.scratchMaterialized = false;
    this.blurScratchMaterialized = false;
    return true;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.uniformBuffer.destroy();
    this.blurKernelBuffer.destroy();
    if (this.scratch) {
      this.scratch.stateBuffer.destroy();
      this.scratch.coverageBuffer.destroy();
      this.scratch.carrierBuffer.destroy();
      this.scratch.blur?.buffer.destroy();
      this.scratch.blur?.reducedBuffer.destroy();
      this.scratch = null;
    }
    this.scratchMaterialized = false;
    this.blurScratchMaterialized = false;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("The dry Blend renderer has already been destroyed.");
    }
  }

  private validateBatch(batch: DryBlendHistoryGeometry): void {
    if (batch.build !== DRY_BLEND_CORE_BUILD || batch.stepCount !== 1) {
      throw new Error("The dry Blend batch is incompatible.");
    }
    const rectValues = [
      batch.readRect.x,
      batch.readRect.y,
      batch.readRect.width,
      batch.readRect.height,
      batch.writeRect.x,
      batch.writeRect.y,
      batch.writeRect.width,
      batch.writeRect.height,
    ];
    if (!rectValues.every(Number.isFinite)) {
      throw new TypeError("Invalid dry Blend rectangle.");
    }
    if (
      batch.readRect.width <= 0
      || batch.readRect.height <= 0
      || batch.readRect.width > this.scratchSize
      || batch.readRect.height > this.scratchSize
    ) {
      throw new RangeError("The dry Blend ROI exceeds the WebGPU scratch area.");
    }
    if (
      batch.writeRect.x < 0
      || batch.writeRect.y < 0
      || batch.writeRect.width <= 0
      || batch.writeRect.height <= 0
      || batch.writeRect.x + batch.writeRect.width > this.documentWidth
      || batch.writeRect.y + batch.writeRect.height > this.documentHeight
    ) {
      throw new RangeError("The Dry Blend dirty rectangle is outside the layer.");
    }
  }

  private buildStepGroups(
    renderable: readonly DryBlendHistoryGeometry[],
  ): BlendStepGroup[] {
    const groups: BlendStepGroup[] = [];
    let current: BlendStepGroup | null = null;
    for (let index = 0; index < renderable.length; index += 1) {
      const batch = renderable[index];
      if (current) {
        const candidate = mergeRects(current.readRect, batch.readRect);
        if (
          candidate.width <= this.scratchSize
          && candidate.height <= this.scratchSize
        ) {
          current.count += 1;
          current.readRect = candidate;
          current.writeRect = mergeRects(current.writeRect, batch.writeRect);
          continue;
        }
        groups.push(current);
      }
      current = {
        start: index,
        count: 1,
        readRect: cloneRect(batch.readRect),
        writeRect: cloneRect(batch.writeRect),
      };
    }
    if (current) {
      groups.push(current);
    }
    return groups;
  }

  private populateUniforms(
    batches: readonly DryBlendRenderBatch[],
    groups: readonly BlendStepGroup[],
    settings: DryBlendRenderSettings,
  ): void {
    const paintColor = brushColorLinearRgb(settings);
    const grainPolarity = settings.grainInvert ? -1 : 1;
    const grainScale = clamp(settings.grainScale, 0.1, 4);
    const grainMode = settings.grainMode === "moving"
      ? 2
      : settings.grainMode === "texturized" ? 1 : 0;
    const filtering = settings.grainFiltering === "no"
      ? 0
      : settings.grainFiltering === "classic" ? 1 : 2;
    const shapeLayerCount = Math.max(1, Math.min(4, settings.shapeAssetIds?.length ?? 1));

    for (const group of groups) {
      for (let member = 0; member < group.count; member += 1) {
        const index = group.start + member;
        const batch = batches[index];
        const step = batch.steps[0];
        const carrierReadSlot = this.carrierCursor;
        const carrierWriteSlot = (this.carrierCursor + 1) % BLEND_CARRIER_SLOT_COUNT;
        this.carrierCursor = carrierWriteSlot;
        const floats = this.uniformFloatViews[index];
        const unsigned = this.uniformUnsignedViews[index];
        floats.fill(0);
        floats[0] = this.documentWidth;
        floats[1] = this.documentHeight;
        floats[2] = group.readRect.x;
        floats[3] = group.readRect.y;
        floats[4] = group.readRect.width;
        floats[5] = group.readRect.height;
        floats[6] = step.fromX;
        floats[7] = step.fromY;
        floats[8] = step.toX;
        floats[9] = step.toY;
        floats[10] = step.fromHalfWidth;
        floats[11] = step.fromHalfHeight;
        floats[12] = step.toHalfWidth;
        floats[13] = step.toHalfHeight;
        floats[14] = step.fromAngle;
        floats[15] = step.toAngle;
        floats[16] = clamp(settings.hardness, 0, 1);
        floats[17] = clamp(step.flow, 0, 1);
        floats[18] = step.spacing;
        floats[19] = step.arcStart;
        floats[20] = step.distance;
        floats[21] = step.diameter;
        floats[22] = clamp(step.warpStrength, 0, 1);
        floats[23] = blendStretchCoefficient(settings.blendStretch);
        floats[24] = 1 / (this.grainTextureWidth * grainScale);
        floats[25] = blendPaintCoefficient(settings.blendPaint);
        floats[26] = clamp(settings.grainDepth, 0, 1);
        floats[27] = clamp(settings.grainBrightness, -1, 1) * grainPolarity;
        floats[28] = (1 + clamp(settings.grainContrast, -1, 1)) * grainPolarity;
        floats[29] = clamp(settings.grainMovement, 0, 1);
        floats[30] = this.grainTextureMipLevelCount;
        floats[31] = clamp(settings.blendBlur, 0, 1);
        floats[32] = paintColor[0];
        floats[33] = paintColor[1];
        floats[34] = paintColor[2];
        floats[35] = 1;
        floats[36] = batch.writeRect.x - group.readRect.x;
        floats[37] = batch.writeRect.y - group.readRect.y;
        floats[38] = batch.writeRect.width;
        floats[39] = batch.writeRect.height;
        // The shape branch is a pipeline constant, leaving options.x available
        // for replay-stable document-space RGBA8 quantization.
        unsigned[40] = (this.activeHistoryActionId ?? 0) >>> 0;
        unsigned[41] = grainMode;
        // Low two bits select filtering; bit 2 activates the explicit 8-bit
        // comparison without changing the resident R16F Shape/Grain fields.
        unsigned[42] = filtering
          | (settings.shapeMaskFormat === "r8unorm" ? 4 : 0)
          | (this.documentStorageColorSpace === "encoded-srgb-premultiplied" ? 8 : 0);
        unsigned[43] = this.carrierValid || index > 0 ? 1 : 0;
        unsigned[44] = carrierReadSlot;
        unsigned[45] = carrierWriteSlot;
        unsigned[46] = this.scratchSize;
        const shapeSequenceSeed = (
          Math.imul(
            ((this.activeHistoryActionId ?? 0) + this.shapeSequenceCursor + 1) >>> 0,
            0x9e3779b1,
          ) ^ 0xa511e9b3
        ) >>> 0;
        unsigned[47] = shapeLayerForStamp(
          settings.shapeSequenceMode,
          this.shapeSequenceCursor,
          shapeSequenceSeed,
          shapeLayerCount,
        );
        this.shapeSequenceCursor += 1;
      }
    }
  }

  private createDepositBindGroups(
    stateBuffer: GPUBuffer,
    coverageBuffer: GPUBuffer,
    carrierBuffer: GPUBuffer,
  ): ScratchResources["depositBindGroups"] {
    const uniformEntry = {
      binding: 0,
      resource: {
        buffer: this.uniformBuffer,
        offset: 0,
        size: BLEND_UNIFORM_BYTES,
      },
    } as const;
    const depositBindGroups = {
      fixed: {} as Record<"no" | "classic" | "improved", GPUBindGroup>,
      moving: {} as Record<"no" | "classic" | "improved", GPUBindGroup>,
    };
    for (const mode of ["fixed", "moving"] as const) {
      for (const filtering of ["no", "classic", "improved"] as const) {
        depositBindGroups[mode][filtering] = this.device.createBindGroup({
          label: `Blend dry deposit ${mode} ${filtering}`,
          layout: this.depositBindGroupLayout,
          entries: [
            uniformEntry,
            { binding: 1, resource: { buffer: stateBuffer } },
            { binding: 2, resource: { buffer: coverageBuffer } },
            { binding: 3, resource: { buffer: carrierBuffer } },
            { binding: 4, resource: this.shapeMaskView },
            { binding: 5, resource: this.shapeMaskSampler },
            { binding: 6, resource: this.grainTextureView },
            { binding: 7, resource: this.grainSamplers[mode][filtering] },
          ],
        });
      }
    }
    return depositBindGroups;
  }

  // Il ciclo di vita del Grain scambia la texture (placeholder ↔ sorgente): i
  // deposit bind group residenti vanno ricostruiti sulla view nuova.
  setGrainTextureView(
    view: GPUTextureView,
    width = this.grainTextureWidth,
    mipLevelCount = this.grainTextureMipLevelCount,
  ): void {
    if (this.destroyed) {
      return;
    }
    const normalizedWidth = Math.max(1, Math.round(width));
    const normalizedMipLevelCount = Math.max(1, Math.round(mipLevelCount));
    const viewChanged = this.grainTextureView !== view;
    this.grainTextureView = view;
    this.grainTextureWidth = normalizedWidth;
    this.grainTextureMipLevelCount = normalizedMipLevelCount;
    if (viewChanged) this.rebuildResidentDepositBindGroups();
  }

  // Idem per la maschera Shape (placeholder ↔ 2K residente).
  setShapeMaskView(view: GPUTextureView): void {
    if (this.destroyed || this.shapeMaskView === view) {
      return;
    }
    this.shapeMaskView = view;
    this.rebuildResidentDepositBindGroups();
  }

  /**
   * Points the renderer at a different paint layer.
   *
   * Blend only ever affects the active layer, so one instance is retargeted rather
   * than one instance per layer — the same shape EffectsWorkbench uses. The
   * carrier is invalidated because it holds pigment picked up from the outgoing
   * layer: seeding the first step of a stroke on the incoming layer with that
   * pigment would silently bleed one layer's colour into another.
   */
  retarget(view: GPUTextureView, samplingView: GPUTextureView): void {
    if (this.destroyed) {
      throw new Error("The Blend renderer has already been destroyed.");
    }
    if (this.layerView === view && this.layerSamplingView === samplingView) {
      return;
    }
    this.layerView = view;
    this.layerSamplingView = samplingView;
    // layerView is read at encode time as a colour attachment, so it needs no
    // rebuild. layerSamplingView is baked into the gather bind group.
    if (this.scratch) {
      this.scratch.gatherBindGroup = this.device.createBindGroup({
        label: "Blend dry gather bind group",
        layout: this.gatherBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: {
              buffer: this.uniformBuffer,
              offset: 0,
              size: BLEND_UNIFORM_BYTES,
            },
          },
          { binding: 1, resource: this.layerSamplingView },
          { binding: 2, resource: { buffer: this.scratch.stateBuffer } },
          { binding: 3, resource: { buffer: this.scratch.coverageBuffer } },
        ],
      });
    }
    this.carrierValid = false;
  }

  /**
   * Rebinds the reusable Blend program bundle to a different document.
   *
   * Unlike retarget(), which only switches the active layer inside one
   * document, this boundary invalidates all document-owned state. Shader
   * modules, bind-group layouts and pipelines remain resident; scratch and its
   * view-dependent bind groups are recreated lazily on the next use.
   *
   * The caller must ensure that no Blend stroke or GPU submission is active.
   */
  reconfigureDocumentTarget(target: DryBlendDocumentTarget): void {
    this.assertAlive();
    const {
      documentWidth,
      documentHeight,
      documentStorageColorSpace,
      layerView,
      layerSamplingView,
    } = target;
    if (
      !Number.isSafeInteger(documentWidth)
      || !Number.isSafeInteger(documentHeight)
      || documentWidth <= 0
      || documentHeight <= 0
    ) {
      throw new RangeError("Blend document dimensions must be positive safe integers.");
    }
    assertDryBlendStorageContract(this.layerFormat, documentStorageColorSpace);

    // Validate first so a rejected target cannot partially detach the current
    // document. releaseScratch() also clears all bind groups that capture the
    // outgoing sampling view.
    this.releaseScratch();
    this.documentWidth = documentWidth;
    this.documentHeight = documentHeight;
    this.documentStorageColorSpace = documentStorageColorSpace;
    this.layerView = layerView;
    this.layerSamplingView = layerSamplingView;
    this.activeHistoryActionId = null;
    this.carrierCursor = 0;
    this.carrierValid = false;
  }

  private rebuildResidentDepositBindGroups(): void {
    if (this.scratch) {
      this.scratch.depositBindGroups = this.createDepositBindGroups(
        this.scratch.stateBuffer,
        this.scratch.coverageBuffer,
        this.scratch.carrierBuffer,
      );
    }
  }

  private updateBlurKernel(amount: number, diameter: number): number {
    const radius = blendBlurSupportRadius(amount, diameter);
    const scale = blendBlurSamplingScale(amount, diameter);
    if (radius === this.blurKernelRadius && scale === this.blurSamplingScale) {
      return scale;
    }
    const kernel = destructiveGaussianBlurKernel(Math.ceil(radius / scale));
    this.blurKernelFloats.fill(0);
    this.blurKernelUnsigned[0] = kernel.radius;
    this.blurKernelUnsigned[1] = scale;
    this.blurKernelUnsigned[2] = radius;
    for (let index = 0; index < kernel.weights.length; index += 1) {
      this.blurKernelFloats[4 + index] = kernel.weights[index];
    }
    this.device.queue.writeBuffer(
      this.blurKernelBuffer,
      0,
      this.blurKernelUpload,
    );
    this.blurKernelRadius = radius;
    this.blurSamplingScale = scale;
    return scale;
  }

  private ensureBlurScratchResources(
    scratch: ScratchResources,
  ): NonNullable<ScratchResources["blur"]> {
    if (scratch.blur) return scratch.blur;
    const blurBufferBytes = this.scratchSize * this.scratchSize * 8;
    const blurBuffer = this.device.createBuffer({
      label: "Blend local Gaussian packed intermediate",
      size: blurBufferBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Keep the reduced-grid ping-pong destination in a distinct allocation.
    // Some WebGPU backends conservatively treat two storage bindings of one
    // buffer as aliasing even when their byte ranges do not overlap.
    const reducedSide = Math.ceil((this.scratchSize + 1) / 2);
    const reducedBufferBytes = reducedSide * reducedSide * 8;
    const reducedBuffer = this.device.createBuffer({
      label: "Blend local Gaussian reduced-grid intermediate",
      size: reducedBufferBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const uniformEntry = {
      binding: 0,
      resource: {
        buffer: this.uniformBuffer,
        offset: 0,
        size: BLEND_UNIFORM_BYTES,
      },
    } as const;
    const kernelEntry = {
      binding: 3,
      resource: {
        buffer: this.blurKernelBuffer,
        offset: 0,
        size: BLEND_BLUR_UNIFORM_BYTES,
      },
    } as const;
    const horizontalBindGroup = this.device.createBindGroup({
      label: "Blend local Gaussian horizontal bind group",
      layout: this.blurHorizontalBindGroupLayout,
      entries: [
        uniformEntry,
        { binding: 1, resource: { buffer: scratch.stateBuffer } },
        { binding: 2, resource: { buffer: blurBuffer } },
        kernelEntry,
      ],
    });
    const verticalBindGroup = this.device.createBindGroup({
      label: "Blend local Gaussian vertical bind group",
      layout: this.blurVerticalBindGroupLayout,
      entries: [
        uniformEntry,
        { binding: 1, resource: { buffer: blurBuffer } },
        { binding: 2, resource: { buffer: scratch.stateBuffer } },
        kernelEntry,
      ],
    });
    const packedRegion = (
      binding: number,
      buffer: GPUBuffer,
      size: number,
    ): GPUBindGroupEntry => ({
      binding,
      resource: { buffer, offset: 0, size },
    });
    const downsampleBindGroup = this.device.createBindGroup({
      label: "Blend local Gaussian reduced-grid downsample bind group",
      layout: this.blurHorizontalBindGroupLayout,
      entries: [
        uniformEntry,
        { binding: 1, resource: { buffer: scratch.stateBuffer } },
        packedRegion(2, blurBuffer, reducedBufferBytes),
        kernelEntry,
      ],
    });
    const reducedHorizontalBindGroup = this.device.createBindGroup({
      label: "Blend local Gaussian reduced-grid horizontal bind group",
      layout: this.blurHorizontalBindGroupLayout,
      entries: [
        uniformEntry,
        packedRegion(1, blurBuffer, reducedBufferBytes),
        packedRegion(2, reducedBuffer, reducedBufferBytes),
        kernelEntry,
      ],
    });
    const reducedVerticalBindGroup = this.device.createBindGroup({
      label: "Blend local Gaussian reduced-grid vertical bind group",
      layout: this.blurHorizontalBindGroupLayout,
      entries: [
        uniformEntry,
        packedRegion(1, reducedBuffer, reducedBufferBytes),
        packedRegion(2, blurBuffer, reducedBufferBytes),
        kernelEntry,
      ],
    });
    const upsampleBindGroup = this.device.createBindGroup({
      label: "Blend local Gaussian reduced-grid restore bind group",
      layout: this.blurHorizontalBindGroupLayout,
      entries: [
        uniformEntry,
        packedRegion(1, blurBuffer, reducedBufferBytes),
        { binding: 2, resource: { buffer: scratch.stateBuffer } },
        kernelEntry,
      ],
    });
    scratch.blur = {
      buffer: blurBuffer,
      reducedBuffer,
      horizontalBindGroup,
      verticalBindGroup,
      downsampleBindGroup,
      reducedHorizontalBindGroup,
      reducedVerticalBindGroup,
      upsampleBindGroup,
    };
    return scratch.blur;
  }

  private ensureScratchResources(): ScratchResources {
    if (this.scratch) {
      return this.scratch;
    }
    const pixels = this.scratchSize * this.scratchSize;
    const stateBuffer = this.device.createBuffer({
      label: "Blend dry scratch state",
      size: pixels * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const coverageBuffer = this.device.createBuffer({
      label: "Blend dry union coverage",
      size: pixels * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const carrierBuffer = this.device.createBuffer({
      label: "Blend dry carrier ring",
      size: BLEND_CARRIER_SLOT_COUNT * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const uniformEntry = {
      binding: 0,
      resource: {
        buffer: this.uniformBuffer,
        offset: 0,
        size: BLEND_UNIFORM_BYTES,
      },
    } as const;
    const bufferEntry = (binding: number, buffer: GPUBuffer) => ({
      binding,
      resource: { buffer },
    });
    const gatherBindGroup = this.device.createBindGroup({
      label: "Blend dry gather bind group",
      layout: this.gatherBindGroupLayout,
      entries: [
        uniformEntry,
        { binding: 1, resource: this.layerSamplingView },
        bufferEntry(2, stateBuffer),
        bufferEntry(3, coverageBuffer),
      ],
    });
    const pickupBindGroup = this.device.createBindGroup({
      label: "Blend dry pickup bind group",
      layout: this.pickupBindGroupLayout,
      entries: [
        uniformEntry,
        bufferEntry(1, stateBuffer),
        bufferEntry(2, carrierBuffer),
      ],
    });
    const depositBindGroups = this.createDepositBindGroups(
      stateBuffer,
      coverageBuffer,
      carrierBuffer,
    );
    const scatterBindGroup = this.device.createBindGroup({
      label: "Blend dry scatter bind group",
      layout: this.scatterBindGroupLayout,
      entries: [
        uniformEntry,
        bufferEntry(1, stateBuffer),
        bufferEntry(2, coverageBuffer),
      ],
    });
    this.scratch = {
      stateBuffer,
      coverageBuffer,
      carrierBuffer,
      blur: null,
      gatherBindGroup,
      pickupBindGroup,
      depositBindGroups,
      scatterBindGroup,
    };
    return this.scratch;
  }
}
