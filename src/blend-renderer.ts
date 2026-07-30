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
import {
  ruwaWetBuildupCoatPerDab,
  ruwaWetRatePerDab,
} from "./wet-mix";

const BLEND_UNIFORM_BYTES = 192;
const BLEND_MAX_BATCHES_PER_SUBMIT = 256;
// Ring of persistent carrier slots: slot i feeds step i, the step writes i+1.
// The ring only needs to out-size a single submit so read/write never collide.
const BLEND_CARRIER_SLOT_COUNT = 4096;
const RUWA_WET_RESERVOIR_GRID_SIZE = 32;
const RUWA_WET_RESERVOIR_TRACK_COUNT = 24;
const RUWA_WET_RESERVOIR_SLOT_COUNT = RUWA_WET_RESERVOIR_TRACK_COUNT * 2;
const RUWA_WET_RESERVOIR_TEXELS_PER_SLOT =
  RUWA_WET_RESERVOIR_GRID_SIZE * RUWA_WET_RESERVOIR_GRID_SIZE;

export const DRY_BLEND_RENDERER_BUILD =
  "dry-blend-webgpu-v4-ruwa-spatial-reservoir";

export type DryBlendRenderMode = "dry-blend" | "ruwa-wet";

export interface DryBlendRenderSettings {
  renderMode?: DryBlendRenderMode;
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
  wetBlending?: number;
  wetDilution?: number;
  wetSpread?: number;
  wetLength?: number;
  wetFlow?: number;
  wetBuildup?: number;
  wetDrying?: number;
}

