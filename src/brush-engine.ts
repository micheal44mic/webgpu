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
  fragmentCoverageStrategy: "generic-smoothstep";
  colorSeedStrategy: "reuse-position-copy-seed";
  dirtyRectStrategy: "per-copy-tile-bounds";
  layerStorageStrategy: "tiled-2d-array";
  tileBinningStrategy: "cpu-stable-physical-copy-references";
  tileSizePx: number;
  tileGridWidth: number;
  tileGridHeight: number;
  tileGutterPixels: number;
  activeTileVisits: number;
  peakActiveTiles: number;
  physicalCopyTileAssignments: number;
  tileRenderPasses: number;
  tileBrushRenderPasses: number;
  tileClearRenderPasses: number;
  tileGutterCopies: number;
  estimatedTileAttachmentPixels: number;
  baseStamps: number;
  physicalCopies: number;
  renderFrames: number;
  brushBatches: number;
  largestBatchStamps: number;
  estimatedScissorPixels: number;
  stampGenerationMs: number;
  stampPackingMs: number;
  tileBinningMs: number;
  instanceUploadMs: number;
  copyReferenceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  submitImmediateP50Ms: number;
  submitImmediateP95Ms: number;
  submitImmediateMaxMs: number;
  renderFrameTotalP50Ms: number;
  renderFrameTotalP95Ms: number;
  renderFrameTotalMaxMs: number;
  renderFrameOverheadP50Ms: number;
  renderFrameOverheadP95Ms: number;
  renderFrameOverheadMaxMs: number;
  resizeCanvasTotalMs: number;
  batchExtractionTotalMs: number;
  statsPublishTotalMs: number;
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

interface SubmitTiming {
  totalCpuMs: number;
  stampPackingMs: number;
  tileBinningMs: number;
  instanceUploadMs: number;
  copyReferenceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  scissorPixels: number;
  activeTiles: number;
  physicalCopyTileAssignments: number;
  tileRenderPasses: number;
  tileBrushRenderPasses: number;
  tileClearRenderPasses: number;
  tileGutterCopies: number;
  tileAttachmentPixels: number;
}

interface RenderFrameTiming {
  totalCpuMs: number;
  resizeCanvasMs: number;
  batchExtractionMs: number;
  statsPublishMs: number;
}

interface MutableStrokePerformanceProfile {
  baseStamps: number;
  physicalCopies: number;
  renderFrames: number;
  brushBatches: number;
  largestBatchStamps: number;
  estimatedScissorPixels: number;
  activeTileVisits: number;
  peakActiveTiles: number;
  physicalCopyTileAssignments: number;
  tileRenderPasses: number;
  tileBrushRenderPasses: number;
  tileClearRenderPasses: number;
  tileGutterCopies: number;
  estimatedTileAttachmentPixels: number;
  stampGenerationMs: number;
  stampPackingMs: number;
  tileBinningMs: number;
  instanceUploadMs: number;
  copyReferenceUploadMs: number;
  brushEncodingMs: number;
  displayEncodingMs: number;
  commandSubmitMs: number;
  cpuFrameMs: number[];
  renderFrameTotalMs: number[];
  renderFrameOverheadMs: number[];
  resizeCanvasMs: number;
  batchExtractionMs: number;
  statsPublishMs: number;
  renderIntervalMs: number[];
  previousFrameTimestamp: number | null;
}

interface TileBinningResult {
  activeTiles: number[];
  assignmentCounts: Uint32Array;
  assignmentOffsets: Uint32Array;
  assignmentCount: number;
}

const LAYER_SIZE = 4096;
const TILE_SIZE = 512;
const TILE_GUTTER = 1;
const TILE_STORAGE_SIZE = TILE_SIZE + TILE_GUTTER * 2;
const TILE_GRID_WIDTH = LAYER_SIZE / TILE_SIZE;
const TILE_GRID_HEIGHT = LAYER_SIZE / TILE_SIZE;
const TILE_COUNT = TILE_GRID_WIDTH * TILE_GRID_HEIGHT;
const TILE_UNIFORM_BYTES = 16;
const COPY_REFERENCE_BYTES = 4;
const INITIAL_COPY_REFERENCE_CAPACITY = 1_024;
const TILE_BINNING_MARGIN = 2;
const STAMP_STRIDE_BYTES = 32;
const MAX_STAMPS_PER_BATCH = 65_536;
const STAMP_VERTICES_PER_COPY = 4;
const STAMP_GEOMETRY = "quad" as const;
const FRAGMENT_COVERAGE_STRATEGY = "generic-smoothstep" as const;
const COLOR_SEED_STRATEGY = "reuse-position-copy-seed" as const;
const DIRTY_RECT_STRATEGY = "per-copy-tile-bounds" as const;
const LAYER_STORAGE_STRATEGY = "tiled-2d-array" as const;
const TILE_BINNING_STRATEGY = "cpu-stable-physical-copy-references" as const;
const BRUSH_UNIFORM_BYTES = 96;
const DISPLAY_UNIFORM_BYTES = 48;

