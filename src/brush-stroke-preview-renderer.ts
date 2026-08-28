import {
  adaptivePreviewSrgb,
} from "./adaptive-preview-runtime";
import { srgbChannelToLinear } from "./brush-color.ts";
import type { BrushEngine } from "./brush-engine";
import {
  destroyGrainTextureResources,
  destroyShapeMaskResources,
  createGrainTextureResources,
  createShapeMaskResources,
} from "./engine-resource-setup";
import {
  BRUSH_UNIFORM_BYTES,
  GRAIN_UNIFORM_BYTES,
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES,
  LIGHT_GLAZE_UNIFORM_BYTES,
  MAX_STAMPS_PER_BATCH,
  STAMP_STRIDE_BYTES,
  STAMP_VERTICES_PER_COPY,
} from "./engine-limits";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { previewHash32 } from "./engine-math";
import { RGBA16_FLOAT_BYTES_PER_PIXEL } from "./float16";
import {
  packStampsIntoUpload,
  populateBrushUniformUpload,
  populateGrainUniformUpload,
  populateStrokeGlazeUniformUpload,
} from "./engine-stamp-upload";
import {
  grainCoordinateMode,
  isTexturizedGrainActive,
  usesStrokeGlazeRenderer,
} from "./engine-strategies";
import type {
  BrushSettings,
  LayerPoint,
} from "./engine-types";
import type { GrainTextureResources, ShapeMaskResources } from "./engine-paint-resources";
import {
  shapeAssetIdForSettings,
  shapeInvertForSettings,
  shapeMaskFormatForSettings,
} from "./engine-brush-assets";
import type { Stamp } from "./engine-stroke-types";
import {
  nextPaintStampSeed,
  resamplePaintCurveSegment,
} from "./paint-stamp-generation-core";
import { CausalStrokeCurvePlanner } from "./stroke-curve-core";
import { CausalFadedStrokeStabilizer } from "./stroke-stabilization-core";
import {
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessRadius,
  startThicknessFactor,
  thicknessDynamicsIsNeutral,
  thicknessDynamicsNeedsTailHoldback,
} from "./thickness-dynamics";
import { brushStrokePreviewPresentShader } from "./brush-stroke-preview-shader";

export const BRUSH_STROKE_PREVIEW_RENDERER_VERSION =
  "authoritative-paint-stamps-webgpu-v1" as const;

const SAMPLE_COUNT = 32;
const SAMPLE_INTERVAL_MS = 16;
const PREVIEW_SEED_SEQUENCE = 1;
const PREVIEW_MAX_PHYSICAL_COPIES = 24_576;
const IVORY_PREVIEW_COLOR = "#f2f0e9";

interface CanvasContextEntry {
  readonly context: GPUCanvasContext;
}

interface PreviewTarget {
  readonly width: number;
  readonly height: number;
  readonly accumulatorFormat: GPUTextureFormat;
  readonly layerFormat: GPUTextureFormat;
  readonly direct: boolean;
  readonly accumulatorTexture: GPUTexture;
  readonly accumulatorView: GPUTextureView;
  readonly resolvedTexture: GPUTexture;
  readonly resolvedView: GPUTextureView;
}

interface AcquiredPreviewAssets {
  readonly shapeView: GPUTextureView;
  readonly grainView: GPUTextureView;
  readonly grainWidth: number;
  readonly grainMipLevelCount: number;
  readonly ownedShape: ShapeMaskResources | null;
  readonly ownedGrain: GrainTextureResources | null;
}

interface PreviewStampCandidate {
  readonly stamp: Stamp;
  readonly baseRadius: number;
  readonly liveThicknessFactor: number;
  readonly timeMs: number;
}

interface ProjectedPreviewStroke {
  readonly settings: BrushSettings;
  readonly stamps: readonly Stamp[];
  readonly projectionScale: number;
}

interface RawPreviewPath {
  readonly points: readonly LayerPoint[];
  readonly projectionScale: number;
}

export interface BrushStrokePreviewRenderOptions {
  /** Library cards use a neutral swatch while Studio preserves the active color. */
  readonly color?: string;
  readonly seedSequence?: number;
  /** Enables a compact GPU readback used for cache diagnostics/tests. */
  readonly computePixelHash?: boolean;
}

