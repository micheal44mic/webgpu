import {
  FILL_COMPOSITE_MODE_CODE,
  FILL_INDIRECT_BUFFER_BYTES,
  FILL_DIAGNOSTIC_SEED_TRANSPARENT_BIT,
  FILL_META_ACTIVE_BLOCKS,
  FILL_META_ACTIVE_COMPONENTS,
  FILL_META_DIAGNOSTIC,
  FILL_META_MAX_X,
  FILL_META_MAX_Y,
  FILL_META_MIN_X,
  FILL_META_MIN_Y,
  FILL_META_SELECTED_PIXELS,
  FILL_META_SOURCE_SEED_COLOR_START,
  FILL_META_TILE_MASK_START,
  FILL_METADATA_BUFFER_BYTES,
  FILL_METADATA_BYTES,
  FILL_METADATA_WORDS,
  FILL_TILE_GRID_SIZE,
  FILL_TILE_MASK_WORDS,
  FILL_UNIFORM_BUFFER_BYTES,
  FILL_UNIFORM_BYTES,
  FILL_WORKGROUP_STORAGE_BYTES,
  countFillTiles,
  currentFillDocumentMetrics,
  fillResidualFringeRadius,
  type FillAnalysis,
  type FillCompositeMode,
  type FillDocumentMetrics,
} from "./fill-core";
import type { LayerFormat } from "./engine-types";
import type { DirtyRect } from "./engine-stroke-types";
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
  readonly uniformBuffer: GPUBuffer;
  readonly packedLabels: GPUBuffer;
  readonly globalParents: GPUBuffer;
  readonly activeParentNodes: GPUBuffer;
  readonly selectedMask: GPUBuffer;
  readonly activeBlocks: GPUBuffer;
  readonly metadata: GPUBuffer;
  readonly drawIndirect: GPUBuffer;
  readonly readback: GPUBuffer;
  computeBindGroup: GPUBindGroup;
  composite: FillCompositeScratchResources | null;
}

interface FillCompositeScratchResources {
  readonly destinationSnapshotTexture: GPUTexture;
  readonly destinationSnapshotView: GPUTextureView;
  readonly fringeBindGroup: GPUBindGroup;
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
  readonly compositeMode: FillCompositeMode | null;
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
  readonly compositeMode: FillCompositeMode | null;
  readonly analysis: FillAnalysis;
}

function expandResidualFringeBounds(
  bounds: DirtyRect,
  radius: number,
  metrics: FillDocumentMetrics,
): DirtyRect {
  if (radius <= 0) return { ...bounds };
  const x = Math.max(0, bounds.x - radius);
  const y = Math.max(0, bounds.y - radius);
  const right = Math.min(metrics.layerWidth, bounds.x + bounds.width + radius);
  const bottom = Math.min(metrics.layerHeight, bounds.y + bounds.height + radius);
  return { x, y, width: right - x, height: bottom - y };
}

function markResidualFringeTiles(
  tileMask: Uint32Array,
  bounds: DirtyRect,
  metrics: FillDocumentMetrics,
): void {
  const firstTileX = Math.floor(bounds.x / metrics.tileWidth);
  const firstTileY = Math.floor(bounds.y / metrics.tileHeight);
  const lastTileX = Math.min(
    FILL_TILE_GRID_SIZE - 1,
    Math.floor((bounds.x + bounds.width - 1) / metrics.tileWidth),
  );
  const lastTileY = Math.min(
    FILL_TILE_GRID_SIZE - 1,
    Math.floor((bounds.y + bounds.height - 1) / metrics.tileHeight),
  );
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const tile = tileY * FILL_TILE_GRID_SIZE + tileX;
      tileMask[tile >>> 5] |= (2 ** (tile & 31)) >>> 0;
    }
  }
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
    throw new Error(`Invalid Fill WGSL shader:\n${errors.join("\n")}`);
  }
}

type FillOptionalComputeEntryPoint =
  | "rebuildSelection"
  | "expandResidualFringe1"
  | "expandResidualFringe2"
  | "expandResidualFringe3"
  | "recordResidualFringeBlocks"
  | "expandRenderMask";

interface FillAnalysisGpuProgram {
  readonly device: GPUDevice;
  readonly computeModule: GPUShaderModule;
  readonly computeBindGroupLayout: GPUBindGroupLayout;
  readonly computePipelineLayout: GPUPipelineLayout;
  readonly classifyPipeline: GPUComputePipeline;
  readonly boundaryPipeline: GPUComputePipeline;
  readonly compressPipeline: GPUComputePipeline;
  readonly selectPipeline: GPUComputePipeline;
  readonly optionalComputePipelines: Map<
    FillOptionalComputeEntryPoint,
    Promise<GPUComputePipeline>
  >;
}

interface FillRenderGpuProgram {
  readonly renderModule: GPUShaderModule;
  readonly renderBindGroupLayout: GPUBindGroupLayout;
  readonly renderPipelineLayout: GPUPipelineLayout;
  readonly renderPipeline: GPURenderPipeline;
}

interface FillSelectionIntersectionGpuProgram {
  readonly intersectionModule: GPUShaderModule;
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  readonly pipeline: GPUComputePipeline;
}

/** Device-session programs survive document-sized scratch release and resize. */
const fillAnalysisGpuPrograms = new WeakMap<
  GPUDevice,
  Promise<FillAnalysisGpuProgram>
>();
const fillRenderGpuPrograms = new WeakMap<
  GPUDevice,
  Map<LayerFormat, Promise<FillRenderGpuProgram>>
>();
const fillSelectionIntersectionGpuPrograms = new WeakMap<
  GPUDevice,
  Promise<FillSelectionIntersectionGpuProgram>
>();

