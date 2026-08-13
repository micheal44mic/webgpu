/** Transactional destructive Gaussian Blur for the selected native raster layer. */
import type { BrushEngine } from "./brush-engine";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-residency-runtime";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-resources-runtime";
import {
  DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
  destructiveGaussianBlurBounds,
  destructiveGaussianBlurKernel,
  normalizeDestructiveGaussianBlurRadius,
  unionGaussianBlurRects,
  type GaussianBlurKernel,
} from "./gaussian-blur-core";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { tileMaskCoveringRect } from "./raster-transform-math";

export const DESTRUCTIVE_GAUSSIAN_BLUR_RUNTIME_BUILD =
  "destructive-gaussian-blur-webgpu-v3-document-edge-clamp-rgba16float-packed-cache";
export const DESTRUCTIVE_GAUSSIAN_BLUR_PRECISION =
  "rgba16float-storage-f32-weights-and-accumulation" as const;
export const DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE =
  "transparent-content-clamp-document-edge" as const;

const FILTER_WORKGROUP_SIZE = 64;
const FILTER_CACHE_LENGTH =
  FILTER_WORKGROUP_SIZE + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
const FILTER_CACHE_BYTES = FILTER_CACHE_LENGTH * 8;
const KERNEL_WEIGHT_COUNT = DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS + 1;
const KERNEL_WEIGHT_VEC4_COUNT = Math.ceil(KERNEL_WEIGHT_COUNT / 4);
const PARAMETER_WORDS = 16 + KERNEL_WEIGHT_VEC4_COUNT * 4;
const PARAMETER_BYTES = PARAMETER_WORDS * 4;
const PARAMETER_CAPACITY = 64;
const BYTES_PER_RGBA16F_PIXEL = 8;

interface GaussianBlurSharedResources {
  horizontalBindGroupLayout: GPUBindGroupLayout;
  verticalBindGroupLayout: GPUBindGroupLayout;
  horizontalPipeline: GPUComputePipeline;
  verticalPipeline: GPUComputePipeline;
}

interface GaussianBlurJob {
  readonly buildOriginY: number;
  readonly buildHeight: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
}

export interface RasterGaussianBlurSnapshot {
  readonly layerId: number;
  readonly radius: number;
  readonly sigma: number;
  readonly supportRadius: number;
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterGaussianBlurSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly intermediateTexture: GPUTexture;
  readonly intermediateView: GPUTextureView;
  readonly outputTexture: GPUTexture;
  readonly outputView: GPUTextureView;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterStride: number;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadU32: Uint32Array;
  readonly parameterUploadF32: Float32Array;
  readonly horizontalBindGroup: GPUBindGroup;
  readonly verticalBindGroup: GPUBindGroup;
  readonly shared: GaussianBlurSharedResources;
  readonly memoryBytes: number;
  radius: number;
  resultBounds: DirtyRect;
  resultTileMask: Uint32Array;
  presentedBounds: DirtyRect | null;
  requestedSerial: number;
  encodedSerial: number;
  previewFrame: number | null;
  previewInFlight: Promise<void> | null;
  previewFault: Error | null;
  terminal: boolean;
}

const sharedByDevice = new WeakMap<GPUDevice, Promise<GaussianBlurSharedResources>>();

function commonShaderSource(): string {
  return /* wgsl */ `
struct GaussianParameters {
  sourceOriginAndSize: vec4<i32>,
  buildOriginAndSize: vec4<i32>,
  targetOriginAndSize: vec4<u32>,
  kernelAndIntermediate: vec4<u32>,
  weights: array<vec4<f32>, ${KERNEL_WEIGHT_VEC4_COUNT}>,
};

const MAX_RADIUS = ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}u;

@group(0) @binding(0) var<uniform> parameters: GaussianParameters;

fn kernelWeight(index: u32) -> f32 {
  return parameters.weights[index / 4u][index % 4u];
}

// Le texture di ingresso sono gia' RGBA16F. Conservare la cache workgroup
// nello stesso formato non perde precisione rispetto alla sorgente, dimezza
// lo storage condiviso e lascia pesi e accumulo in f32.
fn packFilterTexel(value: vec4<f32>) -> vec2<u32> {
  return vec2<u32>(pack2x16float(value.xy), pack2x16float(value.zw));
}

fn unpackFilterTexel(value: vec2<u32>) -> vec4<f32> {
  return vec4<f32>(unpack2x16float(value.x), unpack2x16float(value.y));
}
`;
}

