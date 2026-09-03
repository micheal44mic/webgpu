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
  DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS,
  destructiveGaussianBlurBounds,
  destructiveGaussianBlurKernel,
  destructiveTentBlurPlan,
  normalizeDestructiveGaussianBlurRadius,
  unionGaussianBlurRects,
  type DestructiveGaussianBlurStrategy,
  type DestructiveTentBlurPlan,
  type GaussianBlurKernel,
} from "./gaussian-blur-core";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import { tileMaskCoveringRect } from "./raster-transform-math";
import { rgba8HighFrequencyQuantizationShader } from "./rgba8-high-frequency-quantization";

export type { DestructiveGaussianBlurStrategy } from "./gaussian-blur-core";

export const DESTRUCTIVE_GAUSSIAN_BLUR_RUNTIME_BUILD =
  "destructive-blur-webgpu-v8-baseline-gaussian-optimized-continuous-tent";
export const DESTRUCTIVE_GAUSSIAN_BLUR_PRECISION =
  "rgba16float-storage-f32-weights-and-accumulation" as const;
export const DESTRUCTIVE_GAUSSIAN_BLUR_RGBA8_PRECISION =
  "rgba8unorm-storage-linear-rgba16unorm-packed-two-pass-f32-high-frequency-output" as const;
export const DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE =
  "transparent-content-clamp-document-edge" as const;
export const DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_STRATEGY =
  "optimized-tent" as const satisfies DestructiveGaussianBlurStrategy;
export const DESTRUCTIVE_TENT_BLUR_RGBA8_COLOR_DOMAIN =
  "stored-encoded-premultiplied" as const;
export const DESTRUCTIVE_TENT_BLUR_LINEAR_COLOR_DOMAIN =
  "linear-premultiplied" as const;

const FILTER_WORKGROUP_SIZE = 64;
const OPTIMIZED_FILTER_WORKGROUP_SIZE = 8;
const OPTIMIZED_TARGET_STRIP_WIDTH = 1024;
const OPTIMIZED_WORK_MARGIN = 1;
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
  strategy: DestructiveGaussianBlurStrategy;
  horizontalBindGroupLayout: GPUBindGroupLayout;
  verticalBindGroupLayout: GPUBindGroupLayout;
  horizontalPipeline: GPUComputePipeline;
  verticalPipeline: GPUComputePipeline;
  finalizeBindGroupLayout: GPUBindGroupLayout | null;
  finalizePipeline: GPUComputePipeline | null;
  downsampleBindGroupLayout: GPUBindGroupLayout | null;
  downsamplePipeline: GPUComputePipeline | null;
  restoreBindGroupLayout: GPUBindGroupLayout | null;
  restorePipeline: GPUComputePipeline | null;
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

interface OptimizedTentBlurJob {
  readonly targetX: number;
  readonly targetY: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly workInputOriginX: number;
  readonly workInputOriginY: number;
  readonly workInputWidth: number;
  readonly workInputHeight: number;
  readonly workOutputWidth: number;
  readonly workOutputHeight: number;
}

