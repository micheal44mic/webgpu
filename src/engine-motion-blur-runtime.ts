/** Transactional destructive Motion Blur for the selected native raster layer. */
import type { BrushEngine } from "./brush-engine";
import type { LayerFormat } from "./engine-types";
import {
  createLayerColdStorageCandidate,
  destroyLayerColdStorage,
} from "./engine-cold-storage";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { commitHistoryActionAtomically } from "./engine-history-runtime";
import { invalidateActiveLayerBake } from "./engine-layer-runtime";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { RasterFilterHistoryAction } from "./engine-history-types";
import type { DirtyRect } from "./engine-stroke-types";
import { publishMixedScene } from "./engine-vector-text-runtime";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
  destructiveMotionBlurBounds,
  destructiveMotionBlurKernel,
  destructiveMotionBlurMaximumBounds,
  normalizeDestructiveMotionBlurAngle,
  normalizeDestructiveMotionBlurDistance,
  unionMotionBlurRects,
} from "./motion-blur-core";
import { tileMaskCoveringRect } from "./raster-transform-math";
import { rgba8HighFrequencyQuantizationShader } from "./rgba8-high-frequency-quantization";

export const DESTRUCTIVE_MOTION_BLUR_RUNTIME_BUILD =
  "destructive-motion-blur-webgpu-v3-dual-storage-packed-unorm16-finalize";
export const DESTRUCTIVE_MOTION_BLUR_PRECISION =
  "rgba16float-storage-f32-accumulation" as const;
export const DESTRUCTIVE_MOTION_BLUR_RGBA8_PRECISION =
  "rgba8unorm-linear-rgba16unorm-packed-logarithmic-f32-high-frequency-output" as const;
export const DESTRUCTIVE_MOTION_BLUR_EDGE_MODE =
  "transparent-content-clamp-document-edge" as const;

const PARAMETER_WORDS = 24;
const PARAMETER_BYTES = PARAMETER_WORDS * 4;
const PARAMETER_CAPACITY = 16;
const MOTION_WORKGROUP_SIZE = 8;
const BYTES_PER_RGBA8_PIXEL = 4;
const BYTES_PER_RGBA16F_PIXEL = 8;
const BYTES_PER_PACKED_RGBA16_UNORM_PIXEL = 8;

interface MotionBlurSharedResources {
  readonly outputFormat: LayerFormat;
  readonly legacyBindGroupLayout: GPUBindGroupLayout | null;
  readonly legacyPipeline: GPURenderPipeline | null;
  readonly rgba8SourceBindGroupLayout: GPUBindGroupLayout | null;
  readonly rgba8SourcePipeline: GPUComputePipeline | null;
  readonly rgba8WorkingBindGroupLayout: GPUBindGroupLayout | null;
  readonly rgba8WorkingPipeline: GPUComputePipeline | null;
  readonly rgba8FinalizeBindGroupLayout: GPUBindGroupLayout | null;
  readonly rgba8FinalizePipeline: GPUComputePipeline | null;
}

export interface RasterMotionBlurSnapshot {
  readonly layerId: number;
  readonly distance: number;
  readonly angle: number;
  readonly sampleCount: number;
  readonly passCount: number;
  readonly supportX: number;
  readonly supportY: number;
  readonly sourceBounds: DirtyRect;
  readonly resultBounds: DirtyRect;
  readonly memoryBytes: number;
}

