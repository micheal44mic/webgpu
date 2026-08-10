import {
  blendDepositShader,
  blendGatherShader,
  blendPickupShader,
  blendScatterShader,
} from "./blend-shaders";
import {
  DRY_BLEND_CORE_BUILD,
  DRY_BLEND_DEFAULT_SCRATCH_SIZE,
  blendPaintCoefficient,
  blendStretchCoefficient,
  type BlendRect,
  type DryBlendBatch,
  type DryBlendStep,
} from "./blend-core";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";

const BLEND_UNIFORM_BYTES = 192;
const BLEND_MAX_BATCHES_PER_SUBMIT = 256;
// Ring of persistent carrier slots: slot i feeds step i, the step writes i+1.
// The ring only needs to out-size a single submit so read/write never collide.
const BLEND_CARRIER_SLOT_COUNT = 4096;

export const DRY_BLEND_RENDERER_BUILD =
  "dry-blend-webgpu-v4-specialized-compute-sweep";

export interface DryBlendRenderSettings {
  shape: "circle" | "shape";
  grainMode: "off" | "texturized" | "moving";
  grainScale: number;
  grainMovement: number;
  grainDepth: number;
  grainBrightness: number;
  grainContrast: number;
  grainInvert: boolean;
  grainFiltering: "no" | "classic" | "improved";
  color: string;
  hardness: number;
  blendStretch: number;
  blendPaint: number;
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

interface ScratchResources {
  stateBuffer: GPUBuffer;
  coverageBuffer: GPUBuffer;
  carrierBuffer: GPUBuffer;
  gatherBindGroup: GPUBindGroup;
  pickupBindGroup: GPUBindGroup;
  depositBindGroups: Record<
    "fixed" | "moving",
    Record<"no" | "classic" | "improved", GPUBindGroup>
  >;
  scatterBindGroup: GPUBindGroup;
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

function srgbChannelToLinear(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function hexToLinearRgb(hex: string): readonly [number, number, number] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Colore HEX Blend non valido: ${hex}`);
  }
  return [
    srgbChannelToLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
  ];
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
  const compilationInfo = await Promise.all(
    modules.map(async ({ label, module }) => ({
      label,
      messages: (await module.getCompilationInfo()).messages,
    })),
  );
  const errors = compilationInfo.flatMap(({ label, messages }) =>
    [...messages]
      .filter((message) => message.type === "error")
      .map((message) => `${label}:${message.lineNum}:${message.linePos} ${message.message}`),
  );
  if (errors.length > 0) {
    throw new Error(`Shader Blend WGSL non valido:\n${errors.join("\n")}`);
  }
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
  private readonly documentWidth: number;
  private readonly documentHeight: number;
  private readonly layerFormat: GPUTextureFormat;
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

  private gatherBindGroupLayout!: GPUBindGroupLayout;
  private pickupBindGroupLayout!: GPUBindGroupLayout;
  private depositBindGroupLayout!: GPUBindGroupLayout;
  private scatterBindGroupLayout!: GPUBindGroupLayout;
  private gatherPipeline!: GPUComputePipeline;
  private pickupPipeline!: GPUComputePipeline;
  private depositPipelines!: Record<
    DryBlendRenderSettings["shape"],
    Record<"off" | "on", GPUComputePipeline>
  >;
  private scatterPipeline!: GPURenderPipeline;
  private scratch: ScratchResources | null = null;
  private activeHistoryActionId: number | null = null;
  private carrierCursor = 0;
  private carrierValid = false;
  private destroyed = false;

  private constructor(options: DryBlendRendererOptions) {
    this.device = options.device;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.layerFormat = options.layerFormat;
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
    const computeTexture = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      texture: {
        sampleType: "float",
        viewDimension: "2d",
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
        computeTexture(4),
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
    ] as const;
    await assertShaderModules(modules);

    const pipelineLayout = (label: string, layout: GPUBindGroupLayout) =>
      this.device.createPipelineLayout({ label, bindGroupLayouts: [layout] });
    const computePipeline = (
      label: string,
      layout: GPUBindGroupLayout,
      module: GPUShaderModule,
      entryPoint: string,
      constants?: Record<string, GPUPipelineConstantValue>,
    ): GPUComputePipeline => this.device.createComputePipeline({
      label,
      layout: pipelineLayout(`${label} pipeline layout`, layout),
      compute: { module, entryPoint, constants },
    });

    await runGpuAllocationTransaction(
      this.device,
      "Pipeline Blend WebGPU non valida",
      () => {
        this.gatherPipeline = computePipeline(
          "Blend dry gather ROI",
          this.gatherBindGroupLayout,
          modules[0].module,
          "gatherMain",
        );
        this.pickupPipeline = computePipeline(
          "Blend dry 8x8 weighted pigment pickup",
          this.pickupBindGroupLayout,
          modules[1].module,
          "pickupMain",
        );
        const depositPipeline = (
          shape: DryBlendRenderSettings["shape"],
          grain: "off" | "on",
        ) => computePipeline(
          `Blend dry ${shape} ${grain} fused sweep and pigment deposit`,
          this.depositBindGroupLayout,
          modules[2].module,
          "depositMain",
          {
            blendCustomShape: shape === "shape" ? 1 : 0,
            blendGrainEnabled: grain === "on" ? 1 : 0,
          },
        );
        this.depositPipelines = {
          circle: {
            off: depositPipeline("circle", "off"),
            on: depositPipeline("circle", "on"),
          },
          shape: {
            off: depositPipeline("shape", "off"),
            on: depositPipeline("shape", "on"),
          },
        };
        this.scatterPipeline = this.device.createRenderPipeline({
          label: "Blend dry scatter to canonical layer",
          layout: pipelineLayout(
            "Blend dry scatter pipeline layout",
            this.scatterBindGroupLayout,
          ),
          vertex: {
            module: modules[3].module,
            entryPoint: "fullscreenVertex",
          },
          fragment: {
            module: modules[3].module,
            entryPoint: "scatterFragment",
            targets: [{ format: this.layerFormat }],
          },
          primitive: { topology: "triangle-list" },
        });
      },
    );
  }

  beginStroke(historyActionId: number): void {
    this.assertAlive();
    this.activeHistoryActionId = historyActionId;
    this.carrierCursor = 0;
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
        `Blend dry accetta al massimo ${BLEND_MAX_BATCHES_PER_SUBMIT} batch per submit.`,
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
    const historyBytes = renderable.length * this.uniformStride;
    if (historyTransfer?.capture && historyTransfer.replay) {
      throw new Error("Il transfer Blend non può catturare e riprodurre insieme.");
    }
    if (historyTransfer?.replay) {
      if (historyTransfer.replay.sizeBytes !== historyBytes) {
        throw new Error(
          `Payload Blend storico ${historyTransfer.replay.sizeBytes} B, attesi ${historyBytes} B.`,
        );
      }
    } else {
      if (!renderable.every(isDryBlendRenderBatch)) {
        throw new Error("Replay Blend privo del payload uniform GPU.");
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
          `Destinazione Blend storica ${historyTransfer.capture.sizeBytes} B, `
          + `attesi ${historyBytes} B.`,
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
    // Both Moving and Texturized can cross tile boundaries once Scale is
    // applied. Their corrected coordinate mappings therefore share repeat.
    const grainMode = "fixed" as const;
    const depositPipeline = this.depositPipelines[settings.shape][
      settings.grainMode === "off" ? "off" : "on"
    ];
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
    return (stateBytes + coverageBytes + carrierBytes + this.uniformUpload.byteLength)
      / (1024 * 1024);
  }

  allocatedMemoryMiB(): number {
    return this.scratch
      ? this.memoryMiB()
      : this.uniformUpload.byteLength / (1024 * 1024);
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

  // Il chiamante garantisce che nessun tratto Blend sia attivo o in coda:
  // il carrier ring vive nello scratch e non sopravvive al rilascio.
  releaseScratch(): boolean {
    if (this.destroyed || !this.scratch) {
      return false;
    }
    this.scratch.stateBuffer.destroy();
    this.scratch.coverageBuffer.destroy();
    this.scratch.carrierBuffer.destroy();
    this.scratch = null;
    this.carrierValid = false;
    return true;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.uniformBuffer.destroy();
    if (this.scratch) {
      this.scratch.stateBuffer.destroy();
      this.scratch.coverageBuffer.destroy();
      this.scratch.carrierBuffer.destroy();
      this.scratch = null;
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("Renderer Blend dry già distrutto.");
    }
  }

  private validateBatch(batch: DryBlendHistoryGeometry): void {
    if (batch.build !== DRY_BLEND_CORE_BUILD || batch.stepCount !== 1) {
      throw new Error("Batch Blend dry incompatibile.");
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
      throw new TypeError("Rettangolo Blend dry non valido.");
    }
    if (
      batch.readRect.width <= 0
      || batch.readRect.height <= 0
      || batch.readRect.width > this.scratchSize
      || batch.readRect.height > this.scratchSize
    ) {
      throw new RangeError("ROI Blend dry oltre lo scratch WebGPU.");
    }
    if (
      batch.writeRect.x < 0
      || batch.writeRect.y < 0
      || batch.writeRect.width <= 0
      || batch.writeRect.height <= 0
      || batch.writeRect.x + batch.writeRect.width > this.documentWidth
      || batch.writeRect.y + batch.writeRect.height > this.documentHeight
    ) {
      throw new RangeError("Dirty rect Blend dry fuori dal layer.");
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
    const paintColor = hexToLinearRgb(settings.color);
    const grainPolarity = settings.grainInvert ? -1 : 1;
    const grainScale = clamp(settings.grainScale, 0.1, 4);
    const grainMode = settings.grainMode === "moving"
      ? 2
      : settings.grainMode === "texturized" ? 1 : 0;
    const filtering = settings.grainFiltering === "no"
      ? 0
      : settings.grainFiltering === "classic" ? 1 : 2;

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
        floats[31] = 0;
        floats[32] = paintColor[0];
        floats[33] = paintColor[1];
        floats[34] = paintColor[2];
        floats[35] = 1;
        floats[36] = batch.writeRect.x - group.readRect.x;
        floats[37] = batch.writeRect.y - group.readRect.y;
        floats[38] = batch.writeRect.width;
        floats[39] = batch.writeRect.height;
        unsigned[40] = settings.shape === "shape" ? 1 : 0;
        unsigned[41] = grainMode;
        unsigned[42] = filtering;
        unsigned[43] = this.carrierValid || index > 0 ? 1 : 0;
        unsigned[44] = carrierReadSlot;
        unsigned[45] = carrierWriteSlot;
        unsigned[46] = this.scratchSize;
        unsigned[47] = 0;
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

  // Il ciclo di vita del Grain scambia la texture (placeholder ↔ M1): i
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
      throw new Error("Renderer Blend già distrutto.");
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

  private rebuildResidentDepositBindGroups(): void {
    if (this.scratch) {
      this.scratch.depositBindGroups = this.createDepositBindGroups(
        this.scratch.stateBuffer,
        this.scratch.coverageBuffer,
        this.scratch.carrierBuffer,
      );
    }
  }

  private ensureScratchResources(): ScratchResources {
    if (this.scratch) {
      return this.scratch;
    }
    const pixels = this.scratchSize * this.scratchSize;
    const stateBuffer = this.device.createBuffer({
      label: "Blend dry scratch state",
      size: pixels * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    const coverageBuffer = this.device.createBuffer({
      label: "Blend dry union coverage",
      size: pixels * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    const carrierBuffer = this.device.createBuffer({
      label: "Blend dry carrier ring",
      size: BLEND_CARRIER_SLOT_COUNT * 16,
      usage: GPUBufferUsage.STORAGE,
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
      gatherBindGroup,
      pickupBindGroup,
      depositBindGroups,
      scatterBindGroup,
    };
    return this.scratch;
  }
}
