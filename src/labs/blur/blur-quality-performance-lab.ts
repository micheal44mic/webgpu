import type { BrushEngine } from "../../brush-engine";
import { rgba16FloatRowsToRgba8Unorm } from "../../float16";
import {
  DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS,
  destructiveGaussianBlurKernel,
  destructiveTentBlurPlan,
} from "../../gaussian-blur-core";
import {
  BLUR_QUALITY_PERFORMANCE_LAB_ID,
  BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION,
  BLUR_QUALITY_PERFORMANCE_REPORT_VERSION,
  BLUR_QUALITY_PERFORMANCE_STRATEGY,
  blurCaseSpeedup,
  blurQualityGuardrail,
  blurQualityPerformanceConfigFromSearch,
  blurFixtureHash,
  computeBlurQualityMetrics,
  createBlurQualityPerformanceFixture,
  createBlurQualityPerformanceChecks,
  serializeBlurQualityPerformanceReport,
  summarizeBlurTimings,
  type BlurQualityPerformanceCaseReport,
  type BlurQualityPerformanceConfig,
} from "./blur-quality-performance-model";

export {
  BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION,
  blurFixtureHash,
  createBlurQualityPerformanceFixture,
  serializeBlurQualityPerformanceReport,
} from "./blur-quality-performance-model";

const SOURCE_TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";
const WORKING_TEXTURE_FORMAT: GPUTextureFormat = "rgba16float";
const WORKGROUP_SIZE = 8;
const QUEUE_FENCE_TIMEOUT_MS = 30_000;

const GAUSSIAN_SHADER = /* wgsl */ `
struct BlurParams {
  size: vec2<u32>,
  radius: u32,
  decodeInput: u32,
  direction: vec2<i32>,
  encodeOutput: u32,
  _padding: u32,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var targetTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<uniform> params: BlurParams;

fn clampedCoordinate(position: vec2<i32>) -> vec2<i32> {
  let maximum = vec2<i32>(params.size) - vec2<i32>(1);
  return clamp(position, vec2<i32>(0), maximum);
}

fn encodedToLinearChannel(value: f32) -> f32 {
  return select(
    value / 12.92,
    pow((value + 0.055) / 1.055, 2.4),
    value > 0.04045,
  );
}

fn linearToEncodedChannel(value: f32) -> f32 {
  let bounded = max(value, 0.0);
  return select(
    bounded * 12.92,
    1.055 * pow(bounded, 1.0 / 2.4) - 0.055,
    bounded > 0.0031308,
  );
}

fn decodePremultiplied(value: vec4<f32>) -> vec4<f32> {
  if (value.a <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / value.a, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(
    vec3<f32>(
      encodedToLinearChannel(straight.r),
      encodedToLinearChannel(straight.g),
      encodedToLinearChannel(straight.b),
    ) * value.a,
    value.a,
  );
}

fn encodePremultiplied(value: vec4<f32>) -> vec4<f32> {
  if (value.a <= 0.000001) { return vec4<f32>(0.0); }
  let straight = max(value.rgb / value.a, vec3<f32>(0.0));
  return vec4<f32>(
    vec3<f32>(
      linearToEncodedChannel(straight.r),
      linearToEncodedChannel(straight.g),
      linearToEncodedChannel(straight.b),
    ) * value.a,
    value.a,
  );
}

fn loadWorking(position: vec2<i32>) -> vec4<f32> {
  let stored = textureLoad(sourceTexture, clampedCoordinate(position), 0);
  if (params.decodeInput != 0u) { return decodePremultiplied(stored); }
  return stored;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global: vec3<u32>) {
  if (any(global.xy >= params.size)) {
    return;
  }
  let center = vec2<i32>(global.xy);
  var result = loadWorking(center) * weights[0];
  for (var offset = 1u; offset <= params.radius; offset += 1u) {
    let delta = params.direction * i32(offset);
    result += loadWorking(center - delta) * weights[offset];
    result += loadWorking(center + delta) * weights[offset];
  }
  if (params.encodeOutput != 0u) {
    textureStore(targetTexture, center, encodePremultiplied(result));
    return;
  }
  textureStore(targetTexture, center, result);
}
`;

const TENT_SHADER = /* wgsl */ `
struct TentParams {
  size: vec2<u32>,
  count: f32,
  _padding0: u32,
  direction: vec2<f32>,
  _padding1: vec2<u32>,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var targetTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: TentParams;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global: vec3<u32>) {
  if (any(global.xy >= params.size)) {
    return;
  }
  let size = vec2<f32>(params.size);
  let uv = (vec2<f32>(global.xy) + vec2<f32>(0.5)) / size;
  let count = max(params.count, 0.0001);
  var result = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0) * count;
  var normalization = count;

  for (var first = 1.0; first < ${DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS}.0; first += 2.0) {
    if (first >= count) {
      break;
    }
    let second = min(first + 1.0, count);
    let firstWeight = count - first;
    let secondWeight = count - second;
    let combinedWeight = firstWeight + secondWeight;
    if (combinedWeight > 0.0) {
      let combinedOffset =
        (first * firstWeight + second * secondWeight) / combinedWeight;
      let delta = params.direction * combinedOffset / size;
      result += combinedWeight * (
        textureSampleLevel(sourceTexture, sourceSampler, uv - delta, 0.0)
        + textureSampleLevel(sourceTexture, sourceSampler, uv + delta, 0.0)
      );
      normalization += 2.0 * combinedWeight;
    }
  }
  textureStore(targetTexture, vec2<i32>(global.xy), result / normalization);
}
`;

