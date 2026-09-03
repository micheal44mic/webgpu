export const VECTOR_STROKE_GPU_PROBE_STRATEGY =
  "adaptive-cubic-count-serial-prefix-scan-triangle-list-draw-indirect-v1" as const;

const DEFAULT_TARGET_SIZE = 256;
const DEFAULT_MAXIMUM_ELEMENTS = 8_192;
const DEFAULT_MAXIMUM_SEGMENTS_PER_ELEMENT = 100;
const ELEMENT_FLOAT_COUNT = 12;
const ELEMENT_BYTES = ELEMENT_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const VERTICES_PER_SEGMENT = 6;
const FLOATS_PER_VERTEX = 2;
const VERTEX_BYTES = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
const PARAMETER_BYTES = 32;
const TOTAL_BYTES = 16;
const INDIRECT_ARGUMENT_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const SMALL_READBACK_BYTES = 64;
const TIMESTAMP_QUERY_COUNT = 8;
const TIMESTAMP_RESOLVE_BYTES = 256;

export interface VectorStrokeGpuProbePoint {
  readonly x: number;
  readonly y: number;
}

export type VectorStrokeGpuProbeElement =
  | {
      readonly kind: "line";
      readonly p0: VectorStrokeGpuProbePoint;
      readonly p1: VectorStrokeGpuProbePoint;
      readonly halfWidth: number;
    }
  | {
      readonly kind: "cubic";
      readonly p0: VectorStrokeGpuProbePoint;
      readonly p1: VectorStrokeGpuProbePoint;
      readonly p2: VectorStrokeGpuProbePoint;
      readonly p3: VectorStrokeGpuProbePoint;
      readonly halfWidth: number;
    };

export interface VectorStrokeGpuProbeViewBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface VectorStrokeGpuProbeOptions {
  readonly targetWidth?: number;
  readonly targetHeight?: number;
  readonly targetFormat?: GPUTextureFormat;
  readonly maximumElements?: number;
  readonly maximumSegmentsPerElement?: number;
}

export interface VectorStrokeGpuProbeRunOptions {
  readonly viewBounds?: VectorStrokeGpuProbeViewBounds;
  readonly clearColor?: GPUColor;
}

export interface VectorStrokeGpuProbeGpuTiming {
  readonly supported: boolean;
  readonly captured: boolean;
  readonly countMs: number | null;
  /** Single-invocation scan retained as an intentionally conservative baseline. */
  readonly prefixScanMs: number | null;
  readonly emitMs: number | null;
  readonly drawMs: number | null;
  readonly firstToLastMs: number | null;
}

export interface VectorStrokeGpuProbeOperationMetrics {
  /** Pipeline, buffer, bind-group, target and optional timestamp setup. */
  readonly initializationMs: number;
  /** Packs the public element representation into its storage-buffer payload. */
  readonly inputPackingMs: number;
  /** Uniform/storage uploads, command encoding, finish and queue submission. */
  readonly cpuEncodeMs: number;
  /** Wall time from queue submission until the submitted queue prefix completes. */
  readonly queueWallMs: number;
  /** Wall time from operation entry through queue-prefix completion. */
  readonly totalWallMs: number;
  /** Map/copy overhead for timestamp results; excluded from totalWallMs. */
  readonly timestampReadbackMs: number;
  readonly gpu: VectorStrokeGpuProbeGpuTiming;
}

export interface VectorStrokeGpuProbeRunResult {
  readonly strategy: typeof VECTOR_STROKE_GPU_PROBE_STRATEGY;
  readonly elementCount: number;
  readonly segmentCount: number;
  readonly vertexCount: number;
  readonly indirectArgs: readonly [number, number, number, number];
  readonly meaningfulBufferBytes: {
    readonly elements: number;
    readonly segmentCounts: number;
    readonly vertexOffsets: number;
    readonly vertices: number;
    readonly indirectArgs: number;
  };
  readonly metrics: VectorStrokeGpuProbeOperationMetrics;
}

export interface VectorStrokeGpuProbeRenderResult {
  readonly vertexCount: number;
  readonly indirectArgs: readonly [number, number, number, number];
  readonly metrics: VectorStrokeGpuProbeOperationMetrics;
}

export interface VectorStrokeGpuProbeReadback {
  /** One adaptive subdivision count per input element. */
  readonly segmentCounts: Uint32Array;
  /** Triangle-list vertex offsets, not byte offsets. */
  readonly vertexOffsets: Uint32Array;
  /** Interleaved local-space XY pairs; six vertices form each emitted quad. */
  readonly vertices: Float32Array;
  readonly indirectArgs: Uint32Array;
}

export interface VectorStrokeGpuProbe {
  readonly initializationMs: number;
  readonly maximumElements: number;
  readonly maximumSegmentsPerElement: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly targetFormat: GPUTextureFormat;
  run(
    elements: readonly VectorStrokeGpuProbeElement[],
    options?: VectorStrokeGpuProbeRunOptions,
  ): Promise<VectorStrokeGpuProbeRunResult>;
  /** Draws the last emitted geometry at another view without recomputing it. */
  render(options?: VectorStrokeGpuProbeRunOptions): Promise<VectorStrokeGpuProbeRenderResult>;
  /** Copies the last emitted geometry to CPU memory outside the measured run. */
  readback(): Promise<VectorStrokeGpuProbeReadback>;
  destroy(): void;
}

interface ProbeConfiguration {
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly targetFormat: GPUTextureFormat;
  readonly maximumElements: number;
  readonly maximumSegmentsPerElement: number;
}

