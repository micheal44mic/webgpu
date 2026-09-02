/** Transactional destructive Gaussian Blur for the selected native raster layer. */
import type { BrushEngine } from "./brush-engine";
import type { LayerFormat } from "./engine-types";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
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
import { rgba8HighFrequencyQuantizationShader } from "./rgba8-high-frequency-quantization";

export const DESTRUCTIVE_GAUSSIAN_BLUR_RUNTIME_BUILD =
  "destructive-gaussian-blur-webgpu-v7-linear-packed-unorm16-finalize";
export const DESTRUCTIVE_GAUSSIAN_BLUR_PRECISION =
  "rgba16float-storage-f32-weights-and-accumulation" as const;
export const DESTRUCTIVE_GAUSSIAN_BLUR_RGBA8_PRECISION =
  "rgba8unorm-storage-linear-rgba16unorm-packed-two-pass-f32-high-frequency-output" as const;
export const DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE =
  "transparent-content-clamp-document-edge" as const;

const FILTER_WORKGROUP_SIZE = 64;
const FILTER_CACHE_LENGTH =
  FILTER_WORKGROUP_SIZE + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
const FILTER_CACHE_BYTES = FILTER_CACHE_LENGTH * 8;
const KERNEL_WEIGHT_COUNT = DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS + 1;
const KERNEL_WEIGHT_VEC4_COUNT = Math.ceil(KERNEL_WEIGHT_COUNT / 4);
const PARAMETER_WORDS = 20 + KERNEL_WEIGHT_VEC4_COUNT * 4;
const PARAMETER_BYTES = PARAMETER_WORDS * 4;
const PARAMETER_CAPACITY = 64;
const BYTES_PER_RGBA16F_PIXEL = 8;
const BYTES_PER_PACKED_RGBA16_UNORM_PIXEL = 8;

function bytesPerLayerPixel(format: LayerFormat): number {
  return format === "rgba8unorm" ? 4 : BYTES_PER_RGBA16F_PIXEL;
}