const PREFILTER_SHADER = /* wgsl */ `
struct PrefilterParams {
  targetSize: vec2<u32>,
  sourceSize: vec2<u32>,
  filterWidth: f32,
  sampleAxis: u32,
  _padding: vec2<u32>,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var targetTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: PrefilterParams;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global: vec3<u32>) {
  if (any(global.xy >= params.targetSize)) {
    return;
  }
  let center = (vec2<f32>(global.xy) + vec2<f32>(0.5))
    / vec2<f32>(params.targetSize);
  let sourceSize = vec2<f32>(params.sourceSize);
  var result = vec4<f32>(0.0);
  var sampleCount = 0u;
  for (var y = 0u; y < 4u; y += 1u) {
    if (y >= params.sampleAxis) { break; }
    let offsetY = ((f32(y) + 0.5) / f32(params.sampleAxis) - 0.5)
      * params.filterWidth;
    for (var x = 0u; x < 4u; x += 1u) {
      if (x >= params.sampleAxis) { break; }
      let offsetX = ((f32(x) + 0.5) / f32(params.sampleAxis) - 0.5)
        * params.filterWidth;
      result += textureSampleLevel(
        sourceTexture,
        sourceSampler,
        center + vec2<f32>(offsetX, offsetY) / sourceSize,
        0.0,
      );
      sampleCount += 1u;
    }
  }
  textureStore(
    targetTexture,
    vec2<i32>(global.xy),
    result / max(1.0, f32(sampleCount)),
  );
}
`;

const RESIZE_SHADER = /* wgsl */ `
struct ResizeParams {
  targetSize: vec2<u32>,
  _padding: vec2<u32>,
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var targetTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: ResizeParams;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global: vec3<u32>) {
  if (any(global.xy >= params.targetSize)) {
    return;
  }
  let uv = (vec2<f32>(global.xy) + vec2<f32>(0.5))
    / vec2<f32>(params.targetSize);
  textureStore(
    targetTexture,
    vec2<i32>(global.xy),
    textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0),
  );
}
`;

export interface BlurQualityPerformanceProgress {
  readonly completed: number;
  readonly total: number;
  readonly radius: number | null;
  readonly stage: "preparing" | "warmup" | "measuring" | "reading" | "complete";
  readonly message: string;
}

export interface BlurQualityPerformanceReport {
  readonly version: typeof BLUR_QUALITY_PERFORMANCE_REPORT_VERSION;
  readonly lab: typeof BLUR_QUALITY_PERFORMANCE_LAB_ID;
  readonly strategy: typeof BLUR_QUALITY_PERFORMANCE_STRATEGY;
  readonly scope: "isolated-algorithm-benchmark";
  readonly passed: boolean;
  readonly config: BlurQualityPerformanceConfig;
  readonly fixture: {
    readonly revision: typeof BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION;
    readonly width: number;
    readonly height: number;
    readonly hash: string;
  };
  readonly environment: {
    readonly userAgent: string;
    readonly language: string;
    readonly hardwareConcurrency: number | null;
    readonly deviceMemoryGiB: number | null;
    readonly viewport: {
      readonly width: number;
      readonly height: number;
      readonly devicePixelRatio: number;
    };
    readonly gpu: ReturnType<BrushEngine["getWebGpuDiagnosticInfo"]> & {
      readonly label: string;
    };
    readonly timingMethod: "queue-fence";
    readonly timingScope:
      "command-submit-to-queue-idle; excludes setup, readback, editor composition";
    readonly timestampQueryAvailable: boolean;
    readonly comparisonProfile: {
      readonly sourceFormat: "rgba8unorm";
      readonly workingFormat: "rgba16float";
      readonly alpha: "premultiplied";
      readonly baselineColorProcessing: "encoded-to-linear-to-encoded";
      readonly optimizedColorProcessing: "stored-value averaging";
      readonly boundaryMode: "full-texture-clamp";
    };
  };
  readonly cases: readonly BlurQualityPerformanceCaseReport[];
  readonly summary: {
    readonly aggregateSpeedup: number;
    readonly fastestSpeedup: number;
    readonly slowestSpeedup: number;
    readonly lowestPeakSignalToNoiseRatioDb: number | null;
    readonly qualityGuardrailsPassed: boolean;
  };
  readonly checks: Readonly<Record<string, boolean>>;
}

interface BlurCapture {
  readonly radius: number;
  readonly baseline: Uint8Array;
  readonly optimized: Uint8Array;
}

interface PreparedScenario {
  readonly radius: number;
  readonly work: BlurQualityPerformanceCaseReport["work"];
  readonly baselineOutput: GPUTexture;
  readonly optimizedOutput: GPUTexture;
  encodeBaseline(encoder: GPUCommandEncoder): void;
  encodeOptimized(encoder: GPUCommandEncoder): void;
  destroy(): void;
}

