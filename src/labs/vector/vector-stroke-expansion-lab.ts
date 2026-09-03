import { createVectorGeometryKernel } from "../../../wasm/vector-geometry-kernel/runtime.mjs";
import type { Shadow3dPathData } from "../../vector-shadow-3d";
import {
  compileDirectVectorSvgStrokeMesh,
  DIRECT_VECTOR_SVG_STROKE_STRATEGY,
  type DirectVectorSvgStrokeCompileMetrics,
} from "../../vector-svg-stroke-direct";
import {
  expandVectorSvgStrokePaint,
  VECTOR_SVG_STATIC_STROKE_TOLERANCE,
  type Matrix,
  type VectorSvgStroke,
  type VectorSvgStrokeExpansionQuality,
} from "../../vector-svg-import";
import type { VectorTextGpuMeshData } from "../../vector-text-effect-geometry";
import {
  vectorTextLodForSigma,
  type VectorTextLod,
} from "../../vector-text-lod";
import {
  createVectorStrokeGpuProbe,
  VECTOR_STROKE_GPU_PROBE_STRATEGY,
  type VectorStrokeGpuProbeElement,
  type VectorStrokeGpuProbeReadback,
  type VectorStrokeGpuProbeRenderResult,
  type VectorStrokeGpuProbeRunResult,
} from "./vector-stroke-gpu-probe";

const REPORT_VERSION = 1;
const TARGET_SIZE = 512;
const WARMUP_RUNS = 2;
const MEASURED_RUNS = 7;
const WIDTH_SWEEP = [1, 2.09, 4, 16, 64] as const;
const ZOOM_ASCENDING = [0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8] as const;
const ZOOM_SEQUENCE = [
  ...ZOOM_ASCENDING,
  4,
  2,
  1,
  0.5,
  0.25,
  0.125,
  0.0625,
] as const;
const ZOOM_CORRECTNESS_SCALES = [0.125, 1, 8] as const;
const BASELINE_READY_CACHE_CAPACITY = 48;
const BASELINE_LODS_PER_IDENTITY = 3;
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
const STROKE_WIDTH = 2.09;
const DEFAULT_COMPLEX_CURVE_COUNT = 512;
const MINIMUM_COMPLEX_CURVE_COUNT = 64;
const MAXIMUM_COMPLEX_CURVE_COUNT = 2_048;
const TARGET_FORMAT: GPUTextureFormat = "rgba8unorm";

type Backend = "polygon-offset" | "direct-mesh";
type CorrectnessBackend = Backend | "gpu-count-scan-emit";
type VectorGeometryKernel = Awaited<ReturnType<typeof createVectorGeometryKernel>>;

type CoreElement = VectorStrokeGpuProbeElement;

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface StrokeFixture {
  readonly id: "simple-line" | "complex-cubics";
  readonly label: string;
  readonly strokes: readonly VectorSvgStroke[];
  readonly elements: readonly CoreElement[];
  readonly sourceBounds: Bounds;
  readonly sourceVerbCount: number;
  readonly curveCount: number;
}

interface GpuArchitectureSummary {
  readonly inputPacking: TimingSummary;
  readonly cpuEncode: TimingSummary;
  readonly queueWall: TimingSummary;
  readonly total: TimingSummary;
  readonly gpuFirstToLast: TimingSummary | null;
  readonly medianSegmentCount: number;
  readonly medianVertexCount: number;
  readonly medianMeaningfulBufferBytes: number;
  readonly raw: readonly VectorStrokeGpuProbeRunResult[];
}

interface GeometryBuild {
  readonly backend: Backend;
  readonly mesh: VectorTextGpuMeshData;
  readonly geometryMs: number;
  readonly outlineExpansionMs: number | null;
  readonly canonicalizationAndTriangulationMs: number | null;
  readonly directMetrics: DirectVectorSvgStrokeCompileMetrics | null;
}

interface GpuMeshBuffers {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly originX: number;
  readonly originY: number;
  readonly allocatedBytes: number;
}

interface RenderTiming {
  readonly cpuSetupAndEncodeMs: number;
  readonly queueCompletionMs: number;
  readonly totalMs: number;
}

interface InternalRunSample {
  readonly report: RunSample;
  readonly mesh: VectorTextGpuMeshData;
}

interface RunSample {
  readonly backend: Backend;
  readonly geometryMs: number;
  readonly outlineExpansionMs: number | null;
  readonly canonicalizationAndTriangulationMs: number | null;
  readonly gpuBufferUploadAndCompletionMs: number;
  readonly gpuSetupAndEncodeMs: number;
  readonly queueCompletionMs: number;
  readonly totalMs: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly geometryBytes: number;
  readonly directMetrics: DirectVectorSvgStrokeCompileMetrics | null;
}

interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly samplesMs: readonly number[];
}

interface RunSummary {
  readonly geometry: TimingSummary;
  readonly gpuBufferUploadAndCompletion: TimingSummary;
  readonly gpuSetupAndEncode: TimingSummary;
  readonly queueCompletion: TimingSummary;
  readonly total: TimingSummary;
  readonly medianVertexCount: number;
  readonly medianTriangleCount: number;
  readonly medianGeometryBytes: number;
  readonly raw: readonly RunSample[];
}

interface PixelParity {
  readonly intersectionPixels: number;
  readonly unionPixels: number;
  readonly symmetricDifferencePixels: number;
  readonly intersectionOverUnion: number;
}

interface VisualCapture {
  readonly fixture: StrokeFixture["id"];
  readonly backend: "current" | "direct-cpu" | "gpu-architecture";
  readonly rgba: Uint8Array;
}

interface PresentationRow {
  readonly label: string;
  readonly coldMs: readonly [number, number, number];
  readonly warmMs: readonly [number, number, number];
  readonly warmSavedPercent: readonly [number, number];
  readonly zoomMs: readonly [number, number, number];
  readonly zoomSavedPercent: readonly [number, number];
}

interface PresentationContext {
  readonly complexCurveCount: number;
  readonly initialization: {
    readonly commonMeshRendererMs: number;
    readonly polygonOffsetWasmKernelMs: number;
    readonly gpuArchitectureProbeMs: number;
  };
}

interface LabRenderer {
  readonly initializationMs: number;
  createBuffers(mesh: VectorTextGpuMeshData): GpuMeshBuffers;
  render(
    buffers: GpuMeshBuffers,
    bounds: Bounds,
    zoom?: number,
    capture?: boolean,
  ): Promise<{ readonly timing: RenderTiming; readonly rgba: Uint8Array | null }>;
  destroyBuffers(buffers: GpuMeshBuffers): void;
  destroy(): void;
}

function requestedComplexCurveCount(): number {
  const requested = new URLSearchParams(window.location.search).get("strokeCurves");
  if (requested === null) return DEFAULT_COMPLEX_CURVE_COUNT;
  const value = Number(requested);
  return Number.isSafeInteger(value)
    ? Math.max(MINIMUM_COMPLEX_CURVE_COUNT, Math.min(MAXIMUM_COMPLEX_CURVE_COUNT, value))
    : DEFAULT_COMPLEX_CURVE_COUNT;
}

function makePath(
  verbs: readonly number[],
  coords: readonly number[],
  contourOffsets: readonly number[],
): Shadow3dPathData {
  return {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule: 0,
  };
}

function strokeForPath(path: Shadow3dPathData, width: number): VectorSvgStroke {
  return {
    sourcePath: path,
    transform: IDENTITY_MATRIX,
    width,
    linecap: "butt",
    linejoin: "miter",
    miterLimit: 4,
    dashArray: [],
    dashOffset: 0,
  };
}

function createSimpleFixture(width = STROKE_WIDTH): StrokeFixture {
  const p0 = { x: 64, y: 256 };
  const p1 = { x: 448, y: 256 };
  return {
    id: "simple-line",
    label: `Straight line · ${width}px`,
    strokes: [strokeForPath(makePath([0, 1], [p0.x, p0.y, p1.x, p1.y], [0]), width)],
    elements: [{ kind: "line", p0, p1, halfWidth: width * 0.5 }],
    sourceBounds: {
      left: p0.x - width,
      top: p0.y - width,
      right: p1.x + width,
      bottom: p1.y + width,
    },
    sourceVerbCount: 2,
    curveCount: 0,
  };
}

