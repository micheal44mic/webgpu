import type { VectorTextViewState } from "./vector-text-types";
import type { DocumentStorageColorSpace, LayerFormat } from "./engine-types";
import { runGpuAllocationTransaction, type GpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  SELECTION_LASSO_SPAN_BUFFER_BYTES,
  SELECTION_LASSO_SPAN_BYTES,
  SELECTION_METADATA_BUFFER_BYTES,
  SELECTION_METADATA_BYTES,
  SELECTION_METADATA_WORDS,
  SELECTION_META_MAX_X,
  SELECTION_META_MAX_Y,
  SELECTION_META_MIN_X,
  SELECTION_META_MIN_Y,
  SELECTION_META_SELECTED_PIXELS,
  SELECTION_META_TILE_MASK_START,
  SELECTION_OPERATION_UNIFORM_BUFFER_BYTES,
  SELECTION_OPERATION_UNIFORM_BYTES,
  SELECTION_OVERLAY_UNIFORM_BUFFER_BYTES,
  SELECTION_OVERLAY_UNIFORM_BYTES,
  SELECTION_TILE_MASK_WORDS,
  countSelectionTiles,
  currentSelectionDocumentMetrics,
  selectionCombineModeCode,
  type LassoSpanRaster,
  type PixelSelectionState,
  type SelectionCombineMode,
  type SelectionDocumentMetrics,
} from "./selection-core";
import {
  createSelectionComputeShader,
  selectionOverlayShader,
  selectionSourceStorageProfileKey,
  type SelectionSourceStorageProfile,
} from "./selection-shaders";

interface SelectionRendererOptions {
  readonly device: GPUDevice;
  readonly layerFormat: LayerFormat;
  readonly documentStorageColorSpace: DocumentStorageColorSpace;
  readonly sourceSamplingView: GPUTextureView;
  readonly overlayCanvas: HTMLCanvasElement;
}

export interface SelectionSummary {
  readonly selectedPixels: number;
  readonly activeTiles: number;
  readonly bounds: PixelSelectionState["bounds"];
  readonly queueCompletionMs: number;
}

interface SelectionGpuProgram {
  /** Keep modules/layouts strongly reachable with their device-resident pipelines. */
  readonly device: GPUDevice;
  readonly computeModule: GPUShaderModule;
  readonly overlayModule: GPUShaderModule;
  readonly computeBindGroupLayout: GPUBindGroupLayout;
  readonly overlayBindGroupLayout: GPUBindGroupLayout;
  readonly computePipelineLayout: GPUPipelineLayout;
  readonly overlayPipelineLayout: GPUPipelineLayout;
  readonly combinePipeline: GPUComputePipeline;
  readonly summarizePipeline: GPUComputePipeline;
  readonly overlayPipeline: GPURenderPipeline;
  readonly optionalComputePipelines: Map<
    SelectionOptionalComputeEntryPoint,
    Promise<GPUComputePipeline>
  >;
}

type SelectionOptionalComputeEntryPoint =
  | "selectGlobalColor"
  | "rasterizeLassoSpans"
  | "invertSelection"
  | "translateExternalMask";

/**
 * Selection programs belong to the WebGPU device session, not to a document.
 * Large masks and operation buffers remain renderer-owned and can therefore be
 * released while this small program bundle stays warm for the next document.
 */
const selectionGpuPrograms = new WeakMap<
  GPUDevice,
  Map<string, Promise<SelectionGpuProgram>>
>();

function selectionGpuProgramKey(
  overlayFormat: GPUTextureFormat,
  sourceProfile: SelectionSourceStorageProfile,
): string {
  return `${overlayFormat}:${selectionSourceStorageProfileKey(sourceProfile)}`;
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
    throw new Error(`Invalid Pixel Selection WGSL shader:\n${errors.join("\n")}`);
  }
}

