import type { BrushEngine } from "../../brush-engine";
import {
  BRUSH_UNIFORM_BYTES,
  GRAIN_UNIFORM_BYTES,
  SHAPE_MASK_SIZE,
  SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO,
  SHAPE_OCCUPANCY_MAX_MIP,
  SHAPE_OCCUPANCY_MIN_RADIUS,
  STAMP_STRIDE_BYTES,
} from "../../engine-limits";
import {
  populateBrushUniformUpload,
  populateGrainUniformUpload,
} from "../../engine-stamp-upload";
import type { BrushSettings } from "../../engine-types";
import { usesOpticalDepthPaintDabProfile } from "../../paint-dab-profile";
import { buildDirtyAabb, type DirtyRegionRect } from "./dirty-region-lab-model";
import {
  loadHumanDirtyRegionWorkload,
  type HumanDirtyRegionWorkload,
} from "./dirty-region-human-workload";
import {
  PREPARED_COPY_INSTANCE_SHADER,
  PREPARED_COPY_INSTANCE_STRIDE_BYTES,
  PREPARED_COPY_WORKGROUP_SIZE,
} from "./prepared-copy-instance-shaders";

const REPORT_VERSION = 1;
const DEFAULT_TARGET_SIZE = 2048;
const MINIMUM_TARGET_SIZE = 1024;
const DEFAULT_MEASURED_RUNS = 3;
const MAXIMUM_MEASURED_RUNS = 7;
const WARMUP_RUNS = 1;
const COPY_COUNT = 16;

type StrategyId =
  | "one-procedural"
  | "sixteen-procedural"
  | "sixteen-prepared-resident"
  | "sixteen-prepared-compute";
type RenderModeId = "light-glaze" | "uniformed-glaze" | "intense-blending";

interface RenderModeDefinition {
  readonly id: RenderModeId;
  readonly label: string;
  readonly targetFormat: "r16float" | "rgba16float";
  readonly fragmentEntryPoint:
    | "shapeFragmentMain"
    | "encodedSrgbShapeFragmentMain"
    | "shapeCoverageFragmentMain"
    | "shapeOpticalDepthFragmentMain"
    | "shapeOccupancyFragmentMain"
    | "encodedSrgbShapeOccupancyFragmentMain"
    | "shapeOccupancyCoverageFragmentMain"
    | "shapeOccupancyOpticalDepthFragmentMain";
  readonly blend: GPUBlendState;
}

interface StrategyDefinition {
  readonly id: StrategyId;
  readonly label: string;
  readonly copyCount: 1 | 16;
  readonly prepared: boolean;
  readonly includePreparation: boolean;
}

interface PreparedFrame {
  readonly sourceIndex: number;
  readonly inputTimeMs: number;
  readonly baseStampOffset: number;
  readonly stampCount: number;
  readonly outputOffset: number;
  readonly dirtyRect: DirtyRegionRect;
}

interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly samplesMs: readonly number[];
}

interface BacklogSummary {
  readonly maximumQueueBeforeMs: number;
  readonly maximumCompletionLagMs: number;
  readonly p95CompletionLagMs: number;
  readonly recoveryAfterLastInputMs: number;
  readonly framesCompletingAfterNextInput: number;
}

interface GpuFrameTiming {
  readonly totalMs: number;
  readonly preparationMs: number;
  readonly renderMs: number;
}

interface TimingSample {
  readonly cpuEncodeSubmitMs: number;
  readonly queueDrainMs: number;
  readonly wallMs: number;
  readonly gpuFrames: readonly GpuFrameTiming[] | null;
}

interface TimingResult {
  readonly cpuEncodeSubmit: TimingSummary;
  readonly queueDrain: TimingSummary;
  readonly wall: TimingSummary;
  readonly gpuTotal: TimingSummary | null;
  readonly gpuPreparation: TimingSummary | null;
  readonly gpuRender: TimingSummary | null;
  readonly medianGpuFrames: readonly GpuFrameTiming[] | null;
  readonly backlog: BacklogSummary | null;
  readonly raw: readonly TimingSample[];
}

interface RasterComparison {
  readonly exactMismatchPixels: number;
  readonly pixelsOverOne4096: number;
  readonly pixelsOverOne1024: number;
  readonly pixelsOverOne255: number;
  readonly maximumAbsoluteError: number;
  readonly totalPixels: number;
  readonly exact: boolean;
  readonly withinThreshold: boolean;
}

interface MeasuredStrategy extends StrategyDefinition {
  timing?: TimingResult;
  comparison?: RasterComparison;
}

interface ModeRenderer {
  initializePreparedResident(): Promise<void>;
  run(strategy: StrategyDefinition): Promise<TimingSample>;
  renderFull(strategy: StrategyDefinition): Promise<void>;
  captureReference(): Promise<void>;
  compareWithReference(): Promise<RasterComparison>;
  destroy(): void;
}

export interface PreparedCopyInstanceLabProgress {
  readonly completed: number;
  readonly total: number;
  readonly message: string;
}

export interface PreparedCopyInstanceLabOptions {
  readonly applySettings?: (settings: BrushSettings) => void;
  readonly onProgress?: (progress: PreparedCopyInstanceLabProgress) => void;
}

const STRATEGIES: readonly StrategyDefinition[] = [
  {
    id: "one-procedural",
    label: "Count 1 · procedurale",
    copyCount: 1,
    prepared: false,
    includePreparation: false,
  },
  {
    id: "sixteen-procedural",
    label: "Count 16 · procedurale",
    copyCount: 16,
    prepared: false,
    includePreparation: false,
  },
  {
    id: "sixteen-prepared-resident",
    label: "Count 16 · preparato residente",
    copyCount: 16,
    prepared: true,
    includePreparation: false,
  },
  {
    id: "sixteen-prepared-compute",
    label: "Count 16 · compute + render",
    copyCount: 16,
    prepared: true,
    includePreparation: true,
  },
];

const SOURCE_OVER_BLEND: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

const ADDITIVE_BLEND: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

const MAXIMUM_BLEND: GPUBlendState = {
  color: { operation: "max", srcFactor: "one", dstFactor: "one" },
  alpha: { operation: "max", srcFactor: "one", dstFactor: "one" },
};