function horizontalShader(): string {
  return `${commonShaderSource()}
const DOCUMENT_EXTENT = vec2<i32>(${DOCUMENT_WIDTH}, ${DOCUMENT_HEIGHT});

@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var intermediateOutput:
  texture_storage_2d<rgba16float, write>;

var<workgroup> filterCache: array<vec2<u32>, ${FILTER_CACHE_LENGTH}>;

fn sourceTexel(documentPosition: vec2<i32>) -> vec4<f32> {
  // Il contenuto resta trasparente dentro il documento, ma i campioni che
  // oltrepassano il vero bordo del canvas replicano il texel di bordo. Cosi'
  // un livello pieno e uniforme non perde alpha verso l'interno.
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
  return textureLoad(sourceTexture, local, 0);
}

@compute @workgroup_size(${FILTER_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  let targetWidth = parameters.targetOriginAndSize.z;
  let buildHeight = u32(parameters.buildOriginAndSize.w);
  if (groupId.y >= buildHeight) {
    return;
  }
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${FILTER_CACHE_LENGTH}u;
    cacheIndex += ${FILTER_WORKGROUP_SIZE}u
  ) {
    let documentX = parameters.buildOriginAndSize.x
      + i32(groupId.x * ${FILTER_WORKGROUP_SIZE}u + cacheIndex)
      - ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS};
    let documentY = parameters.buildOriginAndSize.y + i32(groupId.y);
    filterCache[cacheIndex] = packFilterTexel(sourceTexel(vec2<i32>(documentX, documentY)));
  }
  workgroupBarrier();

  let outputX = groupId.x * ${FILTER_WORKGROUP_SIZE}u + localId.x;
  if (outputX >= targetWidth) {
    return;
  }
  let center = ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}u + localId.x;
  var result = unpackFilterTexel(filterCache[center]) * kernelWeight(0u);
  for (var offset = 1u; offset <= MAX_RADIUS; offset += 1u) {
    if (offset > parameters.kernelAndIntermediate.x) {
      break;
    }
    let weight = kernelWeight(offset);
    result += unpackFilterTexel(filterCache[center - offset]) * weight;
    result += unpackFilterTexel(filterCache[center + offset]) * weight;
  }
  textureStore(intermediateOutput, vec2<i32>(i32(outputX), i32(groupId.y)), result);
}
`;
}

function verticalShader(): string {
  return `${commonShaderSource()}
@group(0) @binding(1) var intermediateInput: texture_2d<f32>;
@group(0) @binding(2) var outputTexture:
  texture_storage_2d<rgba16float, write>;

var<workgroup> filterCache: array<vec2<u32>, ${FILTER_CACHE_LENGTH}>;

fn intermediateTexel(position: vec2<i32>) -> vec4<f32> {
  let size = vec2<i32>(parameters.kernelAndIntermediate.yz);
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
  if (localX >= targetWidth) {
    return;
  }
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${FILTER_CACHE_LENGTH}u;
    cacheIndex += ${FILTER_WORKGROUP_SIZE}u
  ) {
    let sourceY = i32(groupId.x * ${FILTER_WORKGROUP_SIZE}u + cacheIndex)
      + i32(parameters.kernelAndIntermediate.x)
      - ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS};
    filterCache[cacheIndex] = packFilterTexel(
      intermediateTexel(vec2<i32>(i32(localX), sourceY))
    );
  }
  workgroupBarrier();

  let localY = groupId.x * ${FILTER_WORKGROUP_SIZE}u + localId.x;
  if (localY >= targetHeight) {
    return;
  }
  let center = ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}u + localId.x;
  var result = unpackFilterTexel(filterCache[center]) * kernelWeight(0u);
  for (var offset = 1u; offset <= MAX_RADIUS; offset += 1u) {
    if (offset > parameters.kernelAndIntermediate.x) {
      break;
    }
    let weight = kernelWeight(offset);
    result += unpackFilterTexel(filterCache[center - offset]) * weight;
    result += unpackFilterTexel(filterCache[center + offset]) * weight;
  }
  textureStore(outputTexture, vec2<i32>(i32(localX), i32(localY)), result);
}
`;
}

