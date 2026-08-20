import type { VectorTextViewState } from "./vector-text-types";
import { runGpuAllocationTransaction, type GpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  SELECTION_LASSO_SPAN_BUFFER_BYTES,
  SELECTION_LASSO_SPAN_BYTES,
  SELECTION_LAYER_HEIGHT,
  SELECTION_LAYER_WIDTH,
  SELECTION_MASK_BYTES,
  SELECTION_MASK_WORDS,
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
  SELECTION_RESIDENT_BUFFER_BYTES,
  SELECTION_TILE_MASK_WORDS,
  countSelectionTiles,
  selectionCombineModeCode,
  type LassoSpanRaster,
  type PixelSelectionState,
  type SelectionCombineMode,
} from "./selection-core";
import { selectionComputeShader, selectionOverlayShader } from "./selection-shaders";

interface SelectionRendererOptions {
  readonly device: GPUDevice;
  readonly sourceSamplingView: GPUTextureView;
  readonly overlayCanvas: HTMLCanvasElement;
}

export interface SelectionSummary {
  readonly selectedPixels: number;
  readonly activeTiles: number;
  readonly bounds: PixelSelectionState["bounds"];
  readonly queueCompletionMs: number;
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
    throw new Error(`Shader Selezione pixel WGSL non valido:\n${errors.join("\n")}`);
  }
}

