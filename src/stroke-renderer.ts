import {
  RASTER_STROKE_MAX_WIDTH,
  jfaScheduleForExtent,
  type RasterStrokeRect,
  type RasterStrokeStyle,
} from "./stroke-core";

export const RASTER_STROKE_RENDERER_BUILD =
  "raster-stroke-webgpu-v2-compute-threshold-gated-packed-dual-jfa-q10.6";

export type RasterStrokeSourceMode = "permanent" | "light-glaze" | "thickness-tail";

export interface RasterStrokeRendererOptions {
  device: GPUDevice;
  documentWidth: number;
  documentHeight: number;
  layerFormat: "rgba8unorm" | "rgba16float";
  layerView: GPUTextureView;
  lightGlazeUniformBuffer: GPUBuffer;
  thicknessTailUniformBuffer: GPUBuffer;
  scratchExtent?: number;
}

export interface RasterStrokeEncodeOptions {
  encoder: GPUCommandEncoder;
  style: RasterStrokeStyle;
  sourceMode: RasterStrokeSourceMode;
  rebuildRect?: RasterStrokeRect | null;
  changeDetectionRect?: RasterStrokeRect | null;
  composeRect?: RasterStrokeRect | null;
  conditionalComposeRect?: RasterStrokeRect | null;
  clearStyled?: boolean;
  resetThresholdMask?: boolean;
}

export interface RasterStrokeEncodeResult {
  cleared: boolean;
  buildJobs: number;
  jfaDispatches: number;
  resolveDispatches: number;
  composeDispatches: number;
  buildPixels: number;
  resolvedPixels: number;
  composedPixels: number;
  thresholdDetectionDispatches: number;
  thresholdDetectionPixels: number;
  indirectDispatches: number;
}


interface BuildJob {
  buildOriginX: number;
  buildOriginY: number;
  buildWidth: number;
  buildHeight: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  localTargetX: number;
  localTargetY: number;
}

type SourceModeCode = 0 | 1 | 2;
type ScratchIndex = 0 | 1;

const DEFAULT_SCRATCH_EXTENT = 2048;
const WORKGROUP_SIZE = 8;
const PARAMETER_BYTES = 80;
const PARAMETER_STRIDE = 256;
const PARAMETER_CAPACITY = 2048;
const INVALID_PACKED_SEED = 0xffff_ffff;
const THRESHOLD_MASK_WORD_BITS = 32;
const INDIRECT_ARGUMENT_WORDS = 3;
const INDIRECT_ARGUMENT_BYTES = INDIRECT_ARGUMENT_WORDS * 4;
const INDIRECT_GATE_WORKGROUP_SIZE = 64;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sourceModeCode(mode: RasterStrokeSourceMode): SourceModeCode {
  if (mode === "light-glaze") {
    return 1;
  }
  if (mode === "thickness-tail") {
    return 2;
  }
  return 0;
}

function stylePositionCode(position: RasterStrokeStyle["position"]): number {
  if (position === "inside") {
    return 0;
  }
  if (position === "center") {
    return 1;
  }
  return 2;
}