async function createSharedResources(device: GPUDevice): Promise<GaussianBlurSharedResources> {
  const availableWorkgroupStorage = Number(device.limits.maxComputeWorkgroupStorageSize);
  if (
    Number.isFinite(availableWorkgroupStorage)
    && availableWorkgroupStorage < FILTER_CACHE_BYTES
  ) {
    throw new Error(
      `Gaussian Blur richiede ${FILTER_CACHE_BYTES} byte di cache workgroup; `
      + `la GPU ne espone ${availableWorkgroupStorage}.`,
    );
  }
  return runGpuAllocationTransaction(
    device,
    "Pipeline Native raster Gaussian Blur RGBA16F",
    async () => {
      const horizontalModule = device.createShaderModule({
        label: "Native raster Gaussian Blur horizontal WGSL",
        code: horizontalShader(),
      });
      const verticalModule = device.createShaderModule({
        label: "Native raster Gaussian Blur vertical WGSL",
        code: verticalShader(),
      });
      await Promise.all([
        assertShaderCompiled(horizontalModule, "Gaussian Blur orizzontale"),
        assertShaderCompiled(verticalModule, "Gaussian Blur verticale"),
      ]);
      const horizontalBindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Gaussian Blur horizontal layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: PARAMETER_BYTES,
            },
          },
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
        ],
      });
      const verticalBindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Gaussian Blur vertical layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: {
              type: "uniform",
              hasDynamicOffset: true,
              minBindingSize: PARAMETER_BYTES,
            },
          },
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
        ],
      });
      const horizontalPipeline = device.createComputePipeline({
        label: "Native raster Gaussian Blur horizontal pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [horizontalBindGroupLayout] }),
        compute: { module: horizontalModule, entryPoint: "main" },
      });
      const verticalPipeline = device.createComputePipeline({
        label: "Native raster Gaussian Blur vertical pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [verticalBindGroupLayout] }),
        compute: { module: verticalModule, entryPoint: "main" },
      });
      return {
        horizontalBindGroupLayout,
        verticalBindGroupLayout,
        horizontalPipeline,
        verticalPipeline,
      };
    },
  );
}

