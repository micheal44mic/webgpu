/** Transactional point-driven Gaussian blur for the selected native raster. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
import {
  DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE,
} from "./engine-gaussian-blur-runtime";
import {
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
} from "./gaussian-blur-core";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  planMemoryAdmission,
  type MemoryRequest,
  type MemoryReservation,
} from "./memory-governor-core";
import { tileMaskCoveringRect } from "./raster-transform-math";
import {
  SPATIAL_BLUR_MAX_PIN_COUNT,
  SPATIAL_BLUR_RADIUS_QUANTIZATION,
  createInitialSpatialBlurPin,
  normalizeSpatialBlurPins,
  spatialBlurBounds,
  spatialBlurInfluenceFloorSquared,
  spatialBlurGaussianKernel,
  spatialBlurMaximumRadius,
  spatialBlurPinsEqual,
  unionSpatialBlurRects,
  type SpatialBlurPin,
} from "./spatial-blur-core";

export const DESTRUCTIVE_SPATIAL_BLUR_RUNTIME_BUILD =
  "destructive-spatial-blur-webgpu-v1-shared-gaussian-kernel-quarter-pixel-field-uniform-fast-path" as const;
export const DESTRUCTIVE_SPATIAL_BLUR_PRECISION =
  "rgba16float-f32-accumulation" as const;
export const DESTRUCTIVE_SPATIAL_BLUR_FIELD_STRATEGY =
  "inverse-distance-quarter-pixel-radius" as const;
export const DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION =
  SPATIAL_BLUR_RADIUS_QUANTIZATION;

const FILTER_WORKGROUP_SIZE = 64;
const FIELD_WORKGROUP_WIDTH = 8;
const FIELD_WORKGROUP_HEIGHT = 8;
const FILTER_CACHE_LENGTH =
  FILTER_WORKGROUP_SIZE + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
const FILTER_CACHE_BYTES = FILTER_CACHE_LENGTH * 8;
const WEIGHT_RADIUS_COUNT =
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION + 1;
const WEIGHT_ROW_LENGTH = DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS + 1;
const WEIGHT_TABLE_FLOATS = WEIGHT_RADIUS_COUNT * WEIGHT_ROW_LENGTH;
const WEIGHT_TABLE_BYTES = WEIGHT_TABLE_FLOATS * 4;
const PARAMETER_HEADER_WORDS = 20;
const PARAMETER_WORDS = PARAMETER_HEADER_WORDS + SPATIAL_BLUR_MAX_PIN_COUNT * 4;
const PARAMETER_BYTES = PARAMETER_WORDS * 4;
const PARAMETER_CAPACITY = 64;
const BYTES_PER_RGBA16F_PIXEL = 8;
const BYTES_PER_R32U_PIXEL = 4;

interface SpatialBlurSharedResources {
  readonly fieldBindGroupLayout: GPUBindGroupLayout;
  readonly horizontalBindGroupLayout: GPUBindGroupLayout;
  readonly verticalBindGroupLayout: GPUBindGroupLayout;
  readonly fieldPipeline: GPUComputePipeline;
  readonly horizontalPipeline: GPUComputePipeline;
  readonly verticalPipeline: GPUComputePipeline;
  readonly weightBuffer: GPUBuffer;
}

interface SpatialBlurJob {
  readonly buildOriginY: number;
  readonly buildHeight: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
}

export interface RasterSpatialBlurSnapshot {
  readonly layerId: number;
  readonly pins: readonly SpatialBlurPin[];
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly maximumRadius: number;
  readonly memoryBytes: number;
}

export interface ActiveRasterSpatialBlurSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly intermediateTexture: GPUTexture;
  readonly intermediateView: GPUTextureView;
  readonly fieldTexture: GPUTexture;
  readonly fieldView: GPUTextureView;
  readonly targetTexture: GPUTexture;
  readonly targetView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterStride: number;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadU32: Uint32Array;
  readonly parameterUploadF32: Float32Array;
  readonly fieldBindGroup: GPUBindGroup;
  readonly horizontalBindGroup: GPUBindGroup;
  readonly verticalBindGroup: GPUBindGroup;
  readonly shared: SpatialBlurSharedResources;
  readonly memoryBytes: number;
  pins: readonly SpatialBlurPin[];
  resultBounds: DirtyRect;
  resultTileMask: Uint32Array;
  presentedBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
  destroyed: boolean;
}

export type RasterSpatialBlurEngineHost = BrushEngine & {
  activeRasterSpatialBlurSession: ActiveRasterSpatialBlurSession | null;
};

const sharedByDevice = new WeakMap<GPUDevice, Promise<SpatialBlurSharedResources>>();

function parameterShaderSource(): string {
  return /* wgsl */ `
struct SpatialBlurParameters {
  sourceOriginAndSize: vec4<i32>,
  buildOriginAndSize: vec4<i32>,
  targetOriginAndSize: vec4<u32>,
  supportIntermediateAndPins: vec4<u32>,
  fieldAndDocument: vec4<f32>,
  pins: array<vec4<f32>, ${SPATIAL_BLUR_MAX_PIN_COUNT}>,
};

@group(0) @binding(0) var<uniform> parameters: SpatialBlurParameters;
`;
}