const COMPARISON_SHADER = /* wgsl */ `
struct Counters {
  exactMismatch: atomic<u32>,
  overOne4096: atomic<u32>,
  overOne1024: atomic<u32>,
  overOne255: atomic<u32>,
  maximumError: atomic<u32>,
};

@group(0) @binding(0) var referenceTexture: texture_2d<f32>;
@group(0) @binding(1) var candidateTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> counters: Counters;

@compute @workgroup_size(8, 8)
fn compareMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let dimensions = textureDimensions(referenceTexture);
  if (id.x >= dimensions.x || id.y >= dimensions.y) { return; }
  let coordinate = vec2<i32>(id.xy);
  let reference = textureLoad(referenceTexture, coordinate, 0);
  let candidate = textureLoad(candidateTexture, coordinate, 0);
  let difference = abs(reference - candidate);
  let maximum = max(max(difference.r, difference.g), max(difference.b, difference.a));
  if (any(reference != candidate)) { atomicAdd(&counters.exactMismatch, 1u); }
  if (maximum > 1.0 / 4096.0) { atomicAdd(&counters.overOne4096, 1u); }
  if (maximum > 1.0 / 1024.0) { atomicAdd(&counters.overOne1024, 1u); }
  if (maximum > 1.0 / 255.0) { atomicAdd(&counters.overOne255, 1u); }
  // Positive IEEE-754 values preserve numeric ordering in their u32 bit
  // representation, so atomicMax retains the real maximum without clamping.
  atomicMax(&counters.maximumError, bitcast<u32>(maximum));
}
`;

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function timingSummary(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minimumMs: sorted[0] ?? 0,
    maximumMs: sorted.at(-1) ?? 0,
    samplesMs: [...samples],
  };
}

function median(values: readonly number[]): number {
  return percentile([...values].sort((left, right) => left - right), 0.5);
}

function requestedTargetSize(device: GPUDevice): number {
  const parameters = new URLSearchParams(location.search);
  const raw = parameters.get("preparedLabSize") ?? parameters.get("copyLabSize");
  const requested = raw === null ? Number.NaN : Number(raw);
  const size = Number.isInteger(requested)
    ? Math.max(MINIMUM_TARGET_SIZE, Math.min(DEFAULT_TARGET_SIZE, requested))
    : DEFAULT_TARGET_SIZE;
  return Math.min(size, device.limits.maxTextureDimension2D);
}

function requestedMeasuredRuns(): number {
  const parameters = new URLSearchParams(location.search);
  const raw = parameters.get("preparedRuns") ?? parameters.get("copyRuns");
  const requested = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(requested)
    ? Math.max(1, Math.min(MAXIMUM_MEASURED_RUNS, requested))
    : DEFAULT_MEASURED_RUNS;
}

function requestedColorJitterPerCopy(recordedValue: boolean): boolean {
  const parameters = new URLSearchParams(location.search);
  const requested = parameters.get("preparedColorJitter")
    ?? parameters.get("copyColorJitter");
  if (requested === "per-copy") return true;
  if (requested === "shared") return false;
  return recordedValue;
}

function flattenWorkloadStamps(workload: HumanDirtyRegionWorkload): Uint8Array {
  const packed = new Uint8Array(workload.baseStampCount * STAMP_STRIDE_BYTES);
  let byteOffset = 0;
  for (const frame of workload.frames) {
    packed.set(frame.packedStamps, byteOffset);
    byteOffset += frame.packedStamps.byteLength;
  }
  if (byteOffset !== packed.byteLength) {
    throw new Error("Human workload stamp bytes do not match the stamp count.");
  }
  return packed;
}

function prepareFrames(workload: HumanDirtyRegionWorkload): PreparedFrame[] {
  const frames: PreparedFrame[] = [];
  let baseStampOffset = 0;
  for (const frame of workload.frames) {
    const currentOffset = baseStampOffset;
    baseStampOffset += frame.stampCount;
    if (frame.stampCount === 0) continue;
    const dirtyRect = buildDirtyAabb(
      frame.footprints,
      workload.targetWidth,
      workload.targetHeight,
    )[0];
    if (!dirtyRect) throw new Error(`Human workload frame ${frame.index} has no dirty rectangle.`);
    frames.push({
      sourceIndex: frame.index,
      inputTimeMs: frame.inputTimeMs,
      baseStampOffset: currentOffset,
      stampCount: frame.stampCount,
      outputOffset: currentOffset * COPY_COUNT,
      dirtyRect,
    });
  }
  if (baseStampOffset !== workload.baseStampCount) {
    throw new Error("Human workload frame offsets do not cover every stamp.");
  }
  return frames;
}

function minimumPackedRadius(packed: Uint8Array): number {
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  let minimum = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < packed.byteLength; offset += STAMP_STRIDE_BYTES) {
    minimum = Math.min(minimum, view.getFloat32(offset + 8, true));
  }
  return minimum;
}

function selectedOccupancyMip(engine: BrushEngine, minimumRadius: number): number | null {
  if (!Number.isFinite(minimumRadius) || minimumRadius < SHAPE_OCCUPANCY_MIN_RADIUS) {
    return null;
  }
  const estimatedLod = Math.log2(SHAPE_MASK_SIZE / Math.max(1, minimumRadius * 2));
  const requiredMip = Math.max(0, Math.ceil(estimatedLod + 0.0001));
  if (requiredMip > SHAPE_OCCUPANCY_MAX_MIP) return null;
  return engine.shapeOccupancyCoverageRatios[requiredMip]
    <= SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO
    ? requiredMip
    : null;
}

function createBufferWithData(
  device: GPUDevice,
  label: string,
  data: AllowSharedBufferSource,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function createBrushUniformBuffer(
  device: GPUDevice,
  settings: BrushSettings,
  size: number,
  copyCount: number,
  mode: RenderModeDefinition,
): GPUBuffer {
  const upload = new ArrayBuffer(BRUSH_UNIFORM_BYTES);
  populateBrushUniformUpload(
    upload,
    {
      ...settings,
      count: copyCount,
      opacity: mode.id === "intense-blending" ? settings.opacity : 1,
      blendMode: "normal",
      shapeMaskFormat: "r16float",
    },
    size,
    size,
    0,
    0,
  );
  return createBufferWithData(
    device,
    `Prepared-instance brush uniforms · ${mode.label} · ${copyCount}`,
    upload,
    GPUBufferUsage.UNIFORM,
  );
}

async function assertShaderCompiled(module: GPUShaderModule, label: string): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length > 0) {
    throw new Error(`${label}: ${errors.map((message) => message.message).join(" | ")}`);
  }
}