function normalizedRect(
  rect: RasterStrokeRect | null | undefined,
  width: number,
  height: number,
): RasterStrokeRect | null {
  if (!rect) {
    return null;
  }
  const x = clamp(Math.floor(rect.x), 0, width);
  const y = clamp(Math.floor(rect.y), 0, height);
  const right = clamp(Math.ceil(rect.x + rect.width), 0, width);
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function pairAlignedDistanceRect(
  rect: RasterStrokeRect | null | undefined,
  width: number,
  height: number,
): RasterStrokeRect | null {
  const normalized = normalizedRect(rect, width, height);
  if (!normalized) {
    return null;
  }
  const x = Math.floor(normalized.x / 2) * 2;
  const right = Math.min(
    width,
    Math.ceil((normalized.x + normalized.width) / 2) * 2,
  );
  return {
    x,
    y: normalized.y,
    width: right - x,
    height: normalized.height,
  };
}

function shaderSourceCommon(documentWidth: number, documentHeight: number): string {
  return /* wgsl */ `
struct StrokeParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  step: u32,
  sourceMode: u32,
  styleWidth: f32,
  stylePosition: u32,
  _pad0: vec2<u32>,
  styleColor: vec4<f32>,
};

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct ThicknessTailUniforms {
  origin: vec2<f32>,
  textureSize: vec2<f32>,
  compositionMode: u32,
  _pad0: u32,
  _pad1: vec2<u32>,
};

const DOCUMENT_SIZE = vec2<i32>(${documentWidth}, ${documentHeight});
const INVALID_SEED: u32 = ${INVALID_PACKED_SEED}u;

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
@group(0) @binding(1) var permanentTexture: texture_2d<f32>;
@group(0) @binding(2) var transientTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;

fn insideDocument(position: vec2<i32>) -> bool {
  return all(position >= vec2<i32>(0)) && all(position < DOCUMENT_SIZE);
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  if (lightGlaze.formatCode == 0u) {
    return unpack4x8unorm(pack4x8unorm(value));
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn resolvedLightGlaze(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = clamp(accumulatedStroke.r, 0.0, 1.0);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

fn sourceTexel(position: vec2<i32>) -> vec4<f32> {
  if (!insideDocument(position)) {
    return vec4<f32>(0.0);
  }
  let permanentPaint = textureLoad(permanentTexture, position, 0);
  if (parameters.sourceMode == 1u) {
    let strokePaint = resolvedLightGlaze(textureLoad(transientTexture, position, 0));
    return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
  }
  if (parameters.sourceMode == 2u) {
    let tailOrigin = vec2<i32>(thicknessTail.origin);
    let tailPosition = position - tailOrigin;
    let tailSize = vec2<i32>(thicknessTail.textureSize);
    if (all(tailPosition >= vec2<i32>(0)) && all(tailPosition < tailSize)) {
      let transientPaint = textureLoad(transientTexture, tailPosition, 0);
      if (thicknessTail.compositionMode == 1u) {
        return vec4<f32>(
          permanentPaint.rgb + transientPaint.rgb,
          transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
        );
      }
      return transientPaint + permanentPaint * (1.0 - transientPaint.a);
    }
  }
  return permanentPaint;
}

fn packSeed(position: vec2<u32>) -> u32 {
  return (position.x & 65535u) | ((position.y & 65535u) << 16u);
}

fn unpackSeed(value: u32) -> vec2<u32> {
  return vec2<u32>(value & 65535u, value >> 16u);
}
`;
}

function seedShader(
  documentWidth: number,
  documentHeight: number,
  scratchExtent: number,
): string {
  return `${shaderSourceCommon(documentWidth, documentHeight)}
@group(0) @binding(5) var<storage, read_write> outputSeeds: array<vec2<u32>>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let localPosition = globalId.xy;
  let documentPosition = parameters.buildOrigin + vec2<i32>(localPosition);
  let inside = sourceTexel(documentPosition).a >= 0.5;
  let packed = packSeed(localPosition);
  let value = select(
    vec2<u32>(INVALID_SEED, packed),
    vec2<u32>(packed, INVALID_SEED),
    inside
  );
  outputSeeds[localPosition.y * ${scratchExtent}u + localPosition.x] = value;
}
`;
}

function jfaShader(scratchExtent: number): string {
  return /* wgsl */ `
struct StrokeParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  step: u32,
  sourceMode: u32,
  styleWidth: f32,
  stylePosition: u32,
  _pad0: vec2<u32>,
  styleColor: vec4<f32>,
};

const INVALID_SEED: u32 = ${INVALID_PACKED_SEED}u;

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
@group(0) @binding(1) var<storage, read> inputSeeds: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> outputSeeds: array<vec2<u32>>;

fn unpackSeed(value: u32) -> vec2<u32> {
  return vec2<u32>(value & 65535u, value >> 16u);
}

fn tieLess(left: vec2<u32>, right: vec2<u32>) -> bool {
  return left.y < right.y || (left.y == right.y && left.x < right.x);
}

fn bestCandidate(position: vec2<u32>, candidateIndex: u32) -> u32 {
  var found = false;
  var bestDistance = 3.402823e38;
  var bestPosition = vec2<u32>(65535u);
  var best = INVALID_SEED;
  let signedPosition = vec2<i32>(position);
  let step = i32(parameters.step);

  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      let samplePosition = signedPosition + vec2<i32>(offsetX, offsetY) * step;
      if (
        any(samplePosition < vec2<i32>(0))
        || any(samplePosition >= vec2<i32>(parameters.buildSize))
      ) {
        continue;
      }
      let pair = inputSeeds[
        u32(samplePosition.y) * ${scratchExtent}u + u32(samplePosition.x)
      ];
      let candidate = select(pair.x, pair.y, candidateIndex == 1u);
      if (candidate == INVALID_SEED) {
        continue;
      }
      let candidatePosition = unpackSeed(candidate);
      let delta = vec2<f32>(position) - vec2<f32>(candidatePosition);
      let distance = dot(delta, delta);
      if (
        !found
        || distance < bestDistance - 1e-5
        || (abs(distance - bestDistance) <= 1e-5
          && tieLess(candidatePosition, bestPosition))
      ) {
        found = true;
        bestDistance = distance;
        bestPosition = candidatePosition;
        best = candidate;
      }
    }
  }
  return best;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let position = globalId.xy;
  outputSeeds[position.y * ${scratchExtent}u + position.x] = vec2<u32>(
    bestCandidate(position, 0u),
    bestCandidate(position, 1u)
  );
}
`;
}

function resolveShader(
  documentWidth: number,
  documentHeight: number,
  scratchExtent: number,
): string {
  return `${shaderSourceCommon(documentWidth, documentHeight)}
@group(0) @binding(5) var<storage, read> propagatedSeeds: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read_write> distanceField: array<u32>;

fn resolveFixedDistance(
  documentPosition: vec2<u32>,
  localPosition: vec2<u32>
) -> u32 {
  let pair = propagatedSeeds[
    localPosition.y * ${scratchExtent}u + localPosition.x
  ];
  let inside = sourceTexel(vec2<i32>(documentPosition)).a >= 0.5;
  let candidate = select(pair.x, pair.y, inside);
  if (candidate == INVALID_SEED) {
    return 0u;
  }
  let seedPosition = unpackSeed(candidate);
  let delta = vec2<f32>(seedPosition) - vec2<f32>(localPosition);
  let distance = sqrt(dot(delta, delta));
  return u32(floor(min(distance, 1023.0) * 64.0 + 0.5));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.y >= parameters.targetSize.y) {
    return;
  }
  let firstX = globalId.x * 2u;
  if (firstX >= parameters.targetSize.x) {
    return;
  }
  let firstOffset = vec2<u32>(firstX, globalId.y);
  let firstDocumentPosition = parameters.targetOrigin + firstOffset;
  let firstDistance = resolveFixedDistance(
    firstDocumentPosition,
    parameters.localTargetOrigin + firstOffset
  );
  var secondDistance = 0u;
  if (firstX + 1u < parameters.targetSize.x) {
    let secondOffset = firstOffset + vec2<u32>(1u, 0u);
    secondDistance = resolveFixedDistance(
      parameters.targetOrigin + secondOffset,
      parameters.localTargetOrigin + secondOffset
    );
  }
  let linearIndex = firstDocumentPosition.y * ${documentWidth}u
    + firstDocumentPosition.x;
  distanceField[linearIndex >> 1u] = firstDistance | (secondDistance << 16u);
}
`;
}

function composeShader(
  documentWidth: number,
  documentHeight: number,
  layerFormat: "rgba8unorm" | "rgba16float",
): string {
  return `${shaderSourceCommon(documentWidth, documentHeight)}
@group(0) @binding(5) var<storage, read> distanceField: array<u32>;
@group(0) @binding(6) var styledTexture: texture_storage_2d<${layerFormat}, write>;

fn loadFixedDistance(position: vec2<i32>) -> u32 {
  let linearIndex = u32(position.y) * ${documentWidth}u + u32(position.x);
  let packed = distanceField[linearIndex >> 1u];
  return select(packed & 65535u, packed >> 16u, (linearIndex & 1u) == 1u);
}

fn rampAt(offset: f32, signedDistance: f32) -> f32 {
  return clamp(offset + 0.5 - signedDistance, 0.0, 1.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let position = vec2<i32>(parameters.targetOrigin + globalId.xy);
  let base = sourceTexel(position);
  let fixedDistance = loadFixedDistance(position);
  var coverage = 0.0;
  if (fixedDistance >= 1u) {
    let alpha = base.a;
    let distance = f32(fixedDistance) / 64.0;
    let signedDistance = select(
      distance - 0.5 - alpha,
      1.5 - alpha - distance,
      alpha >= 0.5
    );
    let f0 = rampAt(0.0, signedDistance);
    if (parameters.stylePosition == 2u) {
      coverage = rampAt(parameters.styleWidth, signedDistance) - f0;
    } else if (parameters.stylePosition == 0u) {
      coverage = f0 - rampAt(-parameters.styleWidth, signedDistance);
    } else {
      let radius = parameters.styleWidth * 0.5;
      coverage = rampAt(radius, signedDistance) - rampAt(-radius, signedDistance);
    }
    coverage = floor(clamp(coverage, 0.0, 1.0) * 255.0 + 0.5) / 255.0;
  }

  let alpha = base.a;
  var strokeWeight = coverage * parameters.styleColor.a;
  if (parameters.stylePosition == 2u) {
    strokeWeight = min(strokeWeight, 1.0 - alpha);
  }
  let baseWeight = select(
    max(0.0, alpha - strokeWeight),
    alpha,
    parameters.stylePosition == 2u
  );
  let finalAlpha = select(
    max(alpha, strokeWeight),
    min(1.0, alpha + strokeWeight),
    parameters.stylePosition == 2u
  );
  var baseStraight = vec3<f32>(0.0);
  if (alpha > 0.0) {
    baseStraight = base.rgb / alpha;
  }
  var result = vec4<f32>(
    parameters.styleColor.rgb * strokeWeight + baseStraight * baseWeight,
    clamp(finalAlpha, 0.0, 1.0)
  );
  result = vec4<f32>(
    clamp(result.rgb, vec3<f32>(0.0), vec3<f32>(result.a)),
    result.a
  );
  textureStore(styledTexture, position, result);
}
`;
}

function thresholdMaskShader(
  documentWidth: number,
  documentHeight: number,
): string {
  const wordsPerRow = Math.ceil(documentWidth / THRESHOLD_MASK_WORD_BITS);
  return `${shaderSourceCommon(documentWidth, documentHeight)}
@group(0) @binding(5) var<storage, read_write> thresholdMask: array<u32>;
@group(0) @binding(6) var<storage, read_write> changeState: array<atomic<u32>>;

const THRESHOLD_WORD_BITS = ${THRESHOLD_MASK_WORD_BITS}u;
const THRESHOLD_WORDS_PER_ROW = ${wordsPerRow}u;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let firstWord = parameters.targetOrigin.x / THRESHOLD_WORD_BITS;
  let firstBit = parameters.targetOrigin.x % THRESHOLD_WORD_BITS;
  let wordCount = (
    firstBit + parameters.targetSize.x + THRESHOLD_WORD_BITS - 1u
  ) / THRESHOLD_WORD_BITS;
  if (globalId.x >= wordCount || globalId.y >= parameters.targetSize.y) {
    return;
  }

  let wordX = firstWord + globalId.x;
  let documentY = parameters.targetOrigin.y + globalId.y;
  let wordOriginX = wordX * THRESHOLD_WORD_BITS;
  let targetRight = parameters.targetOrigin.x + parameters.targetSize.x;
  var writeMask = 0u;
  var nextBits = 0u;
  for (var lane = 0u; lane < THRESHOLD_WORD_BITS; lane += 1u) {
    let documentX = wordOriginX + lane;
    if (
      documentX < parameters.targetOrigin.x
      || documentX >= targetRight
      || documentX >= ${documentWidth}u
    ) {
      continue;
    }
    let bit = 1u << lane;
    writeMask |= bit;
    if (sourceTexel(vec2<i32>(i32(documentX), i32(documentY))).a >= 0.5) {
      nextBits |= bit;
    }
  }

  let maskIndex = documentY * THRESHOLD_WORDS_PER_ROW + wordX;
  let previousBits = thresholdMask[maskIndex];
  let updatedBits = (previousBits & ~writeMask) | (nextBits & writeMask);
  if (updatedBits != previousBits) {
    atomicOr(&changeState[0], 1u);
  }
  thresholdMask[maskIndex] = updatedBits;
}
`;
}

function indirectGateShader(): string {
  return /* wgsl */ `
struct StrokeParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  step: u32,
  sourceMode: u32,
  styleWidth: f32,
  stylePosition: u32,
  _pad0: vec2<u32>,
  styleColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
@group(0) @binding(1) var<storage, read_write> changeState: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indirectArguments: array<u32>;

@compute @workgroup_size(${INDIRECT_GATE_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let argumentIndex = globalId.x;
  if (argumentIndex >= parameters.targetSize.x) {
    return;
  }
  if (atomicLoad(&changeState[0]) != 0u) {
    return;
  }
  let word = argumentIndex * ${INDIRECT_ARGUMENT_WORDS}u;
  indirectArguments[word] = 0u;
  indirectArguments[word + 1u] = 0u;
  indirectArguments[word + 2u] = 0u;
}
`;
}

async function assertShaderModules(
  modules: readonly { label: string; module: GPUShaderModule }[],
): Promise<void> {
  const compilation = await Promise.all(
    modules.map(async ({ label, module }) => ({
      label,
      messages: (await module.getCompilationInfo()).messages,
    })),
  );
  const errors = compilation.flatMap(({ label, messages }) =>
    [...messages]
      .filter((message) => message.type === "error")
      .map((message) => `${label}:${message.lineNum}:${message.linePos} ${message.message}`),
  );
  if (errors.length > 0) {
    throw new Error(`Shader Traccia WGSL non valido:\n${errors.join("\n")}`);
  }
}

export class RasterStrokeRenderer {
  static async create(options: RasterStrokeRendererOptions): Promise<RasterStrokeRenderer> {
    const renderer = new RasterStrokeRenderer(options);
    try {
      await renderer.initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  readonly build = RASTER_STROKE_RENDERER_BUILD;
  readonly samplingView: GPUTextureView;
  readonly mipViews: readonly GPUTextureView[];
  readonly scratchExtent: number;
  readonly persistentMemoryBytes: number;
  readonly scratchMemoryBytes: number;

  private readonly device: GPUDevice;
  private readonly documentWidth: number;
  private readonly documentHeight: number;
  private readonly layerFormat: "rgba8unorm" | "rgba16float";
  private readonly layerView: GPUTextureView;
  private readonly lightGlazeUniformBuffer: GPUBuffer;
  private readonly thicknessTailUniformBuffer: GPUBuffer;
  private readonly parameterBuffer: GPUBuffer;
  private readonly parameterUpload = new ArrayBuffer(PARAMETER_CAPACITY * PARAMETER_STRIDE);
  private readonly parameterUploadI32 = new Int32Array(this.parameterUpload);
  private readonly parameterUploadU32 = new Uint32Array(this.parameterUpload);
  private readonly parameterUploadF32 = new Float32Array(this.parameterUpload);
  private readonly indirectTemplateUpload = new Uint32Array(
    PARAMETER_CAPACITY * INDIRECT_ARGUMENT_WORDS,
  );
  private readonly scratchBuffers: readonly [GPUBuffer, GPUBuffer];
  private readonly distanceBuffer: GPUBuffer;
  private readonly thresholdMaskBuffer: GPUBuffer;
  private readonly changeStateBuffer: GPUBuffer;
  private readonly indirectArgumentsBuffer: GPUBuffer;
  private readonly styledTexture: GPUTexture;
  private readonly styledStorageView: GPUTextureView;
  private readonly dummyTexture: GPUTexture;
  private readonly dummyView: GPUTextureView;

  private seedBindGroupLayout!: GPUBindGroupLayout;
  private jfaBindGroupLayout!: GPUBindGroupLayout;
  private resolveBindGroupLayout!: GPUBindGroupLayout;
  private composeBindGroupLayout!: GPUBindGroupLayout;
  private thresholdMaskBindGroupLayout!: GPUBindGroupLayout;
  private indirectGateBindGroupLayout!: GPUBindGroupLayout;
  private seedPipeline!: GPUComputePipeline;
  private jfaPipeline!: GPUComputePipeline;
  private resolvePipeline!: GPUComputePipeline;
  private composePipeline!: GPUComputePipeline;
  private thresholdMaskPipeline!: GPUComputePipeline;
  private indirectGatePipeline!: GPUComputePipeline;
  private jfaBindGroups!: readonly [GPUBindGroup, GPUBindGroup];
  private indirectGateBindGroup!: GPUBindGroup;
  private sourceViews: Record<SourceModeCode, GPUTextureView>;
  private seedBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private resolveBindGroups = new Map<string, GPUBindGroup>();
  private composeBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private thresholdMaskBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private destroyed = false;

  private constructor(options: RasterStrokeRendererOptions) {
    this.device = options.device;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.layerFormat = options.layerFormat;
    this.layerView = options.layerView;
    this.lightGlazeUniformBuffer = options.lightGlazeUniformBuffer;
    this.thicknessTailUniformBuffer = options.thicknessTailUniformBuffer;

    const maximumScratchFromBinding = Math.floor(Math.sqrt(
      Number(this.device.limits.maxStorageBufferBindingSize) / 8,
    ));
    const maximumScratchFromBuffer = Math.floor(Math.sqrt(
      Number(this.device.limits.maxBufferSize) / 8,
    ));
    const requestedScratch = Math.max(
      1,
      Math.trunc(options.scratchExtent ?? DEFAULT_SCRATCH_EXTENT),
    );
    this.scratchExtent = Math.floor(
      Math.min(
        requestedScratch,
        maximumScratchFromBinding,
        maximumScratchFromBuffer,
      ) / WORKGROUP_SIZE,
    ) * WORKGROUP_SIZE;
    const minimumRequiredExtent = Math.ceil(RASTER_STROKE_MAX_WIDTH + 2) * 2 + 1;
    if (this.scratchExtent < minimumRequiredExtent) {
      throw new Error(
        `Limite storage GPU insufficiente per la Traccia 512 px: scratch `
        + `${this.scratchExtent}px, richiesti almeno ${minimumRequiredExtent}px.`,
      );
    }

    const scratchBytes = this.scratchExtent * this.scratchExtent * 8;
    this.scratchBuffers = [
      this.device.createBuffer({
        label: "Traccia packed dual JFA scratch A",
        size: scratchBytes,
        usage: GPUBufferUsage.STORAGE,
      }),
      this.device.createBuffer({
        label: "Traccia packed dual JFA scratch B",
        size: scratchBytes,
        usage: GPUBufferUsage.STORAGE,
      }),
    ];
    this.parameterBuffer = this.device.createBuffer({
      label: "Traccia dynamic dispatch parameters",
      size: PARAMETER_CAPACITY * PARAMETER_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const distanceWordCount = Math.ceil(this.documentWidth * this.documentHeight / 2);
    this.distanceBuffer = this.device.createBuffer({
      label: "Traccia persistent packed Q10.6 distance field",
      size: distanceWordCount * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    const thresholdMaskWordCount = Math.ceil(
      this.documentWidth / THRESHOLD_MASK_WORD_BITS,
    ) * this.documentHeight;
    const thresholdMaskBytes = thresholdMaskWordCount * 4;
    this.thresholdMaskBuffer = this.device.createBuffer({
      label: "Traccia persistent alpha-threshold bit mask",
      size: thresholdMaskBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const changeStateBytes = 4;
    this.changeStateBuffer = this.device.createBuffer({
      label: "Traccia alpha-threshold change flag",
      size: changeStateBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const indirectArgumentsBytes = PARAMETER_CAPACITY * INDIRECT_ARGUMENT_BYTES;
    this.indirectArgumentsBuffer = this.device.createBuffer({
      label: "Traccia threshold-gated indirect dispatch arguments",
      size: indirectArgumentsBytes,
      usage:
        GPUBufferUsage.STORAGE
        | GPUBufferUsage.INDIRECT
        | GPUBufferUsage.COPY_DST,
    });
    const mipLevelCount = Math.floor(
      Math.log2(Math.max(this.documentWidth, this.documentHeight)),
    ) + 1;
    this.styledTexture = this.device.createTexture({
      label: `Traccia styled layer ${this.layerFormat}`,
      size: {
        width: this.documentWidth,
        height: this.documentHeight,
        depthOrArrayLayers: 1,
      },
      mipLevelCount,
      format: this.layerFormat,
      usage:
        GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.styledStorageView = this.styledTexture.createView({
      label: "Traccia styled authoritative mip 0 storage view",
      baseMipLevel: 0,
      mipLevelCount: 1,
    });
    this.samplingView = this.styledTexture.createView({
      label: "Traccia styled full mip chain",
      baseMipLevel: 0,
      mipLevelCount,
    });
    this.mipViews = Array.from({ length: mipLevelCount }, (_, mipLevel) =>
      this.styledTexture.createView({
        label: `Traccia styled mip ${mipLevel}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }));
    this.dummyTexture = this.device.createTexture({
      label: "Traccia transparent transient placeholder",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.dummyTexture },
      new Uint8Array(256),
      { bytesPerRow: 256, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    this.dummyView = this.dummyTexture.createView();
    this.sourceViews = {
      0: this.dummyView,
      1: this.dummyView,
      2: this.dummyView,
    };

    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    let styledPixels = 0;
    for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel += 1) {
      styledPixels += Math.max(1, this.documentWidth >> mipLevel)
        * Math.max(1, this.documentHeight >> mipLevel);
    }
    this.persistentMemoryBytes = distanceWordCount * 4
      + styledPixels * bytesPerPixel
      + thresholdMaskBytes
      + changeStateBytes
      + indirectArgumentsBytes;
    this.scratchMemoryBytes = scratchBytes * 2;
  }

  private async initialize(): Promise<void> {
    this.seedBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia seed bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMETER_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.jfaBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia JFA bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMETER_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.resolveBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia resolve bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMETER_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.composeBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia compose bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMETER_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: this.layerFormat },
        },
      ],
    });

    this.thresholdMaskBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia alpha-threshold mask bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMETER_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.indirectGateBindGroupLayout = this.device.createBindGroupLayout({
      label: "Traccia indirect dispatch gate bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: PARAMETER_BYTES },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });

    const seedModule = this.device.createShaderModule({
      label: "Traccia dual seed WGSL",
      code: seedShader(this.documentWidth, this.documentHeight, this.scratchExtent),
    });
    const jfaModule = this.device.createShaderModule({
      label: "Traccia packed dual JFA WGSL",
      code: jfaShader(this.scratchExtent),
    });
    const resolveModule = this.device.createShaderModule({
      label: "Traccia Q10.6 resolve WGSL",
      code: resolveShader(this.documentWidth, this.documentHeight, this.scratchExtent),
    });
    const composeModule = this.device.createShaderModule({
      label: "Traccia styled compose WGSL",
      code: composeShader(this.documentWidth, this.documentHeight, this.layerFormat),
    });
    const thresholdMaskModule = this.device.createShaderModule({
      label: "Traccia alpha-threshold mask WGSL",
      code: thresholdMaskShader(this.documentWidth, this.documentHeight),
    });
    const indirectGateModule = this.device.createShaderModule({
      label: "Traccia indirect dispatch gate WGSL",
      code: indirectGateShader(),
    });
    await assertShaderModules([
      { label: "seed", module: seedModule },
      { label: "jfa", module: jfaModule },
      { label: "resolve", module: resolveModule },
      { label: "compose", module: composeModule },
      { label: "threshold-mask", module: thresholdMaskModule },
      { label: "indirect-gate", module: indirectGateModule },
    ]);

    this.device.pushErrorScope("validation");
    this.seedPipeline = this.device.createComputePipeline({
      label: "Traccia dual seed pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.seedBindGroupLayout],
      }),
      compute: { module: seedModule, entryPoint: "main" },
    });
    this.jfaPipeline = this.device.createComputePipeline({
      label: "Traccia packed dual JFA pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.jfaBindGroupLayout],
      }),
      compute: { module: jfaModule, entryPoint: "main" },
    });
    this.resolvePipeline = this.device.createComputePipeline({
      label: "Traccia Q10.6 resolve pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.resolveBindGroupLayout],
      }),
      compute: { module: resolveModule, entryPoint: "main" },
    });
    this.composePipeline = this.device.createComputePipeline({
      label: "Traccia styled compose pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.composeBindGroupLayout],
      }),
      compute: { module: composeModule, entryPoint: "main" },
    });
    this.thresholdMaskPipeline = this.device.createComputePipeline({
      label: "Traccia alpha-threshold mask pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.thresholdMaskBindGroupLayout],
      }),
      compute: { module: thresholdMaskModule, entryPoint: "main" },
    });
    this.indirectGatePipeline = this.device.createComputePipeline({
      label: "Traccia indirect dispatch gate pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.indirectGateBindGroupLayout],
      }),
      compute: { module: indirectGateModule, entryPoint: "main" },
    });
    const validationError = await this.device.popErrorScope();
    if (validationError) {
      throw new Error(validationError.message);
    }

    this.jfaBindGroups = [
      this.device.createBindGroup({
        label: "Traccia JFA A to B",
        layout: this.jfaBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: {
              buffer: this.parameterBuffer,
              offset: 0,
              size: PARAMETER_BYTES,
            },
          },
          { binding: 1, resource: { buffer: this.scratchBuffers[0] } },
          { binding: 2, resource: { buffer: this.scratchBuffers[1] } },
        ],
      }),
      this.device.createBindGroup({
        label: "Traccia JFA B to A",
        layout: this.jfaBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: {
              buffer: this.parameterBuffer,
              offset: 0,
              size: PARAMETER_BYTES,
            },
          },
          { binding: 1, resource: { buffer: this.scratchBuffers[1] } },
          { binding: 2, resource: { buffer: this.scratchBuffers[0] } },
        ],
      }),
    ];
    this.indirectGateBindGroup = this.device.createBindGroup({
      label: "Traccia indirect dispatch gate bind group",
      layout: this.indirectGateBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.parameterBuffer,
            offset: 0,
            size: PARAMETER_BYTES,
          },
        },
        { binding: 1, resource: { buffer: this.changeStateBuffer } },
        { binding: 2, resource: { buffer: this.indirectArgumentsBuffer } },
      ],
    });
    this.rebuildSourceBindGroups(0);
    this.rebuildSourceBindGroups(1);
    this.rebuildSourceBindGroups(2);
  }

  setLightGlazeView(view: GPUTextureView | null): void {
    this.sourceViews[1] = view ?? this.dummyView;
    if (this.seedBindGroupLayout) {
      this.rebuildSourceBindGroups(1);
    }
  }

  setThicknessTailView(view: GPUTextureView | null): void {
    this.sourceViews[2] = view ?? this.dummyView;
    if (this.seedBindGroupLayout) {
      this.rebuildSourceBindGroups(2);
    }
  }

  private commonSourceEntries(mode: SourceModeCode): GPUBindGroupEntry[] {
    return [
      {
        binding: 0,
        resource: {
          buffer: this.parameterBuffer,
          offset: 0,
          size: PARAMETER_BYTES,
        },
      },
      { binding: 1, resource: this.layerView },
      { binding: 2, resource: this.sourceViews[mode] },
      { binding: 3, resource: { buffer: this.lightGlazeUniformBuffer } },
      { binding: 4, resource: { buffer: this.thicknessTailUniformBuffer } },
    ];
  }

  private rebuildSourceBindGroups(mode: SourceModeCode): void {
    this.seedBindGroups.set(mode, this.device.createBindGroup({
      label: `Traccia seed source mode ${mode}`,
      layout: this.seedBindGroupLayout,
      entries: [
        ...this.commonSourceEntries(mode),
        { binding: 5, resource: { buffer: this.scratchBuffers[0] } },
      ],
    }));
    for (const scratchIndex of [0, 1] as const) {
      this.resolveBindGroups.set(`${mode}:${scratchIndex}`, this.device.createBindGroup({
        label: `Traccia resolve source ${mode}, scratch ${scratchIndex}`,
        layout: this.resolveBindGroupLayout,
        entries: [
          ...this.commonSourceEntries(mode),
          { binding: 5, resource: { buffer: this.scratchBuffers[scratchIndex] } },
          { binding: 6, resource: { buffer: this.distanceBuffer } },
        ],
      }));
    }
    this.composeBindGroups.set(mode, this.device.createBindGroup({
      label: `Traccia compose source mode ${mode}`,
      layout: this.composeBindGroupLayout,
      entries: [
        ...this.commonSourceEntries(mode),
        { binding: 5, resource: { buffer: this.distanceBuffer } },
        { binding: 6, resource: this.styledStorageView },
      ],
    }));
    this.thresholdMaskBindGroups.set(mode, this.device.createBindGroup({
      label: `Traccia alpha-threshold mask source mode ${mode}`,
      layout: this.thresholdMaskBindGroupLayout,
      entries: [
        ...this.commonSourceEntries(mode),
        { binding: 5, resource: { buffer: this.thresholdMaskBuffer } },
        { binding: 6, resource: { buffer: this.changeStateBuffer } },
      ],
    }));
  }

  private buildJobs(rect: RasterStrokeRect, width: number): BuildJob[] {
    const apron = Math.ceil(width + 2);
    const maximumTargetExtent = this.scratchExtent - apron * 2;
    if (maximumTargetExtent <= 0) {
      throw new Error(
        `Scratch Traccia ${this.scratchExtent}px insufficiente per width ${width}px.`,
      );
    }
    const jobs: BuildJob[] = [];
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    for (let y = rect.y; y < bottom; y += maximumTargetExtent) {
      const targetHeight = Math.min(maximumTargetExtent, bottom - y);
      for (let x = rect.x; x < right; x += maximumTargetExtent) {
        const targetWidth = Math.min(maximumTargetExtent, right - x);
        const buildOriginX = Math.max(-1, x - apron);
        const buildOriginY = Math.max(-1, y - apron);
        const buildRight = Math.min(this.documentWidth + 1, x + targetWidth + apron);
        const buildBottom = Math.min(this.documentHeight + 1, y + targetHeight + apron);
        const buildWidth = buildRight - buildOriginX;
        const buildHeight = buildBottom - buildOriginY;
        if (buildWidth > this.scratchExtent || buildHeight > this.scratchExtent) {
          throw new Error(
            `Partizione scratch Traccia non valida: ${buildWidth}×${buildHeight} `
            + `oltre ${this.scratchExtent}.`,
          );
        }
        jobs.push({
          buildOriginX,
          buildOriginY,
          buildWidth,
          buildHeight,
          targetX: x,
          targetY: y,
          targetWidth,
          targetHeight,
          localTargetX: x - buildOriginX,
          localTargetY: y - buildOriginY,
        });
      }
    }
    return jobs;
  }

  private writeParameters(
    slot: number,
    job: Partial<BuildJob>,
    step: number,
    mode: SourceModeCode,
    style: RasterStrokeStyle,
  ): number {
    if (slot >= PARAMETER_CAPACITY) {
      throw new Error(`Troppi dispatch Traccia in un frame: ${slot + 1}.`);
    }
    const word = slot * (PARAMETER_STRIDE / 4);
    this.parameterUploadI32[word] = job.buildOriginX ?? 0;
    this.parameterUploadI32[word + 1] = job.buildOriginY ?? 0;
    this.parameterUploadU32[word + 2] = job.buildWidth ?? 0;
    this.parameterUploadU32[word + 3] = job.buildHeight ?? 0;
    this.parameterUploadU32[word + 4] = job.targetX ?? 0;
    this.parameterUploadU32[word + 5] = job.targetY ?? 0;
    this.parameterUploadU32[word + 6] = job.targetWidth ?? 0;
    this.parameterUploadU32[word + 7] = job.targetHeight ?? 0;
    this.parameterUploadU32[word + 8] = job.localTargetX ?? 0;
    this.parameterUploadU32[word + 9] = job.localTargetY ?? 0;
    this.parameterUploadU32[word + 10] = step;
    this.parameterUploadU32[word + 11] = mode;
    this.parameterUploadF32[word + 12] = style.width;
    this.parameterUploadU32[word + 13] = stylePositionCode(style.position);
    this.parameterUploadU32[word + 14] = 0;
    this.parameterUploadU32[word + 15] = 0;
    this.parameterUploadF32[word + 16] = style.color[0];
    this.parameterUploadF32[word + 17] = style.color[1];
    this.parameterUploadF32[word + 18] = style.color[2];
    this.parameterUploadF32[word + 19] = style.color[3];
    return slot + 1;
  }

  private dynamicOffset(slot: number): readonly number[] {
    return [slot * PARAMETER_STRIDE];
  }

  private writeIndirectArgument(
    argumentIndex: number,
    x: number,
    y: number,
    z = 1,
  ): number {
    if (argumentIndex >= PARAMETER_CAPACITY) {
      throw new Error(
        `Troppi argomenti indirect Traccia in un frame: ${argumentIndex + 1}.`,
      );
    }
    const word = argumentIndex * INDIRECT_ARGUMENT_WORDS;
    this.indirectTemplateUpload[word] = x;
    this.indirectTemplateUpload[word + 1] = y;
    this.indirectTemplateUpload[word + 2] = z;
    return argumentIndex + 1;
  }

  encode(options: RasterStrokeEncodeOptions): RasterStrokeEncodeResult {
    if (this.destroyed) {
      throw new Error("Renderer Traccia già distrutto.");
    }
    const rebuildRect = pairAlignedDistanceRect(
      options.rebuildRect,
      this.documentWidth,
      this.documentHeight,
    );
    const requestedDetectionRect = normalizedRect(
      options.changeDetectionRect,
      this.documentWidth,
      this.documentHeight,
    );
    const directComposeRect = normalizedRect(
      options.composeRect,
      this.documentWidth,
      this.documentHeight,
    );
    const requestedConditionalComposeRect = normalizedRect(
      options.conditionalComposeRect,
      this.documentWidth,
      this.documentHeight,
    );
    const mode = sourceModeCode(options.sourceMode);
    const jobs = rebuildRect ? this.buildJobs(rebuildRect, options.style.width) : [];
    const schedules = jobs.map((job) =>
      jfaScheduleForExtent(Math.max(job.buildWidth, job.buildHeight), { plusOne: true }));
    const useThresholdGate = Boolean(
      jobs.length > 0
      && requestedDetectionRect
      && !options.resetThresholdMask,
    );
    const thresholdRect = jobs.length > 0
      ? useThresholdGate ? requestedDetectionRect : rebuildRect
      : null;
    const conditionalComposeRect = useThresholdGate
      ? requestedConditionalComposeRect
      : null;
    const directComposeRects = [
      directComposeRect,
      useThresholdGate ? null : requestedConditionalComposeRect,
    ].filter((rect): rect is RasterStrokeRect => rect !== null);

    let indirectArgumentCount = 0;
    const jobIndirectArguments: { field: number; resolve: number }[] = [];
    if (useThresholdGate) {
      for (const job of jobs) {
        const field = indirectArgumentCount;
        indirectArgumentCount = this.writeIndirectArgument(
          indirectArgumentCount,
          Math.ceil(job.buildWidth / WORKGROUP_SIZE),
          Math.ceil(job.buildHeight / WORKGROUP_SIZE),
        );
        const resolve = indirectArgumentCount;
        indirectArgumentCount = this.writeIndirectArgument(
          indirectArgumentCount,
          Math.ceil(Math.ceil(job.targetWidth / 2) / WORKGROUP_SIZE),
          Math.ceil(job.targetHeight / WORKGROUP_SIZE),
        );
        jobIndirectArguments.push({ field, resolve });
      }
    }
    let conditionalComposeArgument = -1;
    if (conditionalComposeRect) {
      conditionalComposeArgument = indirectArgumentCount;
      indirectArgumentCount = this.writeIndirectArgument(
        indirectArgumentCount,
        Math.ceil(conditionalComposeRect.width / WORKGROUP_SIZE),
        Math.ceil(conditionalComposeRect.height / WORKGROUP_SIZE),
      );
    }

    let parameterCount = schedules.reduce(
      (total, schedule) => total + schedule.length + 2,
      0,
    );
    parameterCount += directComposeRects.length;
    parameterCount += conditionalComposeRect ? 1 : 0;
    parameterCount += thresholdRect ? 1 : 0;
    parameterCount += useThresholdGate ? 1 : 0;
    if (parameterCount > PARAMETER_CAPACITY) {
      throw new Error(
        `La Traccia richiede ${parameterCount} dispatch, oltre il limite `
        + `${PARAMETER_CAPACITY}.`,
      );
    }

    let parameterSlot = 0;
    const jobSlots: {
      seed: number;
      jfa: number[];
      resolve: number;
    }[] = [];
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const seed = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, job, 0, mode, options.style);
      const jfa: number[] = [];
      for (const step of schedules[index]) {
        jfa.push(parameterSlot);
        parameterSlot = this.writeParameters(
          parameterSlot,
          job,
          step,
          mode,
          options.style,
        );
      }
      const resolve = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, job, 0, mode, options.style);
      jobSlots.push({ seed, jfa, resolve });
    }

    let thresholdSlot = -1;
    if (thresholdRect) {
      thresholdSlot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetX: thresholdRect.x,
        targetY: thresholdRect.y,
        targetWidth: thresholdRect.width,
        targetHeight: thresholdRect.height,
      }, 0, mode, options.style);
    }
    let gateSlot = -1;
    if (useThresholdGate) {
      gateSlot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetWidth: indirectArgumentCount,
        targetHeight: 1,
      }, 0, mode, options.style);
    }
    const directComposeSlots = directComposeRects.map((rect) => {
      const slot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetX: rect.x,
        targetY: rect.y,
        targetWidth: rect.width,
        targetHeight: rect.height,
      }, 0, mode, options.style);
      return slot;
    });
    let conditionalComposeSlot = -1;
    if (conditionalComposeRect) {
      conditionalComposeSlot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetX: conditionalComposeRect.x,
        targetY: conditionalComposeRect.y,
        targetWidth: conditionalComposeRect.width,
        targetHeight: conditionalComposeRect.height,
      }, 0, mode, options.style);
    }

    if (parameterSlot > 0) {
      this.device.queue.writeBuffer(
        this.parameterBuffer,
        0,
        this.parameterUpload,
        0,
        parameterSlot * PARAMETER_STRIDE,
      );
    }
    if (indirectArgumentCount > 0) {
      this.device.queue.writeBuffer(
        this.indirectArgumentsBuffer,
        0,
        this.indirectTemplateUpload.buffer,
        0,
        indirectArgumentCount * INDIRECT_ARGUMENT_BYTES,
      );
    }

    const resetThresholdMask = Boolean(
      options.resetThresholdMask
      || options.clearStyled
      || (jobs.length > 0 && !useThresholdGate),
    );
    if (resetThresholdMask) {
      options.encoder.clearBuffer(this.thresholdMaskBuffer);
    }
    if (thresholdRect) {
      options.encoder.clearBuffer(this.changeStateBuffer);
      const firstBit = thresholdRect.x % THRESHOLD_MASK_WORD_BITS;
      const wordCount = Math.ceil(
        (firstBit + thresholdRect.width) / THRESHOLD_MASK_WORD_BITS,
      );
      const thresholdPass = options.encoder.beginComputePass({
        label: useThresholdGate
          ? "Detect Traccia alpha-threshold changes"
          : "Synchronize Traccia alpha-threshold mask",
      });
      thresholdPass.setPipeline(this.thresholdMaskPipeline);
      thresholdPass.setBindGroup(
        0,
        this.thresholdMaskBindGroups.get(mode)!,
        this.dynamicOffset(thresholdSlot),
      );
      thresholdPass.dispatchWorkgroups(
        Math.ceil(wordCount / WORKGROUP_SIZE),
        Math.ceil(thresholdRect.height / WORKGROUP_SIZE),
      );
      thresholdPass.end();
    }
    if (useThresholdGate) {
      const gatePass = options.encoder.beginComputePass({
        label: "Gate Traccia field dispatches from alpha-threshold changes",
      });
      gatePass.setPipeline(this.indirectGatePipeline);
      gatePass.setBindGroup(
        0,
        this.indirectGateBindGroup,
        this.dynamicOffset(gateSlot),
      );
      gatePass.dispatchWorkgroups(
        Math.ceil(indirectArgumentCount / INDIRECT_GATE_WORKGROUP_SIZE),
      );
      gatePass.end();
    }

    if (options.clearStyled) {
      const clearPass = options.encoder.beginRenderPass({
        label: "Clear Traccia styled layer",
        colorAttachments: [{
          view: this.mipViews[0],
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      clearPass.end();
    }

    let jfaDispatches = 0;
    if (jobs.length > 0) {
      const fieldPass = options.encoder.beginComputePass({
        label: useThresholdGate
          ? "Traccia threshold-gated seed + packed dual JFA + Q10.6 resolve"
          : "Traccia seed + packed dual JFA + Q10.6 resolve",
      });
      for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
        const job = jobs[jobIndex];
        const slots = jobSlots[jobIndex];
        const indirect = jobIndirectArguments[jobIndex];
        fieldPass.setPipeline(this.seedPipeline);
        fieldPass.setBindGroup(
          0,
          this.seedBindGroups.get(mode)!,
          this.dynamicOffset(slots.seed),
        );
        if (useThresholdGate) {
          fieldPass.dispatchWorkgroupsIndirect(
            this.indirectArgumentsBuffer,
            indirect.field * INDIRECT_ARGUMENT_BYTES,
          );
        } else {
          fieldPass.dispatchWorkgroups(
            Math.ceil(job.buildWidth / WORKGROUP_SIZE),
            Math.ceil(job.buildHeight / WORKGROUP_SIZE),
          );
        }

        let sourceScratch: ScratchIndex = 0;
        for (const slot of slots.jfa) {
          fieldPass.setPipeline(this.jfaPipeline);
          fieldPass.setBindGroup(
            0,
            this.jfaBindGroups[sourceScratch],
            this.dynamicOffset(slot),
          );
          if (useThresholdGate) {
            fieldPass.dispatchWorkgroupsIndirect(
              this.indirectArgumentsBuffer,
              indirect.field * INDIRECT_ARGUMENT_BYTES,
            );
          } else {
            fieldPass.dispatchWorkgroups(
              Math.ceil(job.buildWidth / WORKGROUP_SIZE),
              Math.ceil(job.buildHeight / WORKGROUP_SIZE),
            );
          }
          sourceScratch = sourceScratch === 0 ? 1 : 0;
          jfaDispatches += 1;
        }

        fieldPass.setPipeline(this.resolvePipeline);
        fieldPass.setBindGroup(
          0,
          this.resolveBindGroups.get(`${mode}:${sourceScratch}`)!,
          this.dynamicOffset(slots.resolve),
        );
        if (useThresholdGate) {
          fieldPass.dispatchWorkgroupsIndirect(
            this.indirectArgumentsBuffer,
            indirect.resolve * INDIRECT_ARGUMENT_BYTES,
          );
        } else {
          fieldPass.dispatchWorkgroups(
            Math.ceil(Math.ceil(job.targetWidth / 2) / WORKGROUP_SIZE),
            Math.ceil(job.targetHeight / WORKGROUP_SIZE),
          );
        }
      }
      fieldPass.end();
    }

    const composeDispatches = directComposeRects.length + (conditionalComposeRect ? 1 : 0);
    if (composeDispatches > 0) {
      const composePass = options.encoder.beginComputePass({
        label: conditionalComposeRect
          ? "Traccia styled compose with threshold-gated halo"
          : "Traccia styled layer compose",
      });
      composePass.setPipeline(this.composePipeline);
      for (let index = 0; index < directComposeRects.length; index += 1) {
        const rect = directComposeRects[index];
        composePass.setBindGroup(
          0,
          this.composeBindGroups.get(mode)!,
          this.dynamicOffset(directComposeSlots[index]),
        );
        composePass.dispatchWorkgroups(
          Math.ceil(rect.width / WORKGROUP_SIZE),
          Math.ceil(rect.height / WORKGROUP_SIZE),
        );
      }
      if (conditionalComposeRect) {
        composePass.setBindGroup(
          0,
          this.composeBindGroups.get(mode)!,
          this.dynamicOffset(conditionalComposeSlot),
        );
        composePass.dispatchWorkgroupsIndirect(
          this.indirectArgumentsBuffer,
          conditionalComposeArgument * INDIRECT_ARGUMENT_BYTES,
        );
      }
      composePass.end();
    }

    const indirectDispatches = useThresholdGate
      ? jobs.reduce((total, _job, index) => total + schedules[index].length + 2, 0)
        + (conditionalComposeRect ? 1 : 0)
      : 0;
    return {
      cleared: Boolean(options.clearStyled),
      buildJobs: jobs.length,
      jfaDispatches,
      resolveDispatches: jobs.length,
      composeDispatches,
      buildPixels: jobs.reduce(
        (total, job) => total + job.buildWidth * job.buildHeight,
        0,
      ),
      resolvedPixels: jobs.reduce(
        (total, job) => total + job.targetWidth * job.targetHeight,
        0,
      ),
      composedPixels: directComposeRects.reduce(
        (total, rect) => total + rect.width * rect.height,
        conditionalComposeRect
          ? conditionalComposeRect.width * conditionalComposeRect.height
          : 0,
      ),
      thresholdDetectionDispatches: thresholdRect ? 1 : 0,
      thresholdDetectionPixels: thresholdRect
        ? thresholdRect.width * thresholdRect.height
        : 0,
      indirectDispatches,
    };
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.scratchBuffers[0].destroy();
    this.scratchBuffers[1].destroy();
    this.parameterBuffer.destroy();
    this.distanceBuffer.destroy();
    this.thresholdMaskBuffer.destroy();
    this.changeStateBuffer.destroy();
    this.indirectArgumentsBuffer.destroy();
    this.styledTexture.destroy();
    this.dummyTexture.destroy();
    this.seedBindGroups.clear();
    this.resolveBindGroups.clear();
    this.composeBindGroups.clear();
    this.thresholdMaskBindGroups.clear();
  }
}