export interface ActiveRasterMotionBlurSession {
  readonly layerId: number;
  readonly sourceBounds: DirtyRect;
  readonly sourceTileMask: Uint32Array;
  readonly scratchBounds: DirtyRect;
  readonly sourceTexture: GPUTexture;
  readonly sourceView: GPUTextureView;
  readonly intermediateTexture: GPUTexture;
  readonly intermediateView: GPUTextureView;
  readonly secondaryTexture: GPUTexture | null;
  readonly secondaryView: GPUTextureView | null;
  readonly parameterBuffer: GPUBuffer;
  readonly parameterStride: number;
  readonly parameterUpload: ArrayBuffer;
  readonly parameterUploadI32: Int32Array;
  readonly parameterUploadU32: Uint32Array;
  readonly parameterUploadF32: Float32Array;
  readonly sourceBindGroup: GPUBindGroup;
  readonly layerBindGroup: GPUBindGroup | null;
  readonly intermediateBindGroup: GPUBindGroup | null;
  readonly rgba8ForwardBindGroup: GPUBindGroup | null;
  readonly rgba8BackwardBindGroup: GPUBindGroup | null;
  readonly rgba8FinalizeIntermediateBindGroup: GPUBindGroup | null;
  readonly rgba8FinalizeSecondaryBindGroup: GPUBindGroup | null;
  readonly shared: MotionBlurSharedResources;
  readonly quantizationSeed: number;
  readonly storedEncodedSrgb: boolean;
  readonly memoryBytes: number;
  distance: number;
  angle: number;
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
  Map<LayerFormat, Promise<MotionBlurSharedResources>>
>();

function legacyMotionBlurShader(): string {
  return /* wgsl */ `
struct MotionParameters {
  inputTextureOriginAndSize: vec4<i32>,
  inputValidOriginAndSize: vec4<i32>,
  attachmentOriginAndDocumentSize: vec4<i32>,
  shiftAndPadding: vec4<f32>,
  targetOriginAndSize: vec4<u32>,
  quantizationAndReserved: vec4<u32>,
};

@group(0) @binding(0) var<uniform> parameters: MotionParameters;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;

fn inputTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let documentSize = parameters.attachmentOriginAndDocumentSize.zw;
  let documentMaximum = max(documentSize - vec2<i32>(1), vec2<i32>(0));
  let clampedDocumentPixel = clamp(
    documentPixel,
    vec2<i32>(0),
    documentMaximum
  );
  let validOrigin = parameters.inputValidOriginAndSize.xy;
  let validSize = parameters.inputValidOriginAndSize.zw;
  if (
    any(clampedDocumentPixel < validOrigin)
    || any(clampedDocumentPixel >= validOrigin + validSize)
  ) {
    return vec4<f32>(0.0);
  }
  let local = clampedDocumentPixel - parameters.inputTextureOriginAndSize.xy;
  let size = parameters.inputTextureOriginAndSize.zw;
  if (any(local < vec2<i32>(0)) || any(local >= size)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(inputTexture, local, 0);
}

fn sampleInputLinear(documentPosition: vec2<f32>) -> vec4<f32> {
  let pixelPosition = documentPosition - vec2<f32>(0.5);
  let baseFloat = floor(pixelPosition);
  let base = vec2<i32>(baseFloat);
  let fraction = pixelPosition - baseFloat;
  let top = mix(
    inputTexel(base),
    inputTexel(base + vec2<i32>(1, 0)),
    fraction.x
  );
  let bottom = mix(
    inputTexel(base + vec2<i32>(0, 1)),
    inputTexel(base + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPosition = position.xy
    + vec2<f32>(parameters.attachmentOriginAndDocumentSize.xy);
  let shift = parameters.shiftAndPadding.xy;
  // Each logarithmic stage averages two equally weighted, symmetric exposure
  // blocks. Fragment arithmetic and the average are f32; only storage between
  // stages is rounded back to the document's native RGBA16F representation.
  return (
    sampleInputLinear(documentPosition - shift)
    + sampleInputLinear(documentPosition + shift)
  ) * 0.5;
}
`;
}

function rgba8MotionBlurCommonShader(): string {
  return /* wgsl */ `
struct MotionParameters {
  inputTextureOriginAndSize: vec4<i32>,
  inputValidOriginAndSize: vec4<i32>,
  attachmentOriginAndDocumentSize: vec4<i32>,
  shiftAndPadding: vec4<f32>,
  targetOriginAndSize: vec4<u32>,
  quantizationAndReserved: vec4<u32>,
};

@group(0) @binding(0) var<uniform> parameters: MotionParameters;

fn motionSrgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn motionLinearToSrgbChannel(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  if (bounded <= 0.0031308) { return bounded * 12.92; }
  return 1.055 * pow(bounded, 1.0 / 2.4) - 0.055;
}

fn motionEncodedPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = vec3<f32>(
    motionSrgbToLinearChannel(straight.r),
    motionSrgbToLinearChannel(straight.g),
    motionSrgbToLinearChannel(straight.b)
  );
  return vec4<f32>(linear * alpha, alpha);
}

fn motionLinearPremultipliedToEncoded(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    motionLinearToSrgbChannel(straight.r),
    motionLinearToSrgbChannel(straight.g),
    motionLinearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

fn motionStorageToWorking(value: vec4<f32>) -> vec4<f32> {
  if (parameters.quantizationAndReserved.y == 0u) { return value; }
  return motionEncodedPremultipliedToLinear(value);
}

fn motionWorkingToStorage(value: vec4<f32>) -> vec4<f32> {
  if (parameters.quantizationAndReserved.y == 0u) { return value; }
  return motionLinearPremultipliedToEncoded(value);
}

fn packMotionTexel(value: vec4<f32>) -> vec2<u32> {
  let bounded = clamp(value, vec4<f32>(0.0), vec4<f32>(1.0));
  return vec2<u32>(pack2x16unorm(bounded.xy), pack2x16unorm(bounded.zw));
}

fn unpackMotionTexel(value: vec2<u32>) -> vec4<f32> {
  return vec4<f32>(unpack2x16unorm(value.x), unpack2x16unorm(value.y));
}
`;
}

function rgba8MotionBlurPassShader(sourceIsDocument: boolean): string {
  return `${rgba8MotionBlurCommonShader()}
@group(0) @binding(1) var inputTexture: texture_2d<${sourceIsDocument ? "f32" : "u32"}>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rg32uint, write>;

fn inputTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let documentSize = parameters.attachmentOriginAndDocumentSize.zw;
  let documentMaximum = max(documentSize - vec2<i32>(1), vec2<i32>(0));
  let clampedDocumentPixel = clamp(documentPixel, vec2<i32>(0), documentMaximum);
  let validOrigin = parameters.inputValidOriginAndSize.xy;
  let validSize = parameters.inputValidOriginAndSize.zw;
  if (
    any(clampedDocumentPixel < validOrigin)
    || any(clampedDocumentPixel >= validOrigin + validSize)
  ) {
    return vec4<f32>(0.0);
  }
  let local = clampedDocumentPixel - parameters.inputTextureOriginAndSize.xy;
  let size = parameters.inputTextureOriginAndSize.zw;
  if (any(local < vec2<i32>(0)) || any(local >= size)) {
    return vec4<f32>(0.0);
  }
  ${sourceIsDocument
    ? "return motionStorageToWorking(textureLoad(inputTexture, local, 0));"
    : "return unpackMotionTexel(textureLoad(inputTexture, local, 0).xy);"}
}

fn sampleInputLinear(documentPosition: vec2<f32>) -> vec4<f32> {
  let pixelPosition = documentPosition - vec2<f32>(0.5);
  let baseFloat = floor(pixelPosition);
  let base = vec2<i32>(baseFloat);
  let fraction = pixelPosition - baseFloat;
  let top = mix(
    inputTexel(base),
    inputTexel(base + vec2<i32>(1, 0)),
    fraction.x
  );
  let bottom = mix(
    inputTexel(base + vec2<i32>(0, 1)),
    inputTexel(base + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

@compute @workgroup_size(${MOTION_WORKGROUP_SIZE}, ${MOTION_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let targetSize = parameters.targetOriginAndSize.zw;
  if (globalId.x >= targetSize.x || globalId.y >= targetSize.y) { return; }
  let documentPixel = vec2<i32>(parameters.targetOriginAndSize.xy + globalId.xy);
  let documentPosition = vec2<f32>(documentPixel) + vec2<f32>(0.5);
  let shift = parameters.shiftAndPadding.xy;
  // Arithmetic and bilinear interpolation remain f32. Only the pass boundary
  // is rounded to an exact packed 16-bit UNORM working representation.
  let result = (
    sampleInputLinear(documentPosition - shift)
    + sampleInputLinear(documentPosition + shift)
  ) * 0.5;
  let outputLocal = documentPixel - parameters.attachmentOriginAndDocumentSize.xy;
  let packed = packMotionTexel(result);
  textureStore(outputTexture, outputLocal, vec4<u32>(packed, 0u, 0u));
}
`;
}

function rgba8MotionBlurFinalizeShader(): string {
  return `${rgba8MotionBlurCommonShader()}
${rgba8HighFrequencyQuantizationShader}
@group(0) @binding(1) var workingTexture: texture_2d<u32>;
@group(0) @binding(2) var destinationTexture:
  texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(${MOTION_WORKGROUP_SIZE}, ${MOTION_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let targetSize = parameters.targetOriginAndSize.zw;
  if (globalId.x >= targetSize.x || globalId.y >= targetSize.y) { return; }
  let documentPixel = parameters.targetOriginAndSize.xy + globalId.xy;
  let local = vec2<i32>(documentPixel)
    - parameters.attachmentOriginAndDocumentSize.xy;
  let packed = textureLoad(workingTexture, local, 0).xy;
  let encodedPremultiplied = motionWorkingToStorage(unpackMotionTexel(packed));
  let stored = quantizeRgba8HighFrequencyAdjacent(
    encodedPremultiplied,
    documentPixel,
    parameters.quantizationAndReserved.x
  );
  textureStore(destinationTexture, vec2<i32>(documentPixel), stored);
}
`;
}

export const MOTION_BLUR_RGBA8_SOURCE_WGSL = rgba8MotionBlurPassShader(true);
export const MOTION_BLUR_RGBA8_WORKING_WGSL = rgba8MotionBlurPassShader(false);
export const MOTION_BLUR_RGBA8_FINALIZE_WGSL = rgba8MotionBlurFinalizeShader();

function emptySharedResources(outputFormat: LayerFormat): MotionBlurSharedResources {
  return {
    outputFormat,
    legacyBindGroupLayout: null,
    legacyPipeline: null,
    rgba8SourceBindGroupLayout: null,
    rgba8SourcePipeline: null,
    rgba8WorkingBindGroupLayout: null,
    rgba8WorkingPipeline: null,
    rgba8FinalizeBindGroupLayout: null,
    rgba8FinalizePipeline: null,
  };
}

async function createSharedResources(
  device: GPUDevice,
  outputFormat: LayerFormat,
): Promise<MotionBlurSharedResources> {
  return runGpuAllocationTransaction(
    device,
    `Pipeline Native raster Motion Blur ${outputFormat}`,
    async () => {
      if (outputFormat === "rgba16float") {
        const module = device.createShaderModule({
          label: "Native raster Motion Blur logarithmic WGSL",
          code: legacyMotionBlurShader(),
        });
        await assertShaderCompiled(module, "Directional Motion Blur RGBA16F");
        const legacyBindGroupLayout = device.createBindGroupLayout({
          label: "Native raster Motion Blur RGBA16F layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: {
                type: "uniform",
                hasDynamicOffset: true,
                minBindingSize: PARAMETER_BYTES,
              },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "unfilterable-float" },
            },
          ],
        });
        const legacyPipeline = device.createRenderPipeline({
          label: "Native raster Motion Blur RGBA16F logarithmic pipeline",
          layout: device.createPipelineLayout({ bindGroupLayouts: [legacyBindGroupLayout] }),
          vertex: { module, entryPoint: "vertexMain" },
          fragment: {
            module,
            entryPoint: "fragmentMain",
            targets: [{ format: "rgba16float" }],
          },
          primitive: { topology: "triangle-list" },
        });
        return {
          ...emptySharedResources(outputFormat),
          legacyBindGroupLayout,
          legacyPipeline,
        };
      }

      const sourceModule = device.createShaderModule({
        label: "Native raster Motion Blur RGBA8 source WGSL",
        code: MOTION_BLUR_RGBA8_SOURCE_WGSL,
      });
      const workingModule = device.createShaderModule({
        label: "Native raster Motion Blur packed working WGSL",
        code: MOTION_BLUR_RGBA8_WORKING_WGSL,
      });
      const finalizeModule = device.createShaderModule({
        label: "Native raster Motion Blur RGBA8 finalizer WGSL",
        code: MOTION_BLUR_RGBA8_FINALIZE_WGSL,
      });
      await Promise.all([
        assertShaderCompiled(sourceModule, "Directional Motion Blur RGBA8 source"),
        assertShaderCompiled(workingModule, "Directional Motion Blur packed working"),
        assertShaderCompiled(finalizeModule, "Directional Motion Blur RGBA8 finalizer"),
      ]);
      const uniformEntry: GPUBindGroupLayoutEntry = {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: PARAMETER_BYTES,
        },
      };
      const packedOutputEntry: GPUBindGroupLayoutEntry = {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: "write-only", format: "rg32uint" },
      };
      const rgba8SourceBindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Motion Blur RGBA8 source layout",
        entries: [
          uniformEntry,
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
          packedOutputEntry,
        ],
      });
      const rgba8WorkingBindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Motion Blur packed working layout",
        entries: [
          uniformEntry,
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
          packedOutputEntry,
        ],
      });
      const rgba8FinalizeBindGroupLayout = device.createBindGroupLayout({
        label: "Native raster Motion Blur RGBA8 finalizer layout",
        entries: [
          uniformEntry,
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "uint" } },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "write-only", format: "rgba8unorm" },
          },
        ],
      });
      const rgba8SourcePipeline = device.createComputePipeline({
        label: "Native raster Motion Blur RGBA8 source pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [rgba8SourceBindGroupLayout] }),
        compute: { module: sourceModule, entryPoint: "main" },
      });
      const rgba8WorkingPipeline = device.createComputePipeline({
        label: "Native raster Motion Blur packed working pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [rgba8WorkingBindGroupLayout] }),
        compute: { module: workingModule, entryPoint: "main" },
      });
      const rgba8FinalizePipeline = device.createComputePipeline({
        label: "Native raster Motion Blur RGBA8 finalizer pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [rgba8FinalizeBindGroupLayout] }),
        compute: { module: finalizeModule, entryPoint: "main" },
      });
      return {
        ...emptySharedResources(outputFormat),
        rgba8SourceBindGroupLayout,
        rgba8SourcePipeline,
        rgba8WorkingBindGroupLayout,
        rgba8WorkingPipeline,
        rgba8FinalizeBindGroupLayout,
        rgba8FinalizePipeline,
      };
    },
  );
}