function createComplexFixture(curveCount: number): StrokeFixture {
  const columns = 32;
  const cellWidth = 42;
  const cellHeight = 42;
  const verbs: number[] = [];
  const coords: number[] = [];
  const contourOffsets: number[] = [];
  const elements: VectorStrokeGpuProbeElement[] = [];
  for (let index = 0; index < curveCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    const direction = index % 2 === 0 ? 1 : -1;
    const p0 = { x: x + 4, y: y + cellHeight * 0.5 };
    const p1 = { x: x + 13, y: y + cellHeight * 0.5 + 14 * direction };
    const p2 = { x: x + 29, y: y + cellHeight * 0.5 - 14 * direction };
    const p3 = { x: x + 38, y: y + cellHeight * 0.5 };
    contourOffsets.push(verbs.length);
    verbs.push(0, 3);
    coords.push(
      p0.x,
      p0.y,
      p1.x,
      p1.y,
      p2.x,
      p2.y,
      p3.x,
      p3.y,
    );
    elements.push({
      kind: "cubic",
      p0,
      p1,
      p2,
      p3,
      halfWidth: STROKE_WIDTH * 0.5,
    });
  }
  const rows = Math.ceil(curveCount / columns);
  const path = makePath(verbs, coords, contourOffsets);
  return {
    id: "complex-cubics",
    label: `${curveCount} independent cubic centerlines`,
    strokes: [strokeForPath(path, STROKE_WIDTH)],
    elements,
    sourceBounds: {
      left: 0,
      top: 0,
      right: columns * cellWidth,
      bottom: rows * cellHeight,
    },
    sourceVerbCount: verbs.length,
    curveCount,
  };
}

function directQuality(strokes: readonly VectorSvgStroke[]): VectorSvgStrokeExpansionQuality {
  let tolerance = 0.25;
  for (const stroke of strokes) {
    tolerance = Math.min(tolerance, Math.abs(stroke.width * 0.5) / 32);
  }
  tolerance = Math.max(1e-5, tolerance);
  return {
    centerlineTolerance: tolerance,
    roundArcSagittaTolerance: tolerance,
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function timingSummary(values: readonly number[]): TimingSummary {
  return {
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minimumMs: Math.min(...values),
    maximumMs: Math.max(...values),
    samplesMs: values,
  };
}

function runSummary(samples: readonly RunSample[]): RunSummary {
  return {
    geometry: timingSummary(samples.map((sample) => sample.geometryMs)),
    gpuBufferUploadAndCompletion: timingSummary(
      samples.map((sample) => sample.gpuBufferUploadAndCompletionMs),
    ),
    gpuSetupAndEncode: timingSummary(
      samples.map((sample) => sample.gpuSetupAndEncodeMs),
    ),
    queueCompletion: timingSummary(samples.map((sample) => sample.queueCompletionMs)),
    total: timingSummary(samples.map((sample) => sample.totalMs)),
    medianVertexCount: percentile(samples.map((sample) => sample.vertexCount), 0.5),
    medianTriangleCount: percentile(samples.map((sample) => sample.triangleCount), 0.5),
    medianGeometryBytes: percentile(samples.map((sample) => sample.geometryBytes), 0.5),
    raw: samples,
  };
}

function meaningfulGpuBufferBytes(sample: VectorStrokeGpuProbeRunResult): number {
  return Object.values(sample.meaningfulBufferBytes).reduce(
    (total, value) => total + value,
    0,
  );
}

function gpuArchitectureSummary(
  samples: readonly VectorStrokeGpuProbeRunResult[],
): GpuArchitectureSummary {
  const capturedGpuTimes = samples
    .map((sample) => sample.metrics.gpu.firstToLastMs)
    .filter((value): value is number => value !== null);
  return {
    inputPacking: timingSummary(samples.map((sample) => sample.metrics.inputPackingMs)),
    cpuEncode: timingSummary(samples.map((sample) => sample.metrics.cpuEncodeMs)),
    queueWall: timingSummary(samples.map((sample) => sample.metrics.queueWallMs)),
    total: timingSummary(samples.map((sample) => sample.metrics.totalWallMs)),
    gpuFirstToLast: capturedGpuTimes.length > 0
      ? timingSummary(capturedGpuTimes)
      : null,
    medianSegmentCount: percentile(
      samples.map((sample) => sample.segmentCount),
      0.5,
    ),
    medianVertexCount: percentile(samples.map((sample) => sample.vertexCount), 0.5),
    medianMeaningfulBufferBytes: percentile(
      samples.map(meaningfulGpuBufferBytes),
      0.5,
    ),
    raw: samples,
  };
}

function comparison(before: TimingSummary, after: TimingSummary): Record<string, number | null> {
  return {
    medianMsSaved: before.medianMs - after.medianMs,
    medianSavedPercent: before.medianMs > 0
      ? (before.medianMs - after.medianMs) / before.medianMs * 100
      : null,
    medianSpeedup: after.medianMs > 0 ? before.medianMs / after.medianMs : null,
    p95MsSaved: before.p95Ms - after.p95Ms,
  };
}

function meshTriangleArea(mesh: VectorTextGpuMeshData): number {
  let area = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 2;
    const b = mesh.indices[offset + 1] * 2;
    const c = mesh.indices[offset + 2] * 2;
    area += Math.abs(
      (mesh.vertices[b] - mesh.vertices[a])
        * (mesh.vertices[c + 1] - mesh.vertices[a + 1])
      - (mesh.vertices[b + 1] - mesh.vertices[a + 1])
        * (mesh.vertices[c] - mesh.vertices[a]),
    ) * 0.5;
  }
  return area;
}

function meshReport(mesh: VectorTextGpuMeshData): Record<string, unknown> {
  return {
    vertexCount: mesh.vertices.length / 2,
    triangleCount: mesh.indices.length / 3,
    vertexBytes: mesh.vertices.byteLength,
    indexBytes: mesh.indices.byteLength,
    totalBytes: mesh.vertices.byteLength + mesh.indices.byteLength,
    localBounds: {
      left: mesh.left,
      top: mesh.top,
      right: mesh.right,
      bottom: mesh.bottom,
      width: mesh.right - mesh.left,
      height: mesh.bottom - mesh.top,
    },
    origin: { x: mesh.originX, y: mesh.originY },
    absoluteBounds: absoluteMeshBounds(mesh),
    triangleArea: meshTriangleArea(mesh),
  };
}

function unionBounds(first: Bounds, second: Bounds): Bounds {
  return {
    left: Math.min(first.left, second.left),
    top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right),
    bottom: Math.max(first.bottom, second.bottom),
  };
}

function absoluteMeshBounds(mesh: VectorTextGpuMeshData): Bounds {
  return {
    left: mesh.left + mesh.originX,
    top: mesh.top + mesh.originY,
    right: mesh.right + mesh.originX,
    bottom: mesh.bottom + mesh.originY,
  };
}

function meshFromGpuReadback(
  readback: VectorStrokeGpuProbeReadback,
  revision: string,
): VectorTextGpuMeshData {
  if (readback.vertices.length === 0 || readback.vertices.length % 2 !== 0) {
    throw new Error("GPU stroke probe returned an empty or malformed vertex buffer.");
  }
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let offset = 0; offset < readback.vertices.length; offset += 2) {
    const x = readback.vertices[offset];
    const y = readback.vertices[offset + 1];
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const originX = (left + right) * 0.5;
  const originY = (top + bottom) * 0.5;
  const vertices = new Float32Array(readback.vertices.length);
  const indices = new Uint32Array(readback.vertices.length / 2);
  for (let offset = 0; offset < readback.vertices.length; offset += 2) {
    vertices[offset] = readback.vertices[offset] - originX;
    vertices[offset + 1] = readback.vertices[offset + 1] - originY;
    indices[offset / 2] = offset / 2;
  }
  return {
    revision,
    vertices,
    indices,
    left: left - originX,
    top: top - originY,
    right: right - originX,
    bottom: bottom - originY,
    originX,
    originY,
    lodBucket: 0,
    integerScale: 1,
  };
}

function gpuReadbackWitness(
  readback: VectorStrokeGpuProbeReadback,
  mesh: VectorTextGpuMeshData,
): Record<string, unknown> {
  let offsetsAreContiguous = readback.vertexOffsets.length === readback.segmentCounts.length;
  let expectedOffset = 0;
  for (let index = 0; index < readback.segmentCounts.length; index += 1) {
    offsetsAreContiguous = offsetsAreContiguous
      && readback.vertexOffsets[index] === expectedOffset;
    expectedOffset += readback.segmentCounts[index] * 6;
  }
  return {
    segmentCount: readback.segmentCounts.reduce((total, value) => total + value, 0),
    vertexCount: readback.vertices.length / 2,
    indirectArgs: [...readback.indirectArgs],
    offsetsAreContiguous,
    mesh: meshReport(mesh),
  };
}

function probeViewBounds(bounds: Bounds, scale = 1): Bounds {
  const centerX = (bounds.left + bounds.right) * 0.5;
  const centerY = (bounds.top + bounds.bottom) * 0.5;
  const maximumExtent = Math.max(
    bounds.right - bounds.left,
    bounds.bottom - bounds.top,
  );
  const halfExtent = maximumExtent / 1.8 / scale;
  return {
    left: centerX - halfExtent,
    top: centerY - halfExtent,
    right: centerX + halfExtent,
    bottom: centerY + halfExtent,
  };
}

