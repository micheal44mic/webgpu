import {
  FILL_ACTIVE_BLOCK_BUFFER_BYTES,
  FILL_ACTIVE_NODE_BUFFER_BYTES,
  FILL_BLOCK_COUNT,
  FILL_BLOCK_GRID_HEIGHT,
  FILL_BLOCK_GRID_WIDTH,
  FILL_HISTORY_MASK_BYTES,
  FILL_HISTORY_MASK_WORDS,
  FILL_INDIRECT_BUFFER_BYTES,
  FILL_DIAGNOSTIC_SEED_TRANSPARENT_BIT,
  FILL_LABEL_BUFFER_BYTES,
  FILL_LAYER_HEIGHT,
  FILL_LAYER_WIDTH,
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
  FILL_RENDER_MASK_BYTES,
  FILL_RESIDENT_SCRATCH_BYTES,
  FILL_TILE_MASK_WORDS,
  FILL_UNIFORM_BUFFER_BYTES,
  FILL_UNIFORM_BYTES,
  FILL_WORKGROUP_STORAGE_BYTES,
  countFillTiles,
  type FillAnalysis,
} from "./fill-core";
import type { LayerFormat } from "./engine-types";
import type { GpuHistorySlice } from "./gpu-history-storage";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  fillBitProbeShader,
  fillComputeShader,
  fillRenderShader,
  fillSelectionIntersectionShader,
} from "./fill-shaders";

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
  readonly destinationSnapshotTexture: GPUTexture;
  readonly destinationSnapshotView: GPUTextureView;
  computeBindGroup: GPUBindGroup;
  readonly renderBindGroup: GPUBindGroup;
}

export interface FillBitProbeDiagnostic {
  readonly ok: boolean;
  readonly directStoreHex?: string;
  readonly atomicOrHex?: string;
  readonly dynamicLookupHex?: string;
  readonly dynamicShiftHex?: string;
  readonly highBitTest?: number;
  readonly allHighBitPathsCorrect?: boolean;
  readonly error?: string;
}

export interface FillRendererDiagnosticReadback {
  readonly sequence: number;
  readonly seedX: number;
  readonly seedY: number;
  readonly tolerance: number;
  readonly fillColor: readonly [number, number, number, number];
  readonly analysis: FillAnalysis;
  readonly maskWords: Uint32Array;
  readonly drawIndirect: readonly number[];
  readonly readbackMs: number;
  readonly bitProbe: FillBitProbeDiagnostic;
}

interface LastFillDiagnosticInput {
  readonly sequence: number;
  readonly seedX: number;
  readonly seedY: number;
  readonly tolerance: number;
  readonly fillColor: readonly [number, number, number, number];
  readonly analysis: FillAnalysis;
}