async function requireSharedResources(
  device: GPUDevice,
  outputFormat: LayerFormat,
): Promise<MotionBlurSharedResources> {
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

function snapshot(session: ActiveRasterMotionBlurSession): RasterMotionBlurSnapshot {
  const kernel = destructiveMotionBlurKernel(session.distance, session.angle);
  return {
    layerId: session.layerId,
    distance: session.distance,
    angle: session.angle,
    sampleCount: kernel.sampleCount,
    passCount: kernel.passCount,
    supportX: kernel.supportX,
    supportY: kernel.supportY,
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

interface PassParameters {
  readonly inputTextureBounds: DirtyRect;
  readonly inputValidBounds: DirtyRect;
  readonly attachmentOriginX: number;
  readonly attachmentOriginY: number;
  readonly shiftX: number;
  readonly shiftY: number;
  readonly targetBounds: DirtyRect;
}

function writePassParameters(
  session: ActiveRasterMotionBlurSession,
  index: number,
  parameters: PassParameters,
  documentWidth: number,
  documentHeight: number,
): number {
  if (index >= PARAMETER_CAPACITY) {
    throw new Error("Motion Blur: pass capacity exceeded.");
  }
  const byteOffset = index * session.parameterStride;
  const word = byteOffset / 4;
  const texture = parameters.inputTextureBounds;
  const valid = parameters.inputValidBounds;
  session.parameterUploadI32[word] = texture.x;
  session.parameterUploadI32[word + 1] = texture.y;
  session.parameterUploadI32[word + 2] = texture.width;
  session.parameterUploadI32[word + 3] = texture.height;
  session.parameterUploadI32[word + 4] = valid.x;
  session.parameterUploadI32[word + 5] = valid.y;
  session.parameterUploadI32[word + 6] = valid.width;
  session.parameterUploadI32[word + 7] = valid.height;
  session.parameterUploadI32[word + 8] = parameters.attachmentOriginX;
  session.parameterUploadI32[word + 9] = parameters.attachmentOriginY;
  session.parameterUploadI32[word + 10] = documentWidth;
  session.parameterUploadI32[word + 11] = documentHeight;
  session.parameterUploadF32[word + 12] = parameters.shiftX;
  session.parameterUploadF32[word + 13] = parameters.shiftY;
  session.parameterUploadF32[word + 14] = 0;
  session.parameterUploadF32[word + 15] = 0;
  session.parameterUploadU32[word + 16] = parameters.targetBounds.x;
  session.parameterUploadU32[word + 17] = parameters.targetBounds.y;
  session.parameterUploadU32[word + 18] = parameters.targetBounds.width;
  session.parameterUploadU32[word + 19] = parameters.targetBounds.height;
  session.parameterUploadU32[word + 20] = session.quantizationSeed;
  session.parameterUploadU32[word + 21] = session.storedEncodedSrgb ? 1 : 0;
  session.parameterUploadU32[word + 22] = 0;
  session.parameterUploadU32[word + 23] = 0;
  return byteOffset;
}

function destroySessionResources(session: ActiveRasterMotionBlurSession): void {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  session.sourceTexture.destroy();
  session.intermediateTexture.destroy();
  session.secondaryTexture?.destroy();
  session.parameterBuffer.destroy();
}

function previewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function encodeRequestedPreview(
  engine: BrushEngine,
  session: ActiveRasterMotionBlurSession,
  serial: number,
  distance: number,
  angle: number,
): void {
  if (engine.activeRasterMotionBlurSession !== session) return;
  if (session.encodedSerial === serial) return;

  const kernel = destructiveMotionBlurKernel(distance, angle);
  const resultBounds = destructiveMotionBlurBounds(
    session.sourceBounds,
    distance,
    angle,
    DOCUMENT_WIDTH,
    DOCUMENT_HEIGHT,
  ) as DirtyRect | null;
  if (!resultBounds) throw new Error("Motion Blur: result bounds are missing.");
  const dirtyRect = unionMotionBlurRects(
    session.presentedBounds,
    resultBounds,
  ) as DirtyRect;
  if (kernel.passCount > PARAMETER_CAPACITY) {
    throw new Error("Motion Blur: too many passes for the parameter buffer.");
  }

  const fullLayerBounds: DirtyRect = {
    x: 0,
    y: 0,
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  };
  const offsets = kernel.shifts.map((shift, pass) => {
    const inputTextureBounds = session.shared.outputFormat === "rgba8unorm"
      ? session.scratchBounds
      : pass === 0
        ? session.scratchBounds
        : pass % 2 === 1
          ? fullLayerBounds
          : session.scratchBounds;
    const inputValidBounds = pass === 0 ? session.scratchBounds : resultBounds;
    const writesIntermediate = pass % 2 === 1;
    return writePassParameters(session, pass, {
      inputTextureBounds,
      inputValidBounds,
      attachmentOriginX: session.shared.outputFormat === "rgba8unorm"
        ? session.scratchBounds.x
        : writesIntermediate
          ? session.scratchBounds.x
          : 0,
      attachmentOriginY: session.shared.outputFormat === "rgba8unorm"
        ? session.scratchBounds.y
        : writesIntermediate
          ? session.scratchBounds.y
          : 0,
      shiftX: shift.x,
      shiftY: shift.y,
      targetBounds: resultBounds,
    }, DOCUMENT_WIDTH, DOCUMENT_HEIGHT);
  });
  if (offsets.length > 0) {
    engine.device.queue.writeBuffer(
      session.parameterBuffer,
      0,
      session.parameterUpload,
      0,
      offsets.length * session.parameterStride,
    );
  }

  const encoder = engine.device.createCommandEncoder({
    label: `Native raster Motion Blur preview ${distance}px ${angle}deg`,
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

  if (session.shared.outputFormat === "rgba8unorm") {
    const sourcePipeline = session.shared.rgba8SourcePipeline;
    const workingPipeline = session.shared.rgba8WorkingPipeline;
    const finalizePipeline = session.shared.rgba8FinalizePipeline;
    if (
      !sourcePipeline
      || !workingPipeline
      || !finalizePipeline
      || !session.rgba8ForwardBindGroup
      || !session.rgba8BackwardBindGroup
      || !session.rgba8FinalizeIntermediateBindGroup
      || !session.rgba8FinalizeSecondaryBindGroup
    ) {
      throw new Error("Motion Blur: the RGBA8 packed pipeline is unavailable.");
    }
    for (let pass = 0; pass < kernel.passCount; pass += 1) {
      const computePass = encoder.beginComputePass({
        label: `Motion Blur packed exposure pass ${pass + 1}/${kernel.passCount}`,
      });
      computePass.setPipeline(pass === 0 ? sourcePipeline : workingPipeline);
      computePass.setBindGroup(
        0,
        pass === 0
          ? session.sourceBindGroup
          : pass % 2 === 1
            ? session.rgba8ForwardBindGroup
            : session.rgba8BackwardBindGroup,
        [offsets[pass]],
      );
      computePass.dispatchWorkgroups(
        Math.ceil(resultBounds.width / MOTION_WORKGROUP_SIZE),
        Math.ceil(resultBounds.height / MOTION_WORKGROUP_SIZE),
      );
      computePass.end();
    }
    if (kernel.passCount > 0) {
      const finalizePass = encoder.beginComputePass({
        label: "Motion Blur RGBA8 high-frequency finalization",
      });
      finalizePass.setPipeline(finalizePipeline);
      finalizePass.setBindGroup(
        0,
        kernel.passCount % 2 === 1
          ? session.rgba8FinalizeIntermediateBindGroup
          : session.rgba8FinalizeSecondaryBindGroup,
        [offsets[kernel.passCount - 1]],
      );
      finalizePass.dispatchWorkgroups(
        Math.ceil(resultBounds.width / MOTION_WORKGROUP_SIZE),
        Math.ceil(resultBounds.height / MOTION_WORKGROUP_SIZE),
      );
      finalizePass.end();
    }
  } else {
    const legacyPipeline = session.shared.legacyPipeline;
    if (!legacyPipeline || !session.layerBindGroup || !session.intermediateBindGroup) {
      throw new Error("Motion Blur: the RGBA16F pipeline is unavailable.");
    }
    for (let pass = 0; pass < kernel.passCount; pass += 1) {
      const writesIntermediate = pass % 2 === 1;
      const renderPass = encoder.beginRenderPass({
        label: `Motion Blur exposure pass ${pass + 1}/${kernel.passCount}`,
        colorAttachments: [{
          view: writesIntermediate ? session.intermediateView : engine.layerView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      renderPass.setPipeline(legacyPipeline);
      const bindGroup = pass === 0
        ? session.sourceBindGroup
        : pass % 2 === 1
          ? session.layerBindGroup
          : session.intermediateBindGroup;
      renderPass.setBindGroup(0, bindGroup, [offsets[pass]]);
      const viewportX = writesIntermediate
        ? resultBounds.x - session.scratchBounds.x
        : resultBounds.x;
      const viewportY = writesIntermediate
        ? resultBounds.y - session.scratchBounds.y
        : resultBounds.y;
      renderPass.setViewport(
        viewportX,
        viewportY,
        resultBounds.width,
        resultBounds.height,
        0,
        1,
      );
      renderPass.setScissorRect(
        viewportX,
        viewportY,
        resultBounds.width,
        resultBounds.height,
      );
      renderPass.draw(3, 1, 0, 0);
      renderPass.end();
    }

    // An even number of passes ends in the intermediate surface. Copy the exact
    // RGBA16F result into the authoritative layer without another resampling.
    if (kernel.passCount > 0 && kernel.passCount % 2 === 0) {
      encoder.copyTextureToTexture(
        {
          texture: session.intermediateTexture,
          origin: {
            x: resultBounds.x - session.scratchBounds.x,
            y: resultBounds.y - session.scratchBounds.y,
            z: 0,
          },
        },
        {
          texture: engine.layerTexture,
          origin: { x: resultBounds.x, y: resultBounds.y, z: 0 },
        },
        {
          width: resultBounds.width,
          height: resultBounds.height,
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
  session: ActiveRasterMotionBlurSession,
): Promise<void> {
  if (session.previewInFlight) return session.previewInFlight;
  if (
    engine.activeRasterMotionBlurSession !== session
    || session.previewFault
    || session.encodedSerial === session.requestedSerial
  ) {
    return Promise.resolve();
  }
  const serial = session.requestedSerial;
  const distance = session.distance;
  const angle = session.angle;
  const completion = Promise.resolve().then(async (): Promise<void> => {
    try {
      encodeRequestedPreview(engine, session, serial, distance, angle);
      await engine.waitForGpuCapped(
        `Motion Blur preview ${distance}px ${angle}deg`,
        60_000,
      );
    } catch (error) {
      session.previewFault = previewError(error);
      if (engine.activeRasterMotionBlurSession === session) {
        engine.publishStatus(
          `Motion Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`,
          "error",
        );
        engine.publishHistoryState();
        engine.publishStats();
      }
    } finally {
      if (session.previewInFlight === completion) session.previewInFlight = null;
      if (
        engine.activeRasterMotionBlurSession === session
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
  session: ActiveRasterMotionBlurSession,
): void {
  if (session.previewFrame !== null || session.previewInFlight || session.previewFault) return;
  session.previewFrame = requestAnimationFrame(() => {
    session.previewFrame = null;
    if (
      engine.activeRasterMotionBlurSession !== session
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
  session: ActiveRasterMotionBlurSession,
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
  session: ActiveRasterMotionBlurSession,
): Promise<void> {
  if (session.previewFrame !== null) {
    cancelAnimationFrame(session.previewFrame);
    session.previewFrame = null;
  }
  const encoder = engine.device.createCommandEncoder({
    label: `Cancel Native raster Motion Blur layer ${session.layerId}`,
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
  await engine.waitForGpuCapped("Cancel Motion Blur", 60_000);
  if (session.previewInFlight) await session.previewInFlight;
  if (presentationError) throw presentationError;
}

export async function beginRasterMotionBlur(
  engine: BrushEngine,
  initialDistance = DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  initialAngle = DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
): Promise<RasterMotionBlurSnapshot | null> {
  if (!engine.initialized) throw new Error("The engine has not been initialized yet.");
  if (engine.activeRasterMotionBlurSession) {
    return snapshot(engine.activeRasterMotionBlurSession);
  }
  engine.assertDestructiveRasterEditCanOpen("motion-blur");
  const selected = engine.mixedSceneStack?.selected;
  if (selected?.kind !== "raster") return null;
  const record = engine.layerStack.active;
  if (selected.rasterLayerId !== record.id) {
    throw new Error("The selected raster does not match the active layer.");
  }
  if (engine.pixelSelectionState.selectedPixels > 0) {
    throw new Error(
      "Motion Blur v1 works on the entire layer: deselect the pixels before opening it.",
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
  let session: ActiveRasterMotionBlurSession | null = null;
  try {
    await engine.waitForIdle();
    const hot = engine.requireLayerGpu(record.id).hot;
    if (!hot) throw new Error("The hot texture for the raster to blur is missing.");
    const sourceBounds = { ...record.contentBounds };
    const scratchBounds = destructiveMotionBlurMaximumBounds(
      sourceBounds,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect | null;
    if (!scratchBounds) throw new Error("The raster contains no pixels that can be blurred.");
    const distance = normalizeDestructiveMotionBlurDistance(initialDistance);
    const angle = normalizeDestructiveMotionBlurAngle(initialAngle);
    const initialResultBounds = destructiveMotionBlurBounds(
      sourceBounds,
      distance,
      angle,
      DOCUMENT_WIDTH,
      DOCUMENT_HEIGHT,
    ) as DirtyRect;
    const maximumKernel = destructiveMotionBlurKernel(
      DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
      0,
    );
    if (maximumKernel.passCount > PARAMETER_CAPACITY) {
      throw new Error("Motion Blur: the requested maximum exceeds the pass capacity.");
    }
    const sourceTileMask = record.storageTileMask.slice();
    const shared = await requireSharedResources(engine.device, engine.layerFormat);
    const uniformAlignment = Number(engine.device.limits.minUniformBufferOffsetAlignment) || 256;
    const parameterStride = Math.ceil(PARAMETER_BYTES / uniformAlignment) * uniformAlignment;

    session = await runGpuAllocationTransaction(
      engine.device,
      `Allocate Native raster Motion Blur layer ${record.id}`,
      async (transaction) => {
        const sourceTexture = engine.device.createTexture({
          label: `Native raster Motion Blur immutable source layer ${record.id}`,
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
          label: "Native raster Motion Blur immutable source view",
        });
        const intermediateTexture = engine.device.createTexture({
          label: `Native raster Motion Blur logarithmic intermediate ${scratchBounds.width}x${scratchBounds.height}`,
          size: {
            width: scratchBounds.width,
            height: scratchBounds.height,
            depthOrArrayLayers: 1,
          },
          format: engine.layerFormat === "rgba8unorm" ? "rg32uint" : "rgba16float",
          usage: engine.layerFormat === "rgba8unorm"
            ? GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
            : GPUTextureUsage.RENDER_ATTACHMENT
              | GPUTextureUsage.TEXTURE_BINDING
              | GPUTextureUsage.COPY_SRC,
        });
        transaction.deferRollback(() => intermediateTexture.destroy());
        const intermediateView = intermediateTexture.createView({
          label: "Native raster Motion Blur logarithmic intermediate view",
        });
        const secondaryTexture = engine.layerFormat === "rgba8unorm"
          ? engine.device.createTexture({
            label: `Native raster Motion Blur packed secondary ${scratchBounds.width}x${scratchBounds.height}`,
            size: {
              width: scratchBounds.width,
              height: scratchBounds.height,
              depthOrArrayLayers: 1,
            },
            format: "rg32uint",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
          })
          : null;
        if (secondaryTexture) {
          transaction.deferRollback(() => secondaryTexture.destroy());
        }
        const secondaryView = secondaryTexture?.createView({
          label: "Native raster Motion Blur packed secondary view",
        }) ?? null;
        const parameterBuffer = engine.device.createBuffer({
          label: "Native raster Motion Blur dynamic parameters",
          size: parameterStride * PARAMETER_CAPACITY,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        transaction.deferRollback(() => parameterBuffer.destroy());
        const uniformEntry: GPUBindGroupEntry = {
          binding: 0,
          resource: { buffer: parameterBuffer, offset: 0, size: PARAMETER_BYTES },
        };
        let sourceBindGroup: GPUBindGroup;
        let layerBindGroup: GPUBindGroup | null = null;
        let intermediateBindGroup: GPUBindGroup | null = null;
        let rgba8ForwardBindGroup: GPUBindGroup | null = null;
        let rgba8BackwardBindGroup: GPUBindGroup | null = null;
        let rgba8FinalizeIntermediateBindGroup: GPUBindGroup | null = null;
        let rgba8FinalizeSecondaryBindGroup: GPUBindGroup | null = null;
        if (engine.layerFormat === "rgba8unorm") {
          if (
            !secondaryView
            || !shared.rgba8SourceBindGroupLayout
            || !shared.rgba8WorkingBindGroupLayout
            || !shared.rgba8FinalizeBindGroupLayout
          ) {
            throw new Error("Motion Blur: the RGBA8 resource layouts are unavailable.");
          }
          sourceBindGroup = engine.device.createBindGroup({
            label: "Native raster Motion Blur RGBA8 immutable source bind group",
            layout: shared.rgba8SourceBindGroupLayout,
            entries: [
              uniformEntry,
              { binding: 1, resource: sourceView },
              { binding: 2, resource: intermediateView },
            ],
          });
          rgba8ForwardBindGroup = engine.device.createBindGroup({
            label: "Native raster Motion Blur packed forward bind group",
            layout: shared.rgba8WorkingBindGroupLayout,
            entries: [
              uniformEntry,
              { binding: 1, resource: intermediateView },
              { binding: 2, resource: secondaryView },
            ],
          });
          rgba8BackwardBindGroup = engine.device.createBindGroup({
            label: "Native raster Motion Blur packed backward bind group",
            layout: shared.rgba8WorkingBindGroupLayout,
            entries: [
              uniformEntry,
              { binding: 1, resource: secondaryView },
              { binding: 2, resource: intermediateView },
            ],
          });
          rgba8FinalizeIntermediateBindGroup = engine.device.createBindGroup({
            label: "Native raster Motion Blur packed primary finalizer bind group",
            layout: shared.rgba8FinalizeBindGroupLayout,
            entries: [
              uniformEntry,
              { binding: 1, resource: intermediateView },
              { binding: 2, resource: hot.view },
            ],
          });
          rgba8FinalizeSecondaryBindGroup = engine.device.createBindGroup({
            label: "Native raster Motion Blur packed secondary finalizer bind group",
            layout: shared.rgba8FinalizeBindGroupLayout,
            entries: [
              uniformEntry,
              { binding: 1, resource: secondaryView },
              { binding: 2, resource: hot.view },
            ],
          });
        } else {
          if (!shared.legacyBindGroupLayout) {
            throw new Error("Motion Blur: the RGBA16F resource layout is unavailable.");
          }
          const legacyBindGroup = (
            label: string,
            view: GPUTextureView,
          ): GPUBindGroup => engine.device.createBindGroup({
            label,
            layout: shared.legacyBindGroupLayout as GPUBindGroupLayout,
            entries: [uniformEntry, { binding: 1, resource: view }],
          });
          sourceBindGroup = legacyBindGroup(
            "Native raster Motion Blur immutable source bind group",
            sourceView,
          );
          layerBindGroup = legacyBindGroup(
            "Native raster Motion Blur authoritative layer bind group",
            engine.layerSamplingView,
          );
          intermediateBindGroup = legacyBindGroup(
            "Native raster Motion Blur intermediate bind group",
            intermediateView,
          );
        }
        const parameterUpload = new ArrayBuffer(parameterStride * PARAMETER_CAPACITY);
        const created: ActiveRasterMotionBlurSession = {
          layerId: record.id,
          sourceBounds,
          sourceTileMask,
          scratchBounds,
          sourceTexture,
          sourceView,
          intermediateTexture,
          intermediateView,
          secondaryTexture,
          secondaryView,
          parameterBuffer,
          parameterStride,
          parameterUpload,
          parameterUploadI32: new Int32Array(parameterUpload),
          parameterUploadU32: new Uint32Array(parameterUpload),
          parameterUploadF32: new Float32Array(parameterUpload),
          sourceBindGroup,
          layerBindGroup,
          intermediateBindGroup,
          rgba8ForwardBindGroup,
          rgba8BackwardBindGroup,
          rgba8FinalizeIntermediateBindGroup,
          rgba8FinalizeSecondaryBindGroup,
          shared,
          quantizationSeed: engine.nextHistoryActionId >>> 0,
          storedEncodedSrgb:
            engine.documentStorageColorSpace === "encoded-srgb-premultiplied",
          memoryBytes:
            scratchBounds.width * scratchBounds.height
              * (engine.layerFormat === "rgba8unorm"
                ? BYTES_PER_RGBA8_PIXEL
                  + BYTES_PER_PACKED_RGBA16_UNORM_PIXEL * 2
                : BYTES_PER_RGBA16F_PIXEL * 2)
            + parameterStride * PARAMETER_CAPACITY,
          distance,
          angle,
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
          label: `Capture Native raster Motion Blur source layer ${record.id}`,
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
        await engine.waitForGpuCapped("Prepare Motion Blur", 60_000);
        return created;
      },
    );
    engine.activeRasterMotionBlurSession = session;
    engine.historyBusy = false;
    engine.publishHistoryState();
    await flushPreview(engine, session);
    engine.publishStatus(
      `Motion Blur preview ${distance.toFixed(0)} px at ${angle.toFixed(0)} degrees: Apply or Cancel.`,
      "ok",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    return snapshot(session);
  } catch (error) {
    let restoreError: unknown = null;
    if (session && engine.activeRasterMotionBlurSession === session) {
      session.terminal = true;
      try {
        await restoreOriginalPixels(engine, session);
      } catch (caught) {
        restoreError = caught;
        session.terminal = false;
        engine.latchDocumentStateInconsistent(
          "Motion Blur startup failed and recovery was incomplete: reload the page.",
        );
      }
      if (!restoreError) {
        destroySessionResources(session);
        engine.activeRasterMotionBlurSession = null;
      }
    }
    engine.historyBusy = engine.historyStateInconsistent;
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    engine.scheduleLayerColdCompression();
    if (restoreError) {
      throw new Error(
        `Motion Blur startup failed: ${previewError(error).message}; `
        + `recovery failed: ${previewError(restoreError).message}`,
      );
    }
    throw error;
  }
}

export function updateRasterMotionBlur(
  engine: BrushEngine,
  distanceValue: unknown,
  angleValue: unknown,
): RasterMotionBlurSnapshot {
  const session = engine.activeRasterMotionBlurSession;
  if (!session) throw new Error("No Motion Blur session is open.");
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Motion Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Motion Blur is already finishing.");
  const distance = normalizeDestructiveMotionBlurDistance(distanceValue);
  const angle = normalizeDestructiveMotionBlurAngle(angleValue);
  if (distance === session.distance && angle === session.angle) return snapshot(session);
  session.distance = distance;
  session.angle = angle;
  const result = destructiveMotionBlurBounds(
    session.sourceBounds,
    distance,
    angle,
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
  engine.publishStatus(
    `Motion Blur preview ${distance.toFixed(0)} px at ${angle.toFixed(0)} degrees…`,
    "working",
  );
  return snapshot(session);
}

export async function cancelRasterMotionBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterMotionBlurSession;
  if (!session) return false;
  if (session.terminal) throw new Error("Motion Blur is already finishing.");
  session.terminal = true;
  try {
    await restoreOriginalPixels(engine, session);
  } catch (error) {
    session.terminal = false;
    engine.latchDocumentStateInconsistent(
      "Motion Blur cancellation failed: reload the page.",
    );
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
    throw error;
  }
  destroySessionResources(session);
  engine.activeRasterMotionBlurSession = null;
  engine.historyBusy = engine.historyStateInconsistent;
  engine.publishHistoryState();
  engine.publishStats();
  publishMixedScene(engine);
  engine.scheduleLayerColdCompression();
  engine.publishStatus(
    "Motion Blur canceled: the original pixels were restored.",
    "ok",
  );
  return true;
}

export async function commitRasterMotionBlur(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeRasterMotionBlurSession;
  if (!session) return false;
  if (engine.historyStateInconsistent) {
    throw new Error("The document is locked: only retrying Cancel is allowed.");
  }
  if (session.previewFault) {
    throw new Error(`Motion Blur preview interrupted: ${session.previewFault.message}. Use Cancel.`);
  }
  if (session.terminal) throw new Error("Motion Blur is already finishing.");
  if (session.distance === 0) {
    await cancelRasterMotionBlur(engine);
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
    const kernel = destructiveMotionBlurKernel(session.distance, session.angle);
    const action: RasterFilterHistoryAction = {
      id: engine.nextHistoryActionId,
      kind: "raster-filter",
      layerId: session.layerId,
      filter: "motion-blur",
      distance: session.distance,
      angle: session.angle,
      sampleCount: kernel.sampleCount,
      passCount: kernel.passCount,
      supportX: kernel.supportX,
      supportY: kernel.supportY,
      precision: engine.layerFormat === "rgba8unorm"
        ? DESTRUCTIVE_MOTION_BLUR_RGBA8_PRECISION
        : "rgba16float-f32-accumulation",
      edgeMode: DESTRUCTIVE_MOTION_BLUR_EDGE_MODE,
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
        "Motion Blur commit failed and rollback was incomplete: reload the page.",
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
        `Motion Blur commit failed: ${operationMessage}; rollback failed: ${rollbackMessage}`,
      );
    }
    throw error;
  } finally {
    if (!retainSessionForRecovery) {
      destroySessionResources(session);
      engine.activeRasterMotionBlurSession = null;
      engine.historyBusy = engine.historyStateInconsistent;
      engine.scheduleLayerColdCompression();
    }
    engine.publishHistoryState();
    engine.publishStats();
    publishMixedScene(engine);
  }
  engine.publishStatus(
    `Motion Blur ${session.distance.toFixed(0)} px at ${session.angle.toFixed(0)} degrees applied to the pixels: one Undo step.`,
    "ok",
  );
  return true;
}