function fieldShader(): string {
  return `${parameterShaderSource()}
const DOCUMENT_EXTENT = vec2<i32>(${DOCUMENT_WIDTH}, ${DOCUMENT_HEIGHT});

@group(0) @binding(1) var radiusField:
  texture_storage_2d<r32uint, write>;

fn radiusIndexAt(documentPosition: vec2<f32>) -> u32 {
  let pinCount = parameters.supportIntermediateAndPins.w;
  if (pinCount == 0u) { return 0u; }
  var weightedRadius = 0.0;
  var weightSum = 0.0;
  for (var index = 0u; index < ${SPATIAL_BLUR_MAX_PIN_COUNT}u; index += 1u) {
    if (index >= pinCount) { break; }
    let pin = parameters.pins[index];
    let delta = documentPosition - pin.xy;
    let distanceSquared = dot(delta, delta);
    if (distanceSquared <= 0.25) {
      return u32(round(clamp(pin.z, 0.0, ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}.0)
        * ${DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION}.0));
    }
    let weight = 1.0 / (distanceSquared + parameters.fieldAndDocument.x);
    weightedRadius += pin.z * weight;
    weightSum += weight;
  }
  let radius = select(0.0, weightedRadius / weightSum, weightSum > 0.0);
  return u32(round(clamp(radius, 0.0, ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}.0)
    * ${DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION}.0));
}

@compute @workgroup_size(${FIELD_WORKGROUP_WIDTH}, ${FIELD_WORKGROUP_HEIGHT})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let buildSize = vec2<u32>(parameters.buildOriginAndSize.zw);
  if (any(globalId.xy >= buildSize)) { return; }
  let documentPixel = parameters.buildOriginAndSize.xy + vec2<i32>(globalId.xy);
  let documentPosition = vec2<f32>(clamp(
    documentPixel,
    vec2<i32>(0),
    DOCUMENT_EXTENT - vec2<i32>(1)
  )) + vec2<f32>(0.5);
  textureStore(radiusField, vec2<i32>(globalId.xy), vec4<u32>(
    radiusIndexAt(documentPosition), 0u, 0u, 0u
  ));
}
`;
}

function commonFilterShaderSource(): string {
  return `${parameterShaderSource()}
struct GaussianWeightTable {
  values: array<f32>,
};

const MAX_RADIUS = ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}u;
const WEIGHT_ROW_LENGTH = ${WEIGHT_ROW_LENGTH}u;
const WEIGHT_RADIUS_COUNT = ${WEIGHT_RADIUS_COUNT}u;
const RADIUS_QUANTIZATION = ${DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION}u;

@group(0) @binding(3) var radiusField: texture_2d<u32>;
@group(0) @binding(4) var<storage, read> gaussianWeights: GaussianWeightTable;

fn supportRadius(radiusIndex: u32) -> u32 {
  return min(MAX_RADIUS, (radiusIndex + RADIUS_QUANTIZATION - 1u) / RADIUS_QUANTIZATION);
}

fn kernelWeight(radiusIndex: u32, offset: u32) -> f32 {
  return gaussianWeights.values[offset * WEIGHT_RADIUS_COUNT + radiusIndex];
}

fn radiusIndexAt(fieldPosition: vec2<i32>) -> u32 {
  if (parameters.supportIntermediateAndPins.w == 1u) {
    return u32(round(clamp(
      parameters.pins[0].z,
      0.0,
      f32(MAX_RADIUS)
    ) * f32(RADIUS_QUANTIZATION)));
  }
  return textureLoad(radiusField, fieldPosition, 0).x;
}

fn packFilterTexel(value: vec4<f32>) -> vec2<u32> {
  return vec2<u32>(pack2x16float(value.xy), pack2x16float(value.zw));
}

fn unpackFilterTexel(value: vec2<u32>) -> vec4<f32> {
  return vec4<f32>(unpack2x16float(value.x), unpack2x16float(value.y));
}
`;
}