export interface DryBlendRenderBatch {
  readonly build: typeof DRY_BLEND_CORE_BUILD;
  readonly stepCount: 1;
  readonly steps: readonly [DryBlendStep];
  readonly empty: boolean;
  readonly readRect: BlendRect;
  readonly writeRect: BlendRect;
  /** Encoded-sRGB colour of this physical Paint copy, including Color Dynamics. */
  readonly paintColor?: string;
  /** Independent spatial reservoir lane for this physical Count copy. */
  readonly reservoirTrackId?: number;
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
  stateBuffer: GPUBuffer;
  coverageBuffer: GPUBuffer;
  carrierBuffer: GPUBuffer;
  wetReservoirBuffer: GPUBuffer;
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

function hexToSrgbRgb(hex: string): readonly [number, number, number] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Colore HEX Wet Mix non valido: ${hex}`);
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
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
  private layerView: GPUTextureView;
  private layerSamplingView: GPUTextureView;
  private shapeMaskView: GPUTextureView;
  private readonly shapeMaskSampler: GPUSampler;
  private grainTextureView: GPUTextureView;
  private readonly grainSamplers: DryBlendRendererOptions["grainSamplers"];
  private scratchSize: number;
  private readonly uniformStride: number;
  private readonly uniformUpload: ArrayBuffer;
  private readonly uniformBuffer: GPUBuffer;

  private gatherBindGroupLayout!: GPUBindGroupLayout;
  private pickupBindGroupLayout!: GPUBindGroupLayout;
  private depositBindGroupLayout!: GPUBindGroupLayout;
  private scatterBindGroupLayout!: GPUBindGroupLayout;
  private gatherPipeline!: GPUComputePipeline;
  private pickupPipeline!: GPUComputePipeline;
  private depositPipeline!: GPUComputePipeline;
  private scatterPipeline!: GPURenderPipeline;
  private scratch: ScratchResources | null = null;
  private activeHistoryActionId: number | null = null;
  private carrierCursor = 0;
  private carrierValid = false;
  private readonly wetTrackValid = new Uint8Array(RUWA_WET_RESERVOIR_TRACK_COUNT);
  private readonly wetTrackPhase = new Uint8Array(RUWA_WET_RESERVOIR_TRACK_COUNT);
  private readonly wetTrackX = new Float32Array(RUWA_WET_RESERVOIR_TRACK_COUNT);
  private readonly wetTrackY = new Float32Array(RUWA_WET_RESERVOIR_TRACK_COUNT);
  private readonly wetTrackRadius = new Float32Array(RUWA_WET_RESERVOIR_TRACK_COUNT);
  private readonly wetTrackSupply = new Float32Array(RUWA_WET_RESERVOIR_TRACK_COUNT);
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
        storageEntry(3, GPUShaderStage.COMPUTE, false),
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
        storageEntry(8, GPUShaderStage.COMPUTE, true),
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
    ): GPUComputePipeline => this.device.createComputePipeline({
      label,
      layout: pipelineLayout(`${label} pipeline layout`, layout),
      compute: { module, entryPoint },
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
        this.depositPipeline = computePipeline(
          "Blend dry fused sweep mask and pigment deposit",
          this.depositBindGroupLayout,
          modules[2].module,
          "depositMain",
        );
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
    this.wetTrackValid.fill(0);
    this.wetTrackPhase.fill(0);
    this.wetTrackSupply.fill(1);
  }

  /**
   * Lo scratch del Blend dry resta 1664; il percorso Intense Wet richiede
   * 2304 per una Shape ruotata da 1500 px più l'alone del Blur. La taglia si
   * cambia soltanto a scratch libero o fra un tratto e l'altro: il carrier
   * ring vive nello scratch e non può sopravvivere alla riallocazione.
   */
  configureScratchSize(size: number): void {
    this.assertAlive();
    const next = Math.max(DRY_BLEND_DEFAULT_SCRATCH_SIZE, Math.ceil(size));
    if (next === this.scratchSize) {
      return;
    }
    // Il chiamante garantisce che nessun tratto sia attivo: un carrier di un
    // tratto già concluso può essere scartato, beginStroke lo azzera comunque.
    if (this.scratch) {
      this.releaseScratch();
    }
    this.scratchSize = next;
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
    // Un replay può chiedere dab Wet più larghi dello scratch corrente (per
    // esempio cronologia Intense Wet mentre è selezionato il Blend dry): la
    // crescita avviene solo a inizio tratto, quando il carrier è vuoto.
    let requiredScratch = this.scratchSize;
    for (const batch of batches) {
      if (!batch.empty) {
        requiredScratch = Math.max(
          requiredScratch,
          batch.readRect.width,
          batch.readRect.height,
        );
      }
    }
    if (requiredScratch > this.scratchSize) {
      if (this.carrierValid) {
        throw new Error(
          "Lo scratch Blend non può crescere durante un tratto attivo.",
        );
      }
      this.configureScratchSize(requiredScratch);
    }
    const startedAt = performance.now();
    const scratch = this.ensureScratchResources();
    const renderable = batches.filter((batch) => !batch.empty);
    for (const batch of renderable) {
      this.validateBatch(batch);
    }
    const groups = this.buildStepGroups(renderable);
    this.populateUniforms(renderable, groups, settings);
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

    const workgroups = (pixels: number): number => Math.ceil(pixels / 8);
    const grainMode = settings.grainMode === "moving" ? "moving" : "fixed";
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
        const wetGridWorkgroups = settings.renderMode === "ruwa-wet"
          ? RUWA_WET_RESERVOIR_GRID_SIZE / 8
          : 1;
        computePass.dispatchWorkgroups(wetGridWorkgroups, wetGridWorkgroups);
        computePass.setPipeline(this.depositPipeline);
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

    if (clearLayer || renderable.length > 0) {
      this.device.queue.submit([encoder.finish()]);
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
    const wetReservoirBytes = RUWA_WET_RESERVOIR_SLOT_COUNT
      * RUWA_WET_RESERVOIR_TEXELS_PER_SLOT
      * 16;
    return (stateBytes + coverageBytes + carrierBytes + wetReservoirBytes
      + this.uniformUpload.byteLength)
      / (1024 * 1024);
  }

  allocatedMemoryMiB(): number {
    return this.scratch
      ? this.memoryMiB()
      : this.uniformUpload.byteLength / (1024 * 1024);
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
    this.scratch.wetReservoirBuffer.destroy();
    this.scratch = null;
    this.carrierValid = false;
    this.wetTrackValid.fill(0);
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
      this.scratch.wetReservoirBuffer.destroy();
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

  private buildStepGroups(
    renderable: readonly DryBlendRenderBatch[],
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
    const wetMode = settings.renderMode === "ruwa-wet";
    const grainPolarity = settings.grainInvert ? -1 : 1;
    const grainScale = clamp(settings.grainScale, 0.1, 4);
    const grainMode = settings.grainMode === "moving"
      ? 2
      : settings.grainMode === "texturized" ? 1 : 0;
    const filtering = settings.grainFiltering === "no"
      ? 0
      : settings.grainFiltering === "classic" ? 1 : 2;
    const wetBlending = wetMode ? clamp(settings.wetBlending ?? 0, 0, 1) : 0;
    const wetDilution = wetMode ? clamp(settings.wetDilution ?? 0, 0, 1) : 0;
    const wetSpread = wetMode ? clamp(settings.wetSpread ?? 0, 0, 1) : 0;
    const wetLength = wetMode ? clamp(settings.wetLength ?? 0.5, 0, 1) : 0;
    const wetFlow = wetMode ? clamp(settings.wetFlow ?? 0.75, 0, 1) : 0;
    const wetBuildup = wetMode ? clamp(settings.wetBuildup ?? 0, 0, 1) : 0;
    const wetDrying = wetMode ? clamp(settings.wetDrying ?? 0, 0, 1) : 0;

    for (const group of groups) {
      for (let member = 0; member < group.count; member += 1) {
        const index = group.start + member;
        const batch = batches[index];
        const step = batch.steps[0];
        let readSlot = this.carrierCursor;
        let writeSlot = (this.carrierCursor + 1) % BLEND_CARRIER_SLOT_COUNT;
        let hasPrevious = this.carrierValid || index > 0;
        let travelX = 0;
        let travelY = 0;
        let travelDistance = step.distance;
        let pickupRate = clamp(step.warpStrength, 0, 1);
        let drainRate = 0;
        let effectiveSpread = 0;
        let depositRate = clamp(step.flow, 0, 1);
        let coatPerDab = -1;
        let paintSupply = 1;

        if (wetMode) {
          const track = clamp(
            Math.trunc(batch.reservoirTrackId ?? 0),
            0,
            RUWA_WET_RESERVOIR_TRACK_COUNT - 1,
          );
          hasPrevious = this.wetTrackValid[track] !== 0;
          travelX = hasPrevious ? step.toX - this.wetTrackX[track] : 0;
          travelY = hasPrevious ? step.toY - this.wetTrackY[track] : 0;
          travelDistance = Math.hypot(travelX, travelY);
          const radius = Math.max(
            0.5,
            Math.min(step.toHalfWidth, step.toHalfHeight),
          );
          const previousSupply = hasPrevious ? this.wetTrackSupply[track] : 1;
          const dryingPerDab = hasPrevious
            ? ruwaWetRatePerDab(wetDrying, travelDistance, radius)
            : 0;
          paintSupply = previousSupply * (1 - dryingPerDab);
          effectiveSpread = wetSpread * paintSupply;
          const exchange = Math.max(
            wetBlending * (1 - wetLength),
            effectiveSpread,
          );
          pickupRate = hasPrevious
            ? ruwaWetRatePerDab(exchange, travelDistance, radius)
            : 1;
          drainRate = hasPrevious
            ? ruwaWetRatePerDab(
              wetDilution * wetDilution,
              travelDistance,
              radius,
            )
            : 0;
          depositRate = hasPrevious
            ? ruwaWetRatePerDab(step.flow, travelDistance, radius)
            : clamp(step.flow, 0, 1);
          coatPerDab = wetBuildup > 0.001
            ? paintSupply * (hasPrevious
              ? ruwaWetBuildupCoatPerDab(
                wetBuildup,
                travelDistance,
                Math.max(0.5, this.wetTrackRadius[track] || radius),
              )
              : 0)
            : -1;

          const phase = this.wetTrackPhase[track];
          readSlot = track * 2 + phase;
          writeSlot = track * 2 + (1 - phase);
          this.wetTrackValid[track] = 1;
          this.wetTrackPhase[track] = 1 - phase;
          this.wetTrackX[track] = step.toX;
          this.wetTrackY[track] = step.toY;
          this.wetTrackRadius[track] = radius;
          this.wetTrackSupply[track] = paintSupply;
        } else {
          this.carrierCursor = writeSlot;
        }

        const paintColor = wetMode
          ? hexToSrgbRgb(batch.paintColor ?? settings.color)
          : hexToLinearRgb(settings.color);
        const offset = index * this.uniformStride;
        const floats = new Float32Array(
          this.uniformUpload,
          offset,
          BLEND_UNIFORM_BYTES / 4,
        );
        const unsigned = new Uint32Array(
          this.uniformUpload,
          offset,
          BLEND_UNIFORM_BYTES / 4,
        );
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
        floats[17] = wetMode ? depositRate : clamp(step.flow, 0, 1);
        floats[18] = wetMode ? travelX : step.spacing;
        floats[19] = wetMode ? travelY : step.arcStart;
        floats[20] = wetMode ? travelDistance : step.distance;
        floats[21] = step.diameter;
        floats[22] = wetMode ? pickupRate : clamp(step.warpStrength, 0, 1);
        floats[23] = wetMode
          ? wetDilution
          : blendStretchCoefficient(settings.blendStretch);
        floats[24] = 1 / (2500 * grainScale);
        floats[25] = wetMode
          ? coatPerDab
          : blendPaintCoefficient(settings.blendPaint);
        floats[26] = clamp(settings.grainDepth, 0, 1);
        floats[27] = clamp(settings.grainBrightness, -1, 1) * grainPolarity;
        floats[28] = (1 + clamp(settings.grainContrast, -1, 1)) * grainPolarity;
        floats[29] = wetMode ? drainRate : 0;
        floats[30] = wetMode ? effectiveSpread : 0;
        floats[31] = wetMode ? wetFlow : 0;
        floats[32] = paintColor[0];
        floats[33] = paintColor[1];
        floats[34] = paintColor[2];
        floats[35] = wetMode
          ? wetDilution <= 0.001 ? paintSupply : 0
          : 1;
        floats[36] = batch.writeRect.x - group.readRect.x;
        floats[37] = batch.writeRect.y - group.readRect.y;
        floats[38] = batch.writeRect.width;
        floats[39] = batch.writeRect.height;
        unsigned[40] = settings.shape === "shape" ? 1 : 0;
        unsigned[41] = grainMode;
        unsigned[42] = filtering;
        unsigned[43] = hasPrevious ? 1 : 0;
        unsigned[44] = readSlot;
        unsigned[45] = writeSlot;
        unsigned[46] = this.scratchSize;
        unsigned[47] = wetMode ? 1 : 0;
      }
    }
  }

  private createDepositBindGroups(
    stateBuffer: GPUBuffer,
    coverageBuffer: GPUBuffer,
    carrierBuffer: GPUBuffer,
    wetReservoirBuffer: GPUBuffer,
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
            { binding: 8, resource: { buffer: wetReservoirBuffer } },
          ],
        });
      }
    }
    return depositBindGroups;
  }

  // Il ciclo di vita del Grain scambia la texture (placeholder ↔ M1): i
  // deposit bind group residenti vanno ricostruiti sulla view nuova.
  setGrainTextureView(view: GPUTextureView): void {
    if (this.destroyed || this.grainTextureView === view) {
      return;
    }
    this.grainTextureView = view;
    this.rebuildResidentDepositBindGroups();
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
   * Blend only ever wets the active layer, so one instance is retargeted rather
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
    this.wetTrackValid.fill(0);
  }

  private rebuildResidentDepositBindGroups(): void {
    if (this.scratch) {
      this.scratch.depositBindGroups = this.createDepositBindGroups(
        this.scratch.stateBuffer,
        this.scratch.coverageBuffer,
        this.scratch.carrierBuffer,
        this.scratch.wetReservoirBuffer,
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
    const wetReservoirBuffer = this.device.createBuffer({
      label: "Ruwa Wet spatial reservoir 24x2x32x32",
      size: RUWA_WET_RESERVOIR_SLOT_COUNT
        * RUWA_WET_RESERVOIR_TEXELS_PER_SLOT
        * 16,
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
        bufferEntry(3, wetReservoirBuffer),
      ],
    });
    const depositBindGroups = this.createDepositBindGroups(
      stateBuffer,
      coverageBuffer,
      carrierBuffer,
      wetReservoirBuffer,
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
      wetReservoirBuffer,
      gatherBindGroup,
      pickupBindGroup,
      depositBindGroups,
      scatterBindGroup,
    };
    return this.scratch;
  }
}