interface GaussianBlurSharedResources {
  horizontalBindGroupLayout: GPUBindGroupLayout;
  verticalBindGroupLayout: GPUBindGroupLayout;
  horizontalPipeline: GPUComputePipeline;
  verticalPipeline: GPUComputePipeline;
  finalizeBindGroupLayout: GPUBindGroupLayout | null;
  finalizePipeline: GPUComputePipeline | null;
  outputFormat: LayerFormat;
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
  readonly finalizeBindGroup: GPUBindGroup | null;
  readonly shared: GaussianBlurSharedResources;
  readonly quantizationSeed: number;
  readonly storedEncodedSrgb: boolean;
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

const sharedByDevice = new WeakMap<
  GPUDevice,
  Map<LayerFormat, Promise<GaussianBlurSharedResources>>
>();

function commonShaderSource(documentFormat: LayerFormat): string {
  const rgba8 = documentFormat === "rgba8unorm";
  return /* wgsl */ `
struct GaussianParameters {
  sourceOriginAndSize: vec4<i32>,
  buildOriginAndSize: vec4<i32>,
  targetOriginAndSize: vec4<u32>,
  kernelAndIntermediate: vec4<u32>,
  quantizationAndReserved: vec4<u32>,
  weights: array<vec4<f32>, ${KERNEL_WEIGHT_VEC4_COUNT}>,
};

const MAX_RADIUS = ${DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS}u;

@group(0) @binding(0) var<uniform> parameters: GaussianParameters;

fn kernelWeight(index: u32) -> f32 {
  return parameters.weights[index / 4u][index % 4u];
}

// RGBA8 uses exact packed 16-bit UNORM cache values. Every stored 8-bit code n
// maps to n * 257 and survives a flat-field convolution without a half-float
// wobble. The document-independent RGBA16F path keeps its native float cache.
fn packFilterTexel(value: vec4<f32>) -> vec2<u32> {
  return vec2<u32>(
    ${rgba8 ? "pack2x16unorm" : "pack2x16float"}(value.xy),
    ${rgba8 ? "pack2x16unorm" : "pack2x16float"}(value.zw)
  );
}

fn unpackFilterTexel(value: vec2<u32>) -> vec4<f32> {
  return vec4<f32>(
    ${rgba8 ? "unpack2x16unorm" : "unpack2x16float"}(value.x),
    ${rgba8 ? "unpack2x16unorm" : "unpack2x16float"}(value.y)
  );
}

${rgba8 ? /* wgsl */ `
fn gaussianSrgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn gaussianLinearToSrgbChannel(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  if (bounded <= 0.0031308) { return bounded * 12.92; }
  return 1.055 * pow(bounded, 1.0 / 2.4) - 0.055;
}

fn gaussianEncodedPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = vec3<f32>(
    gaussianSrgbToLinearChannel(straight.r),
    gaussianSrgbToLinearChannel(straight.g),
    gaussianSrgbToLinearChannel(straight.b)
  );
  return vec4<f32>(linear * alpha, alpha);
}

fn gaussianLinearPremultipliedToEncoded(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    gaussianLinearToSrgbChannel(straight.r),
    gaussianLinearToSrgbChannel(straight.g),
    gaussianLinearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

fn gaussianStorageToWorking(value: vec4<f32>) -> vec4<f32> {
  if (parameters.quantizationAndReserved.y == 0u) { return value; }
  return gaussianEncodedPremultipliedToLinear(value);
}

fn gaussianWorkingToStorage(value: vec4<f32>) -> vec4<f32> {
  if (parameters.quantizationAndReserved.y == 0u) { return value; }
  return gaussianLinearPremultipliedToEncoded(value);
}
` : ""}
`;
}

function horizontalShader(documentFormat: LayerFormat): string {
  const rgba8 = documentFormat === "rgba8unorm";
  return `${commonShaderSource(documentFormat)}
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var intermediateOutput:
  texture_storage_2d<${rgba8 ? "rg32uint" : "rgba16float"}, write>;

var<workgroup> filterCache: array<vec2<u32>, ${FILTER_CACHE_LENGTH}>;

fn sourceTexel(documentPosition: vec2<i32>) -> vec4<f32> {
  // Content remains transparent inside the document, while samples beyond the
  // actual canvas edge repeat the edge texel. This prevents a full, uniform
  // layer from losing alpha toward the inside.
  let packedDocumentExtent = parameters.kernelAndIntermediate.w;
  let documentExtent = vec2<i32>(
    i32(packedDocumentExtent & 0xffffu),
    i32(packedDocumentExtent >> 16u)
  );
  let documentMaximum = max(documentExtent - vec2<i32>(1), vec2<i32>(0));
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
  let stored = textureLoad(sourceTexture, local, 0);
  return ${rgba8 ? "gaussianStorageToWorking(stored)" : "stored"};
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
  ${rgba8 ? `
  let packedResult = packFilterTexel(result);
  textureStore(
    intermediateOutput,
    vec2<i32>(i32(outputX), i32(groupId.y)),
    vec4<u32>(packedResult, 0u, 0u)
  );` : `
  textureStore(intermediateOutput, vec2<i32>(i32(outputX), i32(groupId.y)), result);`}
}
`;
}

function verticalShader(outputFormat: LayerFormat): string {
  const rgba8 = outputFormat === "rgba8unorm";
  return `${commonShaderSource(outputFormat)}
@group(0) @binding(1) var intermediateInput: texture_2d<${rgba8 ? "u32" : "f32"}>;
@group(0) @binding(2) var outputTexture:
  texture_storage_2d<${rgba8 ? "rg32uint" : outputFormat}, write>;

var<workgroup> filterCache: array<vec2<u32>, ${FILTER_CACHE_LENGTH}>;

fn intermediateTexel(position: vec2<i32>) -> vec4<f32> {
  let size = vec2<i32>(parameters.kernelAndIntermediate.yz);
  if (any(position < vec2<i32>(0)) || any(position >= size)) {
    return vec4<f32>(0.0);
  }
  ${rgba8 ? `
  return unpackFilterTexel(textureLoad(intermediateInput, position, 0).xy);` : `
  return textureLoad(intermediateInput, position, 0);`}
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
  let outputPosition = vec2<i32>(i32(localX), i32(localY));
  ${rgba8 ? `
  let packedResult = packFilterTexel(result);
  textureStore(outputTexture, outputPosition, vec4<u32>(packedResult, 0u, 0u));` : `
  textureStore(outputTexture, outputPosition, result);`}
}
`;
}

function finalizeRgba8Shader(): string {
  return `${commonShaderSource("rgba8unorm")}
${rgba8HighFrequencyQuantizationShader}
@group(0) @binding(1) var workingTexture: texture_2d<u32>;
@group(0) @binding(2) var destinationTexture:
  texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let targetSize = parameters.targetOriginAndSize.zw;
  if (globalId.x >= targetSize.x || globalId.y >= targetSize.y) { return; }
  let localPosition = vec2<i32>(globalId.xy);
  let packed = textureLoad(workingTexture, localPosition, 0).xy;
  let working = unpackFilterTexel(packed);
  let encodedPremultiplied = gaussianWorkingToStorage(working);
  let documentPosition = parameters.targetOriginAndSize.xy + globalId.xy;
  let storedResult = quantizeRgba8HighFrequencyAdjacent(
    encodedPremultiplied,
    documentPosition,
    parameters.quantizationAndReserved.x
  );
  textureStore(destinationTexture, vec2<i32>(documentPosition), storedResult);
}
`;
}

async function createSharedResources(
  device: GPUDevice,
  outputFormat: LayerFormat,
): Promise<GaussianBlurSharedResources> {
  const availableWorkgroupStorage = Number(device.limits.maxComputeWorkgroupStorageSize);
  if (
    Number.isFinite(availableWorkgroupStorage)
    && availableWorkgroupStorage < FILTER_CACHE_BYTES
  ) {
    throw new Error(
      `Gaussian Blur requires ${FILTER_CACHE_BYTES} bytes of workgroup cache; `
      + `the GPU exposes ${availableWorkgroupStorage}.`,
    );
  }
  return runGpuAllocationTransaction(
    device,
    `Pipeline Native raster Gaussian Blur ${outputFormat}`,
    async () => {
      const horizontalModule = device.createShaderModule({
        label: "Native raster Gaussian Blur horizontal WGSL",
        code: horizontalShader(outputFormat),
      });
      const verticalModule = device.createShaderModule({
        label: "Native raster Gaussian Blur vertical WGSL",
        code: verticalShader(outputFormat),
      });
      const finalizeModule = outputFormat === "rgba8unorm"
        ? device.createShaderModule({
          label: "Native raster Gaussian Blur RGBA8 finalizer WGSL",
          code: finalizeRgba8Shader(),
        })
        : null;
      const compilationChecks = [
        assertShaderCompiled(horizontalModule, "Horizontal Gaussian Blur"),
        assertShaderCompiled(verticalModule, "Vertical Gaussian Blur"),
      ];
      if (finalizeModule) {
        compilationChecks.push(assertShaderCompiled(finalizeModule, "Gaussian Blur RGBA8 finalizer"));
      }
      await Promise.all(compilationChecks);
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
            texture: {
              sampleType: outputFormat === "rgba8unorm" ? "float" : "unfilterable-float",
            },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
              access: "write-only",
              format: outputFormat === "rgba8unorm" ? "rg32uint" : "rgba16float",
            },
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
            texture: {
              sampleType: outputFormat === "rgba8unorm" ? "uint" : "unfilterable-float",
            },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
              access: "write-only",
              format: outputFormat === "rgba8unorm" ? "rg32uint" : outputFormat,
            },
          },
        ],
      });
      const finalizeBindGroupLayout = outputFormat === "rgba8unorm"
        ? device.createBindGroupLayout({
          label: "Native raster Gaussian Blur RGBA8 finalizer layout",
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
              texture: { sampleType: "uint" },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              storageTexture: { access: "write-only", format: "rgba8unorm" },
            },
          ],
        })
        : null;
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
      const finalizePipeline = finalizeModule && finalizeBindGroupLayout
        ? device.createComputePipeline({
          label: "Native raster Gaussian Blur RGBA8 finalizer pipeline",
          layout: device.createPipelineLayout({ bindGroupLayouts: [finalizeBindGroupLayout] }),
          compute: { module: finalizeModule, entryPoint: "main" },
        })
        : null;
      return {
        horizontalBindGroupLayout,
        verticalBindGroupLayout,
        horizontalPipeline,
        verticalPipeline,
        finalizeBindGroupLayout,
        finalizePipeline,
        outputFormat,
      };
    },
  );
}