function horizontalShader(): string {
  return `${commonFilterShaderSource()}
const DOCUMENT_EXTENT = vec2<i32>(${DOCUMENT_WIDTH}, ${DOCUMENT_HEIGHT});

@group(0) @binding(1) var immutableSource: texture_2d<f32>;
@group(0) @binding(2) var intermediateOutput:
  texture_storage_2d<rgba16float, write>;

var<workgroup> filterCache: array<vec2<u32>, ${FILTER_CACHE_LENGTH}>;
var<workgroup> groupSupport: atomic<u32>;

fn sourceTexel(documentPosition: vec2<i32>) -> vec4<f32> {
  let documentMaximum = max(DOCUMENT_EXTENT - vec2<i32>(1), vec2<i32>(0));
  let clampedDocumentPosition = clamp(
    documentPosition,
    vec2<i32>(0),
    documentMaximum
  );
  let local = clampedDocumentPosition - parameters.sourceOriginAndSize.xy;
  let size = parameters.sourceOriginAndSize.zw;
  if (any(local < vec2<i32>(0)) || any(local >= size)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(immutableSource, local, 0);
}

@compute @workgroup_size(${FILTER_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  let targetWidth = u32(parameters.buildOriginAndSize.z);
  let buildHeight = u32(parameters.buildOriginAndSize.w);
  if (groupId.y >= buildHeight) { return; }
  if (localId.x == 0u) { atomicStore(&groupSupport, 0u); }
  workgroupBarrier();
  let outputX = groupId.x * ${FILTER_WORKGROUP_SIZE}u + localId.x;
  var radiusIndex = 0u;
  if (outputX < targetWidth) {
    radiusIndex = radiusIndexAt(vec2<i32>(i32(outputX), i32(groupId.y)));
    atomicMax(&groupSupport, supportRadius(radiusIndex));
  }
  workgroupBarrier();
  let halo = atomicLoad(&groupSupport);
  let cacheLength = ${FILTER_WORKGROUP_SIZE}u + halo * 2u;
  for (
    var cacheIndex = localId.x;
    cacheIndex < cacheLength;
    cacheIndex += ${FILTER_WORKGROUP_SIZE}u
  ) {
    let documentX = parameters.buildOriginAndSize.x
      + i32(groupId.x * ${FILTER_WORKGROUP_SIZE}u + cacheIndex)
      - i32(halo);
    let documentY = parameters.buildOriginAndSize.y + i32(groupId.y);
    filterCache[cacheIndex] = packFilterTexel(sourceTexel(vec2<i32>(documentX, documentY)));
  }
  workgroupBarrier();

  if (outputX >= targetWidth) { return; }
  let support = supportRadius(radiusIndex);
  let center = halo + localId.x;
  var result = unpackFilterTexel(filterCache[center]) * kernelWeight(radiusIndex, 0u);
  for (var offset = 1u; offset <= MAX_RADIUS; offset += 1u) {
    if (offset > support) { break; }
    let weight = kernelWeight(radiusIndex, offset);
    result += unpackFilterTexel(filterCache[center - offset]) * weight;
    result += unpackFilterTexel(filterCache[center + offset]) * weight;
  }
  textureStore(intermediateOutput, vec2<i32>(i32(outputX), i32(groupId.y)), result);
}
`;
}

function verticalShader(): string {
  return `${commonFilterShaderSource()}
@group(0) @binding(1) var intermediateInput: texture_2d<f32>;
@group(0) @binding(2) var authoritativeOutput:
  texture_storage_2d<rgba16float, write>;

var<workgroup> filterCache: array<vec2<u32>, ${FILTER_CACHE_LENGTH}>;
var<workgroup> groupSupport: atomic<u32>;

fn intermediateTexel(position: vec2<i32>) -> vec4<f32> {
  let size = vec2<i32>(parameters.supportIntermediateAndPins.yz);
  if (any(position < vec2<i32>(0)) || any(position >= size)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(intermediateInput, position, 0);
}

@compute @workgroup_size(${FILTER_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  let targetWidth = parameters.targetOriginAndSize.z;
  let targetHeight = parameters.targetOriginAndSize.w;
  let localX = groupId.y;
  if (localX >= targetWidth) { return; }
  let maximumSupport = parameters.supportIntermediateAndPins.x;
  let localY = groupId.x * ${FILTER_WORKGROUP_SIZE}u + localId.x;
  if (localId.x == 0u) { atomicStore(&groupSupport, 0u); }
  workgroupBarrier();
  var radiusIndex = 0u;
  if (localY < targetHeight) {
    radiusIndex = radiusIndexAt(
      vec2<i32>(i32(localX), i32(maximumSupport + localY))
    );
    atomicMax(&groupSupport, supportRadius(radiusIndex));
  }
  workgroupBarrier();
  let halo = atomicLoad(&groupSupport);
  let cacheLength = ${FILTER_WORKGROUP_SIZE}u + halo * 2u;
  for (
    var cacheIndex = localId.x;
    cacheIndex < cacheLength;
    cacheIndex += ${FILTER_WORKGROUP_SIZE}u
  ) {
    let sourceY = i32(groupId.x * ${FILTER_WORKGROUP_SIZE}u + cacheIndex)
      + i32(maximumSupport)
      - i32(halo);
    filterCache[cacheIndex] = packFilterTexel(
      intermediateTexel(vec2<i32>(i32(localX), sourceY))
    );
  }
  workgroupBarrier();

  if (localY >= targetHeight) { return; }
  let support = supportRadius(radiusIndex);
  let center = halo + localId.x;
  var result = unpackFilterTexel(filterCache[center]) * kernelWeight(radiusIndex, 0u);
  for (var offset = 1u; offset <= MAX_RADIUS; offset += 1u) {
    if (offset > support) { break; }
    let weight = kernelWeight(radiusIndex, offset);
    result += unpackFilterTexel(filterCache[center - offset]) * weight;
    result += unpackFilterTexel(filterCache[center + offset]) * weight;
  }
  let documentPixel = vec2<i32>(parameters.targetOriginAndSize.xy)
    + vec2<i32>(i32(localX), i32(localY));
  textureStore(authoritativeOutput, documentPixel, result);
}
`;
}

