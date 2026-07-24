import {
  RASTER_BEVEL_MAX_WORK_SIDE,
  RASTER_BEVEL_NORMAL_APRON,
  RASTER_BEVEL_PROFILE_SIZE,
  RASTER_BEVEL_TILE_SIZE,
  deriveRasterBevelHeightfield,
  makeRasterBevelSplineContourLut,
  normalizeRasterBevelStyle,
  type RasterBevelRect,
  type RasterBevelStyle,
} from "./bevel-core";
import { jfaScheduleForExtent } from "./stroke-core";
import type { RasterStrokeSourceMode } from "./stroke-renderer";
import type { EffectsScratchLease, EffectsScratchPool } from "./effects-scratch-pool";

export const RASTER_BEVEL_RENDERER_BUILD =
  "raster-bevel-webgpu-v4-shared-effects-scratch-retargetable-layer-heightfield-v2-r32f-segment-jfa-workgroup-gaussian-gpu-gate";
export const RASTER_BEVEL_FIELD_STRATEGY =
  "persistent-document-plus-one-pixel-apron-r32float-heightfield" as const;
export const RASTER_BEVEL_DISTANCE_STRATEGY =
  "subpixel-marching-squares-segment-jfa-r32float" as const;
export const RASTER_BEVEL_WORKSPACE_STRATEGY =
  "shared-effects-pool-roi-split-common-segment-arenas-grow-until-idle-shrink" as const;

export interface RasterBevelRendererOptions {
  device: GPUDevice;
  scratchPool: EffectsScratchPool;
  documentWidth: number;
  documentHeight: number;
  layerView: GPUTextureView;
  lightGlazeUniformBuffer: GPUBuffer;
  thicknessTailUniformBuffer: GPUBuffer;
}

export interface RasterBevelEncodeOptions {
  encoder: GPUCommandEncoder;
  style: RasterBevelStyle;
  sourceMode: RasterStrokeSourceMode;
  rebuildRect?: RasterBevelRect | null;
  changeDetectionRect?: RasterBevelRect | null;
  clearHeight?: boolean;
}

export interface RasterBevelEncodeResult {
  cleared: boolean;
  jobs: number;
  passes: number;
  jfaDispatches: number;
  workPixels: number;
  resolvedPixels: number;
  workSide: number;
  apron: number;
  technique: RasterBevelStyle["technique"];
  gateScans: number;
  indirectDispatches: number;
}

interface BuildJob {
  buildOriginX: number;
  buildOriginY: number;
  buildSide: number;
  targetX: number;
  targetY: number;
  targetWidth: number;
  targetHeight: number;
  localTargetX: number;
  borderLeft: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  localTargetY: number;
}

interface WorkspaceLayout {
  extent: number;
  segments: boolean;
  coverageOffsetWords: number;
  scalarAOffsetWords: number;
  scalarBOffsetWords: number;
  segmentAOffsetWords: number;
  segmentBOffsetWords: number;
  totalBytes: number;
  commonBytes: number;
  segmentBytes: number;
}

type SourceModeCode = 0 | 1 | 2;

const WORKGROUP_SIZE = 8;
const PARAMETER_BYTES = 128;
const PARAMETER_STRIDE = 256;
const PARAMETER_CAPACITY = 6144;
const ARENA_ALIGNMENT_BYTES = 256;
const MAX_GAUSSIAN_RADIUS = 384;
const GAUSSIAN_WORKGROUP_SIZE = 64;
const GAUSSIAN_CACHE_LENGTH =
  GAUSSIAN_WORKGROUP_SIZE + MAX_GAUSSIAN_RADIUS * 2;