interface ProbeResources {
  readonly elementBuffer: GPUBuffer;
  readonly segmentCountBuffer: GPUBuffer;
  readonly vertexOffsetBuffer: GPUBuffer;
  readonly vertexBuffer: GPUBuffer;
  readonly parameterBuffer: GPUBuffer;
  readonly totalBuffer: GPUBuffer;
  readonly indirectBuffer: GPUBuffer;
  readonly smallReadbackBuffer: GPUBuffer;
  readonly targetTexture: GPUTexture;
  readonly targetView: GPUTextureView;
  readonly countPipeline: GPUComputePipeline;
  readonly scanPipeline: GPUComputePipeline;
  readonly emitPipeline: GPUComputePipeline;
  readonly renderPipeline: GPURenderPipeline;
  readonly countBindGroup: GPUBindGroup;
  readonly scanBindGroup: GPUBindGroup;
  readonly emitBindGroup: GPUBindGroup;
  readonly renderBindGroup: GPUBindGroup;
  readonly timestampQuerySet: GPUQuerySet | null;
  readonly timestampResolveBuffer: GPUBuffer | null;
  readonly timestampReadbackBuffer: GPUBuffer | null;
}

const countShader = /* wgsl */ `
struct ProbeParameters {
  elementCount: u32,
  maximumSegments: u32,
  padding: vec2<u32>,
  viewBounds: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> elements: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> segmentCounts: array<u32>;
@group(0) @binding(2) var<uniform> parameters: ProbeParameters;

fn cubicPoint(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  let inverse = 1.0 - t;
  return inverse * inverse * inverse * p0
    + 3.0 * inverse * inverse * t * p1
    + 3.0 * inverse * t * t * p2
    + t * t * t * p3;
}

fn pointLineDistance(point: vec2<f32>, start: vec2<f32>, end: vec2<f32>) -> f32 {
  let delta = end - start;
  let denominator = length(delta);
  if (denominator <= 0.0000001) {
    return length(point - start);
  }
  return abs(delta.y * point.x - delta.x * point.y + end.x * start.y - end.y * start.x)
    / denominator;
}

fn cubicFits(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  segmentCount: u32,
  tolerance: f32,
) -> bool {
  for (var segment = 0u; segment < segmentCount; segment += 1u) {
    let firstT = f32(segment) / f32(segmentCount);
    let lastT = f32(segment + 1u) / f32(segmentCount);
    let interval = lastT - firstT;
    let start = cubicPoint(p0, p1, p2, p3, firstT);
    let end = cubicPoint(p0, p1, p2, p3, lastT);
    let firstProbe = cubicPoint(p0, p1, p2, p3, firstT + interval * 0.25);
    let middleProbe = cubicPoint(p0, p1, p2, p3, firstT + interval * 0.5);
    let lastProbe = cubicPoint(p0, p1, p2, p3, firstT + interval * 0.75);
    let maximumError = max(
      pointLineDistance(firstProbe, start, end),
      max(
        pointLineDistance(middleProbe, start, end),
        pointLineDistance(lastProbe, start, end),
      ),
    );
    if (maximumError > tolerance) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64)
fn countMain(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let elementIndex = invocation.x;
  if (elementIndex >= parameters.elementCount) {
    return;
  }
  let base = elementIndex * 3u;
  let endpoints = elements[base];
  let controls = elements[base + 1u];
  let metadata = elements[base + 2u];
  if (metadata.y < 0.5) {
    segmentCounts[elementIndex] = 1u;
    return;
  }

  // The probe deliberately mirrors the observed screen-independent rule.
  let tolerance = max(0.000001, min(abs(metadata.x) / 32.0, 0.25));
  var count = 1u;
  loop {
    if (
      cubicFits(endpoints.xy, controls.xy, controls.zw, endpoints.zw, count, tolerance)
      || count >= parameters.maximumSegments
    ) {
      break;
    }
    count = min(parameters.maximumSegments, count * 2u);
  }
  segmentCounts[elementIndex] = count;
}
`;

const scanShader = /* wgsl */ `
struct ProbeParameters {
  elementCount: u32,
  maximumSegments: u32,
  padding: vec2<u32>,
  viewBounds: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> segmentCounts: array<u32>;
@group(0) @binding(1) var<storage, read_write> vertexOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> totals: array<u32>;
@group(0) @binding(3) var<storage, read_write> indirectArgs: array<u32>;
@group(0) @binding(4) var<uniform> parameters: ProbeParameters;

@compute @workgroup_size(1)
fn scanMain(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (invocation.x != 0u) {
    return;
  }
  var totalSegments = 0u;
  var totalVertices = 0u;
  for (var elementIndex = 0u; elementIndex < parameters.elementCount; elementIndex += 1u) {
    vertexOffsets[elementIndex] = totalVertices;
    let segmentCount = segmentCounts[elementIndex];
    totalSegments += segmentCount;
    totalVertices += segmentCount * ${VERTICES_PER_SEGMENT}u;
  }
  totals[0] = totalSegments;
  totals[1] = totalVertices;
  totals[2] = parameters.elementCount;
  totals[3] = 0u;
  indirectArgs[0] = totalVertices;
  indirectArgs[1] = 1u;
  indirectArgs[2] = 0u;
  indirectArgs[3] = 0u;
}
`;