export interface RasterGaussianBlurSnapshot {
  readonly layerId: number;
  readonly strategy: DestructiveGaussianBlurStrategy;
  readonly radius: number;
  readonly sigma: number | null;
  /** Support in document pixels used to expand the authoritative result. */
  readonly supportRadius: number;
  readonly workScale: number;
  readonly workRadius: number;
  readonly workSupportRadius: number;
  readonly downsample: number;
  readonly sampleCountPerPass: number;
  readonly colorDomain:
    | typeof DESTRUCTIVE_TENT_BLUR_RGBA8_COLOR_DOMAIN
    | typeof DESTRUCTIVE_TENT_BLUR_LINEAR_COLOR_DOMAIN;
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterGaussianBlurSession {
  readonly layerId: number;
  readonly strategy: DestructiveGaussianBlurStrategy;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly downsampleTexture: GPUTexture | null;
  readonly downsampleView: GPUTextureView | null;
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
  readonly linearSampler: GPUSampler | null;
  readonly downsampleBindGroup: GPUBindGroup | null;
  readonly horizontalBindGroup: GPUBindGroup;
  readonly verticalBindGroup: GPUBindGroup;
  readonly finalizeBindGroup: GPUBindGroup | null;
  readonly restoreBindGroup: GPUBindGroup | null;
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
  Map<string, Promise<GaussianBlurSharedResources>>
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

function optimizedTentDownsampleShader(): string {
  return `${commonShaderSource("rgba16float")}
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var workingOutput:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var linearSampler: sampler;

fn documentExtent() -> vec2<i32> {
  let packed = parameters.kernelAndIntermediate.w;
  return vec2<i32>(i32(packed & 0xffffu), i32(packed >> 16u));
}

fn sourceTexel(documentPosition: vec2<i32>) -> vec4<f32> {
  let extent = documentExtent();
  let maximum = max(extent - vec2<i32>(1), vec2<i32>(0));
  let bounded = clamp(documentPosition, vec2<i32>(0), maximum);
  let local = bounded - parameters.sourceOriginAndSize.xy;
  let size = parameters.sourceOriginAndSize.zw;
  if (any(local < vec2<i32>(0)) || any(local >= size)) {
    return vec4<f32>(0.0);
  }
  // Optimized filtering intentionally averages stored premultiplied values.
  // Encoded RGBA8 remains encoded; a linear document remains linear.
  return textureLoad(sourceTexture, local, 0);
}

fn sourceSample(documentCenter: vec2<f32>) -> vec4<f32> {
  let extent = vec2<f32>(documentExtent());
  let bounded = clamp(
    documentCenter,
    vec2<f32>(0.5),
    max(extent - vec2<f32>(0.5), vec2<f32>(0.5))
  );
  let sourceOrigin = vec2<f32>(parameters.sourceOriginAndSize.xy);
  let sourceSize = vec2<f32>(parameters.sourceOriginAndSize.zw);
  let localCenter = bounded - sourceOrigin;
  if (all(localCenter >= vec2<f32>(1.0))
      && all(localCenter <= sourceSize - vec2<f32>(1.0))) {
    return textureSampleLevel(
      sourceTexture,
      linearSampler,
      localCenter / sourceSize,
      0.0
    );
  }

  // Sampling near an interior capture edge needs transparent border texels,
  // while an actual document edge repeats its edge texel.
  let coordinate = bounded - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(coordinate));
  let fraction = fract(coordinate);
  let top = mix(
    sourceTexel(lower),
    sourceTexel(lower + vec2<i32>(1, 0)),
    fraction.x
  );
  let bottom = mix(
    sourceTexel(lower + vec2<i32>(0, 1)),
    sourceTexel(lower + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

@compute @workgroup_size(${OPTIMIZED_FILTER_WORKGROUP_SIZE}, ${OPTIMIZED_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let workInputSize = vec2<u32>(parameters.buildOriginAndSize.zw);
  if (any(globalId.xy >= workInputSize)) { return; }
  let workScale = parameters.weights[0].x;
  let downsample = parameters.weights[0].y;
  let globalWork = parameters.buildOriginAndSize.xy + vec2<i32>(globalId.xy);
  let documentCenter = (vec2<f32>(globalWork) + vec2<f32>(0.5)) / workScale;
  if (downsample <= 1.000001) {
    textureStore(workingOutput, vec2<i32>(globalId.xy), sourceTexel(globalWork));
    return;
  }

  // A continuously widening, bounded box prefilter avoids hard LOD steps and
  // suppresses high-frequency aliases before the tent passes.
  let axisSamples = u32(clamp(ceil(downsample), 2.0, 4.0));
  let filterWidth = max(0.0, downsample - 1.0);
  var sum = vec4<f32>(0.0);
  var samples = 0u;
  for (var y = 0u; y < 4u; y += 1u) {
    if (y >= axisSamples) { break; }
    let offsetY = ((f32(y) + 0.5) / f32(axisSamples) - 0.5) * filterWidth;
    for (var x = 0u; x < 4u; x += 1u) {
      if (x >= axisSamples) { break; }
      let offsetX = ((f32(x) + 0.5) / f32(axisSamples) - 0.5) * filterWidth;
      sum += sourceSample(documentCenter + vec2<f32>(offsetX, offsetY));
      samples += 1u;
    }
  }
  textureStore(
    workingOutput,
    vec2<i32>(globalId.xy),
    sum / max(1.0, f32(samples))
  );
}
`;
}

function optimizedTentPassShader(axis: "horizontal" | "vertical"): string {
  const horizontal = axis === "horizontal";
  const axisDelta = horizontal
    ? "vec2<f32>(offset, 0.0)"
    : "vec2<f32>(0.0, offset)";
  const centerCoordinate = horizontal
    ? "vec2<f32>(f32(globalId.x + support), f32(globalId.y))"
    : "vec2<f32>(f32(globalId.x), f32(globalId.y + support))";
  const outputSize = horizontal
    ? "vec2<u32>(parameters.kernelAndIntermediate.y, u32(parameters.buildOriginAndSize.w))"
    : "parameters.kernelAndIntermediate.yz";
  return `${commonShaderSource("rgba16float")}
@group(0) @binding(1) var workingInput: texture_2d<f32>;
@group(0) @binding(2) var workingOutput:
  texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var linearSampler: sampler;

fn filteredSample(position: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(workingInput));
  return textureSampleLevel(
    workingInput,
    linearSampler,
    (position + vec2<f32>(0.5)) / dimensions,
    0.0
  );
}

@compute @workgroup_size(${OPTIMIZED_FILTER_WORKGROUP_SIZE}, ${OPTIMIZED_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let outputSize = ${outputSize};
  if (any(globalId.xy >= outputSize)) { return; }
  let support = parameters.kernelAndIntermediate.x;
  let count = parameters.weights[0].w;
  let centerPosition = ${centerCoordinate};
  let center = filteredSample(centerPosition);
  if (count <= 0.0) {
    textureStore(workingOutput, vec2<i32>(globalId.xy), center);
    return;
  }

  var sum = center * count;
  var normalization = count;
  for (var first = 1u; first < ${DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS}u; first += 2u) {
    let firstOffset = f32(first);
    if (firstOffset >= count) { break; }
    let secondOffset = min(firstOffset + 1.0, count);
    let firstWeight = count - firstOffset;
    let secondWeight = count - secondOffset;
    let pairWeight = firstWeight + secondWeight;
    if (pairWeight <= 0.0) { continue; }
    let offset = (
      firstOffset * firstWeight + secondOffset * secondWeight
    ) / pairWeight;
    sum += pairWeight * (
      filteredSample(centerPosition - ${axisDelta})
      + filteredSample(centerPosition + ${axisDelta})
    );
    normalization += pairWeight * 2.0;
  }
  textureStore(
    workingOutput,
    vec2<i32>(globalId.xy),
    sum / max(normalization, 0.000001)
  );
}
`;
}

function optimizedTentRestoreShader(outputFormat: LayerFormat): string {
  const rgba8 = outputFormat === "rgba8unorm";
  return `${commonShaderSource(outputFormat)}
${rgba8 ? rgba8HighFrequencyQuantizationShader : ""}
@group(0) @binding(1) var workingInput: texture_2d<f32>;
@group(0) @binding(2) var destinationTexture:
  texture_storage_2d<${outputFormat}, write>;
@group(0) @binding(3) var linearSampler: sampler;

@compute @workgroup_size(${OPTIMIZED_FILTER_WORKGROUP_SIZE}, ${OPTIMIZED_FILTER_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let targetSize = parameters.targetOriginAndSize.zw;
  if (any(globalId.xy >= targetSize)) { return; }
  let documentPosition = parameters.targetOriginAndSize.xy + globalId.xy;
  let workScale = parameters.weights[0].x;
  let support = i32(parameters.kernelAndIntermediate.x);
  let workOutputOrigin = parameters.buildOriginAndSize.xy + vec2<i32>(support);
  let globalWorkCoordinate = (
    vec2<f32>(documentPosition) + vec2<f32>(0.5)
  ) * workScale - vec2<f32>(0.5);
  let localWorkCoordinate = globalWorkCoordinate - vec2<f32>(workOutputOrigin);
  let dimensions = vec2<f32>(textureDimensions(workingInput));
  let working = textureSampleLevel(
    workingInput,
    linearSampler,
    (localWorkCoordinate + vec2<f32>(0.5)) / dimensions,
    0.0
  );
  ${rgba8 ? `
  let storedResult = quantizeRgba8HighFrequencyAdjacent(
    clamp(working, vec4<f32>(0.0), vec4<f32>(1.0)),
    documentPosition,
    parameters.quantizationAndReserved.x
  );
  textureStore(destinationTexture, vec2<i32>(documentPosition), storedResult);` : `
  textureStore(destinationTexture, vec2<i32>(documentPosition), working);`}
}
`;
}

async function createSharedResources(
  device: GPUDevice,
  outputFormat: LayerFormat,
  strategy: DestructiveGaussianBlurStrategy,
): Promise<GaussianBlurSharedResources> {
  if (strategy === "optimized-tent") {
    return runGpuAllocationTransaction(
      device,
      `Pipeline optimized raster tent blur ${outputFormat}`,
      async () => {
        const downsampleModule = device.createShaderModule({
          label: "Optimized raster tent blur downsample WGSL",
          code: optimizedTentDownsampleShader(),
        });
        const horizontalModule = device.createShaderModule({
          label: "Optimized raster tent blur horizontal WGSL",
          code: optimizedTentPassShader("horizontal"),
        });
        const verticalModule = device.createShaderModule({
          label: "Optimized raster tent blur vertical WGSL",
          code: optimizedTentPassShader("vertical"),
        });
        const restoreModule = device.createShaderModule({
          label: "Optimized raster tent blur restore WGSL",
          code: optimizedTentRestoreShader(outputFormat),
        });
        await Promise.all([
          assertShaderCompiled(downsampleModule, "Optimized tent blur downsample"),
          assertShaderCompiled(horizontalModule, "Optimized tent blur horizontal"),
          assertShaderCompiled(verticalModule, "Optimized tent blur vertical"),
          assertShaderCompiled(restoreModule, "Optimized tent blur restore"),
        ]);
        const filterBindGroupLayout = device.createBindGroupLayout({
          label: "Optimized raster tent blur filter layout",
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
              texture: { sampleType: "float" },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              storageTexture: { access: "write-only", format: "rgba16float" },
            },
            {
              binding: 3,
              visibility: GPUShaderStage.COMPUTE,
              sampler: { type: "filtering" },
            },
          ],
        });
        const restoreBindGroupLayout = device.createBindGroupLayout({
          label: "Optimized raster tent blur restore layout",
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
              texture: { sampleType: "float" },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              storageTexture: { access: "write-only", format: outputFormat },
            },
            {
              binding: 3,
              visibility: GPUShaderStage.COMPUTE,
              sampler: { type: "filtering" },
            },
          ],
        });
        const filterPipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [filterBindGroupLayout],
        });
        const restorePipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [restoreBindGroupLayout],
        });
        return {
          strategy,
          horizontalBindGroupLayout: filterBindGroupLayout,
          verticalBindGroupLayout: filterBindGroupLayout,
          horizontalPipeline: device.createComputePipeline({
            label: "Optimized raster tent blur horizontal pipeline",
            layout: filterPipelineLayout,
            compute: { module: horizontalModule, entryPoint: "main" },
          }),
          verticalPipeline: device.createComputePipeline({
            label: "Optimized raster tent blur vertical pipeline",
            layout: filterPipelineLayout,
            compute: { module: verticalModule, entryPoint: "main" },
          }),
          finalizeBindGroupLayout: null,
          finalizePipeline: null,
          downsampleBindGroupLayout: filterBindGroupLayout,
          downsamplePipeline: device.createComputePipeline({
            label: "Optimized raster tent blur downsample pipeline",
            layout: filterPipelineLayout,
            compute: { module: downsampleModule, entryPoint: "main" },
          }),
          restoreBindGroupLayout,
          restorePipeline: device.createComputePipeline({
            label: "Optimized raster tent blur restore pipeline",
            layout: restorePipelineLayout,
            compute: { module: restoreModule, entryPoint: "main" },
          }),
          outputFormat,
        };
      },
    );
  }
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
        strategy,
        horizontalBindGroupLayout,
        verticalBindGroupLayout,
        horizontalPipeline,
        verticalPipeline,
        finalizeBindGroupLayout,
        finalizePipeline,
        downsampleBindGroupLayout: null,
        downsamplePipeline: null,
        restoreBindGroupLayout: null,
        restorePipeline: null,
        outputFormat,
      };
    },
  );
}