function buildPolygonOffsetMesh(
  kernel: VectorGeometryKernel,
  strokes: readonly VectorSvgStroke[],
  quality: VectorSvgStrokeExpansionQuality,
  lod: VectorTextLod,
  revision: string,
): GeometryBuild {
  const startedAt = performance.now();
  const outlineStartedAt = performance.now();
  const path = expandVectorSvgStrokePaint(strokes, quality);
  const outlineExpansionMs = performance.now() - outlineStartedAt;
  const compilationStartedAt = performance.now();
  const result = kernel.compile(path, lod, { kind: "source-fill" }, revision);
  const canonicalizationAndTriangulationMs = performance.now() - compilationStartedAt;
  if (!result.mesh) throw new Error("Polygon-offset stroke expansion produced no mesh.");
  return {
    backend: "polygon-offset",
    mesh: result.mesh,
    geometryMs: performance.now() - startedAt,
    outlineExpansionMs,
    canonicalizationAndTriangulationMs,
    directMetrics: null,
  };
}

function buildPolygonOffsetMeshFromPath(
  kernel: VectorGeometryKernel,
  path: Shadow3dPathData,
  lod: VectorTextLod,
  revision: string,
): GeometryBuild {
  const startedAt = performance.now();
  const result = kernel.compile(path, lod, { kind: "source-fill" }, revision);
  const canonicalizationAndTriangulationMs = performance.now() - startedAt;
  if (!result.mesh) throw new Error("Polygon-offset stroke path produced no mesh.");
  return {
    backend: "polygon-offset",
    mesh: result.mesh,
    geometryMs: canonicalizationAndTriangulationMs,
    outlineExpansionMs: 0,
    canonicalizationAndTriangulationMs,
    directMetrics: null,
  };
}

function buildDirectMesh(
  strokes: readonly VectorSvgStroke[],
  quality: VectorSvgStrokeExpansionQuality,
  lod: VectorTextLod,
  revision: string,
): GeometryBuild {
  const startedAt = performance.now();
  const result = compileDirectVectorSvgStrokeMesh(strokes, quality, revision, {
    lodBucket: lod.bucket,
    integerScale: lod.integerScale,
  });
  if (!result.mesh) throw new Error("Direct stroke expansion produced no mesh.");
  return {
    backend: "direct-mesh",
    mesh: result.mesh,
    geometryMs: performance.now() - startedAt,
    outlineExpansionMs: null,
    canonicalizationAndTriangulationMs: null,
    directMetrics: result.metrics,
  };
}