function buildWeightTable(): Float32Array {
  const table = new Float32Array(WEIGHT_TABLE_FLOATS);
  for (let radiusIndex = 0; radiusIndex < WEIGHT_RADIUS_COUNT; radiusIndex += 1) {
    const kernel = spatialBlurGaussianKernel(
      radiusIndex / DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION,
    );
    for (let offset = 0; offset < kernel.weights.length; offset += 1) {
      table[offset * WEIGHT_RADIUS_COUNT + radiusIndex] = kernel.weights[offset];
    }
  }
  return table;
}

async function createSharedResources(device: GPUDevice): Promise<SpatialBlurSharedResources> {
  const availableWorkgroupStorage = Number(device.limits.maxComputeWorkgroupStorageSize);
  if (Number.isFinite(availableWorkgroupStorage) && availableWorkgroupStorage < FILTER_CACHE_BYTES) {
    throw new Error(
      `Point Blur requires ${FILTER_CACHE_BYTES} bytes of workgroup cache; `
      + `the GPU exposes ${availableWorkgroupStorage}.`,
    );
  }
  const availableStorageBinding = Number(device.limits.maxStorageBufferBindingSize);
  if (Number.isFinite(availableStorageBinding) && availableStorageBinding < WEIGHT_TABLE_BYTES) {
    throw new Error(
      `Point Blur requires a ${WEIGHT_TABLE_BYTES}-byte Gaussian weight table; `
      + `the GPU exposes ${availableStorageBinding}.`,
    );
  }
  return runGpuAllocationTransaction(device, "Pipeline Point Blur RGBA16F", async (transaction) => {
    const fieldModule = device.createShaderModule({
      label: "Point Blur radius field WGSL",
      code: fieldShader(),
    });
    const horizontalModule = device.createShaderModule({
      label: "Point Blur horizontal Gaussian WGSL",
      code: horizontalShader(),
    });
    const verticalModule = device.createShaderModule({
      label: "Point Blur vertical Gaussian WGSL",
      code: verticalShader(),
    });
    await Promise.all([
      assertShaderCompiled(fieldModule, "Point Blur radius field"),
      assertShaderCompiled(horizontalModule, "Point Blur horizontal Gaussian"),
      assertShaderCompiled(verticalModule, "Point Blur vertical Gaussian"),
    ]);
    const parameterEntry: GPUBindGroupLayoutEntry = {
      binding: 0,
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type: "uniform",
        hasDynamicOffset: true,
        minBindingSize: PARAMETER_BYTES,
      },
    };
    const fieldBindGroupLayout = device.createBindGroupLayout({
      label: "Point Blur radius field layout",
      entries: [
        parameterEntry,
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "r32uint" },
        },
      ],
    });
    const filterEntries = (
      sourceTexture: GPUBindGroupLayoutEntry,
      outputTexture: GPUBindGroupLayoutEntry,
    ): GPUBindGroupLayoutEntry[] => [
      parameterEntry,
      sourceTexture,
      outputTexture,
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: "uint" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage", minBindingSize: WEIGHT_TABLE_BYTES },
      },
    ];
    const horizontalBindGroupLayout = device.createBindGroupLayout({
      label: "Point Blur horizontal layout",
      entries: filterEntries(
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float" },
        },
      ),
    });
    const verticalBindGroupLayout = device.createBindGroupLayout({
      label: "Point Blur vertical layout",
      entries: filterEntries(
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float" },
        },
      ),
    });
    const weightBuffer = device.createBuffer({
      label: "Point Blur shared Gaussian weight table",
      size: WEIGHT_TABLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    transaction.deferRollback(() => weightBuffer.destroy());
    device.queue.writeBuffer(weightBuffer, 0, buildWeightTable());
    return {
      fieldBindGroupLayout,
      horizontalBindGroupLayout,
      verticalBindGroupLayout,
      fieldPipeline: device.createComputePipeline({
        label: "Point Blur radius field pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [fieldBindGroupLayout] }),
        compute: { module: fieldModule, entryPoint: "main" },
      }),
      horizontalPipeline: device.createComputePipeline({
        label: "Point Blur horizontal Gaussian pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [horizontalBindGroupLayout] }),
        compute: { module: horizontalModule, entryPoint: "main" },
      }),
      verticalPipeline: device.createComputePipeline({
        label: "Point Blur vertical Gaussian pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [verticalBindGroupLayout] }),
        compute: { module: verticalModule, entryPoint: "main" },
      }),
      weightBuffer,
    };
  });
}

async function requireSharedResources(device: GPUDevice): Promise<SpatialBlurSharedResources> {
  let promise = sharedByDevice.get(device);
  if (!promise) {
    promise = createSharedResources(device);
    sharedByDevice.set(device, promise);
  }
  try {
    return await promise;
  } catch (error) {
    sharedByDevice.delete(device);
    throw error;
  }
}