function diagnosticHex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
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
  readonly selectionIntersectionBindGroupLayout: GPUBindGroupLayout;
  private readonly layerFormat: LayerFormat;
  private sourceSamplingView: GPUTextureView;
  private classifyPipeline!: GPUComputePipeline;
  private boundaryPipeline!: GPUComputePipeline;
  private compressPipeline!: GPUComputePipeline;
  private selectPipeline!: GPUComputePipeline;
  private rebuildPipeline!: GPUComputePipeline;
  private expandRenderMaskPipeline!: GPUComputePipeline;
  private selectionIntersectionPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private bitProbePipelinePromise: Promise<GPUComputePipeline> | null = null;
  private scratch: FillScratchResources | null = null;
  private prewarmPromise: Promise<void> | null = null;
  private lastDiagnosticInput: LastFillDiagnosticInput | null = null;
  private diagnosticSequence = 0;
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
      throw new Error(
        `I limiti compute della GPU non supportano il Riempimento `
        + `${FILL_LAYER_WIDTH}×${FILL_LAYER_HEIGHT}.`,
      );
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
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      ],
    });
    this.selectionIntersectionBindGroupLayout = this.device.createBindGroupLayout({
      label: "Riempimento · intersezione Selezione pixel",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
  }

  get resident(): boolean {
    return this.scratch !== null;
  }

  get residentBytes(): number {
    if (!this.resident) return FILL_UNIFORM_BUFFER_BYTES;
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    return FILL_RESIDENT_SCRATCH_BYTES
      + FILL_LAYER_WIDTH * FILL_LAYER_HEIGHT * bytesPerPixel;
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
    const intersectionModule = this.device.createShaderModule({
      label: "Riempimento · intersezione con Selezione pixel",
      code: fillSelectionIntersectionShader,
    });
    await assertShaderModules([
      { label: "compute", module: computeModule },
      { label: "render", module: renderModule },
      { label: "intersezione selezione", module: intersectionModule },
    ]);
    const computeLayout = this.device.createPipelineLayout({
      label: "Riempimento · compute pipeline layout",
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    const renderLayout = this.device.createPipelineLayout({
      label: "Riempimento · render pipeline layout",
      bindGroupLayouts: [this.renderBindGroupLayout],
    });
    const intersectionLayout = this.device.createPipelineLayout({
      label: "Riempimento · pipeline layout intersezione Selezione pixel",
      bindGroupLayouts: [this.selectionIntersectionBindGroupLayout],
    });
    const computePipelines = await Promise.all([
      "classifyLocal",
      "unionBoundaries",
      "compressComponents",
      "selectSeedComponent",
      "rebuildSelection",
      "expandRenderMask",
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
      this.expandRenderMaskPipeline,
    ] = computePipelines;
    this.selectionIntersectionPipeline = await this.device.createComputePipelineAsync({
      label: "Riempimento · candidato ∩ Selezione pixel",
      layout: intersectionLayout,
      compute: { module: intersectionModule, entryPoint: "intersectFillWithSelection" },
    });
    this.renderPipeline = await this.device.createRenderPipelineAsync({
      label: `Riempimento · colore pieno sotto snapshot ${this.layerFormat}`,
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
        if (FILL_RENDER_MASK_BYTES > FILL_LABEL_BUFFER_BYTES) {
          throw new Error("La mask render Fill non entra nello scratch label riutilizzato.");
        }
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
          GPUBufferUsage.STORAGE
            | GPUBufferUsage.INDIRECT
            | GPUBufferUsage.COPY_SRC
            | GPUBufferUsage.COPY_DST,
        );
        const readback = create(
          "Riempimento · readback metadati",
          FILL_METADATA_BUFFER_BYTES,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        );
        const destinationSnapshotTexture = this.device.createTexture({
          label: `Riempimento · snapshot destinazione ${this.layerFormat}`,
          size: {
            width: FILL_LAYER_WIDTH,
            height: FILL_LAYER_HEIGHT,
            depthOrArrayLayers: 1,
          },
          format: this.layerFormat,
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => destinationSnapshotTexture.destroy());
        const destinationSnapshotView = destinationSnapshotTexture.createView({
          label: `Riempimento · view snapshot destinazione ${this.layerFormat}`,
        });
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
            // Dopo la CCL, packedLabels viene riutilizzato come mask render a
            // word low-8-bit. selectedMask resta autorevole per History.
            { binding: 1, resource: { buffer: packedLabels, size: FILL_RENDER_MASK_BYTES } },
            { binding: 2, resource: { buffer: activeBlocks } },
            { binding: 3, resource: destinationSnapshotView },
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
          destinationSnapshotTexture,
          destinationSnapshotView,
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
    selectionMask: GPUBuffer | null = null,
    transparentSeedTolerancePercent: number | null = null,
  ): Promise<FillAnalysis> {
    await this.prewarm();
    const scratch = this.requireScratch();
    const x = Math.floor(seedX);
    const y = Math.floor(seedY);
    if (x < 0 || y < 0 || x >= FILL_LAYER_WIDTH || y >= FILL_LAYER_HEIGHT) {
      throw new RangeError("Il punto di riempimento è fuori dal livello.");
    }
    const upload = new ArrayBuffer(FILL_UNIFORM_BYTES);
    const unsigned = new Uint32Array(upload);
    const floats = new Float32Array(upload);
    unsigned[0] = x;
    unsigned[1] = y;
    unsigned[2] = FILL_LAYER_WIDTH;
    unsigned[3] = FILL_LAYER_HEIGHT;
    floats[4] = tolerance;
    floats[5] = transparentSeedTolerancePercent === null
      ? -1
      : Math.min(1, Math.max(0, transparentSeedTolerancePercent / 100));
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
    labelPass.dispatchWorkgroups(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT);
    labelPass.setPipeline(this.boundaryPipeline);
    labelPass.dispatchWorkgroups(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT);
    labelPass.end();

    const selectionPass = encoder.beginComputePass({
      label: "Riempimento · compressione e selezione seed",
    });
    selectionPass.setBindGroup(0, scratch.computeBindGroup);
    selectionPass.setPipeline(this.compressPipeline);
    selectionPass.dispatchWorkgroups(Math.ceil(FILL_BLOCK_COUNT / 256));
    selectionPass.setPipeline(this.selectPipeline);
    selectionPass.dispatchWorkgroups(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT);
    selectionPass.end();
    if (!selectionMask) {
      encoder.copyBufferToBuffer(
        scratch.metadata,
        0,
        scratch.readback,
        0,
        FILL_METADATA_BYTES,
      );
    }
    this.device.queue.submit([encoder.finish()]);

    if (selectionMask) {
      const clippedMetadata = new Uint32Array(FILL_METADATA_WORDS);
      clippedMetadata[FILL_META_MIN_X] = 0xffffffff;
      clippedMetadata[FILL_META_MIN_Y] = 0xffffffff;
      // Preserve the source-seed diagnostic written by classifyLocal. The
      // intersection pass rebuilds every summary field except this word.
      this.device.queue.writeBuffer(
        scratch.metadata,
        0,
        clippedMetadata.subarray(0, FILL_META_DIAGNOSTIC),
      );
      this.device.queue.writeBuffer(
        scratch.metadata,
        (FILL_META_DIAGNOSTIC + 1) * 4,
        clippedMetadata.subarray(FILL_META_DIAGNOSTIC + 1),
      );
      this.device.queue.writeBuffer(scratch.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));
      const clipBindGroup = this.device.createBindGroup({
        label: "Riempimento · bind candidato ∩ selezione",
        layout: this.selectionIntersectionBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: scratch.selectedMask } },
          { binding: 1, resource: { buffer: selectionMask } },
        ],
      });
      const clipEncoder = this.device.createCommandEncoder({
        label: "Riempimento · applica Selezione pixel",
      });
      const clipPass = clipEncoder.beginComputePass({
        label: "Riempimento · intersezione e sommario",
      });
      clipPass.setPipeline(this.selectionIntersectionPipeline);
      clipPass.setBindGroup(0, clipBindGroup);
      clipPass.dispatchWorkgroups(Math.ceil(FILL_HISTORY_MASK_WORDS / 256));
      clipPass.setPipeline(this.rebuildPipeline);
      clipPass.setBindGroup(0, scratch.computeBindGroup);
      clipPass.dispatchWorkgroups(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT);
      clipPass.end();
      clipEncoder.copyBufferToBuffer(
        scratch.metadata,
        0,
        scratch.readback,
        0,
        FILL_METADATA_BYTES,
      );
      this.device.queue.submit([clipEncoder.finish()]);
    }
    await scratch.readback.mapAsync(GPUMapMode.READ, 0, FILL_METADATA_BYTES);
    const metadata = new Uint32Array(
      scratch.readback.getMappedRange(0, FILL_METADATA_BYTES).slice(0),
    );
    scratch.readback.unmap();
    const selectedPixels = metadata[FILL_META_SELECTED_PIXELS];
    if (selectedPixels === 0) {
      if (selectionMask) {
        throw new Error("Il Riempimento non interseca la Selezione pixel attiva.");
      }
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
    const analysis: FillAnalysis = {
      selectedPixels,
      activeComponents: metadata[FILL_META_ACTIVE_COMPONENTS],
      activeBlocks: metadata[FILL_META_ACTIVE_BLOCKS],
      activeTiles: countFillTiles(tileMask),
      sourceSeedTransparent:
        (metadata[FILL_META_DIAGNOSTIC] & FILL_DIAGNOSTIC_SEED_TRANSPARENT_BIT) !== 0,
      bounds: {
        x: metadata[FILL_META_MIN_X],
        y: metadata[FILL_META_MIN_Y],
        width: metadata[FILL_META_MAX_X] - metadata[FILL_META_MIN_X],
        height: metadata[FILL_META_MAX_Y] - metadata[FILL_META_MIN_Y],
      },
      tileMask,
      queueCompletionMs: performance.now() - startedAt,
    };
    this.diagnosticSequence += 1;
    this.lastDiagnosticInput = {
      sequence: this.diagnosticSequence,
      seedX: x,
      seedY: y,
      tolerance,
      fillColor: [...fillColor],
      analysis: {
        ...analysis,
        bounds: { ...analysis.bounds },
        tileMask: analysis.tileMask.slice(),
      },
    };
    return analysis;
  }

  /**
   * User-triggered probe for the Copy report. The raw 2 MiB mask is returned to
   * the runtime only long enough to reduce it to counters; it is never retained
   * or serialized. No diagnostic allocation exists during ordinary Fill use.
   */
  async captureDiagnostics(): Promise<FillRendererDiagnosticReadback> {
    this.assertAlive();
    const scratch = this.requireScratch();
    const input = this.lastDiagnosticInput;
    if (!input) {
      throw new Error("Nessuna analisi Fill corrente disponibile per la diagnosi.");
    }
    const readbackBytes = FILL_HISTORY_MASK_BYTES + FILL_INDIRECT_BUFFER_BYTES;
    const readback = this.device.createBuffer({
      label: "Riempimento · diagnosi mask e draw indiretto",
      size: readbackBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const startedAt = performance.now();
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Riempimento · cattura diagnostica",
      });
      encoder.copyBufferToBuffer(
        scratch.selectedMask,
        0,
        readback,
        0,
        FILL_HISTORY_MASK_BYTES,
      );
      encoder.copyBufferToBuffer(
        scratch.drawIndirect,
        0,
        readback,
        FILL_HISTORY_MASK_BYTES,
        FILL_INDIRECT_BUFFER_BYTES,
      );
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          readback.mapAsync(GPUMapMode.READ),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Diagnosi Fill: timeout readback mask dopo 10 s.")),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer !== 0) window.clearTimeout(timer);
      }
      mapped = true;
      const bytes = new Uint8Array(readback.getMappedRange());
      const maskWords = new Uint32Array(
        bytes.slice(0, FILL_HISTORY_MASK_BYTES).buffer,
      );
      const drawIndirect = [...new Uint32Array(
        bytes.slice(FILL_HISTORY_MASK_BYTES, readbackBytes).buffer,
      )];
      const readbackMs = performance.now() - startedAt;
      const bitProbe = await this.captureBitProbe().catch((error): FillBitProbeDiagnostic => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return {
        sequence: input.sequence,
        seedX: input.seedX,
        seedY: input.seedY,
        tolerance: input.tolerance,
        fillColor: [...input.fillColor],
        analysis: {
          ...input.analysis,
          bounds: { ...input.analysis.bounds },
          tileMask: input.analysis.tileMask.slice(),
        },
        maskWords,
        drawIndirect,
        readbackMs,
        bitProbe,
      };
    } finally {
      if (mapped) readback.unmap();
      readback.destroy();
    }
  }

  private async captureBitProbe(): Promise<FillBitProbeDiagnostic> {
    if (!this.bitProbePipelinePromise) {
      const module = this.device.createShaderModule({
        label: "Riempimento · shader diagnosi bit 31",
        code: fillBitProbeShader,
      });
      this.bitProbePipelinePromise = this.device.createComputePipelineAsync({
        label: "Riempimento · pipeline diagnosi bit 31",
        layout: "auto",
        compute: { module, entryPoint: "probeBit31" },
      }).catch((error) => {
        this.bitProbePipelinePromise = null;
        throw error;
      });
    }
    let pipelineTimer = 0;
    const pipeline = await Promise.race([
      this.bitProbePipelinePromise,
      new Promise<never>((_, reject) => {
        pipelineTimer = window.setTimeout(
          () => reject(new Error("Diagnosi Fill: timeout compilazione microtest dopo 10 s.")),
          10_000,
        );
      }),
    ]).finally(() => {
      if (pipelineTimer !== 0) window.clearTimeout(pipelineTimer);
    });
    const uniform = this.device.createBuffer({
      label: "Riempimento · uniforme diagnosi bit 31",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const results = this.device.createBuffer({
      label: "Riempimento · risultati diagnosi bit 31",
      size: 256,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const readback = this.device.createBuffer({
      label: "Riempimento · readback diagnosi bit 31",
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    let mapped = false;
    try {
      this.device.queue.writeBuffer(uniform, 0, new Uint32Array([31, 0, 0, 0]));
      const bindGroup = this.device.createBindGroup({
        label: "Riempimento · bind diagnosi bit 31",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: results } },
        ],
      });
      const encoder = this.device.createCommandEncoder({
        label: "Riempimento · esegui diagnosi bit 31",
      });
      encoder.clearBuffer(results);
      const pass = encoder.beginComputePass({ label: "Riempimento · probe bit 31" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      encoder.copyBufferToBuffer(results, 0, readback, 0, 20);
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          readback.mapAsync(GPUMapMode.READ, 0, 20),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Diagnosi Fill: timeout microtest bit 31 dopo 10 s.")),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timer !== 0) window.clearTimeout(timer);
      }
      mapped = true;
      const values = new Uint32Array(readback.getMappedRange(0, 20).slice(0));
      const correct = values[0] === 0x80000000
        && values[1] === 0x80000000
        && values[2] === 0x80000000
        && values[3] === 0x80000000
        && values[4] === 1;
      return {
        ok: true,
        directStoreHex: diagnosticHex(values[0]),
        atomicOrHex: diagnosticHex(values[1]),
        dynamicLookupHex: diagnosticHex(values[2]),
        dynamicShiftHex: diagnosticHex(values[3]),
        highBitTest: values[4],
        allHighBitPathsCorrect: correct,
      };
    } finally {
      if (mapped) readback.unmap();
      uniform.destroy();
      results.destroy();
      readback.destroy();
    }
  }

  /**
   * Espone la candidate mask dell'ultima CCL a un altro runtime GPU. Il buffer
   * resta di proprietà del renderer Fill e non deve sopravvivere a un nuovo
   * analyze() o a releaseScratch().
   */
  getAnalyzedSelectionMaskBuffer(): GPUBuffer {
    return this.requireScratch().selectedMask;
  }

  encodeLiveCommit(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    targetView: GPUTextureView,
    historySlice: GpuHistorySlice,
    replaceSelectedColor: boolean,
  ): void {
    const scratch = this.requireScratch();
    this.assertHistorySlice(historySlice);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      6 * 4,
      new Uint32Array([replaceSelectedColor ? 1 : 0]),
    );
    this.encodeDestinationSnapshotCopy(encoder, targetTexture, scratch);
    const pass = encoder.beginComputePass({
      label: "Riempimento · espansione mask low-8-bit per commit live",
    });
    pass.setPipeline(this.expandRenderMaskPipeline);
    pass.setBindGroup(0, scratch.computeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(FILL_HISTORY_MASK_WORDS / 256));
    pass.end();
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
    targetTexture: GPUTexture,
    targetView: GPUTextureView,
    historySlice: GpuHistorySlice,
    fillColor: readonly [number, number, number, number],
    replaceSelectedColor: boolean,
  ): void {
    const scratch = this.requireScratch();
    // Replay replaces selectedMask with a historical payload. Do not associate
    // a later Copy report with the seed/metadata of the previous live analyze.
    this.lastDiagnosticInput = null;
    this.assertHistorySlice(historySlice);
    this.encodeDestinationSnapshotCopy(encoder, targetTexture, scratch);
    const upload = new Float32Array(FILL_UNIFORM_BYTES / 4);
    const unsigned = new Uint32Array(upload.buffer);
    unsigned[2] = FILL_LAYER_WIDTH;
    unsigned[3] = FILL_LAYER_HEIGHT;
    unsigned[6] = replaceSelectedColor ? 1 : 0;
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
    pass.dispatchWorkgroups(FILL_BLOCK_GRID_WIDTH, FILL_BLOCK_GRID_HEIGHT);
    pass.setPipeline(this.expandRenderMaskPipeline);
    pass.dispatchWorkgroups(Math.ceil(FILL_HISTORY_MASK_WORDS / 256));
    pass.end();
    this.encodeRender(encoder, targetView, scratch);
  }

  releaseScratch(): void {
    const scratch = this.scratch;
    this.scratch = null;
    this.lastDiagnosticInput = null;
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
    scratch.destinationSnapshotTexture.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseScratch();
    this.uniformBuffer.destroy();
  }

  private createComputeBindGroup(resources: Omit<
    FillScratchResources,
    | "computeBindGroup"
    | "renderBindGroup"
    | "readback"
    | "destinationSnapshotTexture"
    | "destinationSnapshotView"
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
    pass.setBindGroup(0, scratch.renderBindGroup);
    pass.setPipeline(this.renderPipeline);
    pass.drawIndirect(scratch.drawIndirect, 0);
    pass.end();
  }

  private encodeDestinationSnapshotCopy(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    scratch: FillScratchResources,
  ): void {
    encoder.copyTextureToTexture(
      { texture: targetTexture },
      { texture: scratch.destinationSnapshotTexture },
      {
        width: FILL_LAYER_WIDTH,
        height: FILL_LAYER_HEIGHT,
        depthOrArrayLayers: 1,
      },
    );
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