const emitShader = /* wgsl */ `
struct ProbeParameters {
  elementCount: u32,
  maximumSegments: u32,
  padding: vec2<u32>,
  viewBounds: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> elements: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> segmentCounts: array<u32>;
@group(0) @binding(2) var<storage, read> vertexOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> vertices: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> parameters: ProbeParameters;

fn cubicPoint(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  let inverse = 1.0 - t;
  return inverse * inverse * inverse * p0
    + 3.0 * inverse * inverse * t * p1
    + 3.0 * inverse * t * t * p2
    + t * t * t * p3;
}

fn cubicTangent(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  let inverse = 1.0 - t;
  return 3.0 * inverse * inverse * (p1 - p0)
    + 6.0 * inverse * t * (p2 - p1)
    + 3.0 * t * t * (p3 - p2);
}

fn strokeNormal(tangentCandidate: vec2<f32>, chord: vec2<f32>) -> vec2<f32> {
  var tangent = tangentCandidate;
  if (length(tangent) <= 0.0000001) {
    tangent = chord;
  }
  if (length(tangent) <= 0.0000001) {
    tangent = vec2<f32>(1.0, 0.0);
  }
  let unit = normalize(tangent);
  return vec2<f32>(-unit.y, unit.x);
}

@compute @workgroup_size(64)
fn emitMain(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let elementIndex = invocation.x;
  if (elementIndex >= parameters.elementCount) {
    return;
  }
  let base = elementIndex * 3u;
  let endpoints = elements[base];
  let controls = elements[base + 1u];
  let metadata = elements[base + 2u];
  let p0 = endpoints.xy;
  let p1 = controls.xy;
  let p2 = controls.zw;
  let p3 = endpoints.zw;
  let halfWidth = abs(metadata.x);
  let cubic = metadata.y >= 0.5;
  let segmentCount = segmentCounts[elementIndex];
  let outputBase = vertexOffsets[elementIndex];

  for (var segment = 0u; segment < segmentCount; segment += 1u) {
    let firstT = f32(segment) / f32(segmentCount);
    let lastT = f32(segment + 1u) / f32(segmentCount);
    var start = p0;
    var end = p3;
    var startTangent = p3 - p0;
    var endTangent = startTangent;
    if (cubic) {
      start = cubicPoint(p0, p1, p2, p3, firstT);
      end = cubicPoint(p0, p1, p2, p3, lastT);
      startTangent = cubicTangent(p0, p1, p2, p3, firstT);
      endTangent = cubicTangent(p0, p1, p2, p3, lastT);
    }
    let chord = end - start;
    let startOffset = strokeNormal(startTangent, chord) * halfWidth;
    let endOffset = strokeNormal(endTangent, chord) * halfWidth;
    let firstLeft = start + startOffset;
    let lastLeft = end + endOffset;
    let lastRight = end - endOffset;
    let firstRight = start - startOffset;
    let output = outputBase + segment * ${VERTICES_PER_SEGMENT}u;
    vertices[output] = firstLeft;
    vertices[output + 1u] = lastLeft;
    vertices[output + 2u] = lastRight;
    vertices[output + 3u] = firstLeft;
    vertices[output + 4u] = lastRight;
    vertices[output + 5u] = firstRight;
  }
}
`;

const renderShader = /* wgsl */ `
struct ProbeParameters {
  elementCount: u32,
  maximumSegments: u32,
  padding: vec2<u32>,
  viewBounds: vec4<f32>,
};

struct VertexInput {
  @location(0) localPosition: vec2<f32>,
};

@group(0) @binding(0) var<uniform> parameters: ProbeParameters;

@vertex
fn vertexMain(input: VertexInput) -> @builtin(position) vec4<f32> {
  let minimum = parameters.viewBounds.xy;
  let extent = max(parameters.viewBounds.zw - minimum, vec2<f32>(0.000001));
  let normalized = (input.localPosition - minimum) / extent;
  return vec4<f32>(normalized.x * 2.0 - 1.0, 1.0 - normalized.y * 2.0, 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return resolved;
}

function finitePoint(point: VectorStrokeGpuProbePoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must contain finite coordinates.`);
  }
}

function validatedBounds(
  bounds: VectorStrokeGpuProbeViewBounds | undefined,
): VectorStrokeGpuProbeViewBounds {
  const value = bounds ?? { left: -1, top: -1, right: 1, bottom: 1 };
  if (
    !Number.isFinite(value.left)
    || !Number.isFinite(value.top)
    || !Number.isFinite(value.right)
    || !Number.isFinite(value.bottom)
    || value.right <= value.left
    || value.bottom <= value.top
  ) {
    throw new Error("Probe view bounds must be finite and non-empty.");
  }
  return value;
}

function checkedBufferSize(device: GPUDevice, size: number, label: string): number {
  if (!Number.isSafeInteger(size) || size <= 0 || size > device.limits.maxBufferSize) {
    throw new Error(`${label} exceeds the GPU buffer-size limit.`);
  }
  return size;
}

function storageBuffer(
  device: GPUDevice,
  label: string,
  size: number,
  extraUsage: GPUBufferUsageFlags = 0,
): GPUBuffer {
  if (size > device.limits.maxStorageBufferBindingSize) {
    throw new Error(`${label} exceeds the GPU storage-binding limit.`);
  }
  return device.createBuffer({
    label,
    size: checkedBufferSize(device, size, label),
    usage: GPUBufferUsage.STORAGE | extraUsage,
  });
}