function renderModes(engine: BrushEngine, occupancyMip: number | null): RenderModeDefinition[] {
  const occupancy = occupancyMip !== null;
  const opticalDepth = usesOpticalDepthPaintDabProfile(engine.paintDabProfile);
  return [
    {
      id: "light-glaze",
      label: "Light",
      targetFormat: "r16float",
      fragmentEntryPoint: occupancy
        ? opticalDepth
          ? "shapeOccupancyOpticalDepthFragmentMain"
          : "shapeOccupancyCoverageFragmentMain"
        : opticalDepth
          ? "shapeOpticalDepthFragmentMain"
          : "shapeCoverageFragmentMain",
      blend: opticalDepth ? ADDITIVE_BLEND : MAXIMUM_BLEND,
    },
    {
      id: "uniformed-glaze",
      label: "Uniformed",
      targetFormat: "rgba16float",
      fragmentEntryPoint: occupancy
        ? "shapeOccupancyFragmentMain"
        : "shapeFragmentMain",
      blend: SOURCE_OVER_BLEND,
    },
    {
      id: "intense-blending",
      label: "Intense",
      targetFormat: "rgba16float",
      fragmentEntryPoint: occupancy
        ? "encodedSrgbShapeOccupancyFragmentMain"
        : "encodedSrgbShapeFragmentMain",
      blend: SOURCE_OVER_BLEND,
    },
  ];
}

function baselinePipeline(
  engine: BrushEngine,
  mode: RenderModeDefinition,
  occupancyMip: number | null,
): GPURenderPipeline {
  if (mode.id === "light-glaze") {
    return occupancyMip === null
      ? engine.grainLightNoBuildUpShapePipeline
      : engine.grainLightNoBuildUpShapeOccupancyPipeline;
  }
  if (mode.id === "uniformed-glaze") {
    return occupancyMip === null
      ? engine.grainUniformedGlazeShapePipeline
      : engine.grainUniformedGlazeShapeOccupancyPipeline;
  }
  return occupancyMip === null
    ? engine.grainIntenseBlendingShapePipeline
    : engine.grainIntenseBlendingShapeOccupancyPipeline;
}

function deriveBacklog(
  frames: readonly PreparedFrame[],
  durations: readonly GpuFrameTiming[],
): BacklogSummary {
  let gpuAvailableAt = frames[0]?.inputTimeMs ?? 0;
  let maximumQueueBeforeMs = 0;
  let maximumCompletionLagMs = 0;
  let framesCompletingAfterNextInput = 0;
  const completionLags: number[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const inputTime = frames[index].inputTimeMs;
    const startsAt = Math.max(inputTime, gpuAvailableAt);
    const completesAt = startsAt + (durations[index]?.totalMs ?? 0);
    const queueBefore = Math.max(0, startsAt - inputTime);
    const completionLag = Math.max(0, completesAt - inputTime);
    maximumQueueBeforeMs = Math.max(maximumQueueBeforeMs, queueBefore);
    maximumCompletionLagMs = Math.max(maximumCompletionLagMs, completionLag);
    completionLags.push(completionLag);
    if (index + 1 < frames.length && completesAt > frames[index + 1].inputTimeMs) {
      framesCompletingAfterNextInput += 1;
    }
    gpuAvailableAt = completesAt;
  }
  const sortedLags = [...completionLags].sort((left, right) => left - right);
  return {
    maximumQueueBeforeMs,
    maximumCompletionLagMs,
    p95CompletionLagMs: percentile(sortedLags, 0.95),
    recoveryAfterLastInputMs: Math.max(
      0,
      gpuAvailableAt - (frames.at(-1)?.inputTimeMs ?? gpuAvailableAt),
    ),
    framesCompletingAfterNextInput,
  };
}

function summarizeTiming(
  samples: readonly TimingSample[],
  frames: readonly PreparedFrame[],
): TimingResult {
  const completeGpuSamples = samples.every((sample) => sample.gpuFrames !== null)
    ? samples.map((sample) => sample.gpuFrames!)
    : null;
  const medianGpuFrames = completeGpuSamples
    ? frames.map((_, frameIndex): GpuFrameTiming => ({
        totalMs: median(completeGpuSamples.map((sample) => sample[frameIndex].totalMs)),
        preparationMs: median(
          completeGpuSamples.map((sample) => sample[frameIndex].preparationMs),
        ),
        renderMs: median(completeGpuSamples.map((sample) => sample[frameIndex].renderMs)),
      }))
    : null;
  const totals = completeGpuSamples?.map((sample) =>
    sample.reduce((sum, frame) => sum + frame.totalMs, 0)
  ) ?? null;
  const preparation = completeGpuSamples?.map((sample) =>
    sample.reduce((sum, frame) => sum + frame.preparationMs, 0)
  ) ?? null;
  const render = completeGpuSamples?.map((sample) =>
    sample.reduce((sum, frame) => sum + frame.renderMs, 0)
  ) ?? null;
  return {
    cpuEncodeSubmit: timingSummary(samples.map((sample) => sample.cpuEncodeSubmitMs)),
    queueDrain: timingSummary(samples.map((sample) => sample.queueDrainMs)),
    wall: timingSummary(samples.map((sample) => sample.wallMs)),
    gpuTotal: totals ? timingSummary(totals) : null,
    gpuPreparation: preparation ? timingSummary(preparation) : null,
    gpuRender: render ? timingSummary(render) : null,
    medianGpuFrames,
    backlog: medianGpuFrames ? deriveBacklog(frames, medianGpuFrames) : null,
    raw: [...samples],
  };
}