async function requireSharedResources(
  device: GPUDevice,
  outputFormat: LayerFormat,
  strategy: DestructiveGaussianBlurStrategy,
): Promise<GaussianBlurSharedResources> {
  let variants = sharedByDevice.get(device);
  if (!variants) {
    variants = new Map();
    sharedByDevice.set(device, variants);
  }
  const key = `${outputFormat}:${strategy}`;
  let promise = variants.get(key);
  if (!promise) {
    promise = createSharedResources(device, outputFormat, strategy);
    variants.set(key, promise);
  }
  try {
    return await promise;
  } catch (error) {
    variants.delete(key);
    if (variants.size === 0) sharedByDevice.delete(device);
    throw error;
  }
}

function snapshot(session: ActiveRasterGaussianBlurSession): RasterGaussianBlurSnapshot {
  const kernel = destructiveGaussianBlurKernel(session.radius);
  const tent = destructiveTentBlurPlan(session.radius);
  const optimized = session.strategy === "optimized-tent";
  return {
    layerId: session.layerId,
    strategy: session.strategy,
    radius: session.radius,
    sigma: optimized ? null : kernel.sigma,
    supportRadius: optimized ? Math.ceil(tent.radius) : kernel.radius,
    workScale: optimized ? tent.workScale : 1,
    workRadius: optimized ? tent.count : kernel.radius,
    workSupportRadius: optimized ? tent.supportRadius : kernel.radius,
    downsample: optimized ? tent.downsample : 1,
    sampleCountPerPass: optimized
      ? tent.sampleCountPerPass
      : kernel.radius * 2 + 1,
    colorDomain: optimized && session.storedEncodedSrgb
      ? DESTRUCTIVE_TENT_BLUR_RGBA8_COLOR_DOMAIN
      : DESTRUCTIVE_TENT_BLUR_LINEAR_COLOR_DOMAIN,
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

function planOptimizedTentJobs(
  rect: DirtyRect,
  plan: DestructiveTentBlurPlan,
): OptimizedTentBlurJob[] {
  const jobs: OptimizedTentBlurJob[] = [];
  const support = plan.supportRadius;
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
    const workOutputOriginY = Math.floor(targetY * plan.workScale)
      - OPTIMIZED_WORK_MARGIN;
    const workOutputBottom = Math.ceil(
      (targetY + targetHeight) * plan.workScale,
    ) + OPTIMIZED_WORK_MARGIN;
    const workOutputHeight = Math.max(1, workOutputBottom - workOutputOriginY);
    const right = rect.x + rect.width;
    for (
      let targetX = rect.x;
      targetX < right;
      targetX += OPTIMIZED_TARGET_STRIP_WIDTH
    ) {
      const targetWidth = Math.min(OPTIMIZED_TARGET_STRIP_WIDTH, right - targetX);
      const workOutputOriginX = Math.floor(targetX * plan.workScale)
        - OPTIMIZED_WORK_MARGIN;
      const workOutputRight = Math.ceil(
        (targetX + targetWidth) * plan.workScale,
      ) + OPTIMIZED_WORK_MARGIN;
      const workOutputWidth = Math.max(1, workOutputRight - workOutputOriginX);
      jobs.push({
        targetX,
        targetY,
        targetWidth,
        targetHeight,
        workInputOriginX: workOutputOriginX - support,
        workInputOriginY: workOutputOriginY - support,
        workInputWidth: workOutputWidth + support * 2,
        workInputHeight: workOutputHeight + support * 2,
        workOutputWidth,
        workOutputHeight,
      });
    }
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

function writeOptimizedTentJobParameters(
  session: ActiveRasterGaussianBlurSession,
  index: number,
  job: OptimizedTentBlurJob,
  plan: DestructiveTentBlurPlan,
  documentWidth: number,
  documentHeight: number,
): number {
  if (index >= PARAMETER_CAPACITY) {
    throw new Error("Optimized tent blur: strip capacity exceeded.");
  }
  if (documentWidth > 0xffff || documentHeight > 0xffff) {
    throw new Error("Optimized tent blur: document dimensions exceed the uniform ABI.");
  }
  const byteOffset = index * session.parameterStride;
  const word = byteOffset / 4;
  const source = session.scratchBounds;
  session.parameterUploadI32[word] = source.x;
  session.parameterUploadI32[word + 1] = source.y;
  session.parameterUploadI32[word + 2] = source.width;
  session.parameterUploadI32[word + 3] = source.height;
  session.parameterUploadI32[word + 4] = job.workInputOriginX;
  session.parameterUploadI32[word + 5] = job.workInputOriginY;
  session.parameterUploadI32[word + 6] = job.workInputWidth;
  session.parameterUploadI32[word + 7] = job.workInputHeight;
  session.parameterUploadU32[word + 8] = job.targetX;
  session.parameterUploadU32[word + 9] = job.targetY;
  session.parameterUploadU32[word + 10] = job.targetWidth;
  session.parameterUploadU32[word + 11] = job.targetHeight;
  session.parameterUploadU32[word + 12] = plan.supportRadius;
  session.parameterUploadU32[word + 13] = job.workOutputWidth;
  session.parameterUploadU32[word + 14] = job.workOutputHeight;
  session.parameterUploadU32[word + 15] = (
    (documentHeight << 16) | documentWidth
  ) >>> 0;
  session.parameterUploadU32[word + 16] = session.quantizationSeed;
  session.parameterUploadU32[word + 17] = session.storedEncodedSrgb ? 1 : 0;
  session.parameterUploadU32[word + 18] = 0;
  session.parameterUploadU32[word + 19] = 0;
  session.parameterUploadF32.fill(0, word + 20, word + PARAMETER_WORDS);
  session.parameterUploadF32[word + 20] = plan.workScale;
  session.parameterUploadF32[word + 21] = plan.downsample;
  session.parameterUploadF32[word + 22] = 0;
  session.parameterUploadF32[word + 23] = plan.count;
  return byteOffset;
}

function destroySessionResources(session: ActiveRasterGaussianBlurSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.downsampleTexture?.destroy();
  session.intermediateTexture.destroy();
  session.outputTexture.destroy();
  session.parameterBuffer.destroy();
}

function previewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function encodeBaselineGaussianJobs(
  encoder: GPUCommandEncoder,
  engine: BrushEngine,
  session: ActiveRasterGaussianBlurSession,
  jobs: readonly GaussianBlurJob[],
  offsets: readonly number[],
): void {
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const horizontal = encoder.beginComputePass({
      label: `Baseline Gaussian blur horizontal strip ${index + 1}/${jobs.length}`,
    });
    horizontal.setPipeline(session.shared.horizontalPipeline);
    horizontal.setBindGroup(0, session.horizontalBindGroup, [offsets[index]]);
    horizontal.dispatchWorkgroups(
      Math.ceil(job.targetWidth / FILTER_WORKGROUP_SIZE),
      job.buildHeight,
    );
    horizontal.end();

    const vertical = encoder.beginComputePass({
      label: `Baseline Gaussian blur vertical strip ${index + 1}/${jobs.length}`,
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
        label: `Baseline Gaussian blur RGBA8 final strip ${index + 1}/${jobs.length}`,
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
}

function encodeOptimizedTentJobs(
  encoder: GPUCommandEncoder,
  session: ActiveRasterGaussianBlurSession,
  jobs: readonly OptimizedTentBlurJob[],
  offsets: readonly number[],
): void {
  if (
    !session.shared.downsamplePipeline
    || !session.shared.restorePipeline
    || !session.downsampleBindGroup
    || !session.restoreBindGroup
  ) {
    throw new Error("Optimized tent blur resources are unavailable.");
  }
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const offset = offsets[index];
    const downsample = encoder.beginComputePass({
      label: `Optimized tent blur downsample strip ${index + 1}/${jobs.length}`,
    });
    downsample.setPipeline(session.shared.downsamplePipeline);
    downsample.setBindGroup(0, session.downsampleBindGroup, [offset]);
    downsample.dispatchWorkgroups(
      Math.ceil(job.workInputWidth / OPTIMIZED_FILTER_WORKGROUP_SIZE),
      Math.ceil(job.workInputHeight / OPTIMIZED_FILTER_WORKGROUP_SIZE),
    );
    downsample.end();

    const horizontal = encoder.beginComputePass({
      label: `Optimized tent blur horizontal strip ${index + 1}/${jobs.length}`,
    });
    horizontal.setPipeline(session.shared.horizontalPipeline);
    horizontal.setBindGroup(0, session.horizontalBindGroup, [offset]);
    horizontal.dispatchWorkgroups(
      Math.ceil(job.workOutputWidth / OPTIMIZED_FILTER_WORKGROUP_SIZE),
      Math.ceil(job.workInputHeight / OPTIMIZED_FILTER_WORKGROUP_SIZE),
    );
    horizontal.end();

    const vertical = encoder.beginComputePass({
      label: `Optimized tent blur vertical strip ${index + 1}/${jobs.length}`,
    });
    vertical.setPipeline(session.shared.verticalPipeline);
    vertical.setBindGroup(0, session.verticalBindGroup, [offset]);
    vertical.dispatchWorkgroups(
      Math.ceil(job.workOutputWidth / OPTIMIZED_FILTER_WORKGROUP_SIZE),
      Math.ceil(job.workOutputHeight / OPTIMIZED_FILTER_WORKGROUP_SIZE),
    );
    vertical.end();

    const restore = encoder.beginComputePass({
      label: `Optimized tent blur restore strip ${index + 1}/${jobs.length}`,
    });
    restore.setPipeline(session.shared.restorePipeline);
    restore.setBindGroup(0, session.restoreBindGroup, [offset]);
    restore.dispatchWorkgroups(
      Math.ceil(job.targetWidth / OPTIMIZED_FILTER_WORKGROUP_SIZE),
      Math.ceil(job.targetHeight / OPTIMIZED_FILTER_WORKGROUP_SIZE),
    );
    restore.end();
  }
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
  // The destructive result is authoritative document data, so this call must
  // keep the default one-pixel render scale and remain independent of zoom.
  const tentPlan = destructiveTentBlurPlan(radius);
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
  const jobs = session.strategy === "optimized-tent"
    ? planOptimizedTentJobs(resultBounds, tentPlan)
    : planJobs(resultBounds, kernel.radius);
  if (jobs.length > PARAMETER_CAPACITY) {
    throw new Error("Gaussian Blur: too many strips for the parameter buffer.");
  }
  const offsets = session.strategy === "optimized-tent"
    ? (jobs as readonly OptimizedTentBlurJob[]).map((job, index) => (
      writeOptimizedTentJobParameters(
        session,
        index,
        job,
        tentPlan,
        engine.documentWidth,
        engine.documentHeight,
      )
    ))
    : (jobs as readonly GaussianBlurJob[]).map((job, index) => writeJobParameters(
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

  if (session.strategy === "optimized-tent") {
    encodeOptimizedTentJobs(
      encoder,
      session,
      jobs as readonly OptimizedTentBlurJob[],
      offsets,
    );
  } else {
    encodeBaselineGaussianJobs(
      encoder,
      engine,
      session,
      jobs as readonly GaussianBlurJob[],
      offsets,
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
  strategy: DestructiveGaussianBlurStrategy = DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_STRATEGY,
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
    const optimized = strategy === "optimized-tent";
    const shared = await requireSharedResources(
      engine.device,
      engine.layerFormat,
      strategy,
    );
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const parameterStride = Math.ceil(PARAMETER_BYTES / uniformAlignment) * uniformAlignment;
    const maximumStripHeight = Math.min(
      DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
      engine.documentHeight,
    );
    const workingWidth = optimized
      ? Math.min(scratchBounds.width, OPTIMIZED_TARGET_STRIP_WIDTH)
        + DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS * 2
        + OPTIMIZED_WORK_MARGIN * 2
      : scratchBounds.width;
    const intermediateHeight = optimized
      ? maximumStripHeight
        + DESTRUCTIVE_TENT_BLUR_MAX_WORK_RADIUS * 2
        + OPTIMIZED_WORK_MARGIN * 2
      : maximumStripHeight + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2;
    const outputHeight = optimized
      ? maximumStripHeight + OPTIMIZED_WORK_MARGIN * 2
      : maximumStripHeight;
    const maximumTextureDimension = Number(engine.device.limits.maxTextureDimension2D);
    if (
      Number.isFinite(maximumTextureDimension)
      && (workingWidth > maximumTextureDimension
        || intermediateHeight > maximumTextureDimension
        || outputHeight > maximumTextureDimension)
    ) {
      throw new Error("Gaussian Blur: working textures exceed the GPU dimension limit.");
    }
    const maximumJobs = Math.ceil(
      scratchBounds.height / DESTRUCTIVE_GAUSSIAN_BLUR_STRIP_HEIGHT,
    ) * (optimized
      ? Math.ceil(scratchBounds.width / OPTIMIZED_TARGET_STRIP_WIDTH)
      : 1);
    if (maximumJobs > PARAMETER_CAPACITY) {
      throw new Error("Gaussian Blur: the document is too tall for the strip plan.");
    }
    const maximumDispatch = Number(engine.device.limits.maxComputeWorkgroupsPerDimension);
    const maximumDispatches = optimized
      ? [
        Math.ceil(workingWidth / OPTIMIZED_FILTER_WORKGROUP_SIZE),
        Math.ceil(intermediateHeight / OPTIMIZED_FILTER_WORKGROUP_SIZE),
        Math.ceil(scratchBounds.width / OPTIMIZED_FILTER_WORKGROUP_SIZE),
        Math.ceil(maximumStripHeight / OPTIMIZED_FILTER_WORKGROUP_SIZE),
      ]
      : [
        Math.ceil(scratchBounds.width / FILTER_WORKGROUP_SIZE),
        intermediateHeight,
        Math.ceil(outputHeight / FILTER_WORKGROUP_SIZE),
        scratchBounds.width,
      ];
    if (Number.isFinite(maximumDispatch) && maximumDispatches.some(
      (value) => value > maximumDispatch,
    )) {
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
        const downsampleTexture = optimized
          ? engine.device.createTexture({
            label: `Optimized raster tent blur reduced source ${workingWidth}×${intermediateHeight}`,
            size: {
              width: workingWidth,
              height: intermediateHeight,
              depthOrArrayLayers: 1,
            },
            format: "rgba16float",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
          })
          : null;
        if (downsampleTexture) {
          transaction.deferRollback(() => downsampleTexture.destroy());
        }
        const downsampleView = downsampleTexture?.createView({
          label: "Optimized raster tent blur reduced source view",
        }) ?? null;
        const intermediateTexture = engine.device.createTexture({
          label: `${optimized ? "Optimized tent" : "Baseline Gaussian"} blur horizontal strip ${workingWidth}×${intermediateHeight}`,
          size: {
            width: workingWidth,
            height: intermediateHeight,
            depthOrArrayLayers: 1,
          },
          format: optimized
            ? "rgba16float"
            : engine.layerFormat === "rgba8unorm" ? "rg32uint" : "rgba16float",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => intermediateTexture.destroy());
        const intermediateView = intermediateTexture.createView({
          label: "Native raster Gaussian Blur horizontal strip view",
        });
        const outputTexture = engine.device.createTexture({
          label: `${optimized ? "Optimized tent" : "Baseline Gaussian"} blur vertical strip ${workingWidth}×${outputHeight}`,
          size: {
            width: workingWidth,
            height: outputHeight,
            depthOrArrayLayers: 1,
          },
          format: optimized
            ? "rgba16float"
            : engine.layerFormat === "rgba8unorm" ? "rg32uint" : "rgba16float",
          usage: optimized
            ? GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
            : engine.layerFormat === "rgba8unorm"
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
        const linearSampler = optimized
          ? engine.device.createSampler({
            label: "Optimized raster tent blur linear sampler",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            minFilter: "linear",
            magFilter: "linear",
            mipmapFilter: "nearest",
          })
          : null;
        const parameterBinding = {
          binding: 0,
          resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
        } as const;
        const downsampleBindGroup = optimized
          && shared.downsampleBindGroupLayout
          && downsampleView
          && linearSampler
          ? engine.device.createBindGroup({
            label: "Optimized raster tent blur downsample bind group",
            layout: shared.downsampleBindGroupLayout,
            entries: [
              parameterBinding,
              { binding: 1, resource: sourceView },
              { binding: 2, resource: downsampleView },
              { binding: 3, resource: linearSampler },
            ],
          })
          : null;
        const horizontalBindGroup = engine.device.createBindGroup({
          label: `${optimized ? "Optimized tent" : "Baseline Gaussian"} blur horizontal bind group`,
          layout: shared.horizontalBindGroupLayout,
          entries: optimized
            ? [
              parameterBinding,
              { binding: 1, resource: downsampleView as GPUTextureView },
              { binding: 2, resource: intermediateView },
              { binding: 3, resource: linearSampler as GPUSampler },
            ]
            : [
              parameterBinding,
              { binding: 1, resource: sourceView },
              { binding: 2, resource: intermediateView },
            ],
        });
        const verticalBindGroup = engine.device.createBindGroup({
          label: `${optimized ? "Optimized tent" : "Baseline Gaussian"} blur vertical bind group`,
          layout: shared.verticalBindGroupLayout,
          entries: optimized
            ? [
              parameterBinding,
              { binding: 1, resource: intermediateView },
              { binding: 2, resource: outputView },
              { binding: 3, resource: linearSampler as GPUSampler },
            ]
            : [
              parameterBinding,
              { binding: 1, resource: intermediateView },
              { binding: 2, resource: outputView },
            ],
        });
        const finalizeBindGroup = !optimized && shared.finalizeBindGroupLayout
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
        const restoreBindGroup = optimized
          && shared.restoreBindGroupLayout
          && linearSampler
          ? engine.device.createBindGroup({
            label: "Optimized raster tent blur restore bind group",
            layout: shared.restoreBindGroupLayout,
            entries: [
              parameterBinding,
              { binding: 1, resource: outputView },
              { binding: 2, resource: hot.view },
              { binding: 3, resource: linearSampler },
            ],
          })
          : null;
        const parameterUpload = new ArrayBuffer(parameterStride * PARAMETER_CAPACITY);
        const created: ActiveRasterGaussianBlurSession = {
          layerId: record.id,
          strategy,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          downsampleTexture,
          downsampleView,
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
          linearSampler,
          downsampleBindGroup,
          horizontalBindGroup,
          verticalBindGroup,
          finalizeBindGroup,
          restoreBindGroup,
          shared,
          quantizationSeed: engine.nextHistoryActionId >>> 0,
          storedEncodedSrgb:
            engine.documentStorageColorSpace === "encoded-srgb-premultiplied",
          memoryBytes:
            scratchBounds.width * scratchBounds.height
              * bytesPerLayerPixel(engine.layerFormat)
            + (optimized
              ? workingWidth * intermediateHeight
                  * BYTES_PER_RGBA16F_PIXEL * 2
                + workingWidth * outputHeight * BYTES_PER_RGBA16F_PIXEL
              : scratchBounds.width * intermediateHeight
                  * (engine.layerFormat === "rgba8unorm"
                    ? BYTES_PER_PACKED_RGBA16_UNORM_PIXEL
                    : BYTES_PER_RGBA16F_PIXEL)
                + scratchBounds.width * outputHeight
                  * (engine.layerFormat === "rgba8unorm"
                    ? BYTES_PER_PACKED_RGBA16_UNORM_PIXEL
                    : BYTES_PER_RGBA16F_PIXEL))
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
    const tent = destructiveTentBlurPlan(session.radius);
    const checkpoint = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter" as const,
      layerId: session.layerId,
      filter: "gaussian-blur" as const,
      radius: session.radius,
      supportRadius: kernel.radius,
      edgeMode: DESTRUCTIVE_GAUSSIAN_BLUR_EDGE_MODE,
      seed,
      baseBounds: { ...session.resultBounds },
      baseTileMask: session.resultTileMask.slice(),
    };
    const action: RasterFilterHistoryAction = session.strategy === "optimized-tent"
      ? {
        ...checkpoint,
        strategy: "optimized-tent",
        kernelStrategy: "separable-continuous-tent-v1",
        workScale: tent.workScale,
        workRadius: tent.count,
        workSupportRadius: tent.supportRadius,
        downsample: tent.downsample,
        sampleCountPerPass: tent.sampleCountPerPass,
        prefilterSampleAxis: tent.prefilterSampleAxis,
        prefilterWidth: tent.prefilterWidth,
        precision: engine.layerFormat === "rgba8unorm"
          ? "rgba8unorm-stored-premultiplied-rgba16float-tent-f32-high-frequency-output"
          : "rgba16float-premultiplied-tent-f32-accumulation",
        colorDomain: session.storedEncodedSrgb
          ? DESTRUCTIVE_TENT_BLUR_RGBA8_COLOR_DOMAIN
          : DESTRUCTIVE_TENT_BLUR_LINEAR_COLOR_DOMAIN,
      }
      : {
        ...checkpoint,
        strategy: "baseline-gaussian",
        sigma: kernel.sigma,
        precision: engine.layerFormat === "rgba8unorm"
          ? "rgba8unorm-linear-rgba16unorm-packed-two-pass-f32-high-frequency-output"
          : "rgba16float-f32-accumulation",
        colorDomain: DESTRUCTIVE_TENT_BLUR_LINEAR_COLOR_DOMAIN,
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