function parameterPayload(
  elementCount: number,
  maximumSegments: number,
  bounds: VectorStrokeGpuProbeViewBounds,
): ArrayBuffer {
  const payload = new ArrayBuffer(PARAMETER_BYTES);
  const view = new DataView(payload);
  view.setUint32(0, elementCount, true);
  view.setUint32(4, maximumSegments, true);
  view.setFloat32(16, bounds.left, true);
  view.setFloat32(20, bounds.top, true);
  view.setFloat32(24, bounds.right, true);
  view.setFloat32(28, bounds.bottom, true);
  return payload;
}

function packElements(elements: readonly VectorStrokeGpuProbeElement[]): Float32Array {
  const payload = new Float32Array(elements.length * ELEMENT_FLOAT_COUNT);
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    finitePoint(element.p0, `Element ${index} p0`);
    finitePoint(element.p1, `Element ${index} p1`);
    if (!Number.isFinite(element.halfWidth) || element.halfWidth <= 0) {
      throw new Error(`Element ${index} halfWidth must be finite and positive.`);
    }
    if (element.kind === "cubic") {
      finitePoint(element.p2, `Element ${index} p2`);
      finitePoint(element.p3, `Element ${index} p3`);
    }
    const base = index * ELEMENT_FLOAT_COUNT;
    const p2 = element.kind === "cubic" ? element.p2 : element.p1;
    const p3 = element.kind === "cubic" ? element.p3 : element.p1;
    payload[base] = element.p0.x;
    payload[base + 1] = element.p0.y;
    payload[base + 2] = p3.x;
    payload[base + 3] = p3.y;
    payload[base + 4] = element.p1.x;
    payload[base + 5] = element.p1.y;
    payload[base + 6] = p2.x;
    payload[base + 7] = p2.y;
    payload[base + 8] = element.halfWidth;
    payload[base + 9] = element.kind === "cubic" ? 1 : 0;
  }
  return payload;
}

function passTimestampWrites(
  querySet: GPUQuerySet | null,
  beginningOfPassWriteIndex: number,
): GPUComputePassTimestampWrites | undefined {
  return querySet
    ? {
        querySet,
        beginningOfPassWriteIndex,
        endOfPassWriteIndex: beginningOfPassWriteIndex + 1,
      }
    : undefined;
}

function renderPassTimestampWrites(
  querySet: GPUQuerySet | null,
  beginningOfPassWriteIndex: number,
): GPURenderPassTimestampWrites | undefined {
  return querySet
    ? {
        querySet,
        beginningOfPassWriteIndex,
        endOfPassWriteIndex: beginningOfPassWriteIndex + 1,
      }
    : undefined;
}

function intervalMs(timestamps: BigUint64Array, start: number, end: number): number | null {
  const first = timestamps[start];
  const last = timestamps[end];
  return last >= first ? Number(last - first) / 1_000_000 : null;
}

function emptyGpuTiming(supported: boolean): VectorStrokeGpuProbeGpuTiming {
  return {
    supported,
    captured: false,
    countMs: null,
    prefixScanMs: null,
    emitMs: null,
    drawMs: null,
    firstToLastMs: null,
  };
}

function align4(value: number): number {
  return Math.ceil(value / 4) * 4;
}

class VectorStrokeGpuProbeImplementation implements VectorStrokeGpuProbe {
  readonly initializationMs: number;
  readonly maximumElements: number;
  readonly maximumSegmentsPerElement: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly targetFormat: GPUTextureFormat;

  readonly #device: GPUDevice;
  readonly #resources: ProbeResources;
  #lastElementCount = 0;
  #lastVertexCount = 0;
  #lastIndirectArgs: readonly [number, number, number, number] = [0, 1, 0, 0];
  #hasRun = false;
  #busy = false;
  #destroyed = false;

  constructor(
    device: GPUDevice,
    configuration: ProbeConfiguration,
    resources: ProbeResources,
    initializationMs: number,
  ) {
    this.#device = device;
    this.#resources = resources;
    this.initializationMs = initializationMs;
    this.maximumElements = configuration.maximumElements;
    this.maximumSegmentsPerElement = configuration.maximumSegmentsPerElement;
    this.targetWidth = configuration.targetWidth;
    this.targetHeight = configuration.targetHeight;
    this.targetFormat = configuration.targetFormat;
  }