async function createFillAnalysisGpuProgram(
  device: GPUDevice,
): Promise<FillAnalysisGpuProgram> {
  const computeModule = device.createShaderModule({
    label: "Fill · session connected components",
    code: fillComputeShader,
  });
  await assertShaderModules([{ label: "compute", module: computeModule }]);
  const computeBindGroupLayout = device.createBindGroupLayout({
    label: "Fill · session compute bind group layout",
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
  const computePipelineLayout = device.createPipelineLayout({
    label: "Fill · session compute pipeline layout",
    bindGroupLayouts: [computeBindGroupLayout],
  });
  const [
    classifyPipeline,
    boundaryPipeline,
    compressPipeline,
    selectPipeline,
  ] = await Promise.all([
    "classifyLocal",
    "unionBoundaries",
    "compressComponents",
    "selectSeedComponent",
  ].map((entryPoint) => device.createComputePipelineAsync({
    label: `Fill · session ${entryPoint}`,
    layout: computePipelineLayout,
    compute: { module: computeModule, entryPoint },
  })));
  return {
    device,
    computeModule,
    computeBindGroupLayout,
    computePipelineLayout,
    classifyPipeline,
    boundaryPipeline,
    compressPipeline,
    selectPipeline,
    optionalComputePipelines: new Map(),
  };
}

function getFillAnalysisGpuProgram(device: GPUDevice): Promise<FillAnalysisGpuProgram> {
  const cached = fillAnalysisGpuPrograms.get(device);
  if (cached) return cached;
  const pending = createFillAnalysisGpuProgram(device);
  fillAnalysisGpuPrograms.set(device, pending);
  void pending.catch(() => {
    if (fillAnalysisGpuPrograms.get(device) === pending) {
      fillAnalysisGpuPrograms.delete(device);
    }
  });
  return pending;
}

function getFillOptionalComputePipeline(
  program: FillAnalysisGpuProgram,
  entryPoint: FillOptionalComputeEntryPoint,
): Promise<GPUComputePipeline> {
  const cached = program.optionalComputePipelines.get(entryPoint);
  if (cached) return cached;
  const pending = program.device.createComputePipelineAsync({
    label: `Fill · session ${entryPoint}`,
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

async function createFillRenderGpuProgram(
  device: GPUDevice,
  layerFormat: LayerFormat,
): Promise<FillRenderGpuProgram> {
  const renderModule = device.createShaderModule({
    label: "Fill · session mask commit",
    code: fillRenderShader,
  });
  await assertShaderModules([{ label: "render", module: renderModule }]);
  const renderBindGroupLayout = device.createBindGroupLayout({
    label: "Fill · session render bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", minBindingSize: FILL_UNIFORM_BYTES } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
    ],
  });
  const renderPipelineLayout = device.createPipelineLayout({
    label: "Fill · session render pipeline layout",
    bindGroupLayouts: [renderBindGroupLayout],
  });
  const renderPipeline = await device.createRenderPipelineAsync({
    label: `Fill · session composite selected color into ${layerFormat} target`,
    layout: renderPipelineLayout,
    vertex: { module: renderModule, entryPoint: "vertexMain" },
    fragment: {
      module: renderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: layerFormat }],
    },
    primitive: { topology: "triangle-strip" },
  });
  return { renderModule, renderBindGroupLayout, renderPipelineLayout, renderPipeline };
}

function getFillRenderGpuProgram(
  device: GPUDevice,
  layerFormat: LayerFormat,
): Promise<FillRenderGpuProgram> {
  let programsByFormat = fillRenderGpuPrograms.get(device);
  if (!programsByFormat) {
    programsByFormat = new Map();
    fillRenderGpuPrograms.set(device, programsByFormat);
  }
  const cached = programsByFormat.get(layerFormat);
  if (cached) return cached;
  const pending = createFillRenderGpuProgram(device, layerFormat);
  programsByFormat.set(layerFormat, pending);
  void pending.catch(() => {
    if (programsByFormat?.get(layerFormat) === pending) {
      programsByFormat.delete(layerFormat);
    }
  });
  return pending;
}

async function createFillSelectionIntersectionGpuProgram(
  device: GPUDevice,
): Promise<FillSelectionIntersectionGpuProgram> {
  const intersectionModule = device.createShaderModule({
    label: "Fill · session intersection with Pixel Selection",
    code: fillSelectionIntersectionShader,
  });
  await assertShaderModules([{ label: "selection intersection", module: intersectionModule }]);
  const bindGroupLayout = device.createBindGroupLayout({
    label: "Fill · session Pixel Selection intersection bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "Fill · session Pixel Selection intersection pipeline layout",
    bindGroupLayouts: [bindGroupLayout],
  });
  const pipeline = await device.createComputePipelineAsync({
    label: "Fill · session candidate intersection with Pixel Selection",
    layout: pipelineLayout,
    compute: { module: intersectionModule, entryPoint: "intersectFillWithSelection" },
  });
  return { intersectionModule, bindGroupLayout, pipelineLayout, pipeline };
}

function getFillSelectionIntersectionGpuProgram(
  device: GPUDevice,
): Promise<FillSelectionIntersectionGpuProgram> {
  const cached = fillSelectionIntersectionGpuPrograms.get(device);
  if (cached) return cached;
  const pending = createFillSelectionIntersectionGpuProgram(device);
  fillSelectionIntersectionGpuPrograms.set(device, pending);
  void pending.catch(() => {
    if (fillSelectionIntersectionGpuPrograms.get(device) === pending) {
      fillSelectionIntersectionGpuPrograms.delete(device);
    }
  });
  return pending;
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
  computeBindGroupLayout!: GPUBindGroupLayout;
  private renderBindGroupLayout!: GPUBindGroupLayout;
  private selectionIntersectionBindGroupLayout!: GPUBindGroupLayout;
  private metrics: FillDocumentMetrics;
  private readonly layerFormat: LayerFormat;
  private configuredSourceSamplingView: GPUTextureView;
  private analysisProgram!: FillAnalysisGpuProgram;
  private classifyPipeline!: GPUComputePipeline;
  private boundaryPipeline!: GPUComputePipeline;
  private compressPipeline!: GPUComputePipeline;
  private selectPipeline!: GPUComputePipeline;
  private rebuildPipeline!: GPUComputePipeline;
  private residualFringePipeline1!: GPUComputePipeline;
  private residualFringePipeline2!: GPUComputePipeline;
  private residualFringePipeline3!: GPUComputePipeline;
  private residualFringeBlockPipeline!: GPUComputePipeline;
  private expandRenderMaskPipeline!: GPUComputePipeline;
  private selectionIntersectionPipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private bitProbePipelinePromise: Promise<GPUComputePipeline> | null = null;
  private compositeProgramPromise: Promise<void> | null = null;
  private selectionIntersectionProgramPromise: Promise<void> | null = null;
  private scratch: FillScratchResources | null = null;
  private prewarmPromise: Promise<void> | null = null;
  private compositePrewarmPromise: Promise<void> | null = null;
  private lastDiagnosticInput: LastFillDiagnosticInput | null = null;
  private diagnosticSequence = 0;
  /** `null` means no snapshot-backed live Fill session is active. */
  private liveSessionSourceIsTarget: boolean | null = null;
  private destroyed = false;

  private constructor(options: FillRendererOptions) {
    this.device = options.device;
    this.metrics = currentFillDocumentMetrics();
    const limits = this.device.limits;
    if (
      limits.maxComputeInvocationsPerWorkgroup < 256
      || limits.maxComputeWorkgroupSizeX < 16
      || limits.maxComputeWorkgroupSizeY < 16
      || limits.maxComputeWorkgroupStorageSize < FILL_WORKGROUP_STORAGE_BYTES
      || limits.maxStorageBuffersPerShaderStage < 7
      || limits.maxStorageBufferBindingSize < this.metrics.parentBufferBytes
    ) {
      throw new Error(
        `The GPU compute limits do not support Fill at `
        + `${this.metrics.layerWidth}×${this.metrics.layerHeight}.`,
      );
    }
    this.layerFormat = options.layerFormat;
    this.configuredSourceSamplingView = options.sourceSamplingView;
  }

  get resident(): boolean {
    return this.scratch !== null;
  }

  get residentBytes(): number {
    if (!this.resident) return 0;
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    return this.metrics.residentScratchBytes
      + (this.scratch?.composite
        ? this.metrics.layerWidth * this.metrics.layerHeight * bytesPerPixel
        : 0);
  }

  private async initialize(): Promise<void> {
    const program = await getFillAnalysisGpuProgram(this.device);
    this.analysisProgram = program;
    this.computeBindGroupLayout = program.computeBindGroupLayout;
    this.classifyPipeline = program.classifyPipeline;
    this.boundaryPipeline = program.boundaryPipeline;
    this.compressPipeline = program.compressPipeline;
    this.selectPipeline = program.selectPipeline;
  }

  private async ensureCompositePrograms(): Promise<void> {
    this.assertAlive();
    if (this.compositeProgramPromise) return this.compositeProgramPromise;
    const pending = Promise.all([
      getFillOptionalComputePipeline(this.analysisProgram, "rebuildSelection"),
      getFillOptionalComputePipeline(this.analysisProgram, "expandResidualFringe1"),
      getFillOptionalComputePipeline(this.analysisProgram, "expandResidualFringe2"),
      getFillOptionalComputePipeline(this.analysisProgram, "expandResidualFringe3"),
      getFillOptionalComputePipeline(this.analysisProgram, "recordResidualFringeBlocks"),
      getFillOptionalComputePipeline(this.analysisProgram, "expandRenderMask"),
      getFillRenderGpuProgram(this.device, this.layerFormat),
    ] as const).then(([
      rebuildPipeline,
      residualFringePipeline1,
      residualFringePipeline2,
      residualFringePipeline3,
      residualFringeBlockPipeline,
      expandRenderMaskPipeline,
      renderProgram,
    ]) => {
      this.assertAlive();
      this.rebuildPipeline = rebuildPipeline;
      this.residualFringePipeline1 = residualFringePipeline1;
      this.residualFringePipeline2 = residualFringePipeline2;
      this.residualFringePipeline3 = residualFringePipeline3;
      this.residualFringeBlockPipeline = residualFringeBlockPipeline;
      this.expandRenderMaskPipeline = expandRenderMaskPipeline;
      this.renderBindGroupLayout = renderProgram.renderBindGroupLayout;
      this.renderPipeline = renderProgram.renderPipeline;
    });
    this.compositeProgramPromise = pending.catch((error) => {
      this.compositeProgramPromise = null;
      throw error;
    });
    return this.compositeProgramPromise;
  }

  private async ensureSelectionIntersectionPrograms(): Promise<void> {
    this.assertAlive();
    if (this.selectionIntersectionProgramPromise) {
      return this.selectionIntersectionProgramPromise;
    }
    const pending = Promise.all([
      getFillOptionalComputePipeline(this.analysisProgram, "rebuildSelection"),
      getFillSelectionIntersectionGpuProgram(this.device),
    ] as const).then(([rebuildPipeline, intersectionProgram]) => {
      this.assertAlive();
      this.rebuildPipeline = rebuildPipeline;
      this.selectionIntersectionBindGroupLayout = intersectionProgram.bindGroupLayout;
      this.selectionIntersectionPipeline = intersectionProgram.pipeline;
    });
    this.selectionIntersectionProgramPromise = pending.catch((error) => {
      this.selectionIntersectionProgramPromise = null;
      throw error;
    });
    return this.selectionIntersectionProgramPromise;
  }

  async prewarm(): Promise<void> {
    this.assertAlive();
    if (this.scratch) return;
    if (this.prewarmPromise) return this.prewarmPromise;
    const allocation = runGpuAllocationTransaction(
      this.device,
      "WebGPU Fill scratch",
      (transaction) => {
        const create = (label: string, size: number, usage: GPUBufferUsageFlags): GPUBuffer => {
          const buffer = this.device.createBuffer({ label, size, usage });
          transaction.deferRollback(() => buffer.destroy());
          return buffer;
        };
        const uniformBuffer = create(
          "Fill · uniforms",
          FILL_UNIFORM_BUFFER_BYTES,
          GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        );
        const packedLabels = create(
          "Fill · packed local u8 labels",
          this.metrics.labelBufferBytes,
          GPUBufferUsage.STORAGE,
        );
        if (this.metrics.renderMaskBytes > this.metrics.labelBufferBytes) {
          throw new Error("The Fill render mask does not fit in the reused label scratch buffer.");
        }
        const globalParents = create(
          "Fill · global component parents",
          this.metrics.parentBufferBytes,
          GPUBufferUsage.STORAGE,
        );
        const activeParentNodes = create(
          "Fill · active components",
          this.metrics.activeNodeBufferBytes,
          GPUBufferUsage.STORAGE,
        );
        const selectedMask = create(
          "Fill · selected 1-bit mask",
          this.metrics.historyMaskBytes,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        );
        const activeBlocks = create(
          "Fill · selected blocks",
          this.metrics.activeBlockBufferBytes,
          GPUBufferUsage.STORAGE,
        );
        const metadata = create(
          "Fill · metadata",
          FILL_METADATA_BUFFER_BYTES,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        );
        const drawIndirect = create(
          "Fill · indirect block draw",
          FILL_INDIRECT_BUFFER_BYTES,
          GPUBufferUsage.STORAGE
            | GPUBufferUsage.INDIRECT
            | GPUBufferUsage.COPY_SRC
            | GPUBufferUsage.COPY_DST,
        );
        const readback = create(
          "Fill · metadata readback",
          FILL_METADATA_BUFFER_BYTES,
          GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        );
        const computeBindGroup = this.createComputeBindGroup(
          {
            uniformBuffer,
            packedLabels,
            globalParents,
            activeParentNodes,
            selectedMask,
            activeBlocks,
            metadata,
            drawIndirect,
          },
          this.configuredSourceSamplingView,
        );
        return {
          uniformBuffer,
          packedLabels,
          globalParents,
          activeParentNodes,
          selectedMask,
          activeBlocks,
          metadata,
          drawIndirect,
          readback,
          computeBindGroup,
          composite: null,
        };
      },
    );
    const pending = allocation.then((resources) => {
      if (this.destroyed) {
        this.destroyScratchResources(resources);
        throw new Error("The Fill renderer was destroyed during prewarming.");
      }
      // Il livello può essere cambiato mentre l'allocazione chiude gli error
      // scope: ricrea il bind group con la view più recente prima di pubblicare.
      try {
        resources.computeBindGroup = this.createComputeBindGroup(
          resources,
          this.configuredSourceSamplingView,
        );
      } catch (error) {
        this.destroyScratchResources(resources);
        throw error;
      }
      this.scratch = resources;
    });
    this.prewarmPromise = pending.finally(() => {
      this.prewarmPromise = null;
    });
    return this.prewarmPromise;
  }

  /** Allocates the full RGBA snapshot only for Fill preview/replay, never for Magic Wand. */
  async prewarmComposite(): Promise<void> {
    this.assertAlive();
    if (this.scratch?.composite) return;
    if (this.compositePrewarmPromise) return this.compositePrewarmPromise;

    // Publish one promise for the complete operation before its first await.
    // Document reconfiguration can then wait for programs, base scratch and
    // composite scratch as one indivisible readiness boundary.
    const pending = this.prepareCompositeResources();
    this.compositePrewarmPromise = pending.finally(() => {
      this.compositePrewarmPromise = null;
    });
    return this.compositePrewarmPromise;
  }

  private async prepareCompositeResources(): Promise<void> {
    // GPU error scopes are stack-based. Finish the scratch allocation
    // transaction before pipeline compilation opens its own scopes.
    await this.prewarm();
    await this.ensureCompositePrograms();
    const scratch = this.requireScratch();
    if (scratch.composite) return;
    const composite = await runGpuAllocationTransaction(
      this.device,
      "WebGPU Fill destination snapshot",
      (transaction): FillCompositeScratchResources => {
        const destinationSnapshotTexture = this.device.createTexture({
          label: `Fill · ${this.layerFormat} destination snapshot`,
          size: {
            width: this.metrics.layerWidth,
            height: this.metrics.layerHeight,
            depthOrArrayLayers: 1,
          },
          format: this.layerFormat,
          usage: GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => destinationSnapshotTexture.destroy());
        const destinationSnapshotView = destinationSnapshotTexture.createView({
          label: `Fill · ${this.layerFormat} destination snapshot view`,
        });
        const fringeBindGroup = this.createComputeBindGroup(
          scratch,
          destinationSnapshotView,
        );
        const renderBindGroup = this.device.createBindGroup({
          label: "Fill · render bind group",
          layout: this.renderBindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: scratch.uniformBuffer, size: FILL_UNIFORM_BYTES } },
            // Dopo la CCL, packedLabels viene riutilizzato come mask render a
            // word low-8-bit. selectedMask resta autorevole per History.
            { binding: 1, resource: { buffer: scratch.packedLabels, size: this.metrics.renderMaskBytes } },
            { binding: 2, resource: { buffer: scratch.activeBlocks } },
            { binding: 3, resource: destinationSnapshotView },
          ],
        });
        return {
          destinationSnapshotTexture,
          destinationSnapshotView,
          fringeBindGroup,
          renderBindGroup,
        };
      },
    );
    if (this.destroyed || this.scratch !== scratch) {
      composite.destinationSnapshotTexture.destroy();
      throw new Error("The Fill renderer changed during composite prewarming.");
    }
    scratch.composite = composite;
  }

  async waitForPrewarm(): Promise<void> {
    while (true) {
      // Composite readiness includes base scratch. Prefer it when present so a
      // resize cannot observe the short gap between the two transactions.
      const readiness = this.compositePrewarmPromise ?? this.prewarmPromise;
      if (!readiness) return;
      await readiness;
    }
  }

  setSourceSamplingView(view: GPUTextureView): void {
    this.assertAlive();
    if (view === this.configuredSourceSamplingView) {
      return;
    }
    this.configuredSourceSamplingView = view;
    // During a same-layer live session CCL must remain pinned to the immutable
    // snapshot. The new configured view becomes visible after endLiveSession().
    if (this.scratch && this.liveSessionSourceIsTarget !== true) {
      this.rebuildComputeBindGroupForCurrentSource(this.scratch);
    }
  }

  /**
   * Drops document-sized scratch while retaining the dimension-neutral
   * pipelines. The next Fill use allocates buffers for the requested extent.
   */
  async reconfigureDocument(
    width: number,
    height: number,
    sourceSamplingView: GPUTextureView,
  ): Promise<void> {
    this.assertAlive();
    if (this.liveSessionSourceIsTarget !== null) {
      throw new Error("Cannot reconfigure Fill during an active preview session.");
    }
    await this.waitForPrewarm();
    this.releaseScratch();
    this.metrics = currentFillDocumentMetrics(width, height);
    this.configuredSourceSamplingView = sourceSamplingView;
  }

  /**
   * Starts one snapshot-backed preview transaction. The caller submits this
   * encoder before the first analyze(), so every later CCL observes the exact
   * pre-preview source instead of the pixels rendered by an earlier preview.
   */
  beginLiveSession(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    sourceIsTarget: boolean,
  ): void {
    this.assertAlive();
    const scratch = this.requireScratch();
    this.requireCompositeScratch(scratch);
    if (this.liveSessionSourceIsTarget !== null) {
      throw new Error("A Fill live session is already active.");
    }
    this.liveSessionSourceIsTarget = sourceIsTarget;
    this.encodeDestinationSnapshotCopy(encoder, targetTexture, scratch);
    this.rebuildComputeBindGroupForCurrentSource(scratch);
  }

  /** Restores normal source sampling after commit or rollback. */
  endLiveSession(): void {
    this.assertAlive();
    if (this.liveSessionSourceIsTarget === null) return;
    this.liveSessionSourceIsTarget = null;
    if (this.scratch) {
      this.rebuildComputeBindGroupForCurrentSource(this.scratch);
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
    // Keep document-sized allocation scopes disjoint from lazy pipeline work.
    // Error scopes belong to the device stack, not to an individual promise.
    await this.prewarm();
    if (selectionMask) await this.ensureSelectionIntersectionPrograms();
    const scratch = this.requireScratch();
    const x = Math.floor(seedX);
    const y = Math.floor(seedY);
    if (x < 0 || y < 0 || x >= this.metrics.layerWidth || y >= this.metrics.layerHeight) {
      throw new RangeError("The fill point is outside the layer.");
    }
    const upload = new ArrayBuffer(FILL_UNIFORM_BYTES);
    const unsigned = new Uint32Array(upload);
    const floats = new Float32Array(upload);
    unsigned[0] = x;
    unsigned[1] = y;
    unsigned[2] = this.metrics.layerWidth;
    unsigned[3] = this.metrics.layerHeight;
    floats[4] = tolerance;
    floats[5] = transparentSeedTolerancePercent === null
      ? -1
      : Math.min(1, Math.max(0, transparentSeedTolerancePercent / 100));
    unsigned[7] = this.liveSessionSourceIsTarget === true ? 1 : 0;
    floats.set(fillColor, 8);
    this.device.queue.writeBuffer(scratch.uniformBuffer, 0, upload);

    const initialMetadata = new Uint32Array(FILL_METADATA_WORDS);
    initialMetadata[FILL_META_MIN_X] = 0xffffffff;
    initialMetadata[FILL_META_MIN_Y] = 0xffffffff;
    this.device.queue.writeBuffer(scratch.metadata, 0, initialMetadata);
    this.device.queue.writeBuffer(scratch.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));

    const startedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Fill · analysis" });
    encoder.clearBuffer(scratch.selectedMask);
    const labelPass = encoder.beginComputePass({
      label: "Fill · local CCL and boundary union",
    });
    labelPass.setBindGroup(0, scratch.computeBindGroup);
    labelPass.setPipeline(this.classifyPipeline);
    labelPass.dispatchWorkgroups(this.metrics.blockGridWidth, this.metrics.blockGridHeight);
    labelPass.setPipeline(this.boundaryPipeline);
    labelPass.dispatchWorkgroups(this.metrics.blockGridWidth, this.metrics.blockGridHeight);
    labelPass.end();

    const selectionPass = encoder.beginComputePass({
      label: "Fill · compression and seed selection",
    });
    selectionPass.setBindGroup(0, scratch.computeBindGroup);
    selectionPass.setPipeline(this.compressPipeline);
    selectionPass.dispatchWorkgroups(Math.ceil(this.metrics.blockCount / 256));
    selectionPass.setPipeline(this.selectPipeline);
    selectionPass.dispatchWorkgroups(this.metrics.blockGridWidth, this.metrics.blockGridHeight);
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
      // Preserve the source-seed diagnostic and exact RGBA bits written by
      // classifyLocal. The intersection pass rebuilds every summary field
      // from the tile-mask start onward.
      this.device.queue.writeBuffer(
        scratch.metadata,
        0,
        clippedMetadata.subarray(0, FILL_META_DIAGNOSTIC),
      );
      this.device.queue.writeBuffer(
        scratch.metadata,
        FILL_META_TILE_MASK_START * 4,
        clippedMetadata.subarray(FILL_META_TILE_MASK_START),
      );
      this.device.queue.writeBuffer(scratch.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));
      const clipBindGroup = this.device.createBindGroup({
        label: "Fill · candidate ∩ selection bind group",
        layout: this.selectionIntersectionBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: scratch.selectedMask } },
          { binding: 1, resource: { buffer: selectionMask } },
        ],
      });
      const clipEncoder = this.device.createCommandEncoder({
        label: "Fill · apply Pixel Selection",
      });
      const clipPass = clipEncoder.beginComputePass({
        label: "Fill · intersection and summary",
      });
      clipPass.setPipeline(this.selectionIntersectionPipeline);
      clipPass.setBindGroup(0, clipBindGroup);
      clipPass.dispatchWorkgroups(Math.ceil(this.metrics.historyMaskWords / 256));
      clipPass.setPipeline(this.rebuildPipeline);
      clipPass.setBindGroup(0, scratch.computeBindGroup);
      clipPass.dispatchWorkgroups(this.metrics.blockGridWidth, this.metrics.blockGridHeight);
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
        throw new Error("The fill area does not intersect the active Pixel Selection.");
      }
      throw new Error(
        "The fill seed does not belong to any component "
        + `(components=${metadata[FILL_META_ACTIVE_COMPONENTS]}, `
        + `blocks=${metadata[FILL_META_ACTIVE_BLOCKS]}, `
        + `diag=${metadata[FILL_META_DIAGNOSTIC]}, `
        + `bounds=${metadata[FILL_META_MIN_X]},${metadata[FILL_META_MIN_Y]}–`
        + `${metadata[FILL_META_MAX_X]},${metadata[FILL_META_MAX_Y]}).`,
      );
    }
    const tileMask = metadata.slice(
      FILL_META_TILE_MASK_START,
      FILL_META_TILE_MASK_START + FILL_TILE_MASK_WORDS,
    );
    const metadataFloats = new Float32Array(
      metadata.buffer,
      metadata.byteOffset,
      metadata.length,
    );
    const sourceSeedTransparent =
      (metadata[FILL_META_DIAGNOSTIC] & FILL_DIAGNOSTIC_SEED_TRANSPARENT_BIT) !== 0;
    const residualFringeRadius = this.liveSessionSourceIsTarget === true
      && !sourceSeedTransparent
      && selectionMask === null
      && transparentSeedTolerancePercent !== null
      ? fillResidualFringeRadius(transparentSeedTolerancePercent)
      : 0;
    const bounds = expandResidualFringeBounds({
      x: metadata[FILL_META_MIN_X],
      y: metadata[FILL_META_MIN_Y],
      width: metadata[FILL_META_MAX_X] - metadata[FILL_META_MIN_X],
      height: metadata[FILL_META_MAX_Y] - metadata[FILL_META_MIN_Y],
    }, residualFringeRadius, this.metrics);
    if (residualFringeRadius > 0) {
      markResidualFringeTiles(tileMask, bounds, this.metrics);
    }
    const analysis: FillAnalysis = {
      selectedPixels,
      activeComponents: metadata[FILL_META_ACTIVE_COMPONENTS],
      activeBlocks: metadata[FILL_META_ACTIVE_BLOCKS],
      activeTiles: countFillTiles(tileMask),
      sourceSeedTransparent,
      sourceSeedColorLinear: [
        metadataFloats[FILL_META_SOURCE_SEED_COLOR_START],
        metadataFloats[FILL_META_SOURCE_SEED_COLOR_START + 1],
        metadataFloats[FILL_META_SOURCE_SEED_COLOR_START + 2],
        metadataFloats[FILL_META_SOURCE_SEED_COLOR_START + 3],
      ],
      residualFringeRadius,
      bounds,
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
      compositeMode: null,
      analysis: {
        ...analysis,
        bounds: { ...analysis.bounds },
        tileMask: analysis.tileMask.slice(),
        sourceSeedColorLinear: [...analysis.sourceSeedColorLinear],
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
      throw new Error("No current Fill analysis is available for diagnostics.");
    }
    const readbackBytes = this.metrics.historyMaskBytes + FILL_INDIRECT_BUFFER_BYTES;
    const readback = this.device.createBuffer({
      label: "Fill · mask and indirect draw diagnostics",
      size: readbackBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const startedAt = performance.now();
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Fill · diagnostic capture",
      });
      encoder.copyBufferToBuffer(
        scratch.selectedMask,
        0,
        readback,
        0,
        this.metrics.historyMaskBytes,
      );
      encoder.copyBufferToBuffer(
        scratch.drawIndirect,
        0,
        readback,
        this.metrics.historyMaskBytes,
        FILL_INDIRECT_BUFFER_BYTES,
      );
      this.device.queue.submit([encoder.finish()]);
      let timer = 0;
      try {
        await Promise.race([
          readback.mapAsync(GPUMapMode.READ),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Fill diagnostics: mask readback timed out after 10 s.")),
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
        bytes.slice(0, this.metrics.historyMaskBytes).buffer,
      );
      const drawIndirect = [...new Uint32Array(
        bytes.slice(this.metrics.historyMaskBytes, readbackBytes).buffer,
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
        compositeMode: input.compositeMode,
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
        label: "Fill · bit 31 diagnostic shader",
        code: fillBitProbeShader,
      });
      this.bitProbePipelinePromise = this.device.createComputePipelineAsync({
        label: "Fill · bit 31 diagnostic pipeline",
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
          () => reject(new Error("Fill diagnostics: microtest compilation timed out after 10 s.")),
          10_000,
        );
      }),
    ]).finally(() => {
      if (pipelineTimer !== 0) window.clearTimeout(pipelineTimer);
    });
    const uniform = this.device.createBuffer({
      label: "Fill · bit 31 diagnostic uniform",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const results = this.device.createBuffer({
      label: "Fill · bit 31 diagnostic results",
      size: 256,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const readback = this.device.createBuffer({
      label: "Fill · bit 31 diagnostic readback",
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    let mapped = false;
    try {
      this.device.queue.writeBuffer(uniform, 0, new Uint32Array([31, 0, 0, 0]));
      const bindGroup = this.device.createBindGroup({
        label: "Fill · bit 31 diagnostic bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: results } },
        ],
      });
      const encoder = this.device.createCommandEncoder({
        label: "Fill · run bit 31 diagnostics",
      });
      encoder.clearBuffer(results);
      const pass = encoder.beginComputePass({ label: "Fill · bit 31 probe" });
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
              () => reject(new Error("Fill diagnostics: bit 31 microtest timed out after 10 s.")),
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

  /**
   * Restores a preview-dirty rectangle from the one immutable session snapshot.
   * This does not touch the current CCL mask and is also the rollback primitive.
   */
  encodeLiveSnapshotRestore(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    rect: DirtyRect,
  ): void {
    const scratch = this.requireScratch();
    const composite = this.requireCompositeScratch(scratch);
    this.assertLiveSession();
    const copyRect = this.validateLiveRestoreRect(rect);
    if (copyRect.width === 0 || copyRect.height === 0) return;
    encoder.copyTextureToTexture(
      {
        texture: composite.destinationSnapshotTexture,
        origin: { x: copyRect.x, y: copyRect.y },
      },
      {
        texture: targetTexture,
        origin: { x: copyRect.x, y: copyRect.y },
      },
      {
        width: copyRect.width,
        height: copyRect.height,
        depthOrArrayLayers: 1,
      },
    );
  }

  /**
   * Replaces the previous preview from the immutable snapshot, expands the
   * latest CCL mask and renders it. Color changes do not require another CCL.
   */
  encodeLivePreview(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    targetView: GPUTextureView,
    restoreRect: DirtyRect | null,
    compositeMode: FillCompositeMode,
    fillColor: readonly [number, number, number, number],
    sourceSeedColorLinear: readonly [number, number, number, number],
    residualFringeRadius: 0 | 1 | 2 | 3,
  ): void {
    const scratch = this.requireScratch();
    this.assertLiveSession();
    this.uploadLiveCompositeUniforms(
      scratch,
      compositeMode,
      fillColor,
      sourceSeedColorLinear,
      residualFringeRadius,
    );
    if (restoreRect) {
      this.encodeLiveSnapshotRestore(encoder, targetTexture, restoreRect);
    }
    this.encodeResidualFringeRenderMask(encoder, scratch);
    this.encodeRender(encoder, targetView, scratch);
    if (this.lastDiagnosticInput) {
      this.lastDiagnosticInput = {
        ...this.lastDiagnosticInput,
        fillColor: [...fillColor],
        compositeMode,
      };
    }
  }

  /** Copies only the final authoritative 1-bit mask into one History slice. */
  encodeFinalMaskCapture(
    encoder: GPUCommandEncoder,
    historySlice: GpuHistorySlice,
  ): void {
    const scratch = this.requireScratch();
    this.assertLiveSession();
    this.assertHistorySlice(historySlice);
    encoder.copyBufferToBuffer(
      scratch.selectedMask,
      0,
      historySlice.buffer,
      historySlice.offsetBytes,
      this.metrics.historyMaskBytes,
    );
  }

  encodeReplayCommit(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    targetView: GPUTextureView,
    historySlice: GpuHistorySlice,
    fillColor: readonly [number, number, number, number],
    sourceSeedColorLinear: readonly [number, number, number, number],
    residualFringeRadius: 0 | 1 | 2 | 3,
    compositeMode: FillCompositeMode,
  ): void {
    const scratch = this.requireScratch();
    this.assertNoLiveSession("replay a Fill History entry");
    // Replay replaces selectedMask with a historical payload. Do not associate
    // a later Copy report with the seed/metadata of the previous live analyze.
    this.lastDiagnosticInput = null;
    this.assertHistorySlice(historySlice);
    this.encodeDestinationSnapshotCopy(encoder, targetTexture, scratch);
    const upload = new Float32Array(FILL_UNIFORM_BYTES / 4);
    const unsigned = new Uint32Array(upload.buffer);
    unsigned[2] = this.metrics.layerWidth;
    unsigned[3] = this.metrics.layerHeight;
    unsigned[6] = FILL_COMPOSITE_MODE_CODE[compositeMode];
    unsigned[7] = 0;
    upload.set(fillColor, 8);
    upload.set(sourceSeedColorLinear, 12);
    unsigned[16] = residualFringeRadius;
    this.device.queue.writeBuffer(scratch.uniformBuffer, 0, upload);
    this.device.queue.writeBuffer(scratch.drawIndirect, 0, new Uint32Array([4, 0, 0, 0]));
    encoder.copyBufferToBuffer(
      historySlice.buffer,
      historySlice.offsetBytes,
      scratch.selectedMask,
      0,
      this.metrics.historyMaskBytes,
    );
    encoder.clearBuffer(scratch.metadata);
    const pass = encoder.beginComputePass({ label: "Fill · rebuild block list" });
    pass.setPipeline(this.rebuildPipeline);
    pass.setBindGroup(0, scratch.computeBindGroup);
    pass.dispatchWorkgroups(this.metrics.blockGridWidth, this.metrics.blockGridHeight);
    pass.end();
    this.encodeResidualFringeRenderMask(encoder, scratch);
    this.encodeRender(encoder, targetView, scratch);
  }

  releaseScratch(): void {
    const scratch = this.scratch;
    this.scratch = null;
    this.liveSessionSourceIsTarget = null;
    this.lastDiagnosticInput = null;
    if (!scratch) return;
    this.destroyScratchResources(scratch);
  }

  private destroyScratchResources(scratch: FillScratchResources): void {
    scratch.uniformBuffer.destroy();
    scratch.packedLabels.destroy();
    scratch.globalParents.destroy();
    scratch.activeParentNodes.destroy();
    scratch.selectedMask.destroy();
    scratch.activeBlocks.destroy();
    scratch.metadata.destroy();
    scratch.drawIndirect.destroy();
    scratch.readback.destroy();
    scratch.composite?.destinationSnapshotTexture.destroy();
    scratch.composite = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseScratch();
  }

  private createComputeBindGroup(resources: Omit<
    FillScratchResources,
    | "computeBindGroup"
    | "readback"
    | "composite"
  >, sourceSamplingView: GPUTextureView): GPUBindGroup {
    return this.device.createBindGroup({
      label: "Fill · compute bind group",
      layout: this.computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: resources.uniformBuffer, size: FILL_UNIFORM_BYTES } },
        { binding: 1, resource: sourceSamplingView },
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

  private rebuildComputeBindGroupForCurrentSource(
    scratch: FillScratchResources,
  ): void {
    const sourceSamplingView = this.liveSessionSourceIsTarget === true
      ? this.requireCompositeScratch(scratch).destinationSnapshotView
      : this.configuredSourceSamplingView;
    scratch.computeBindGroup = this.createComputeBindGroup(
      scratch,
      sourceSamplingView,
    );
  }

  private uploadLiveCompositeUniforms(
    scratch: FillScratchResources,
    compositeMode: FillCompositeMode,
    fillColor: readonly [number, number, number, number],
    sourceSeedColorLinear: readonly [number, number, number, number],
    residualFringeRadius: 0 | 1 | 2 | 3,
  ): void {
    const upload = new ArrayBuffer(14 * 4);
    const unsigned = new Uint32Array(upload);
    const floats = new Float32Array(upload);
    unsigned[0] = FILL_COMPOSITE_MODE_CODE[compositeMode];
    unsigned[1] = this.liveSessionSourceIsTarget === true ? 1 : 0;
    floats.set(fillColor, 2);
    floats.set(sourceSeedColorLinear, 6);
    unsigned[10] = residualFringeRadius;
    this.device.queue.writeBuffer(scratch.uniformBuffer, 6 * 4, upload);
  }

  private encodeResidualFringeRenderMask(
    encoder: GPUCommandEncoder,
    scratch: FillScratchResources,
  ): void {
    const composite = this.requireCompositeScratch(scratch);
    encoder.clearBuffer(scratch.drawIndirect);
    const pass = encoder.beginComputePass({
      label: "Fill · monotonic residual fringe and low-8-bit render mask",
    });
    pass.setBindGroup(0, composite.fringeBindGroup);
    const wordWorkgroups = Math.ceil(this.metrics.historyMaskWords / 256);
    for (const pipeline of [
      this.residualFringePipeline1,
      this.residualFringePipeline2,
      this.residualFringePipeline3,
    ]) {
      pass.setPipeline(pipeline);
      pass.dispatchWorkgroups(wordWorkgroups);
    }
    pass.setPipeline(this.residualFringeBlockPipeline);
    pass.dispatchWorkgroups(this.metrics.blockGridWidth, this.metrics.blockGridHeight);
    pass.setPipeline(this.expandRenderMaskPipeline);
    pass.dispatchWorkgroups(wordWorkgroups);
    pass.end();
  }

  private encodeRender(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    scratch: FillScratchResources,
  ): void {
    const composite = this.requireCompositeScratch(scratch);
    const pass = encoder.beginRenderPass({
      label: "Fill · commit to selected layer",
      colorAttachments: [{
        view: targetView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setBindGroup(0, composite.renderBindGroup);
    pass.setPipeline(this.renderPipeline);
    pass.drawIndirect(scratch.drawIndirect, 0);
    pass.end();
  }

  private encodeDestinationSnapshotCopy(
    encoder: GPUCommandEncoder,
    targetTexture: GPUTexture,
    scratch: FillScratchResources,
  ): void {
    const composite = this.requireCompositeScratch(scratch);
    encoder.copyTextureToTexture(
      { texture: targetTexture },
      { texture: composite.destinationSnapshotTexture },
      {
        width: this.metrics.layerWidth,
        height: this.metrics.layerHeight,
        depthOrArrayLayers: 1,
      },
    );
  }

  private validateLiveRestoreRect(rect: DirtyRect): DirtyRect {
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every((value) => Number.isSafeInteger(value))) {
      throw new RangeError("A Fill snapshot restore rectangle must use integer coordinates.");
    }
    if (
      rect.x < 0
      || rect.y < 0
      || rect.width < 0
      || rect.height < 0
      || rect.x + rect.width > this.metrics.layerWidth
      || rect.y + rect.height > this.metrics.layerHeight
    ) {
      throw new RangeError("The Fill snapshot restore rectangle is outside the layer.");
    }
    return rect;
  }

  private assertLiveSession(): void {
    if (this.liveSessionSourceIsTarget === null) {
      throw new Error("No Fill live session is active.");
    }
  }

  private assertNoLiveSession(operation: string): void {
    if (this.liveSessionSourceIsTarget !== null) {
      throw new Error(`Cannot ${operation} while a Fill live session is active.`);
    }
  }

  private assertHistorySlice(slice: GpuHistorySlice): void {
    if (slice.logicalBytes !== this.metrics.historyMaskBytes) {
      throw new Error(
        `Fill history mask is ${slice.logicalBytes} B; expected ${this.metrics.historyMaskBytes} B.`,
      );
    }
  }

  private requireScratch(): FillScratchResources {
    if (!this.scratch) {
      throw new Error("Fill scratch is not resident.");
    }
    return this.scratch;
  }

  private requireCompositeScratch(
    scratch: FillScratchResources,
  ): FillCompositeScratchResources {
    if (!scratch.composite) {
      throw new Error("Fill composite scratch is not resident.");
    }
    return scratch.composite;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("The Fill renderer has already been destroyed.");
    }
  }
}