export class SelectionRenderer {
  static async create(options: SelectionRendererOptions): Promise<SelectionRenderer> {
    return runGpuAllocationTransaction(
      options.device,
      "Selezione pixel WebGPU",
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
  readonly computeBindGroupLayout: GPUBindGroupLayout;
  readonly overlayBindGroupLayout: GPUBindGroupLayout;
  readonly overlayContext: GPUCanvasContext;
  readonly overlayFormat: GPUTextureFormat;
  private sourceSamplingView: GPUTextureView;
  private frontMask: GPUBuffer;
  private backMask: GPUBuffer;
  private readonly colorPreviewBaseMask: GPUBuffer;
  private selectColorPipeline!: GPUComputePipeline;
  private lassoPipeline!: GPUComputePipeline;
  private combinePipeline!: GPUComputePipeline;
  private invertPipeline!: GPUComputePipeline;
  private translatePipeline!: GPUComputePipeline;
  private summarizePipeline!: GPUComputePipeline;
  private overlayPipeline!: GPURenderPipeline;
  private overlayBindGroup!: GPUBindGroup;
  private publishedTileMask = new Uint32Array(SELECTION_TILE_MASK_WORDS);
  private colorPreviewActive = false;
  private destroyed = false;

  private constructor(
    options: SelectionRendererOptions,
    transaction: GpuAllocationTransaction,
  ) {
    this.device = options.device;
    this.overlayCanvas = options.overlayCanvas;
    this.sourceSamplingView = options.sourceSamplingView;
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
    this.frontMask = createBuffer("Selezione pixel · maschera front 1-bit", SELECTION_MASK_BYTES, maskUsage);
    this.backMask = createBuffer("Selezione pixel · maschera back 1-bit", SELECTION_MASK_BYTES, maskUsage);
    this.colorPreviewBaseMask = createBuffer(
      "Selezione pixel · base anteprima colore 1-bit",
      SELECTION_MASK_BYTES,
      maskUsage,
    );
    this.operationUniformBuffer = createBuffer(
      "Selezione pixel · uniformi operazione",
      SELECTION_OPERATION_UNIFORM_BUFFER_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.overlayUniformBuffer = createBuffer(
      "Selezione pixel · uniformi overlay",
      SELECTION_OVERLAY_UNIFORM_BUFFER_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.lassoSpanBuffer = createBuffer(
      "Selezione pixel · span lazo",
      SELECTION_LASSO_SPAN_BUFFER_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.metadataBuffer = createBuffer(
      "Selezione pixel · metadati",
      SELECTION_METADATA_BUFFER_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    );
    this.metadataReadback = createBuffer(
      "Selezione pixel · readback metadati",
      SELECTION_METADATA_BUFFER_BYTES,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    this.placeholderBuffer = createBuffer(
      "Selezione pixel · placeholder storage",
      SELECTION_LASSO_SPAN_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    this.computeBindGroupLayout = this.device.createBindGroupLayout({
      label: "Selezione pixel · compute bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform", minBindingSize: SELECTION_OPERATION_UNIFORM_BYTES } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.overlayBindGroupLayout = this.device.createBindGroupLayout({
      label: "Selezione pixel · overlay bind group layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: SELECTION_OVERLAY_UNIFORM_BYTES } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage", minBindingSize: SELECTION_METADATA_BYTES } },
      ],
    });
    const context = this.overlayCanvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("Impossibile ottenere il canvas WebGPU dell'overlay selezione.");
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
    return SELECTION_RESIDENT_BUFFER_BYTES;
  }

  get maskBuffer(): GPUBuffer {
    return this.frontMask;
  }

  get tileMask(): Uint32Array {
    return this.publishedTileMask.slice();
  }

  private async initialize(): Promise<void> {
    const computeModule = this.device.createShaderModule({
      label: "Selezione pixel · compute",
      code: selectionComputeShader,
    });
    const overlayModule = this.device.createShaderModule({
      label: "Selezione pixel · overlay",
      code: selectionOverlayShader,
    });
    await assertShaderModules([
      { label: "compute", module: computeModule },
      { label: "overlay", module: overlayModule },
    ]);
    const computeLayout = this.device.createPipelineLayout({
      label: "Selezione pixel · compute pipeline layout",
      bindGroupLayouts: [this.computeBindGroupLayout],
    });
    const computePipelines = await Promise.all([
      "selectGlobalColor",
      "rasterizeLassoSpans",
      "combineExternalMask",
      "invertSelection",
      "translateExternalMask",
      "summarizeSelection",
    ].map((entryPoint) => this.device.createComputePipelineAsync({
      label: `Selezione pixel · ${entryPoint}`,
      layout: computeLayout,
      compute: { module: computeModule, entryPoint },
    })));
    [
      this.selectColorPipeline,
      this.lassoPipeline,
      this.combinePipeline,
      this.invertPipeline,
      this.translatePipeline,
      this.summarizePipeline,
    ] = computePipelines;
    const overlayLayout = this.device.createPipelineLayout({
      label: "Selezione pixel · overlay pipeline layout",
      bindGroupLayouts: [this.overlayBindGroupLayout],
    });
    this.overlayPipeline = await this.device.createRenderPipelineAsync({
      label: "Selezione pixel · overlay trasparente",
      layout: overlayLayout,
      vertex: { module: overlayModule, entryPoint: "vertexMain" },
      fragment: {
        module: overlayModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.overlayFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.overlayBindGroup = this.createOverlayBindGroup(this.frontMask);
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · inizializzazione" });
    encoder.clearBuffer(this.frontMask);
    encoder.clearBuffer(this.backMask);
    this.device.queue.submit([encoder.finish()]);
  }

  setSourceSamplingView(view: GPUTextureView): void {
    this.assertAlive();
    this.sourceSamplingView = view;
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
      label: "Selezione pixel · cattura base anteprima colore",
    });
    encoder.copyBufferToBuffer(
      this.frontMask,
      0,
      this.colorPreviewBaseMask,
      0,
      SELECTION_MASK_BYTES,
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
    this.writeOperationUniforms(combineMode, 0, tolerance, targetColor);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.placeholderBuffer);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · colore globale" });
    this.prepareBackMask(
      encoder,
      combineMode,
      this.colorPreviewActive ? this.colorPreviewBaseMask : this.frontMask,
    );
    const pass = encoder.beginComputePass({ label: "Selezione pixel · confronto colore" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(this.selectColorPipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async selectLasso(
    raster: LassoSpanRaster,
    combineMode: SelectionCombineMode,
  ): Promise<SelectionSummary> {
    this.assertAlive();
    this.finishColorRangePreview();
    if (raster.packedSpans.byteLength > SELECTION_LASSO_SPAN_BUFFER_BYTES) {
      throw new RangeError("Gli span del lazo superano il buffer GPU preallocato.");
    }
    if (raster.packedSpans.byteLength > 0) {
      this.device.queue.writeBuffer(this.lassoSpanBuffer, 0, raster.packedSpans);
    }
    this.writeOperationUniforms(combineMode, raster.spanCount, 0, [0, 0, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.placeholderBuffer);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · lazo" });
    this.prepareBackMask(encoder, combineMode);
    const pass = encoder.beginComputePass({ label: "Selezione pixel · span lazo" });
    pass.setBindGroup(0, bindGroup);
    if (raster.spanCount > 0) {
      pass.setPipeline(this.lassoPipeline);
      pass.dispatchWorkgroups(Math.ceil(raster.spanCount / 64));
    }
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
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
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · combina maschera" });
    this.prepareBackMask(encoder, combineMode);
    const pass = encoder.beginComputePass({ label: "Selezione pixel · replace/add/subtract" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(this.combinePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async invertSelection(): Promise<SelectionSummary> {
    this.assertAlive();
    this.finishColorRangePreview();
    this.writeOperationUniforms("replace", 0, 0, [0, 0, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.frontMask);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · inverti" });
    const pass = encoder.beginComputePass({ label: "Selezione pixel · inversione e sommario" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(this.invertPipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.end();
    this.copyMetadataForReadback(encoder);
    return this.submitReadPublish(encoder, startedAt);
  }

  async translateSelection(deltaX: number, deltaY: number): Promise<SelectionSummary> {
    this.assertAlive();
    this.finishColorRangePreview();
    const x = Math.round(deltaX);
    const y = Math.round(deltaY);
    this.writeOperationUniforms("replace", 0, 0, [x, y, 0, 0]);
    this.initializeMetadata();
    const bindGroup = this.createComputeBindGroup(this.backMask, this.frontMask);
    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({
      label: `Selezione pixel · trasla ${x},${y}`,
    });
    encoder.clearBuffer(this.backMask);
    const pass = encoder.beginComputePass({ label: "Selezione pixel · traslazione e sommario" });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(this.translatePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
    pass.setPipeline(this.summarizePipeline);
    pass.dispatchWorkgroups(Math.ceil(SELECTION_MASK_WORDS / 256));
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
      throw new Error("Tile mask della Selezione pixel storica non valida.");
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
      label: "Selezione pixel · ripristino maschera storica",
    });
    encoder.copyBufferToBuffer(
      sourceBuffer,
      sourceOffset,
      this.backMask,
      0,
      SELECTION_MASK_BYTES,
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
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · deseleziona" });
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
    floats[7] = 0;
    unsigned[8] = state.selectedPixels;
    floats[10] = offset.x;
    floats[11] = offset.y;
    this.device.queue.writeBuffer(this.overlayUniformBuffer, 0, upload);
    const encoder = this.device.createCommandEncoder({ label: "Selezione pixel · presenta overlay" });
    const pass = encoder.beginRenderPass({
      label: "Selezione pixel · overlay separato",
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
  }

  private createComputeBindGroup(targetMask: GPUBuffer, externalMask: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      label: "Selezione pixel · compute bind group",
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
    unsigned[0] = SELECTION_LAYER_WIDTH;
    unsigned[1] = SELECTION_LAYER_HEIGHT;
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
      encoder.copyBufferToBuffer(sourceMask, 0, this.backMask, 0, SELECTION_MASK_BYTES);
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
      label: "Selezione pixel · overlay bind group",
      layout: this.overlayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.overlayUniformBuffer, size: SELECTION_OVERLAY_UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: mask } },
        { binding: 2, resource: { buffer: this.metadataBuffer, size: SELECTION_METADATA_BYTES } },
      ],
    });
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Renderer Selezione pixel già distrutto.");
  }
}