interface BlurLabView {
  setProgress(progress: BlurQualityPerformanceProgress): void;
  appendCase(report: BlurQualityPerformanceCaseReport, capture: BlurCapture): void;
  finish(report: BlurQualityPerformanceReport, captures: readonly BlurCapture[]): void;
  fail(error: unknown): void;
}

interface RunOptions {
  readonly search?: URLSearchParams;
  readonly onProgress?: (progress: BlurQualityPerformanceProgress) => void;
}

function createTexture(
  device: GPUDevice,
  label: string,
  width: number,
  height: number,
  format: GPUTextureFormat = WORKING_TEXTURE_FORMAT,
): GPUTexture {
  return device.createTexture({
    label,
    size: { width, height },
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.STORAGE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });
}

function createUniformBuffer(
  device: GPUDevice,
  label: string,
  byteLength: number,
  write: (view: DataView) => void,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.ceil(byteLength / 16) * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bytes = new ArrayBuffer(Math.ceil(byteLength / 16) * 16);
  write(new DataView(bytes));
  device.queue.writeBuffer(buffer, 0, bytes);
  return buffer;
}

function dispatch(
  pass: GPUComputePassEncoder,
  width: number,
  height: number,
): void {
  pass.dispatchWorkgroups(
    Math.ceil(width / WORKGROUP_SIZE),
    Math.ceil(height / WORKGROUP_SIZE),
  );
}