export interface BrushStrokePreviewRenderResult {
  readonly rendered: boolean;
  readonly stale: boolean;
  readonly stampCount: number;
  readonly physicalCopyCount: number;
  readonly projectionScale: number;
  readonly pixelHash: string | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function hashPreviewPixels(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
): string {
  let hash = 0x811c9dc5;
  const rowBytes = width * RGBA16_FLOAT_BYTES_PER_PIXEL;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * bytesPerRow;
    for (let offset = 0; offset < rowBytes; offset += 1) {
      hash ^= bytes[rowStart + offset];
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildRawSamplePath(
  width: number,
  height: number,
  settings: Readonly<BrushSettings>,
): RawPreviewPath {
  const maximumThickness = Math.max(0.05, settings.startThickness, settings.endThickness);
  const sizeRatio = clamp(
    Math.log10(Math.max(1, settings.size)) / Math.log10(1500),
    0,
    1,
  );
  const authoredDiameter = height * (0.2 + sizeRatio * 0.5);
  const verticalExtentFactor = Math.max(
    1,
    maximumThickness * (1 + 2 * settings.positionJitterLateral),
  );
  const projectedDiameter = clamp(
    Math.min(authoredDiameter, height * 0.78 / verticalExtentFactor),
    2,
    height * 0.78,
  );
  const projectionScale = projectedDiameter / Math.max(1, settings.size);
  const horizontalReach = projectedDiameter * maximumThickness
    * (0.5 + settings.positionJitterLinear);
  const margin = clamp(horizontalReach + 3, 4, width * 0.24);
  const startX = margin;
  const endX = Math.max(startX + 1, width - margin);
  const pathLength = endX - startX;
  const centerY = height * 0.51;
  const waveAmplitude = Math.min(
    height * 0.105,
    Math.max(0, height * 0.43 - projectedDiameter * verticalExtentFactor * 0.5),
  );
  const points: LayerPoint[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const progress = index / (SAMPLE_COUNT - 1);
    const phase = (progress * 1.6 - 0.22) * Math.PI;
    points.push({
      x: startX + pathLength * progress,
      y: centerY + Math.sin(phase) * waveAmplitude,
      pressure: 1,
      timeMs: index * SAMPLE_INTERVAL_MS,
    });
  }
  return { points, projectionScale };
}

function stabilizedSamplePath(
  raw: readonly LayerPoint[],
  amount: number,
): readonly LayerPoint[] {
  if (amount <= 0 || raw.length < 2) return raw;
  const stabilizer = new CausalFadedStrokeStabilizer(Math.max(64, raw.length * 2));
  stabilizer.begin(raw[0], amount);
  const output: LayerPoint[] = [raw[0]];
  for (let index = 1; index < raw.length; index += 1) {
    const update = stabilizer.push(raw[index]);
    for (let mature = 0; mature < update.matureCount; mature += 1) {
      output.push({
        x: update.matureX[mature],
        y: update.matureY[mature],
        pressure: update.maturePressure[mature],
        timeMs: update.matureTimeMs[mature],
      });
    }
  }
  const final = stabilizer.finish();
  // tail[0] is the already committed seam/anchor, never a second input sample.
  for (let tail = 1; tail < final.tailCount; tail += 1) {
    output.push({
      x: final.tailX[tail],
      y: final.tailY[tail],
      pressure: final.tailPressure[tail],
      timeMs: final.tailTimeMs[tail],
    });
  }
  return output;
}

function generateProjectedPreviewStroke(
  width: number,
  height: number,
  sourceSettings: Readonly<BrushSettings>,
  color: string,
  initialSeedSequence: number,
): ProjectedPreviewStroke {
  const raw = buildRawSamplePath(width, height, sourceSettings);
  const projectionScale = raw.projectionScale;
  const settings: BrushSettings = {
    ...sourceSettings,
    tool: "paint",
    color,
    size: sourceSettings.size * projectionScale,
  };
  const points = stabilizedSamplePath(
    raw.points,
    usesStrokeGlazeRenderer(settings) ? settings.stabilization : 0,
  );
  if (points.length === 0) {
    return { settings, stamps: [], projectionScale };
  }

  const candidates: PreviewStampCandidate[] = [];
  const dynamicsNeutral = thicknessDynamicsIsNeutral(
    settings.startThickness,
    settings.endThickness,
  );
  const maximumBaseStampCount = Math.max(
    1,
    Math.min(
      MAX_STAMPS_PER_BATCH,
      Math.floor(PREVIEW_MAX_PHYSICAL_COPIES / Math.max(1, Math.round(settings.count))),
    ),
  );
  let seedSequence = initialSeedSequence;
  const startedAtMs = points[0].timeMs;
  const appendCandidate = (
    point: Readonly<LayerPoint>,
    directionX: number,
    directionY: number,
  ): void => {
    if (candidates.length >= maximumBaseStampCount) return;
    const baseRadius = Math.max(0.5, settings.size * 0.5);
    const liveThicknessFactor = dynamicsNeutral
      ? 1
      : startThicknessFactor(
        settings.startThickness,
        Math.max(0, point.timeMs - startedAtMs),
      );
    const stamp: Stamp = {
      x: point.x,
      y: point.y,
      radius: baseRadius * liveThicknessFactor,
      pressure: clamp(point.pressure, 0.01, 1),
      seed: nextPaintStampSeed(seedSequence++),
      directionX,
      directionY,
      historyActionId: 0,
      symmetryMode: "off",
      symmetryAngleRadians: 0,
    };
    candidates.push({ stamp, baseRadius, liveThicknessFactor, timeMs: point.timeMs });
  };

  appendCandidate(points[0], 1, 0);
  const planner = new CausalStrokeCurvePlanner();
  planner.reset();
  const spacing = Math.max(0.1, settings.size * (settings.spacingPercent / 100));
  let distanceSinceStamp = 0;
  for (
    let index = 1;
    index < points.length && candidates.length < maximumBaseStampCount;
    index += 1
  ) {
    const start = points[index - 1];
    const end = points[index];
    if (Math.hypot(end.x - start.x, end.y - start.y) <= 0.0001) continue;
    const curve = planner.plan(start.x, start.y, end.x, end.y);
    distanceSinceStamp = resamplePaintCurveSegment(
      curve,
      start,
      end,
      spacing,
      distanceSinceStamp,
      maximumBaseStampCount - candidates.length,
      undefined,
      (_context, point, directionX, directionY) => {
        appendCandidate(point, directionX, directionY);
      },
    );
  }

  // Hitting the preview-only physical-copy budget represents lifting at the
  // last emitted candidate. Spacing, Count, jitter and every deposited stamp
  // remain authored; only the length of this illustrative gesture is shorter.
  const liftTimeMs = candidates[candidates.length - 1]?.timeMs
    ?? points[points.length - 1].timeMs;
  const tailHoldback = thicknessDynamicsNeedsTailHoldback(settings.endThickness);
  const stamps = candidates.flatMap((candidate) => {
    const millisecondsBeforeLift = Math.max(0, liftTimeMs - candidate.timeMs);
    const radius = !tailHoldback || millisecondsBeforeLift >= THICKNESS_TAPER_WINDOW_MS
      ? candidate.stamp.radius
      : endThicknessRadius(
        candidate.baseRadius,
        candidate.liveThicknessFactor,
        settings.endThickness,
        millisecondsBeforeLift,
      );
    return radius > 0 ? [{ ...candidate.stamp, radius }] : [];
  });
  return { settings, stamps, projectionScale };
}

export class AuthoritativeBrushStrokePreviewRenderer {
  private readonly canvasContexts = new WeakMap<HTMLCanvasElement, CanvasContextEntry>();
  private readonly canvasRevisions = new WeakMap<HTMLCanvasElement, number>();
  private renderTail: Promise<void> = Promise.resolve();
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private instanceCapacity = 0;
  private instanceBuffer: GPUBuffer | null = null;
  private instanceUpload = new ArrayBuffer(0);
  private instanceUploadF32 = new Float32Array(0);
  private instanceUploadU32 = new Uint32Array(0);
  private brushUniformBuffer: GPUBuffer | null = null;
  private grainUniformBuffer: GPUBuffer | null = null;
  private glazeUniformBuffer: GPUBuffer | null = null;
  private commitOriginBuffer: GPUBuffer | null = null;
  private presentBindGroupLayout: GPUBindGroupLayout | null = null;
  private presentPipeline: GPURenderPipeline | null = null;
  private target: PreviewTarget | null = null;

  constructor(private readonly engine: BrushEngine) {}

  get cacheIdentity(): string {
    return [
      BRUSH_STROKE_PREVIEW_RENDERER_VERSION,
      this.engine.layerFormat,
      this.engine.canvasFormat,
    ].join(":");
  }

  invalidate(canvas: HTMLCanvasElement): void {
    this.canvasRevisions.set(canvas, (this.canvasRevisions.get(canvas) ?? 0) + 1);
  }

  render(
    canvas: HTMLCanvasElement,
    settings: Readonly<BrushSettings>,
    options: BrushStrokePreviewRenderOptions = {},
  ): Promise<BrushStrokePreviewRenderResult> {
    const revision = (this.canvasRevisions.get(canvas) ?? 0) + 1;
    this.canvasRevisions.set(canvas, revision);
    const snapshot = { ...settings };
    let resolveResult!: (result: BrushStrokePreviewRenderResult) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<BrushStrokePreviewRenderResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const task = this.renderTail.then(async () => {
      try {
        resolveResult(await this.renderNow(canvas, snapshot, options, revision));
      } catch (error) {
        rejectResult(error);
      }
    });
    this.renderTail = task.catch(() => undefined);
    return result;
  }

  private async renderNow(
    canvas: HTMLCanvasElement,
    sourceSettings: Readonly<BrushSettings>,
    options: BrushStrokePreviewRenderOptions,
    revision: number,
  ): Promise<BrushStrokePreviewRenderResult> {
    await this.ensureInitialized();
    const width = Math.max(1, Math.round(canvas.width));
    const height = Math.max(1, Math.round(canvas.height));
    const projected = generateProjectedPreviewStroke(
      width,
      height,
      sourceSettings,
      options.color ?? sourceSettings.color,
      options.seedSequence ?? PREVIEW_SEED_SEQUENCE,
    );
    if (this.canvasRevisions.get(canvas) !== revision) {
      return {
        rendered: false,
        stale: true,
        stampCount: projected.stamps.length,
        physicalCopyCount: projected.stamps.length * projected.settings.count,
        projectionScale: projected.projectionScale,
        pixelHash: null,
      };
    }
    const assets = await this.acquireAssets(
      projected.settings,
      () => this.canvasRevisions.get(canvas) === revision,
    );
    if (!assets || this.canvasRevisions.get(canvas) !== revision) {
      if (assets) this.releaseOwnedAssets(assets, false);
      return {
        rendered: false,
        stale: true,
        stampCount: projected.stamps.length,
        physicalCopyCount: projected.stamps.length * projected.settings.count,
        projectionScale: projected.projectionScale,
        pixelHash: null,
      };
    }

    try {
      this.ensureInstanceCapacity(projected.stamps.length);
      const target = this.ensureTarget(width, height, projected.settings);
      this.writeUploads(projected, assets);
      const canvasContext = this.canvasContext(canvas);
      const canvasTexture = canvasContext.getCurrentTexture();
      const encoder = this.engine.device.createCommandEncoder({
        label: "Authoritative brush preview encoder",
      });
      this.encodeBrush(encoder, target, projected.settings, projected.stamps.length, assets);
      if (usesStrokeGlazeRenderer(projected.settings)) {
        this.encodeGlazeResolve(encoder, target, projected.settings, projected.stamps);
      }
      this.encodePresentation(encoder, target, canvasTexture.createView());

      let readback: GPUBuffer | null = null;
      let readbackBytesPerRow = 0;
      if (options.computePixelHash) {
        readbackBytesPerRow = Math.ceil(
          (width * RGBA16_FLOAT_BYTES_PER_PIXEL) / 256,
        ) * 256;
        readback = this.engine.device.createBuffer({
          label: "Authoritative brush preview diagnostic readback",
          size: readbackBytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        encoder.copyTextureToBuffer(
          { texture: canvasTexture },
          { buffer: readback, bytesPerRow: readbackBytesPerRow, rowsPerImage: height },
          { width, height, depthOrArrayLayers: 1 },
        );
      }
      this.engine.device.queue.submit([encoder.finish()]);

      let pixelHash: string | null = null;
      if (readback) {
        try {
          await readback.mapAsync(GPUMapMode.READ);
          pixelHash = hashPreviewPixels(
            new Uint8Array(readback.getMappedRange()),
            width,
            height,
            readbackBytesPerRow,
          );
          readback.unmap();
        } finally {
          readback.destroy();
        }
      }
      this.releaseOwnedAssets(assets, !options.computePixelHash);
      if (this.canvasRevisions.get(canvas) !== revision) {
        return {
          rendered: false,
          stale: true,
          stampCount: projected.stamps.length,
          physicalCopyCount: projected.stamps.length * projected.settings.count,
          projectionScale: projected.projectionScale,
          pixelHash: null,
        };
      }
      canvas.dataset.previewRenderer = "authoritative-webgpu";
      canvas.dataset.previewStampCount = String(projected.stamps.length);
      canvas.dataset.previewPhysicalCopyCount = String(
        projected.stamps.length * projected.settings.count,
      );
      canvas.dataset.previewProjectionScale = String(projected.projectionScale);
      return {
        rendered: true,
        stale: false,
        stampCount: projected.stamps.length,
        physicalCopyCount: projected.stamps.length * projected.settings.count,
        projectionScale: projected.projectionScale,
        pixelHash,
      };
    } catch (error) {
      this.releaseOwnedAssets(assets, false);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.engine.initialized) {
      throw new Error("The authoritative preview renderer requires an initialized WebGPU engine.");
    }
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.initializeGpuResources();
    try {
      await this.initializationPromise;
      this.initialized = true;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async initializeGpuResources(): Promise<void> {
    const device = this.engine.device;
    this.brushUniformBuffer = device.createBuffer({
      label: "Authoritative brush preview uniforms",
      size: BRUSH_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.grainUniformBuffer = device.createBuffer({
      label: "Authoritative brush preview grain uniforms",
      size: GRAIN_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.glazeUniformBuffer = device.createBuffer({
      label: "Authoritative brush preview glaze uniforms",
      size: LIGHT_GLAZE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.commitOriginBuffer = device.createBuffer({
      label: "Authoritative brush preview commit origin",
      size: LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.commitOriginBuffer, 0, new Uint32Array([0, 0, 0, 0]));
    this.presentBindGroupLayout = device.createBindGroupLayout({
      label: "Authoritative brush preview presentation layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d" },
      }],
    });
    const shader = device.createShaderModule({
      label: "Authoritative brush preview presentation WGSL",
      code: brushStrokePreviewPresentShader,
    });
    await assertShaderCompiled(shader, "authoritative brush preview presentation");
    this.presentPipeline = device.createRenderPipeline({
      label: "Authoritative brush preview presentation pipeline",
      layout: device.createPipelineLayout({
        label: "Authoritative brush preview presentation pipeline layout",
        bindGroupLayouts: [this.presentBindGroupLayout],
      }),
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: this.engine.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private ensureInstanceCapacity(stampCount: number): void {
    const required = Math.max(1, stampCount);
    if (required <= this.instanceCapacity && this.instanceBuffer) return;
    const capacity = Math.min(MAX_STAMPS_PER_BATCH, nextPowerOfTwo(required));
    const previous = this.instanceBuffer;
    this.instanceBuffer = this.engine.device.createBuffer({
      label: `Authoritative brush preview stamps (${capacity})`,
      size: capacity * STAMP_STRIDE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.instanceCapacity = capacity;
    this.instanceUpload = new ArrayBuffer(capacity * STAMP_STRIDE_BYTES);
    this.instanceUploadF32 = new Float32Array(this.instanceUpload);
    this.instanceUploadU32 = new Uint32Array(this.instanceUpload);
    if (previous) {
      void this.engine.device.queue.onSubmittedWorkDone().then(() => previous.destroy());
    }
  }

  private ensureTarget(
    width: number,
    height: number,
    settings: Readonly<BrushSettings>,
  ): PreviewTarget {
    const direct = !usesStrokeGlazeRenderer(settings);
    const accumulatorFormat: GPUTextureFormat = direct
      ? this.engine.layerFormat
      : settings.blendMode === "light-glaze" || settings.blendMode === "m1-glaze"
        ? "r16float"
        : "rgba16float";
    const existing = this.target;
    if (
      existing
      && existing.width === width
      && existing.height === height
      && existing.accumulatorFormat === accumulatorFormat
      && existing.layerFormat === this.engine.layerFormat
      && existing.direct === direct
    ) {
      return existing;
    }

    const resolvedTexture = this.engine.device.createTexture({
      label: "Authoritative brush preview resolved layer",
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.engine.layerFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC,
    });
    const accumulatorTexture = direct
      ? resolvedTexture
      : this.engine.device.createTexture({
        label: "Authoritative brush preview gesture accumulator",
        size: { width, height, depthOrArrayLayers: 1 },
        format: accumulatorFormat,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_SRC,
      });
    const next: PreviewTarget = {
      width,
      height,
      accumulatorFormat,
      layerFormat: this.engine.layerFormat,
      direct,
      accumulatorTexture,
      accumulatorView: accumulatorTexture.createView(),
      resolvedTexture,
      resolvedView: resolvedTexture.createView(),
    };
    this.target = next;
    if (existing) {
      void this.engine.device.queue.onSubmittedWorkDone().then(() => {
        existing.accumulatorTexture.destroy();
        if (existing.resolvedTexture !== existing.accumulatorTexture) {
          existing.resolvedTexture.destroy();
        }
      });
    }
    return next;
  }

  private canvasContext(canvas: HTMLCanvasElement): GPUCanvasContext {
    const cached = this.canvasContexts.get(canvas);
    if (cached) return cached.context;
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("GPUCanvasContext is unavailable for the brush preview.");
    }
    context.configure({
      device: this.engine.device,
      format: this.engine.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    });
    this.canvasContexts.set(canvas, { context });
    return context;
  }

  private async acquireAssets(
    settings: Readonly<BrushSettings>,
    stillCurrent: () => boolean,
  ): Promise<AcquiredPreviewAssets | null> {
    let ownedShape: ShapeMaskResources | null = null;
    let ownedGrain: GrainTextureResources | null = null;
    try {
      const shapeRequired = settings.shape === "shape";
      const grainRequired = isTexturizedGrainActive(settings);
      const shapeAssetId = shapeAssetIdForSettings(settings);
      const shapeInvert = shapeInvertForSettings(settings);
      const shapeMaskFormat = shapeMaskFormatForSettings(settings);
      const activeLoads: Promise<unknown>[] = [];
      if (
        shapeRequired
        && this.engine.shapeLoadingPromise
        && this.engine.shapeDesiredAssetId === shapeAssetId
        && this.engine.shapeDesiredInvert === shapeInvert
        && this.engine.shapeDesiredFormat === shapeMaskFormat
      ) {
        activeLoads.push(this.engine.shapeLoadingPromise);
      }
      if (
        grainRequired
        && this.engine.grainLoadingPromise
        && this.engine.grainDesiredAssetId === settings.grainAssetId
      ) {
        activeLoads.push(this.engine.grainLoadingPromise);
      }
      if (activeLoads.length > 0) await Promise.all(activeLoads);
      if (!stillCurrent()) return null;

      const activeShapeMatches = !shapeRequired || (
        this.engine.shapeResourceSet
        && this.engine.shapeLoadedAssetId === shapeAssetId
        && this.engine.shapeLoadedInvert === shapeInvert
        && this.engine.shapeLoadedFormat === shapeMaskFormat
      );
      const activeGrainMatches = !grainRequired || (
        this.engine.grainResourceSet
        && this.engine.grainLoadedAssetId === settings.grainAssetId
      );
      const activeShapeBorrowSafe = activeShapeMatches && (
        !shapeRequired || this.engine.shapeLoadingPromise === null
      );
      const activeGrainBorrowSafe = activeGrainMatches && (
        !grainRequired || this.engine.grainLoadingPromise === null
      );

      // Borrow only when the complete candidate set is already active. If one
      // side still needs an asynchronous decode/upload, own both sides so an
      // engine retarget cannot invalidate a borrowed view during that await.
      if (!activeShapeBorrowSafe || !activeGrainBorrowSafe) {
        [ownedShape, ownedGrain] = await Promise.all([
          shapeRequired
            ? createShapeMaskResources(
              this.engine,
              shapeAssetId,
              shapeInvert,
              shapeMaskFormat,
            )
            : Promise.resolve(null),
          grainRequired
            ? createGrainTextureResources(this.engine, settings.grainAssetId)
            : Promise.resolve(null),
        ]);
      }

      const shapeView = !shapeRequired
        ? this.engine.shapeMaskPlaceholderView
        : ownedShape
          ? ownedShape.texture.createView({
            label: "Authoritative brush preview owned shape view",
          })
          : this.engine.shapeMaskView;
      const grainView = !grainRequired
        ? this.engine.grainPlaceholderView
        : ownedGrain
          ? ownedGrain.texture.createView({
            label: "Authoritative brush preview owned grain view",
          })
          : this.engine.grainTextureView;
      const grainWidth = !grainRequired
        ? 1
        : ownedGrain?.width ?? this.engine.grainTextureWidth;
      const grainMipLevelCount = !grainRequired
        ? 1
        : ownedGrain?.mipLevelCount ?? this.engine.grainTextureMipLevelCount;
      return {
        shapeView,
        grainView,
        grainWidth,
        grainMipLevelCount,
        ownedShape,
        ownedGrain,
      };
    } catch (error) {
      destroyShapeMaskResources(ownedShape);
      destroyGrainTextureResources(ownedGrain);
      throw error;
    }
  }

  private releaseOwnedAssets(assets: AcquiredPreviewAssets, afterSubmittedWork: boolean): void {
    const destroy = (): void => {
      destroyShapeMaskResources(assets.ownedShape);
      destroyGrainTextureResources(assets.ownedGrain);
    };
    if (afterSubmittedWork && (assets.ownedShape || assets.ownedGrain)) {
      void this.engine.device.queue.onSubmittedWorkDone().then(destroy);
    } else {
      destroy();
    }
  }

  private writeUploads(
    projected: ProjectedPreviewStroke,
    assets: AcquiredPreviewAssets,
  ): void {
    const { settings, stamps, projectionScale } = projected;
    const intense = settings.blendMode === "intense-blending";
    const glaze = usesStrokeGlazeRenderer(settings);
    const brushSettings: BrushSettings = glaze
      ? { ...settings, opacity: intense ? settings.opacity : 1, blendMode: "normal" }
      : settings;
    const brushUpload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
    populateBrushUniformUpload(
      brushUpload,
      brushSettings,
      this.target!.width,
      this.target!.height,
      0,
      0,
    );
    this.engine.device.queue.writeBuffer(this.brushUniformBuffer!, 0, brushUpload);
    packStampsIntoUpload(
      stamps,
      settings,
      this.instanceUploadF32,
      this.instanceUploadU32,
      stamps.length,
    );
    if (stamps.length > 0) {
      this.engine.device.queue.writeBuffer(
        this.instanceBuffer!,
        0,
        this.instanceUpload,
        0,
        stamps.length * STAMP_STRIDE_BYTES,
      );
    }
    if (isTexturizedGrainActive(settings)) {
      const grainUpload = new ArrayBuffer(GRAIN_UNIFORM_BYTES);
      populateGrainUniformUpload(
        grainUpload,
        settings,
        assets.grainWidth,
        assets.grainMipLevelCount,
        projectionScale,
      );
      this.engine.device.queue.writeBuffer(this.grainUniformBuffer!, 0, grainUpload);
    }
  }

  private brushBindGroup(
    settings: Readonly<BrushSettings>,
    assets: AcquiredPreviewAssets,
  ): GPUBindGroup {
    const grain = isTexturizedGrainActive(settings);
    return this.engine.device.createBindGroup({
      label: grain
        ? "Authoritative brush preview grain bind group"
        : "Authoritative brush preview bind group",
      layout: grain ? this.engine.grainBrushBindGroupLayout : this.engine.brushBindGroupLayout,
      entries: grain
        ? [
          { binding: 0, resource: { buffer: this.brushUniformBuffer! } },
          { binding: 1, resource: { buffer: this.instanceBuffer! } },
          { binding: 2, resource: assets.shapeView },
          { binding: 3, resource: this.engine.shapeMaskSampler },
          { binding: 5, resource: assets.grainView },
          {
            binding: 6,
            resource: this.engine.grainSamplers[
              grainCoordinateMode(settings)
            ][settings.grainFiltering],
          },
          { binding: 7, resource: { buffer: this.grainUniformBuffer! } },
        ]
        : [
          { binding: 0, resource: { buffer: this.brushUniformBuffer! } },
          { binding: 1, resource: { buffer: this.instanceBuffer! } },
          { binding: 2, resource: assets.shapeView },
          { binding: 3, resource: this.engine.shapeMaskSampler },
        ],
    });
  }

  private brushPipeline(settings: Readonly<BrushSettings>): GPURenderPipeline {
    const shape = settings.shape === "shape";
    const grain = isTexturizedGrainActive(settings);
    if (settings.blendMode === "light-glaze" || settings.blendMode === "m1-glaze") {
      return grain
        ? shape ? this.engine.grainLightNoBuildUpShapePipeline : this.engine.grainLightNoBuildUpPipeline
        : shape ? this.engine.lightNoBuildUpShapePipeline : this.engine.lightNoBuildUpPipeline;
    }
    if (settings.blendMode === "uniformed-glaze") {
      return grain
        ? shape ? this.engine.grainUniformedGlazeShapePipeline : this.engine.grainUniformedGlazePipeline
        : shape ? this.engine.uniformedGlazeShapePipeline : this.engine.uniformedGlazePipeline;
    }
    if (settings.blendMode === "intense-blending") {
      return grain
        ? shape ? this.engine.grainIntenseBlendingShapePipeline : this.engine.grainIntenseBlendingPipeline
        : shape ? this.engine.intenseBlendingShapePipeline : this.engine.intenseBlendingPipeline;
    }
    if (grain) {
      if (shape) {
        return settings.blendMode === "additive"
          ? this.engine.grainShapeAdditivePipeline
          : this.engine.grainShapeNormalPipeline;
      }
      return settings.blendMode === "additive"
        ? this.engine.grainAdditivePipeline
        : this.engine.grainNormalPipeline;
    }
    if (shape) {
      return settings.blendMode === "additive"
        ? this.engine.shapeAdditivePipeline
        : this.engine.shapeNormalPipeline;
    }
    return settings.blendMode === "additive"
      ? this.engine.additivePipeline
      : this.engine.normalPipeline;
  }

  private encodeBrush(
    encoder: GPUCommandEncoder,
    target: PreviewTarget,
    settings: Readonly<BrushSettings>,
    stampCount: number,
    assets: AcquiredPreviewAssets,
  ): void {
    const pass = encoder.beginRenderPass({
      label: "Authoritative brush preview stamp accumulation",
      colorAttachments: [{
        view: target.accumulatorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    if (stampCount > 0) {
      pass.setPipeline(this.brushPipeline(settings));
      pass.setBindGroup(0, this.brushBindGroup(settings, assets));
      pass.draw(STAMP_VERTICES_PER_COPY, stampCount * settings.count, 0, 0);
    }
    pass.end();
  }

  private encodeGlazeResolve(
    encoder: GPUCommandEncoder,
    target: PreviewTarget,
    settings: Readonly<BrushSettings>,
    stamps: readonly Stamp[],
  ): void {
    const light = settings.blendMode === "light-glaze" || settings.blendMode === "m1-glaze";
    const intense = settings.blendMode === "intense-blending";
    let tintLinear: readonly [number, number, number] | null = null;
    if (light && stamps.length > 0) {
      const [red, green, blue] = adaptivePreviewSrgb(
        previewHash32(stamps[0].seed),
        settings,
      );
      tintLinear = [
        srgbChannelToLinear(red),
        srgbChannelToLinear(green),
        srgbChannelToLinear(blue),
      ];
    }
    const glazeUpload = new ArrayBuffer(LIGHT_GLAZE_UNIFORM_BYTES);
    populateStrokeGlazeUniformUpload(
      glazeUpload,
      intense ? 1 : settings.opacity,
      this.engine.layerFormat,
      light
        ? "light-no-build-up"
        : intense ? "encoded-srgb-source-over" : "source-over",
      tintLinear,
    );
    this.engine.device.queue.writeBuffer(this.glazeUniformBuffer!, 0, glazeUpload);
    const bindGroup = this.engine.device.createBindGroup({
      label: "Authoritative brush preview exact glaze resolve",
      layout: this.engine.lightGlazeCommitTileBindGroupLayout,
      entries: [
        { binding: 0, resource: this.engine.transparentLayerView },
        { binding: 1, resource: target.accumulatorView },
        { binding: 2, resource: { buffer: this.glazeUniformBuffer! } },
        {
          binding: 3,
          resource: {
            buffer: this.commitOriginBuffer!,
            offset: 0,
            size: 16,
          },
        },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: "Authoritative brush preview glaze commit",
      colorAttachments: [{
        view: target.resolvedView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(this.engine.lightGlazeCommitTilePipeline);
    pass.setBindGroup(0, bindGroup, [0]);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  private encodePresentation(
    encoder: GPUCommandEncoder,
    target: PreviewTarget,
    outputView: GPUTextureView,
  ): void {
    const bindGroup = this.engine.device.createBindGroup({
      label: "Authoritative brush preview presentation bind group",
      layout: this.presentBindGroupLayout!,
      entries: [{ binding: 0, resource: target.resolvedView }],
    });
    const pass = encoder.beginRenderPass({
      label: "Present authoritative brush preview",
      colorAttachments: [{
        view: outputView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(this.presentPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
}

export const BRUSH_LIBRARY_PREVIEW_NEUTRAL_COLOR = IVORY_PREVIEW_COLOR;