export async function warmRasterSpatialBlurPipelines(engine: BrushEngine): Promise<void> {
  if (!engine.initialized) return;
  await requireSharedResources(engine.device);
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function snapshot(session: ActiveRasterSpatialBlurSession): RasterSpatialBlurSnapshot {
  return {
    layerId: session.layerId,
    pins: session.pins.map((pin) => ({ ...pin })),
    sourceBounds: { ...session.sourceBounds },
    resultBounds: { ...session.resultBounds },
    maximumRadius: spatialBlurMaximumRadius(session.pins),
    memoryBytes: session.memoryBytes,
  };
}

function setAuthoritativeMetadata(
  engine: RasterSpatialBlurEngineHost,
  bounds: DirtyRect,
  tileMask: Uint32Array,
): void {
  const record = engine.layerStack.active;
  engine.layerContentBounds = { ...bounds };
  engine.layerHasContent = true;
  record.contentBounds = { ...bounds };
  record.hasContent = true;
  record.storageTileMask.set(tileMaskCoveringRect(tileMask, bounds));
  invalidateActiveLayerBake(engine);
}

function planJobs(rect: DirtyRect, support: number): SpatialBlurJob[] {
  const jobs: SpatialBlurJob[] = [];
  const bottom = rect.y + rect.height;
  for (let targetY = rect.y; targetY < bottom; targetY += DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT) {
    const targetHeight = Math.min(DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT, bottom - targetY);
    jobs.push({
      buildOriginY: targetY - support,
      buildHeight: targetHeight + support * 2,
      targetX: rect.x,
      targetY,
      targetWidth: rect.width,
      targetHeight,
    });
  }
  return jobs;
}

function writeJobParameters(
  session: ActiveRasterSpatialBlurSession,
  index: number,
  job: SpatialBlurJob,
  pins: readonly SpatialBlurPin[],
  support: number,
): number {
  if (index >= PARAMETER_CAPACITY) throw new Error("Point Blur: strip capacity exceeded.");
  const byteOffset = index * session.parameterStride;
  const word = byteOffset / 4;
  const source = session.scratchBounds;
  const i32 = session.parameterUploadI32;
  const u32 = session.parameterUploadU32;
  const f32 = session.parameterUploadF32;
  i32[word] = source.x;
  i32[word + 1] = source.y;
  i32[word + 2] = source.width;
  i32[word + 3] = source.height;
  i32[word + 4] = job.targetX;
  i32[word + 5] = job.buildOriginY;
  i32[word + 6] = job.targetWidth;
  i32[word + 7] = job.buildHeight;
  u32[word + 8] = job.targetX;
  u32[word + 9] = job.targetY;
  u32[word + 10] = job.targetWidth;
  u32[word + 11] = job.targetHeight;
  u32[word + 12] = support;
  u32[word + 13] = job.targetWidth;
  u32[word + 14] = job.buildHeight;
  u32[word + 15] = pins.length;
  f32[word + 16] = spatialBlurInfluenceFloorSquared(DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
  f32[word + 17] = DOCUMENT_WIDTH;
  f32[word + 18] = DOCUMENT_HEIGHT;
  f32[word + 19] = DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION;
  for (let pinIndex = 0; pinIndex < SPATIAL_BLUR_MAX_PIN_COUNT; pinIndex += 1) {
    const base = word + PARAMETER_HEADER_WORDS + pinIndex * 4;
    const pin = pins[pinIndex];
    f32[base] = pin?.x ?? 0;
    f32[base + 1] = pin?.y ?? 0;
    f32[base + 2] = pin?.radius ?? 0;
    f32[base + 3] = 0;
  }
  return byteOffset;
}

function destroySessionResources(session: ActiveRasterSpatialBlurSession): void {
  if (session.destroyed) return;
  session.destroyed = true;
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.intermediateTexture.destroy();
  session.fieldTexture.destroy();
  session.parameterBuffer.destroy();
}

export function abandonRasterSpatialBlurSession(engine: RasterSpatialBlurEngineHost): boolean {
  const session = engine.activeRasterSpatialBlurSession;
  if (!session) return false;
  session.terminal = true;
  destroySessionResources(session);
  engine.activeRasterSpatialBlurSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  return true;
}

function encodeRequestedPreview(
  engine: RasterSpatialBlurEngineHost,
  session: ActiveRasterSpatialBlurSession,
  serial: number,
  pins: readonly SpatialBlurPin[],
): void {
  if (engine.activeRasterSpatialBlurSession !== session || session.terminal) return;
  if (serial !== session.requestedSerial || session.encodedSerial === serial) return;
  const maximumRadius = spatialBlurMaximumRadius(pins);
  const support = Math.ceil(maximumRadius);
  const resultBounds = spatialBlurBounds(
    session.sourceBounds,
    maximumRadius,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (!resultBounds) throw new Error("Point Blur: result bounds are missing.");
  const dirtyRect = unionSpatialBlurRects(session.presentedBounds, resultBounds) as DirtyRect;
  const jobs = support > 0 && pins.length > 0 ? planJobs(resultBounds, support) : [];
  if (jobs.length > PARAMETER_CAPACITY) {
    throw new Error("Point Blur: too many strips for the parameter buffer.");
  }
  const offsets = jobs.map((job, index) => writeJobParameters(
    session,
    index,
    job,
    pins,
    support,
  ));
  if (jobs.length > 0) {
    engine.device.queue.writeBuffer(
      session.parameterBuffer,
      0,
      session.parameterUpload,
      0,
      jobs.length * session.parameterStride,
    );
  }
  const encoder = engine.device.createCommandEncoder({
    label: `Point Blur preview ${pins.length} points`,
  });
  encoder.copyTextureToTexture(
    {
      texture: session.sourceTexture,
      origin: {
        x: dirtyRect.x - session.scratchBounds.x,
        y: dirtyRect.y - session.scratchBounds.y,
        z: 0,
      },
    },
    {
      texture: session.targetTexture,
      origin: { x: dirtyRect.x, y: dirtyRect.y, z: 0 },
    },
    { width: dirtyRect.width, height: dirtyRect.height, depthOrArrayLayers: 1 },
  );
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (pins.length > 1) {
      const field = encoder.beginComputePass({
        label: `Point Blur radius field strip ${index + 1}/${jobs.length}`,
      });
      field.setPipeline(session.shared.fieldPipeline);
      field.setBindGroup(0, session.fieldBindGroup, [offsets[index]]);
      field.dispatchWorkgroups(
        Math.ceil(job.targetWidth / FIELD_WORKGROUP_WIDTH),
        Math.ceil(job.buildHeight / FIELD_WORKGROUP_HEIGHT),
      );
      field.end();
    }
    const horizontal = encoder.beginComputePass({
      label: `Point Blur horizontal strip ${index + 1}/${jobs.length}`,
    });
    horizontal.setPipeline(session.shared.horizontalPipeline);
    horizontal.setBindGroup(0, session.horizontalBindGroup, [offsets[index]]);
    horizontal.dispatchWorkgroups(
      Math.ceil(job.targetWidth / FILTER_WORKGROUP_SIZE),
      job.buildHeight,
    );
    horizontal.end();
    const vertical = encoder.beginComputePass({
      label: `Point Blur vertical strip ${index + 1}/${jobs.length}`,
    });
    vertical.setPipeline(session.shared.verticalPipeline);
    vertical.setBindGroup(0, session.verticalBindGroup, [offsets[index]]);
    vertical.dispatchWorkgroups(
      Math.ceil(job.targetHeight / FILTER_WORKGROUP_SIZE),
      job.targetWidth,
    );
    vertical.end();
  }
  engine.device.queue.submit([encoder.finish()]);
  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(session.sourceTileMask, resultBounds);
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  session.presentedBounds = { ...resultBounds };
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: RasterSpatialBlurEngineHost,
  session: ActiveRasterSpatialBlurSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterSpatialBlurSession !== session
    || session.terminal
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) return Promise.resolve();
  const serial = session.requestedSerial;
  const pins = session.pins.map((pin) => ({ ...pin }));
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, pins);
      await engine.waitForGpuCapped(`Point Blur preview ${pins.length} points`, 60_000);
    } catch (error) {
      session.previewFault = errorFrom(error);
      if (engine.activeRasterSpatialBlurSession === session) {
        engine.publishStatus(
          `Point Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterSpatialBlurSession === session
        && !session.terminal
        && !session.previewFault
        && session.encodedSerial !== session.requestedSerial
      ) schedulePreview(engine, session);
    }
  });
  session.previewInFlight = completion;
  return completion;
}

function schedulePreview(
  engine: RasterSpatialBlurEngineHost,
  session: ActiveRasterSpatialBlurSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault || session.terminal) {
    return;
  }
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterSpatialBlurSession !== session
      || session.terminal
      || session.previewFault
    ) return;
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: RasterSpatialBlurEngineHost,
  session: ActiveRasterSpatialBlurSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  for (;;) {
    if (session.previewFault) throw session.previewFault;
    if (session.encodedSerial === session.requestedSerial && !session.previewInFlight) return;
    await startPreviewSubmission(engine, session);
  }
}

async function restoreOriginalPixels(
  engine: RasterSpatialBlurEngineHost,
  session: ActiveRasterSpatialBlurSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  if (session.previewInFlight) await session.previewInFlight;
  const bounds = session.scratchBounds;
  const encoder = engine.device.createCommandEncoder({
    label: `Restore Point Blur source layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: session.targetTexture,
      origin: { x: bounds.x, y: bounds.y, z: 0 },
    },
    { width: bounds.width, height: bounds.height, depthOrArrayLayers: 1 },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate([], false, engine.settings, true, null, bounds, false);
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Restore Point Blur", 60_000);
  if (presentationError) throw presentationError;
}

function sessionMemoryRequest(memoryBytes: number): MemoryRequest {
  return {
    category: "native-raster-spatial-blur-session",
    steadyBytes: memoryBytes,
    peakBytes: memoryBytes,
    priority: "interactive",
  };
}

async function reserveSessionMemory(
  engine: RasterSpatialBlurEngineHost,
  memoryBytes: number,
): Promise<MemoryReservation> {
  const request = sessionMemoryRequest(memoryBytes);
  const decision = planMemoryAdmission({
    committedBytes: engine.gpuResourceRegistry.snapshot().currentBytes,
    reservedBytes: engine.memoryReservations.pendingBytes,
    reclaimableBytes: 0,
    inFlightBytes: 0,
  }, engine.memoryGovernorLimits, request);
  const requiredMiB = request.peakBytes / (1024 * 1024);
  const availableMiB = Math.max(0, decision.ceilingBytes - decision.usedBytes) / (1024 * 1024);
  return engine.reserveMemoryWithAdmissionOverride(
    request,
    decision,
    "Open Point Blur",
    `Insufficient memory for Point Blur: ${requiredMiB.toFixed(1)} MiB required, `
      + `${availableMiB.toFixed(1)} MiB available.`,
  );
}

export async function beginRasterSpatialBlur(
  engine: RasterSpatialBlurEngineHost,
  initialPins?: readonly Readonly<SpatialBlurPin>[],
): Promise<RasterSpatialBlurSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterSpatialBlurSession) return snapshot(engine.activeRasterSpatialBlurSession);
  engine.assertDestructiveRasterEditCanOpen("spatial-blur");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("The selected raster does not match the active layer.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error("Point Blur works on the entire layer: deselect the pixels before opening it.");
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Point Blur requires an RGBA16F document.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let reservation: MemoryReservation | null = null;
  let reservationClosed = false;
  let session: ActiveRasterSpatialBlurSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The raster's hot texture for Point Blur is missing.");
    const sourceBounds = { ...record.contentBounds };
    const scratchBounds = spatialBlurBounds(
      sourceBounds,
      DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("The raster contains no pixels that can be blurred.");
    const pins = normalizeSpatialBlurPins(
      initialPins ?? [createInitialSpatialBlurPin(DOCUMENT_WIDTH, DOCUMENT_HEIGHT)],
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    );
    const maximumRadius = spatialBlurMaximumRadius(pins);
    const initialResultBounds = spatialBlurBounds(
      sourceBounds,
      maximumRadius,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect;
    const sourceTileMask = record.storageTileMask.slice();
    const shared = await requireSharedResources(engine.device);
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const parameterStride = Math.ceil(PARAMETER_BYTES / uniformAlignment) * uniformAlignment;
    const workspaceHeight = Math.min(DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT, DOCUMENT_HEIGHT)
      + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
    const maximumJobs = Math.ceil(scratchBounds.height / DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT);
    if (maximumJobs > PARAMETER_CAPACITY) {
      throw new Error("Point Blur: the document is too tall for the strip plan.");
    }
    const maximumDispatch = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (Number.isFinite(maximumDispatch) && [
      Math.ceil(scratchBounds.width / FIELD_WORKGROUP_WIDTH),
      Math.ceil(workspaceHeight / FIELD_WORKGROUP_HEIGHT),
      Math.ceil(scratchBounds.width / FILTER_WORKGROUP_SIZE),
      workspaceHeight,
      Math.ceil(DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT / FILTER_WORKGROUP_SIZE),
      scratchBounds.width,
    ].some((value) => value > maximumDispatch)) {
      throw new Error("Point Blur: the GPU does not support the required dispatch size.");
    }
    const memoryBytes = (
      scratchBounds.width * scratchBounds.height
      + scratchBounds.width * workspaceHeight
    ) * BYTES_PER_RGBA16F_PIXEL
      + scratchBounds.width * workspaceHeight * BYTES_PER_R32U_PIXEL
      + parameterStride * PARAMETER_CAPACITY;
    reservation = await reserveSessionMemory(engine, memoryBytes);
    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocate Point Blur layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Point Blur immutable source layer ${record.id}`,
          size: {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => sourceTexture.destroy());
        const sourceView = sourceTexture.createView({ label: "Point Blur immutable source view" });
        const intermediateTexture = engine.device.createTexture({
          label: `Point Blur horizontal workspace ${scratchBounds.width}×${workspaceHeight}`,
          size: {
            width: scratchBounds.width,
            height: workspaceHeight,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => intermediateTexture.destroy());
        const intermediateView = intermediateTexture.createView({ label: "Point Blur workspace view" });
        const fieldTexture = engine.device.createTexture({
          label: `Point Blur radius field ${scratchBounds.width}×${workspaceHeight}`,
          size: {
            width: scratchBounds.width,
            height: workspaceHeight,
            depthOrArrayLayers: 1,
          },
          format: "r32uint",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => fieldTexture.destroy());
        const fieldView = fieldTexture.createView({ label: "Point Blur radius field view" });
        const parameterBuffer = engine.device.createBuffer({
          label: "Point Blur dynamic parameters",
          size: parameterStride * PARAMETER_CAPACITY,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => parameterBuffer.destroy());
        const parameterUpload = new ArrayBuffer(parameterStride * PARAMETER_CAPACITY);
        const commonParameterEntry = {
          binding: 0,
          resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
        } as const;
        const fieldBindGroup = engine.device.createBindGroup({
          label: "Point Blur radius field bind group",
          layout: shared.fieldBindGroupLayout,
          entries: [commonParameterEntry, { binding: 1, resource: fieldView }],
        });
        const horizontalBindGroup = engine.device.createBindGroup({
          label: "Point Blur horizontal bind group",
          layout: shared.horizontalBindGroupLayout,
          entries: [
            commonParameterEntry,
            { binding: 1, resource: sourceView },
            { binding: 2, resource: intermediateView },
            { binding: 3, resource: fieldView },
            { binding: 4, resource: { buffer: shared.weightBuffer, size: WEIGHT_TABLE_BYTES } },
          ],
        });
        const verticalBindGroup = engine.device.createBindGroup({
          label: "Point Blur vertical bind group",
          layout: shared.verticalBindGroupLayout,
          entries: [
            commonParameterEntry,
            { binding: 1, resource: intermediateView },
            { binding: 2, resource: hot.view },
            { binding: 3, resource: fieldView },
            { binding: 4, resource: { buffer: shared.weightBuffer, size: WEIGHT_TABLE_BYTES } },
          ],
        });
        const created: ActiveRasterSpatialBlurSession = {
          layerId: record.id,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          intermediateTexture,
          intermediateView,
          fieldTexture,
          fieldView,
          targetTexture: hot.texture,
          targetView: hot.view,
          parameterBuffer,
          parameterStride,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadU32: new Uint32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          fieldBindGroup,
          horizontalBindGroup,
          verticalBindGroup,
          shared,
          memoryBytes,
          pins,
          resultBounds: initialResultBounds,
          resultTileMask: tileMaskCoveringRect(sourceTileMask, initialResultBounds),
          presentedBounds: null,
          requestedSerial: 1,
          encodedSerial: 0,
          previewFrame: null,
          previewInFlight: null,
          previewFault: null,
          terminal: false,
          destroyed: false,
        };
        const encoder = engine.device.createCommandEncoder({
          label: `Capture Point Blur source layer ${record.id}`,
        });
        encoder.copyTextureToTexture(
          {
            texture: hot.texture,
            origin: { x: scratchBounds.x, y: scratchBounds.y, z: 0 },
          },
          { texture: sourceTexture },
          {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
        );
        engine.device.queue.submit([encoder.finish()]);
        await engine.waitForGpuCapped("Prepare Point Blur", 60_000);
        return created;
      },
    );
    engine.memoryReservations.settle(reservation);
    reservationClosed = true;
    engine.activeRasterSpatialBlurSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus("Point Blur ready: drag the selected point or add another.", "ok");
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    if (reservation && !reservationClosed) engine.memoryReservations.release(reservation);
    let restoreError: unknown = null;
    if (session && engine.activeRasterSpatialBlurSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Point Blur startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterSpatialBlurSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Point Blur startup failed: ${errorFrom(error).message}; `
        + `recovery failed: ${errorFrom(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterSpatialBlur(
  engine: RasterSpatialBlurEngineHost,
  requestedPins: readonly Readonly<SpatialBlurPin>[],
): RasterSpatialBlurSnapshot {
  const session = engine.activeRasterSpatialBlurSession;
  if (!session) throw new Error("No Point Blur session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Point Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Point Blur is already finishing.");
  const pins = normalizeSpatialBlurPins(requestedPins, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
  if (spatialBlurPinsEqual(pins, session.pins)) return snapshot(session);
  session.pins = pins;
  const maximumRadius = spatialBlurMaximumRadius(pins);
  const resultBounds = spatialBlurBounds(
    session.sourceBounds,
    maximumRadius,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect;
  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(session.sourceTileMask, resultBounds);
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus(`Point Blur preview · ${pins.length} points…`, "working");
  return snapshot(session);
}

export async function cancelRasterSpatialBlur(
  engine: RasterSpatialBlurEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterSpatialBlurSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Point Blur is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Point Blur cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterSpatialBlurSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Point Blur canceled: the original pixels were restored.", "ok");
  return true;
}

export async function commitRasterSpatialBlur(
  engine: RasterSpatialBlurEngineHost,
): Promise<boolean> {
  const session = engine.activeRasterSpatialBlurSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Point Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Point Blur is already finishing.");
  if (session.pins.length === 0 || spatialBlurMaximumRadius(session.pins) === 0) {
    await cancelRasterSpatialBlur(engine);
    return false;
  }
  session.terminal = true;
  let historySeed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    session.terminal = false;
    await flushPreview(engine, session);
    session.terminal = true;
    const record = engine.layerStack.active;
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("The Point Blur raster's hot texture is missing.");
    historySeed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.resultTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "spatial-blur",
      pins: session.pins.map((pin) => ({ ...pin })),
      maximumRadius: spatialBlurMaximumRadius(session.pins),
      radiusQuantization: DESTRUCTIVE_SPATIAL_BLUR_RADIUS_QUANTIZATION,
      fieldStrategy: DESTRUCTIVE_SPATIAL_BLUR_FIELD_STRATEGY,
      kernelStrategy: "shared-gaussian-kernel-v1",
      precision: DESTRUCTIVE_SPATIAL_BLUR_PRECISION,
      edgeMode: DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE,
      seed: historySeed,
      baseBounds: { ...session.resultBounds },
      baseTileMask: session.resultTileMask.slice(),
    };
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    if (engine.activeStrokeProfile) engine.activeStrokeProfile.historyCommittedActions += 1;
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      session.terminal = true;
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Point Blur commit failed and rollback was incomplete: reload the page.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(historySeed);
    }
    if (rollbackError) {
      throw new Error(
        `Point Blur commit failed: ${errorFrom(error).message}; `
        + `rollback failed: ${errorFrom(rollbackError).message}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterSpatialBlurSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Point Blur applied with ${session.pins.length} points: one Undo step.`,
    "ok",
  );
  return true;
}