function createHarness(device: GPUDevice, source: GPUTexture) {
  const gaussianPipeline = device.createComputePipeline({
    label: "Blur Lab exact Gaussian",
    layout: "auto",
    compute: {
      module: device.createShaderModule({
        label: "Blur Lab exact Gaussian shader",
        code: GAUSSIAN_SHADER,
      }),
      entryPoint: "main",
    },
  });
  const tentPipeline = device.createComputePipeline({
    label: "Blur Lab adaptive tent",
    layout: "auto",
    compute: {
      module: device.createShaderModule({
        label: "Blur Lab adaptive tent shader",
        code: TENT_SHADER,
      }),
      entryPoint: "main",
    },
  });
  const prefilterPipeline = device.createComputePipeline({
    label: "Blur Lab bounded prefilter",
    layout: "auto",
    compute: {
      module: device.createShaderModule({
        label: "Blur Lab bounded prefilter shader",
        code: PREFILTER_SHADER,
      }),
      entryPoint: "main",
    },
  });
  const resizePipeline = device.createComputePipeline({
    label: "Blur Lab bilinear resize",
    layout: "auto",
    compute: {
      module: device.createShaderModule({
        label: "Blur Lab bilinear resize shader",
        code: RESIZE_SHADER,
      }),
      entryPoint: "main",
    },
  });
  const sampler = device.createSampler({
    label: "Blur Lab linear clamp sampler",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear",
  });

  function prepare(radius: number, size: number): PreparedScenario {
    const plan = destructiveTentBlurPlan(radius, 1);
    const workWidth = Math.max(1, Math.ceil(size * plan.workScale));
    const workHeight = workWidth;
    const baselineTemporary = createTexture(
      device,
      `Blur Lab baseline horizontal r${radius}`,
      size,
      size,
    );
    const baselineOutput = createTexture(
      device,
      `Blur Lab baseline output r${radius}`,
      size,
      size,
    );
    const optimizedSource = plan.workScale < 1
      ? createTexture(device, `Blur Lab reduced source r${radius}`, workWidth, workHeight)
      : source;
    const optimizedTemporary = createTexture(
      device,
      `Blur Lab optimized horizontal r${radius}`,
      workWidth,
      workHeight,
    );
    const optimizedBlurred = createTexture(
      device,
      `Blur Lab optimized vertical r${radius}`,
      workWidth,
      workHeight,
    );
    const optimizedOutput = plan.workScale < 1
      ? createTexture(device, `Blur Lab optimized output r${radius}`, size, size)
      : optimizedBlurred;
    const resources: Array<GPUTexture | GPUBuffer> = [
      baselineTemporary,
      baselineOutput,
      optimizedTemporary,
      optimizedBlurred,
    ];
    if (optimizedSource !== source) resources.push(optimizedSource);
    if (optimizedOutput !== optimizedBlurred) resources.push(optimizedOutput);

    const kernel = destructiveGaussianBlurKernel(radius);
    const weightsBuffer = device.createBuffer({
      label: `Blur Lab Gaussian weights r${radius}`,
      size: Math.ceil(kernel.weights.length * 4 / 16) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(weightsBuffer, 0, new Float32Array(kernel.weights));
    resources.push(weightsBuffer);

    const gaussianHorizontalParams = createUniformBuffer(
      device,
      `Blur Lab Gaussian horizontal parameters r${radius}`,
      32,
      (view) => {
        view.setUint32(0, size, true);
        view.setUint32(4, size, true);
        view.setUint32(8, kernel.radius, true);
        view.setUint32(12, 1, true);
        view.setInt32(16, 1, true);
        view.setInt32(20, 0, true);
        view.setUint32(24, 0, true);
      },
    );
    const gaussianVerticalParams = createUniformBuffer(
      device,
      `Blur Lab Gaussian vertical parameters r${radius}`,
      32,
      (view) => {
        view.setUint32(0, size, true);
        view.setUint32(4, size, true);
        view.setUint32(8, kernel.radius, true);
        view.setUint32(12, 0, true);
        view.setInt32(16, 0, true);
        view.setInt32(20, 1, true);
        view.setUint32(24, 1, true);
      },
    );
    const tentHorizontalParams = createUniformBuffer(
      device,
      `Blur Lab tent horizontal parameters r${radius}`,
      32,
      (view) => {
        view.setUint32(0, workWidth, true);
        view.setUint32(4, workHeight, true);
        view.setFloat32(8, plan.count, true);
        view.setFloat32(16, 1, true);
        view.setFloat32(20, 0, true);
      },
    );
    const tentVerticalParams = createUniformBuffer(
      device,
      `Blur Lab tent vertical parameters r${radius}`,
      32,
      (view) => {
        view.setUint32(0, workWidth, true);
        view.setUint32(4, workHeight, true);
        view.setFloat32(8, plan.count, true);
        view.setFloat32(16, 0, true);
        view.setFloat32(20, 1, true);
      },
    );
    resources.push(
      gaussianHorizontalParams,
      gaussianVerticalParams,
      tentHorizontalParams,
      tentVerticalParams,
    );

    const gaussianHorizontalGroup = device.createBindGroup({
      label: `Blur Lab Gaussian horizontal bindings r${radius}`,
      layout: gaussianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: baselineTemporary.createView() },
        { binding: 2, resource: { buffer: weightsBuffer } },
        { binding: 3, resource: { buffer: gaussianHorizontalParams } },
      ],
    });
    const gaussianVerticalGroup = device.createBindGroup({
      label: `Blur Lab Gaussian vertical bindings r${radius}`,
      layout: gaussianPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: baselineTemporary.createView() },
        { binding: 1, resource: baselineOutput.createView() },
        { binding: 2, resource: { buffer: weightsBuffer } },
        { binding: 3, resource: { buffer: gaussianVerticalParams } },
      ],
    });
    const tentHorizontalGroup = device.createBindGroup({
      label: `Blur Lab tent horizontal bindings r${radius}`,
      layout: tentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: optimizedSource.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: optimizedTemporary.createView() },
        { binding: 3, resource: { buffer: tentHorizontalParams } },
      ],
    });
    const tentVerticalGroup = device.createBindGroup({
      label: `Blur Lab tent vertical bindings r${radius}`,
      layout: tentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: optimizedTemporary.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: optimizedBlurred.createView() },
        { binding: 3, resource: { buffer: tentVerticalParams } },
      ],
    });

    let reduceGroup: GPUBindGroup | null = null;
    let enlargeGroup: GPUBindGroup | null = null;
    if (optimizedSource !== source) {
      const reduceParams = createUniformBuffer(
        device,
        `Blur Lab reduce parameters r${radius}`,
        32,
        (view) => {
          view.setUint32(0, workWidth, true);
          view.setUint32(4, workHeight, true);
          view.setUint32(8, size, true);
          view.setUint32(12, size, true);
          view.setFloat32(16, plan.prefilterWidth, true);
          view.setUint32(20, plan.prefilterSampleAxis, true);
        },
      );
      const enlargeParams = createUniformBuffer(
        device,
        `Blur Lab enlarge parameters r${radius}`,
        16,
        (view) => {
          view.setUint32(0, size, true);
          view.setUint32(4, size, true);
        },
      );
      resources.push(reduceParams, enlargeParams);
      reduceGroup = device.createBindGroup({
        label: `Blur Lab reduce bindings r${radius}`,
        layout: prefilterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: optimizedSource.createView() },
          { binding: 3, resource: { buffer: reduceParams } },
        ],
      });
      enlargeGroup = device.createBindGroup({
        label: `Blur Lab enlarge bindings r${radius}`,
        layout: resizePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: optimizedBlurred.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: optimizedOutput.createView() },
          { binding: 3, resource: { buffer: enlargeParams } },
        ],
      });
    }

    return {
      radius,
      work: {
        rawCount: plan.rawCount,
        count: plan.count,
        downsample: plan.downsample,
        workScale: plan.workScale,
        prefilterSampleAxis: plan.prefilterSampleAxis,
        prefilterWidth: plan.prefilterWidth,
        width: workWidth,
        height: workHeight,
      },
      baselineOutput,
      optimizedOutput,
      encodeBaseline(encoder): void {
        const horizontal = encoder.beginComputePass({
          label: `Blur Lab exact Gaussian horizontal r${radius}`,
        });
        horizontal.setPipeline(gaussianPipeline);
        horizontal.setBindGroup(0, gaussianHorizontalGroup);
        dispatch(horizontal, size, size);
        horizontal.end();
        const vertical = encoder.beginComputePass({
          label: `Blur Lab exact Gaussian vertical r${radius}`,
        });
        vertical.setPipeline(gaussianPipeline);
        vertical.setBindGroup(0, gaussianVerticalGroup);
        dispatch(vertical, size, size);
        vertical.end();
      },
      encodeOptimized(encoder): void {
        if (reduceGroup) {
          const reduce = encoder.beginComputePass({
            label: `Blur Lab adaptive prefilter r${radius}`,
          });
          reduce.setPipeline(prefilterPipeline);
          reduce.setBindGroup(0, reduceGroup);
          dispatch(reduce, workWidth, workHeight);
          reduce.end();
        }
        const horizontal = encoder.beginComputePass({
          label: `Blur Lab adaptive tent horizontal r${radius}`,
        });
        horizontal.setPipeline(tentPipeline);
        horizontal.setBindGroup(0, tentHorizontalGroup);
        dispatch(horizontal, workWidth, workHeight);
        horizontal.end();
        const vertical = encoder.beginComputePass({
          label: `Blur Lab adaptive tent vertical r${radius}`,
        });
        vertical.setPipeline(tentPipeline);
        vertical.setBindGroup(0, tentVerticalGroup);
        dispatch(vertical, workWidth, workHeight);
        vertical.end();
        if (enlargeGroup) {
          const enlarge = encoder.beginComputePass({
            label: `Blur Lab adaptive restore r${radius}`,
          });
          enlarge.setPipeline(resizePipeline);
          enlarge.setBindGroup(0, enlargeGroup);
          dispatch(enlarge, size, size);
          enlarge.end();
        }
      },
      destroy(): void {
        for (const resource of resources) resource.destroy();
      },
    };
  }

  return { prepare };
}