const EMPTY_SEGMENT = -1.0e8;
const ALPHA_CLASS_WORD_BITS = 32;
const INDIRECT_ARGUMENT_WORDS = 3;
const INDIRECT_ARGUMENT_BYTES = INDIRECT_ARGUMENT_WORDS * 4;

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
  rect: RasterBevelRect | null | undefined,
  width: number,
  height: number,
): RasterBevelRect | null {
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

function workspaceLayout(extent: number, segments: boolean): WorkspaceLayout {
  const pixels = extent * extent;
  const alignedWords = (words: number): number =>
    align(words * 4, ARENA_ALIGNMENT_BYTES) / 4;
  let commonCursor = 0;
  const coverageOffsetWords = commonCursor;
  commonCursor += alignedWords(Math.ceil(pixels / 4));
  const scalarAOffsetWords = commonCursor;
  commonCursor += alignedWords(pixels);
  const scalarBOffsetWords = commonCursor;
  commonCursor += alignedWords(pixels);
  let segmentCursor = 0;
  const segmentAOffsetWords = segmentCursor;
  if (segments) {
    segmentCursor += alignedWords(pixels * 4);
  }
  const segmentBOffsetWords = segmentCursor;
  if (segments) {
    segmentCursor += alignedWords(pixels * 4);
  }
  const commonBytes = commonCursor * 4;
  const segmentBytes = Math.max(ARENA_ALIGNMENT_BYTES, segmentCursor * 4);
  return {
    extent,
    segments,
    coverageOffsetWords,
    scalarAOffsetWords,
    scalarBOffsetWords,
    segmentAOffsetWords,
    segmentBOffsetWords,
    commonBytes,
    segmentBytes,
    totalBytes: commonBytes + segmentBytes,
  };
}

function sourceShaderCommon(documentWidth: number, documentHeight: number): string {
  return /* wgsl */ `
struct BevelParameters {
  buildOrigin: vec2<i32>,
  buildSize: vec2<u32>,
  targetOrigin: vec2<u32>,
  targetSize: vec2<u32>,
  localTargetOrigin: vec2<u32>,
  scratchExtent: u32,
  step: u32,
  sourceMode: u32,
  mode: u32,
  technique: u32,
  radius: u32,
  sigma: f32,
  size: f32,
  bevelRange: f32,
  useContour: u32,
  inputOffsetWords: u32,
  outputOffsetWords: u32,
  direction: vec2<i32>,
  sourceOffset: vec2<i32>,
  farDistance: f32,
  inputKind: u32,
  destinationOffset: vec2<i32>,
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
const EMPTY_SEGMENT = ${EMPTY_SEGMENT};
const PROFILE_MAX_INDEX = ${RASTER_BEVEL_PROFILE_SIZE - 1}u;

@group(0) @binding(0) var<uniform> parameters: BevelParameters;
@group(0) @binding(1) var permanentTexture: texture_2d<f32>;
@group(0) @binding(2) var transientTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;
@group(0) @binding(5) var<storage, read_write> arena: array<u32>;
@group(0) @binding(9) var<storage, read_write> alphaClassMask: array<u32>;
@group(0) @binding(10) var<storage, read_write> bevelGateState: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> segmentArena: array<u32>;
@group(0) @binding(6) var heightOutput: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var bevelProfile: texture_2d<f32>;

fn insideDocument(position: vec2<i32>) -> bool {
  return all(position >= vec2<i32>(0)) && all(position < DOCUMENT_SIZE);
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  if (lightGlaze.formatCode == 0u) {
    return round(clamp(value, vec4<f32>(0.0), vec4<f32>(1.0)) * 255.0) / 255.0;
  }
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedM1Coverage(value: f32) -> f32 {
  let coverage = clamp(value, 0.0, 1.0);
  if (lightGlaze.formatCode == 1u) {
    return unpack2x16float(pack2x16float(vec2<f32>(coverage, 0.0))).x;
  }
  return coverage;
}

fn resolvedLightGlaze(accumulatedStroke: vec4<f32>) -> vec4<f32> {
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedM1Coverage(accumulatedStroke.r);
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

fn linearIndex(position: vec2<u32>) -> u32 {
  return position.y * parameters.scratchExtent + position.x;
}

fn loadFloat(offsetWords: u32, position: vec2<u32>) -> f32 {
  return bitcast<f32>(arena[offsetWords + linearIndex(position)]);
}

fn storeFloat(offsetWords: u32, position: vec2<u32>, value: f32) {
  arena[offsetWords + linearIndex(position)] = bitcast<u32>(value);
}

fn loadCoverage(position: vec2<i32>) -> f32 {
  let clamped = clamp(
    position,
    vec2<i32>(0),
    vec2<i32>(parameters.buildSize) - vec2<i32>(1)
  );
  let index = u32(clamped.y) * parameters.scratchExtent + u32(clamped.x);
  let packed = arena[index >> 2u];
  let shift = (index & 3u) * 8u;
  return f32((packed >> shift) & 255u) / 255.0;
}

fn loadSegment(offsetWords: u32, position: vec2<u32>) -> vec4<f32> {
  let index = offsetWords + linearIndex(position) * 4u;
  return vec4<f32>(
    bitcast<f32>(segmentArena[index]),
    bitcast<f32>(segmentArena[index + 1u]),
    bitcast<f32>(segmentArena[index + 2u]),
    bitcast<f32>(segmentArena[index + 3u])
  );
}

fn storeSegment(offsetWords: u32, position: vec2<u32>, value: vec4<f32>) {
  let index = offsetWords + linearIndex(position) * 4u;
  segmentArena[index] = bitcast<u32>(value.x);
  segmentArena[index + 1u] = bitcast<u32>(value.y);
  segmentArena[index + 2u] = bitcast<u32>(value.z);
  segmentArena[index + 3u] = bitcast<u32>(value.w);
}

fn profileValue(value: f32) -> f32 {
  let q = clamp(value, 0.0, 1.0) * f32(PROFILE_MAX_INDEX);
  let first = u32(floor(q));
  let second = min(PROFILE_MAX_INDEX, first + 1u);
  return mix(
    textureLoad(bevelProfile, vec2<i32>(i32(first), 0), 0).r,
    textureLoad(bevelProfile, vec2<i32>(i32(second), 0), 0).r,
    fract(q)
  );
}
`;
}

function coverageShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.y >= parameters.buildSize.y) {
    return;
  }
  let firstX = globalId.x * 4u;
  if (firstX >= parameters.buildSize.x) {
    return;
  }
  var packed = 0u;
  for (var lane = 0u; lane < 4u; lane += 1u) {
    let x = firstX + lane;
    if (x >= parameters.buildSize.x) {
      continue;
    }
    let documentPosition = parameters.buildOrigin + vec2<i32>(i32(x), i32(globalId.y));
    let alpha = clamp(sourceTexel(documentPosition).a, 0.0, 1.0);
    let byte = u32(round(alpha * 255.0));
    packed |= byte << (lane * 8u);
  }
  let index = globalId.y * parameters.scratchExtent + firstX;
  arena[parameters.outputOffsetWords + (index >> 2u)] = packed;
}
`;
}

function segmentShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
fn differentSides(left: f32, right: f32) -> bool {
  return (left >= 0.5) != (right >= 0.5);
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let c = vec2<i32>(globalId.xy);
  let a00 = loadCoverage(c);
  let a10 = loadCoverage(c + vec2<i32>(1, 0));
  let a01 = loadCoverage(c + vec2<i32>(0, 1));
  let a11 = loadCoverage(c + vec2<i32>(1, 1));
  let mask = select(0u, 1u, a00 >= 0.5)
    | select(0u, 2u, a10 >= 0.5)
    | select(0u, 4u, a11 >= 0.5)
    | select(0u, 8u, a01 >= 0.5);
  if (mask == 0u || mask == 15u) {
    storeSegment(parameters.outputOffsetWords, globalId.xy, vec4<f32>(EMPTY_SEGMENT));
    return;
  }
  let base = vec2<f32>(c) + vec2<f32>(0.5);
  var points: array<vec2<f32>, 4>;
  var count = 0u;
  if (differentSides(a00, a10)) {
    points[count] = base + vec2<f32>((0.5 - a00) / (a10 - a00), 0.0);
    count += 1u;
  }
  if (differentSides(a10, a11)) {
    points[count] = base + vec2<f32>(1.0, (0.5 - a10) / (a11 - a10));
    count += 1u;
  }
  if (differentSides(a01, a11)) {
    points[count] = base + vec2<f32>((0.5 - a01) / (a11 - a01), 1.0);
    count += 1u;
  }
  if (differentSides(a00, a01)) {
    points[count] = base + vec2<f32>(0.0, (0.5 - a00) / (a01 - a00));
    count += 1u;
  }
  if (count == 2u) {
    storeSegment(
      parameters.outputOffsetWords,
      globalId.xy,
      vec4<f32>(points[0], points[1])
    );
    return;
  }
  let centerInside = 0.25 * (a00 + a10 + a01 + a11) >= 0.5;
  let chooseMiddle = centerInside == (a00 >= 0.5);
  let result = select(
    vec4<f32>(points[0], points[1]),
    vec4<f32>(points[1], points[2]),
    chooseMiddle
  );
  storeSegment(parameters.outputOffsetWords, globalId.xy, result);
}
`;
}

function jfaShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
fn segmentDistance(point: vec2<f32>, segment: vec4<f32>) -> f32 {
  let ab = segment.zw - segment.xy;
  let t = clamp(
    dot(point - segment.xy, ab) / max(dot(ab, ab), 1.0e-9),
    0.0,
    1.0
  );
  return length(point - (segment.xy + t * ab));
}

fn orderedBefore(left: vec4<f32>, right: vec4<f32>) -> bool {
  return left.x < right.x
    || (left.x == right.x
      && (left.y < right.y
        || (left.y == right.y
          && (left.z < right.z
            || (left.z == right.z && left.w < right.w)))));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let signedPosition = vec2<i32>(globalId.xy);
  let point = vec2<f32>(globalId.xy) + vec2<f32>(0.5);
  var best = loadSegment(parameters.inputOffsetWords, globalId.xy);
  var bestDistance = select(1.0e30, segmentDistance(point, best), best.x >= -1.0e7);
  let step = i32(parameters.step);
  for (var offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX == 0 && offsetY == 0) {
        continue;
      }
      let samplePosition = clamp(
        signedPosition + vec2<i32>(offsetX, offsetY) * step,
        vec2<i32>(0),
        vec2<i32>(parameters.buildSize) - vec2<i32>(1)
      );
      let candidate = loadSegment(
        parameters.inputOffsetWords,
        vec2<u32>(samplePosition)
      );
      if (candidate.x < -1.0e7) {
        continue;
      }
      let distance = segmentDistance(point, candidate);
      if (
        distance < bestDistance - 1.0e-6
        || (abs(distance - bestDistance) <= 1.0e-6 && orderedBefore(candidate, best))
      ) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  storeSegment(parameters.outputOffsetWords, globalId.xy, best);
}
`;
}

function distanceShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
fn segmentDistance(point: vec2<f32>, segment: vec4<f32>) -> f32 {
  let ab = segment.zw - segment.xy;
  let t = clamp(
    dot(point - segment.xy, ab) / max(dot(ab, ab), 1.0e-9),
    0.0,
    1.0
  );
  return length(point - (segment.xy + t * ab));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let segment = loadSegment(parameters.inputOffsetWords, globalId.xy);
  let signValue = select(
    -1.0,
    1.0,
    loadCoverage(vec2<i32>(globalId.xy)) >= 0.5
  );
  let distance = select(
    parameters.farDistance,
    segmentDistance(vec2<f32>(globalId.xy) + vec2<f32>(0.5), segment),
    segment.x >= -1.0e7
  );
  storeFloat(parameters.outputOffsetWords, globalId.xy, signValue * distance);
}
`;
}

function gaussianShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
fn sampleInput(position: vec2<i32>) -> f32 {
  let clamped = clamp(
    position,
    vec2<i32>(0),
    vec2<i32>(parameters.buildSize) - vec2<i32>(1)
  );
  if (parameters.inputKind == 1u) {
    return loadCoverage(clamped);
  }
  return loadFloat(parameters.inputOffsetWords, vec2<u32>(clamped));
}

var<workgroup> gaussianCache: array<f32, ${GAUSSIAN_CACHE_LENGTH}>;