async function createSelectionGpuProgram(
  device: GPUDevice,
  overlayFormat: GPUTextureFormat,
  sourceProfile: SelectionSourceStorageProfile,
): Promise<SelectionGpuProgram> {
  const computeModule = device.createShaderModule({
    label: "Pixel Selection · session compute",
    code: createSelectionComputeShader(sourceProfile),
  });
  const overlayModule = device.createShaderModule({
    label: "Pixel Selection · session overlay",
    code: selectionOverlayShader,
  });
  await assertShaderModules([
    { label: "compute", module: computeModule },
    { label: "overlay", module: overlayModule },
  ]);

  const computeBindGroupLayout = device.createBindGroupLayout({
    label: "Pixel Selection · session compute bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform", minBindingSize: SELECTION_OPERATION_UNIFORM_BYTES } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const overlayBindGroupLayout = device.createBindGroupLayout({
    label: "Pixel Selection · session overlay bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: SELECTION_OVERLAY_UNIFORM_BYTES } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage", minBindingSize: SELECTION_METADATA_BYTES } },
    ],
  });
  const computePipelineLayout = device.createPipelineLayout({
    label: "Pixel Selection · session compute pipeline layout",
    bindGroupLayouts: [computeBindGroupLayout],
  });
  const overlayPipelineLayout = device.createPipelineLayout({
    label: "Pixel Selection · session overlay pipeline layout",
    bindGroupLayouts: [overlayBindGroupLayout],
  });
  const [[combinePipeline, summarizePipeline], overlayPipeline] = await Promise.all([
    Promise.all([
      "combineExternalMask",
      "summarizeSelection",
    ].map((entryPoint) => device.createComputePipelineAsync({
      label: `Pixel Selection · session ${entryPoint}`,
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint },
    }))),
    device.createRenderPipelineAsync({
      label: "Pixel Selection · session transparent overlay",
      layout: overlayPipelineLayout,
      vertex: { module: overlayModule, entryPoint: "vertexMain" },
      fragment: {
        module: overlayModule,
        entryPoint: "fragmentMain",
        targets: [{ format: overlayFormat }],
      },
      primitive: { topology: "triangle-list" },
    }),
  ]);
  return {
    device,
    computeModule,
    overlayModule,
    computeBindGroupLayout,
    overlayBindGroupLayout,
    computePipelineLayout,
    overlayPipelineLayout,
    combinePipeline,
    summarizePipeline,
    overlayPipeline,
    optionalComputePipelines: new Map(),
  };
}

function getSelectionOptionalComputePipeline(
  program: SelectionGpuProgram,
  entryPoint: SelectionOptionalComputeEntryPoint,
): Promise<GPUComputePipeline> {
  const cached = program.optionalComputePipelines.get(entryPoint);
  if (cached) return cached;
  const pending = program.device.createComputePipelineAsync({
    label: `Pixel Selection · session ${entryPoint}`,
    layout: program.computePipelineLayout,
    compute: { module: program.computeModule, entryPoint },
  });
  program.optionalComputePipelines.set(entryPoint, pending);
  void pending.catch(() => {
    if (program.optionalComputePipelines.get(entryPoint) === pending) {
      program.optionalComputePipelines.delete(entryPoint);
    }
  });
  return pending;
}

function getSelectionGpuProgram(
  device: GPUDevice,
  overlayFormat: GPUTextureFormat,
  sourceProfile: SelectionSourceStorageProfile,
): Promise<SelectionGpuProgram> {
  let programsByFormat = selectionGpuPrograms.get(device);
  if (!programsByFormat) {
    programsByFormat = new Map();
    selectionGpuPrograms.set(device, programsByFormat);
  }
  const programKey = selectionGpuProgramKey(overlayFormat, sourceProfile);
  const cached = programsByFormat.get(programKey);
  if (cached) return cached;

  const pending = createSelectionGpuProgram(device, overlayFormat, sourceProfile);
  programsByFormat.set(programKey, pending);
  void pending.catch(() => {
    if (programsByFormat?.get(programKey) === pending) {
      programsByFormat.delete(programKey);
    }
  });
  return pending;
}

export class SelectionRenderer {
  static async create(options: SelectionRendererOptions): Promise<SelectionRenderer> {
    return runGpuAllocationTransaction(
      options.device,
      "WebGPU Pixel Selection",
      async (transaction) => {
        const renderer = new SelectionRenderer(options, transaction);
        await renderer.initialize();
        return renderer;
      },
    );
  }

