import { clamp, hexToHsl } from "./color";
import { brushShader, displayShader } from "./shaders";

export type BlendMode = "normal" | "additive";
export type LayerFormat = "rgba8unorm" | "rgba16float";

export interface BrushSettings {
  color: string;
  size: number;
  spacingPercent: number;
  count: number;
  flow: number;
  hardness: number;
  blendIntensity: number;
  blendMode: BlendMode;
  jitterMaster: number;
  hueJitterDegrees: number;
  saturationJitter: number;
  lightnessJitter: number;
  darknessJitter: number;
  jitterPerCopy: boolean;
  positionJitterLateral: number;
  positionJitterLinear: number;
  pressureSize: number;
  pressureOpacity: number;
}

export interface PointerSample {
  clientX: number;
  clientY: number;
  pressure: number;
}

export interface EngineStats {
  fps: number;
  lastCpuFrameMs: number;
  totalBaseStamps: number;
  avoidedLogicalDraws: number;
  layerMemoryMiB: number;
  gpuLabel: string;
  layerFormat: LayerFormat;
}

export interface BenchmarkResult {
  baseStamps: number;
  logicalCopies: number;
  cpuSubmitMs: number;
  gpuCompletionMs: number;
  estimatedCoveredFragments: number;
  strategy: string;
}

export interface StrokePerformanceProfile {
  stampGeometry: "quad";
  stampVerticesPerCopy: number;
  baseStamps: number;
  physicalCopies: number;
  renderFrames: number;
  brushBatches: number;
  largestBatchStamps: number;
  estimatedScissorPixels: number;
  stampGenerationMs: number;
  stampPackingMs: number;
  instanceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  cpuFrameP50Ms: number;
  cpuFrameP95Ms: number;
  cpuFrameMaxMs: number;
  renderIntervalP50Ms: number;
  renderIntervalP95Ms: number;
  renderIntervalMaxMs: number;
  averageRenderFps: number;
  delayedRenderFrames: number;
}

export interface EngineCallbacks {
  onStatus?: (message: string, kind: "working" | "ok" | "error") => void;
  onStats?: (stats: EngineStats) => void;
}

export interface LayerPoint {
  x: number;
  y: number;
  pressure: number;
}

interface Stamp {
  x: number;
  y: number;
  radius: number;
  pressure: number;
  seed: number;
  directionX: number;
  directionY: number;
}

interface ActiveStroke {
  lastInput: LayerPoint;
  distanceSinceStamp: number;
}

interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SubmitTiming {
  totalCpuMs: number;
  stampPackingMs: number;
  instanceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  scissorPixels: number;
}

interface MutableStrokePerformanceProfile {
  baseStamps: number;
  physicalCopies: number;
  renderFrames: number;
  brushBatches: number;
  largestBatchStamps: number;
  estimatedScissorPixels: number;
  stampGenerationMs: number;
  stampPackingMs: number;
  instanceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  cpuFrameMs: number[];
  renderIntervalMs: number[];
  previousFrameTimestamp: number | null;
}

const LAYER_SIZE = 4096;
const STAMP_STRIDE_BYTES = 32;
const MAX_STAMPS_PER_BATCH = 65_536;
const STAMP_VERTICES_PER_COPY = 4;
const STAMP_GEOMETRY = "quad" as const;
const BRUSH_UNIFORM_BYTES = 96;
const DISPLAY_UNIFORM_BYTES = 32;

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export const defaultBrushSettings: BrushSettings = {
  color: "#ff5b35",
  size: 96,
  spacingPercent: 1,
  count: 24,
  flow: 0.07,
  hardness: 0.88,
  blendIntensity: 1,
  blendMode: "normal",
  jitterMaster: 1,
  hueJitterDegrees: 12,
  saturationJitter: 0.18,
  lightnessJitter: 0.12,
  darknessJitter: 0.18,
  jitterPerCopy: false,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
  pressureSize: 0.65,
  pressureOpacity: 0.35,
};

export class BrushEngine {
  readonly layerSize = LAYER_SIZE;

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;

  private adapter!: GPUAdapter;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvasFormat!: GPUTextureFormat;

  private layerFormat: LayerFormat = "rgba8unorm";
  private layerTexture!: GPUTexture;
  private layerView!: GPUTextureView;

  private brushUniformBuffer!: GPUBuffer;
  private displayUniformBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private sampler!: GPUSampler;

  private brushBindGroupLayout!: GPUBindGroupLayout;
  private displayBindGroupLayout!: GPUBindGroupLayout;
  private brushBindGroup!: GPUBindGroup;
  private displayBindGroup!: GPUBindGroup;