  #beginOperation(): void {
    if (this.#destroyed) throw new Error("The vector stroke GPU probe was destroyed.");
    if (this.#busy) throw new Error("The vector stroke GPU probe is already running.");
    this.#busy = true;
  }

  #encodeDraw(
    encoder: GPUCommandEncoder,
    clearColor: GPUColor | undefined,
    timestampIndex: number,
  ): void {
    const timestampWrites = renderPassTimestampWrites(
      this.#resources.timestampQuerySet,
      timestampIndex,
    );
    const pass = encoder.beginRenderPass({
      label: "Vector stroke probe indirect draw",
      colorAttachments: [{
        view: this.#resources.targetView,
        clearValue: clearColor ?? { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
      ...(timestampWrites ? { timestampWrites } : {}),
    });
    pass.setPipeline(this.#resources.renderPipeline);
    pass.setBindGroup(0, this.#resources.renderBindGroup);
    pass.setVertexBuffer(0, this.#resources.vertexBuffer);
    pass.drawIndirect(this.#resources.indirectBuffer, 0);
    pass.end();
  }

  #encodeTimestampResolve(encoder: GPUCommandEncoder, count: number): void {
    const { timestampQuerySet, timestampResolveBuffer, timestampReadbackBuffer } =
      this.#resources;
    if (!timestampQuerySet || !timestampResolveBuffer || !timestampReadbackBuffer) return;
    encoder.resolveQuerySet(timestampQuerySet, 0, count, timestampResolveBuffer, 0);
    encoder.copyBufferToBuffer(
      timestampResolveBuffer,
      0,
      timestampReadbackBuffer,
      0,
      count * BigUint64Array.BYTES_PER_ELEMENT,
    );
  }

  async #readTimestampTiming(
    phaseCount: 1 | 4,
  ): Promise<{ timing: VectorStrokeGpuProbeGpuTiming; readbackMs: number }> {
    const { timestampReadbackBuffer } = this.#resources;
    if (!timestampReadbackBuffer) {
      return {
        timing: emptyGpuTiming(this.#device.features.has("timestamp-query")),
        readbackMs: 0,
      };
    }
    const startedAt = performance.now();
    try {
      await timestampReadbackBuffer.mapAsync(
        GPUMapMode.READ,
        0,
        phaseCount * 2 * BigUint64Array.BYTES_PER_ELEMENT,
      );
      const copy = timestampReadbackBuffer
        .getMappedRange(0, phaseCount * 2 * BigUint64Array.BYTES_PER_ELEMENT)
        .slice(0);
      timestampReadbackBuffer.unmap();
      const timestamps = new BigUint64Array(copy);
      const countMs = phaseCount === 4 ? intervalMs(timestamps, 0, 1) : null;
      const prefixScanMs = phaseCount === 4 ? intervalMs(timestamps, 2, 3) : null;
      const emitMs = phaseCount === 4 ? intervalMs(timestamps, 4, 5) : null;
      const drawOffset = phaseCount === 4 ? 6 : 0;
      const drawMs = intervalMs(timestamps, drawOffset, drawOffset + 1);
      return {
        timing: {
          supported: true,
          captured: drawMs !== null
            && (phaseCount === 1 || (countMs !== null && prefixScanMs !== null && emitMs !== null)),
          countMs,
          prefixScanMs,
          emitMs,
          drawMs,
          firstToLastMs: intervalMs(timestamps, 0, phaseCount * 2 - 1),
        },
        readbackMs: performance.now() - startedAt,
      };
    } catch {
      if (timestampReadbackBuffer.mapState === "mapped") timestampReadbackBuffer.unmap();
      return {
        timing: emptyGpuTiming(true),
        readbackMs: performance.now() - startedAt,
      };
    }
  }

  async #readSmallResult(): Promise<{
    segmentCount: number;
    vertexCount: number;
    indirectArgs: readonly [number, number, number, number];
  }> {
    const buffer = this.#resources.smallReadbackBuffer;
    await buffer.mapAsync(GPUMapMode.READ, 0, SMALL_READBACK_BYTES);
    const copy = buffer.getMappedRange(0, SMALL_READBACK_BYTES).slice(0);
    buffer.unmap();
    const totals = new Uint32Array(copy, 0, TOTAL_BYTES / Uint32Array.BYTES_PER_ELEMENT);
    const args = new Uint32Array(
      copy,
      32,
      INDIRECT_ARGUMENT_BYTES / Uint32Array.BYTES_PER_ELEMENT,
    );
    return {
      segmentCount: totals[0],
      vertexCount: totals[1],
      indirectArgs: [args[0], args[1], args[2], args[3]],
    };
  }

  async run(
    elements: readonly VectorStrokeGpuProbeElement[],
    options: VectorStrokeGpuProbeRunOptions = {},
  ): Promise<VectorStrokeGpuProbeRunResult> {
    this.#beginOperation();
    const operationStartedAt = performance.now();
    try {
      if (elements.length > this.maximumElements) {
        throw new Error(
          `The probe accepts at most ${this.maximumElements} elements per run.`,
        );
      }
      const bounds = validatedBounds(options.viewBounds);
      const packingStartedAt = performance.now();
      const packedElements = packElements(elements);
      const inputPackingMs = performance.now() - packingStartedAt;
      const encodingStartedAt = performance.now();
      if (packedElements.byteLength > 0) {
        this.#device.queue.writeBuffer(this.#resources.elementBuffer, 0, packedElements);
      }
      this.#device.queue.writeBuffer(
        this.#resources.parameterBuffer,
        0,
        parameterPayload(elements.length, this.maximumSegmentsPerElement, bounds),
      );
      const encoder = this.#device.createCommandEncoder({
        label: "Vector stroke probe compute and draw",
      });
      const countTimestampWrites = passTimestampWrites(this.#resources.timestampQuerySet, 0);
      const countPass = encoder.beginComputePass({
        label: "Vector stroke probe adaptive count",
        ...(countTimestampWrites ? { timestampWrites: countTimestampWrites } : {}),
      });
      countPass.setPipeline(this.#resources.countPipeline);
      countPass.setBindGroup(0, this.#resources.countBindGroup);
      countPass.dispatchWorkgroups(Math.max(1, Math.ceil(elements.length / 64)));
      countPass.end();

      const scanTimestampWrites = passTimestampWrites(this.#resources.timestampQuerySet, 2);
      const scanPass = encoder.beginComputePass({
        label: "Vector stroke probe conservative serial prefix scan",
        ...(scanTimestampWrites ? { timestampWrites: scanTimestampWrites } : {}),
      });
      scanPass.setPipeline(this.#resources.scanPipeline);
      scanPass.setBindGroup(0, this.#resources.scanBindGroup);
      scanPass.dispatchWorkgroups(1);
      scanPass.end();

      const emitTimestampWrites = passTimestampWrites(this.#resources.timestampQuerySet, 4);
      const emitPass = encoder.beginComputePass({
        label: "Vector stroke probe triangle emission",
        ...(emitTimestampWrites ? { timestampWrites: emitTimestampWrites } : {}),
      });
      emitPass.setPipeline(this.#resources.emitPipeline);
      emitPass.setBindGroup(0, this.#resources.emitBindGroup);
      emitPass.dispatchWorkgroups(Math.max(1, Math.ceil(elements.length / 64)));
      emitPass.end();

      this.#encodeDraw(encoder, options.clearColor, 6);
      encoder.copyBufferToBuffer(
        this.#resources.totalBuffer,
        0,
        this.#resources.smallReadbackBuffer,
        0,
        TOTAL_BYTES,
      );
      encoder.copyBufferToBuffer(
        this.#resources.indirectBuffer,
        0,
        this.#resources.smallReadbackBuffer,
        32,
        INDIRECT_ARGUMENT_BYTES,
      );
      this.#encodeTimestampResolve(encoder, TIMESTAMP_QUERY_COUNT);
      this.#device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      const cpuEncodeMs = submittedAt - encodingStartedAt;
      await this.#device.queue.onSubmittedWorkDone();
      const completedAt = performance.now();
      const [smallResult, timestampResult] = await Promise.all([
        this.#readSmallResult(),
        this.#readTimestampTiming(4),
      ]);
      this.#lastElementCount = elements.length;
      this.#lastVertexCount = smallResult.vertexCount;
      this.#lastIndirectArgs = smallResult.indirectArgs;
      this.#hasRun = true;
      return {
        strategy: VECTOR_STROKE_GPU_PROBE_STRATEGY,
        elementCount: elements.length,
        segmentCount: smallResult.segmentCount,
        vertexCount: smallResult.vertexCount,
        indirectArgs: smallResult.indirectArgs,
        meaningfulBufferBytes: {
          elements: packedElements.byteLength,
          segmentCounts: elements.length * Uint32Array.BYTES_PER_ELEMENT,
          vertexOffsets: elements.length * Uint32Array.BYTES_PER_ELEMENT,
          vertices: smallResult.vertexCount * VERTEX_BYTES,
          indirectArgs: INDIRECT_ARGUMENT_BYTES,
        },
        metrics: {
          initializationMs: this.initializationMs,
          inputPackingMs,
          cpuEncodeMs,
          queueWallMs: completedAt - submittedAt,
          totalWallMs: completedAt - operationStartedAt,
          timestampReadbackMs: timestampResult.readbackMs,
          gpu: timestampResult.timing,
        },
      };
    } finally {
      this.#busy = false;
    }
  }

  async render(
    options: VectorStrokeGpuProbeRunOptions = {},
  ): Promise<VectorStrokeGpuProbeRenderResult> {
    this.#beginOperation();
    const operationStartedAt = performance.now();
    try {
      if (!this.#hasRun) throw new Error("Run the probe before reusing its geometry.");
      const bounds = validatedBounds(options.viewBounds);
      const encodingStartedAt = performance.now();
      this.#device.queue.writeBuffer(
        this.#resources.parameterBuffer,
        0,
        parameterPayload(this.#lastElementCount, this.maximumSegmentsPerElement, bounds),
      );
      const encoder = this.#device.createCommandEncoder({
        label: "Vector stroke probe reused-geometry draw",
      });
      this.#encodeDraw(encoder, options.clearColor, 0);
      this.#encodeTimestampResolve(encoder, 2);
      this.#device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      const cpuEncodeMs = submittedAt - encodingStartedAt;
      await this.#device.queue.onSubmittedWorkDone();
      const completedAt = performance.now();
      const timestampResult = await this.#readTimestampTiming(1);
      return {
        vertexCount: this.#lastVertexCount,
        indirectArgs: this.#lastIndirectArgs,
        metrics: {
          initializationMs: this.initializationMs,
          inputPackingMs: 0,
          cpuEncodeMs,
          queueWallMs: completedAt - submittedAt,
          totalWallMs: completedAt - operationStartedAt,
          timestampReadbackMs: timestampResult.readbackMs,
          gpu: timestampResult.timing,
        },
      };
    } finally {
      this.#busy = false;
    }
  }

  async readback(): Promise<VectorStrokeGpuProbeReadback> {
    this.#beginOperation();
    try {
      if (!this.#hasRun) throw new Error("Run the probe before reading its geometry.");
      const countBytes = this.#lastElementCount * Uint32Array.BYTES_PER_ELEMENT;
      const vertexBytes = this.#lastVertexCount * VERTEX_BYTES;
      const countOffset = 0;
      const vertexOffsetOffset = align4(countOffset + countBytes);
      const vertexOffset = align4(vertexOffsetOffset + countBytes);
      const indirectOffset = align4(vertexOffset + vertexBytes);
      const readbackBytes = Math.max(4, indirectOffset + INDIRECT_ARGUMENT_BYTES);
      const readbackBuffer = this.#device.createBuffer({
        label: "Vector stroke probe geometry readback",
        size: checkedBufferSize(this.#device, readbackBytes, "Probe geometry readback"),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      try {
        const encoder = this.#device.createCommandEncoder({
          label: "Vector stroke probe geometry copy",
        });
        if (countBytes > 0) {
          encoder.copyBufferToBuffer(
            this.#resources.segmentCountBuffer,
            0,
            readbackBuffer,
            countOffset,
            countBytes,
          );
          encoder.copyBufferToBuffer(
            this.#resources.vertexOffsetBuffer,
            0,
            readbackBuffer,
            vertexOffsetOffset,
            countBytes,
          );
        }
        if (vertexBytes > 0) {
          encoder.copyBufferToBuffer(
            this.#resources.vertexBuffer,
            0,
            readbackBuffer,
            vertexOffset,
            vertexBytes,
          );
        }
        encoder.copyBufferToBuffer(
          this.#resources.indirectBuffer,
          0,
          readbackBuffer,
          indirectOffset,
          INDIRECT_ARGUMENT_BYTES,
        );
        this.#device.queue.submit([encoder.finish()]);
        await this.#device.queue.onSubmittedWorkDone();
        await readbackBuffer.mapAsync(GPUMapMode.READ, 0, readbackBytes);
        const mapped = readbackBuffer.getMappedRange(0, readbackBytes);
        const segmentCounts = new Uint32Array(mapped.slice(countOffset, countOffset + countBytes));
        const vertexOffsets = new Uint32Array(
          mapped.slice(vertexOffsetOffset, vertexOffsetOffset + countBytes),
        );
        const vertices = new Float32Array(mapped.slice(vertexOffset, vertexOffset + vertexBytes));
        const indirectArgs = new Uint32Array(
          mapped.slice(indirectOffset, indirectOffset + INDIRECT_ARGUMENT_BYTES),
        );
        readbackBuffer.unmap();
        return { segmentCounts, vertexOffsets, vertices, indirectArgs };
      } finally {
        if (readbackBuffer.mapState === "mapped") readbackBuffer.unmap();
        readbackBuffer.destroy();
      }
    } finally {
      this.#busy = false;
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    if (this.#busy) throw new Error("Cannot destroy the vector stroke GPU probe while it is running.");
    this.#destroyed = true;
    const resources = this.#resources;
    resources.elementBuffer.destroy();
    resources.segmentCountBuffer.destroy();
    resources.vertexOffsetBuffer.destroy();
    resources.vertexBuffer.destroy();
    resources.parameterBuffer.destroy();
    resources.totalBuffer.destroy();
    resources.indirectBuffer.destroy();
    resources.smallReadbackBuffer.destroy();
    resources.targetTexture.destroy();
    resources.timestampQuerySet?.destroy();
    resources.timestampResolveBuffer?.destroy();
    resources.timestampReadbackBuffer?.destroy();
  }
}

export async function createVectorStrokeGpuProbe(
  device: GPUDevice,
  options: VectorStrokeGpuProbeOptions = {},
): Promise<VectorStrokeGpuProbe> {
  const startedAt = performance.now();
  const targetWidth = positiveInteger(options.targetWidth, DEFAULT_TARGET_SIZE, "Target width");
  const targetHeight = positiveInteger(options.targetHeight, DEFAULT_TARGET_SIZE, "Target height");
  if (
    targetWidth > device.limits.maxTextureDimension2D
    || targetHeight > device.limits.maxTextureDimension2D
  ) {
    throw new Error("Probe target dimensions exceed the GPU texture limit.");
  }
  const maximumElements = positiveInteger(
    options.maximumElements,
    DEFAULT_MAXIMUM_ELEMENTS,
    "Maximum element count",
  );
  const requestedMaximumSegments = positiveInteger(
    options.maximumSegmentsPerElement,
    DEFAULT_MAXIMUM_SEGMENTS_PER_ELEMENT,
    "Maximum segments per element",
  );
  const maximumSegmentsPerElement = Math.min(
    DEFAULT_MAXIMUM_SEGMENTS_PER_ELEMENT,
    requestedMaximumSegments,
  );
  const targetFormat = options.targetFormat ?? "rgba8unorm";
  const configuration: ProbeConfiguration = {
    targetWidth,
    targetHeight,
    targetFormat,
    maximumElements,
    maximumSegmentsPerElement,
  };

  const allocated: Array<{ destroy(): void }> = [];
  try {
    const elementBuffer = storageBuffer(
      device,
      "Vector stroke probe elements",
      maximumElements * ELEMENT_BYTES,
      GPUBufferUsage.COPY_DST,
    );
    allocated.push(elementBuffer);
    const segmentCountBuffer = storageBuffer(
      device,
      "Vector stroke probe segment counts",
      maximumElements * Uint32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.COPY_SRC,
    );
    allocated.push(segmentCountBuffer);
    const vertexOffsetBuffer = storageBuffer(
      device,
      "Vector stroke probe vertex offsets",
      maximumElements * Uint32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.COPY_SRC,
    );
    allocated.push(vertexOffsetBuffer);
    const vertexBufferSize = maximumElements
      * maximumSegmentsPerElement
      * VERTICES_PER_SEGMENT
      * VERTEX_BYTES;
    const vertexBuffer = storageBuffer(
      device,
      "Vector stroke probe triangle vertices",
      vertexBufferSize,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    );
    allocated.push(vertexBuffer);
    const parameterBuffer = device.createBuffer({
      label: "Vector stroke probe parameters",
      size: PARAMETER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    allocated.push(parameterBuffer);
    const totalBuffer = storageBuffer(
      device,
      "Vector stroke probe totals",
      TOTAL_BYTES,
      GPUBufferUsage.COPY_SRC,
    );
    allocated.push(totalBuffer);
    const indirectBuffer = storageBuffer(
      device,
      "Vector stroke probe indirect arguments",
      INDIRECT_ARGUMENT_BYTES,
      GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
    );
    allocated.push(indirectBuffer);
    const smallReadbackBuffer = device.createBuffer({
      label: "Vector stroke probe totals readback",
      size: SMALL_READBACK_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    allocated.push(smallReadbackBuffer);
    const targetTexture = device.createTexture({
      label: "Vector stroke probe render target",
      size: { width: targetWidth, height: targetHeight },
      format: targetFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    allocated.push(targetTexture);
    const targetView = targetTexture.createView();

    let timestampQuerySet: GPUQuerySet | null = null;
    let timestampResolveBuffer: GPUBuffer | null = null;
    let timestampReadbackBuffer: GPUBuffer | null = null;
    if (device.features.has("timestamp-query")) {
      try {
        timestampQuerySet = device.createQuerySet({
          label: "Vector stroke probe timestamps",
          type: "timestamp",
          count: TIMESTAMP_QUERY_COUNT,
        });
        timestampResolveBuffer = device.createBuffer({
          label: "Vector stroke probe timestamp resolve",
          size: TIMESTAMP_RESOLVE_BYTES,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        timestampReadbackBuffer = device.createBuffer({
          label: "Vector stroke probe timestamp readback",
          size: TIMESTAMP_RESOLVE_BYTES,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        allocated.push(timestampQuerySet, timestampResolveBuffer, timestampReadbackBuffer);
      } catch {
        timestampQuerySet?.destroy();
        timestampResolveBuffer?.destroy();
        timestampReadbackBuffer?.destroy();
        timestampQuerySet = null;
        timestampResolveBuffer = null;
        timestampReadbackBuffer = null;
      }
    }

    const countModule = device.createShaderModule({
      label: "Vector stroke probe adaptive-count shader",
      code: countShader,
    });
    const scanModule = device.createShaderModule({
      label: "Vector stroke probe prefix-scan shader",
      code: scanShader,
    });
    const emitModule = device.createShaderModule({
      label: "Vector stroke probe triangle-emission shader",
      code: emitShader,
    });
    const renderModule = device.createShaderModule({
      label: "Vector stroke probe indirect-render shader",
      code: renderShader,
    });
    const [countPipeline, scanPipeline, emitPipeline, renderPipeline] = await Promise.all([
      device.createComputePipelineAsync({
        label: "Vector stroke probe adaptive-count pipeline",
        layout: "auto",
        compute: { module: countModule, entryPoint: "countMain" },
      }),
      device.createComputePipelineAsync({
        label: "Vector stroke probe serial-prefix pipeline",
        layout: "auto",
        compute: { module: scanModule, entryPoint: "scanMain" },
      }),
      device.createComputePipelineAsync({
        label: "Vector stroke probe triangle-emission pipeline",
        layout: "auto",
        compute: { module: emitModule, entryPoint: "emitMain" },
      }),
      device.createRenderPipelineAsync({
        label: "Vector stroke probe indirect-render pipeline",
        layout: "auto",
        vertex: {
          module: renderModule,
          entryPoint: "vertexMain",
          buffers: [{
            arrayStride: VERTEX_BYTES,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
          }],
        },
        fragment: {
          module: renderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: targetFormat }],
        },
        primitive: { topology: "triangle-list" },
      }),
    ]);
    const countBindGroup = device.createBindGroup({
      label: "Vector stroke probe adaptive-count bindings",
      layout: countPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: elementBuffer } },
        { binding: 1, resource: { buffer: segmentCountBuffer } },
        { binding: 2, resource: { buffer: parameterBuffer } },
      ],
    });
    const scanBindGroup = device.createBindGroup({
      label: "Vector stroke probe prefix-scan bindings",
      layout: scanPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: segmentCountBuffer } },
        { binding: 1, resource: { buffer: vertexOffsetBuffer } },
        { binding: 2, resource: { buffer: totalBuffer } },
        { binding: 3, resource: { buffer: indirectBuffer } },
        { binding: 4, resource: { buffer: parameterBuffer } },
      ],
    });
    const emitBindGroup = device.createBindGroup({
      label: "Vector stroke probe triangle-emission bindings",
      layout: emitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: elementBuffer } },
        { binding: 1, resource: { buffer: segmentCountBuffer } },
        { binding: 2, resource: { buffer: vertexOffsetBuffer } },
        { binding: 3, resource: { buffer: vertexBuffer } },
        { binding: 4, resource: { buffer: parameterBuffer } },
      ],
    });
    const renderBindGroup = device.createBindGroup({
      label: "Vector stroke probe indirect-render bindings",
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: parameterBuffer } }],
    });
    const resources: ProbeResources = {
      elementBuffer,
      segmentCountBuffer,
      vertexOffsetBuffer,
      vertexBuffer,
      parameterBuffer,
      totalBuffer,
      indirectBuffer,
      smallReadbackBuffer,
      targetTexture,
      targetView,
      countPipeline,
      scanPipeline,
      emitPipeline,
      renderPipeline,
      countBindGroup,
      scanBindGroup,
      emitBindGroup,
      renderBindGroup,
      timestampQuerySet,
      timestampResolveBuffer,
      timestampReadbackBuffer,
    };
    return new VectorStrokeGpuProbeImplementation(
      device,
      configuration,
      resources,
      performance.now() - startedAt,
    );
  } catch (error) {
    for (const resource of [...allocated].reverse()) resource.destroy();
    throw error;
  }
}
