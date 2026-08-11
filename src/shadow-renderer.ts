import {
  RASTER_SHADOW_TILE_SIZE,
  normalizeRasterInnerShadowStyle,
  normalizeRasterOuterShadowStyle,
  rasterInnerShadowKernel,
  rasterOuterShadowKernel,
  rasterShadowOffset,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
  type RasterShadowKernel,
  type RasterShadowKind,
  type RasterShadowRect,
} from "./shadow-core";
import type { RasterStrokeSourceMode } from "./stroke-renderer";
import type { EffectsScratchLease, EffectsScratchPool } from "./effects-scratch-pool";

export const RASTER_SHADOW_RENDERER_BUILD =
  "raster-shadow-webgpu-v1-independent-packed-f16-morphology-gaussian";
export const RASTER_SHADOW_STORAGE_STRATEGY =
  "persistent-packed-f16-matte-per-enabled-shadow" as const;
export const RASTER_SHADOW_WORKSPACE_STRATEGY =
  "shared-effects-pool-tiled-f32-ping-pong" as const;

export type RasterShadowStyle = RasterOuterShadowStyle | RasterInnerShadowStyle;

export interface RasterShadowRendererOptions {
  device: GPUDevice;
  scratchPool: EffectsScratchPool;
  kind: RasterShadowKind;
  documentWidth: number;
  documentHeight: number;
  layerView: GPUTextureView;
  lightGlazeUniformBuffer: GPUBuffer;
  thicknessTailUniformBuffer: GPUBuffer;
}

export interface RasterShadowEncodeOptions {
  encoder: GPUCommandEncoder;
  style: RasterShadowStyle;
  sourceMode: RasterStrokeSourceMode;
  rebuildRect?: RasterShadowRect | null;
  clearMatte?: boolean;
}