async function requireSharedResources(
  device: GPUDevice,
  outputFormat: LayerFormat,
): Promise<GaussianBlurSharedResources> {
  let variants = sharedByDevice.get(device);
  if (!variants) {
    variants = new Map();
    sharedByDevice.set(device, variants);
  }
  let promise = variants.get(outputFormat);
  if (!promise) {
    promise = createSharedResources(device, outputFormat);
    variants.set(outputFormat, promise);
  }
  try {
    return await promise;
  } catch (error) {
    variants.delete(outputFormat);
    if (variants.size === 0) sharedByDevice.delete(device);
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
  documentWidth: number,
  documentHeight: number,
): number {
  if (index >= PARAMETER_CAPACITY) {
    throw new Error("Gaussian Blur: strip capacity exceeded.");
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
  if (documentWidth > 0xffff || documentHeight > 0xffff) {
    throw new Error("Gaussian Blur: document dimensions exceed the uniform ABI.");
  }
  session.parameterUploadU32[word + 15] = (
    (documentHeight << 16) | documentWidth
  ) >>> 0;
  session.parameterUploadU32[word + 16] = session.quantizationSeed;
  session.parameterUploadU32[word + 17] = session.storedEncodedSrgb ? 1 : 0;
  session.parameterUploadU32[word + 18] = 0;
  session.parameterUploadU32[word + 19] = 0;
  session.parameterUploadF32.fill(0, word + 20, word + PARAMETER_WORDS);
  for (let offset = 0; offset < kernel.weights.length; offset += 1) {
    session.parameterUploadF32[word + 20 + offset] = kernel.weights[offset];
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
    engine.documentWidth,
    engine.documentHeight,
  ) as DirtyRect | null;
  if (!resultBounds) {
    throw new Error("Gaussian Blur: result bounds are missing.");
  }
  const dirtyRect = unionGaussianBlurRects(
    session.presentedBounds,
    resultBounds,
  ) as DirtyRect;
  const jobs = planJobs(resultBounds, kernel.radius);
  if (jobs.length > PARAMETER_CAPACITY) {
    throw new Error("Gaussian Blur: too many strips for the parameter buffer.");
  }
  const offsets = jobs.map((job, index) => writeJobParameters(
    session,
    index,
    job,
    kernel,
    engine.documentWidth,
    engine.documentHeight,
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

    if (session.shared.outputFormat === "rgba8unorm") {
      if (!session.shared.finalizePipeline || !session.finalizeBindGroup) {
        throw new Error("Gaussian Blur: the RGBA8 finalizer is unavailable.");
      }
      const finalize = encoder.beginComputePass({
        label: `Gaussian Blur RGBA8 final strip ${index + 1}/${jobs.length}`,
      });
      finalize.setPipeline(session.shared.finalizePipeline);
      finalize.setBindGroup(0, session.finalizeBindGroup, [offsets[index]]);
      finalize.dispatchWorkgroups(
        Math.ceil(job.targetWidth / 8),
        Math.ceil(job.targetHeight / 8),
      );
      finalize.end();
    } else {
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
      await engine.waitForGpuCapped(`Gaussian Blur preview ${radius}px`, 60_000);
    } catch (error) {
      session.previewFault = previewError(error);
      if (engine.activeRasterGaussianBlurSession === session) {
        engine.publishStatus(
          `Gaussian Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`,
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
  await engine.waitForGpuCapped("Cancel Gaussian Blur", 60_000);
  if (session.previewInFlight) await session.previewInFlight;
  if (presentationError) throw presentationError;
}

export async function beginRasterGaussianBlur(
  engine: BrushEngine,
  initialRadius = DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
): Promise<RasterGaussianBlurSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterGaussianBlurSession) {
    return snapshot(engine.activeRasterGaussianBlurSession);
  }
  engine.assertDestructiveRasterEditCanOpen("gaussian-blur");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("The selected raster does not match the active layer.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Gaussian Blur v1 works on the entire layer: deselect the pixels before opening it.",
    );
  }
  engine.assertLayerSwitchAllowed();
  engine.persistActiveLayerState();
  if (!record.hasContent || !record.contentBounds) {
    throw new Error("The selected raster layer is empty.");
  }
  engine.cancelLayerColdCompressionIdle();
  engine.historyBusy = true;
  engine.publishHistoryState();
  let session: ActiveRasterGaussianBlurSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The hot texture for the raster to blur is missing.");
    const sourceBounds = { ...record.contentBounds };
    const scratchBounds = destructiveGaussianBlurBounds(
      sourceBounds,
      DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
      engine.documentWidth,
      engine.documentHeight,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("The raster contains no pixels that can be blurred.");
    const radius = normalizeDestructiveGaussianBlurRadius(initialRadius);
    const initialResultBounds = destructiveGaussianBlurBounds(
      sourceBounds,
      radius,
      engine.documentWidth,
      engine.documentHeight,
    ) as DirtyRect;
    const sourceTileMask = record.storageTileMask.slice();
    const shared = await requireSharedResources(engine.device, engine.layerFormat);
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const parameterStride = Math.ceil(PARAMETER_BYTES / uniformAlignment) * uniformAlignment;
    const intermediateHeight = Math.min(
      DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
      engine.documentHeight,
    ) + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
    const outputHeight = Math.min(
      DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
      engine.documentHeight,
    );
    const maximumJobs = Math.ceil(scratchBounds.height / DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT);
    if (maximumJobs > PARAMETER_CAPACITY) {
      throw new Error("Gaussian Blur: the document is too tall for the strip plan.");
    }
    const maximumDispatch = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    if (Number.isFinite(maximumDispatch) && [
      Math.ceil(scratchBounds.width / FILTER_WORKGROUP_SIZE),
      intermediateHeight,
      Math.ceil(outputHeight / FILTER_WORKGROUP_SIZE),
      scratchBounds.width,
    ].some((value) => value > maximumDispatch)) {
      throw new Error("Gaussian Blur: the GPU does not support the required dispatch size.");
    }

    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocate Native raster Gaussian Blur layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Gaussian Blur immutable source layer ${record.id}`,
          size: {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
          format: engine.layerFormat,
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
          format: engine.layerFormat === "rgba8unorm" ? "rg32uint" : "rgba16float",
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
          format: engine.layerFormat === "rgba8unorm" ? "rg32uint" : "rgba16float",
          usage: engine.layerFormat === "rgba8unorm"
            ? GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
            : GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
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
        const finalizeBindGroup = shared.finalizeBindGroupLayout
          ? engine.device.createBindGroup({
            label: "Native raster Gaussian Blur RGBA8 finalizer bind group",
            layout: shared.finalizeBindGroupLayout,
            entries: [
              {
                binding: 0,
                resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
              },
              { binding: 1, resource: outputView },
              { binding: 2, resource: hot.view },
            ],
          })
          : null;
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
          finalizeBindGroup,
          shared,
          quantizationSeed: engine.nextHistoryActionId >>> 0,
          storedEncodedSrgb:
            engine.documentStorageColorSpace === "encoded-srgb-premultiplied",
          memoryBytes:
            scratchBounds.width * scratchBounds.height
              * bytesPerLayerPixel(engine.layerFormat)
            + scratchBounds.width * intermediateHeight
              * (engine.layerFormat === "rgba8unorm"
                ? BYTES_PER_PACKED_RGBA16_UNORM_PIXEL
                : BYTES_PER_RGBA16F_PIXEL)
            + scratchBounds.width * outputHeight
              * (engine.layerFormat === "rgba8unorm"
                ? BYTES_PER_PACKED_RGBA16_UNORM_PIXEL
                : BYTES_PER_RGBA16F_PIXEL)
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
        await engine.waitForGpuCapped("Prepare Gaussian Blur", 60_000);
        return created;
      },
    );
    engine.activeRasterGaussianBlurSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus(
      `Gaussian Blur preview ${radius.toFixed(0)} px: Apply or Cancel.`,
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
          "Gaussian Blur startup failed and recovery was incomplete: reload the page.",
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
        `Gaussian Blur startup failed: ${operationMessage}; recovery failed: ${restoreMessage}`,
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
  if (!session) throw new Error("No Gaussian Blur session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Gaussian Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Gaussian Blur is already finishing.");
  const normalized = normalizeDestructiveGaussianBlurRadius(radius);
  if (normalized === session.radius) return snapshot(session);
  session.radius = normalized;
  const result = destructiveGaussianBlurBounds(
    session.sourceBounds,
    normalized,
    engine.documentWidth,
    engine.documentHeight,
  ) as DirtyRect;
  session.resultBounds = result;
  session.resultTileMask = tileMaskCoveringRect(
    session.sourceTileMask,
    result,
  );
  session.requestedSerial += 1;
  schedulePreview(engine, session);
  engine.publishStatus(`Gaussian Blur preview ${normalized.toFixed(0)} px…`, "working");
  return snapshot(session);
}

export async function cancelRasterGaussianBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterGaussianBlurSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Gaussian Blur is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Gaussian Blur cancellation failed: reload the page.",
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
  engine.publishStatus("Gaussian Blur canceled: the original pixels were restored.", "ok");
  return true;
}

export async function commitRasterGaussianBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterGaussianBlurSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Gaussian Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Gaussian Blur is already finishing.");
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
    if (!hot) throw new Error("The blurred raster's hot texture is missing.");
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
      precision: engine.layerFormat === "rgba8unorm"
        ? "rgba8unorm-linear-rgba16unorm-packed-two-pass-f32-high-frequency-output"
        : "rgba16float-f32-accumulation",
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
        "Gaussian Blur commit failed and rollback was incomplete: reload the page.",
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
        `Gaussian Blur commit failed: ${operationMessage}; rollback failed: ${rollbackMessage}`,
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
    `Gaussian Blur ${session.radius.toFixed(0)} px applied to the pixels: one Undo step.`,
    "ok",
  );
  return true;
}
