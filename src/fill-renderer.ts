import {
  FILL_ACTIVE_BLOCK_BUFFER_BYTES,
  FILL_ACTIVE_NODE_BUFFER_BYTES,
  FILL_BLOCK_GRID_SIZE,
  FILL_HISTORY_MASK_BYTES,
  FILL_INDIRECT_BUFFER_BYTES,
  FILL_LABEL_BUFFER_BYTES,
  FILL_META_ACTIVE_BLOCKS,
  FILL_META_ACTIVE_COMPONENTS,
  FILL_META_DIAGNOSTIC,
  FILL_META_MAX_X,
  FILL_META_MAX_Y,
  FILL_META_MIN_X,
  FILL_META_MIN_Y,
  FILL_META_SELECTED_PIXELS,
  FILL_META_TILE_MASK_START,
  FILL_METADATA_BUFFER_BYTES,
  FILL_METADATA_BYTES,
  FILL_METADATA_WORDS,
  FILL_PARENT_BUFFER_BYTES,
  FILL_RESIDENT_SCRATCH_BYTES,
  FILL_TILE_MASK_WORDS,
  FILL_UNIFORM_BUFFER_BYTES,
  FILL_UNIFORM_BYTES,
  FILL_WORKGROUP_STORAGE_BYTES,
  countFillTiles,
  type FillAnalysis,
} from "./fill-core";
import { LAYER_SIZE } from "./engine-limits";
import type { LayerFormat } from "./engine-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { fillComputeShader, fillRenderShader } from "./fill-shaders";

interface FillRendererOptions {
  readonly device: GPUDevice;
  readonly layerFormat: LayerFormat;
  readonly sourceSamplingView: GPUTextureView;
}

interface FillScratchResources {
  readonly packedLabels: GPUBuffer;
  readonly globalParents: GPUBuffer;
  readonly activeParentNodes: GPUBuffer;
  readonly selectedMask: GPUBuffer;
  readonly activeBlocks: GPUBuffer;
  readonly metadata: GPUBuffer;
  readonly drawIndirect: GPUBuffer;
  readonly readback: GPUBuffer;
  computeBindGroup: GPUBindGroup;
  readonly renderBindGroup: GPUBindGroup;
}

async function assertShaderModules(
  modules: readonly { label: string; module: GPUShaderModule }[],
): Promise<void> {
  const compilation = await Promise.all(modules.map(async ({ label, module }) => ({
    label,
    messages: [...(await module.getCompilationInfo()).messages],
  })));
  const errors = compilation.flatMap(({ label, messages }) => messages
    .filter((message) => message.type === "error")
    .map((message) => `${label}:${message.lineNum}:${message.linePos} ${message.message}`));
  if (errors.length > 0) {
    throw new Error(`Shader Riempimento WGSL non valido:\n${errors.join("\n")}`);
  }
}