export interface RasterShadowEncodeResult {
  cleared: boolean;
  jobs: number;
  passes: number;
  sourceDispatches: number;
  morphologyDispatches: number;
  gaussianDispatches: number;
  resolveDispatches: number;
  workPixels: number;
  resolvedPixels: number;
  morphologyRadius: number;
  blurRadius: number;
  workspaceExtent: number;
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

const WORKGROUP_SIZE = 8;
const FILTER_WORKGROUP_SIZE = 64;
const MAX_FILTER_RADIUS = 250;
const FILTER_CACHE_LENGTH =
  FILTER_WORKGROUP_SIZE + MAX_FILTER_RADIUS * 2;
const PARAMETER_BYTES = 80;
const PARAMETER_STRIDE = 256;
const PARAMETER_CAPACITY = 2048;
const COMPOSITION_UNIFORM_BYTES = 64;
const COVERAGE_WORD_PIXELS = 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
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

function normalizedRect(
  rect: RasterShadowRect | null | undefined,
  width: number,
  height: number,
): RasterShadowRect | null {
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

function wordAlignedRect(
  rect: RasterShadowRect | null | undefined,
  width: number,
  height: number,
): RasterShadowRect | null {
  const normalized = normalizedRect(rect, width, height);
  if (!normalized) {
    return null;
  }
  const x = Math.floor(normalized.x / COVERAGE_WORD_PIXELS)
    * COVERAGE_WORD_PIXELS;
  const right = Math.min(
    width,
    Math.ceil((normalized.x + normalized.width) / COVERAGE_WORD_PIXELS)
      * COVERAGE_WORD_PIXELS,
  );
  return {
    x,
    y: normalized.y,
    width: right - x,
    height: normalized.height,
  };
}

function sourceShaderCommon(
  documentWidth: number,
  documentHeight: number,
): string {
  return /* wgsl */ `
struct ShadowParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  scratchExtent: u32,
  radius: u32,
  sigma: f32,
  sourceMode: u32,
  inputOffsetWords: u32,
  outputOffsetWords: u32,
  direction: vec2<i32>,
  _pad0: vec2<u32>,
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

@group(0) @binding(0) var<uniform> parameters: ShadowParameters;
@group(0) @binding(1) var permanentTexture: texture_2d<f32>;
@group(0) @binding(2) var transientTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;
@group(0) @binding(5) var<storage, read_write> arena: array<u32>;
@group(0) @binding(6) var<storage, read_write> shadowMatte: array<u32>;

fn insideDocument(position: vec2<i32>) -> bool {
  return all(position >= vec2<i32>(0)) && all(position < DOCUMENT_SIZE);
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedLightCoverage(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}

fn linearPremultipliedToEncodedSrgb(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let straightLinear = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(linearToSrgb(straightLinear) * alpha, alpha);
}

fn encodedSrgbPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let straightSrgb = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(srgbToLinear(straightSrgb) * alpha, alpha);
}

fn resolvedLightGlaze(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedLightCoverage(accumulatedStroke.r);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  return accumulatedStroke * opacity;
}

fn compositeLightGlazeOverPermanent(
  permanentPaint: vec4<f32>,
  accumulatedStroke: vec4<f32>
) -> vec4<f32> {
  let strokePaint = resolvedLightGlaze(accumulatedStroke);
  if (lightGlaze.accumulationMode == 3u) {
    return quantizeLayer(vec4<f32>(
      permanentPaint.rgb + strokePaint.rgb,
      strokePaint.a + permanentPaint.a * (1.0 - strokePaint.a)
    ));
  }
  if (lightGlaze.accumulationMode == 2u) {
    if (strokePaint.a <= 0.0) {
      return permanentPaint;
    }
    let permanentAlpha = clamp(permanentPaint.a, 0.0, 1.0);
    var boundedPermanentRgb = vec3<f32>(0.0);
    if (permanentAlpha > 0.0) {
      boundedPermanentRgb = clamp(
        permanentPaint.rgb / permanentAlpha,
        vec3<f32>(0.0),
        vec3<f32>(1.0)
      ) * permanentAlpha;
    }
    let extendedResidual = permanentPaint.rgb - boundedPermanentRgb;
    let permanentEncoded = linearPremultipliedToEncodedSrgb(
      vec4<f32>(boundedPermanentRgb, permanentAlpha)
    );
    let compositedEncoded = strokePaint + permanentEncoded * (1.0 - strokePaint.a);
    let boundedResult = encodedSrgbPremultipliedToLinear(compositedEncoded);
    return quantizeLayer(vec4<f32>(
      clamp(
        boundedResult.rgb + extendedResidual * (1.0 - strokePaint.a),
        vec3<f32>(-65504.0),
        vec3<f32>(65504.0)
      ),
      boundedResult.a
    ));
  }
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
}

fn sourceTexel(position: vec2<i32>) -> vec4<f32> {
  if (!insideDocument(position)) {
    return vec4<f32>(0.0);
  }
  let permanentPaint = textureLoad(permanentTexture, position, 0);
  if (parameters.sourceMode == 1u) {
    return compositeLightGlazeOverPermanent(
      permanentPaint,
      textureLoad(transientTexture, position, 0)
    );
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

fn linearIndex(position: vec2<u32>) -> u32 {
  return position.y * parameters.scratchExtent + position.x;
}

fn loadFloat(offsetWords: u32, position: vec2<u32>) -> f32 {
  return bitcast<f32>(arena[offsetWords + linearIndex(position)]);
}

fn storeFloat(offsetWords: u32, position: vec2<u32>, value: f32) {
  arena[offsetWords + linearIndex(position)] = bitcast<u32>(value);
}

fn sampleFloat(offsetWords: u32, position: vec2<i32>, outside: f32) -> f32 {
  if (
    any(position < vec2<i32>(0))
    || any(position >= vec2<i32>(parameters.buildSize))
  ) {
    return outside;
  }
  return loadFloat(offsetWords, vec2<u32>(position));
}
`;
}

function sourceAlphaShader(
  documentWidth: number,
  documentHeight: number,
): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let documentPosition = parameters.buildOrigin + vec2<i32>(globalId.xy);
  storeFloat(
    parameters.outputOffsetWords,
    globalId.xy,
    clamp(sourceTexel(documentPosition).a, 0.0, 1.0)
  );
}
`;
}

function filterShader(
  documentWidth: number,
  documentHeight: number,
  kind: RasterShadowKind,
  operation: "morphology" | "gaussian",
): string {
  const outside = operation === "morphology" && kind === "inner"
    ? "1.0"
    : "0.0";
  const reduction = kind === "inner" ? "min(value, sample)" : "max(value, sample)";
  const body = operation === "morphology"
    ? /* wgsl */ `
  var value = filterCache[center];
  for (var index = 1u; index <= ${MAX_FILTER_RADIUS}u; index += 1u) {
    if (index > parameters.radius) {
      break;
    }
    var sample = filterCache[center + index];
    value = ${reduction};
    sample = filterCache[center - index];
    value = ${reduction};
  }`
    : /* wgsl */ `
  var value = filterCache[center];
  if (parameters.sigma >= 0.3 && parameters.radius > 0u) {
    let inverse = 0.5 / (parameters.sigma * parameters.sigma);
    var sum = value;
    var weightSum = 1.0;
    for (var index = 1u; index <= ${MAX_FILTER_RADIUS}u; index += 1u) {
      if (index > parameters.radius) {
        break;
      }
      let weight = exp(-f32(index * index) * inverse);
      sum += weight * filterCache[center + index];
      sum += weight * filterCache[center - index];
      weightSum += 2.0 * weight;
    }
    value = sum / weightSum;
  }`;
  return `${sourceShaderCommon(documentWidth, documentHeight)}
var<workgroup> filterCache: array<f32, ${FILTER_CACHE_LENGTH}>;

fn outputPosition(groupId: vec3<u32>, lane: u32) -> vec2<u32> {
  if (parameters.direction.x != 0) {
    return vec2<u32>(
      groupId.x * ${FILTER_WORKGROUP_SIZE}u + lane,
      groupId.y
    );
  }
  return vec2<u32>(
    groupId.y,
    groupId.x * ${FILTER_WORKGROUP_SIZE}u + lane
  );
}

fn cacheSourcePosition(groupId: vec3<u32>, cacheIndex: u32) -> vec2<i32> {
  let along = i32(groupId.x * ${FILTER_WORKGROUP_SIZE}u + cacheIndex)
    - ${MAX_FILTER_RADIUS};
  if (parameters.direction.x != 0) {
    return vec2<i32>(along, i32(groupId.y));
  }
  return vec2<i32>(i32(groupId.y), along);
}

@compute @workgroup_size(${FILTER_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${FILTER_CACHE_LENGTH}u;
    cacheIndex += ${FILTER_WORKGROUP_SIZE}u
  ) {
    filterCache[cacheIndex] = sampleFloat(
      parameters.inputOffsetWords,
      cacheSourcePosition(groupId, cacheIndex),
      ${outside}
    );
  }
  workgroupBarrier();
  let output = outputPosition(groupId, localId.x);
  if (any(output >= parameters.buildSize)) {
    return;
  }
  let center = ${MAX_FILTER_RADIUS}u + localId.x;
${body}
  storeFloat(parameters.outputOffsetWords, output, clamp(value, 0.0, 1.0));
}
`;
}

function resolveShader(
  documentWidth: number,
  documentHeight: number,
): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.y >= parameters.targetSize.y) {
    return;
  }
  let firstX = globalId.x * 2u;
  if (firstX >= parameters.targetSize.x) {
    return;
  }
  let firstDocumentPosition = parameters.targetOrigin
    + vec2<u32>(firstX, globalId.y);
  var matte = vec2<f32>(0.0);
  for (var lane = 0u; lane < 2u; lane += 1u) {
    if (firstX + lane >= parameters.targetSize.x) {
      continue;
    }
    let local = parameters.localTargetOrigin
      + vec2<u32>(firstX + lane, globalId.y);
    let value = clamp(loadFloat(parameters.inputOffsetWords, local), 0.0, 1.0);
    matte[lane] = value;
  }
  let linearIndex = firstDocumentPosition.y * ${documentWidth}u
    + firstDocumentPosition.x;
  shadowMatte[linearIndex >> 1u] = pack2x16float(matte);
}
`;
}