async function withQueueFenceTimeout(device: GPUDevice): Promise<void> {
  let timeout = 0;
  try {
    await Promise.race([
      device.queue.onSubmittedWorkDone(),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error("Il test GPU non ha risposto entro 30 secondi."));
        }, QUEUE_FENCE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== 0) window.clearTimeout(timeout);
  }
}

async function measureSubmission(
  device: GPUDevice,
  label: string,
  encode: (encoder: GPUCommandEncoder) => void,
): Promise<number> {
  const encoder = device.createCommandEncoder({ label });
  encode(encoder);
  const commands = encoder.finish();
  const started = performance.now();
  device.queue.submit([commands]);
  await withQueueFenceTimeout(device);
  return performance.now() - started;
}

async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const tightBytesPerRow = width * 8;
  const bytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;
  const buffer = device.createBuffer({
    label: "Blur Lab RGBA16F readback",
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({ label: "Blur Lab readback" });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const output = rgba16FloatRowsToRgba8Unorm(mapped, width, height, bytesPerRow);
    buffer.unmap();
    return output;
  } finally {
    buffer.destroy();
  }
}

function writeFixture(
  device: GPUDevice,
  texture: GPUTexture,
  pixels: Uint8Array,
  size: number,
): void {
  device.queue.writeTexture(
    { texture },
    pixels,
    { bytesPerRow: size * 4, rowsPerImage: size },
    { width: size, height: size, depthOrArrayLayers: 1 },
  );
}