async function createLabRenderer(device: GPUDevice): Promise<LabRenderer> {
  const startedAt = performance.now();
  const shader = device.createShaderModule({
    label: "Vector stroke expansion lab mesh shader",
    code: /* wgsl */ `
struct ViewUniforms {
  originAndCenter: vec4<f32>,
  scaleAndPadding: vec4<f32>,
};

@group(0) @binding(0) var<uniform> view: ViewUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@location(0) localPosition: vec2<f32>) -> VertexOutput {
  let world = localPosition + view.originAndCenter.xy;
  let centered = world - view.originAndCenter.zw;
  var output: VertexOutput;
  output.position = vec4<f32>(
    centered.x * view.scaleAndPadding.x,
    -centered.y * view.scaleAndPadding.x,
    0.0,
    1.0
  );
  return output;
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}
`,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: "Vector stroke expansion lab view layout",
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: { type: "uniform" },
    }],
  });
  const pipeline = await device.createRenderPipelineAsync({
    label: "Vector stroke expansion lab mesh pipeline",
    layout: device.createPipelineLayout({
      label: "Vector stroke expansion lab mesh pipeline layout",
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: shader,
      entryPoint: "vertexMain",
      buffers: [{
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
      }],
    },
    fragment: {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [{ format: TARGET_FORMAT }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
  const uniformBuffer = device.createBuffer({
    label: "Vector stroke expansion lab view uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    label: "Vector stroke expansion lab view bind group",
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });
  const target = device.createTexture({
    label: "Vector stroke expansion lab target",
    size: { width: TARGET_SIZE, height: TARGET_SIZE },
    format: TARGET_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const targetView = target.createView();
  const initializationMs = performance.now() - startedAt;

  const createBuffers = (mesh: VectorTextGpuMeshData): GpuMeshBuffers => {
    const vertexBuffer = device.createBuffer({
      label: "Vector stroke expansion lab vertices",
      size: Math.max(4, mesh.vertices.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const indexBuffer = device.createBuffer({
      label: "Vector stroke expansion lab indices",
      size: Math.max(4, mesh.indices.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
    device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
    return {
      vertexBuffer,
      indexBuffer,
      indexCount: mesh.indices.length,
      originX: mesh.originX,
      originY: mesh.originY,
      allocatedBytes: mesh.vertices.byteLength + mesh.indices.byteLength,
    };
  };

  const render = async (
    buffers: GpuMeshBuffers,
    bounds: Bounds,
    zoom = 1,
    capture = false,
  ): Promise<{ readonly timing: RenderTiming; readonly rgba: Uint8Array | null }> => {
    await device.queue.onSubmittedWorkDone();
    const startedAt = performance.now();
    const width = Math.max(1e-6, bounds.right - bounds.left);
    const height = Math.max(1e-6, bounds.bottom - bounds.top);
    const fitScale = 1.8 / Math.max(width, height);
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([
      buffers.originX,
      buffers.originY,
      (bounds.left + bounds.right) * 0.5,
      (bounds.top + bounds.bottom) * 0.5,
      fitScale * zoom,
      0,
      0,
      0,
    ]));
    const readback = capture
      ? device.createBuffer({
          label: "Vector stroke expansion lab capture",
          size: TARGET_SIZE * TARGET_SIZE * 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        })
      : null;
    const encoder = device.createCommandEncoder({
      label: "Vector stroke expansion lab render encoder",
    });
    const pass = encoder.beginRenderPass({
      label: "Vector stroke expansion lab render",
      colorAttachments: [{
        view: targetView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, buffers.vertexBuffer);
    pass.setIndexBuffer(buffers.indexBuffer, "uint32");
    pass.drawIndexed(buffers.indexCount);
    pass.end();
    if (readback) {
      encoder.copyTextureToBuffer(
        { texture: target },
        {
          buffer: readback,
          bytesPerRow: TARGET_SIZE * 4,
          rowsPerImage: TARGET_SIZE,
        },
        { width: TARGET_SIZE, height: TARGET_SIZE },
      );
    }
    device.queue.submit([encoder.finish()]);
    const submittedAt = performance.now();
    await device.queue.onSubmittedWorkDone();
    const completedAt = performance.now();
    let rgba: Uint8Array | null = null;
    if (readback) {
      await readback.mapAsync(GPUMapMode.READ);
      rgba = new Uint8Array(readback.getMappedRange().slice(0));
      readback.unmap();
      readback.destroy();
    }
    return {
      timing: {
        cpuSetupAndEncodeMs: submittedAt - startedAt,
        queueCompletionMs: completedAt - submittedAt,
        totalMs: completedAt - startedAt,
      },
      rgba,
    };
  };

  return {
    initializationMs,
    createBuffers,
    render,
    destroyBuffers: (buffers) => {
      buffers.vertexBuffer.destroy();
      buffers.indexBuffer.destroy();
    },
    destroy: () => {
      uniformBuffer.destroy();
      target.destroy();
    },
  };
}

async function executeBuildAndRender(
  device: GPUDevice,
  renderer: LabRenderer,
  build: () => GeometryBuild,
  bounds: Bounds,
): Promise<InternalRunSample> {
  await device.queue.onSubmittedWorkDone();
  const startedAt = performance.now();
  const geometry = build();
  const uploadStartedAt = performance.now();
  const buffers = renderer.createBuffers(geometry.mesh);
  try {
    await device.queue.onSubmittedWorkDone();
    const gpuBufferUploadAndCompletionMs = performance.now() - uploadStartedAt;
    const rendered = await renderer.render(buffers, bounds);
    const completedAt = performance.now();
    return {
      mesh: geometry.mesh,
      report: {
        backend: geometry.backend,
        geometryMs: geometry.geometryMs,
        outlineExpansionMs: geometry.outlineExpansionMs,
        canonicalizationAndTriangulationMs:
          geometry.canonicalizationAndTriangulationMs,
        gpuBufferUploadAndCompletionMs,
        gpuSetupAndEncodeMs: rendered.timing.cpuSetupAndEncodeMs,
        queueCompletionMs: rendered.timing.queueCompletionMs,
        totalMs: completedAt - startedAt,
        vertexCount: geometry.mesh.vertices.length / 2,
        triangleCount: geometry.mesh.indices.length / 3,
        geometryBytes: buffers.allocatedBytes,
        directMetrics: geometry.directMetrics,
      },
    };
  } finally {
    renderer.destroyBuffers(buffers);
  }
}

async function captureMesh(
  renderer: LabRenderer,
  mesh: VectorTextGpuMeshData,
  bounds: Bounds,
  zoom = 1,
): Promise<Uint8Array> {
  const buffers = renderer.createBuffers(mesh);
  try {
    const capture = await renderer.render(buffers, bounds, zoom, true);
    if (!capture.rgba) throw new Error("Vector stroke capture did not return pixels.");
    return capture.rgba;
  } finally {
    renderer.destroyBuffers(buffers);
  }
}

function pixelParity(first: Uint8Array, second: Uint8Array): PixelParity {
  if (first.length !== second.length) throw new Error("Stroke captures have different sizes.");
  let intersectionPixels = 0;
  let unionPixels = 0;
  let symmetricDifferencePixels = 0;
  for (let offset = 3; offset < first.length; offset += 4) {
    const firstCovered = first[offset] > 0;
    const secondCovered = second[offset] > 0;
    if (firstCovered && secondCovered) intersectionPixels += 1;
    if (firstCovered || secondCovered) unionPixels += 1;
    if (firstCovered !== secondCovered) symmetricDifferencePixels += 1;
  }
  return {
    intersectionPixels,
    unionPixels,
    symmetricDifferencePixels,
    intersectionOverUnion: unionPixels > 0 ? intersectionPixels / unionPixels : 1,
  };
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function formatSaving(value: number): string {
  return value >= 0
    ? `${value.toFixed(1)}% risparmiato`
    : `${Math.abs(value).toFixed(1)}% più lento`;
}

function appendTableCell(
  row: HTMLTableRowElement,
  value: string,
  header = false,
): void {
  const cell = document.createElement(header ? "th" : "td");
  cell.textContent = value;
  row.append(cell);
}

function captureCanvas(capture: VisualCapture): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The vector stroke lab preview needs a 2D canvas.");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(capture.rgba), TARGET_SIZE, TARGET_SIZE),
    0,
    0,
  );
  return canvas;
}

function renderLabPresentation(
  rows: readonly PresentationRow[],
  captures: readonly VisualCapture[],
  widths: readonly {
    readonly width: number;
    readonly current: number;
    readonly direct: number;
    readonly gpu: number;
  }[],
  context: PresentationContext,
): void {
  const existing = document.querySelector("[data-vector-stroke-lab-presentation]");
  if (existing instanceof HTMLDialogElement && existing.open) existing.close();
  existing?.remove();
  const previousFocus = document.activeElement instanceof HTMLElement
    && document.activeElement.isConnected
    ? document.activeElement
    : null;
  const panel = document.createElement("dialog");
  panel.className = "vector-stroke-lab-presentation";
  panel.dataset.vectorStrokeLabPresentation = "";
  panel.setAttribute("aria-labelledby", "vector-stroke-lab-results-title");

  const header = document.createElement("header");
  const headingGroup = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "vector-stroke-lab-kicker";
  kicker.textContent = `LAB COMPLETATO · ${context.complexCurveCount} CURVE`;
  const heading = document.createElement("h2");
  heading.id = "vector-stroke-lab-results-title";
  heading.textContent = "Stroke vettoriale · prima e dopo";
  headingGroup.append(kicker, heading);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Chiudi risultati";
  close.addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => {
    panel.remove();
    previousFocus?.focus({ preventScroll: true });
  }, { once: true });
  header.append(headingGroup, close);
  panel.append(header);

  const explanation = document.createElement("p");
  explanation.className = "vector-stroke-lab-intro";
  explanation.textContent =
    "h = larghezza / 2; i quattro angoli sono p0 ± n·h e p1 ± n·h. Nessun clamp a 1 px. Antialias e raster sono esclusi da questo confronto.";
  panel.append(explanation);

  const scope = document.createElement("p");
  scope.className = "vector-stroke-lab-notice";
  scope.textContent =
    `Probe isolato, non percorso di produzione. “Cache fredda” è la prima geometria non in cache dopo l'inizializzazione, non l'avvio del browser. “Warm rebuild” ricostruisce tutta la geometria. Il caso complesso isola ${context.complexCurveCount} cubiche indipendenti: join, cap, dash e copertura trasparente restano fuori dal timing GPU.`;
  panel.append(scope);

  const initialization = document.createElement("p");
  initialization.className = "vector-stroke-lab-initialization";
  initialization.textContent = [
    `Init renderer comune ${formatMilliseconds(context.initialization.commonMeshRendererMs)}`,
    `kernel attuale ${formatMilliseconds(context.initialization.polygonOffsetWasmKernelMs)}`,
    `probe GPU ${formatMilliseconds(context.initialization.gpuArchitectureProbeMs)}`,
  ].join(" · ");
  panel.append(initialization);

  const complex = rows.at(-1);
  if (complex) {
    const cards = document.createElement("div");
    cards.className = "vector-stroke-lab-cards";
    for (const [label, value] of [
      ["CPU diretto · warm rebuild", complex.warmSavedPercent[0]],
      ["Architettura GPU · warm rebuild", complex.warmSavedPercent[1]],
      ["CPU diretto · trace zoom", complex.zoomSavedPercent[0]],
      ["Architettura GPU · trace zoom", complex.zoomSavedPercent[1]],
    ] as const) {
      const card = document.createElement("article");
      const caption = document.createElement("span");
      caption.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = formatSaving(value);
      card.append(caption, strong);
      cards.append(card);
    }
    panel.append(cards);
  }

  const resultHeading = document.createElement("h3");
  resultHeading.textContent = "Tempi end-to-end · inizializzazione separata";
  panel.append(resultHeading);
  const tableScroll = document.createElement("div");
  tableScroll.className = "vector-stroke-lab-table-scroll";
  const table = document.createElement("table");
  const tableHead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const value of [
    "Geometria",
    "Cache fredda attuale",
    "Cache fredda CPU diretto",
    "Cache fredda GPU",
    "Warm rebuild attuale",
    "Warm rebuild CPU diretto",
    "Warm rebuild GPU",
    "Trace zoom attuale",
    "Trace zoom CPU diretto",
    "Trace zoom GPU",
  ]) appendTableCell(headRow, value, true);
  tableHead.append(headRow);
  const tableBody = document.createElement("tbody");
  for (const row of rows) {
    const bodyRow = document.createElement("tr");
    appendTableCell(bodyRow, row.label, true);
    for (const value of [...row.coldMs, ...row.warmMs, ...row.zoomMs]) {
      appendTableCell(bodyRow, formatMilliseconds(value));
    }
    tableBody.append(bodyRow);
  }
  table.append(tableHead, tableBody);
  tableScroll.append(table);
  panel.append(tableScroll);

  const widthHeading = document.createElement("h3");
  widthHeading.textContent = "Verifica geometrica della larghezza";
  panel.append(widthHeading);
  const widthList = document.createElement("p");
  widthList.className = "vector-stroke-lab-widths";
  widthList.textContent = widths.map((entry) => (
    `${entry.width}px → attuale ${entry.current.toFixed(5)}, CPU ${entry.direct.toFixed(5)}, GPU ${entry.gpu.toFixed(5)}`
  )).join("  ·  ");
  panel.append(widthList);

  const previewHeading = document.createElement("h3");
  previewHeading.textContent = "Output geometrico usato per la parità";
  panel.append(previewHeading);
  const previewGrid = document.createElement("div");
  previewGrid.className = "vector-stroke-lab-preview-grid";
  const backendLabels: Record<VisualCapture["backend"], string> = {
    current: "Attuale",
    "direct-cpu": "CPU diretto",
    "gpu-architecture": "GPU count/scan/emit",
  };
  for (const capture of captures) {
    const figure = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = `${capture.fixture === "simple-line" ? "Linea" : `${context.complexCurveCount} cubiche`} · ${backendLabels[capture.backend]}`;
    figure.append(caption, captureCanvas(capture));
    previewGrid.append(figure);
  }
  panel.append(previewGrid);
  document.body.append(panel);
  panel.showModal();
  close.focus({ preventScroll: true });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function fixtureReport(fixture: StrokeFixture): Record<string, unknown> {
  return {
    id: fixture.id,
    label: fixture.label,
    strokeCount: fixture.strokes.length,
    sourceVerbCount: fixture.sourceVerbCount,
    lineElementCount: fixture.elements.filter((element) => element.kind === "line").length,
    cubicElementCount: fixture.elements.filter((element) => element.kind === "cubic").length,
    curveCount: fixture.curveCount,
    width: fixture.strokes[0]?.width ?? 0,
    sourceBounds: fixture.sourceBounds,
  };
}

export async function runVectorStrokeExpansionLab(device: GPUDevice): Promise<unknown> {
  const existingPresentation = document.querySelector(
    "[data-vector-stroke-lab-presentation]",
  );
  if (existingPresentation instanceof HTMLDialogElement && existingPresentation.open) {
    existingPresentation.close();
  }
  existingPresentation?.remove();
  const fixtureStartedAt = performance.now();
  const simple = createSimpleFixture();
  const complex = createComplexFixture(requestedComplexCurveCount());
  const fixtures = [simple, complex] as const;
  const fixtureBuildMs = performance.now() - fixtureStartedAt;

  await device.queue.onSubmittedWorkDone();
  const renderer = await createLabRenderer(device);
  const kernelStartedAt = performance.now();
  const kernel = await createVectorGeometryKernel();
  const kernelInitializationMs = performance.now() - kernelStartedAt;
  const gpuProbe = await createVectorStrokeGpuProbe(device, {
    targetWidth: TARGET_SIZE,
    targetHeight: TARGET_SIZE,
    maximumElements: Math.max(1, complex.elements.length),
  });
  let revision = 0;
  const nextRevision = (label: string): string =>
    `vector-stroke-expansion-lab:${label}:${revision += 1}`;

  const buildFor = (
    backend: Backend,
    fixture: StrokeFixture,
    lod: VectorTextLod,
    label: string,
  ): GeometryBuild => backend === "polygon-offset"
    ? buildPolygonOffsetMesh(
        kernel,
        fixture.strokes,
        {
          centerlineTolerance: lod.polygonFlattenTolerance,
          roundArcSagittaTolerance: lod.roundArcSagittaTolerance,
        },
        lod,
        nextRevision(label),
      )
    : buildDirectMesh(
        fixture.strokes,
        directQuality(fixture.strokes),
        lod,
        nextRevision(label),
      );

  try {
    const cold: Record<string, unknown>[] = [];
    const coldMeshes = new Map<string, Map<CorrectnessBackend, VectorTextGpuMeshData>>();
    for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
      const fixture = fixtures[fixtureIndex];
      const fixtureMeshes = new Map<CorrectnessBackend, VectorTextGpuMeshData>();
      coldMeshes.set(fixture.id, fixtureMeshes);
      const order: readonly Backend[] = fixtureIndex % 2 === 0
        ? ["polygon-offset", "direct-mesh"]
        : ["direct-mesh", "polygon-offset"];
      const samples: Partial<Record<Backend, RunSample>> = {};
      for (const backend of order) {
        const result = await executeBuildAndRender(
          device,
          renderer,
          () => buildFor(backend, fixture, vectorTextLodForSigma(1), `cold:${fixture.id}`),
          fixture.sourceBounds,
        );
        samples[backend] = result.report;
        fixtureMeshes.set(backend, result.mesh);
      }
      const before = samples["polygon-offset"];
      const after = samples["direct-mesh"];
      if (!before || !after) throw new Error("Cold stroke comparison is incomplete.");
      const gpuArchitecture = await gpuProbe.run(fixture.elements, {
        viewBounds: probeViewBounds(fixture.sourceBounds),
      });
      const gpuReadback = await gpuProbe.readback();
      const gpuMesh = meshFromGpuReadback(
        gpuReadback,
        nextRevision(`cold-gpu:${fixture.id}`),
      );
      fixtureMeshes.set("gpu-count-scan-emit", gpuMesh);
      cold.push({
        fixture: fixtureReport(fixture),
        cacheColdAfterInitialization: true,
        containsFirstBackendInvocationInPage: fixtureIndex === 0,
        executionOrder: [...order, "gpu-count-scan-emit"],
        polygonOffset: before,
        directMesh: after,
        gpuArchitecture: {
          ...gpuArchitecture,
          readbackOutsideTiming: gpuReadbackWitness(gpuReadback, gpuMesh),
        },
        comparison: {
          geometry: comparison(
            timingSummary([before.geometryMs]),
            timingSummary([after.geometryMs]),
          ),
          endToEnd: comparison(
            timingSummary([before.totalMs]),
            timingSummary([after.totalMs]),
          ),
          polygonOffsetVersusGpuArchitecture: comparison(
            timingSummary([before.totalMs]),
            timingSummary([gpuArchitecture.metrics.totalWallMs]),
          ),
        },
      });
      await yieldToBrowser();
    }

    const correctness: Record<string, unknown>[] = [];
    const visualCaptures: VisualCapture[] = [];
    for (const fixture of fixtures) {
      const meshes = coldMeshes.get(fixture.id);
      const polygonMesh = meshes?.get("polygon-offset");
      const directMesh = meshes?.get("direct-mesh");
      const gpuMesh = meshes?.get("gpu-count-scan-emit");
      if (!polygonMesh || !directMesh || !gpuMesh) {
        throw new Error("Stroke correctness mesh is missing.");
      }
      const bounds = unionBounds(
        unionBounds(
          absoluteMeshBounds(polygonMesh),
          absoluteMeshBounds(directMesh),
        ),
        absoluteMeshBounds(gpuMesh),
      );
      const polygonPixels = await captureMesh(renderer, polygonMesh, bounds);
      const directPixels = await captureMesh(renderer, directMesh, bounds);
      const gpuPixels = await captureMesh(renderer, gpuMesh, bounds);
      visualCaptures.push(
        { fixture: fixture.id, backend: "current", rgba: polygonPixels },
        { fixture: fixture.id, backend: "direct-cpu", rgba: directPixels },
        { fixture: fixture.id, backend: "gpu-architecture", rgba: gpuPixels },
      );
      const directParity = pixelParity(polygonPixels, directPixels);
      const gpuParity = pixelParity(polygonPixels, gpuPixels);
      const minimumParity = fixture.id === "simple-line" ? 0.99 : 0.85;
      correctness.push({
        fixture: fixture.id,
        polygonOffset: meshReport(polygonMesh),
        directMesh: meshReport(directMesh),
        gpuArchitecture: meshReport(gpuMesh),
        minimumIntersectionOverUnion: minimumParity,
        directMeshPixelParity: directParity,
        gpuArchitecturePixelParity: gpuParity,
        passed: directParity.intersectionOverUnion >= minimumParity
          && gpuParity.intersectionOverUnion >= minimumParity,
      });
    }

    const warm: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const lod = vectorTextLodForSigma(1);
      for (let run = 0; run < WARMUP_RUNS; run += 1) {
        const order: readonly Backend[] = run % 2 === 0
          ? ["polygon-offset", "direct-mesh"]
          : ["direct-mesh", "polygon-offset"];
        if (run % 2 === 0) {
          await gpuProbe.run(fixture.elements, {
            viewBounds: probeViewBounds(fixture.sourceBounds),
          });
        }
        for (const backend of order) {
          await executeBuildAndRender(
            device,
            renderer,
            () => buildFor(backend, fixture, lod, `warmup:${fixture.id}:${run}`),
            fixture.sourceBounds,
          );
        }
        if (run % 2 !== 0) {
          await gpuProbe.run(fixture.elements, {
            viewBounds: probeViewBounds(fixture.sourceBounds),
          });
        }
      }
      const samples = new Map<Backend, RunSample[]>([
        ["polygon-offset", []],
        ["direct-mesh", []],
      ]);
      const gpuSamples: VectorStrokeGpuProbeRunResult[] = [];
      for (let run = 0; run < MEASURED_RUNS; run += 1) {
        const order: readonly Backend[] = run % 2 === 0
          ? ["polygon-offset", "direct-mesh"]
          : ["direct-mesh", "polygon-offset"];
        if (run % 2 === 0) {
          gpuSamples.push(await gpuProbe.run(fixture.elements, {
            viewBounds: probeViewBounds(fixture.sourceBounds),
          }));
        }
        for (const backend of order) {
          const result = await executeBuildAndRender(
            device,
            renderer,
            () => buildFor(backend, fixture, lod, `warm:${fixture.id}:${run}`),
            fixture.sourceBounds,
          );
          samples.get(backend)!.push(result.report);
        }
        if (run % 2 !== 0) {
          gpuSamples.push(await gpuProbe.run(fixture.elements, {
            viewBounds: probeViewBounds(fixture.sourceBounds),
          }));
        }
        await yieldToBrowser();
      }
      const before = runSummary(samples.get("polygon-offset")!);
      const after = runSummary(samples.get("direct-mesh")!);
      const gpuAfter = gpuArchitectureSummary(gpuSamples);
      warm.push({
        fixture: fixtureReport(fixture),
        methodology: {
          warmupRunsPerBackend: WARMUP_RUNS,
          measuredRunsPerBackend: MEASURED_RUNS,
          order:
            "polygon-offset and direct-mesh alternate; gpu-count-scan-emit alternates before/after the pair",
        },
        polygonOffset: before,
        directMesh: after,
        gpuArchitecture: gpuAfter,
        comparison: {
          geometry: comparison(before.geometry, after.geometry),
          gpuBufferUploadAndCompletion: comparison(
            before.gpuBufferUploadAndCompletion,
            after.gpuBufferUploadAndCompletion,
          ),
          gpuSetupAndEncode: comparison(
            before.gpuSetupAndEncode,
            after.gpuSetupAndEncode,
          ),
          queueCompletion: comparison(before.queueCompletion, after.queueCompletion),
          endToEnd: comparison(before.total, after.total),
          geometryBytesSaved: before.medianGeometryBytes - after.medianGeometryBytes,
          geometryBytesSavedPercent: before.medianGeometryBytes > 0
            ? (before.medianGeometryBytes - after.medianGeometryBytes)
              / before.medianGeometryBytes * 100
            : null,
          polygonOffsetVersusGpuArchitectureEndToEnd: comparison(
            before.total,
            gpuAfter.total,
          ),
          payloadAccounting: {
            comparableResidentMemoryClaim: false,
            note:
              "CPU values describe output meshes; the GPU value describes active payload only and excludes preallocated capacity, the target texture, pipelines and driver allocations.",
            polygonOffsetOutputMeshBytes: before.medianGeometryBytes,
            directMeshOutputBytes: after.medianGeometryBytes,
            gpuActivePayloadBytes: gpuAfter.medianMeaningfulBufferBytes,
          },
        },
      });
    }

    const widthSweep: Record<string, unknown>[] = [];
    for (let widthIndex = 0; widthIndex < WIDTH_SWEEP.length; widthIndex += 1) {
      const width = WIDTH_SWEEP[widthIndex];
      const fixture = createSimpleFixture(width);
      const lod = vectorTextLodForSigma(1);
      const order: readonly Backend[] = widthIndex % 2 === 0
        ? ["polygon-offset", "direct-mesh"]
        : ["direct-mesh", "polygon-offset"];
      const reports: Partial<Record<Backend, RunSample>> = {};
      const meshes: Partial<Record<Backend, VectorTextGpuMeshData>> = {};
      for (const backend of order) {
        const result = await executeBuildAndRender(
          device,
          renderer,
          () => buildFor(backend, fixture, lod, `width:${width}`),
          fixture.sourceBounds,
        );
        reports[backend] = result.report;
        meshes[backend] = result.mesh;
      }
      const before = reports["polygon-offset"]!;
      const after = reports["direct-mesh"]!;
      const polygonOffsetMeasuredBoundsHeight =
        meshes["polygon-offset"]!.bottom - meshes["polygon-offset"]!.top;
      const directMeasuredBoundsHeight =
        meshes["direct-mesh"]!.bottom - meshes["direct-mesh"]!.top;
      const polygonOffsetAbsoluteError = Math.abs(
        polygonOffsetMeasuredBoundsHeight - width,
      );
      const directAbsoluteError = Math.abs(directMeasuredBoundsHeight - width);
      const gpuArchitecture = await gpuProbe.run(fixture.elements, {
        viewBounds: probeViewBounds(fixture.sourceBounds),
      });
      const gpuReadback = await gpuProbe.readback();
      const gpuMesh = meshFromGpuReadback(
        gpuReadback,
        nextRevision(`width-gpu:${width}`),
      );
      const gpuMeasuredBoundsHeight = gpuMesh.bottom - gpuMesh.top;
      const gpuAbsoluteError = Math.abs(gpuMeasuredBoundsHeight - width);
      widthSweep.push({
        width,
        expectedGeometricWidth: width,
        polygonOffsetMeasuredBoundsHeight,
        directMeasuredBoundsHeight,
        polygonOffsetAbsoluteError,
        directAbsoluteError,
        gpuMeasuredBoundsHeight,
        gpuAbsoluteError,
        passed: polygonOffsetAbsoluteError <= 1e-3
          && directAbsoluteError <= 1e-3
          && gpuAbsoluteError <= 1e-3,
        polygonOffset: before,
        directMesh: after,
        gpuArchitecture: {
          ...gpuArchitecture,
          readbackOutsideTiming: gpuReadbackWitness(gpuReadback, gpuMesh),
        },
        comparison: {
          geometry: comparison(
            timingSummary([before.geometryMs]),
            timingSummary([after.geometryMs]),
          ),
          endToEnd: comparison(
            timingSummary([before.totalMs]),
            timingSummary([after.totalMs]),
          ),
          polygonOffsetVersusGpuArchitecture: comparison(
            timingSummary([before.totalMs]),
            timingSummary([gpuArchitecture.metrics.totalWallMs]),
          ),
        },
      });
    }

    const zoom: Record<string, unknown>[] = [];
    const zoomCorrectness: Record<string, unknown>[] = [];
    for (const fixture of fixtures) {
      const staticCenterlineTolerance = Math.min(
        VECTOR_SVG_STATIC_STROKE_TOLERANCE,
        ...fixture.strokes.map((stroke) => Math.abs(stroke.width) / 8),
      );
      const retainedStaticPathStartedAt = performance.now();
      const retainedStaticPath = expandVectorSvgStrokePaint(fixture.strokes, {
        centerlineTolerance: staticCenterlineTolerance,
        roundArcSagittaTolerance: VECTOR_SVG_STATIC_STROKE_TOLERANCE,
      });
      const retainedStaticPathPreparationMs =
        performance.now() - retainedStaticPathStartedAt;
      const fixedLod = vectorTextLodForSigma(1);
      const directGeometry = buildFor(
        "direct-mesh",
        fixture,
        fixedLod,
        `zoom-direct:${fixture.id}`,
      );
      const directUploadStartedAt = performance.now();
      const directBuffers = renderer.createBuffers(directGeometry.mesh);
      await device.queue.onSubmittedWorkDone();
      const directUploadAndCompletionMs = performance.now() - directUploadStartedAt;
      const baselineCache = new Map<string, {
        readonly buffers: GpuMeshBuffers;
        readonly mesh: VectorTextGpuMeshData;
        readonly geometryIdentity: string;
      }>();
      let baselineHitCount = 0;
      let baselineMissCount = 0;
      let gpuGeometryBuild: VectorStrokeGpuProbeRunResult | null = null;
      const steps: Record<string, unknown>[] = [];
      try {
        for (let zoomIndex = 0; zoomIndex < ZOOM_SEQUENCE.length; zoomIndex += 1) {
          const scale = ZOOM_SEQUENCE[zoomIndex];
          const lod = vectorTextLodForSigma(scale);
          const usesRetainedStaticPath =
            lod.polygonFlattenTolerance >= VECTOR_SVG_STATIC_STROKE_TOLERANCE
            && lod.roundArcSagittaTolerance >= VECTOR_SVG_STATIC_STROKE_TOLERANCE;
          const geometryIdentity = usesRetainedStaticPath
            ? "retained-static-path"
            : `adaptive-path-lod-${lod.bucket}`;
          const cacheKey = `${geometryIdentity}:mesh-lod-${lod.bucket}`;
          const stepStartedAt = performance.now();
          let cached = baselineCache.get(cacheKey);
          let baselineGeometryMs = 0;
          let baselineOutlineExpansionMs = 0;
          let baselineCompilationMs = 0;
          let baselineUploadMs = 0;
          let baselineCacheHit = true;
          if (!cached) {
            baselineCacheHit = false;
            baselineMissCount += 1;
            const geometry = usesRetainedStaticPath
              ? buildPolygonOffsetMeshFromPath(
                  kernel,
                  retainedStaticPath,
                  lod,
                  nextRevision(`zoom-baseline-static:${fixture.id}:${scale}`),
                )
              : buildFor(
                  "polygon-offset",
                  fixture,
                  lod,
                  `zoom-baseline-adaptive:${fixture.id}:${scale}`,
                );
            baselineGeometryMs = geometry.geometryMs;
            baselineOutlineExpansionMs = geometry.outlineExpansionMs ?? 0;
            baselineCompilationMs =
              geometry.canonicalizationAndTriangulationMs ?? 0;
            const uploadStartedAt = performance.now();
            const buffers = renderer.createBuffers(geometry.mesh);
            await device.queue.onSubmittedWorkDone();
            baselineUploadMs = performance.now() - uploadStartedAt;
            cached = { buffers, mesh: geometry.mesh, geometryIdentity };
            baselineCache.set(cacheKey, cached);
            const matchingIdentityKeys = [...baselineCache]
              .filter(([, entry]) => entry.geometryIdentity === geometryIdentity)
              .map(([key]) => key);
            while (matchingIdentityKeys.length > BASELINE_LODS_PER_IDENTITY) {
              const oldest = matchingIdentityKeys.shift();
              if (!oldest) break;
              const removed = baselineCache.get(oldest);
              if (removed) renderer.destroyBuffers(removed.buffers);
              baselineCache.delete(oldest);
            }
            while (baselineCache.size > BASELINE_READY_CACHE_CAPACITY) {
              const oldest = baselineCache.keys().next().value;
              if (typeof oldest !== "string") break;
              const removed = baselineCache.get(oldest);
              if (removed) renderer.destroyBuffers(removed.buffers);
              baselineCache.delete(oldest);
            }
          } else {
            baselineHitCount += 1;
            baselineCache.delete(cacheKey);
            baselineCache.set(cacheKey, cached);
          }
          const baselineRender = await renderer.render(
            cached.buffers,
            fixture.sourceBounds,
            scale,
          );
          const baselineTotalMs = performance.now() - stepStartedAt;

          const directStartedAt = performance.now();
          const directRender = await renderer.render(
            directBuffers,
            fixture.sourceBounds,
            scale,
          );
          const directTotalMs = performance.now() - directStartedAt;

          const gpuViewBounds = probeViewBounds(fixture.sourceBounds, scale);
          let gpuResult:
            | VectorStrokeGpuProbeRunResult
            | VectorStrokeGpuProbeRenderResult;
          if (gpuGeometryBuild) {
            gpuResult = await gpuProbe.render({ viewBounds: gpuViewBounds });
          } else {
            gpuResult = await gpuProbe.run(fixture.elements, {
              viewBounds: gpuViewBounds,
            });
          }
          if (!gpuGeometryBuild && "segmentCount" in gpuResult) {
            gpuGeometryBuild = gpuResult;
          }
          steps.push({
            scale,
            expectedScreenWidth: STROKE_WIDTH * scale,
            lodBucket: lod.bucket,
            baseline: {
              cacheHit: baselineCacheHit,
              pathMode: usesRetainedStaticPath
                ? "retained-static-path"
                : "adaptive-path-for-lod",
              geometryMs: baselineGeometryMs,
              outlineExpansionMs: baselineOutlineExpansionMs,
              canonicalizationAndTriangulationMs: baselineCompilationMs,
              uploadAndCompletionMs: baselineUploadMs,
              render: baselineRender.timing,
              totalMs: baselineTotalMs,
              vertexCount: cached.mesh.vertices.length / 2,
              triangleCount: cached.mesh.indices.length / 3,
            },
            directMesh: {
              reusedGeometry: true,
              geometryMs: 0,
              render: directRender.timing,
              totalMs: directTotalMs,
              totalIncludingFirstUseMs: zoomIndex === 0
                ? directGeometry.geometryMs
                  + directUploadAndCompletionMs
                  + directTotalMs
                : directTotalMs,
              vertexCount: directGeometry.mesh.vertices.length / 2,
              triangleCount: directGeometry.mesh.indices.length / 3,
            },
            gpuArchitecture: {
              reusedGeometry: zoomIndex > 0,
              totalMs: gpuResult.metrics.totalWallMs,
              metrics: gpuResult.metrics,
              vertexCount: gpuResult.vertexCount,
              indirectArgs: gpuResult.indirectArgs,
            },
            savedMs: baselineTotalMs - directTotalMs,
            savedPercent: baselineTotalMs > 0
              ? (baselineTotalMs - directTotalMs) / baselineTotalMs * 100
              : null,
            gpuArchitectureSavedMs:
              baselineTotalMs - gpuResult.metrics.totalWallMs,
            gpuArchitectureSavedPercent: baselineTotalMs > 0
              ? (baselineTotalMs - gpuResult.metrics.totalWallMs)
                / baselineTotalMs * 100
              : null,
          });
          await yieldToBrowser();
        }
      } finally {
        renderer.destroyBuffers(directBuffers);
        for (const cached of baselineCache.values()) {
          renderer.destroyBuffers(cached.buffers);
        }
      }
      const baselineTotals = steps.map((step) => (
        step.baseline as { totalMs: number }
      ).totalMs);
      const directTotals = steps.map((step) => (
        step.directMesh as { totalMs: number }
      ).totalMs);
      const gpuTotals = steps.map((step) => (
        step.gpuArchitecture as { totalMs: number }
      ).totalMs);
      if (!gpuGeometryBuild) {
        throw new Error("GPU stroke zoom probe did not build geometry.");
      }
      const baselineAggregate = baselineTotals.reduce(
        (total, value) => total + value,
        0,
      );
      const directAggregate = directGeometry.geometryMs
        + directUploadAndCompletionMs
        + directTotals.reduce((total, value) => total + value, 0);
      const gpuAggregate = gpuTotals.reduce((total, value) => total + value, 0);
      const gpuZoomReadback = await gpuProbe.readback();
      const gpuZoomMesh = meshFromGpuReadback(
        gpuZoomReadback,
        nextRevision(`zoom-gpu-readback:${fixture.id}`),
      );
      const fixtureZoomCorrectness: Record<string, unknown>[] = [];
      for (const scale of ZOOM_CORRECTNESS_SCALES) {
        const lod = vectorTextLodForSigma(scale);
        const usesRetainedStaticPath =
          lod.polygonFlattenTolerance >= VECTOR_SVG_STATIC_STROKE_TOLERANCE
          && lod.roundArcSagittaTolerance >= VECTOR_SVG_STATIC_STROKE_TOLERANCE;
        const currentGeometry = usesRetainedStaticPath
          ? buildPolygonOffsetMeshFromPath(
              kernel,
              retainedStaticPath,
              lod,
              nextRevision(`zoom-parity-static:${fixture.id}:${scale}`),
            )
          : buildFor(
              "polygon-offset",
              fixture,
              lod,
              `zoom-parity-adaptive:${fixture.id}:${scale}`,
            );
        const bounds = unionBounds(
          unionBounds(
            absoluteMeshBounds(currentGeometry.mesh),
            absoluteMeshBounds(directGeometry.mesh),
          ),
          absoluteMeshBounds(gpuZoomMesh),
        );
        const currentPixels = await captureMesh(
          renderer,
          currentGeometry.mesh,
          bounds,
          scale,
        );
        const directPixels = await captureMesh(
          renderer,
          directGeometry.mesh,
          bounds,
          scale,
        );
        const gpuPixels = await captureMesh(
          renderer,
          gpuZoomMesh,
          bounds,
          scale,
        );
        const directParity = pixelParity(currentPixels, directPixels);
        const gpuParity = pixelParity(currentPixels, gpuPixels);
        const minimumParity = fixture.id === "simple-line" ? 0.99 : 0.8;
        const informative = directParity.unionPixels > 0
          && gpuParity.unionPixels > 0;
        fixtureZoomCorrectness.push({
          scale,
          expectedScreenWidth: STROKE_WIDTH * scale,
          currentPathMode: usesRetainedStaticPath
            ? "retained-static-path"
            : "adaptive-path-for-lod",
          minimumIntersectionOverUnion: minimumParity,
          informative,
          nonInformativeReason: informative
            ? null
            : "The single-sample, no-antialias correctness target contains no covered pixel; geometric width is validated separately.",
          directMeshPixelParity: directParity,
          gpuArchitecturePixelParity: gpuParity,
          status: informative
            ? (
                directParity.intersectionOverUnion >= minimumParity
                && gpuParity.intersectionOverUnion >= minimumParity
                  ? "passed"
                  : "failed"
              )
            : "skipped",
          passed: informative
            ? directParity.intersectionOverUnion >= minimumParity
              && gpuParity.intersectionOverUnion >= minimumParity
            : null,
        });
      }
      const informativeZoomChecks = fixtureZoomCorrectness.filter(
        (entry) => entry.informative === true,
      );
      zoomCorrectness.push({
        fixture: fixture.id,
        scales: fixtureZoomCorrectness,
        skippedScaleCount:
          fixtureZoomCorrectness.length - informativeZoomChecks.length,
        passed: informativeZoomChecks.length >= 2
          && informativeZoomChecks.every((entry) => entry.passed === true),
      });
      zoom.push({
        fixture: fixtureReport(fixture),
        sequence: ZOOM_SEQUENCE,
        currentCachePolicy: {
          readyEntries: BASELINE_READY_CACHE_CAPACITY,
          lodsPerGeometryIdentity: BASELINE_LODS_PER_IDENTITY,
        },
        baselineHitCount,
        baselineMissCount,
        retainedStaticPathPreparation: {
          outsideZoomInteraction: true,
          centerlineTolerance: staticCenterlineTolerance,
          roundArcSagittaTolerance: VECTOR_SVG_STATIC_STROKE_TOLERANCE,
          preparationMs: retainedStaticPathPreparationMs,
        },
        directGeometryBuild: {
          geometryMs: directGeometry.geometryMs,
          uploadAndCompletionMs: directUploadAndCompletionMs,
          oneTimeTotalMs:
            directGeometry.geometryMs + directUploadAndCompletionMs,
          mesh: meshReport(directGeometry.mesh),
        },
        polygonOffsetTotal: timingSummary(baselineTotals),
        directReusedRenderTotal: timingSummary(directTotals),
        gpuArchitectureTotal: timingSummary(gpuTotals),
        gpuArchitectureFirstStepBuildAndDraw: gpuGeometryBuild,
        perStepComparison: comparison(
          timingSummary(baselineTotals),
          timingSummary(directTotals),
        ),
        sequenceAggregate: {
          polygonOffsetZoomInteractionMs: baselineAggregate,
          polygonOffsetIncludingRetainedPathPreparationMs:
            baselineAggregate + retainedStaticPathPreparationMs,
          directMeshIncludingOneTimeBuildAndUploadMs: directAggregate,
          directMeshSavedMs: baselineAggregate - directAggregate,
          directMeshSavedPercent: baselineAggregate > 0
            ? (baselineAggregate - directAggregate) / baselineAggregate * 100
            : null,
          gpuArchitectureIncludingFirstBuildAndDrawMs: gpuAggregate,
          gpuArchitectureSavedMs: baselineAggregate - gpuAggregate,
          gpuArchitectureSavedPercent: baselineAggregate > 0
            ? (baselineAggregate - gpuAggregate) / baselineAggregate * 100
            : null,
        },
        steps,
      });
    }

    const widthChecksPassed = widthSweep.every((entry) => entry.passed === true);
    const parityPassed = correctness.every((entry) => entry.passed === true)
      && zoomCorrectness.every((entry) => entry.passed === true);
    const report = {
      lab: "vector-stroke-expansion-ab",
      version: REPORT_VERSION,
      passed: widthChecksPassed && parityPassed,
      productionClaim: false,
      strategies: {
        before: "flatten-dash-clipper-offset-clipper64-union-earcut-indexed-mesh",
        directCpuCandidate: DIRECT_VECTOR_SVG_STROKE_STRATEGY,
        gpuArchitectureProbe: VECTOR_STROKE_GPU_PROBE_STRATEGY,
      },
      methodology: {
        scope:
          "Center-aligned retained vector strokes; raster coverage and supersampling are excluded.",
        coldDefinition:
          "First uncached geometry use after renderer, kernel and probe initialization inside one live device; not a fresh browser process or device.",
        warmDefinition:
          "Warm pipelines and device, but a complete geometry rebuild on every measured sample; seven-run median after two warmups.",
        timing:
          "Geometry uses performance.now; GPU totalWallMs drains the queue before work and ends at submitted queue-prefix completion. Timestamp maps and diagnostic geometry readback are excluded, so it is not API Promise latency.",
        comparisonOrder: "Alternating by fixture and measured run.",
        warmupRunsPerBackend: WARMUP_RUNS,
        measuredRunsPerBackend: MEASURED_RUNS,
        zoomBehavior:
          "The current path reuses its retained static outline where tolerance permits and models 48 ready entries with three LODs per geometry identity; direct CPU and GPU meshes are built once and transformed for every zoom.",
        zoomComparisonScope:
          "The zoom trace compares complete architectures, including their reuse, cache and LOD policies; it is not an algorithm-only expansion benchmark.",
        complexFixtureScope:
          "Independent cubic elements deliberately isolate adaptive segment expansion; connected joins, caps and dashes are not exercised by this timed fixture.",
        strokeWidthRule: {
          halfWidth: "h = strokeWidth / 2",
          segmentNormal: "n = perpendicular(p1 - p0) / length(p1 - p0)",
          corners: "p0 + n*h, p1 + n*h, p1 - n*h, p0 - n*h",
          clampToOnePixel: false,
          screenWidth: "strokeWidth * zoom",
        },
      },
      environment: {
        gpuLabel: device.label,
        timestampQueryAvailable: device.features.has("timestamp-query"),
      },
      initialization: {
        fixtureBuildMs,
        commonMeshRendererMs: renderer.initializationMs,
        polygonOffsetWasmKernelMs: kernelInitializationMs,
        gpuArchitectureProbeMs: gpuProbe.initializationMs,
      },
      fixtures: fixtures.map(fixtureReport),
      cold,
      correctness: {
        widthChecksPassed,
        parityPassed,
        captures: correctness,
        zoomCapturesOutsideTiming: zoomCorrectness,
      },
      warm,
      widthSweep,
      zoom,
      limitations: [
        "This lab measures this repository's implementation of direct stroke expansion, not another application's runtime.",
        "The direct mesh may overlap opaque triangles at joins; translucent strokes still require a single-coverage mask or equivalent cover pass.",
        "The GPU architecture probe covers line/cubic segment expansion only; production joins, caps, dashes and overlap coverage are outside its timing.",
        "The GPU prefix scan is deliberately serial and conservative; a hierarchical production scan can improve complex cases.",
        "A real process-cold comparison requires isolated page/device launches and cannot be inferred from one in-page run.",
        "CPU output-mesh bytes and GPU active-payload bytes are reported separately; they are not a resident-memory comparison because the probe preallocates capacity and a render target.",
      ],
    };
    const presentationRows: PresentationRow[] = fixtures.map((fixture, index) => {
      const coldEntry = cold[index];
      const warmEntry = warm[index];
      const zoomEntry = zoom[index];
      const coldCurrent = coldEntry.polygonOffset as RunSample;
      const coldDirect = coldEntry.directMesh as RunSample;
      const coldGpu = coldEntry.gpuArchitecture as VectorStrokeGpuProbeRunResult;
      const warmCurrent = warmEntry.polygonOffset as RunSummary;
      const warmDirect = warmEntry.directMesh as RunSummary;
      const warmGpu = warmEntry.gpuArchitecture as GpuArchitectureSummary;
      const zoomAggregate = zoomEntry.sequenceAggregate as {
        readonly polygonOffsetZoomInteractionMs: number;
        readonly directMeshIncludingOneTimeBuildAndUploadMs: number;
        readonly directMeshSavedPercent: number;
        readonly gpuArchitectureIncludingFirstBuildAndDrawMs: number;
        readonly gpuArchitectureSavedPercent: number;
      };
      return {
        label: fixture.id === "simple-line"
          ? "Linea semplice"
          : `${fixture.curveCount} cubiche`,
        coldMs: [
          coldCurrent.totalMs,
          coldDirect.totalMs,
          coldGpu.metrics.totalWallMs,
        ],
        warmMs: [
          warmCurrent.total.medianMs,
          warmDirect.total.medianMs,
          warmGpu.total.medianMs,
        ],
        warmSavedPercent: [
          (warmCurrent.total.medianMs - warmDirect.total.medianMs)
            / warmCurrent.total.medianMs * 100,
          (warmCurrent.total.medianMs - warmGpu.total.medianMs)
            / warmCurrent.total.medianMs * 100,
        ],
        zoomMs: [
          zoomAggregate.polygonOffsetZoomInteractionMs,
          zoomAggregate.directMeshIncludingOneTimeBuildAndUploadMs,
          zoomAggregate.gpuArchitectureIncludingFirstBuildAndDrawMs,
        ],
        zoomSavedPercent: [
          zoomAggregate.directMeshSavedPercent,
          zoomAggregate.gpuArchitectureSavedPercent,
        ],
      };
    });
    let presentationError: string | null = null;
    try {
      renderLabPresentation(
        presentationRows,
        visualCaptures,
        widthSweep.map((entry) => ({
          width: entry.width as number,
          current: entry.polygonOffsetMeasuredBoundsHeight as number,
          direct: entry.directMeasuredBoundsHeight as number,
          gpu: entry.gpuMeasuredBoundsHeight as number,
        })),
        {
          complexCurveCount: complex.curveCount,
          initialization: {
            commonMeshRendererMs: renderer.initializationMs,
            polygonOffsetWasmKernelMs: kernelInitializationMs,
            gpuArchitectureProbeMs: gpuProbe.initializationMs,
          },
        },
      );
    } catch (error) {
      presentationError = error instanceof Error ? error.message : String(error);
    }
    return {
      ...report,
      presentation: {
        rendered: presentationError === null,
        error: presentationError,
      },
    };
  } finally {
    gpuProbe.destroy();
    renderer.destroy();
  }
}