  readonly device: GPUDevice;
  readonly overlayCanvas: HTMLCanvasElement;
  readonly operationUniformBuffer: GPUBuffer;
  readonly overlayUniformBuffer: GPUBuffer;
  readonly lassoSpanBuffer: GPUBuffer;
  readonly metadataBuffer: GPUBuffer;
  readonly metadataReadback: GPUBuffer;
  readonly placeholderBuffer: GPUBuffer;
  computeBindGroupLayout!: GPUBindGroupLayout;
  overlayBindGroupLayout!: GPUBindGroupLayout;
  readonly overlayContext: GPUCanvasContext;
  readonly overlayFormat: GPUTextureFormat;
  private sourceSamplingView: GPUTextureView;
  private readonly sourceProfile: SelectionSourceStorageProfile;
  private frontMask: GPUBuffer;
  private backMask: GPUBuffer;
  private colorPreviewBaseMask: GPUBuffer;
  private gpuProgram!: SelectionGpuProgram;
  private combinePipeline!: GPUComputePipeline;
  private summarizePipeline!: GPUComputePipeline;
  private overlayPipeline!: GPURenderPipeline;
  private overlayBindGroup!: GPUBindGroup;
  private publishedTileMask = new Uint32Array(SELECTION_TILE_MASK_WORDS);
  private metrics: SelectionDocumentMetrics;
  private colorPreviewActive = false;
  private destroyed = false;