export class FillRenderer {
  static async create(options: FillRendererOptions): Promise<FillRenderer> {
    const renderer = new FillRenderer(options);
    try {
      await renderer.initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  readonly device: GPUDevice;
  readonly uniformBuffer: GPUBuffer;
  readonly computeBindGroupLayout: GPUBindGroupLayout;
  readonly renderBindGroupLayout: GPUBindGroupLayout;
  private readonly layerFormat: LayerFormat;
  private sourceSamplingView: GPUTextureView;
  private classifyPipeline!: GPUComputePipeline;
  private boundaryPipeline!: GPUComputePipeline;
  private compressPipeline!: GPUComputePipeline;
  private selectPipeline!: GPUComputePipeline;
  private rebuildPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private scratch: FillScratchResources | null = null;
  private prewarmPromise: Promise<void> | null = null;
  private destroyed = false;

  private constructor(options: FillRendererOptions) {
    this.device = options.device;
    const limits = this.device.limits;
    if (
      limits.maxComputeInvocationsPerWorkgroup < 256
      || limits.maxComputeWorkgroupSizeX < 16
      || limits.maxComputeWorkgroupSizeY < 16
      || limits.maxComputeWorkgroupStorageSize < FILL_WORKGROUP_STORAGE_BYTES
      || limits.maxStorageBuffersPerShaderStage < 7
      || limits.maxStorageBufferBindingSize < FILL_PARENT_BUFFER_BYTES
    ) {
      throw new Error("I limiti compute della GPU non supportano il Riempimento 4096².");
    }
    this.layerFormat = options.layerFormat;
    this.sourceSamplingView = options.sourceSamplingView;
    this.uniformBuffer = this.device.createBuffer({
      label: "Riempimento · uniformi",
      size: FILL_UNIFORM_BUFFER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      label: "Riempimento · compute bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform", minBindingSize: FILL_UNIFORM_BYTES } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
        ...Array.from({ length: 7 }, (_, index): GPUBindGroupLayoutEntry => ({
          binding: index + 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        })),
      ],
    });
    this.renderBindGroupLayout = this.device.createBindGroupLayout({
      label: "Riempimento · render bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: FILL_UNIFORM_BYTES } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
  }

  get resident(): boolean {
    return this.scratch !== null;
  }

  get residentBytes(): number {
    return this.resident ? FILL_RESIDENT_SCRATCH_BYTES : FILL_UNIFORM_BUFFER_BYTES;
  }

  private async initialize(): Promise<void> {
    const computeModule = this.device.createShaderModule({
      label: "Riempimento · componenti connesse",
      code: fillComputeShader,
    });
    const renderModule = this.device.createShaderModule({
      label: "Riempimento · commit maschera",
      code: fillRenderShader,
    });
    await assertShaderModules([
      { label: "compute", module: computeModule },
      { label: "render", module: renderModule },
    ]);
    const computeLayout = this.device.createPipelineLayout({
      label: "Riempimento · compute pipeline layout",
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    const renderLayout = this.device.createPipelineLayout({
      label: "Riempimento · render pipeline layout",
      bindGroupLayouts: [this.renderBindGroupLayout],
    });
    const computePipelines = await Promise.all([
      "classifyLocal",
      "unionBoundaries",
      "compressComponents",
      "selectSeedComponent",
      "rebuildSelection",
    ].map((entryPoint) => this.device.createComputePipelineAsync({
      label: `Riempimento · ${entryPoint}`,
      layout: computeLayout,
      compute: { module: computeModule, entryPoint },
    })));
    [
      this.classifyPipeline,
      this.boundaryPipeline,
      this.compressPipeline,
      this.selectPipeline,
      this.rebuildPipeline,
    ] = computePipelines;
    this.renderPipeline = await this.device.createRenderPipelineAsync({
      label: `Riempimento · commit ${this.layerFormat}`,
      layout: renderLayout,
      vertex: { module: renderModule, entryPoint: "vertexMain" },
      fragment: {
        module: renderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.layerFormat }],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  async prewarm(): Promise<void> {
    this.assertAlive();
    if (this.scratch) return;
    if (this.prewarmPromise) return this.prewarmPromise;
    const allocation = runGpuAllocationTransaction(
      this.device,
      "Scratch Riempimento WebGPU",
      (transaction) => {
        const create = (label: string, size: number, usage: GPUBufferUsageFlags): GPUBuffer => {
          const buffer = this.device.createBuffer({ label, size, usage });
          transaction.deferRollback(() => buffer.destroy());
          return buffer;
        };
        const packedLabels = create(
          "Riempimento · label locali u8 packed",
          FILL_LABEL_BUFFER_BYTES,
          GPUBufferUsage.STORAGE,
        );
        const globalParents = create(
          "Riempimento · parent componenti globali",
          FILL_PARENT_BUFFER_BYTES,
          GPUBufferUsage.STORAGE,
        );
        const activeParentNodes = create(
          "Riempimento · componenti attive",
          FILL_ACTIVE_NODE_BUFFER_BYTES,
          GPUBufferUsage.STORAGE,
        );
        const selectedMask = create(
          "Riempimento · maschera selezionata 1 bit",
          FILL_HISTORY_MASK_BYTES,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        );
        const activeBlocks = create(
          "Riempimento · blocchi selezionati",
          FILL_ACTIVE_BLOCK_BUFFER_BYTES,
          GPUBufferUsage.STORAGE,
        );
        const metadata = create(
          "Riempimento · metadati",
          FILL_METADATA_BUFFER_BYTES,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        );
        const drawIndirect = create(
          "Riempimento · draw indiretto blocchi",
          FILL_INDIRECT_BUFFER_BYTES,
          GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        );
        const readback = create(
          "Riempimento · readback metadati",
          FILL_METADATA_BUFFER_BYTES,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        );
        const computeBindGroup = this.createComputeBindGroup({
          packedLabels,
          globalParents,
          activeParentNodes,
          selectedMask,
          activeBlocks,
          metadata,
          drawIndirect,
        });
        const renderBindGroup = this.device.createBindGroup({
          label: "Riempimento · render bind group",
          layout: this.renderBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: this.uniformBuffer, size: FILL_UNIFORM_BYTES } },
            { binding: 1, resource: { buffer: selectedMask } },
            { binding: 2, resource: { buffer: activeBlocks } },
          ],
        });
        return {
          packedLabels,
          globalParents,
          activeParentNodes,
          selectedMask,
          activeBlocks,
          metadata,
          drawIndirect,
          readback,
          computeBindGroup,
          renderBindGroup,
        };
      },
    );
    const pending = allocation.then((resources) => {
      if (this.destroyed) {
        this.destroyScratchResources(resources);
        throw new Error("Renderer Riempimento distrutto durante il prewarm.");
      }
      // Il livello può essere cambiato mentre l'allocazione chiude gli error
      // scope: ricrea il bind group con la view più recente prima di pubblicare.
      resources.computeBindGroup = this.createComputeBindGroup(resources);
      this.scratch = resources;
    });
    this.prewarmPromise = pending.finally(() => {
      this.prewarmPromise = null;
    });
    return this.prewarmPromise;
  }

  async waitForPrewarm(): Promise<void> {
    if (this.prewarmPromise) await this.prewarmPromise;
  }

  setSourceSamplingView(view: GPUTextureView): void {
    this.assertAlive();
    if (view === this.sourceSamplingView) {
      return;
    }
    this.sourceSamplingView = view;
    if (this.scratch) {
      this.scratch.computeBindGroup = this.createComputeBindGroup(this.scratch);
    }
  }

  async analyze(
    seedX: number,
    seedY: number,
    tolerance: number,
    fillColor: readonly [number, number, number, number],
  ): Promise<FillAnalysis> {
    await this.prewarm();
    const scratch = this.requireScratch();
    const x = Math.floor(seedX);
    const y = Math.floor(seedY);
    if (x < 0 || y < 0 || x >= LAYER_SIZE || y >= LAYER_SIZE) {
      throw new RangeError("Il punto di riempimento è fuori dal livello.");
    }
    const upload = new ArrayBuffer(FILL_UNIFORM_BYTES);
    const unsigned = new Uint32Array(upload);
    const floats = new Float32Array(upload);
    unsigned[0] = x;
    unsigned[1] = y;
    unsigned[2] = LAYER_SIZE;
    unsigned[3] = LAYER_SIZE;
    floats[4] = tolerance;
    floats.set(fillColor, 8);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, upload);

    const initialMetadata = new Uint32Array(FILL_METADATA_WORDS);
    initialMetadata[FILL_META_MIN_X] = 0xffffffff;
    initialMetadata[FILL_META_MIN_Y] = 0xffffffff;
    this.device.queue.writeBuffer(scratch.metadata, 0, initialMetadata);
    this.device.queue.writeBuffer(scratch.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));

    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Riempimento · analisi" });
    encoder.clearBuffer(scratch.selectedMask);
    const labelPass = encoder.beginComputePass({
      label: "Riempimento · CCL locale e unione bordi",
    });
    labelPass.setBindGroup(0, scratch.computeBindGroup);
    labelPass.setPipeline(this.classifyPipeline);
    labelPass.dispatchWorkgroups(FILL_BLOCK_GRID_SIZE, FILL_BLOCK_GRID_SIZE);
    labelPass.setPipeline(this.boundaryPipeline);
    labelPass.dispatchWorkgroups(FILL_BLOCK_GRID_SIZE, FILL_BLOCK_GRID_SIZE);
    labelPass.end();

    const selectionPass = encoder.beginComputePass({
      label: "Riempimento · compressione e selezione seed",
    });
    selectionPass.setBindGroup(0, scratch.computeBindGroup);
    selectionPass.setPipeline(this.compressPipeline);
    selectionPass.dispatchWorkgroups(FILL_BLOCK_GRID_SIZE);
    selectionPass.setPipeline(this.selectPipeline);
    selectionPass.dispatchWorkgroups(FILL_BLOCK_GRID_SIZE, FILL_BLOCK_GRID_SIZE);
    selectionPass.end();
    encoder.copyBufferToBuffer(
      scratch.metadata,
      0,
      scratch.readback,
      0,
      FILL_METADATA_BYTES,
    );
    this.device.queue.submit([encoder.finish()]);
    await scratch.readback.mapAsync(GPUMapMode.READ, 0, FILL_METADATA_BYTES);
    const metadata = new Uint32Array(
      scratch.readback.getMappedRange(0, FILL_METADATA_BYTES).slice(0),
    );
    scratch.readback.unmap();
    const selectedPixels = metadata[FILL_META_SELECTED_PIXELS];
    if (selectedPixels === 0) {
      throw new Error(
        "Il seed del riempimento non appartiene ad alcuna componente "
        + `(componenti=${metadata[FILL_META_ACTIVE_COMPONENTS]}, `
        + `blocchi=${metadata[FILL_META_ACTIVE_BLOCKS]}, `
        + `diag=${metadata[FILL_META_DIAGNOSTIC]}, `
        + `bounds=${metadata[FILL_META_MIN_X]},${metadata[FILL_META_MIN_Y]}–`
        + `${metadata[FILL_META_MAX_X]},${metadata[FILL_META_MAX_Y]}).`,
      );
    }
    const tileMask = metadata.slice(
      FILL_META_TILE_MASK_START,
      FILL_META_TILE_MASK_START + FILL_TILE_MASK_WORDS,
    );
    return {
      selectedPixels,
      activeComponents: metadata[FILL_META_ACTIVE_COMPONENTS],
      activeBlocks: metadata[FILL_META_ACTIVE_BLOCKS],
      activeTiles: countFillTiles(tileMask),
      bounds: {
        x: metadata[FILL_META_MIN_X],
        y: metadata[FILL_META_MIN_Y],
        width: metadata[FILL_META_MAX_X] - metadata[FILL_META_MIN_X],
        height: metadata[FILL_META_MAX_Y] - metadata[FILL_META_MIN_Y],
      },
      tileMask,
      queueCompletionMs: performance.now() - startedAt,
    };
  }

  encodeLiveCommit(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    historySlice: GpuHistorySlice,
  ): void {
    const scratch = this.requireScratch();
    this.assertHistorySlice(historySlice);
    encoder.copyBufferToBuffer(
      scratch.selectedMask,
      0,
      historySlice.buffer,
      historySlice.offsetBytes,
      FILL_HISTORY_MASK_BYTES,
    );
    this.encodeRender(encoder, targetView, scratch);
  }

  encodeReplayCommit(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    historySlice: GpuHistorySlice,
    fillColor: readonly [number, number, number, number],
  ): void {
    const scratch = this.requireScratch();
    this.assertHistorySlice(historySlice);
    const upload = new Float32Array(FILL_UNIFORM_BYTES / 4);
    const unsigned = new Uint32Array(upload.buffer);
    unsigned[2] = LAYER_SIZE;
    unsigned[3] = LAYER_SIZE;
    upload.set(fillColor, 8);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, upload);
    this.device.queue.writeBuffer(scratch.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));
    encoder.copyBufferToBuffer(
      historySlice.buffer,
      historySlice.offsetBytes,
      scratch.selectedMask,
      0,
      FILL_HISTORY_MASK_BYTES,
    );
    encoder.clearBuffer(scratch.metadata);
    const pass = encoder.beginComputePass({ label: "Riempimento · ricostruzione lista blocchi" });
    pass.setPipeline(this.rebuildPipeline);
    pass.setBindGroup(0, scratch.computeBindGroup);
    pass.dispatchWorkgroups(FILL_BLOCK_GRID_SIZE, FILL_BLOCK_GRID_SIZE);
    pass.end();
    this.encodeRender(encoder, targetView, scratch);
  }

  releaseScratch(): void {
    const scratch = this.scratch;
    this.scratch = null;
    if (!scratch) return;
    this.destroyScratchResources(scratch);
  }

  private destroyScratchResources(scratch: FillScratchResources): void {
    scratch.packedLabels.destroy();
    scratch.globalParents.destroy();
    scratch.activeParentNodes.destroy();
    scratch.selectedMask.destroy();
    scratch.activeBlocks.destroy();
    scratch.metadata.destroy();
    scratch.drawIndirect.destroy();
    scratch.readback.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseScratch();
    this.uniformBuffer.destroy();
  }

  private createComputeBindGroup(resources: Omit<
    FillScratchResources,
    "computeBindGroup" | "renderBindGroup" | "readback"
  >): GPUBindGroup {
    return this.device.createBindGroup({
      label: "Riempimento · compute bind group",
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer, size: FILL_UNIFORM_BYTES } },
        { binding: 1, resource: this.sourceSamplingView },
        { binding: 2, resource: { buffer: resources.packedLabels } },
        { binding: 3, resource: { buffer: resources.globalParents } },
        { binding: 4, resource: { buffer: resources.activeParentNodes } },
        { binding: 5, resource: { buffer: resources.selectedMask } },
        { binding: 6, resource: { buffer: resources.activeBlocks } },
        { binding: 7, resource: { buffer: resources.metadata } },
        { binding: 8, resource: { buffer: resources.drawIndirect } },
      ],
    });
  }

  private encodeRender(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    scratch: FillScratchResources,
  ): void {
    const pass = encoder.beginRenderPass({
      label: "Riempimento · commit sul livello selezionato",
      colorAttachments: [{
        view: targetView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, scratch.renderBindGroup);
    pass.drawIndirect(scratch.drawIndirect, 0);
    pass.end();
  }

  private assertHistorySlice(slice: GpuHistorySlice): void {
    if (slice.logicalBytes !== FILL_HISTORY_MASK_BYTES) {
      throw new Error(
        `Maschera cronologia Fill ${slice.logicalBytes} B, attesi ${FILL_HISTORY_MASK_BYTES} B.`,
      );
    }
  }

  private requireScratch(): FillScratchResources {
    if (!this.scratch) {
      throw new Error("Scratch Riempimento non residente.");
    }
    return this.scratch;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("Renderer Riempimento già distrutto.");
    }
  }
}