fn outputPosition(groupId: vec3<u32>, lane: u32) -> vec2<u32> {
  if (parameters.direction.x != 0) {
    return vec2<u32>(
      groupId.x * ${GAUSSIAN_WORKGROUP_SIZE}u + lane,
      groupId.y
    );
  }
  return vec2<u32>(
    groupId.y,
    groupId.x * ${GAUSSIAN_WORKGROUP_SIZE}u + lane
  );
}

fn cacheSourcePosition(groupId: vec3<u32>, cacheIndex: u32) -> vec2<i32> {
  let along = i32(groupId.x * ${GAUSSIAN_WORKGROUP_SIZE}u + cacheIndex)
    - ${MAX_GAUSSIAN_RADIUS};
  if (parameters.direction.x != 0) {
    return vec2<i32>(along, i32(groupId.y)) + parameters.sourceOffset;
  }
  return vec2<i32>(i32(groupId.y), along) + parameters.sourceOffset;
}

@compute @workgroup_size(${GAUSSIAN_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${GAUSSIAN_CACHE_LENGTH}u;
    cacheIndex += ${GAUSSIAN_WORKGROUP_SIZE}u
  ) {
    gaussianCache[cacheIndex] = sampleInput(cacheSourcePosition(groupId, cacheIndex));
  }
  workgroupBarrier();
  let output = outputPosition(groupId, localId.x);
  if (any(output >= parameters.targetSize)) {
    return;
  }
  let center = ${MAX_GAUSSIAN_RADIUS}u + localId.x;
  var value = gaussianCache[center];
  if (parameters.sigma >= 0.3) {
    let inverse = 0.5 / (parameters.sigma * parameters.sigma);
    var sum = value;
    var weightSum = 1.0;
    for (var index = 1u; index <= ${MAX_GAUSSIAN_RADIUS}u; index += 1u) {
      if (index > parameters.radius) {
        break;
      }
      let weight = exp(-f32(index * index) * inverse);
      sum += weight * gaussianCache[center + index];
      sum += weight * gaussianCache[center - index];
      weightSum += 2.0 * weight;
    }
    value = sum / weightSum;
  }
  storeFloat(parameters.outputOffsetWords, output, value);
}
`;
}

function heightShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.buildSize)) {
    return;
  }
  let source = loadFloat(parameters.inputOffsetWords, globalId.xy);
  var x = 0.0;
  if (parameters.technique == 0u) {
    if (parameters.mode == 0u) {
      x = clamp(2.0 * source - 1.0, 0.0, 1.0);
    } else if (parameters.mode == 1u) {
      x = clamp(2.0 * source, 0.0, 1.0);
    } else if (parameters.mode == 2u) {
      x = clamp(source, 0.0, 1.0);
    } else {
      x = abs(2.0 * source - 1.0);
    }
  } else {
    let size = max(parameters.size, 1.0e-3);
    if (parameters.mode == 0u) {
      x = clamp(source / size, 0.0, 1.0);
    } else if (parameters.mode == 1u) {
      x = clamp(1.0 + source / size, 0.0, 1.0);
    } else if (parameters.mode == 2u) {
      x = clamp(0.5 + source / (2.0 * size), 0.0, 1.0);
    } else {
      x = clamp(abs(source) / size, 0.0, 1.0);
    }
  }
  if (parameters.useContour == 1u) {
    x = profileValue(min(x / max(parameters.bevelRange, 1.0e-3), 1.0));
  }
  storeFloat(parameters.outputOffsetWords, globalId.xy, x);
}
`;
}

function resolveHeightShader(documentWidth: number, documentHeight: number): string {
  return `${sourceShaderCommon(documentWidth, documentHeight)}
fn sampleInput(position: vec2<i32>) -> f32 {
  let clamped = clamp(
    position,
    vec2<i32>(0),
    vec2<i32>(parameters.buildSize) - vec2<i32>(1)
  );
  return loadFloat(parameters.inputOffsetWords, vec2<u32>(clamped));
}

var<workgroup> gaussianCache: array<f32, ${GAUSSIAN_CACHE_LENGTH}>;

fn outputPosition(groupId: vec3<u32>, lane: u32) -> vec2<u32> {
  if (parameters.direction.x != 0) {
    return vec2<u32>(
      groupId.x * ${GAUSSIAN_WORKGROUP_SIZE}u + lane,
      groupId.y
    );
  }
  return vec2<u32>(
    groupId.y,
    groupId.x * ${GAUSSIAN_WORKGROUP_SIZE}u + lane
  );
}

fn cacheSourcePosition(groupId: vec3<u32>, cacheIndex: u32) -> vec2<i32> {
  let along = i32(groupId.x * ${GAUSSIAN_WORKGROUP_SIZE}u + cacheIndex)
    - ${MAX_GAUSSIAN_RADIUS};
  if (parameters.direction.x != 0) {
    return vec2<i32>(along, i32(groupId.y)) + parameters.sourceOffset;
  }
  return vec2<i32>(i32(groupId.y), along) + parameters.sourceOffset;
}

@compute @workgroup_size(${GAUSSIAN_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>
) {
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${GAUSSIAN_CACHE_LENGTH}u;
    cacheIndex += ${GAUSSIAN_WORKGROUP_SIZE}u
  ) {
    gaussianCache[cacheIndex] = sampleInput(cacheSourcePosition(groupId, cacheIndex));
  }
  workgroupBarrier();
  let output = outputPosition(groupId, localId.x);
  if (any(output >= parameters.targetSize)) {
    return;
  }
  let center = ${MAX_GAUSSIAN_RADIUS}u + localId.x;
  var value = gaussianCache[center];
  if (parameters.sigma >= 0.3) {
    let inverse = 0.5 / (parameters.sigma * parameters.sigma);
    var sum = value;
    var weightSum = 1.0;
    for (var index = 1u; index <= ${MAX_GAUSSIAN_RADIUS}u; index += 1u) {
      if (index > parameters.radius) {
        break;
      }
      let weight = exp(-f32(index * index) * inverse);
      sum += weight * gaussianCache[center + index];
      sum += weight * gaussianCache[center - index];
      weightSum += 2.0 * weight;
    }
    value = sum / weightSum;
  }
  let documentPosition = vec2<i32>(parameters.targetOrigin)
    + vec2<i32>(output)
    + parameters.destinationOffset
    + vec2<i32>(${RASTER_BEVEL_NORMAL_APRON});
  textureStore(heightOutput, vec2<i32>(documentPosition), vec4<f32>(value, 0.0, 0.0, 0.0));
}
`;
}

function alphaClassMaskShader(documentWidth: number, documentHeight: number): string {
  const wordsPerRow = Math.ceil(documentWidth / ALPHA_CLASS_WORD_BITS);
  const wordCount = wordsPerRow * documentHeight;
  return `${sourceShaderCommon(documentWidth, documentHeight)}
const ALPHA_WORD_BITS = ${ALPHA_CLASS_WORD_BITS}u;
const ALPHA_WORDS_PER_ROW = ${wordsPerRow}u;
const ALPHA_WORD_COUNT = ${wordCount}u;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let firstWord = parameters.targetOrigin.x / ALPHA_WORD_BITS;
  let firstBit = parameters.targetOrigin.x % ALPHA_WORD_BITS;
  let targetWordCount = (
    firstBit + parameters.targetSize.x + ALPHA_WORD_BITS - 1u
  ) / ALPHA_WORD_BITS;
  if (globalId.x >= targetWordCount || globalId.y >= parameters.targetSize.y) {
    return;
  }
  let wordX = firstWord + globalId.x;
  let documentY = parameters.targetOrigin.y + globalId.y;
  let wordOriginX = wordX * ALPHA_WORD_BITS;
  let targetRight = parameters.targetOrigin.x + parameters.targetSize.x;
  var writeMask = 0u;
  var thresholdBits = 0u;
  var fractionalBits = 0u;
  for (var lane = 0u; lane < ALPHA_WORD_BITS; lane += 1u) {
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
    let alpha = clamp(
      sourceTexel(vec2<i32>(i32(documentX), i32(documentY))).a,
      0.0,
      1.0
    );
    let alphaByte = u32(round(alpha * 255.0));
    if (alphaByte >= 128u) {
      thresholdBits |= bit;
    }
    if (alphaByte > 0u && alphaByte < 255u) {
      fractionalBits |= bit;
    }
  }
  let maskIndex = documentY * ALPHA_WORDS_PER_ROW + wordX;
  let previousThreshold = alphaClassMask[maskIndex];
  let previousFractional = alphaClassMask[ALPHA_WORD_COUNT + maskIndex];
  let nextThreshold = (previousThreshold & ~writeMask) | (thresholdBits & writeMask);
  let nextFractional = (previousFractional & ~writeMask) | (fractionalBits & writeMask);
  if (
    nextThreshold != previousThreshold
    || nextFractional != previousFractional
    || (fractionalBits & writeMask) != 0u
  ) {
    atomicOr(&bevelGateState[0], 1u);
  }
  alphaClassMask[maskIndex] = nextThreshold;
  alphaClassMask[ALPHA_WORD_COUNT + maskIndex] = nextFractional;
}
`;
}