  private brushShaderModule!: GPUShaderModule;
  private displayShaderModule!: GPUShaderModule;
  private normalPipeline!: GPURenderPipeline;
  private additivePipeline!: GPURenderPipeline;
  private displayPipeline!: GPURenderPipeline;

  private readonly instanceUpload = new ArrayBuffer(MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES);
  private readonly instanceUploadF32 = new Float32Array(this.instanceUpload);
  private readonly instanceUploadU32 = new Uint32Array(this.instanceUpload);
  private readonly brushUniformUpload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
  private readonly displayUniformUpload = new Float32Array(DISPLAY_UNIFORM_BYTES / 4);

  private settings: BrushSettings = { ...defaultBrushSettings };
  private pendingStamps: Stamp[] = [];
  private activeStroke: ActiveStroke | null = null;
  private seedSequence = 1;

  private frameRequest: number | null = null;
  private clearRequested = true;
  private displayDirty = true;
  private initialized = false;

  private viewCenterX = LAYER_SIZE * 0.5;
  private viewCenterY = LAYER_SIZE * 0.5;
  private zoom = 1;
  private hasFittedView = false;

  private totalBaseStamps = 0;
  private avoidedLogicalDraws = 0;
  private lastCpuFrameMs = 0;
  private renderTimestamps: number[] = [];
  private gpuLabel = "GPU WebGPU";
  private activeStrokeProfile: MutableStrokePerformanceProfile | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async initialize(): Promise<void> {
    this.callbacks.onStatus?.("Richiesta adapter WebGPU…", "working");

    if (!navigator.gpu) {
      throw new Error("WebGPU non è disponibile in questo browser o in questo contesto.");
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      throw new Error("Nessun adapter WebGPU compatibile trovato.");
    }
    this.adapter = adapter;

    if (adapter.limits.maxTextureDimension2D < LAYER_SIZE) {
      throw new Error(
        `La GPU supporta texture fino a ${adapter.limits.maxTextureDimension2D}px, meno dei ${LAYER_SIZE}px richiesti.`,
      );
    }

    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      const reason = info.message || info.reason;
      this.callbacks.onStatus?.(`Device WebGPU perso: ${reason}`, "error");
    });

    const context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("Impossibile ottenere GPUCanvasContext.");
    }
    this.context = context;

    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "opaque",
      colorSpace: "srgb",
    });

    this.gpuLabel = this.describeAdapter(adapter);
    await this.createStaticResources();
    await this.recreateLayerResources(this.layerFormat);

    this.resizeCanvas();
    this.fitView();
    this.writeBrushUniforms();

    this.initialized = true;
    this.requestRender();
    this.callbacks.onStatus?.("WebGPU pronto. Disegna sul canvas.", "ok");
    this.publishStats();
  }

  getSettings(): BrushSettings {
    return { ...this.settings };
  }

  setBrushSettings(next: Partial<BrushSettings>): void {
    this.settings = {
      ...this.settings,
      ...next,
      count: clamp(Math.round(next.count ?? this.settings.count), 1, 24),
      size: clamp(next.size ?? this.settings.size, 4, 1500),
      spacingPercent: clamp(next.spacingPercent ?? this.settings.spacingPercent, 0.25, 25),
      flow: clamp(next.flow ?? this.settings.flow, 0.001, 1),
      hardness: clamp(next.hardness ?? this.settings.hardness, 0, 1),
      blendIntensity: clamp(next.blendIntensity ?? this.settings.blendIntensity, 0.1, 4),
      jitterMaster: clamp(next.jitterMaster ?? this.settings.jitterMaster, 0, 1),
      hueJitterDegrees: clamp(next.hueJitterDegrees ?? this.settings.hueJitterDegrees, 0, 180),
      saturationJitter: clamp(next.saturationJitter ?? this.settings.saturationJitter, 0, 1),
      lightnessJitter: clamp(next.lightnessJitter ?? this.settings.lightnessJitter, 0, 1),
      darknessJitter: clamp(next.darknessJitter ?? this.settings.darknessJitter, 0, 1),
      positionJitterLateral: clamp(next.positionJitterLateral ?? this.settings.positionJitterLateral, 0, 1),
      positionJitterLinear: clamp(next.positionJitterLinear ?? this.settings.positionJitterLinear, 0, 1),
      pressureSize: clamp(next.pressureSize ?? this.settings.pressureSize, 0, 1),
      pressureOpacity: clamp(next.pressureOpacity ?? this.settings.pressureOpacity, 0, 1),
    };

    if (this.initialized) {
      this.writeBrushUniforms();
      this.displayDirty = true;
      this.requestRender();
    }
  }

  async setLayerFormat(format: LayerFormat): Promise<void> {
    if (!this.initialized || format === this.layerFormat) {
      return;
    }

    this.callbacks.onStatus?.(`Ricreo il layer in formato ${format}…`, "working");
    await this.device.queue.onSubmittedWorkDone();

    const previousFormat = this.layerFormat;
    try {
      await this.recreateLayerResources(format);
      this.layerFormat = format;
      this.clearRequested = true;
      this.displayDirty = true;
      this.requestRender();
      this.callbacks.onStatus?.(`Layer ${format} pronto. Il contenuto è stato azzerato.`, "ok");
      this.publishStats();
    } catch (error) {
      await this.recreateLayerResources(previousFormat);
      this.layerFormat = previousFormat;
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onStatus?.(`Formato ${format} non disponibile: ${message}`, "error");
      throw error;
    }
  }

  resizeCanvas(): void {
    if (!this.device || !this.context) {
      return;
    }

    const rectangle = this.canvas.getBoundingClientRect();
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rectangle.width * devicePixelRatio));
    const height = Math.max(1, Math.floor(rectangle.height * devicePixelRatio));

    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.displayDirty = true;

    if (!this.hasFittedView) {
      this.fitView();
    } else {
      this.requestRender();
    }
  }

  fitView(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    this.viewCenterX = LAYER_SIZE * 0.5;
    this.viewCenterY = LAYER_SIZE * 0.5;
    this.zoom = Math.max(0.01, Math.min(width / LAYER_SIZE, height / LAYER_SIZE) * 0.94);
    this.hasFittedView = true;
    this.displayDirty = true;
    this.requestRender();
  }

  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const rectangle = this.canvas.getBoundingClientRect();
    const anchorClientX = clientX ?? rectangle.left + rectangle.width * 0.5;
    const anchorClientY = clientY ?? rectangle.top + rectangle.height * 0.5;
    const anchorBefore = this.clientToLayer(anchorClientX, anchorClientY);

    this.zoom = clamp(this.zoom * factor, 0.02, 64);

    const screen = this.clientToCanvasPixels(anchorClientX, anchorClientY);
    this.viewCenterX = anchorBefore.x - (screen.x - this.canvas.width * 0.5) / this.zoom;
    this.viewCenterY = anchorBefore.y - (screen.y - this.canvas.height * 0.5) / this.zoom;
    this.displayDirty = true;
    this.requestRender();
  }

  panByClientDelta(deltaClientX: number, deltaClientY: number): void {
    const rectangle = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / Math.max(1, rectangle.width);
    const scaleY = this.canvas.height / Math.max(1, rectangle.height);
    this.viewCenterX -= (deltaClientX * scaleX) / this.zoom;
    this.viewCenterY -= (deltaClientY * scaleY) / this.zoom;
    this.displayDirty = true;
    this.requestRender();
  }

  beginStroke(sample: PointerSample): void {
    this.beginStrokeAtLayer(this.toLayerPoint(sample));
  }

  beginStrokeAtLayer(point: LayerPoint): void {
    this.activeStroke = {
      lastInput: point,
      distanceSinceStamp: 0,
    };
    this.emitStamp(point, 1, 0);
  }

  extendStroke(samples: readonly PointerSample[]): void {
    this.extendStrokeAtLayer(samples.map((sample) => this.toLayerPoint(sample)));
  }

  extendStrokeAtLayer(points: readonly LayerPoint[]): void {
    if (!this.activeStroke) {
      return;
    }

    for (const point of points) {
      this.appendPoint(point);
    }
  }

  endStroke(): void {
    this.activeStroke = null;
  }

  clear(): void {
    this.pendingStamps.length = 0;
    this.activeStroke = null;
    this.clearRequested = true;
    this.displayDirty = true;
    this.requestRender();
  }

  async runBenchmark(baseStampCount: number): Promise<BenchmarkResult> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }

    const count = clamp(Math.round(baseStampCount), 1, Math.min(12_000, MAX_STAMPS_PER_BATCH));
    this.pendingStamps.length = 0;
    this.activeStroke = null;

    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }

    await this.device.queue.onSubmittedWorkDone();
    const stamps = this.generateBenchmarkStamps(count);

    const completionStart = performance.now();
    const cpuSubmitMs = this.submitImmediate(stamps, true).totalCpuMs;
    this.clearRequested = false;
    this.displayDirty = false;
    await this.device.queue.onSubmittedWorkDone();
    const gpuCompletionMs = performance.now() - completionStart;

    this.totalBaseStamps += stamps.length;
    this.avoidedLogicalDraws += stamps.length * Math.max(0, this.settings.count - 1);
    this.recordRenderedFrame(performance.now());
    this.publishStats();

    const averageRadiusSquared = stamps.reduce((sum, stamp) => sum + stamp.radius * stamp.radius, 0) / stamps.length;
    const estimatedCoveredFragments = Math.round(
      Math.PI * averageRadiusSquared * stamps.length * this.settings.count,
    );
    const strategy = [
      "1 draw instanziata",
      `${this.settings.count} copie fisiche GPU per stamp base`,
      "geometria quad triangle-strip (4 vertici)",
    ].join(" · ");

    return {
      baseStamps: stamps.length,
      logicalCopies: stamps.length * this.settings.count,
      cpuSubmitMs,
      gpuCompletionMs,
      estimatedCoveredFragments,
      strategy,
    };
  }

  getStats(): EngineStats {
    const now = performance.now();
    this.renderTimestamps = this.renderTimestamps.filter((timestamp) => now - timestamp <= 1000);
    return {
      fps: this.renderTimestamps.length,
      lastCpuFrameMs: this.lastCpuFrameMs,
      totalBaseStamps: this.totalBaseStamps,
      avoidedLogicalDraws: this.avoidedLogicalDraws,
      layerMemoryMiB: this.layerFormat === "rgba16float" ? 128 : 64,
      gpuLabel: this.gpuLabel,
      layerFormat: this.layerFormat,
    };
  }

  async waitForGpu(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async waitForIdle(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Il motore non è ancora inizializzato.");
    }

    while (
      this.frameRequest !== null ||
      this.pendingStamps.length > 0 ||
      this.clearRequested ||
      this.displayDirty
    ) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    await this.device.queue.onSubmittedWorkDone();
  }

  resetStrokeRandomSeed(): void {
    this.seedSequence = 1;
  }

  startStrokePerformanceProfile(): void {
    this.activeStrokeProfile = {
      baseStamps: 0,
      physicalCopies: 0,
      renderFrames: 0,
      brushBatches: 0,
      largestBatchStamps: 0,
      estimatedScissorPixels: 0,
      stampGenerationMs: 0,
      stampPackingMs: 0,
      instanceUploadMs: 0,
      brushEncodingMs: 0,
      displayEncodingMs: 0,
      commandSubmitMs: 0,
      cpuFrameMs: [],
      renderIntervalMs: [],
      previousFrameTimestamp: null,
    };
  }

  finishStrokePerformanceProfile(): StrokePerformanceProfile | null {
    const profile = this.activeStrokeProfile;
    this.activeStrokeProfile = null;
    if (!profile) {
      return null;
    }
    const averageRenderIntervalMs = average(profile.renderIntervalMs);

    return {
      stampGeometry: STAMP_GEOMETRY,
      stampVerticesPerCopy: STAMP_VERTICES_PER_COPY,
      baseStamps: profile.baseStamps,
      physicalCopies: profile.physicalCopies,
      renderFrames: profile.renderFrames,
      brushBatches: profile.brushBatches,
      largestBatchStamps: profile.largestBatchStamps,
      estimatedScissorPixels: profile.estimatedScissorPixels,
      stampGenerationMs: profile.stampGenerationMs,
      stampPackingMs: profile.stampPackingMs,
      instanceUploadMs: profile.instanceUploadMs,
      brushEncodingMs: profile.brushEncodingMs,
      displayEncodingMs: profile.displayEncodingMs,
      commandSubmitMs: profile.commandSubmitMs,
      cpuFrameP50Ms: percentile(profile.cpuFrameMs, 0.5),
      cpuFrameP95Ms: percentile(profile.cpuFrameMs, 0.95),
      cpuFrameMaxMs: maximum(profile.cpuFrameMs),
      renderIntervalP50Ms: percentile(profile.renderIntervalMs, 0.5),
      renderIntervalP95Ms: percentile(profile.renderIntervalMs, 0.95),
      renderIntervalMaxMs: maximum(profile.renderIntervalMs),
      averageRenderFps: averageRenderIntervalMs > 0
        ? 1_000 / averageRenderIntervalMs
        : 0,
      delayedRenderFrames: profile.renderIntervalMs.filter((duration) => duration > 20).length,
    };
  }

  getBenchmarkEnvironment(): {
    canvasWidth: number;
    canvasHeight: number;
    layerSize: number;
    layerFormat: LayerFormat;
    layerMemoryMiB: number;
    gpuLabel: string;
    timestampQueriesSupported: boolean;
    stampGeometry: typeof STAMP_GEOMETRY;
    stampVerticesPerCopy: number;
  } {
    return {
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      layerSize: LAYER_SIZE,
      layerFormat: this.layerFormat,
      layerMemoryMiB: this.layerFormat === "rgba16float" ? 128 : 64,
      gpuLabel: this.gpuLabel,
      timestampQueriesSupported: this.device?.features.has("timestamp-query") ?? false,
      stampGeometry: STAMP_GEOMETRY,
      stampVerticesPerCopy: STAMP_VERTICES_PER_COPY,
    };
  }

  private async createStaticResources(): Promise<void> {
    this.brushUniformBuffer = this.device.createBuffer({
      label: "Brush uniforms",
      size: BRUSH_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.displayUniformBuffer = this.device.createBuffer({
      label: "Display uniforms",
      size: DISPLAY_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.instanceBuffer = this.device.createBuffer({
      label: "Stamp instance storage",
      size: MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.sampler = this.device.createSampler({
      label: "Layer linear sampler",
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.brushBindGroupLayout = this.device.createBindGroupLayout({
      label: "Brush bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    this.displayBindGroupLayout = this.device.createBindGroupLayout({
      label: "Display bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
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

    this.brushBindGroup = this.device.createBindGroup({
      label: "Brush bind group",
      layout: this.brushBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.brushUniformBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
      ],
    });

    this.brushShaderModule = this.device.createShaderModule({ label: "Brush WGSL", code: brushShader });
    this.displayShaderModule = this.device.createShaderModule({ label: "Display WGSL", code: displayShader });
    await Promise.all([
      this.assertShaderCompiled(this.brushShaderModule, "brush"),
      this.assertShaderCompiled(this.displayShaderModule, "display"),
    ]);

    const displayPipelineLayout = this.device.createPipelineLayout({
      label: "Display pipeline layout",
      bindGroupLayouts: [this.displayBindGroupLayout],
    });

    this.displayPipeline = this.device.createRenderPipeline({
      label: "Display pipeline",
      layout: displayPipelineLayout,
      vertex: {
        module: this.displayShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.displayShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private async recreateLayerResources(format: LayerFormat): Promise<void> {
    const oldTexture = this.layerTexture;

    const texture = this.device.createTexture({
      label: `4096² paint layer ${format}`,
      size: { width: LAYER_SIZE, height: LAYER_SIZE, depthOrArrayLayers: 1 },
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    const view = texture.createView();

    const brushPipelineLayout = this.device.createPipelineLayout({
      label: `Brush pipeline layout ${format}`,
      bindGroupLayouts: [this.brushBindGroupLayout],
    });

    this.device.pushErrorScope("validation");
    const normalPipeline = this.device.createRenderPipeline({
      label: `Brush normal ${format}`,
      layout: brushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const additivePipeline = this.device.createRenderPipeline({
      label: `Brush additive ${format}`,
      layout: brushPipelineLayout,
      vertex: {
        module: this.brushShaderModule,
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.brushShaderModule,
        entryPoint: "fragmentMain",
        targets: [
          {
            format,
            blend: {
              color: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "add",
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-strip" },
    });

    const validationError = await this.device.popErrorScope();
    if (validationError) {
      texture.destroy();
      throw new Error(validationError.message);
    }

    const displayBindGroup = this.device.createBindGroup({
      label: `Display bind group ${format}`,
      layout: this.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer } },
        { binding: 1, resource: view },
        { binding: 2, resource: this.sampler },
      ],
    });

    this.layerTexture = texture;
    this.layerView = view;
    this.normalPipeline = normalPipeline;
    this.additivePipeline = additivePipeline;
    this.displayBindGroup = displayBindGroup;
    this.layerFormat = format;

    oldTexture?.destroy();
  }

  private writeBrushUniforms(): void {
    const floats = new Float32Array(this.brushUniformUpload);
    const unsigned = new Uint32Array(this.brushUniformUpload);
    floats.fill(0);

    const [hue, saturation, lightness] = hexToHsl(this.settings.color);
    const jitterMaster = this.settings.jitterMaster;

    floats[0] = LAYER_SIZE;
    floats[1] = LAYER_SIZE;
    floats[4] = hue;
    floats[5] = saturation;
    floats[6] = lightness;
    floats[7] = 1;
    floats[8] = (this.settings.hueJitterDegrees / 360) * jitterMaster;
    floats[9] = this.settings.saturationJitter * jitterMaster;
    floats[10] = this.settings.lightnessJitter * jitterMaster;
    floats[11] = this.settings.darknessJitter * jitterMaster;
    floats[12] = this.settings.flow;
    floats[13] = this.settings.hardness;
    floats[14] = this.settings.blendIntensity;
    floats[15] = this.settings.pressureOpacity;
    floats[16] = this.settings.positionJitterLinear;
    floats[17] = this.settings.positionJitterLateral;
    unsigned[20] = this.settings.count >>> 0;
    unsigned[21] = this.settings.jitterPerCopy ? 1 : 0;
    unsigned[22] = this.settings.blendMode === "additive" ? 1 : 0;
    unsigned[23] = 0;

    this.device.queue.writeBuffer(this.brushUniformBuffer, 0, this.brushUniformUpload);
  }

  private writeDisplayUniforms(): void {
    this.displayUniformUpload[0] = this.canvas.width;
    this.displayUniformUpload[1] = this.canvas.height;
    this.displayUniformUpload[2] = LAYER_SIZE;
    this.displayUniformUpload[3] = LAYER_SIZE;
    this.displayUniformUpload[4] = this.viewCenterX;
    this.displayUniformUpload[5] = this.viewCenterY;
    this.displayUniformUpload[6] = this.zoom;
    this.displayUniformUpload[7] = 96;
    this.device.queue.writeBuffer(this.displayUniformBuffer, 0, this.displayUniformUpload);
  }

  toLayerPoint(sample: PointerSample): LayerPoint {
    const layer = this.clientToLayer(sample.clientX, sample.clientY);
    return {
      x: layer.x,
      y: layer.y,
      pressure: clamp(sample.pressure, 0.01, 1),
    };
  }

  private clientToCanvasPixels(clientX: number, clientY: number): { x: number; y: number } {
    const rectangle = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rectangle.left) / Math.max(1, rectangle.width)) * this.canvas.width,
      y: ((clientY - rectangle.top) / Math.max(1, rectangle.height)) * this.canvas.height,
    };
  }

  private clientToLayer(clientX: number, clientY: number): { x: number; y: number } {
    const screen = this.clientToCanvasPixels(clientX, clientY);
    return {
      x: this.viewCenterX + (screen.x - this.canvas.width * 0.5) / this.zoom,
      y: this.viewCenterY + (screen.y - this.canvas.height * 0.5) / this.zoom,
    };
  }

  private appendPoint(point: LayerPoint): void {
    const generationStart = this.activeStrokeProfile ? performance.now() : 0;
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }

    const start = stroke.lastInput;
    const deltaX = point.x - start.x;
    const deltaY = point.y - start.y;
    const segmentLength = Math.hypot(deltaX, deltaY);

    if (segmentLength <= 0.0001) {
      stroke.lastInput = point;
      this.recordStampGenerationTime(generationStart);
      return;
    }

    const spacing = Math.max(0.1, this.settings.size * (this.settings.spacingPercent / 100));
    const directionX = deltaX / segmentLength;
    const directionY = deltaY / segmentLength;
    let distanceAlongSegment = 0;
    let distanceSinceStamp = stroke.distanceSinceStamp;
    let generatedOnSegment = 0;

    while (distanceSinceStamp + (segmentLength - distanceAlongSegment) >= spacing) {
      const distanceToNextStamp = spacing - distanceSinceStamp;
      distanceAlongSegment += distanceToNextStamp;
      const interpolation = clamp(distanceAlongSegment / segmentLength, 0, 1);
      this.emitStamp({
        x: start.x + deltaX * interpolation,
        y: start.y + deltaY * interpolation,
        pressure: start.pressure + (point.pressure - start.pressure) * interpolation,
      }, directionX, directionY);
      distanceSinceStamp = 0;
      generatedOnSegment += 1;

      if (generatedOnSegment >= MAX_STAMPS_PER_BATCH) {
        break;
      }
    }

    distanceSinceStamp += Math.max(0, segmentLength - distanceAlongSegment);
    stroke.lastInput = point;
    stroke.distanceSinceStamp = distanceSinceStamp;
    this.recordStampGenerationTime(generationStart);
  }

  private emitStamp(point: LayerPoint, directionX: number, directionY: number): void {
    const pressure = clamp(point.pressure, 0.01, 1);
    const pressureSizeFactor = 1 - this.settings.pressureSize
      + this.settings.pressureSize * Math.max(0.08, pressure);
    const radius = Math.max(0.5, this.settings.size * 0.5 * pressureSizeFactor);
    const jitterReach = radius * 2 * (this.settings.positionJitterLinear + this.settings.positionJitterLateral);
    const seed = (Math.imul(this.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0;

    if (
      point.x + radius + jitterReach < 0 ||
      point.y + radius + jitterReach < 0 ||
      point.x - radius - jitterReach >= LAYER_SIZE ||
      point.y - radius - jitterReach >= LAYER_SIZE
    ) {
      return;
    }

    this.pendingStamps.push({
      x: point.x,
      y: point.y,
      radius,
      pressure,
      seed,
      directionX,
      directionY,
    });
    if (this.activeStrokeProfile) {
      this.activeStrokeProfile.baseStamps += 1;
    }
    this.displayDirty = true;
    this.requestRender();
  }

  private requestRender(): void {
    if (!this.initialized) {
      return;
    }
    if (this.frameRequest !== null) {
      return;
    }
    this.frameRequest = requestAnimationFrame((timestamp) => this.renderFrame(timestamp));
  }

  private renderFrame(timestamp: number): void {
    this.frameRequest = null;
    if (!this.initialized) {
      return;
    }
    this.resizeCanvas();

    const batchSize = Math.min(this.pendingStamps.length, MAX_STAMPS_PER_BATCH);
    const batch = batchSize > 0 ? this.pendingStamps.splice(0, batchSize) : [];
    const shouldSubmit = this.clearRequested || batch.length > 0 || this.displayDirty;

    if (!shouldSubmit || this.canvas.width <= 0 || this.canvas.height <= 0) {
      return;
    }

    const clearLayer = this.clearRequested;
    const start = performance.now();
    const timing = this.submitImmediate(batch, clearLayer);
    this.lastCpuFrameMs = performance.now() - start;
    this.recordStrokeFrameTiming(timestamp, batch.length, timing);

    this.clearRequested = false;
    this.displayDirty = false;
    this.totalBaseStamps += batch.length;
    this.avoidedLogicalDraws += batch.length * Math.max(0, this.settings.count - 1);
    this.recordRenderedFrame(timestamp);
    this.publishStats();

    if (this.pendingStamps.length > 0 || this.displayDirty || this.clearRequested) {
      this.requestRender();
    }
  }

  private submitImmediate(stamps: readonly Stamp[], clearLayer: boolean): SubmitTiming {
    const cpuStart = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Brush frame encoder" });
    let stampPackingMs = 0;
    let instanceUploadMs = 0;
    let brushEncodingMs = 0;
    let displayEncodingMs = 0;
    let commandSubmitMs = 0;
    let scissorPixels = 0;

    if (clearLayer || stamps.length > 0) {
      let dirtyRect: DirtyRect | null = null;
      if (stamps.length > 0) {
        const packingStart = performance.now();
        dirtyRect = this.packStamps(stamps);
        stampPackingMs = performance.now() - packingStart;
        const uploadStart = performance.now();
        this.device.queue.writeBuffer(
          this.instanceBuffer,
          0,
          this.instanceUpload,
          0,
          stamps.length * STAMP_STRIDE_BYTES,
        );
        instanceUploadMs = performance.now() - uploadStart;
      }

      const brushEncodingStart = performance.now();
      const brushPass = encoder.beginRenderPass({
        label: "Paint into 4096² layer",
        colorAttachments: [
          {
            view: this.layerView,
            loadOp: clearLayer ? "clear" : "load",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });

      if (stamps.length > 0 && dirtyRect) {
        scissorPixels = dirtyRect.width * dirtyRect.height;
        brushPass.setPipeline(this.settings.blendMode === "additive" ? this.additivePipeline : this.normalPipeline);
        brushPass.setBindGroup(0, this.brushBindGroup);
        brushPass.setScissorRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
        brushPass.draw(STAMP_VERTICES_PER_COPY, stamps.length * this.settings.count, 0, 0);
      }
      brushPass.end();
      brushEncodingMs = performance.now() - brushEncodingStart;
    }

    const displayEncodingStart = performance.now();
    this.writeDisplayUniforms();
    const displayPass = encoder.beginRenderPass({
      label: "Present paint layer",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
        },
      ],
    });
    displayPass.setPipeline(this.displayPipeline);
    displayPass.setBindGroup(0, this.displayBindGroup);
    displayPass.draw(3, 1, 0, 0);
    displayPass.end();
    displayEncodingMs = performance.now() - displayEncodingStart;

    const submitStart = performance.now();
    this.device.queue.submit([encoder.finish()]);
    commandSubmitMs = performance.now() - submitStart;
    return {
      totalCpuMs: performance.now() - cpuStart,
      stampPackingMs,
      instanceUploadMs,
      brushEncodingMs,
      displayEncodingMs,
      commandSubmitMs,
      scissorPixels,
    };
  }

  private packStamps(stamps: readonly Stamp[]): DirtyRect | null {
    let minimumX = LAYER_SIZE;
    let minimumY = LAYER_SIZE;
    let maximumX = 0;
    let maximumY = 0;

    for (let index = 0; index < stamps.length; index += 1) {
      const stamp = stamps[index];
      const base = index * (STAMP_STRIDE_BYTES / 4);
      this.instanceUploadF32[base] = stamp.x;
      this.instanceUploadF32[base + 1] = stamp.y;
      this.instanceUploadF32[base + 2] = stamp.radius;
      this.instanceUploadF32[base + 3] = stamp.pressure;
      this.instanceUploadU32[base + 4] = stamp.seed;
      this.instanceUploadU32[base + 5] = 0;
      this.instanceUploadF32[base + 6] = stamp.directionX;
      this.instanceUploadF32[base + 7] = stamp.directionY;

      const jitterReach = stamp.radius * 2 * (this.settings.positionJitterLinear + this.settings.positionJitterLateral);
      minimumX = Math.min(minimumX, stamp.x - stamp.radius - jitterReach - 2);
      minimumY = Math.min(minimumY, stamp.y - stamp.radius - jitterReach - 2);
      maximumX = Math.max(maximumX, stamp.x + stamp.radius + jitterReach + 2);
      maximumY = Math.max(maximumY, stamp.y + stamp.radius + jitterReach + 2);
    }

    const x = clamp(Math.floor(minimumX), 0, LAYER_SIZE - 1);
    const y = clamp(Math.floor(minimumY), 0, LAYER_SIZE - 1);
    const right = clamp(Math.ceil(maximumX), 1, LAYER_SIZE);
    const bottom = clamp(Math.ceil(maximumY), 1, LAYER_SIZE);
    const width = Math.max(0, right - x);
    const height = Math.max(0, bottom - y);

    return width > 0 && height > 0 ? { x, y, width, height } : null;
  }

  private generateBenchmarkStamps(count: number): Stamp[] {
    const stamps = new Array<Stamp>(count);
    const center = LAYER_SIZE * 0.5;
    const maximumPathRadius = LAYER_SIZE * 0.39;

    for (let index = 0; index < count; index += 1) {
      const progress = count <= 1 ? 0 : index / (count - 1);
      const angle = progress * Math.PI * 18;
      const pathRadius = maximumPathRadius * (0.12 + progress * 0.88);
      const pressure = clamp(0.58 + Math.sin(progress * Math.PI * 15) * 0.28, 0.1, 1);
      const pressureSizeFactor = 1 - this.settings.pressureSize
        + this.settings.pressureSize * Math.max(0.08, pressure);
      const radius = Math.max(0.5, this.settings.size * 0.5 * pressureSizeFactor);

      stamps[index] = {
        x: center + Math.cos(angle) * pathRadius,
        y: center + Math.sin(angle * 1.037) * pathRadius,
        radius,
        pressure,
        seed: (Math.imul(this.seedSequence++, 0x9e3779b1) ^ 0xa511e9b3) >>> 0,
        directionX: -Math.sin(angle),
        directionY: Math.cos(angle * 1.037),
      };
    }

    return stamps;
  }

  private recordRenderedFrame(timestamp: number): void {
    this.renderTimestamps.push(timestamp);
    const cutoff = timestamp - 1000;
    while (this.renderTimestamps.length > 0 && this.renderTimestamps[0] < cutoff) {
      this.renderTimestamps.shift();
    }
  }

  private recordStampGenerationTime(startTime: number): void {
    if (startTime > 0 && this.activeStrokeProfile) {
      this.activeStrokeProfile.stampGenerationMs += performance.now() - startTime;
    }
  }

  private recordStrokeFrameTiming(timestamp: number, batchSize: number, timing: SubmitTiming): void {
    const profile = this.activeStrokeProfile;
    if (!profile) {
      return;
    }

    if (profile.previousFrameTimestamp !== null) {
      profile.renderIntervalMs.push(Math.max(0, timestamp - profile.previousFrameTimestamp));
    }
    profile.previousFrameTimestamp = timestamp;
    profile.renderFrames += 1;
    profile.cpuFrameMs.push(this.lastCpuFrameMs);
    profile.stampPackingMs += timing.stampPackingMs;
    profile.instanceUploadMs += timing.instanceUploadMs;
    profile.brushEncodingMs += timing.brushEncodingMs;
    profile.displayEncodingMs += timing.displayEncodingMs;
    profile.commandSubmitMs += timing.commandSubmitMs;
    profile.estimatedScissorPixels += timing.scissorPixels;

    if (batchSize > 0) {
      profile.brushBatches += 1;
      profile.physicalCopies += batchSize * this.settings.count;
      profile.largestBatchStamps = Math.max(profile.largestBatchStamps, batchSize);
    }
  }

  private publishStats(): void {
    this.callbacks.onStats?.(this.getStats());
  }

  private async assertShaderCompiled(module: GPUShaderModule, label: string): Promise<void> {
    const compilationInfo = await module.getCompilationInfo();
    const errors = compilationInfo.messages.filter((message) => message.type === "error");
    if (errors.length === 0) {
      return;
    }

    const description = errors
      .map((error) => `${error.lineNum}:${error.linePos} ${error.message}`)
      .join("\n");
    throw new Error(`Errore WGSL nel modulo ${label}:\n${description}`);
  }

  private describeAdapter(adapter: GPUAdapter): string {
    const info = adapter.info;
    const values = [info.vendor, info.architecture, info.device, info.description]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return [...new Set(values)].join(" · ") || "GPU WebGPU";
  }
}