function hash32(value: number): number {
  let result = value >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result = (result ^ (result >>> 15)) >>> 0;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  return result;
}

function random01(seed: number, salt: number): number {
  const salted = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  return (hash32(salted) & 0x00ff_ffff) / 16_777_216;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

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
  private layerTileViews: GPUTextureView[] = [];

  private brushUniformBuffer!: GPUBuffer;
  private displayUniformBuffer!: GPUBuffer;
  private instanceBuffer!: GPUBuffer;
  private copyReferenceBuffer!: GPUBuffer;
  private tileUniformBuffer!: GPUBuffer;
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
  private copyReferenceUpload = new Uint32Array(INITIAL_COPY_REFERENCE_CAPACITY);
  private copyReferenceCapacity = INITIAL_COPY_REFERENCE_CAPACITY;
  private copyTileBounds = new Uint8Array(0);
  private tileUniformStride = TILE_UNIFORM_BYTES;
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
    if (adapter.limits.maxTextureArrayLayers < TILE_COUNT) {
      throw new Error(
        `La GPU supporta ${adapter.limits.maxTextureArrayLayers} layer texture, meno dei ${TILE_COUNT} tile richiesti.`,
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
      "draw instanziate soltanto per tile attiva",
      `${this.settings.count} copie fisiche GPU per stamp base`,
      "geometria quad triangle-strip (4 vertici)",
      "coverage fragment smoothstep generica",
      "riuso copySeed per jitter colore per copia",
      "limiti tile conservativi per copia",
      "layer 8×8 tile da 512 px con gutter",
      "binning stabile per copia fisica",
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
      layerMemoryMiB: this.getLayerMemoryMiB(),
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
      activeTileVisits: 0,
      peakActiveTiles: 0,
      physicalCopyTileAssignments: 0,
      tileRenderPasses: 0,
      tileBrushRenderPasses: 0,
      tileClearRenderPasses: 0,
      tileGutterCopies: 0,
      estimatedTileAttachmentPixels: 0,
      stampGenerationMs: 0,
      stampPackingMs: 0,
      tileBinningMs: 0,
      instanceUploadMs: 0,
      copyReferenceUploadMs: 0,
      brushEncodingMs: 0,
      displayEncodingMs: 0,
      commandSubmitMs: 0,
      cpuFrameMs: [],
      renderFrameTotalMs: [],
      renderFrameOverheadMs: [],
      resizeCanvasMs: 0,
      batchExtractionMs: 0,
      statsPublishMs: 0,
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
      fragmentCoverageStrategy: FRAGMENT_COVERAGE_STRATEGY,
      colorSeedStrategy: COLOR_SEED_STRATEGY,
      dirtyRectStrategy: DIRTY_RECT_STRATEGY,
      layerStorageStrategy: LAYER_STORAGE_STRATEGY,
      tileBinningStrategy: TILE_BINNING_STRATEGY,
      tileSizePx: TILE_SIZE,
      tileGridWidth: TILE_GRID_WIDTH,
      tileGridHeight: TILE_GRID_HEIGHT,
      tileGutterPixels: TILE_GUTTER,
      activeTileVisits: profile.activeTileVisits,
      peakActiveTiles: profile.peakActiveTiles,
      physicalCopyTileAssignments: profile.physicalCopyTileAssignments,
      tileRenderPasses: profile.tileRenderPasses,
      tileBrushRenderPasses: profile.tileBrushRenderPasses,
      tileClearRenderPasses: profile.tileClearRenderPasses,
      tileGutterCopies: profile.tileGutterCopies,
      estimatedTileAttachmentPixels: profile.estimatedTileAttachmentPixels,
      baseStamps: profile.baseStamps,
      physicalCopies: profile.physicalCopies,
      renderFrames: profile.renderFrames,
      brushBatches: profile.brushBatches,
      largestBatchStamps: profile.largestBatchStamps,
      estimatedScissorPixels: profile.estimatedScissorPixels,
      stampGenerationMs: profile.stampGenerationMs,
      stampPackingMs: profile.stampPackingMs,
      tileBinningMs: profile.tileBinningMs,
      instanceUploadMs: profile.instanceUploadMs,
      copyReferenceUploadMs: profile.copyReferenceUploadMs,
      brushEncodingMs: profile.brushEncodingMs,
      displayEncodingMs: profile.displayEncodingMs,
      commandSubmitMs: profile.commandSubmitMs,
      submitImmediateP50Ms: percentile(profile.cpuFrameMs, 0.5),
      submitImmediateP95Ms: percentile(profile.cpuFrameMs, 0.95),
      submitImmediateMaxMs: maximum(profile.cpuFrameMs),
      renderFrameTotalP50Ms: percentile(profile.renderFrameTotalMs, 0.5),
      renderFrameTotalP95Ms: percentile(profile.renderFrameTotalMs, 0.95),
      renderFrameTotalMaxMs: maximum(profile.renderFrameTotalMs),
      renderFrameOverheadP50Ms: percentile(profile.renderFrameOverheadMs, 0.5),
      renderFrameOverheadP95Ms: percentile(profile.renderFrameOverheadMs, 0.95),
      renderFrameOverheadMaxMs: maximum(profile.renderFrameOverheadMs),
      resizeCanvasTotalMs: profile.resizeCanvasMs,
      batchExtractionTotalMs: profile.batchExtractionMs,
      statsPublishTotalMs: profile.statsPublishMs,
      // Compatibilità con le run precedenti: questi tre campi continuano a
      // rappresentare soltanto submitImmediate(), non l'intero renderFrame().
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
    fragmentCoverageStrategy: typeof FRAGMENT_COVERAGE_STRATEGY;
    colorSeedStrategy: typeof COLOR_SEED_STRATEGY;
    dirtyRectStrategy: typeof DIRTY_RECT_STRATEGY;
    layerStorageStrategy: typeof LAYER_STORAGE_STRATEGY;
    tileBinningStrategy: typeof TILE_BINNING_STRATEGY;
    tileSizePx: number;
    tileGridWidth: number;
    tileGridHeight: number;
    tileGutterPixels: number;
  } {
    return {
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      layerSize: LAYER_SIZE,
      layerFormat: this.layerFormat,
      layerMemoryMiB: this.getLayerMemoryMiB(),
      gpuLabel: this.gpuLabel,
      timestampQueriesSupported: this.device?.features.has("timestamp-query") ?? false,
      stampGeometry: STAMP_GEOMETRY,
      stampVerticesPerCopy: STAMP_VERTICES_PER_COPY,
      fragmentCoverageStrategy: FRAGMENT_COVERAGE_STRATEGY,
      colorSeedStrategy: COLOR_SEED_STRATEGY,
      dirtyRectStrategy: DIRTY_RECT_STRATEGY,
      layerStorageStrategy: LAYER_STORAGE_STRATEGY,
      tileBinningStrategy: TILE_BINNING_STRATEGY,
      tileSizePx: TILE_SIZE,
      tileGridWidth: TILE_GRID_WIDTH,
      tileGridHeight: TILE_GRID_HEIGHT,
      tileGutterPixels: TILE_GUTTER,
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

    this.copyReferenceBuffer = this.device.createBuffer({
      label: "Tile copy-reference storage",
      size: this.copyReferenceCapacity * COPY_REFERENCE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.tileUniformStride = alignTo(
      TILE_UNIFORM_BYTES,
      this.device.limits.minUniformBufferOffsetAlignment,
    );
    this.tileUniformBuffer = this.device.createBuffer({
      label: "Tile draw uniforms",
      size: this.tileUniformStride * TILE_COUNT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const tileUniformUpload = new ArrayBuffer(this.tileUniformStride * TILE_COUNT);
    const tileUniformFloats = new Float32Array(tileUniformUpload);
    for (let tileIndex = 0; tileIndex < TILE_COUNT; tileIndex += 1) {
      const base = (tileIndex * this.tileUniformStride) / 4;
      tileUniformFloats[base] = (tileIndex % TILE_GRID_WIDTH) * TILE_SIZE;
      tileUniformFloats[base + 1] = Math.floor(tileIndex / TILE_GRID_WIDTH) * TILE_SIZE;
      tileUniformFloats[base + 2] = TILE_SIZE;
      tileUniformFloats[base + 3] = TILE_STORAGE_SIZE;
    }
    this.device.queue.writeBuffer(this.tileUniformBuffer, 0, tileUniformUpload);

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
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: TILE_UNIFORM_BYTES,
          },
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
          texture: { sampleType: "float", viewDimension: "2d-array" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: "filtering" },
        },
      ],
    });

    this.createBrushBindGroup();

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
      label: `4096² paint layer as ${TILE_GRID_WIDTH}×${TILE_GRID_HEIGHT} tiled array ${format}`,
      size: {
        width: TILE_STORAGE_SIZE,
        height: TILE_STORAGE_SIZE,
        depthOrArrayLayers: TILE_COUNT,
      },
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
    const view = texture.createView({
      label: `Paint tile array view ${format}`,
      dimension: "2d-array",
      baseArrayLayer: 0,
      arrayLayerCount: TILE_COUNT,
    });
    const tileViews = Array.from({ length: TILE_COUNT }, (_, tileIndex) => texture.createView({
      label: `Paint tile ${tileIndex} ${format}`,
      dimension: "2d",
      baseArrayLayer: tileIndex,
      arrayLayerCount: 1,
    }));

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
    this.layerTileViews = tileViews;
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
    this.displayUniformUpload[8] = TILE_SIZE;
    this.displayUniformUpload[9] = TILE_STORAGE_SIZE;
    this.displayUniformUpload[10] = TILE_GRID_WIDTH;
    this.displayUniformUpload[11] = TILE_GUTTER;
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
    const frameStart = performance.now();
    this.frameRequest = null;
    if (!this.initialized) {
      return;
    }

    const resizeStart = performance.now();
    this.resizeCanvas();
    const resizeCanvasMs = performance.now() - resizeStart;

    const batchExtractionStart = performance.now();
    const batchSize = Math.min(this.pendingStamps.length, MAX_STAMPS_PER_BATCH);
    const batch = batchSize > 0 ? this.pendingStamps.splice(0, batchSize) : [];
    const batchExtractionMs = performance.now() - batchExtractionStart;
    const shouldSubmit = this.clearRequested || batch.length > 0 || this.displayDirty;

    if (!shouldSubmit || this.canvas.width <= 0 || this.canvas.height <= 0) {
      return;
    }

    const clearLayer = this.clearRequested;
    const start = performance.now();
    const timing = this.submitImmediate(batch, clearLayer);
    this.lastCpuFrameMs = performance.now() - start;

    this.clearRequested = false;
    this.displayDirty = false;
    this.totalBaseStamps += batch.length;
    this.avoidedLogicalDraws += batch.length * Math.max(0, this.settings.count - 1);
    this.recordRenderedFrame(timestamp);

    const statsPublishStart = performance.now();
    this.publishStats();
    const statsPublishMs = performance.now() - statsPublishStart;

    if (this.pendingStamps.length > 0 || this.displayDirty || this.clearRequested) {
      this.requestRender();
    }

    this.recordStrokeFrameTiming(timestamp, batch.length, timing, {
      totalCpuMs: performance.now() - frameStart,
      resizeCanvasMs,
      batchExtractionMs,
      statsPublishMs,
    });
  }

  private submitImmediate(stamps: readonly Stamp[], clearLayer: boolean): SubmitTiming {
    const cpuStart = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "Brush frame encoder" });
    let stampPackingMs = 0;
    let tileBinningMs = 0;
    let instanceUploadMs = 0;
    let copyReferenceUploadMs = 0;
    let brushEncodingMs = 0;
    let displayEncodingMs = 0;
    let commandSubmitMs = 0;
    let scissorPixels = 0;
    let tileRenderPasses = 0;
    let tileBrushRenderPasses = 0;
    let tileClearRenderPasses = 0;
    let tileGutterCopies = 0;
    let tileAttachmentPixels = 0;
    let binning: TileBinningResult = {
      activeTiles: [],
      assignmentCounts: new Uint32Array(TILE_COUNT),
      assignmentOffsets: new Uint32Array(TILE_COUNT + 1),
      assignmentCount: 0,
    };

    if (clearLayer || stamps.length > 0) {
      if (stamps.length > 0) {
        const packingStart = performance.now();
        this.packStamps(stamps);
        stampPackingMs = performance.now() - packingStart;

        const binningStart = performance.now();
        binning = this.binPhysicalCopies(stamps.length);
        tileBinningMs = performance.now() - binningStart;

        const uploadStart = performance.now();
        this.device.queue.writeBuffer(
          this.instanceBuffer,
          0,
          this.instanceUpload,
          0,
          stamps.length * STAMP_STRIDE_BYTES,
        );
        instanceUploadMs = performance.now() - uploadStart;

        const copyReferenceUploadStart = performance.now();
        this.device.queue.writeBuffer(
          this.copyReferenceBuffer,
          0,
          this.copyReferenceUpload.buffer,
          0,
          binning.assignmentCount * COPY_REFERENCE_BYTES,
        );
        copyReferenceUploadMs = performance.now() - copyReferenceUploadStart;
      }

      const brushEncodingStart = performance.now();
      const encodeTilePass = (tileIndex: number): void => {
        const assignmentCount = binning.assignmentCounts[tileIndex];
        const brushPass = encoder.beginRenderPass({
          label: `Paint tile ${tileIndex}`,
          colorAttachments: [
            {
              view: this.layerTileViews[tileIndex],
              loadOp: clearLayer ? "clear" : "load",
              storeOp: "store",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
            },
          ],
        });

        tileRenderPasses += 1;
        if (clearLayer) {
          tileClearRenderPasses += 1;
        }
        if (assignmentCount > 0) {
          tileBrushRenderPasses += 1;
          brushPass.setPipeline(
            this.settings.blendMode === "additive" ? this.additivePipeline : this.normalPipeline,
          );
          brushPass.setBindGroup(0, this.brushBindGroup, [tileIndex * this.tileUniformStride]);
          brushPass.setViewport(0, 0, TILE_STORAGE_SIZE, TILE_STORAGE_SIZE, 0, 1);
          brushPass.setScissorRect(TILE_GUTTER, TILE_GUTTER, TILE_SIZE, TILE_SIZE);
          brushPass.draw(
            STAMP_VERTICES_PER_COPY,
            assignmentCount,
            0,
            binning.assignmentOffsets[tileIndex],
          );
        }
        brushPass.end();
      };

      if (clearLayer) {
        for (let tileIndex = 0; tileIndex < TILE_COUNT; tileIndex += 1) {
          encodeTilePass(tileIndex);
        }
      } else {
        for (const tileIndex of binning.activeTiles) {
          encodeTilePass(tileIndex);
        }
      }

      if (binning.activeTiles.length > 0) {
        tileGutterCopies = this.encodeTileGutterCopies(encoder, binning.activeTiles);
      }

      scissorPixels = tileBrushRenderPasses * TILE_SIZE * TILE_SIZE;
      tileAttachmentPixels = tileRenderPasses * TILE_STORAGE_SIZE * TILE_STORAGE_SIZE;
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
      tileBinningMs,
      instanceUploadMs,
      copyReferenceUploadMs,
      brushEncodingMs,
      displayEncodingMs,
      commandSubmitMs,
      scissorPixels,
      activeTiles: binning.activeTiles.length,
      physicalCopyTileAssignments: binning.assignmentCount,
      tileRenderPasses,
      tileBrushRenderPasses,
      tileClearRenderPasses,
      tileGutterCopies,
      tileAttachmentPixels,
    };
  }

  private packStamps(stamps: readonly Stamp[]): void {
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
    }
  }

  private binPhysicalCopies(stampCount: number): TileBinningResult {
    const copyCount = this.settings.count;
    const physicalCopyCount = stampCount * copyCount;
    const assignmentCounts = new Uint32Array(TILE_COUNT);
    const assignmentOffsets = new Uint32Array(TILE_COUNT + 1);

    this.ensureCopyTileBoundsCapacity(physicalCopyCount);

    for (let stampIndex = 0; stampIndex < stampCount; stampIndex += 1) {
      const base = stampIndex * (STAMP_STRIDE_BYTES / 4);
      const packedX = this.instanceUploadF32[base];
      const packedY = this.instanceUploadF32[base + 1];
      const packedRadius = this.instanceUploadF32[base + 2];
      const stampSeed = this.instanceUploadU32[base + 4];
      const packedDirectionX = this.instanceUploadF32[base + 6];
      const packedDirectionY = this.instanceUploadF32[base + 7];
      const directionLength = Math.hypot(packedDirectionX, packedDirectionY);
      const directionIsStable = directionLength < 0.00005 || directionLength > 0.0002;
      const directionX = directionLength > 0.0002 ? packedDirectionX / directionLength : 1;
      const directionY = directionLength > 0.0002 ? packedDirectionY / directionLength : 0;

      for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
        const physicalCopyIndex = stampIndex * copyCount + copyIndex;
        const boundsBase = physicalCopyIndex * 4;
        let left: number;
        let top: number;
        let right: number;
        let bottom: number;

        if (directionIsStable) {
          const copySeed = hash32(
            (stampSeed ^ Math.imul(copyIndex, 0x85ebca6b)) >>> 0,
          );
          const linearOffset = (random01(copySeed, 5) - 0.5)
            * 4
            * packedRadius
            * this.settings.positionJitterLinear;
          const lateralOffset = (random01(copySeed, 6) - 0.5)
            * 4
            * packedRadius
            * this.settings.positionJitterLateral;
          const centerX = packedX
            + directionX * linearOffset
            - directionY * lateralOffset;
          const centerY = packedY
            + directionY * linearOffset
            + directionX * lateralOffset;
          left = centerX - packedRadius - TILE_BINNING_MARGIN;
          top = centerY - packedRadius - TILE_BINNING_MARGIN;
          right = centerX + packedRadius + TILE_BINNING_MARGIN;
          bottom = centerY + packedRadius + TILE_BINNING_MARGIN;
        } else {
          // Vicino alla soglia di normalizzazione WGSL, usa il limite direzionale
          // conservativo della baseline #19 anziché rischiare di perdere una tile.
          const linearReach = packedRadius * 2 * this.settings.positionJitterLinear;
          const lateralReach = packedRadius * 2 * this.settings.positionJitterLateral;
          const isotropicReach = packedRadius + linearReach + lateralReach + TILE_BINNING_MARGIN;
          left = packedX - isotropicReach;
          top = packedY - isotropicReach;
          right = packedX + isotropicReach;
          bottom = packedY + isotropicReach;
        }

        if (right < 0 || bottom < 0 || left >= LAYER_SIZE || top >= LAYER_SIZE) {
          this.copyTileBounds[boundsBase] = 0xff;
          continue;
        }

        const minimumTileX = clamp(Math.floor(left / TILE_SIZE), 0, TILE_GRID_WIDTH - 1);
        const minimumTileY = clamp(Math.floor(top / TILE_SIZE), 0, TILE_GRID_HEIGHT - 1);
        const maximumTileX = clamp(Math.floor(right / TILE_SIZE), 0, TILE_GRID_WIDTH - 1);
        const maximumTileY = clamp(Math.floor(bottom / TILE_SIZE), 0, TILE_GRID_HEIGHT - 1);
        this.copyTileBounds[boundsBase] = minimumTileX;
        this.copyTileBounds[boundsBase + 1] = minimumTileY;
        this.copyTileBounds[boundsBase + 2] = maximumTileX;
        this.copyTileBounds[boundsBase + 3] = maximumTileY;

        for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
          const rowOffset = tileY * TILE_GRID_WIDTH;
          for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
            assignmentCounts[rowOffset + tileX] += 1;
          }
        }
      }
    }

    let assignmentCount = 0;
    const activeTiles: number[] = [];
    for (let tileIndex = 0; tileIndex < TILE_COUNT; tileIndex += 1) {
      assignmentOffsets[tileIndex] = assignmentCount;
      assignmentCount += assignmentCounts[tileIndex];
      if (assignmentCounts[tileIndex] > 0) {
        activeTiles.push(tileIndex);
      }
    }
    assignmentOffsets[TILE_COUNT] = assignmentCount;
    this.ensureCopyReferenceCapacity(assignmentCount);

    const writeOffsets = assignmentOffsets.slice(0, TILE_COUNT);
    // Lo stesso ordine stamp-major/copy-minor della draw monolitica viene
    // ricostruito indipendentemente in ogni segmento contiguo della tile.
    for (let stampIndex = 0; stampIndex < stampCount; stampIndex += 1) {
      for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
        const physicalCopyIndex = stampIndex * copyCount + copyIndex;
        const boundsBase = physicalCopyIndex * 4;
        if (this.copyTileBounds[boundsBase] === 0xff) {
          continue;
        }
        const minimumTileX = this.copyTileBounds[boundsBase];
        const minimumTileY = this.copyTileBounds[boundsBase + 1];
        const maximumTileX = this.copyTileBounds[boundsBase + 2];
        const maximumTileY = this.copyTileBounds[boundsBase + 3];
        const packedReference = (stampIndex | (copyIndex << 16)) >>> 0;

        for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
          const rowOffset = tileY * TILE_GRID_WIDTH;
          for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
            const tileIndex = rowOffset + tileX;
            this.copyReferenceUpload[writeOffsets[tileIndex]] = packedReference;
            writeOffsets[tileIndex] += 1;
          }
        }
      }
    }

    return {
      activeTiles,
      assignmentCounts,
      assignmentOffsets,
      assignmentCount,
    };
  }

  private ensureCopyTileBoundsCapacity(physicalCopyCount: number): void {
    const requiredBytes = physicalCopyCount * 4;
    if (this.copyTileBounds.length >= requiredBytes) {
      return;
    }

    let capacity = Math.max(4_096, this.copyTileBounds.length || 0);
    while (capacity < requiredBytes) {
      capacity *= 2;
    }
    this.copyTileBounds = new Uint8Array(capacity);
  }

  private ensureCopyReferenceCapacity(requiredReferences: number): void {
    if (requiredReferences <= this.copyReferenceCapacity) {
      return;
    }

    let capacity = this.copyReferenceCapacity;
    while (capacity < requiredReferences) {
      capacity *= 2;
    }
    const requiredBytes = capacity * COPY_REFERENCE_BYTES;
    const maximumBytes = Number(this.device.limits.maxStorageBufferBindingSize);
    if (requiredBytes > maximumBytes) {
      throw new Error(
        `Il binning richiede ${requiredBytes} byte di riferimenti, oltre il limite GPU di ${maximumBytes}.`,
      );
    }

    const oldBuffer = this.copyReferenceBuffer;
    this.copyReferenceBuffer = this.device.createBuffer({
      label: "Tile copy-reference storage",
      size: requiredBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.copyReferenceCapacity = capacity;
    this.copyReferenceUpload = new Uint32Array(capacity);
    this.createBrushBindGroup();
    oldBuffer.destroy();
  }

  private createBrushBindGroup(): void {
    this.brushBindGroup = this.device.createBindGroup({
      label: "Brush tiled bind group",
      layout: this.brushBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.brushUniformBuffer } },
        { binding: 1, resource: { buffer: this.instanceBuffer } },
        { binding: 2, resource: { buffer: this.copyReferenceBuffer } },
        {
          binding: 3,
          resource: {
            buffer: this.tileUniformBuffer,
            offset: 0,
            size: TILE_UNIFORM_BYTES,
          },
        },
      ],
    });
  }

  private encodeTileGutterCopies(
    encoder: GPUCommandEncoder,
    activeTiles: readonly number[],
  ): number {
    // Sincronizza soltanto dopo avere composto tutte le copie del batch: il
    // display lineare vede così gli stessi pixel finali su entrambi i lati.
    let copyCount = 0;

    for (const tileIndex of activeTiles) {
      const tileX = tileIndex % TILE_GRID_WIDTH;
      const tileY = Math.floor(tileIndex / TILE_GRID_WIDTH);

      if (tileX > 0) {
        this.copyTileRegion(encoder, tileIndex, 1, 1, tileIndex - 1, TILE_STORAGE_SIZE - 1, 1, 1, TILE_SIZE);
        copyCount += 1;
      }
      if (tileX + 1 < TILE_GRID_WIDTH) {
        this.copyTileRegion(encoder, tileIndex, TILE_SIZE, 1, tileIndex + 1, 0, 1, 1, TILE_SIZE);
        copyCount += 1;
      }
      if (tileY > 0) {
        this.copyTileRegion(encoder, tileIndex, 1, 1, tileIndex - TILE_GRID_WIDTH, 1, TILE_STORAGE_SIZE - 1, TILE_SIZE, 1);
        copyCount += 1;
      }
      if (tileY + 1 < TILE_GRID_HEIGHT) {
        this.copyTileRegion(encoder, tileIndex, 1, TILE_SIZE, tileIndex + TILE_GRID_WIDTH, 1, 0, TILE_SIZE, 1);
        copyCount += 1;
      }
      if (tileX > 0 && tileY > 0) {
        this.copyTileRegion(encoder, tileIndex, 1, 1, tileIndex - TILE_GRID_WIDTH - 1, TILE_STORAGE_SIZE - 1, TILE_STORAGE_SIZE - 1, 1, 1);
        copyCount += 1;
      }
      if (tileX + 1 < TILE_GRID_WIDTH && tileY > 0) {
        this.copyTileRegion(encoder, tileIndex, TILE_SIZE, 1, tileIndex - TILE_GRID_WIDTH + 1, 0, TILE_STORAGE_SIZE - 1, 1, 1);
        copyCount += 1;
      }
      if (tileX > 0 && tileY + 1 < TILE_GRID_HEIGHT) {
        this.copyTileRegion(encoder, tileIndex, 1, TILE_SIZE, tileIndex + TILE_GRID_WIDTH - 1, TILE_STORAGE_SIZE - 1, 0, 1, 1);
        copyCount += 1;
      }
      if (tileX + 1 < TILE_GRID_WIDTH && tileY + 1 < TILE_GRID_HEIGHT) {
        this.copyTileRegion(encoder, tileIndex, TILE_SIZE, TILE_SIZE, tileIndex + TILE_GRID_WIDTH + 1, 0, 0, 1, 1);
        copyCount += 1;
      }
    }

    return copyCount;
  }

  private copyTileRegion(
    encoder: GPUCommandEncoder,
    sourceTile: number,
    sourceX: number,
    sourceY: number,
    destinationTile: number,
    destinationX: number,
    destinationY: number,
    width: number,
    height: number,
  ): void {
    encoder.copyTextureToTexture(
      {
        texture: this.layerTexture,
        origin: { x: sourceX, y: sourceY, z: sourceTile },
      },
      {
        texture: this.layerTexture,
        origin: { x: destinationX, y: destinationY, z: destinationTile },
      },
      { width, height, depthOrArrayLayers: 1 },
    );
  }

  private getLayerMemoryMiB(): number {
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    return (TILE_STORAGE_SIZE * TILE_STORAGE_SIZE * TILE_COUNT * bytesPerPixel) / (1024 * 1024);
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

  private recordStrokeFrameTiming(
    timestamp: number,
    batchSize: number,
    timing: SubmitTiming,
    frameTiming: RenderFrameTiming,
  ): void {
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
    profile.renderFrameTotalMs.push(frameTiming.totalCpuMs);
    profile.renderFrameOverheadMs.push(Math.max(0, frameTiming.totalCpuMs - timing.totalCpuMs));
    profile.resizeCanvasMs += frameTiming.resizeCanvasMs;
    profile.batchExtractionMs += frameTiming.batchExtractionMs;
    profile.statsPublishMs += frameTiming.statsPublishMs;
    profile.stampPackingMs += timing.stampPackingMs;
    profile.tileBinningMs += timing.tileBinningMs;
    profile.instanceUploadMs += timing.instanceUploadMs;
    profile.copyReferenceUploadMs += timing.copyReferenceUploadMs;
    profile.brushEncodingMs += timing.brushEncodingMs;
    profile.displayEncodingMs += timing.displayEncodingMs;
    profile.commandSubmitMs += timing.commandSubmitMs;
    profile.estimatedScissorPixels += timing.scissorPixels;
    profile.activeTileVisits += timing.activeTiles;
    profile.peakActiveTiles = Math.max(profile.peakActiveTiles, timing.activeTiles);
    profile.physicalCopyTileAssignments += timing.physicalCopyTileAssignments;
    profile.tileRenderPasses += timing.tileRenderPasses;
    profile.tileBrushRenderPasses += timing.tileBrushRenderPasses;
    profile.tileClearRenderPasses += timing.tileClearRenderPasses;
    profile.tileGutterCopies += timing.tileGutterCopies;
    profile.estimatedTileAttachmentPixels += timing.tileAttachmentPixels;

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