async function requireSharedResources(device: GPUDevice): Promise<GaussianBlurSharedResources> {
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

function snapshot(session: ActiveRasterGaussianBlurSession): RasterGaussianBlurSnapshot {
  const kernel = destructiveGaussianBlurKernel(session.radius);
  return {
    layerId: session.layerId,
    radius: session.radius,
    sigma: kernel.sigma,
    supportRadius: kernel.radius,
    sourceBounds: { ...session.sourceBounds },
    resultBounds: { ...session.resultBounds },
    memoryBytes: session.memoryBytes,
  };
}

function setAuthoritativeMetadata(
  engine: BrushEngine,
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

function planJobs(rect: DirtyRect, radius: number): GaussianBlurJob[] {
  const jobs: GaussianBlurJob[] = [];
  const bottom = rect.y + rect.height;
  for (
    let targetY = rect.y;
    targetY < bottom;
    targetY += DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT
  ) {
    const targetHeight = Math.min(
      DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
      bottom - targetY,
    );
    jobs.push({
      buildOriginY: targetY - radius,
      buildHeight: targetHeight + radius * 2,
      targetX: rect.x,
      targetY,
      targetWidth: rect.width,
      targetHeight,
    });
  }
  return jobs;
}

function writeJobParameters(
  session: ActiveRasterGaussianBlurSession,
  index: number,
  job: GaussianBlurJob,
  kernel: GaussianBlurKernel,
): number {
  if (index >= PARAMETER_CAPACITY) {
    throw new Error("Gaussian Blur: capacità strip superata.");
  }
  const byteOffset = index * session.parameterStride;
  const word = byteOffset / 4;
  const source = session.scratchBounds;
  session.parameterUploadI32[word] = source.x;
  session.parameterUploadI32[word + 1] = source.y;
  session.parameterUploadI32[word + 2] = source.width;
  session.parameterUploadI32[word + 3] = source.height;
  session.parameterUploadI32[word + 4] = job.targetX;
  session.parameterUploadI32[word + 5] = job.buildOriginY;
  session.parameterUploadI32[word + 6] = job.targetWidth;
  session.parameterUploadI32[word + 7] = job.buildHeight;
  session.parameterUploadU32[word + 8] = job.targetX;
  session.parameterUploadU32[word + 9] = job.targetY;
  session.parameterUploadU32[word + 10] = job.targetWidth;
  session.parameterUploadU32[word + 11] = job.targetHeight;
  session.parameterUploadU32[word + 12] = kernel.radius;
  session.parameterUploadU32[word + 13] = job.targetWidth;
  session.parameterUploadU32[word + 14] = job.buildHeight;
  session.parameterUploadU32[word + 15] = 0;
  session.parameterUploadF32.fill(0, word + 16, word + PARAMETER_WORDS);
  for (let offset = 0; offset < kernel.weights.length; offset += 1) {
    session.parameterUploadF32[word + 16 + offset] = kernel.weights[offset];
  }
  return byteOffset;
}

function destroySessionResources(session: ActiveRasterGaussianBlurSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.intermediateTexture.destroy();
  session.outputTexture.destroy();
  session.parameterBuffer.destroy();
}

function previewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function encodeRequestedPreview(
  engine: BrushEngine,
  session: ActiveRasterGaussianBlurSession,
  serial: number,
  radius: number,
): void {
  if (engine.activeRasterGaussianBlurSession !== session) return;
  if (session.encodedSerial === serial) return;

  const kernel = destructiveGaussianBlurKernel(radius);
  const resultBounds = destructiveGaussianBlurBounds(
    session.sourceBounds,
    radius,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (!resultBounds) {
    throw new Error("Gaussian Blur: bounds risultato mancanti.");
  }
  const dirtyRect = unionGaussianBlurRects(
    session.presentedBounds,
    resultBounds,
  ) as DirtyRect;
  const jobs = planJobs(resultBounds, kernel.radius);
  if (jobs.length > PARAMETER_CAPACITY) {
    throw new Error("Gaussian Blur: troppe strip per il buffer parametri.");
  }
  const offsets = jobs.map((job, index) => writeJobParameters(
    session,
    index,
    job,
    kernel,
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
    label: `Native raster Gaussian Blur preview ${radius}px`,
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
      texture: engine.layerTexture,
      origin: { x: dirtyRect.x, y: dirtyRect.y, z: 0 },
    },
    { width: dirtyRect.width, height: dirtyRect.height, depthOrArrayLayers: 1 },
  );

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const horizontal = encoder.beginComputePass({
      label: `Gaussian Blur horizontal strip ${index + 1}/${jobs.length}`,
    });
    horizontal.setPipeline(session.shared.horizontalPipeline);
    horizontal.setBindGroup(0, session.horizontalBindGroup, [offsets[index]]);
    horizontal.dispatchWorkgroups(
      Math.ceil(job.targetWidth / FILTER_WORKGROUP_SIZE),
      job.buildHeight,
    );
    horizontal.end();

    const vertical = encoder.beginComputePass({
      label: `Gaussian Blur vertical strip ${index + 1}/${jobs.length}`,
    });
    vertical.setPipeline(session.shared.verticalPipeline);
    vertical.setBindGroup(0, session.verticalBindGroup, [offsets[index]]);
    vertical.dispatchWorkgroups(
      Math.ceil(job.targetHeight / FILTER_WORKGROUP_SIZE),
      job.targetWidth,
    );
    vertical.end();

    encoder.copyTextureToTexture(
      { texture: session.outputTexture },
      {
        texture: engine.layerTexture,
        origin: { x: job.targetX, y: job.targetY, z: 0 },
      },
      {
        width: job.targetWidth,
        height: job.targetHeight,
        depthOrArrayLayers: 1,
      },
    );
  }
  engine.device.queue.submit([encoder.finish()]);

  session.resultBounds = resultBounds;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    resultBounds,
  );
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  engine.submitImmediate([], false, engine.settings, true, null, dirtyRect, false);
  setAuthoritativeMetadata(engine, resultBounds, session.resultTileMask);
  session.presentedBounds = { ...resultBounds };
  session.encodedSerial = serial;
  publishMixedScene(engine);
  engine.publishStats();
}

function startPreviewSubmission(
  engine: BrushEngine,
  session: ActiveRasterGaussianBlurSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterGaussianBlurSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const radius = session.radius;
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, radius);
      await engine.waitForGpuCapped(`Anteprima Gaussian Blur ${radius}px`, 60_000);
    } catch (error) {
      session.previewFault = previewError(error);
      if (engine.activeRasterGaussianBlurSession === session) {
        engine.publishStatus(
          `Anteprima Gaussian Blur interrotta: ${session.previewFault.message}. Usa Annulla.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterGaussianBlurSession === session
        && !session.terminal
        && !session.previewFault
        && session.encodedSerial !== session.requestedSerial
      ) {
        schedulePreview(engine, session);
      }
    }
  });
  session.previewInFlight = completion;
  return completion;
}

function schedulePreview(
  engine: BrushEngine,
  session: ActiveRasterGaussianBlurSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterGaussianBlurSession !== session
      || session.terminal
      || session.previewFault
    ) {
      return;
    }
    void startPreviewSubmission(engine, session);
  });
}

async function flushPreview(
  engine: BrushEngine,
  session: ActiveRasterGaussianBlurSession,
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
  engine: BrushEngine,
  session: ActiveRasterGaussianBlurSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  const encoder = engine.device.createCommandEncoder({
    label: `Cancel Native raster Gaussian Blur layer ${session.layerId}`,
  });
  encoder.copyTextureToTexture(
    { texture: session.sourceTexture },
    {
      texture: engine.layerTexture,
      origin: { x: session.scratchBounds.x, y: session.scratchBounds.y, z: 0 },
    },
    {
      width: session.scratchBounds.width,
      height: session.scratchBounds.height,
      depthOrArrayLayers: 1,
    },
  );
  engine.device.queue.submit([encoder.finish()]);
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  let presentationError: unknown = null;
  try {
    engine.submitImmediate(
      [],
      false,
      engine.settings,
      true,
      null,
      session.scratchBounds,
      false,
    );
  } catch (error) {
    presentationError = error;
  }
  setAuthoritativeMetadata(engine, session.sourceBounds, session.sourceTileMask);
  await engine.waitForGpuCapped("Annullamento Gaussian Blur", 60_000);
  if (session.previewInFlight) await session.previewInFlight;
  if (presentationError) throw presentationError;
}

export async function beginRasterGaussianBlur(
  engine: BrushEngine,
  initialRadius = DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
): Promise<RasterGaussianBlurSnapshot | null> {
  if (!engine.initialized) throw new Error("Il motore non è ancora inizializzato.");
  if (engine.activeRasterGaussianBlurSession) {
    return snapshot(engine.activeRasterGaussianBlurSession);
  }
  engine.assertDestructiveRasterEditCanOpen("gaussian-blur");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("Il raster selezionato non coincide con il livello attivo.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Gaussian Blur v1 lavora sull’intero livello: deseleziona i pixel prima di aprirlo.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("Il livello raster selezionato è vuoto.");
  }
  if (engine.layerFormat !== "rgba16float") {
    throw new Error("Gaussian Blur distruttivo richiede un documento RGBA16F.");
  }

  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterGaussianBlurSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("Texture hot del raster da sfocare mancante.");
    const sourceBounds = { ...record.contentBounds };
    const scratchBounds = destructiveGaussianBlurBounds(
      sourceBounds,
      DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("Il raster non contiene pixel sfocabili.");
    const radius = normalizeDestructiveGaussianBlurRadius(initialRadius);
    const initialResultBounds = destructiveGaussianBlurBounds(
      sourceBounds,
      radius,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect;
    const sourceTileMask = record.storageTileMask.slice();
    const shared = await requireSharedResources(engine.device);
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const parameterStride = Math.ceil(PARAMETER_BYTES / uniformAlignment) * uniformAlignment;
    const intermediateHeight = Math.min(
      DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
      DOCUMENT_HEIGHT,
    ) + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
    const outputHeight = Math.min(DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT, DOCUMENT_HEIGHT);
    const maximumJobs = Math.ceil(scratchBounds.height / DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT);
    if (maximumJobs > PARAMETER_CAPACITY) {
      throw new Error("Gaussian Blur: documento troppo alto per il piano strip.");
    }
    const maximumDispatch = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (Number.isFinite(maximumDispatch) && [
      Math.ceil(scratchBounds.width / FILTER_WORKGROUP_SIZE),
      intermediateHeight,
      Math.ceil(outputHeight / FILTER_WORKGROUP_SIZE),
      scratchBounds.width,
    ].some((value) => value > maximumDispatch)) {
      throw new Error("Gaussian Blur: dimensione dispatch non supportata dalla GPU.");
    }

    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocazione Native raster Gaussian Blur layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Gaussian Blur immutable source layer ${record.id}`,
          size: {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage:
            GPUTextureUsage.COPY_SRC
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => sourceTexture.destroy());
        const sourceView = sourceTexture.createView({
          label: "Native raster Gaussian Blur immutable source view",
        });
        const intermediateTexture = engine.device.createTexture({
          label: `Native raster Gaussian Blur horizontal strip ${scratchBounds.width}×${intermediateHeight}`,
          size: {
            width: scratchBounds.width,
            height: intermediateHeight,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => intermediateTexture.destroy());
        const intermediateView = intermediateTexture.createView({
          label: "Native raster Gaussian Blur horizontal strip view",
        });
        const outputTexture = engine.device.createTexture({
          label: `Native raster Gaussian Blur vertical strip ${scratchBounds.width}×${outputHeight}`,
          size: {
            width: scratchBounds.width,
            height: outputHeight,
            depthOrArrayLayers: 1,
          },
          format: "rgba16float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        transaction.deferRollback(() => outputTexture.destroy());
        const outputView = outputTexture.createView({
          label: "Native raster Gaussian Blur vertical strip view",
        });
        const parameterBuffer = engine.device.createBuffer({
          label: "Native raster Gaussian Blur dynamic parameters",
          size: parameterStride * PARAMETER_CAPACITY,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => parameterBuffer.destroy());
        const horizontalBindGroup = engine.device.createBindGroup({
          label: "Native raster Gaussian Blur horizontal bind group",
          layout: shared.horizontalBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
            },
            { binding: 1, resource: sourceView },
            { binding: 2, resource: intermediateView },
          ],
        });
        const verticalBindGroup = engine.device.createBindGroup({
          label: "Native raster Gaussian Blur vertical bind group",
          layout: shared.verticalBindGroupLayout,
          entries: [
            {
              binding: 0,
              resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
            },
            { binding: 1, resource: intermediateView },
            { binding: 2, resource: outputView },
          ],
        });
        const parameterUpload = new ArrayBuffer(parameterStride * PARAMETER_CAPACITY);
        const created: ActiveRasterGaussianBlurSession = {
          layerId: record.id,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          intermediateTexture,
          intermediateView,
          outputTexture,
          outputView,
          parameterBuffer,
          parameterStride,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadU32: new Uint32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          horizontalBindGroup,
          verticalBindGroup,
          shared,
          memoryBytes:
            (scratchBounds.width * scratchBounds.height
              + scratchBounds.width * intermediateHeight
              + scratchBounds.width * outputHeight) * BYTES_PER_RGBA16F_PIXEL
            + parameterStride * PARAMETER_CAPACITY,
          radius,
          resultBounds: initialResultBounds,
          resultTileMask: tileMaskCoveringRect(
            sourceTileMask,
            initialResultBounds,
          ),
          presentedBounds: null,
          requestedSerial: 1,
          encodedSerial: 0,
          previewFrame: null,
          previewInFlight: null,
          previewFault: null,
          terminal: false,
        };
        const encoder = engine.device.createCommandEncoder({
          label: `Capture Native raster Gaussian Blur source layer ${record.id}`,
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
        await engine.waitForGpuCapped("Preparazione Gaussian Blur", 60_000);
        return created;
      },
    );
    engine.activeRasterGaussianBlurSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus(
      `Anteprima Gaussian Blur ${radius.toFixed(0)} px: Applica o Annulla.`,
      "ok",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterGaussianBlurSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Avvio Gaussian Blur fallito e ripristino incompleto: ricarica la pagina.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterGaussianBlurSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      const operationMessage = previewError(error).message;
      const restoreMessage = previewError(restoreError).message;
      throw new Error(
        `Avvio Gaussian Blur fallito: ${operationMessage}; ripristino fallito: ${restoreMessage}`,
      );
    }
    throw error;
  }
}

export function updateRasterGaussianBlur(
  engine: BrushEngine,
  radius: unknown,
): RasterGaussianBlurSnapshot {
  const session = engine.activeRasterGaussianBlurSession;
  if (!session) throw new Error("Nessuna sessione Gaussian Blur aperta.");
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Gaussian Blur interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Gaussian Blur sta già terminando.");
  const normalized = normalizeDestructiveGaussianBlurRadius(radius);
  if (normalized === session.radius) return snapshot(session);
  session.radius = normalized;
  const result = destructiveGaussianBlurBounds(
    session.sourceBounds,
    normalized,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect;
  session.resultBounds = result;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    result,
  );
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus(`Anteprima Gaussian Blur ${normalized.toFixed(0)} px…`, "working");
  return snapshot(session);
}

export async function cancelRasterGaussianBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterGaussianBlurSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Gaussian Blur sta già terminando.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Annullamento Gaussian Blur fallito: ricarica la pagina.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterGaussianBlurSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus("Gaussian Blur annullato: i pixel originali sono stati ripristinati.", "ok");
  return true;
}

export async function commitRasterGaussianBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterGaussianBlurSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("Documento bloccato: è consentito soltanto ritentare Annulla.");
  }
  if (session.previewFault) {
    throw new Error(`Anteprima Gaussian Blur interrotta: ${session.previewFault.message}. Usa Annulla.`);
  }
  if (session.terminal) throw new Error("Gaussian Blur sta già terminando.");
  if (session.radius === 0) {
    await cancelRasterGaussianBlur(engine);
    return false;
  }
  session.terminal = true;
  let seed = null;
  let journalPublished = false;
  let retainSessionForRecovery = false;
  try {
    await flushPreview(engine, session);
    const record = engine.layerStack.active;
    const hot = engine.requireLayerGpu(session.layerId).hot;
    if (!hot) throw new Error("Texture hot del raster sfocato mancante.");
    seed = await createLayerColdStorageCandidate(
      engine,
      record,
      hot,
      session.resultTileMask.slice(),
      engine.nextHistoryActionId,
      "history",
    );
    const kernel = destructiveGaussianBlurKernel(session.radius);
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "gaussian-blur",
      radius: session.radius,
      sigma: kernel.sigma,
      supportRadius: kernel.radius,
      precision: "rgba16float-f32-accumulation",
      edgeMode: DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE,
      seed,
      baseBounds: { ...session.resultBounds },
      baseTileMask: session.resultTileMask.slice(),
    };
    commitHistoryActionAtomically(engine, action);
    journalPublished = true;
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.historyCommittedActions += 1;
    }
  } catch (error) {
    let rollbackError: unknown = null;
    try {
      await restoreOriginalPixels(engine, session);
    } catch (restoreError) {
      rollbackError = restoreError;
      retainSessionForRecovery = true;
      session.terminal = false;
      engine.latchDocumentStateInconsistent(
        "Commit Gaussian Blur fallito e rollback incompleto: ricarica la pagina.",
      );
    } finally {
      if (!journalPublished) destroyLayerColdStorage(seed);
    }
    if (rollbackError) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(
        `Commit Gaussian Blur fallito: ${operationMessage}; rollback fallito: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterGaussianBlurSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Gaussian Blur ${session.radius.toFixed(0)} px applicato ai pixel: un solo Undo.`,
    "ok",
  );
  return true;
}
