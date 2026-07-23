import {
  blendDepositShader,
  blendGatherShader,
  blendMaskShader,
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

const BLEND_UNIFORM_BYTES = 160;
const BLEND_MAX_BATCHES_PER_SUBMIT = 64;
const BLEND_STATE_FORMAT: GPUTextureFormat = "rgba16float";
const BLEND_MASK_FORMAT: GPUTextureFormat = "r8unorm";

export const DRY_BLEND_RENDERER_BUILD =
  "dry-blend-webgpu-v2-border-safe-pickup";

export interface DryBlendRenderSettings {
  shape: "circle" | "shape";
  grainMode: "off" | "texturized" | "moving";
  grainScale: number;
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
  grainSamplers: Record<
    "fixed" | "moving",
    Record<"no" | "classic" | "improved", GPUSampler>
  >;
  scratchSize?: number;
}

interface ScratchResources {
  stateTextures: readonly [GPUTexture, GPUTexture];
  stateViews: readonly [GPUTextureView, GPUTextureView];
  stepMaskTexture: GPUTexture;
  stepMaskView: GPUTextureView;
  unionMaskTexture: GPUTexture;
  unionMaskView: GPUTextureView;
  carrierTextures: readonly [GPUTexture, GPUTexture];
  carrierViews: readonly [GPUTextureView, GPUTextureView];
  gatherBindGroup: GPUBindGroup;
  maskBindGroups: Record<
    "fixed" | "moving",
    Record<"no" | "classic" | "improved", GPUBindGroup>
  >;
  pickupBindGroups: readonly [GPUBindGroup, GPUBindGroup];
  depositBindGroups: readonly [GPUBindGroup, GPUBindGroup];
  scatterBindGroup: GPUBindGroup;
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
  private readonly layerView: GPUTextureView;
  private readonly layerSamplingView: GPUTextureView;
  private readonly shapeMaskView: GPUTextureView;
  private readonly shapeMaskSampler: GPUSampler;
  private readonly grainTextureView: GPUTextureView;
  private readonly grainSamplers: DryBlendRendererOptions["grainSamplers"];
  private readonly scratchSize: number;
  private readonly uniformStride: number;
  private readonly uniformUpload: ArrayBuffer;
  private readonly uniformBuffer: GPUBuffer;

  private gatherBindGroupLayout!: GPUBindGroupLayout;
  private maskBindGroupLayout!: GPUBindGroupLayout;
  private pickupBindGroupLayout!: GPUBindGroupLayout;
  private depositBindGroupLayout!: GPUBindGroupLayout;
  private scatterBindGroupLayout!: GPUBindGroupLayout;
  private gatherPipeline!: GPURenderPipeline;
  private maskPipeline!: GPURenderPipeline;
  private pickupPipeline!: GPURenderPipeline;
  private depositPipeline!: GPURenderPipeline;
  private scatterPipeline!: GPURenderPipeline;
  private scratch: ScratchResources | null = null;
  private activeHistoryActionId: number | null = null;
  private carrierIndex: 0 | 1 = 0;
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
    this.grainSamplers = options.grainSamplers;
    this.scratchSize = options.scratchSize ?? DRY_BLEND_DEFAULT_SCRATCH_SIZE;
    this.uniformStride = Math.ceil(
      BLEND_UNIFORM_BYTES / this.device.limits.minUniformBufferOffsetAlignment,
    ) * this.device.limits.minUniformBufferOffsetAlignment;
    this.uniformUpload = new ArrayBuffer(
      this.uniformStride * BLEND_MAX_BATCHES_PER_SUBMIT,
    );
    this.uniformBuffer = this.device.createBuffer({
      label: "Blend dry dynamic uniforms",
      size: this.uniformUpload.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private async initialize(): Promise<void> {
    const dynamicUniformEntry: GPUBindGroupLayoutEntry = {
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: {
        type: "uniform",
        hasDynamicOffset: true,
        minBindingSize: BLEND_UNIFORM_BYTES,
      },
    };
    const sampledTexture = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: "float",
        viewDimension: "2d",
        multisampled: false,
      },
    });
    const filteringSampler = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      sampler: { type: "filtering" },
    });

    this.gatherBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry gather bind group layout",
      entries: [dynamicUniformEntry, sampledTexture(1)],
    });
    this.maskBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry mask bind group layout",
      entries: [
        dynamicUniformEntry,
        sampledTexture(1),
        filteringSampler(2),
        sampledTexture(3),
        filteringSampler(4),
      ],
    });
    this.pickupBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry pickup bind group layout",
      entries: [dynamicUniformEntry, sampledTexture(1), sampledTexture(2)],
    });
    this.depositBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry deposit bind group layout",
      entries: [
        dynamicUniformEntry,
        sampledTexture(1),
        sampledTexture(2),
        sampledTexture(3),
      ],
    });
    this.scatterBindGroupLayout = this.device.createBindGroupLayout({
      label: "Blend dry scatter bind group layout",
      entries: [dynamicUniformEntry, sampledTexture(1), sampledTexture(2)],
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
        label: "Blend mask",
        module: this.device.createShaderModule({
          label: "Blend mask WGSL",
          code: blendMaskShader,
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
    const renderPipeline = (
      label: string,
      layout: GPUBindGroupLayout,
      module: GPUShaderModule,
      fragmentEntryPoint: string,
      targets: GPUColorTargetState[],
    ): GPURenderPipeline => this.device.createRenderPipeline({
      label,
      layout: pipelineLayout(`${label} pipeline layout`, layout),
      vertex: {
        module,
        entryPoint: "fullscreenVertex",
      },
      fragment: {
        module,
        entryPoint: fragmentEntryPoint,
        targets,
      },
      primitive: { topology: "triangle-list" },
    });

    this.device.pushErrorScope("validation");
    this.gatherPipeline = renderPipeline(
      "Blend dry gather",
      this.gatherBindGroupLayout,
      modules[0].module,
      "gatherFragment",
      [{ format: BLEND_STATE_FORMAT }],
    );
    this.maskPipeline = renderPipeline(
      "Blend dry continuous sweep mask",
      this.maskBindGroupLayout,
      modules[1].module,
      "maskFragment",
      [{ format: BLEND_MASK_FORMAT }, { format: BLEND_MASK_FORMAT }],
    );
    this.pickupPipeline = renderPipeline(
      "Blend dry weighted pickup",
      this.pickupBindGroupLayout,
      modules[2].module,
      "pickupFragment",
      [{ format: BLEND_STATE_FORMAT }],
    );
    this.depositPipeline = renderPipeline(
      "Blend dry pigment deposit",
      this.depositBindGroupLayout,
      modules[3].module,
      "depositFragment",
      [{ format: BLEND_STATE_FORMAT }],
    );
    this.scatterPipeline = renderPipeline(
      "Blend dry scatter to canonical layer",
      this.scatterBindGroupLayout,
      modules[4].module,
      "scatterFragment",
      [{ format: this.layerFormat }],
    );
    const validationError = await this.device.popErrorScope();
    if (validationError) {
      throw new Error(`Pipeline Blend WebGPU non valida: ${validationError.message}`);
    }
  }

  beginStroke(historyActionId: number): void {
    this.assertAlive();
    this.activeHistoryActionId = historyActionId;
    this.carrierIndex = 0;
    this.carrierValid = false;
  }

  submit(
    batches: readonly DryBlendRenderBatch[],
    settings: DryBlendRenderSettings,
    historyActionId: number,
    clearLayer: boolean,
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
    this.populateUniforms(renderable, settings);
    if (renderable.length > 0) {
      this.device.queue.writeBuffer(
        this.uniformBuffer,
        0,
        this.uniformUpload,
        0,
        renderable.length * this.uniformStride,
      );
    }

    const encoder = this.device.createCommandEncoder({
      label: "Blend dry frame encoder",
    });
    let passCount = 0;
    let dirtyRect: BlendRect | null = null;

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

    for (let index = 0; index < renderable.length; index += 1) {
      const batch = renderable[index];
      const dynamicOffset = index * this.uniformStride;
      const width = batch.readRect.width;
      const height = batch.readRect.height;

      const gatherPass = encoder.beginRenderPass({
        label: "Blend dry gather ROI",
        colorAttachments: [{
          view: scratch.stateViews[0],
          loadOp: "load",
          storeOp: "store",
        }],
      });
      gatherPass.setPipeline(this.gatherPipeline);
      gatherPass.setBindGroup(0, scratch.gatherBindGroup, [dynamicOffset]);
      gatherPass.setScissorRect(0, 0, width, height);
      gatherPass.draw(3);
      gatherPass.end();

      const maskMode = settings.grainMode === "moving" ? "moving" : "fixed";
      const maskPass = encoder.beginRenderPass({
        label: "Blend dry continuous sweep mask",
        colorAttachments: [
          {
            view: scratch.stepMaskView,
            loadOp: "load",
            storeOp: "store",
          },
          {
            view: scratch.unionMaskView,
            loadOp: "load",
            storeOp: "store",
          },
        ],
      });
      maskPass.setPipeline(this.maskPipeline);
      maskPass.setBindGroup(
        0,
        scratch.maskBindGroups[maskMode][settings.grainFiltering],
        [dynamicOffset],
      );
      maskPass.setScissorRect(0, 0, width, height);
      maskPass.draw(3);
      maskPass.end();

      const destinationCarrier = (this.carrierIndex === 0 ? 1 : 0) as 0 | 1;
      const pickupPass = encoder.beginRenderPass({
        label: "Blend dry 8x8 weighted pigment pickup",
        colorAttachments: [{
          view: scratch.carrierViews[destinationCarrier],
          loadOp: "load",
          storeOp: "store",
        }],
      });
      pickupPass.setPipeline(this.pickupPipeline);
      pickupPass.setBindGroup(
        0,
        scratch.pickupBindGroups[destinationCarrier],
        [dynamicOffset],
      );
      pickupPass.setScissorRect(0, 0, 1, 1);
      pickupPass.draw(3);
      pickupPass.end();
      this.carrierIndex = destinationCarrier;
      this.carrierValid = true;

      const depositPass = encoder.beginRenderPass({
        label: "Blend dry carried pigment deposit",
        colorAttachments: [{
          view: scratch.stateViews[1],
          loadOp: "load",
          storeOp: "store",
        }],
      });
      depositPass.setPipeline(this.depositPipeline);
      depositPass.setBindGroup(
        0,
        scratch.depositBindGroups[this.carrierIndex],
        [dynamicOffset],
      );
      depositPass.setScissorRect(0, 0, width, height);
      depositPass.draw(3);
      depositPass.end();

      const scatterPass = encoder.beginRenderPass({
        label: "Blend dry scatter ROI to canonical layer",
        colorAttachments: [{
          view: this.layerView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      scatterPass.setPipeline(this.scatterPipeline);
      scatterPass.setBindGroup(0, scratch.scatterBindGroup, [dynamicOffset]);
      scatterPass.setScissorRect(
        batch.writeRect.x,
        batch.writeRect.y,
        batch.writeRect.width,
        batch.writeRect.height,
      );
      scatterPass.draw(3);
      scatterPass.end();

      passCount += 5;
      dirtyRect = mergeRects(dirtyRect, batch.writeRect);
    }

    if (clearLayer || renderable.length > 0) {
      this.device.queue.submit([encoder.finish()]);
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
    const stateBytes = pixels * 8 * 2;
    const maskBytes = pixels * 2;
    const carrierBytes = 8 * 2;
    return (stateBytes + maskBytes + carrierBytes + this.uniformUpload.byteLength)
      / (1024 * 1024);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.uniformBuffer.destroy();
    if (this.scratch) {
      for (const texture of this.scratch.stateTextures) {
        texture.destroy();
      }
      this.scratch.stepMaskTexture.destroy();
      this.scratch.unionMaskTexture.destroy();
      for (const texture of this.scratch.carrierTextures) {
        texture.destroy();
      }
      this.scratch = null;
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("Renderer Blend dry già distrutto.");
    }
  }

  private validateBatch(batch: DryBlendRenderBatch): void {
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

  private populateUniforms(
    batches: readonly DryBlendRenderBatch[],
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

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const step = batch.steps[0];
      const offset = index * this.uniformStride;
      const floats = new Float32Array(this.uniformUpload, offset, BLEND_UNIFORM_BYTES / 4);
      const unsigned = new Uint32Array(this.uniformUpload, offset, BLEND_UNIFORM_BYTES / 4);
      floats.fill(0);
      floats[0] = this.documentWidth;
      floats[1] = this.documentHeight;
      floats[2] = batch.readRect.x;
      floats[3] = batch.readRect.y;
      floats[4] = batch.readRect.width;
      floats[5] = batch.readRect.height;
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
      floats[24] = 1 / (2500 * grainScale);
      floats[25] = blendPaintCoefficient(settings.blendPaint);
      floats[26] = clamp(settings.grainDepth, 0, 1);
      floats[27] = clamp(settings.grainBrightness, -1, 1) * grainPolarity;
      floats[28] = (1 + clamp(settings.grainContrast, -1, 1)) * grainPolarity;
      floats[31] = 0;
      floats[32] = paintColor[0];
      floats[33] = paintColor[1];
      floats[34] = paintColor[2];
      floats[35] = 1;
      unsigned[36] = settings.shape === "shape" ? 1 : 0;
      unsigned[37] = grainMode;
      unsigned[38] = filtering;
      unsigned[39] = this.carrierValid || index > 0 ? 1 : 0;
    }
  }

  private ensureScratchResources(): ScratchResources {
    if (this.scratch) {
      return this.scratch;
    }
    const stateTexture = (label: string): GPUTexture => this.device.createTexture({
      label,
      size: {
        width: this.scratchSize,
        height: this.scratchSize,
        depthOrArrayLayers: 1,
      },
      format: BLEND_STATE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const maskTexture = (label: string): GPUTexture => this.device.createTexture({
      label,
      size: {
        width: this.scratchSize,
        height: this.scratchSize,
        depthOrArrayLayers: 1,
      },
      format: BLEND_MASK_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const carrierTexture = (label: string): GPUTexture => this.device.createTexture({
      label,
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: BLEND_STATE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const stateTextures = [
      stateTexture("Blend dry scratch state A"),
      stateTexture("Blend dry scratch state B"),
    ] as const;
    const stateViews = stateTextures.map((texture) => texture.createView()) as unknown as readonly [
      GPUTextureView,
      GPUTextureView,
    ];
    const stepMaskTexture = maskTexture("Blend dry step coverage");
    const unionMaskTexture = maskTexture("Blend dry union coverage");
    const stepMaskView = stepMaskTexture.createView();
    const unionMaskView = unionMaskTexture.createView();
    const carrierTextures = [
      carrierTexture("Blend dry carrier A"),
      carrierTexture("Blend dry carrier B"),
    ] as const;
    const carrierViews = carrierTextures.map((texture) => texture.createView()) as unknown as readonly [
      GPUTextureView,
      GPUTextureView,
    ];
    const uniformEntry = {
      binding: 0,
      resource: {
        buffer: this.uniformBuffer,
        offset: 0,
        size: BLEND_UNIFORM_BYTES,
      },
    } as const;
    const gatherBindGroup = this.device.createBindGroup({
      label: "Blend dry gather bind group",
      layout: this.gatherBindGroupLayout,
      entries: [
        uniformEntry,
        { binding: 1, resource: this.layerSamplingView },
      ],
    });
    const maskBindGroups = {
      fixed: {} as Record<"no" | "classic" | "improved", GPUBindGroup>,
      moving: {} as Record<"no" | "classic" | "improved", GPUBindGroup>,
    };
    for (const mode of ["fixed", "moving"] as const) {
      for (const filtering of ["no", "classic", "improved"] as const) {
        maskBindGroups[mode][filtering] = this.device.createBindGroup({
          label: `Blend dry mask ${mode} ${filtering}`,
          layout: this.maskBindGroupLayout,
          entries: [
            uniformEntry,
            { binding: 1, resource: this.shapeMaskView },
            { binding: 2, resource: this.shapeMaskSampler },
            { binding: 3, resource: this.grainTextureView },
            { binding: 4, resource: this.grainSamplers[mode][filtering] },
          ],
        });
      }
    }
    const pickupBindGroups = ([0, 1] as const).map((destination) =>
      this.device.createBindGroup({
        label: `Blend dry pickup to carrier ${destination}`,
        layout: this.pickupBindGroupLayout,
        entries: [
          uniformEntry,
          { binding: 1, resource: stateViews[0] },
          { binding: 2, resource: carrierViews[destination === 0 ? 1 : 0] },
        ],
      })) as unknown as readonly [GPUBindGroup, GPUBindGroup];
    const depositBindGroups = ([0, 1] as const).map((carrier) =>
      this.device.createBindGroup({
        label: `Blend dry deposit from carrier ${carrier}`,
        layout: this.depositBindGroupLayout,
        entries: [
          uniformEntry,
          { binding: 1, resource: stateViews[0] },
          { binding: 2, resource: stepMaskView },
          { binding: 3, resource: carrierViews[carrier] },
        ],
      })) as unknown as readonly [GPUBindGroup, GPUBindGroup];
    const scatterBindGroup = this.device.createBindGroup({
      label: "Blend dry scatter bind group",
      layout: this.scatterBindGroupLayout,
      entries: [
        uniformEntry,
        { binding: 1, resource: stateViews[1] },
        { binding: 2, resource: unionMaskView },
      ],
    });
    this.scratch = {
      stateTextures,
      stateViews,
      stepMaskTexture,
      stepMaskView,
      unionMaskTexture,
      unionMaskView,
      carrierTextures,
      carrierViews,
      gatherBindGroup,
      maskBindGroups,
      pickupBindGroups,
      depositBindGroups,
      scatterBindGroup,
    };
    return this.scratch;
  }
}