function indirectGateShader(): string {
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> gateState: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> indirectArguments: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (atomicLoad(&gateState[0]) != 0u) {
    return;
  }
  let word = globalId.x * ${INDIRECT_ARGUMENT_WORDS}u;
  if (word + 2u >= arrayLength(&indirectArguments)) {
    return;
  }
  indirectArguments[word] = 0u;
  indirectArguments[word + 1u] = 0u;
  indirectArguments[word + 2u] = 0u;
}
`;
}

async function assertShaderModules(
  modules: readonly { label: string; module: GPUShaderModule }[],
): Promise<void> {
  const failures: string[] = [];
  for (const entry of modules) {
    const info = await entry.module.getCompilationInfo();
    for (const message of info.messages) {
      if (message.type === "error") {
        failures.push(`${entry.label}:${message.lineNum}:${message.linePos} ${message.message}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`WGSL Smusso non valido:\n${failures.join("\n")}`);
  }
}

export class RasterBevelRenderer {
  static async create(options: RasterBevelRendererOptions): Promise<RasterBevelRenderer> {
    const renderer = new RasterBevelRenderer(options);
    try {
      await renderer.initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  readonly build = RASTER_BEVEL_RENDERER_BUILD;
  readonly heightView: GPUTextureView;
  readonly glossView: GPUTextureView;
  readonly heightMemoryBytes: number;
  readonly lutMemoryBytes = RASTER_BEVEL_PROFILE_SIZE * 4 * 2;
  readonly controlMemoryBytes: number;

  private readonly device: GPUDevice;
  private readonly scratchPool: EffectsScratchPool;
  private scratchPoolGeneration = -1;
  private scratchPoolLayoutVersion = -1;
  private readonly documentWidth: number;
  private readonly documentHeight: number;
  private layerView: GPUTextureView;
  private readonly lightGlazeUniformBuffer: GPUBuffer;
  private readonly thicknessTailUniformBuffer: GPUBuffer;
  private readonly heightTexture: GPUTexture;
  private readonly profileTexture: GPUTexture;
  private readonly profileView: GPUTextureView;
  private readonly glossTexture: GPUTexture;
  private readonly parameterBuffer: GPUBuffer;
  private readonly parameterUpload = new ArrayBuffer(PARAMETER_CAPACITY * PARAMETER_STRIDE);
  private readonly parameterUploadI32 = new Int32Array(this.parameterUpload);
  private readonly parameterUploadU32 = new Uint32Array(this.parameterUpload);
  private readonly parameterUploadF32 = new Float32Array(this.parameterUpload);
  private readonly alphaClassMaskBuffer: GPUBuffer;
  private readonly gateStateBuffer: GPUBuffer;
  private readonly indirectArgumentsBuffer: GPUBuffer;
  private readonly indirectTemplateUpload = new Uint32Array(PARAMETER_CAPACITY * INDIRECT_ARGUMENT_WORDS);
  private workspace: WorkspaceLayout | null = null;
  private bindGroupLayout!: GPUBindGroupLayout;
  private bindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private coveragePipeline!: GPUComputePipeline;
  private segmentPipeline!: GPUComputePipeline;
  private jfaPipeline!: GPUComputePipeline;
  private distancePipeline!: GPUComputePipeline;
  private gaussianPipeline!: GPUComputePipeline;
  private heightPipeline!: GPUComputePipeline;
  private resolveHeightPipeline!: GPUComputePipeline;
  private sourceViews: Record<SourceModeCode, GPUTextureView>;
  private indirectGateBindGroupLayout!: GPUBindGroupLayout;
  private lightGlazeView: GPUTextureView | null = null;
  private thicknessTailView: GPUTextureView | null = null;
  private indirectGateBindGroup!: GPUBindGroup;
  private profileKey = "";
  private glossKey = "";
  private destroyed = false;
  private _workspaceMemoryBytes = 0;
  private _workspaceExtent = 0;
  private alphaClassMaskPipeline!: GPUComputePipeline;
  private indirectGatePipeline!: GPUComputePipeline;
  private _totalBuilds = 0;
  private _totalJobs = 0;
  private _totalPasses = 0;
  private _lastEncode: RasterBevelEncodeResult | null = null;

  private constructor(options: RasterBevelRendererOptions) {
    this.device = options.device;
    this.scratchPool = options.scratchPool;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.layerView = options.layerView;
    this.lightGlazeUniformBuffer = options.lightGlazeUniformBuffer;
    this.thicknessTailUniformBuffer = options.thicknessTailUniformBuffer;
    this.heightMemoryBytes =
      (this.documentWidth + RASTER_BEVEL_NORMAL_APRON * 2)
      * (this.documentHeight + RASTER_BEVEL_NORMAL_APRON * 2) * 4;
    const alphaClassMaskBytes = Math.ceil(
      this.documentWidth / ALPHA_CLASS_WORD_BITS,
    ) * this.documentHeight * 2 * 4;
    const gateStateBytes = 4;
    const indirectArgumentsBytes = PARAMETER_CAPACITY * INDIRECT_ARGUMENT_BYTES;
    this.controlMemoryBytes = PARAMETER_CAPACITY * PARAMETER_STRIDE
      + alphaClassMaskBytes + gateStateBytes + indirectArgumentsBytes;
    this.heightTexture = this.device.createTexture({
      label: "Smusso Heightfield V2 persistent R32F",
      size: {
        width: this.documentWidth + RASTER_BEVEL_NORMAL_APRON * 2,
        height: this.documentHeight + RASTER_BEVEL_NORMAL_APRON * 2,
        depthOrArrayLayers: 1,
      },
      format: "r32float",
      usage:
        GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.heightView = this.heightTexture.createView({
      label: "Smusso Heightfield V2 sampling/storage view",
    });
    this.profileTexture = this.device.createTexture({
      label: "Smusso height contour LUT R32F",
      size: { width: RASTER_BEVEL_PROFILE_SIZE, height: 1, depthOrArrayLayers: 1 },
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.profileView = this.profileTexture.createView();
    this.glossTexture = this.device.createTexture({
      label: "Smusso light contour LUT R32F",
      size: { width: RASTER_BEVEL_PROFILE_SIZE, height: 1, depthOrArrayLayers: 1 },
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.glossView = this.glossTexture.createView({
      label: "Smusso light contour LUT view",
    });
    this.parameterBuffer = this.device.createBuffer({
      label: "Smusso dynamic dispatch parameters",
      size: PARAMETER_CAPACITY * PARAMETER_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.alphaClassMaskBuffer = this.device.createBuffer({
      label: "Smusso alpha threshold/fractional class mask",
      size: alphaClassMaskBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gateStateBuffer = this.device.createBuffer({
      label: "Smusso GPU rebuild gate state",
      size: gateStateBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.indirectArgumentsBuffer = this.device.createBuffer({
      label: "Smusso GPU indirect dispatch arguments",
      size: indirectArgumentsBytes,
      usage:
        GPUBufferUsage.STORAGE
        | GPUBufferUsage.INDIRECT
        | GPUBufferUsage.COPY_DST,
    });
    this.sourceViews = {
      0: this.layerView,
      1: this.layerView,
      2: this.layerView,
    };
  }

  get workspaceMemoryBytes(): number {
    return this._workspaceMemoryBytes;
  }

  get workspaceExtent(): number {
    return this._workspaceExtent;
  }

  get totalBuilds(): number {
    return this._totalBuilds;
  }

  get totalJobs(): number {
    return this._totalJobs;
  }

  get totalPasses(): number {
    return this._totalPasses;
  }

  get lastEncode(): RasterBevelEncodeResult | null {
    return this._lastEncode ? { ...this._lastEncode } : null;
  }

  setLightGlazeView(view: GPUTextureView | null): void {
    this.sourceViews[1] = view ?? this.layerView;
    this.lightGlazeView = view;
    this.rebuildBindGroups();
  }

  setThicknessTailView(view: GPUTextureView | null): void {
    this.sourceViews[2] = view ?? this.layerView;
    this.thicknessTailView = view;
    this.rebuildBindGroups();
  }

  retarget(layerView: GPUTextureView): void {
    if (this.destroyed) {
      throw new Error("Il renderer Smusso è già stato distrutto.");
    }
    this.layerView = layerView;
    this.sourceViews[0] = layerView;
    this.sourceViews[1] = this.lightGlazeView ?? layerView;
    this.sourceViews[2] = this.thicknessTailView ?? layerView;
    this.rebuildBindGroups();
  }

  updateStyleResources(source: unknown): void {
    const style = normalizeRasterBevelStyle(source);
    const profileKey = `${style.bevelContourEnabled ? 1 : 0}|${style.bevelContour}`;
    if (profileKey !== this.profileKey) {
      const values = makeRasterBevelSplineContourLut(
        style.bevelContour,
        RASTER_BEVEL_PROFILE_SIZE,
      );
      this.device.queue.writeTexture(
        { texture: this.profileTexture },
        values,
        { bytesPerRow: RASTER_BEVEL_PROFILE_SIZE * 4, rowsPerImage: 1 },
        { width: RASTER_BEVEL_PROFILE_SIZE, height: 1, depthOrArrayLayers: 1 },
      );
      this.profileKey = profileKey;
    }
    if (style.gloss !== this.glossKey) {
      const values = makeRasterBevelSplineContourLut(
        style.gloss,
        RASTER_BEVEL_PROFILE_SIZE,
      );
      this.device.queue.writeTexture(
        { texture: this.glossTexture },
        values,
        { bytesPerRow: RASTER_BEVEL_PROFILE_SIZE * 4, rowsPerImage: 1 },
        { width: RASTER_BEVEL_PROFILE_SIZE, height: 1, depthOrArrayLayers: 1 },
      );
      this.glossKey = style.gloss;
    }
  }

  private async initialize(): Promise<void> {
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: "Smusso Heightfield V2 universal compute layout",
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
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "r32float" },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.indirectGateBindGroupLayout = this.device.createBindGroupLayout({
      label: "Smusso indirect dispatch gate layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const modules = {
      coverage: this.device.createShaderModule({
        label: "Smusso coverage R8 packed WGSL",
        code: coverageShader(this.documentWidth, this.documentHeight),
      }),
      segment: this.device.createShaderModule({
        label: "Smusso marching squares segments WGSL",
        code: segmentShader(this.documentWidth, this.documentHeight),
      }),
      jfa: this.device.createShaderModule({
        label: "Smusso subpixel segment JFA WGSL",
        code: jfaShader(this.documentWidth, this.documentHeight),
      }),
      distance: this.device.createShaderModule({
        label: "Smusso signed R32F distance WGSL",
        code: distanceShader(this.documentWidth, this.documentHeight),
      }),
      gaussian: this.device.createShaderModule({
        label: "Smusso separable Gaussian WGSL",
        code: gaussianShader(this.documentWidth, this.documentHeight),
      }),
      height: this.device.createShaderModule({
        label: "Smusso Heightfield V2 profile WGSL",
        code: heightShader(this.documentWidth, this.documentHeight),
      }),
      resolve: this.device.createShaderModule({
        label: "Smusso final R32F height resolve WGSL",
        code: resolveHeightShader(this.documentWidth, this.documentHeight),
      }),
      alphaClass: this.device.createShaderModule({
        label: "Smusso alpha class change gate WGSL",
        code: alphaClassMaskShader(this.documentWidth, this.documentHeight),
      }),
      indirectGate: this.device.createShaderModule({
        label: "Smusso indirect dispatch gate WGSL",
        code: indirectGateShader(),
      }),
    };
    await assertShaderModules(Object.entries(modules).map(([label, module]) => ({
      label,
      module,
    })));
    const layout = this.device.createPipelineLayout({
      label: "Smusso Heightfield V2 compute pipeline layout",
      bindGroupLayouts: [this.bindGroupLayout],
    });
    this.device.pushErrorScope("validation");
    this.coveragePipeline = this.device.createComputePipeline({
      label: "Smusso alpha to packed R8",
      layout,
      compute: { module: modules.coverage, entryPoint: "main" },
    });
    this.segmentPipeline = this.device.createComputePipeline({
      label: "Smusso marching squares subpixel",
      layout,
      compute: { module: modules.segment, entryPoint: "main" },
    });
    this.jfaPipeline = this.device.createComputePipeline({
      label: "Smusso JFA on subpixel segments",
      layout,
      compute: { module: modules.jfa, entryPoint: "main" },
    });
    this.distancePipeline = this.device.createComputePipeline({
      label: "Smusso signed R32F distance",
      layout,
      compute: { module: modules.distance, entryPoint: "main" },
    });
    this.gaussianPipeline = this.device.createComputePipeline({
      label: "Smusso separable Gaussian",
      layout,
      compute: { module: modules.gaussian, entryPoint: "main" },
    });
    this.heightPipeline = this.device.createComputePipeline({
      label: "Smusso Heightfield V2 profile",
      layout,
      compute: { module: modules.height, entryPoint: "main" },
    });
    this.resolveHeightPipeline = this.device.createComputePipeline({
      label: "Smusso final R32F height resolve",
      layout,
      compute: { module: modules.resolve, entryPoint: "main" },
    });
    this.alphaClassMaskPipeline = this.device.createComputePipeline({
      label: "Smusso alpha threshold/fractional class gate",
      layout,
      compute: { module: modules.alphaClass, entryPoint: "main" },
    });
    this.indirectGatePipeline = this.device.createComputePipeline({
      label: "Smusso indirect dispatch gate",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.indirectGateBindGroupLayout],
      }),
      compute: { module: modules.indirectGate, entryPoint: "main" },
    });
    const validationError = await this.device.popErrorScope();
    if (validationError) {
      throw new Error(validationError.message);
    }
    this.indirectGateBindGroup = this.device.createBindGroup({
      label: "Smusso indirect dispatch gate bind group",
      layout: this.indirectGateBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.gateStateBuffer } },
        { binding: 1, resource: { buffer: this.indirectArgumentsBuffer } },
      ],
    });
    this.updateStyleResources({});
  }

  private requireWorkspaceLease(): EffectsScratchLease {
    const lease = this.scratchPool.lease("bevel");
    if (!lease) {
      throw new Error("Lease scratch Smusso non disponibile.");
    }
    return lease;
  }

  private workspaceBinding(
    lease: EffectsScratchLease,
    rangeId: "common" | "segments",
  ): GPUBufferBinding {
    const range = lease.ranges[rangeId];
    if (!range) {
      throw new Error(`Range scratch Smusso ${rangeId} non disponibile.`);
    }
    return { buffer: lease.buffer, offset: range.offset, size: range.size };
  }

  private rebuildBindGroups(): void {
    if (!this.workspace || !this.bindGroupLayout) {
      return;
    }
    const lease = this.requireWorkspaceLease();
    const commonBinding = this.workspaceBinding(lease, "common");
    const segmentBinding = this.workspaceBinding(lease, "segments");
    this.bindGroups.clear();
    for (const mode of [0, 1, 2] as const) {
      this.bindGroups.set(mode, this.device.createBindGroup({
        label: `Smusso Heightfield source mode ${mode}`,
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
          { binding: 3, resource: { buffer: this.lightGlazeUniformBuffer } },
          { binding: 4, resource: { buffer: this.thicknessTailUniformBuffer } },
          { binding: 5, resource: commonBinding },
          {
            binding: 8,
            resource: segmentBinding,
          },
          { binding: 6, resource: this.heightView },
          { binding: 7, resource: this.profileView },
          { binding: 9, resource: { buffer: this.alphaClassMaskBuffer } },
          { binding: 10, resource: { buffer: this.gateStateBuffer } },
        ],
      }));
    }
    this.scratchPoolGeneration = lease.generation;
    this.scratchPoolLayoutVersion = lease.layoutVersion;
  }

  private ensureWorkspace(requiredExtent: number, segments: boolean): WorkspaceLayout {
    const requestedExtent = Math.min(
      RASTER_BEVEL_MAX_WORK_SIDE,
      align(Math.max(WORKGROUP_SIZE, requiredExtent), WORKGROUP_SIZE),
    );
    const extent = Math.max(this.workspace?.extent ?? 0, requestedExtent);
    const needsSegments = Boolean(this.workspace?.segments || segments);
    if (
      this.workspace
      && this.workspace.extent === extent
      && this.workspace.segments === needsSegments
    ) {
      const lease = this.requireWorkspaceLease();
      if (
        lease.generation !== this.scratchPoolGeneration
        || lease.layoutVersion !== this.scratchPoolLayoutVersion
      ) {
        this.rebuildBindGroups();
      }
      return this.workspace;
    }
    const next = workspaceLayout(extent, needsSegments);
    this.scratchPool.declareEffect("bevel", [
      {
        id: "common",
        label: `Smusso arena comune ${extent}²`,
        size: next.commonBytes,
      },
      {
        id: "segments",
        label: `Smusso arena segmenti RGBA32F ${extent}²`,
        size: next.segmentBytes,
      },
    ]);
    this.workspace = next;
    this._workspaceMemoryBytes = next.totalBytes;
    this._workspaceExtent = extent;
    this.rebuildBindGroups();
    return next;
  }

  prewarmWorkspace(style: RasterBevelStyle): void {
    if (this.destroyed) {
      throw new Error("Renderer Smusso già distrutto.");
    }
    const normalized = normalizeRasterBevelStyle(style);
    if (!normalized.enabled) {
      return;
    }
    const derived = deriveRasterBevelHeightfield(normalized);
    this.ensureWorkspace(
      RASTER_BEVEL_TILE_SIZE + derived.apron * 2,
      normalized.technique !== "smooth",
    );
  }

  releaseIdleWorkspace(): boolean {
    if (this.destroyed || !this.workspace) {
      return false;
    }
    this.workspace = null;
    this._workspaceMemoryBytes = 0;
    this._workspaceExtent = 0;
    this.scratchPoolGeneration = -1;
    this.scratchPoolLayoutVersion = -1;
    this.bindGroups.clear();
    this.scratchPool.releaseRequirement("bevel");
    return true;
  }

  private buildJobs(rect: RasterBevelRect, apron: number): BuildJob[] {
    const firstTileX = Math.floor(rect.x / RASTER_BEVEL_TILE_SIZE);
    const firstTileY = Math.floor(rect.y / RASTER_BEVEL_TILE_SIZE);
    const lastTileX = Math.ceil((rect.x + rect.width) / RASTER_BEVEL_TILE_SIZE);
    const lastTileY = Math.ceil((rect.y + rect.height) / RASTER_BEVEL_TILE_SIZE);
    const jobs: BuildJob[] = [];
    for (let tileY = firstTileY; tileY < lastTileY; tileY += 1) {
      for (let tileX = firstTileX; tileX < lastTileX; tileX += 1) {
        const targetX = tileX * RASTER_BEVEL_TILE_SIZE;
        const targetY = tileY * RASTER_BEVEL_TILE_SIZE;
        const targetWidth = Math.min(
          RASTER_BEVEL_TILE_SIZE,
          this.documentWidth - targetX,
        );
        const targetHeight = Math.min(
          RASTER_BEVEL_TILE_SIZE,
          this.documentHeight - targetY,
        );
        if (targetWidth <= 0 || targetHeight <= 0) {
          continue;
        }
        const buildSide = Math.max(targetWidth, targetHeight) + apron * 2;
        if (buildSide > RASTER_BEVEL_MAX_WORK_SIDE) {
          throw new Error(
            `ROI Smusso ${buildSide} oltre il limite ${RASTER_BEVEL_MAX_WORK_SIDE}.`,
          );
        }
        jobs.push({
          buildOriginX: targetX - apron,
          buildOriginY: targetY - apron,
          buildSide,
          targetX,
          targetY,
          targetWidth,
          targetHeight,
          borderLeft: targetX === 0 ? RASTER_BEVEL_NORMAL_APRON : 0,
          borderTop: targetY === 0 ? RASTER_BEVEL_NORMAL_APRON : 0,
          borderRight: targetX + targetWidth === this.documentWidth ? RASTER_BEVEL_NORMAL_APRON : 0,
          borderBottom: targetY + targetHeight === this.documentHeight ? RASTER_BEVEL_NORMAL_APRON : 0,
          localTargetX: apron,
          localTargetY: apron,
        });
      }
    }
    return jobs;
  }

  private writeParameters(
    slot: number,
    job: BuildJob,
    style: RasterBevelStyle,
    mode: SourceModeCode,
    values: {
      step?: number;
      radius?: number;
      sigma?: number;
      inputOffsetWords?: number;
      outputOffsetWords?: number;
      directionX?: number;
      directionY?: number;
      sourceOffsetX?: number;
      targetWidth?: number;
      targetHeight?: number;
      destinationOffsetX?: number;
      destinationOffsetY?: number;
      sourceOffsetY?: number;
      inputKind?: number;
      targetFullBuild?: boolean;
    } = {},
  ): number {
    if (slot >= PARAMETER_CAPACITY) {
      throw new Error(`Troppi dispatch Smusso in un aggiornamento: ${slot + 1}.`);
    }
    const word = slot * (PARAMETER_STRIDE / 4);
    const modeCode = style.mode === "inner"
      ? 0
      : style.mode === "outer" ? 1 : style.mode === "emboss" ? 2 : 3;
    const techniqueCode = style.technique === "smooth"
      ? 0
      : style.technique === "chiselHard" ? 1 : 2;
    this.parameterUploadI32[word] = job.buildOriginX;
    this.parameterUploadI32[word + 1] = job.buildOriginY;
    this.parameterUploadU32[word + 2] = job.buildSide;
    this.parameterUploadU32[word + 3] = job.buildSide;
    this.parameterUploadU32[word + 4] = job.targetX;
    this.parameterUploadU32[word + 5] = job.targetY;
    this.parameterUploadU32[word + 6] = values.targetWidth
      ?? (values.targetFullBuild ? job.buildSide : job.targetWidth);
    this.parameterUploadU32[word + 7] = values.targetHeight
      ?? (values.targetFullBuild ? job.buildSide : job.targetHeight);
    this.parameterUploadU32[word + 8] = job.localTargetX;
    this.parameterUploadU32[word + 9] = job.localTargetY;
    this.parameterUploadU32[word + 10] = this.workspace!.extent;
    this.parameterUploadU32[word + 11] = values.step ?? 0;
    this.parameterUploadU32[word + 12] = mode;
    this.parameterUploadU32[word + 13] = modeCode;
    this.parameterUploadU32[word + 14] = techniqueCode;
    this.parameterUploadU32[word + 15] = values.radius ?? 0;
    this.parameterUploadF32[word + 16] = values.sigma ?? 0;
    this.parameterUploadF32[word + 17] = style.size;
    this.parameterUploadF32[word + 18] = style.bevelRange / 100;
    this.parameterUploadU32[word + 19] = style.bevelContourEnabled ? 1 : 0;
    this.parameterUploadU32[word + 20] = values.inputOffsetWords ?? 0;
    this.parameterUploadU32[word + 21] = values.outputOffsetWords ?? 0;
    this.parameterUploadI32[word + 22] = values.directionX ?? 0;
    this.parameterUploadI32[word + 23] = values.directionY ?? 0;
    this.parameterUploadI32[word + 24] = values.sourceOffsetX ?? 0;
    this.parameterUploadI32[word + 25] = values.sourceOffsetY ?? 0;
    this.parameterUploadF32[word + 26] = deriveRasterBevelHeightfield(style).apron + 2;
    this.parameterUploadU32[word + 27] = values.inputKind ?? 0;
    this.parameterUploadI32[word + 28] = values.destinationOffsetX ?? 0;
    this.parameterUploadI32[word + 29] = values.destinationOffsetY ?? 0;
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
        `Troppi argomenti indirect Smusso in un aggiornamento: ${argumentIndex + 1}.`,
      );
    }
    const word = argumentIndex * INDIRECT_ARGUMENT_WORDS;
    this.indirectTemplateUpload[word] = x;
    this.indirectTemplateUpload[word + 1] = y;
    this.indirectTemplateUpload[word + 2] = z;
    return argumentIndex + 1;
  }

  encode(options: RasterBevelEncodeOptions): RasterBevelEncodeResult {
    if (this.destroyed) {
      throw new Error("Renderer Smusso già distrutto.");
    }
    const style = normalizeRasterBevelStyle(options.style);
    this.updateStyleResources(style);
    const rect = normalizedRect(
      options.rebuildRect,
      this.documentWidth,
      this.documentHeight,
    );
    const changeDetectionRect = normalizedRect(
      options.changeDetectionRect,
      this.documentWidth,
      this.documentHeight,
    );
    const derived = deriveRasterBevelHeightfield(style);
    const jobs = rect ? this.buildJobs(rect, derived.apron) : [];
    const segments = style.technique !== "smooth";
    if (jobs.length > 0) {
      this.ensureWorkspace(
        Math.max(...jobs.map((job) => job.buildSide)),
        segments,
      );
    }
    const workspace = this.workspace;
    const mode = sourceModeCode(options.sourceMode);
    const useGate = Boolean(
      jobs.length > 0 && changeDetectionRect && !options.clearHeight,
    );
    const alphaClassRect = jobs.length > 0
      ? useGate ? changeDetectionRect : rect : null;
    const schedules = jobs.map((job) =>
      segments
        ? jfaScheduleForExtent(job.buildSide, { plusOne: true })
        : []);
    const slots: {
      coverage: number;
      firstGaussian?: number;
      secondGaussian?: number;
      segment?: number;
      jfa: number[];
      distance?: number;
      height: number;
      finalGaussianHorizontal: number;
      resolve: number;
    }[] = [];
    let indirectArgumentCount = 0;
    const jobIndirectArguments: {
      coverage: number;
      full: number;
      gaussian: number;
      resolve: number;
    }[] = [];
    if (useGate) {
      for (const job of jobs) {
        const fullX = Math.ceil(job.buildSide / WORKGROUP_SIZE);
        const fullY = Math.ceil(job.buildSide / WORKGROUP_SIZE);
        const coverage = indirectArgumentCount;
        indirectArgumentCount = this.writeIndirectArgument(
          indirectArgumentCount,
          Math.ceil(Math.ceil(job.buildSide / 4) / WORKGROUP_SIZE),
          fullY,
        );
        const full = indirectArgumentCount;
        indirectArgumentCount = this.writeIndirectArgument(
          indirectArgumentCount,
          fullX,
          fullY,
        );
        const gaussian = indirectArgumentCount;
        indirectArgumentCount = this.writeIndirectArgument(
          indirectArgumentCount,
          Math.ceil(job.buildSide / GAUSSIAN_WORKGROUP_SIZE),
          job.buildSide,
        );
        const resolve = indirectArgumentCount;
        indirectArgumentCount = this.writeIndirectArgument(
          indirectArgumentCount,
          Math.ceil(
            (job.targetHeight + job.borderTop + job.borderBottom)
            / GAUSSIAN_WORKGROUP_SIZE,
          ),
          job.targetWidth + job.borderLeft + job.borderRight,
        );
        jobIndirectArguments.push({ coverage, full, gaussian, resolve });
      }
    }
    let parameterSlot = 0;
    if (jobs.length > 0 && !workspace) {
      throw new Error("Arena Smusso non disponibile.");
    }
    let alphaClassSlot = -1;
    if (alphaClassRect) {
      alphaClassSlot = parameterSlot;
      const alphaClassJob: BuildJob = {
        buildOriginX: alphaClassRect.x,
        buildOriginY: alphaClassRect.y,
        buildSide: Math.max(alphaClassRect.width, alphaClassRect.height),
        targetX: alphaClassRect.x,
        targetY: alphaClassRect.y,
        targetWidth: alphaClassRect.width,
        targetHeight: alphaClassRect.height,
        localTargetX: 0,
        localTargetY: 0,
        borderLeft: 0,
        borderTop: 0,
        borderRight: 0,
        borderBottom: 0,
      };
      parameterSlot = this.writeParameters(
        parameterSlot,
        alphaClassJob,
        style,
        mode,
      );
    }
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const coverage = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
        outputOffsetWords: workspace!.coverageOffsetWords,
        targetFullBuild: true,
      });
      if (!segments) {
        const sigma1Radius = Math.min(
          MAX_GAUSSIAN_RADIUS,
          Math.ceil(3 * derived.sigma1),
        );
        const firstGaussian = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          radius: sigma1Radius,
          sigma: derived.sigma1,
          inputOffsetWords: workspace!.coverageOffsetWords,
          outputOffsetWords: workspace!.scalarAOffsetWords,
          directionX: 1,
          directionY: 0,
          inputKind: 1,
          targetFullBuild: true,
        });
        const secondGaussian = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          radius: sigma1Radius,
          sigma: derived.sigma1,
          inputOffsetWords: workspace!.scalarAOffsetWords,
          outputOffsetWords: workspace!.scalarBOffsetWords,
          directionX: 0,
          directionY: 1,
          targetFullBuild: true,
        });
        const height = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          inputOffsetWords: workspace!.scalarBOffsetWords,
          outputOffsetWords: workspace!.scalarAOffsetWords,
          targetFullBuild: true,
        });
        const sigmaBRadius = Math.min(
          MAX_GAUSSIAN_RADIUS,
          Math.ceil(3 * derived.sigmaB),
        );
        const finalGaussianHorizontal = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          radius: sigmaBRadius,
          sigma: derived.sigmaB,
          inputOffsetWords: workspace!.scalarAOffsetWords,
          outputOffsetWords: workspace!.scalarBOffsetWords,
          directionX: 1,
          directionY: 0,
          targetFullBuild: true,
        });
        const resolve = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          radius: sigmaBRadius,
          sigma: derived.sigmaB,
          inputOffsetWords: workspace!.scalarBOffsetWords,
          directionX: 0,
          directionY: 1,
          sourceOffsetX: job.localTargetX - job.borderLeft,
          sourceOffsetY: job.localTargetY - job.borderTop,
          targetWidth: job.targetWidth + job.borderLeft + job.borderRight,
          targetHeight: job.targetHeight + job.borderTop + job.borderBottom,
          destinationOffsetX: -job.borderLeft,
          destinationOffsetY: -job.borderTop,
        });
        slots.push({
          coverage,
          firstGaussian,
          secondGaussian,
          jfa: [],
          height,
          finalGaussianHorizontal,
          resolve,
        });
      } else {
        const segment = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          inputOffsetWords: workspace!.coverageOffsetWords,
          outputOffsetWords: workspace!.segmentAOffsetWords,
          targetFullBuild: true,
        });
        const jfa: number[] = [];
        let sourceOffset = workspace!.segmentAOffsetWords;
        let targetOffset = workspace!.segmentBOffsetWords;
        for (const step of schedules[index]) {
          jfa.push(parameterSlot);
          parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
            step,
            inputOffsetWords: sourceOffset,
            outputOffsetWords: targetOffset,
            targetFullBuild: true,
          });
          [sourceOffset, targetOffset] = [targetOffset, sourceOffset];
        }
        const distance = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          inputOffsetWords: sourceOffset,
          outputOffsetWords: workspace!.scalarAOffsetWords,
          targetFullBuild: true,
        });
        const height = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          inputOffsetWords: workspace!.scalarAOffsetWords,
          outputOffsetWords: workspace!.scalarBOffsetWords,
          targetFullBuild: true,
        });
        const sigmaBRadius = Math.min(
          MAX_GAUSSIAN_RADIUS,
          Math.ceil(3 * derived.sigmaB),
        );
        const finalGaussianHorizontal = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          radius: sigmaBRadius,
          sigma: derived.sigmaB,
          inputOffsetWords: workspace!.scalarBOffsetWords,
          outputOffsetWords: workspace!.scalarAOffsetWords,
          directionX: 1,
          directionY: 0,
          targetFullBuild: true,
        });
        const resolve = parameterSlot;
        parameterSlot = this.writeParameters(parameterSlot, job, style, mode, {
          radius: sigmaBRadius,
          sigma: derived.sigmaB,
          inputOffsetWords: workspace!.scalarAOffsetWords,
          directionX: 0,
          directionY: 1,
          sourceOffsetX: job.localTargetX - job.borderLeft,
          sourceOffsetY: job.localTargetY - job.borderTop,
          targetWidth: job.targetWidth + job.borderLeft + job.borderRight,
          targetHeight: job.targetHeight + job.borderTop + job.borderBottom,
          destinationOffsetX: -job.borderLeft,
          destinationOffsetY: -job.borderTop,
        });
        slots.push({
          coverage,
          segment,
          jfa,
          distance,
          height,
          finalGaussianHorizontal,
          resolve,
        });
      }
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
    const resetAlphaClassMask = Boolean(
      options.clearHeight || (jobs.length > 0 && !useGate),
    );
    if (resetAlphaClassMask) {
      options.encoder.clearBuffer(this.alphaClassMaskBuffer);
    }
    let gateScans = 0;
    if (alphaClassRect) {
      const bindGroup = this.bindGroups.get(mode);
      if (!bindGroup) {
        throw new Error("Bind group gate alpha Smusso non disponibile.");
      }
      options.encoder.clearBuffer(this.gateStateBuffer);
      const firstBit = alphaClassRect.x % ALPHA_CLASS_WORD_BITS;
      const wordCount = Math.ceil(
        (firstBit + alphaClassRect.width) / ALPHA_CLASS_WORD_BITS,
      );
      const alphaClassPass = options.encoder.beginComputePass({
        label: useGate
          ? "Detect Smusso alpha geometry changes"
          : "Synchronize Smusso alpha geometry classes",
      });
      alphaClassPass.setPipeline(this.alphaClassMaskPipeline);
      alphaClassPass.setBindGroup(
        0,
        bindGroup,
        this.dynamicOffset(alphaClassSlot),
      );
      alphaClassPass.dispatchWorkgroups(
        Math.ceil(wordCount / WORKGROUP_SIZE),
        Math.ceil(alphaClassRect.height / WORKGROUP_SIZE),
      );
      alphaClassPass.end();
      gateScans = 1;
    }
    if (useGate) {
      const gatePass = options.encoder.beginComputePass({
        label: "Gate Smusso Heightfield dispatches on GPU",
      });
      gatePass.setPipeline(this.indirectGatePipeline);
      gatePass.setBindGroup(0, this.indirectGateBindGroup);
      gatePass.dispatchWorkgroups(Math.ceil(indirectArgumentCount / 64));
      gatePass.end();
    }
    if (options.clearHeight) {
      const clearPass = options.encoder.beginRenderPass({
        label: "Clear Smusso persistent R32F heightfield",
        colorAttachments: [{
          view: this.heightView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      clearPass.end();
    }
    let passes = 0;
    let jfaDispatches = 0;
    if (jobs.length > 0) {
      const bindGroup = this.bindGroups.get(mode);
      if (!bindGroup) {
        throw new Error("Bind group sorgente Smusso non disponibile.");
      }
      const pass = options.encoder.beginComputePass({
        label: segments
          ? "Smusso Scalpello Heightfield V2 update"
          : "Smusso Morbida Heightfield V2 update",
      });
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const jobSlots = slots[index];
        const indirect = jobIndirectArguments[index];
        const dispatch = (
          argumentIndex: number | undefined,
          x: number,
          y: number,
        ): void => {
          if (useGate) {
            if (argumentIndex === undefined) {
              throw new Error("Argomento indirect Smusso mancante.");
            }
            pass.dispatchWorkgroupsIndirect(
              this.indirectArgumentsBuffer,
              argumentIndex * INDIRECT_ARGUMENT_BYTES,
            );
          } else {
            pass.dispatchWorkgroups(x, y);
          }
        };
        const fullX = Math.ceil(job.buildSide / WORKGROUP_SIZE);
        const fullY = Math.ceil(job.buildSide / WORKGROUP_SIZE);
        const gaussianGroups = Math.ceil(job.buildSide / GAUSSIAN_WORKGROUP_SIZE);
        const resolveWidth = job.targetWidth + job.borderLeft + job.borderRight;
        const resolveHeight = job.targetHeight + job.borderTop + job.borderBottom;
        const resolveGroups = Math.ceil(resolveHeight / GAUSSIAN_WORKGROUP_SIZE);
        const resolveRows = resolveWidth;
        pass.setPipeline(this.coveragePipeline);
        pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.coverage));
        dispatch(
          indirect?.coverage,
          Math.ceil(Math.ceil(job.buildSide / 4) / WORKGROUP_SIZE),
          fullY,
        );
        passes += 1;
        if (!segments) {
          pass.setPipeline(this.gaussianPipeline);
          pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.firstGaussian!));
          dispatch(indirect?.gaussian, gaussianGroups, job.buildSide);
          pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.secondGaussian!));
          dispatch(indirect?.gaussian, gaussianGroups, job.buildSide);
          passes += 2;
        } else {
          pass.setPipeline(this.segmentPipeline);
          pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.segment!));
          dispatch(indirect?.full, fullX, fullY);
          passes += 1;
          pass.setPipeline(this.jfaPipeline);
          for (const slot of jobSlots.jfa) {
            pass.setBindGroup(0, bindGroup, this.dynamicOffset(slot));
            dispatch(indirect?.full, fullX, fullY);
            passes += 1;
            jfaDispatches += 1;
          }
          pass.setPipeline(this.distancePipeline);
          pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.distance!));
          dispatch(indirect?.full, fullX, fullY);
          passes += 1;
        }
        pass.setPipeline(this.heightPipeline);
        pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.height));
        dispatch(indirect?.full, fullX, fullY);
        pass.setPipeline(this.gaussianPipeline);
        pass.setBindGroup(
          0,
          bindGroup,
          this.dynamicOffset(jobSlots.finalGaussianHorizontal),
        );
        dispatch(indirect?.gaussian, gaussianGroups, job.buildSide);
        pass.setPipeline(this.resolveHeightPipeline);
        pass.setBindGroup(0, bindGroup, this.dynamicOffset(jobSlots.resolve));
        dispatch(indirect?.resolve, resolveGroups, resolveRows);
        passes += 3;
      }
      pass.end();
    }
    const result: RasterBevelEncodeResult = {
      cleared: Boolean(options.clearHeight),
      jobs: jobs.length,
      passes,
      jfaDispatches,
      workPixels: jobs.reduce(
        (total, job) => total + job.buildSide * job.buildSide,
        0,
      ),
      resolvedPixels: jobs.reduce(
        (total, job) => total + job.targetWidth * job.targetHeight,
        0,
      ),
      workSide: workspace?.extent ?? 0,
      apron: derived.apron,
      technique: style.technique,
      gateScans,
      indirectDispatches: useGate ? passes : 0,
    };
    if (jobs.length > 0 || options.clearHeight) {
      this._totalBuilds += 1;
      this._totalJobs += jobs.length;
      this._totalPasses += passes;
    }
    this._lastEncode = result;
    return result;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.scratchPool.releaseRequirement("bevel");
    this.workspace = null;
    this.heightTexture.destroy();
    this.profileTexture.destroy();
    this.glossTexture.destroy();
    this.parameterBuffer.destroy();
    this.alphaClassMaskBuffer.destroy();
    this.gateStateBuffer.destroy();
    this.indirectArgumentsBuffer.destroy();
    this.bindGroups.clear();
  }
}