function formatMilliseconds(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatPsnr(value: number | null): string {
  return value === null ? "∞" : `${value.toFixed(1)} dB`;
}

function canvasForCapture(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  size: number,
): void {
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Il canvas di confronto 2D non è disponibile.");
  const displayPixels = new Uint8ClampedArray(pixels.byteLength);
  for (let offset = 0; offset < pixels.byteLength; offset += 4) {
    const alpha = pixels[offset + 3];
    displayPixels[offset + 3] = alpha;
    if (alpha === 0) continue;
    displayPixels[offset] = Math.min(255, Math.round(pixels[offset] * 255 / alpha));
    displayPixels[offset + 1] = Math.min(
      255,
      Math.round(pixels[offset + 1] * 255 / alpha),
    );
    displayPixels[offset + 2] = Math.min(
      255,
      Math.round(pixels[offset + 2] * 255 / alpha),
    );
  }
  context.putImageData(
    new ImageData(displayPixels, size, size),
    0,
    0,
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copia non disponibile in questo browser.");
}

function downloadReport(report: BlurQualityPerformanceReport): void {
  const blob = new Blob([serializeBlurQualityPerformanceReport(report)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `blur-quality-performance-${report.config.size}px.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function createView(
  config: BlurQualityPerformanceConfig,
  fixture: Uint8Array,
): BlurLabView {
  document.querySelector("[data-blur-lab-root]")?.remove();
  const root = document.createElement("section");
  root.className = "blur-quality-performance-lab";
  root.dataset.blurLabRoot = "";
  root.setAttribute("aria-label", "Confronto qualità e prestazioni blur");
  root.innerHTML = `
    <header class="blur-lab-header">
      <div>
        <p class="blur-lab-kicker">GPU LAB · ${config.size} × ${config.size}</p>
        <h2>Blur esatto e adattivo</h2>
      </div>
      <button type="button" class="blur-lab-icon-button" data-blur-lab-close aria-label="Chiudi confronto">×</button>
    </header>
    <p class="blur-lab-intro">Stessa fixture, stessi raggi. La baseline usa una Gaussiana esatta; la variante adattiva limita il kernel e riduce la scala di lavoro solo quando serve.</p>
    <p class="blur-lab-scope">Benchmark algoritmico full-frame isolato: misura i passaggi del filtro fino alla coda GPU inattiva; esclude preparazione, lettura pixel e composizione dell’editor. Lo speedup non è un tempo end-to-end dell’editor.</p>
    <section class="blur-lab-progress-card" aria-live="polite">
      <div>
        <strong data-blur-lab-status>Preparazione GPU…</strong>
        <span data-blur-lab-progress-label>0%</span>
      </div>
      <progress data-blur-lab-progress max="1" value="0">0%</progress>
    </section>
    <div class="blur-lab-summary" data-blur-lab-summary hidden></div>
    <section class="blur-lab-previews" data-blur-lab-previews hidden>
      <header>
        <h3>Confronto visivo</h3>
        <label>Raggio
          <select data-blur-lab-preview-select aria-label="Raggio anteprima"></select>
        </label>
      </header>
      <div class="blur-lab-preview-grid">
        <figure>
          <figcaption><strong>Originale</strong><span>Nessun blur</span></figcaption>
          <div class="blur-lab-canvas-frame"><canvas data-blur-lab-preview-original></canvas></div>
        </figure>
        <figure>
          <figcaption><strong>Baseline esatta</strong><span data-blur-lab-baseline-caption>—</span></figcaption>
          <div class="blur-lab-canvas-frame"><canvas data-blur-lab-preview-baseline></canvas></div>
        </figure>
        <figure>
          <figcaption><strong>Adattivo</strong><span data-blur-lab-optimized-caption>—</span></figcaption>
          <div class="blur-lab-canvas-frame"><canvas data-blur-lab-preview-optimized></canvas></div>
        </figure>
      </div>
    </section>
    <section class="blur-lab-results" aria-labelledby="blurLabResultsTitle">
      <h3 id="blurLabResultsTitle">Risultati automatici</h3>
      <div class="blur-lab-table-scroll">
        <table data-blur-lab-table>
          <thead><tr><th>Raggio</th><th>Baseline</th><th>Adattivo</th><th>Velocità</th><th>PSNR</th><th>MAE</th><th>Energia α</th><th>Scala</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
    <div class="blur-lab-actions" data-blur-lab-actions hidden>
      <button type="button" data-blur-lab-copy>Copia JSON</button>
      <button type="button" data-blur-lab-download>Scarica JSON</button>
      <button type="button" data-blur-lab-rerun>Ripeti test</button>
    </div>
    <p class="blur-lab-action-status" data-blur-lab-action-status aria-live="polite"></p>
  `;
  document.body.append(root);
  root.querySelector<HTMLButtonElement>("[data-blur-lab-close]")?.addEventListener(
    "click",
    () => root.remove(),
  );

  const progressElement = root.querySelector<HTMLProgressElement>("[data-blur-lab-progress]")!;
  const progressLabel = root.querySelector<HTMLElement>("[data-blur-lab-progress-label]")!;
  const status = root.querySelector<HTMLElement>("[data-blur-lab-status]")!;
  const tableBody = root.querySelector<HTMLTableSectionElement>("tbody")!;
  const previews = root.querySelector<HTMLElement>("[data-blur-lab-previews]")!;
  const previewSelect = root.querySelector<HTMLSelectElement>(
    "[data-blur-lab-preview-select]",
  )!;
  const originalCanvas = root.querySelector<HTMLCanvasElement>(
    "[data-blur-lab-preview-original]",
  )!;
  const baselineCanvas = root.querySelector<HTMLCanvasElement>(
    "[data-blur-lab-preview-baseline]",
  )!;
  const optimizedCanvas = root.querySelector<HTMLCanvasElement>(
    "[data-blur-lab-preview-optimized]",
  )!;
  const baselineCaption = root.querySelector<HTMLElement>(
    "[data-blur-lab-baseline-caption]",
  )!;
  const optimizedCaption = root.querySelector<HTMLElement>(
    "[data-blur-lab-optimized-caption]",
  )!;
  const captures = new Map<number, BlurCapture>();
  const reports = new Map<number, BlurQualityPerformanceCaseReport>();
  canvasForCapture(originalCanvas, fixture, config.size);

  const showCapture = (radius: number): void => {
    const capture = captures.get(radius);
    const report = reports.get(radius);
    if (!capture || !report) return;
    canvasForCapture(baselineCanvas, capture.baseline, config.size);
    canvasForCapture(optimizedCanvas, capture.optimized, config.size);
    baselineCaption.textContent = `${formatMilliseconds(report.baseline.medianMs)} ms`;
    optimizedCaption.textContent = `${formatMilliseconds(report.optimized.medianMs)} ms · ${report.speedup.toFixed(2)}×`;
  };
  previewSelect.addEventListener("change", () => {
    showCapture(Number(previewSelect.value));
  });

  return {
    setProgress(progress): void {
      progressElement.max = progress.total;
      progressElement.value = progress.completed;
      const percent = progress.total > 0
        ? Math.round(progress.completed / progress.total * 100)
        : 0;
      progressLabel.textContent = `${percent}%`;
      progressElement.textContent = `${percent}%`;
      status.textContent = progress.message;
    },
    appendCase(report, capture): void {
      reports.set(report.radius, report);
      captures.set(capture.radius, capture);
      const row = document.createElement("tr");
      row.innerHTML = `
        <th scope="row">${report.radius}px</th>
        <td>${formatMilliseconds(report.baseline.medianMs)} ms</td>
        <td>${formatMilliseconds(report.optimized.medianMs)} ms</td>
        <td><strong>${report.speedup.toFixed(2)}×</strong></td>
        <td>${formatPsnr(report.quality.peakSignalToNoiseRatioDb)}</td>
        <td>${(report.quality.meanAbsoluteError * 100).toFixed(2)}%</td>
        <td>${(report.quality.alphaEnergyRatio * 100).toFixed(1)}%</td>
        <td>${report.work.workScale.toFixed(3)}×</td>
      `;
      tableBody.append(row);
      previewSelect.add(new Option(`${report.radius}px`, String(report.radius)));
      previews.hidden = false;
      previewSelect.value = String(report.radius);
      showCapture(report.radius);
    },
    finish(report, finalCaptures): void {
      const summary = root.querySelector<HTMLElement>("[data-blur-lab-summary]")!;
      summary.innerHTML = `
        <article><span>Speedup aggregato</span><strong>${report.summary.aggregateSpeedup.toFixed(2)}×</strong></article>
        <article><span>PSNR minimo</span><strong>${formatPsnr(report.summary.lowestPeakSignalToNoiseRatioDb)}</strong></article>
        <article><span>Soglia qualità</span><strong>${report.summary.qualityGuardrailsPassed ? "entro soglia" : "differenza visibile"}</strong></article>
        <article><span>Scenari</span><strong>${report.cases.length}/${report.config.radii.length}</strong></article>
      `;
      summary.hidden = false;
      const preferred = finalCaptures.find((capture) => capture.radius === 16)
        ?? finalCaptures.at(-1);
      if (preferred) {
        previewSelect.value = String(preferred.radius);
        showCapture(preferred.radius);
      }
      const actions = root.querySelector<HTMLElement>("[data-blur-lab-actions]")!;
      const actionStatus = root.querySelector<HTMLElement>(
        "[data-blur-lab-action-status]",
      )!;
      actions.hidden = false;
      root.querySelector<HTMLButtonElement>("[data-blur-lab-copy]")?.addEventListener(
        "click",
        async () => {
          try {
            await copyText(serializeBlurQualityPerformanceReport(report));
            actionStatus.textContent = "Report copiato.";
          } catch (error) {
            actionStatus.textContent = error instanceof Error ? error.message : String(error);
          }
        },
      );
      root.querySelector<HTMLButtonElement>("[data-blur-lab-download]")?.addEventListener(
        "click",
        () => {
          downloadReport(report);
          actionStatus.textContent = "Download preparato.";
        },
      );
      root.querySelector<HTMLButtonElement>("[data-blur-lab-rerun]")?.addEventListener(
        "click",
        () => {
          const mainRun = document.querySelector<HTMLButtonElement>("[data-lab-run]");
          if (mainRun && !mainRun.disabled) mainRun.click();
        },
      );
    },
    fail(error): void {
      const message = error instanceof Error ? error.message : String(error);
      status.textContent = message;
      progressElement.classList.add("error");
      root.querySelector<HTMLElement>("[data-blur-lab-action-status]")!.textContent =
        "Riduci size o runs nell’URL e riprova.";
    },
  };
}

function aggregateReport(
  engine: BrushEngine,
  config: BlurQualityPerformanceConfig,
  fixture: Uint8Array,
  cases: readonly BlurQualityPerformanceCaseReport[],
): BlurQualityPerformanceReport {
  const checks = createBlurQualityPerformanceChecks(cases, config.radii);
  const baselineTotal = cases.reduce(
    (total, entry) => total + entry.baseline.medianMs,
    0,
  );
  const optimizedTotal = cases.reduce(
    (total, entry) => total + entry.optimized.medianMs,
    0,
  );
  const finitePsnr = cases
    .map((entry) => entry.quality.peakSignalToNoiseRatioDb)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const navigatorWithMemory = navigator as Navigator & { readonly deviceMemory?: number };
  return {
    version: BLUR_QUALITY_PERFORMANCE_REPORT_VERSION,
    lab: BLUR_QUALITY_PERFORMANCE_LAB_ID,
    strategy: BLUR_QUALITY_PERFORMANCE_STRATEGY,
    scope: "isolated-algorithm-benchmark",
    // `passed` means that the automatic measurement completed with valid
    // data. Visual equivalence is a measured outcome, reported separately,
    // rather than an infrastructure error.
    passed: checks.allScenariosCompleted
      && checks.timingsAreFinite
      && checks.qualityMetricsAreFinite,
    config,
    fixture: {
      revision: BLUR_QUALITY_PERFORMANCE_FIXTURE_REVISION,
      width: config.size,
      height: config.size,
      hash: blurFixtureHash(fixture),
    },
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      gpu: {
        label: engine.getBenchmarkEnvironment().gpuLabel,
        ...engine.getWebGpuDiagnosticInfo(),
      },
      timingMethod: "queue-fence",
      timingScope:
        "command-submit-to-queue-idle; excludes setup, readback, editor composition",
      timestampQueryAvailable: engine.device.features.has("timestamp-query"),
      comparisonProfile: {
        sourceFormat: "rgba8unorm",
        workingFormat: "rgba16float",
        alpha: "premultiplied",
        baselineColorProcessing: "encoded-to-linear-to-encoded",
        optimizedColorProcessing: "stored-value averaging",
        boundaryMode: "full-texture-clamp",
      },
    },
    cases,
    summary: {
      aggregateSpeedup: blurCaseSpeedup(baselineTotal, optimizedTotal),
      fastestSpeedup: Math.max(...cases.map((entry) => entry.speedup), 0),
      slowestSpeedup: Math.min(...cases.map((entry) => entry.speedup)),
      lowestPeakSignalToNoiseRatioDb: finitePsnr.length > 0
        ? Math.min(...finitePsnr)
        : null,
      qualityGuardrailsPassed: cases.every((entry) => blurQualityGuardrail(entry.quality)),
    },
    checks,
  };
}

export async function runBlurQualityPerformanceLab(
  engine: BrushEngine,
  options: RunOptions = {},
): Promise<BlurQualityPerformanceReport> {
  const config = blurQualityPerformanceConfigFromSearch(
    options.search ?? new URLSearchParams(window.location.search),
  );
  const fixture = createBlurQualityPerformanceFixture(config.size);
  const view = createView(config, fixture);
  const totalMeasurements = config.radii.length
    * (config.warmupRuns + config.runs)
    * 2;
  let completedMeasurements = 0;
  const update = (
    stage: BlurQualityPerformanceProgress["stage"],
    radius: number | null,
    message: string,
  ): void => {
    const progress: BlurQualityPerformanceProgress = {
      completed: completedMeasurements,
      total: totalMeasurements,
      radius,
      stage,
      message,
    };
    view.setProgress(progress);
    options.onProgress?.(progress);
  };
  update("preparing", null, "Preparazione fixture e pipeline GPU…");

  const { device } = engine;
  await engine.waitForIdle();
  await withQueueFenceTimeout(device);
  const source = createTexture(
    device,
    "Blur Lab deterministic source",
    config.size,
    config.size,
    SOURCE_TEXTURE_FORMAT,
  );
  writeFixture(device, source, fixture, config.size);
  const harness = createHarness(device, source);
  const cases: BlurQualityPerformanceCaseReport[] = [];
  const captures: BlurCapture[] = [];
  try {
    for (let caseIndex = 0; caseIndex < config.radii.length; caseIndex += 1) {
      const radius = config.radii[caseIndex];
      const scenario = harness.prepare(radius, config.size);
      try {
        for (let warmup = 0; warmup < config.warmupRuns; warmup += 1) {
          update("warmup", radius, `Warmup raggio ${radius}px…`);
          const order = (caseIndex + warmup) % 2 === 0
            ? [scenario.encodeBaseline, scenario.encodeOptimized]
            : [scenario.encodeOptimized, scenario.encodeBaseline];
          for (const encode of order) {
            await measureSubmission(device, `Blur Lab warmup r${radius}`, encode);
            completedMeasurements += 1;
            update("warmup", radius, `Warmup raggio ${radius}px…`);
          }
        }

        const baselineSamples: number[] = [];
        const optimizedSamples: number[] = [];
        for (let run = 0; run < config.runs; run += 1) {
          const baselineFirst = (caseIndex + run) % 2 === 0;
          const strategies = baselineFirst
            ? [
              ["baseline", scenario.encodeBaseline] as const,
              ["optimized", scenario.encodeOptimized] as const,
            ]
            : [
              ["optimized", scenario.encodeOptimized] as const,
              ["baseline", scenario.encodeBaseline] as const,
            ];
          for (const [strategy, encode] of strategies) {
            update(
              "measuring",
              radius,
              `Raggio ${radius}px · misura ${run + 1}/${config.runs}…`,
            );
            const elapsed = await measureSubmission(
              device,
              `Blur Lab ${strategy} r${radius} run ${run + 1}`,
              encode,
            );
            (strategy === "baseline" ? baselineSamples : optimizedSamples).push(elapsed);
            completedMeasurements += 1;
          }
        }

        update("reading", radius, `Raggio ${radius}px · confronto pixel…`);
        const [baselinePixels, optimizedPixels] = await Promise.all([
          readTexture(device, scenario.baselineOutput, config.size, config.size),
          readTexture(device, scenario.optimizedOutput, config.size, config.size),
        ]);
        const baselineTiming = summarizeBlurTimings(baselineSamples);
        const optimizedTiming = summarizeBlurTimings(optimizedSamples);
        const report: BlurQualityPerformanceCaseReport = {
          radius,
          baseline: baselineTiming,
          optimized: optimizedTiming,
          speedup: blurCaseSpeedup(
            baselineTiming.medianMs,
            optimizedTiming.medianMs,
          ),
          work: scenario.work,
          quality: computeBlurQualityMetrics(baselinePixels, optimizedPixels),
        };
        const capture: BlurCapture = {
          radius,
          baseline: baselinePixels,
          optimized: optimizedPixels,
        };
        cases.push(report);
        captures.push(capture);
        view.appendCase(report, capture);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      } finally {
        scenario.destroy();
      }
    }
    const report = aggregateReport(engine, config, fixture, cases);
    window.__editorLabReport = report;
    update("complete", null, "Test completato.");
    view.finish(report, captures);
    return report;
  } catch (error) {
    view.fail(error);
    throw error;
  } finally {
    source.destroy();
  }
}