  private constructor(
    options: SelectionRendererOptions,
    transaction: GpuAllocationTransaction,
  ) {
    this.device = options.device;
    this.metrics = currentSelectionDocumentMetrics();
    this.overlayCanvas = options.overlayCanvas;
    this.sourceSamplingView = options.sourceSamplingView;
    this.sourceProfile = {
      layerFormat: options.layerFormat,
      colorSpace: options.documentStorageColorSpace,
    };
    const createBuffer = (
      label: string,
      size: number,
      usage: GPUBufferUsageFlags,
    ): GPUBuffer => {
      const buffer = this.device.createBuffer({ label, size, usage });
      transaction.deferRollback(() => buffer.destroy());
      return buffer;
    };
    const maskUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.frontMask = createBuffer("Pixel Selection · front 1-bit mask", this.metrics.maskBytes, maskUsage);
    this.backMask = createBuffer("Pixel Selection · back 1-bit mask", this.metrics.maskBytes, maskUsage);
    this.colorPreviewBaseMask = createBuffer(
      "Pixel Selection · 1-bit color preview base",
      this.metrics.maskBytes,
      maskUsage,
    );
    this.operationUniformBuffer = createBuffer(
      "Pixel Selection · operation uniforms",
      SELECTION_OPERATION_UNIFORM_BUFFER_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.overlayUniformBuffer = createBuffer(
      "Pixel Selection · overlay uniforms",
      SELECTION_OVERLAY_UNIFORM_BUFFER_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.lassoSpanBuffer = createBuffer(
      "Pixel Selection · lasso spans",
      SELECTION_LASSO_SPAN_BUFFER_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.metadataBuffer = createBuffer(
      "Pixel Selection · metadata",
      SELECTION_METADATA_BUFFER_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    );
    this.metadataReadback = createBuffer(
      "Pixel Selection · metadata readback",
      SELECTION_METADATA_BUFFER_BYTES,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    this.placeholderBuffer = createBuffer(
      "Pixel Selection · storage placeholder",
      SELECTION_LASSO_SPAN_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const context = this.overlayCanvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("Unable to obtain the WebGPU canvas for the selection overlay.");
    }
    this.overlayContext = context;
    this.overlayFormat = navigator.gpu.getPreferredCanvasFormat();
    this.overlayContext.configure({
      device: this.device,
      format: this.overlayFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    });
    transaction.deferRollback(() => this.overlayContext.unconfigure());
  }

  get residentBytes(): number {
    return this.metrics.residentBufferBytes;
  }

  get maskBuffer(): GPUBuffer {
    return this.frontMask;
  }

  get tileMask(): Uint32Array {
    return this.publishedTileMask.slice();
  }

  private async initialize(): Promise<void> {
    const program = await getSelectionGpuProgram(
      this.device,
      this.overlayFormat,
      this.sourceProfile,
    );
    this.gpuProgram = program;
    this.computeBindGroupLayout = program.computeBindGroupLayout;
    this.overlayBindGroupLayout = program.overlayBindGroupLayout;
    this.combinePipeline = program.combinePipeline;
    this.summarizePipeline = program.summarizePipeline;
    this.overlayPipeline = program.overlayPipeline;
    this.overlayBindGroup = this.createOverlayBindGroup(this.frontMask);
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · initialization" });
    encoder.clearBuffer(this.frontMask);
    encoder.clearBuffer(this.backMask);
    this.device.queue.submit([encoder.finish()]);
  }

  setSourceSamplingView(view: GPUTextureView): void {
    this.assertAlive();
    this.sourceSamplingView = view;
  }

  /**
   * Replaces only document-sized masks. Device-owned shader modules, layouts
   * and pipelines stay resident in the session cache.
   */
  async reconfigureDocument(
    width: number,
    height: number,
    sourceSamplingView: GPUTextureView,
  ): Promise<void> {
    this.assertAlive();
    const nextMetrics = currentSelectionDocumentMetrics(width, height);
    if (
      nextMetrics.layerWidth === this.metrics.layerWidth
      && nextMetrics.layerHeight === this.metrics.layerHeight
    ) {
      this.sourceSamplingView = sourceSamplingView;
      this.clearSelection();
      this.initializeMetadata();
      this.overlayCanvas.hidden = true;
      return;
    }

    const replacement = await runGpuAllocationTransaction(
      this.device,
      `WebGPU Pixel Selection ${width}×${height}`,
      async (transaction) => {
        const usage = GPUBufferUsage.STORAGE
          | GPUBufferUsage.COPY_SRC
          | GPUBufferUsage.COPY_DST;
        const create = (label: string): GPUBuffer => {
          const buffer = this.device.createBuffer({
            label,
            size: nextMetrics.maskBytes,
            usage,
          });
          transaction.deferRollback(() => buffer.destroy());
          return buffer;
        };
        const frontMask = create("Pixel Selection · replacement front 1-bit mask");
        const backMask = create("Pixel Selection · replacement back 1-bit mask");
        const colorPreviewBaseMask = create(
          "Pixel Selection · replacement color preview base",
        );
        const overlayBindGroup = this.createOverlayBindGroup(frontMask);
        const encoder = this.device.createCommandEncoder({
          label: "Pixel Selection · initialize replacement document masks",
        });
        encoder.clearBuffer(frontMask);
        encoder.clearBuffer(backMask);
        encoder.clearBuffer(colorPreviewBaseMask);
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        return { frontMask, backMask, colorPreviewBaseMask, overlayBindGroup };
      },
    );

    const previousFrontMask = this.frontMask;
    const previousBackMask = this.backMask;
    const previousColorPreviewBaseMask = this.colorPreviewBaseMask;
    this.frontMask = replacement.frontMask;
    this.backMask = replacement.backMask;
    this.colorPreviewBaseMask = replacement.colorPreviewBaseMask;
    this.overlayBindGroup = replacement.overlayBindGroup;
    this.metrics = nextMetrics;
    this.sourceSamplingView = sourceSamplingView;
    this.colorPreviewActive = false;
    this.publishedTileMask.fill(0);
    this.initializeMetadata();
    this.overlayCanvas.hidden = true;
    previousFrontMask.destroy();
    previousBackMask.destroy();
    previousColorPreviewBaseMask.destroy();
  }

  resizeOverlay(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (this.overlayCanvas.width !== nextWidth) this.overlayCanvas.width = nextWidth;
    if (this.overlayCanvas.height !== nextHeight) this.overlayCanvas.height = nextHeight;
  }

  beginColorRangePreview(): void {
    this.assertAlive();
    if (this.colorPreviewActive) return;
    const encoder = this.device.createCommandEncoder({
      label: "Pixel Selection · capture color preview base",
    });
    encoder.copyBufferToBuffer(
      this.frontMask,
      0,
      this.colorPreviewBaseMask,
      0,
      this.metrics.maskBytes,
    );
    this.device.queue.submit([encoder.finish()]);
    this.colorPreviewActive = true;
  }

  finishColorRangePreview(): void {
    this.colorPreviewActive = false;
  }

  async selectGlobalColor(
    targetColor: readonly [number, number, number, number],
    tolerance: number,
    combineMode: SelectionCombineMode,
  ): Promise<SelectionSummary> {
    this.assertAlive();
    const selectColorPipeline = await getSelectionOptionalComputePipeline(
      this.gpuProgram,
      "selectGlobalColor",
    );
    this.assertAlive();
    this.writeOperationUniforms(combineMode, 0, tolerance, targetColor);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.placeholderBuffer);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · global color" });
    this.prepareBackMask(
      encoder,
      combineMode,
      this.colorPreviewActive ? this.colorPreviewBaseMask : this.frontMask,
    );
    const pass = encoder.beginComputePass({ label: "Pixel Selection · color comparison" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(selectColorPipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async selectLasso(
    raster: LassoSpanRaster,
    combineMode: SelectionCombineMode,
  ): Promise<SelectionSummary> {
    this.assertAlive();
    const lassoPipeline = raster.spanCount > 0
      ? await getSelectionOptionalComputePipeline(
        this.gpuProgram,
        "rasterizeLassoSpans",
      )
      : null;
    this.assertAlive();
    this.finishColorRangePreview();
    if (raster.packedSpans.byteLength > SELECTION_LASSO_SPAN_BUFFER_BYTES) {
      throw new RangeError("The lasso spans exceed the preallocated GPU buffer.");
    }
    if (raster.packedSpans.byteLength > 0) {
      this.device.queue.writeBuffer(this.lassoSpanBuffer, 0, raster.packedSpans);
    }
    this.writeOperationUniforms(combineMode, raster.spanCount, 0, [0, 0, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.placeholderBuffer);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · lasso" });
    this.prepareBackMask(encoder, combineMode);
    const pass = encoder.beginComputePass({ label: "Pixel Selection · lasso spans" });
    pass.setBindGroup(0, bindGroup);
    if (raster.spanCount > 0) {
      pass.setPipeline(lassoPipeline!);
      pass.dispatchWorkgroups(Math.ceil(raster.spanCount / 64));
    }
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async combineExternalMask(
    candidateMask: GPUBuffer,
    combineMode: SelectionCombineMode,
  ): Promise<SelectionSummary> {
    this.assertAlive();
    this.finishColorRangePreview();
    this.writeOperationUniforms(combineMode, 0, 0, [0, 0, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, candidateMask);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · combine mask" });
    this.prepareBackMask(encoder, combineMode);
    const pass = encoder.beginComputePass({ label: "Pixel Selection · replace/add/subtract" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(this.combinePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async invertSelection(): Promise<SelectionSummary> {
    this.assertAlive();
    const invertPipeline = await getSelectionOptionalComputePipeline(
      this.gpuProgram,
      "invertSelection",
    );
    this.assertAlive();
    this.finishColorRangePreview();
    this.writeOperationUniforms("replace", 0, 0, [0, 0, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.frontMask);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · invert" });
    const pass = encoder.beginComputePass({ label: "Pixel Selection · inversion and summary" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(invertPipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async translateSelection(deltaX: number, deltaY: number): Promise<SelectionSummary> {
    this.assertAlive();
    const translatePipeline = await getSelectionOptionalComputePipeline(
      this.gpuProgram,
      "translateExternalMask",
    );
    this.assertAlive();
    this.finishColorRangePreview();
    const x = Math.round(deltaX);
    const y = Math.round(deltaY);
    this.writeOperationUniforms("replace", 0, 0, [x, y, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.frontMask);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({
      label: `Pixel Selection · translate ${x},${y}`,
    });
    encoder.clearBuffer(this.backMask);
    const pass = encoder.beginComputePass({ label: "Pixel Selection · translation and summary" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(translatePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(this.metrics.maskWords / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async restoreMaskSnapshot(
    sourceBuffer: GPUBuffer,
    sourceOffset: number,
    state: Pick<PixelSelectionState, "selectedPixels" | "activeTiles" | "bounds">,
    tileMask: Uint32Array,
  ): Promise<SelectionSummary> {
    this.assertAlive();
    this.finishColorRangePreview();
    if (tileMask.length !== SELECTION_TILE_MASK_WORDS) {
      throw new Error("The historical Pixel Selection tile mask is invalid.");
    }
    const metadata = new Uint32Array(SELECTION_METADATA_WORDS);
    metadata[SELECTION_META_MIN_X] = state.bounds?.x ?? 0xffffffff;
    metadata[SELECTION_META_MIN_Y] = state.bounds?.y ?? 0xffffffff;
    metadata[SELECTION_META_MAX_X] = state.bounds
      ? state.bounds.x + state.bounds.width
      : 0;
    metadata[SELECTION_META_MAX_Y] = state.bounds
      ? state.bounds.y + state.bounds.height
      : 0;
    metadata[SELECTION_META_SELECTED_PIXELS] = state.selectedPixels;
    metadata.set(tileMask, SELECTION_META_TILE_MASK_START);
    this.device.queue.writeBuffer(this.metadataBuffer, 0, metadata);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({
      label: "Pixel Selection · restore historical mask",
    });
    encoder.copyBufferToBuffer(
      sourceBuffer,
      sourceOffset,
      this.backMask,
      0,
      this.metrics.maskBytes,
    );
    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    this.publishBackMask();
    this.publishedTileMask.set(tileMask);
    return {
      selectedPixels: state.selectedPixels,
      activeTiles: state.activeTiles,
      bounds: state.bounds ? { ...state.bounds } : null,
      queueCompletionMs: performance.now() - startedAt,
    };
  }

  clearSelection(): void {
    this.assertAlive();
    this.finishColorRangePreview();
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · deselect" });
    encoder.clearBuffer(this.backMask);
    this.device.queue.submit([encoder.finish()]);
    this.publishBackMask();
    this.publishedTileMask.fill(0);
  }

  renderOverlay(
    view: VectorTextViewState,
    state: PixelSelectionState,
    offset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
  ): void {
    this.assertAlive();
    this.resizeOverlay(view.canvasWidth, view.canvasHeight);
    this.overlayCanvas.hidden = state.selectedPixels === 0;
    if (state.selectedPixels === 0) return;
    const upload = new ArrayBuffer(SELECTION_OVERLAY_UNIFORM_BYTES);
    const floats = new Float32Array(upload);
    const unsigned = new Uint32Array(upload);
    floats[0] = view.canvasWidth;
    floats[1] = view.canvasHeight;
    floats[2] = view.centerX;
    floats[3] = view.centerY;
    floats[4] = view.rotationCos;
    floats[5] = view.rotationSin;
    floats[6] = view.zoom;
    floats[7] = this.metrics.layerWidth;
    unsigned[8] = state.selectedPixels;
    unsigned[9] = this.metrics.layerHeight;
    floats[10] = offset.x;
    floats[11] = offset.y;
    this.device.queue.writeBuffer(this.overlayUniformBuffer, 0, upload);
    const encoder = this.device.createCommandEncoder({ label: "Pixel Selection · present overlay" });
    const pass = encoder.beginRenderPass({
      label: "Pixel Selection · separate overlay",
      colorAttachments: [{
        view: this.overlayContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.overlayPipeline);
    pass.setBindGroup(0, this.overlayBindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.overlayCanvas.hidden = true;
    this.frontMask.destroy();
    this.backMask.destroy();
    this.colorPreviewBaseMask.destroy();
    this.operationUniformBuffer.destroy();
    this.overlayUniformBuffer.destroy();
    this.lassoSpanBuffer.destroy();
    this.metadataBuffer.destroy();
    this.metadataReadback.destroy();
    this.placeholderBuffer.destroy();
    this.overlayContext.unconfigure();
    // Shader modules, layouts and pipelines intentionally remain in the
    // device-session cache. A later document allocates fresh masks and bind
    // groups while reusing the already compiled Selection program.
  }

  private createComputeBindGroup(targetMask: GPUBuffer, externalMask: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      label: "Pixel Selection · compute bind group",
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.operationUniformBuffer, size: SELECTION_OPERATION_UNIFORM_BYTES } },
        { binding: 1, resource: this.sourceSamplingView },
        { binding: 2, resource: { buffer: targetMask } },
        { binding: 3, resource: { buffer: externalMask } },
        { binding: 4, resource: { buffer: this.lassoSpanBuffer } },
        { binding: 5, resource: { buffer: this.metadataBuffer } },
      ],
    });
  }

  private writeOperationUniforms(
    combineMode: SelectionCombineMode,
    spanCount: number,
    tolerance: number,
    targetColor: readonly [number, number, number, number],
  ): void {
    const upload = new ArrayBuffer(SELECTION_OPERATION_UNIFORM_BYTES);
    const unsigned = new Uint32Array(upload);
    const floats = new Float32Array(upload);
    unsigned[0] = this.metrics.layerWidth;
    unsigned[1] = this.metrics.layerHeight;
    unsigned[2] = selectionCombineModeCode(combineMode);
    unsigned[3] = spanCount;
    floats[4] = tolerance;
    floats.set(targetColor, 8);
    this.device.queue.writeBuffer(this.operationUniformBuffer, 0, upload);
  }

  private initializeMetadata(): void {
    const metadata = new Uint32Array(SELECTION_METADATA_WORDS);
    metadata[SELECTION_META_MIN_X] = 0xffffffff;
    metadata[SELECTION_META_MIN_Y] = 0xffffffff;
    this.device.queue.writeBuffer(this.metadataBuffer, 0, metadata);
  }

  private prepareBackMask(
    encoder: GPUCommandEncoder,
    combineMode: SelectionCombineMode,
    sourceMask: GPUBuffer = this.frontMask,
  ): void {
    if (combineMode === "replace") {
      encoder.clearBuffer(this.backMask);
    } else {
      encoder.copyBufferToBuffer(sourceMask, 0, this.backMask, 0, this.metrics.maskBytes);
    }
  }

  private copyMetadataForReadback(encoder: GPUCommandEncoder): void {
    encoder.copyBufferToBuffer(
      this.metadataBuffer,
      0,
      this.metadataReadback,
      0,
      SELECTION_METADATA_BYTES,
    );
  }

  private async submitReadPublish(
    encoder: GPUCommandEncoder,
    startedAt: number,
  ): Promise<SelectionSummary> {
    this.device.queue.submit([encoder.finish()]);
    await this.metadataReadback.mapAsync(GPUMapMode.READ, 0, SELECTION_METADATA_BYTES);
    const metadata = new Uint32Array(
      this.metadataReadback.getMappedRange(0, SELECTION_METADATA_BYTES).slice(0),
    );
    this.metadataReadback.unmap();
    const selectedPixels = metadata[SELECTION_META_SELECTED_PIXELS];
    const tileMask = metadata.slice(
      SELECTION_META_TILE_MASK_START,
      SELECTION_META_TILE_MASK_START + SELECTION_TILE_MASK_WORDS,
    );
    const summary: SelectionSummary = {
      selectedPixels,
      activeTiles: countSelectionTiles(tileMask),
      bounds: selectedPixels === 0
        ? null
        : {
          x: metadata[SELECTION_META_MIN_X],
          y: metadata[SELECTION_META_MIN_Y],
          width: metadata[SELECTION_META_MAX_X] - metadata[SELECTION_META_MIN_X],
          height: metadata[SELECTION_META_MAX_Y] - metadata[SELECTION_META_MIN_Y],
        },
      queueCompletionMs: performance.now() - startedAt,
    };
    this.publishBackMask();
    this.publishedTileMask.set(tileMask);
    return summary;
  }

  private publishBackMask(): void {
    // Create every fallible WebGPU object before changing which mask is
    // authoritative. If allocation/validation throws, callers can still rely
    // on the old front mask and its metadata for transactional rollback.
    const nextOverlayBindGroup = this.createOverlayBindGroup(this.backMask);
    const previousFront = this.frontMask;
    this.frontMask = this.backMask;
    this.backMask = previousFront;
    this.overlayBindGroup = nextOverlayBindGroup;
  }

  private createOverlayBindGroup(mask: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      label: "Pixel Selection · overlay bind group",
      layout: this.overlayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.overlayUniformBuffer, size: SELECTION_OVERLAY_UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: mask } },
        { binding: 2, resource: { buffer: this.metadataBuffer, size: SELECTION_METADATA_BYTES } },
      ],
    });
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("The Pixel Selection renderer has already been destroyed.");
  }
}