async function createModeRenderer(
  engine: BrushEngine,
  workload: HumanDirtyRegionWorkload,
  frames: readonly PreparedFrame[],
  packedStamps: Uint8Array,
  occupancyMip: number | null,
  mode: RenderModeDefinition,
): Promise<ModeRenderer> {
  const { device } = engine;
  const size = workload.targetWidth;
  const proceduralPipeline = baselinePipeline(engine, mode, occupancyMip);
  const preparedModule = device.createShaderModule({
    label: "Prepared-copy instance shader",
    code: PREPARED_COPY_INSTANCE_SHADER,
  });
  const comparisonModule = device.createShaderModule({
    label: "Prepared-copy raster comparison shader",
    code: COMPARISON_SHADER,
  });
  await Promise.all([
    assertShaderCompiled(preparedModule, "Prepared-copy instance shader"),
    assertShaderCompiled(comparisonModule, "Prepared-copy raster comparison shader"),
  ]);

  const brushLayout = proceduralPipeline.getBindGroupLayout(0);
  const preparedPipeline = await device.createRenderPipelineAsync({
    label: `Prepared-copy ${mode.label} render pipeline`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [brushLayout] }),
    vertex: {
      module: preparedModule,
      entryPoint: "preparedShapeVertexMain",
      buffers: [{
        arrayStride: PREPARED_COPY_INSTANCE_STRIDE_BYTES,
        stepMode: "instance",
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" },
          { shaderLocation: 1, offset: 16, format: "float32x4" },
          { shaderLocation: 2, offset: 32, format: "uint32x4" },
        ],
      }],
    },
    fragment: {
      module: engine.texturizedGrainShaderModule,
      entryPoint: mode.fragmentEntryPoint,
      targets: [{ format: mode.targetFormat, blend: mode.blend }],
    },
    primitive: { topology: "triangle-strip" },
  });
  const preparePipeline = await device.createComputePipelineAsync({
    label: `Prepared-copy ${mode.label} compute pipeline`,
    layout: "auto",
    compute: { module: preparedModule, entryPoint: "prepareMain" },
  });

  const stampBuffer = createBufferWithData(
    device,
    "Prepared-copy base stamp records",
    packedStamps,
    GPUBufferUsage.STORAGE,
  );
  const preparedBuffer = device.createBuffer({
    label: "Prepared-copy physical instance records",
    size: workload.baseStampCount * COPY_COUNT * PREPARED_COPY_INSTANCE_STRIDE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });
  const brushUniformBuffers = new Map<number, GPUBuffer>();
  for (const copyCount of [1, COPY_COUNT]) {
    brushUniformBuffers.set(
      copyCount,
      createBrushUniformBuffer(device, workload.settings, size, copyCount, mode),
    );
  }
  const grainUpload = new Float32Array(GRAIN_UNIFORM_BYTES / 4);
  populateGrainUniformUpload(
    grainUpload,
    workload.settings,
    engine.grainTextureWidth,
    engine.grainTextureMipLevelCount,
    workload.coordinateScale,
  );
  const grainUniformBuffer = createBufferWithData(
    device,
    "Prepared-copy scaled grain uniforms",
    grainUpload,
    GPUBufferUsage.UNIFORM,
  );
  const occupancyBuffer = engine.shapeOccupancyUniformBuffers[occupancyMip ?? 0];
  if (!occupancyBuffer) throw new Error("Shape occupancy data is unavailable.");
  const grainSampler = engine.grainSamplers.fixed[workload.settings.grainFiltering];
  const brushBindGroups = new Map<number, GPUBindGroup>();
  for (const copyCount of [1, COPY_COUNT]) {
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: brushUniformBuffers.get(copyCount)! } },
      { binding: 1, resource: { buffer: stampBuffer } },
      { binding: 2, resource: engine.shapeMaskView },
      { binding: 3, resource: engine.shapeMaskSampler },
      { binding: 5, resource: engine.grainTextureView },
      { binding: 6, resource: grainSampler },
      { binding: 7, resource: { buffer: grainUniformBuffer } },
    ];
    if (occupancyMip !== null) {
      entries.push({ binding: 4, resource: { buffer: occupancyBuffer } });
    }
    brushBindGroups.set(copyCount, device.createBindGroup({
      label: `Prepared-copy brush bind group · ${copyCount}`,
      layout: brushLayout,
      entries,
    }));
  }

  const prepareLayout = preparePipeline.getBindGroupLayout(0);
  const prepareParameterBuffers: GPUBuffer[] = [];
  const prepareBindGroups = frames.map((frame) => {
    const parameters = new Uint32Array([
      frame.baseStampOffset,
      frame.stampCount,
      frame.outputOffset,
      0,
    ]);
    const buffer = createBufferWithData(
      device,
      `Prepared-copy frame ${frame.sourceIndex + 1} parameters`,
      parameters,
      GPUBufferUsage.UNIFORM,
    );
    prepareParameterBuffers.push(buffer);
    return device.createBindGroup({
      label: `Prepared-copy frame ${frame.sourceIndex + 1} compute bind group`,
      layout: prepareLayout,
      entries: [
        { binding: 0, resource: { buffer: brushUniformBuffers.get(COPY_COUNT)! } },
        { binding: 1, resource: { buffer: stampBuffer } },
        { binding: 2, resource: { buffer: preparedBuffer } },
        { binding: 3, resource: { buffer } },
      ],
    });
  });

  const targetTexture = device.createTexture({
    label: `Prepared-copy ${mode.label} target`,
    size: [size, size],
    format: mode.targetFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC,
  });
  const targetView = targetTexture.createView();
  const referenceTexture = device.createTexture({
    label: `Prepared-copy ${mode.label} reference`,
    size: [size, size],
    format: mode.targetFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const referenceView = referenceTexture.createView();
  const comparisonLayout = device.createBindGroupLayout({
    label: "Prepared-copy comparison bind group layout",
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const comparisonPipeline = await device.createComputePipelineAsync({
    label: "Prepared-copy comparison pipeline",
    layout: device.createPipelineLayout({ bindGroupLayouts: [comparisonLayout] }),
    compute: { module: comparisonModule, entryPoint: "compareMain" },
  });
  const comparisonBuffer = device.createBuffer({
    label: "Prepared-copy comparison counters",
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const comparisonReadback = device.createBuffer({
    label: "Prepared-copy comparison readback",
    size: 32,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const comparisonBindGroup = device.createBindGroup({
    label: "Prepared-copy comparison bind group",
    layout: comparisonLayout,
    entries: [
      { binding: 0, resource: referenceView },
      { binding: 1, resource: targetView },
      { binding: 2, resource: { buffer: comparisonBuffer } },
    ],
  });
  const fenceSource = createBufferWithData(
    device,
    "Prepared-copy temporal fence source",
    new Uint32Array([0x9e3779b9]),
    GPUBufferUsage.COPY_SRC,
  );
  const fenceReadback = device.createBuffer({
    label: "Prepared-copy temporal fence readback",
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const encodePreparation = (
    encoder: GPUCommandEncoder,
    frameIndex: number,
    timestampQuerySet: GPUQuerySet | null,
    firstQueryIndex: number,
  ): void => {
    const frame = frames[frameIndex];
    const pass = encoder.beginComputePass({
      label: `Prepared-copy frame ${frame.sourceIndex + 1} preparation`,
      ...(timestampQuerySet ? {
        timestampWrites: {
          querySet: timestampQuerySet,
          beginningOfPassWriteIndex: firstQueryIndex,
          endOfPassWriteIndex: firstQueryIndex + 1,
        },
      } : {}),
    });
    pass.setPipeline(preparePipeline);
    pass.setBindGroup(0, prepareBindGroups[frameIndex]);
    pass.dispatchWorkgroups(
      Math.ceil(frame.stampCount * COPY_COUNT / PREPARED_COPY_WORKGROUP_SIZE),
    );
    pass.end();
  };

  const encodeRender = (
    encoder: GPUCommandEncoder,
    strategy: StrategyDefinition,
    frameIndex: number,
    timestampQuerySet: GPUQuerySet | null,
    firstQueryIndex: number,
  ): void => {
    const frame = frames[frameIndex];
    const pass = encoder.beginRenderPass({
      label: `Prepared-copy ${strategy.id} frame ${frame.sourceIndex + 1}`,
      colorAttachments: [{
        view: targetView,
        loadOp: frameIndex === 0 ? "clear" : "load",
        storeOp: "store",
        ...(frameIndex === 0
          ? { clearValue: { r: 0, g: 0, b: 0, a: 0 } }
          : {}),
      }],
      ...(timestampQuerySet ? {
        timestampWrites: {
          querySet: timestampQuerySet,
          beginningOfPassWriteIndex: firstQueryIndex,
          endOfPassWriteIndex: firstQueryIndex + 1,
        },
      } : {}),
    });
    pass.setPipeline(strategy.prepared ? preparedPipeline : proceduralPipeline);
    pass.setBindGroup(0, brushBindGroups.get(strategy.copyCount)!);
    if (strategy.prepared) pass.setVertexBuffer(0, preparedBuffer);
    pass.setScissorRect(
      frame.dirtyRect.x,
      frame.dirtyRect.y,
      frame.dirtyRect.width,
      frame.dirtyRect.height,
    );
    pass.draw(
      4,
      frame.stampCount * strategy.copyCount,
      0,
      strategy.prepared
        ? frame.outputOffset
        : frame.baseStampOffset * strategy.copyCount,
    );
    pass.end();
  };

  return {
    async initializePreparedResident() {
      const encoder = device.createCommandEncoder({
        label: `Prepared-copy ${mode.label} resident initialization`,
      });
      for (let index = 0; index < frames.length; index += 1) {
        encodePreparation(encoder, index, null, 0);
      }
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    },

    async run(strategy) {
      await device.queue.onSubmittedWorkDone();
      // Keep the end-to-end temporal measurement free of timestamp-query
      // overhead. The instrumented per-frame replay below is diagnostic and
      // deliberately excluded from CPU, drain and wall timing.
      const startedAt = performance.now();
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const encoder = device.createCommandEncoder({
          label: `Prepared-copy ${strategy.id} temporal frame ${frameIndex + 1}`,
        });
        if (strategy.includePreparation) {
          encodePreparation(encoder, frameIndex, null, 0);
        }
        encodeRender(encoder, strategy, frameIndex, null, 0);
        device.queue.submit([encoder.finish()]);
      }
      const fenceEncoder = device.createCommandEncoder({
        label: `Prepared-copy ${strategy.id} temporal fence`,
      });
      fenceEncoder.copyBufferToBuffer(fenceSource, 0, fenceReadback, 0, 4);
      device.queue.submit([fenceEncoder.finish()]);
      const submittedAt = performance.now();
      await fenceReadback.mapAsync(GPUMapMode.READ);
      const completedAt = performance.now();
      fenceReadback.unmap();

      let gpuFrames: GpuFrameTiming[] | null = null;
      if (device.features.has("timestamp-query")) {
        const queriesPerFrame = strategy.includePreparation ? 4 : 2;
        const queryCount = frames.length * queriesPerFrame;
        const timestampBytes = queryCount * BigUint64Array.BYTES_PER_ELEMENT;
        const timestampQuerySet = device.createQuerySet({
          label: `Prepared-copy ${strategy.id} frame timestamps`,
          type: "timestamp",
          count: queryCount,
        });
        const timestampResolve = device.createBuffer({
          label: `Prepared-copy ${strategy.id} timestamp resolve`,
          size: timestampBytes,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        const timestampReadback = device.createBuffer({
          label: `Prepared-copy ${strategy.id} timestamp readback`,
          size: timestampBytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const timingEncoder = device.createCommandEncoder({
          label: `Prepared-copy ${strategy.id} instrumented replay`,
        });
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
          if (strategy.includePreparation) {
            encodePreparation(
              timingEncoder,
              frameIndex,
              timestampQuerySet,
              frameIndex * queriesPerFrame,
            );
          }
          encodeRender(
            timingEncoder,
            strategy,
            frameIndex,
            timestampQuerySet,
            frameIndex * queriesPerFrame + (strategy.includePreparation ? 2 : 0),
          );
        }
        timingEncoder.resolveQuerySet(
          timestampQuerySet,
          0,
          queryCount,
          timestampResolve,
          0,
        );
        timingEncoder.copyBufferToBuffer(
          timestampResolve,
          0,
          timestampReadback,
          0,
          timestampBytes,
        );
        device.queue.submit([timingEncoder.finish()]);
        await timestampReadback.mapAsync(GPUMapMode.READ);
        const values = new BigUint64Array(timestampReadback.getMappedRange().slice(0));
        timestampReadback.unmap();
        const parsed: GpuFrameTiming[] = [];
        let valid = true;
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
          const offset = frameIndex * queriesPerFrame;
          const preparationStart = strategy.includePreparation ? values[offset] : 0n;
          const preparationEnd = strategy.includePreparation ? values[offset + 1] : 0n;
          const renderStart = values[offset + (strategy.includePreparation ? 2 : 0)];
          const renderEnd = values[offset + (strategy.includePreparation ? 3 : 1)];
          if (
            renderEnd < renderStart
            || (strategy.includePreparation && preparationEnd < preparationStart)
            || (strategy.includePreparation && renderEnd < preparationStart)
          ) {
            valid = false;
            break;
          }
          const preparationMs = strategy.includePreparation
            ? Number(preparationEnd - preparationStart) / 1_000_000
            : 0;
          const renderMs = Number(renderEnd - renderStart) / 1_000_000;
          const totalMs = strategy.includePreparation
            ? Number(renderEnd - preparationStart) / 1_000_000
            : renderMs;
          parsed.push({ totalMs, preparationMs, renderMs });
        }
        if (valid && parsed.some((frame) => frame.totalMs > 0)) gpuFrames = parsed;
        timestampReadback.destroy();
        timestampResolve.destroy();
        timestampQuerySet.destroy();
      }
      return {
        cpuEncodeSubmitMs: submittedAt - startedAt,
        queueDrainMs: completedAt - submittedAt,
        wallMs: completedAt - startedAt,
        gpuFrames,
      };
    },

    async renderFull(strategy) {
      await device.queue.onSubmittedWorkDone();
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const encoder = device.createCommandEncoder({
          label: `Prepared-copy ${strategy.id} correctness frame ${frameIndex + 1}`,
        });
        if (strategy.includePreparation) encodePreparation(encoder, frameIndex, null, 0);
        encodeRender(encoder, strategy, frameIndex, null, 0);
        device.queue.submit([encoder.finish()]);
      }
      await device.queue.onSubmittedWorkDone();
    },

    async captureReference() {
      const encoder = device.createCommandEncoder({ label: "Prepared-copy capture reference" });
      encoder.copyTextureToTexture(
        { texture: targetTexture },
        { texture: referenceTexture },
        [size, size],
      );
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    },

    async compareWithReference() {
      device.queue.writeBuffer(comparisonBuffer, 0, new Uint32Array(8));
      const encoder = device.createCommandEncoder({ label: "Prepared-copy compare full raster" });
      const pass = encoder.beginComputePass();
      pass.setPipeline(comparisonPipeline);
      pass.setBindGroup(0, comparisonBindGroup);
      pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
      pass.end();
      encoder.copyBufferToBuffer(comparisonBuffer, 0, comparisonReadback, 0, 32);
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      await comparisonReadback.mapAsync(GPUMapMode.READ);
      const bytes = comparisonReadback.getMappedRange().slice(0);
      const raw = new Uint32Array(bytes);
      const rawFloats = new Float32Array(bytes);
      comparisonReadback.unmap();
      const maximumAbsoluteError = rawFloats[4];
      return {
        exactMismatchPixels: raw[0],
        pixelsOverOne4096: raw[1],
        pixelsOverOne1024: raw[2],
        pixelsOverOne255: raw[3],
        maximumAbsoluteError,
        totalPixels: size * size,
        exact: raw[0] === 0,
        withinThreshold: raw[3] === 0 && maximumAbsoluteError <= 1 / 255,
      };
    },

    destroy() {
      fenceReadback.destroy();
      fenceSource.destroy();
      comparisonReadback.destroy();
      comparisonBuffer.destroy();
      referenceTexture.destroy();
      targetTexture.destroy();
      for (const buffer of prepareParameterBuffers) buffer.destroy();
      grainUniformBuffer.destroy();
      for (const buffer of brushUniformBuffers.values()) buffer.destroy();
      preparedBuffer.destroy();
      stampBuffer.destroy();
    },
  };
}

function percentSaved(baseline: number, candidate: number): number | null {
  return baseline > 0 ? (baseline - candidate) / baseline * 100 : null;
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value < 1 ? 3 : 2)} ms`;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("it-IT");
}

function appendCell(row: HTMLTableRowElement, value: string, heading = false): void {
  const cell = document.createElement(heading ? "th" : "td");
  cell.textContent = value;
  row.append(cell);
}

function strategyById(strategies: readonly MeasuredStrategy[], id: StrategyId): MeasuredStrategy {
  const strategy = strategies.find((candidate) => candidate.id === id);
  if (!strategy?.timing) throw new Error(`Missing prepared-instance timing for ${id}.`);
  return strategy;
}

function renderPresentation(
  workload: HumanDirtyRegionWorkload,
  modes: readonly { mode: RenderModeDefinition; strategies: readonly MeasuredStrategy[] }[],
  occupancyMip: number | null,
): void {
  const previous = document.querySelector("[data-prepared-instance-lab-presentation]");
  if (previous instanceof HTMLDialogElement && previous.open) previous.close();
  previous?.remove();
  const residentWins = modes.filter(({ strategies }) => {
    const baseline = strategyById(strategies, "sixteen-procedural");
    const resident = strategyById(strategies, "sixteen-prepared-resident");
    return resident.timing!.wall.medianMs < baseline.timing!.wall.medianMs;
  }).length;
  const completeWins = modes.filter(({ strategies }) => {
    const baseline = strategyById(strategies, "sixteen-procedural");
    const complete = strategyById(strategies, "sixteen-prepared-compute");
    return complete.timing!.wall.medianMs < baseline.timing!.wall.medianMs;
  }).length;
  const comparisons = modes.flatMap(({ strategies }) => strategies
    .map((strategy) => strategy.comparison)
    .filter((comparison): comparison is RasterComparison => comparison !== undefined));
  const allWithinThreshold = comparisons.every((comparison) => comparison.withinThreshold);

  const panel = document.createElement("dialog");
  panel.className = "prepared-instance-lab-presentation";
  panel.dataset.preparedInstanceLabPresentation = "";
  panel.innerHTML = `
    <header>
      <div>
        <p class="prepared-instance-lab-kicker">ISTANZE PREPARATE · TRATTO UMANO</p>
        <h2>Procedurale contro preparazione una volta per copia</h2>
      </div>
      <button type="button" data-close>Chiudi</button>
    </header>
    <p class="prepared-instance-lab-intro">Il confronto conserva Shape, Grain, quad stretti, ordine delle copie, scissor e ${formatInteger(workload.frames.length)} invii del gesto. Cambia soltanto dove vengono calcolati rotazione, jitter e colore.</p>
    <p class="prepared-instance-lab-scope">“Preparato residente” misura il solo potenziale del vertex semplificato. “Compute + render” include la preparazione di ogni frame ed è il confronto completo. Il backlog è ricostruito dai timestamp GPU e dalla cadenza input registrata; non include mip, compositing e presentazione.</p>
    <section class="prepared-instance-lab-cards">
      <article><span>Residente più veloce</span><strong>${residentWins}/${modes.length} renderer</strong></article>
      <article><span>Compute completo più veloce</span><strong>${completeWins}/${modes.length} renderer</strong></article>
      <article><span>Jitter colore</span><strong>${workload.settings.jitterPerCopy ? "per copia" : "condiviso"}</strong></article>
      <article><span>Raster completo</span><strong>${allWithinThreshold ? "entro soglia" : "differente"}</strong></article>
    </section>
    <h3>Tempi del gesto</h3>
    <div class="prepared-instance-lab-table-scroll"><table data-timings><thead><tr></tr></thead><tbody></tbody></table></div>
    <h3>Confronto raster completo</h3>
    <div class="prepared-instance-lab-table-scroll"><table data-correctness><thead><tr></tr></thead><tbody></tbody></table></div>
    <p class="prepared-instance-lab-detail">${formatInteger(workload.baseStampCount)} stamp base · ${formatInteger(workload.baseStampCount * COPY_COUNT)} copie Count 16 · target ${workload.targetWidth}² · occupancy ${occupancyMip === null ? "non usata" : `mip ${occupancyMip}`}.</p>
  `;
  const close = panel.querySelector("[data-close]") as HTMLButtonElement;
  close.addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => panel.remove(), { once: true });

  const timingTable = panel.querySelector("[data-timings]") as HTMLTableElement;
  const timingHeader = timingTable.querySelector("thead tr") as HTMLTableRowElement;
  for (const value of [
    "Renderer",
    "Strategia",
    "GPU totale",
    "GPU prepare",
    "CPU encode+submit",
    "Encode→fine coda",
    "Lag GPU max",
  ]) appendCell(timingHeader, value, true);
  const timingBody = timingTable.querySelector("tbody") as HTMLTableSectionElement;
  for (const { mode, strategies } of modes) {
    for (const strategy of strategies) {
      const row = document.createElement("tr");
      const values = [
        mode.label,
        strategy.label,
        formatMs(strategy.timing!.gpuTotal?.medianMs ?? null),
        strategy.includePreparation
          ? formatMs(strategy.timing!.gpuPreparation?.medianMs ?? null)
          : "fuori misura",
        formatMs(strategy.timing!.cpuEncodeSubmit.medianMs),
        formatMs(strategy.timing!.wall.medianMs),
        formatMs(strategy.timing!.backlog?.maximumCompletionLagMs ?? null),
      ];
      values.forEach((value, index) => appendCell(row, value, index <= 1));
      timingBody.append(row);
    }
  }

  const correctnessTable = panel.querySelector("[data-correctness]") as HTMLTableElement;
  const correctnessHeader = correctnessTable.querySelector("thead tr") as HTMLTableRowElement;
  for (const value of [
    "Renderer",
    "Candidato",
    "Pixel diversi",
    "> 1/4096",
    "> 1/1024",
    "> 1/255",
    "Errore max",
  ]) appendCell(correctnessHeader, value, true);
  const correctnessBody = correctnessTable.querySelector("tbody") as HTMLTableSectionElement;
  for (const { mode, strategies } of modes) {
    for (const strategy of strategies.filter((candidate) => candidate.comparison)) {
      const comparison = strategy.comparison!;
      const row = document.createElement("tr");
      [
        mode.label,
        strategy.label,
        formatInteger(comparison.exactMismatchPixels),
        formatInteger(comparison.pixelsOverOne4096),
        formatInteger(comparison.pixelsOverOne1024),
        formatInteger(comparison.pixelsOverOne255),
        comparison.maximumAbsoluteError.toFixed(6),
      ].forEach((value, index) => appendCell(row, value, index <= 1));
      correctnessBody.append(row);
    }
  }
  document.body.append(panel);
  panel.showModal();
  close.focus({ preventScroll: true });
}

async function measureStrategies(
  renderer: ModeRenderer,
  strategies: MeasuredStrategy[],
  frames: readonly PreparedFrame[],
  measuredRuns: number,
  onProgress: PreparedCopyInstanceLabOptions["onProgress"],
  mode: RenderModeDefinition,
  progressOffset: number,
  progressTotal: number,
): Promise<void> {
  let completed = 0;
  for (const strategy of strategies) {
    await renderer.run(strategy);
    completed += 1;
    onProgress?.({
      completed: progressOffset + completed,
      total: progressTotal,
      message: `${mode.label} · warmup · ${strategy.label}`,
    });
  }
  const samples = new Map<StrategyId, TimingSample[]>();
  for (const strategy of strategies) samples.set(strategy.id, []);
  for (let measured = 0; measured < measuredRuns; measured += 1) {
    const order = measured % 2 === 0 ? strategies : [...strategies].reverse();
    for (const strategy of order) {
      samples.get(strategy.id)!.push(await renderer.run(strategy));
      completed += 1;
      onProgress?.({
        completed: progressOffset + completed,
        total: progressTotal,
        message: `${mode.label} · ${strategy.label} · ${measured + 1}/${measuredRuns}`,
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  for (const strategy of strategies) {
    strategy.timing = summarizeTiming(samples.get(strategy.id)!, frames);
  }
}

export async function runPreparedCopyInstanceLab(
  engine: BrushEngine,
  options: PreparedCopyInstanceLabOptions = {},
): Promise<unknown> {
  const size = requestedTargetSize(engine.device);
  if (size < MINIMUM_TARGET_SIZE) {
    throw new Error("The GPU texture limit is too small for the prepared-instance lab.");
  }
  const measuredRuns = requestedMeasuredRuns();
  const recorded = await loadHumanDirtyRegionWorkload(size, size);
  const workload: HumanDirtyRegionWorkload = {
    ...recorded,
    settings: {
      ...recorded.settings,
      count: COPY_COUNT,
      jitterPerCopy: requestedColorJitterPerCopy(recorded.settings.jitterPerCopy),
    },
  };
  if (workload.settings.shape !== "shape" || workload.settings.grainMode !== "texturized") {
    throw new Error("The prepared-instance workload requires Shape and document-fixed Grain.");
  }
  const previousSettings = engine.getSettings();
  const applySettings = options.applySettings ?? ((settings: BrushSettings) => {
    engine.setBrushSettings(settings);
  });
  let activeRenderer: ModeRenderer | null = null;
  let executionError: unknown = null;
  let result: unknown = null;
  engine.device.pushErrorScope("validation");
  try {
    applySettings(workload.settings);
    await engine.ensureCurrentBrushResources();
    // Occupancy data and profile-dependent entry points must be selected only
    // after the captured Shape and Grain resources are authoritative.
    const packedStamps = flattenWorkloadStamps(workload);
    const frames = prepareFrames(workload);
    const occupancyMip = selectedOccupancyMip(engine, minimumPackedRadius(packedStamps));
    const modes = renderModes(engine, occupancyMip);
    const progressPerMode = STRATEGIES.length * (WARMUP_RUNS + measuredRuns);
    const progressTotal = progressPerMode * modes.length;
    const measuredModes: Array<{
      mode: RenderModeDefinition;
      strategies: MeasuredStrategy[];
    }> = [];
    for (let modeIndex = 0; modeIndex < modes.length; modeIndex += 1) {
      const mode = modes[modeIndex];
      activeRenderer = await createModeRenderer(
        engine,
        workload,
        frames,
        packedStamps,
        occupancyMip,
        mode,
      );
      await activeRenderer.initializePreparedResident();
      const strategies: MeasuredStrategy[] = STRATEGIES.map((strategy) => ({ ...strategy }));
      await measureStrategies(
        activeRenderer,
        strategies,
        frames,
        measuredRuns,
        options.onProgress,
        mode,
        modeIndex * progressPerMode,
        progressTotal,
      );
      const baseline = strategies.find((strategy) => strategy.id === "sixteen-procedural")!;
      await activeRenderer.renderFull(baseline);
      await activeRenderer.captureReference();
      for (const id of [
        "sixteen-prepared-resident",
        "sixteen-prepared-compute",
      ] as const) {
        const candidate = strategies.find((strategy) => strategy.id === id)!;
        await activeRenderer.renderFull(candidate);
        candidate.comparison = await activeRenderer.compareWithReference();
      }
      measuredModes.push({ mode, strategies });
      activeRenderer.destroy();
      activeRenderer = null;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }

    let presentationError: string | null = null;
    try {
      renderPresentation(workload, measuredModes, occupancyMip);
    } catch (error) {
      presentationError = error instanceof Error ? error.message : String(error);
    }
    const modeResults = measuredModes.map(({ mode, strategies }) => {
      const baseline = strategyById(strategies, "sixteen-procedural");
      const resident = strategyById(strategies, "sixteen-prepared-resident");
      const complete = strategyById(strategies, "sixteen-prepared-compute");
      return {
        mode: mode.id,
        label: mode.label,
        targetFormat: mode.targetFormat,
        strategies: strategies.map((strategy) => ({
          id: strategy.id,
          label: strategy.label,
          copyCount: strategy.copyCount,
          prepared: strategy.prepared,
          preparationIncluded: strategy.includePreparation,
          physicalInstances: workload.baseStampCount * strategy.copyCount,
          timing: strategy.timing,
          comparison: strategy.comparison ?? null,
        })),
        residentSavedPercent: percentSaved(
          baseline.timing!.wall.medianMs,
          resident.timing!.wall.medianMs,
        ),
        completeSavedPercent: percentSaved(
          baseline.timing!.wall.medianMs,
          complete.timing!.wall.medianMs,
        ),
      };
    });
    const comparisons = measuredModes.flatMap(({ strategies }) => strategies
      .map((strategy) => strategy.comparison)
      .filter((comparison): comparison is RasterComparison => comparison !== undefined));
    result = {
      lab: "prepared-copy-instance-ab",
      version: REPORT_VERSION,
      passed: comparisons.length === modes.length * 2
        && comparisons.every((comparison) => comparison.withinThreshold),
      productionClaim: false,
      target: {
        width: size,
        height: size,
        occupancyMip,
        preparedRecordBytes: PREPARED_COPY_INSTANCE_STRIDE_BYTES,
        colorJitterPerCopy: workload.settings.jitterPerCopy,
        symmetry: "off",
      },
      trace: {
        source: workload.source,
        fingerprint: workload.fingerprint,
        pointCount: workload.capturePointCount,
        durationMs: workload.captureDurationMs,
        frameCount: frames.length,
        baseStamps: workload.baseStampCount,
        count16PhysicalInstances: workload.baseStampCount * COPY_COUNT,
        largestFrameStamps: workload.largestFrameStampCount,
        recordedReferenceMatches: workload.recordedReferenceMatches,
      },
      methodology: {
        baseline: "The procedural paths use the current production pipelines and the 32-byte base-stamp records.",
        residentCandidate: "Prepared physical-copy records are generated before timing; this isolates the render-side benefit and is not an end-to-end claim.",
        completeCandidate: "Every temporal frame runs its preparation compute pass immediately before the matching render pass; preparation, the compute-to-vertex dependency and rendering are included.",
        invariantWork: "All paths preserve the same narrow quads, physical-copy order, Shape, Grain, occupancy selection, dirty scissor, target format, blend rule and 187 temporal submissions.",
        perFrameGpuTimestamps: "When timestamp-query is available, every frame has render boundaries; the complete candidate also records preparation boundaries. No per-frame mapping or queue wait is inserted.",
        recordedInputCadenceBacklog: "Median per-frame GPU service times are replayed against the recorded inputTimeMs sequence. This estimates isolated deposit queue backlog, not pointer-to-display latency.",
        fullTargetComparison: "Each prepared candidate is compared over the complete float target with exact mismatch count and thresholds at 1/4096, 1/1024 and 1/255.",
        excluded: "Symmetry, display-mip generation, document composition, final commit and swap-chain presentation remain outside this isolated lab.",
        timestampQueryAvailable: engine.device.features.has("timestamp-query"),
        warmupRunsPerStrategy: WARMUP_RUNS,
        measuredRunsPerStrategy: measuredRuns,
      },
      summary: {
        primaryTimingMetric: "temporal-wall-with-final-mapped-readback",
        allRasterComparisonsWithinThreshold: comparisons.every(
          (comparison) => comparison.withinThreshold,
        ),
        allRasterComparisonsExact: comparisons.every((comparison) => comparison.exact),
        presentationError,
      },
      renderModes: modeResults,
    };
  } catch (error) {
    executionError = error;
  } finally {
    activeRenderer?.destroy();
    try {
      applySettings(previousSettings);
      await engine.ensureCurrentBrushResources();
    } catch (restoreError) {
      if (!executionError) executionError = restoreError;
    }
  }
  const validationError = await engine.device.popErrorScope();
  if (executionError) throw executionError;
  if (validationError) throw new Error(`WebGPU validation: ${validationError.message}`);
  return result;
}