async function assertShadersCompiled(
  modules: readonly { label: string; module: GPUShaderModule }[],
): Promise<void> {
  const failures: string[] = [];
  for (const entry of modules) {
    const info = await entry.module.getCompilationInfo();
    for (const message of info.messages) {
      if (message.type === "error") {
        failures.push(
          `${entry.label}:${message.lineNum}:${message.linePos} ${message.message}`,
        );
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`WGSL Ombra non valido:\n${failures.join("\n")}`);
  }
}

export class RasterShadowRenderer {
  static async create(
    options: RasterShadowRendererOptions,
  ): Promise<RasterShadowRenderer> {
    const renderer = new RasterShadowRenderer(options);
    try {
      await renderer.initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  readonly build = RASTER_SHADOW_RENDERER_BUILD;
  readonly kind: RasterShadowKind;
  readonly effectId: "outer-shadow" | "inner-shadow";
  readonly coverageMemoryBytes: number;
  readonly controlMemoryBytes: number;
  readonly coverageBuffer: GPUBuffer;
  readonly compositionUniformBuffer: GPUBuffer;

  private readonly device: GPUDevice;
  private readonly scratchPool: EffectsScratchPool;
  private readonly documentWidth: number;
  private readonly documentHeight: number;
  private layerView: GPUTextureView;
  private readonly lightGlazeUniformBuffer: GPUBuffer;
  private readonly thicknessTailUniformBuffer: GPUBuffer;
  private readonly parameterBuffer: GPUBuffer;
  private readonly parameterUpload =
    new ArrayBuffer(PARAMETER_CAPACITY * PARAMETER_STRIDE);
  private readonly parameterUploadI32 = new Int32Array(this.parameterUpload);
  private readonly parameterUploadU32 = new Uint32Array(this.parameterUpload);
  private readonly parameterUploadF32 = new Float32Array(this.parameterUpload);
  private readonly compositionUpload = new ArrayBuffer(COMPOSITION_UNIFORM_BYTES);
  private readonly compositionUploadU32 = new Uint32Array(this.compositionUpload);
  private readonly compositionUploadF32 = new Float32Array(this.compositionUpload);
  private sourceViews: Record<SourceModeCode, GPUTextureView>;
  private lightGlazeView: GPUTextureView | null = null;
  private thicknessTailView: GPUTextureView | null = null;
  private bindGroupLayout!: GPUBindGroupLayout;
  private bindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private sourcePipeline!: GPUComputePipeline;
  private morphologyPipeline!: GPUComputePipeline;
  private gaussianPipeline!: GPUComputePipeline;
  private resolvePipeline!: GPUComputePipeline;
  private scratchPoolGeneration = -1;
  private scratchPoolLayoutVersion = -1;
  private _workspaceExtent = 0;
  private _workspaceMemoryBytes = 0;
  private _totalBuilds = 0;
  private _totalPasses = 0;
  private _lastEncode: RasterShadowEncodeResult | null = null;
  private destroyed = false;

  private constructor(options: RasterShadowRendererOptions) {
    this.device = options.device;
    this.scratchPool = options.scratchPool;
    this.kind = options.kind;
    this.effectId = this.kind === "outer" ? "outer-shadow" : "inner-shadow";
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    if (this.documentWidth % COVERAGE_WORD_PIXELS !== 0) {
      throw new Error("La larghezza documento Ombra deve essere divisibile per 2.");
    }
    this.layerView = options.layerView;
    this.lightGlazeUniformBuffer = options.lightGlazeUniformBuffer;
    this.thicknessTailUniformBuffer = options.thicknessTailUniformBuffer;
    this.sourceViews = {
      0: this.layerView,
      1: this.layerView,
      2: this.layerView,
    };
    const coverageWords = Math.ceil(
      this.documentWidth * this.documentHeight / COVERAGE_WORD_PIXELS,
    );
    this.coverageMemoryBytes = coverageWords * 4;
    this.coverageBuffer = this.device.createBuffer({
      label: `${this.label} persistent packed f16 matte`,
      size: this.coverageMemoryBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.parameterBuffer = this.device.createBuffer({
      label: `${this.label} dynamic dispatch parameters`,
      size: PARAMETER_CAPACITY * PARAMETER_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.compositionUniformBuffer = this.device.createBuffer({
      label: `${this.label} composition parameters`,
      size: COMPOSITION_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.controlMemoryBytes =
      PARAMETER_CAPACITY * PARAMETER_STRIDE + COMPOSITION_UNIFORM_BYTES;
  }

  private get label(): string {
    return this.kind === "outer" ? "Ombra esterna" : "Ombra interna";
  }

  get workspaceExtent(): number {
    return this._workspaceExtent;
  }

  get workspaceMemoryBytes(): number {
    return this._workspaceMemoryBytes;
  }

  get totalBuilds(): number {
    return this._totalBuilds;
  }

  get totalPasses(): number {
    return this._totalPasses;
  }

  get lastEncode(): RasterShadowEncodeResult | null {
    return this._lastEncode ? { ...this._lastEncode } : null;
  }

  private normalizedStyle(source: unknown): RasterShadowStyle {
    return this.kind === "outer"
      ? normalizeRasterOuterShadowStyle(source)
      : normalizeRasterInnerShadowStyle(source);
  }

  private styleKernel(source: unknown): RasterShadowKernel {
    return this.kind === "outer"
      ? rasterOuterShadowKernel(source)
      : rasterInnerShadowKernel(source);
  }

  private async initialize(): Promise<void> {
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label} compute bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform", hasDynamicOffset: true },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: {} },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const modules = [
      {
        label: "source",
        module: this.device.createShaderModule({
          label: `${this.label} source alpha WGSL`,
          code: sourceAlphaShader(this.documentWidth, this.documentHeight),
        }),
      },
      {
        label: "morphology",
        module: this.device.createShaderModule({
          label: `${this.label} morphology WGSL`,
          code: filterShader(
            this.documentWidth,
            this.documentHeight,
            this.kind,
            "morphology",
          ),
        }),
      },
      {
        label: "gaussian",
        module: this.device.createShaderModule({
          label: `${this.label} gaussian WGSL`,
          code: filterShader(
            this.documentWidth,
            this.documentHeight,
            this.kind,
            "gaussian",
          ),
        }),
      },
      {
        label: "resolve",
        module: this.device.createShaderModule({
          label: `${this.label} resolve packed f16 WGSL`,
          code: resolveShader(this.documentWidth, this.documentHeight),
        }),
      },
    ] as const;
    await assertShadersCompiled(modules);
    const pipelineLayout = this.device.createPipelineLayout({
      label: `${this.label} compute pipeline layout`,
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.sourcePipeline = this.device.createComputePipeline({
      label: `${this.label} source alpha pipeline`,
      layout: pipelineLayout,
      compute: { module: modules[0].module, entryPoint: "main" },
    });
    this.morphologyPipeline = this.device.createComputePipeline({
      label: `${this.label} morphology pipeline`,
      layout: pipelineLayout,
      compute: { module: modules[1].module, entryPoint: "main" },
    });
    this.gaussianPipeline = this.device.createComputePipeline({
      label: `${this.label} gaussian pipeline`,
      layout: pipelineLayout,
      compute: { module: modules[2].module, entryPoint: "main" },
    });
    this.resolvePipeline = this.device.createComputePipeline({
      label: `${this.label} resolve packed f16 pipeline`,
      layout: pipelineLayout,
      compute: { module: modules[3].module, entryPoint: "main" },
    });
    this.updateStyle(this.normalizedStyle({}));
  }

  private updateWorkspace(kernel: RasterShadowKernel): EffectsScratchLease {
    const requestedExtent = align(
      RASTER_SHADOW_TILE_SIZE + kernel.influenceRadius * 2,
      WORKGROUP_SIZE,
    );
    const maximumExtent = Math.floor(Math.sqrt(
      Number(this.device.limits.maxStorageBufferBindingSize) / 8,
    ));
    const extent = Math.min(requestedExtent, maximumExtent);
    if (extent < requestedExtent) {
      throw new Error(
        `${this.label}: size richiesta oltre lo storage buffer disponibile.`,
      );
    }
    const rangeBytes = extent * extent * 4;
    const lease = this.scratchPool.declareEffect(this.effectId, [
      {
        id: "scalar-a",
        label: `${this.label} scalar scratch A ${extent}²`,
        size: rangeBytes,
      },
      {
        id: "scalar-b",
        label: `${this.label} scalar scratch B ${extent}²`,
        size: rangeBytes,
      },
    ]);
    if (!lease) {
      throw new Error(`${this.label}: lease scratch non disponibile.`);
    }
    this._workspaceExtent = extent;
    this._workspaceMemoryBytes = lease.footprintBytes;
    this.rebuildBindGroups(lease);
    return lease;
  }

  prewarmWorkspace(source: unknown): void {
    this.requireScratchLease(this.styleKernel(source));
  }

  private requireScratchLease(kernel: RasterShadowKernel): EffectsScratchLease {
    let lease = this.scratchPool.lease(this.effectId);
    const requestedExtent = align(
      RASTER_SHADOW_TILE_SIZE + kernel.influenceRadius * 2,
      WORKGROUP_SIZE,
    );
    if (!lease || this._workspaceExtent < requestedExtent) {
      lease = this.updateWorkspace(kernel);
    }
    if (
      lease.generation !== this.scratchPoolGeneration
      || lease.layoutVersion !== this.scratchPoolLayoutVersion
    ) {
      this.rebuildBindGroups(lease);
    }
    return lease;
  }

  private rebuildBindGroups(lease?: EffectsScratchLease): void {
    const current = lease ?? this.scratchPool.lease(this.effectId);
    this.bindGroups.clear();
    if (!current || !this.bindGroupLayout) {
      return;
    }
    this.scratchPoolGeneration = current.generation;
    this.scratchPoolLayoutVersion = current.layoutVersion;
    for (const mode of [0, 1, 2] as const) {
      this.bindGroups.set(mode, this.device.createBindGroup({
        label: `${this.label} source mode ${mode}`,
        layout: this.bindGroupLayout,
        entries: [
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
          {
            binding: 3,
            resource: { buffer: this.lightGlazeUniformBuffer },
          },
          {
            binding: 4,
            resource: { buffer: this.thicknessTailUniformBuffer },
          },
          {
            binding: 5,
            resource: {
              buffer: current.buffer,
              offset: 0,
              size: current.footprintBytes,
            },
          },
          { binding: 6, resource: { buffer: this.coverageBuffer } },
        ],
      }));
    }
  }

  setLightGlazeView(view: GPUTextureView | null): void {
    this.lightGlazeView = view;
    this.sourceViews[1] = view ?? this.layerView;
    this.rebuildBindGroups();
  }

  setThicknessTailView(view: GPUTextureView | null): void {
    this.thicknessTailView = view;
    this.sourceViews[2] = view ?? this.layerView;
    this.rebuildBindGroups();
  }

  retarget(layerView: GPUTextureView): void {
    if (this.destroyed) {
      throw new Error(`${this.label}: renderer già distrutto.`);
    }
    this.layerView = layerView;
    this.sourceViews[0] = layerView;
    this.sourceViews[1] = this.lightGlazeView ?? layerView;
    this.sourceViews[2] = this.thicknessTailView ?? layerView;
    this.rebuildBindGroups();
  }

  updateStyle(source: unknown, globalLightAngle?: number): void {
    const style = this.normalizedStyle(source);
    const angle = style.useGlobalLight && Number.isFinite(globalLightAngle)
      ? Number(globalLightAngle)
      : style.angle;
    const offset = rasterShadowOffset(angle, style.distance);
    const contourCode = style.contour === "cone"
      ? 1
      : style.contour === "gaussian"
        ? 2
        : style.contour === "ring"
          ? 3
          : 0;
    this.compositionUploadU32.fill(0);
    this.compositionUploadF32.fill(0);
    this.compositionUploadU32[0] = style.enabled ? 1 : 0;
    this.compositionUploadU32[1] = style.blendMode === "multiply" ? 1 : 0;
    this.compositionUploadU32[2] = contourCode;
    this.compositionUploadU32[3] = style.contourAA ? 1 : 0;
    this.compositionUploadF32[4] = style.color[0];
    this.compositionUploadF32[5] = style.color[1];
    this.compositionUploadF32[6] = style.color[2];
    this.compositionUploadF32[7] = style.opacity / 100;
    this.compositionUploadF32[8] = offset[0];
    this.compositionUploadF32[9] = offset[1];
    this.compositionUploadF32[10] = style.noise / 100;
    this.compositionUploadF32[11] = this.kind === "outer"
      && normalizeRasterOuterShadowStyle(style).layerKnocksOut
      ? 1
      : 0;
    this.compositionUploadU32[12] = this.kind === "outer"
      ? 0x4f555445
      : 0x494e4e52;
    this.compositionUploadU32[13] = this.kind === "outer" ? 0 : 1;
    this.device.queue.writeBuffer(
      this.compositionUniformBuffer,
      0,
      this.compositionUpload,
    );
    if (style.enabled) {
      this.prewarmWorkspace(style);
    }
  }

  private planJobs(
    rect: RasterShadowRect,
    influenceRadius: number,
  ): BuildJob[] {
    const jobs: BuildJob[] = [];
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    for (let targetY = rect.y; targetY < bottom; targetY += RASTER_SHADOW_TILE_SIZE) {
      const targetHeight = Math.min(RASTER_SHADOW_TILE_SIZE, bottom - targetY);
      for (
        let targetX = rect.x;
        targetX < right;
        targetX += RASTER_SHADOW_TILE_SIZE
      ) {
        const targetWidth = Math.min(RASTER_SHADOW_TILE_SIZE, right - targetX);
        jobs.push({
          buildOriginX: targetX - influenceRadius,
          buildOriginY: targetY - influenceRadius,
          buildWidth: targetWidth + influenceRadius * 2,
          buildHeight: targetHeight + influenceRadius * 2,
          targetX,
          targetY,
          targetWidth,
          targetHeight,
          localTargetX: influenceRadius,
          localTargetY: influenceRadius,
        });
      }
    }
    return jobs;
  }

  private writeParameters(
    index: number,
    job: BuildJob,
    mode: SourceModeCode,
    radius: number,
    sigma: number,
    inputOffsetWords: number,
    outputOffsetWords: number,
    directionX: number,
    directionY: number,
  ): number {
    if (index >= PARAMETER_CAPACITY) {
      throw new Error(`${this.label}: capacità parametri dispatch superata.`);
    }
    const byteOffset = index * PARAMETER_STRIDE;
    const wordOffset = byteOffset / 4;
    this.parameterUploadI32[wordOffset] = job.buildOriginX;
    this.parameterUploadI32[wordOffset + 1] = job.buildOriginY;
    this.parameterUploadU32[wordOffset + 2] = job.buildWidth;
    this.parameterUploadU32[wordOffset + 3] = job.buildHeight;
    this.parameterUploadU32[wordOffset + 4] = job.targetX;
    this.parameterUploadU32[wordOffset + 5] = job.targetY;
    this.parameterUploadU32[wordOffset + 6] = job.targetWidth;
    this.parameterUploadU32[wordOffset + 7] = job.targetHeight;
    this.parameterUploadU32[wordOffset + 8] = job.localTargetX;
    this.parameterUploadU32[wordOffset + 9] = job.localTargetY;
    this.parameterUploadU32[wordOffset + 10] = this._workspaceExtent;
    this.parameterUploadU32[wordOffset + 11] = radius;
    this.parameterUploadF32[wordOffset + 12] = sigma;
    this.parameterUploadU32[wordOffset + 13] = mode;
    this.parameterUploadU32[wordOffset + 14] = inputOffsetWords;
    this.parameterUploadU32[wordOffset + 15] = outputOffsetWords;
    this.parameterUploadI32[wordOffset + 16] = directionX;
    this.parameterUploadI32[wordOffset + 17] = directionY;
    return byteOffset;
  }

  encode(options: RasterShadowEncodeOptions): RasterShadowEncodeResult {
    if (this.destroyed) {
      throw new Error(`${this.label}: renderer già distrutto.`);
    }
    const style = this.normalizedStyle(options.style);
    const kernel = this.styleKernel(style);
    const rect = wordAlignedRect(
      options.rebuildRect,
      this.documentWidth,
      this.documentHeight,
    );
    const cleared = options.clearMatte === true;
    if (cleared) {
      options.encoder.clearBuffer(this.coverageBuffer);
    }
    if (!style.enabled || !rect) {
      const empty: RasterShadowEncodeResult = {
        cleared,
        jobs: 0,
        passes: 0,
        sourceDispatches: 0,
        morphologyDispatches: 0,
        gaussianDispatches: 0,
        resolveDispatches: 0,
        workPixels: 0,
        resolvedPixels: 0,
        morphologyRadius: kernel.morphologyRadius,
        blurRadius: kernel.blurRadius,
        workspaceExtent: this._workspaceExtent,
      };
      this._lastEncode = empty;
      return empty;
    }
    const lease = this.requireScratchLease(kernel);
    const rangeA = lease.ranges["scalar-a"];
    const rangeB = lease.ranges["scalar-b"];
    if (!rangeA || !rangeB) {
      throw new Error(`${this.label}: range scratch mancanti.`);
    }
    const offsetA = rangeA.offset / 4;
    const offsetB = rangeB.offset / 4;
    const jobs = this.planJobs(rect, kernel.influenceRadius);
    let parameterIndex = 0;
    const commands: {
      pipeline: GPUComputePipeline;
      offset: number;
      x: number;
      y: number;
    }[] = [];
    let morphologyDispatches = 0;
    let gaussianDispatches = 0;
    let workPixels = 0;
    for (const job of jobs) {
      workPixels += job.buildWidth * job.buildHeight;
      commands.push({
        pipeline: this.sourcePipeline,
        offset: this.writeParameters(
          parameterIndex++,
          job,
          sourceModeCode(options.sourceMode),
          0,
          0,
          0,
          offsetA,
          0,
          0,
        ),
        x: Math.ceil(job.buildWidth / WORKGROUP_SIZE),
        y: Math.ceil(job.buildHeight / WORKGROUP_SIZE),
      });
      if (kernel.morphologyRadius > 0) {
        commands.push({
          pipeline: this.morphologyPipeline,
          offset: this.writeParameters(
            parameterIndex++,
            job,
            sourceModeCode(options.sourceMode),
            kernel.morphologyRadius,
            0,
            offsetA,
            offsetB,
            1,
            0,
          ),
          x: Math.ceil(job.buildWidth / FILTER_WORKGROUP_SIZE),
          y: job.buildHeight,
        });
        commands.push({
          pipeline: this.morphologyPipeline,
          offset: this.writeParameters(
            parameterIndex++,
            job,
            sourceModeCode(options.sourceMode),
            kernel.morphologyRadius,
            0,
            offsetB,
            offsetA,
            0,
            1,
          ),
          x: Math.ceil(job.buildHeight / FILTER_WORKGROUP_SIZE),
          y: job.buildWidth,
        });
        morphologyDispatches += 2;
      }
      if (kernel.blurRadius > 0) {
        commands.push({
          pipeline: this.gaussianPipeline,
          offset: this.writeParameters(
            parameterIndex++,
            job,
            sourceModeCode(options.sourceMode),
            kernel.blurRadius,
            kernel.sigma,
            offsetA,
            offsetB,
            1,
            0,
          ),
          x: Math.ceil(job.buildWidth / FILTER_WORKGROUP_SIZE),
          y: job.buildHeight,
        });
        commands.push({
          pipeline: this.gaussianPipeline,
          offset: this.writeParameters(
            parameterIndex++,
            job,
            sourceModeCode(options.sourceMode),
            kernel.blurRadius,
            kernel.sigma,
            offsetB,
            offsetA,
            0,
            1,
          ),
          x: Math.ceil(job.buildHeight / FILTER_WORKGROUP_SIZE),
          y: job.buildWidth,
        });
        gaussianDispatches += 2;
      }
      commands.push({
        pipeline: this.resolvePipeline,
        offset: this.writeParameters(
          parameterIndex++,
          job,
          sourceModeCode(options.sourceMode),
          0,
          0,
          offsetA,
          0,
          0,
          0,
        ),
        x: Math.ceil(job.targetWidth / (WORKGROUP_SIZE * COVERAGE_WORD_PIXELS)),
        y: Math.ceil(job.targetHeight / WORKGROUP_SIZE),
      });
    }
    this.device.queue.writeBuffer(
      this.parameterBuffer,
      0,
      this.parameterUpload,
      0,
      parameterIndex * PARAMETER_STRIDE,
    );
    const pass = options.encoder.beginComputePass({
      label: `${this.label} tiled morphology/Gaussian matte`,
    });
    const bindGroup = this.bindGroups.get(sourceModeCode(options.sourceMode));
    if (!bindGroup) {
      pass.end();
      throw new Error(`${this.label}: bind group sorgente mancante.`);
    }
    for (const command of commands) {
      pass.setPipeline(command.pipeline);
      pass.setBindGroup(0, bindGroup, [command.offset]);
      pass.dispatchWorkgroups(command.x, command.y);
    }
    pass.end();
    const result: RasterShadowEncodeResult = {
      cleared,
      jobs: jobs.length,
      passes: commands.length > 0 ? 1 : 0,
      sourceDispatches: jobs.length,
      morphologyDispatches,
      gaussianDispatches,
      resolveDispatches: jobs.length,
      workPixels,
      resolvedPixels: rect.width * rect.height,
      morphologyRadius: kernel.morphologyRadius,
      blurRadius: kernel.blurRadius,
      workspaceExtent: this._workspaceExtent,
    };
    this._totalBuilds += jobs.length > 0 ? 1 : 0;
    this._totalPasses += result.passes;
    this._lastEncode = result;
    return result;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.scratchPool.releaseRequirement(this.effectId);
    this.coverageBuffer.destroy();
    this.parameterBuffer.destroy();
    this.compositionUniformBuffer.destroy();
    this.bindGroups.clear();
    this._workspaceExtent = 0;
    this._workspaceMemoryBytes = 0;
  }
}
