import {
  jfaScheduleForExtent,
  type RasterStrokeRect,
  type RasterStrokeStyle,
} from "./stroke-core";
import {
  DEFAULT_RASTER_BEVEL_STYLE,
  RASTER_BEVEL_NORMAL_APRON,
  deriveRasterBevelHeightfield,
  normalizeRasterBevelStyle,
  rasterBevelLightVector,
  type RasterBevelStyle,
} from "./bevel-core";
import type { EffectsScratchLease, EffectsScratchPool } from "./effects-scratch-pool";

export const RASTER_STROKE_RENDERER_BUILD =
  "style-stack-webgpu-v9-shared-effects-scratch-retargetable-layer-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-native-unorm-round-even";
export const RASTER_STROKE_COVERAGE_STRATEGY =
  "persistent-packed-r8-style-coverage" as const;
export const RASTER_STROKE_DISTANCE_STORAGE_STRATEGY =
  "register-only-during-coverage-resolve" as const;
export const RASTER_STROKE_MUTATION_GATE_STRATEGY =
  "threshold-change-or-existing-coverage-one-pixel-halo" as const;
export const RASTER_STROKE_STYLED_STORAGE_STRATEGY =
  "direct-lod0-plus-derived-mips-1-through-12" as const;

export type RasterStrokeSourceMode = "permanent" | "light-glaze" | "thickness-tail";

export interface RasterStrokeRendererOptions {
  device: GPUDevice;
  scratchPool: EffectsScratchPool;
  documentWidth: number;
  documentHeight: number;
  layerFormat: "rgba8unorm" | "rgba16float";
  layerView: GPUTextureView;
  lightGlazeUniformBuffer: GPUBuffer;
  thicknessTailUniformBuffer: GPUBuffer;
  scratchExtent?: number;
  readbackEnabled?: boolean;
}

export interface RasterStrokeEncodeOptions {
  encoder: GPUCommandEncoder;
  style: RasterStrokeStyle;
  bevelStyle?: RasterBevelStyle;
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
const DISPLAY_PARAMETER_BYTES = PARAMETER_BYTES;
const BEVEL_UNIFORM_BYTES = 80;
const PARAMETER_STRIDE = 256;
const PARAMETER_CAPACITY = 2048;
const INVALID_PACKED_SEED = 0xffff_ffff;
const THRESHOLD_MASK_WORD_BITS = 32;
const COVERAGE_WORD_PIXELS = 4;
const COVERAGE_DETECTION_HALO = 1;
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

function wordAlignedCoverageRect(
  rect: RasterStrokeRect | null | undefined,
  width: number,
  height: number,
): RasterStrokeRect | null {
  const normalized = normalizedRect(rect, width, height);
  if (!normalized) {
    return null;
  }
  const x = Math.floor(normalized.x / COVERAGE_WORD_PIXELS) * COVERAGE_WORD_PIXELS;
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

function expandedCoverageDetectionRect(
  rect: RasterStrokeRect | null | undefined,
  width: number,
  height: number,
): RasterStrokeRect | null {
  const normalized = normalizedRect(rect, width, height);
  return normalized
    ? normalizedRect({
      x: normalized.x - COVERAGE_DETECTION_HALO,
      y: normalized.y - COVERAGE_DETECTION_HALO,
      width: normalized.width + COVERAGE_DETECTION_HALO * 2,
      height: normalized.height + COVERAGE_DETECTION_HALO * 2,
    }, width, height)
    : null;
}

function halfResolutionRect(
  rect: RasterStrokeRect | null | undefined,
  width: number,
  height: number,
): RasterStrokeRect | null {
  const normalized = normalizedRect(rect, width * 2, height * 2);
  if (!normalized) {
    return null;
  }
  const x = Math.floor(normalized.x / 2);
  const y = Math.floor(normalized.y / 2);
  const right = Math.min(width, Math.ceil((normalized.x + normalized.width) / 2));
  const bottom = Math.min(height, Math.ceil((normalized.y + normalized.height) / 2));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function shaderSourceCommon(
  documentWidth: number,
  documentHeight: number,
  bindGroup = 0,
): string {
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
  scratchExtent: u32,
  strokeEnabled: u32,
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

@group(${bindGroup}) @binding(0) var<uniform> parameters: StrokeParameters;
@group(${bindGroup}) @binding(1) var permanentTexture: texture_2d<f32>;
@group(${bindGroup}) @binding(2) var transientTexture: texture_2d<f32>;
@group(${bindGroup}) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(${bindGroup}) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;

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
  outputSeeds[localPosition.y * parameters.scratchExtent + localPosition.x] = value;
}
`;
}

function jfaShader(): string {
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
  scratchExtent: u32,
  strokeEnabled: u32,
  styleColor: vec4<f32>,
};

const INVALID_SEED: u32 = ${INVALID_PACKED_SEED}u;

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
// Both disjoint subranges use one physical buffer. WebGPU validates usage per buffer
// within this compute pass, so both bindings are storage; this shader never writes inputSeeds.
@group(0) @binding(1) var<storage, read_write> inputSeeds: array<vec2<u32>>;
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
        u32(samplePosition.y) * parameters.scratchExtent + u32(samplePosition.x)
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
  outputSeeds[position.y * parameters.scratchExtent + position.x] = vec2<u32>(
    bestCandidate(position, 0u),
    bestCandidate(position, 1u)
  );
}
`;
}

function resolveShader(
  documentWidth: number,
  documentHeight: number,
): string {
  return `${shaderSourceCommon(documentWidth, documentHeight)}
@group(0) @binding(5) var<storage, read> propagatedSeeds: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read_write> coverageField: array<u32>;

fn rampAt(offset: f32, signedDistance: f32) -> f32 {
  return clamp(offset + 0.5 - signedDistance, 0.0, 1.0);
}

fn resolveCoverageByte(
  documentPosition: vec2<u32>,
  localPosition: vec2<u32>
) -> u32 {
  let pair = propagatedSeeds[
    localPosition.y * parameters.scratchExtent + localPosition.x
  ];
  let alpha = sourceTexel(vec2<i32>(documentPosition)).a;
  let inside = alpha >= 0.5;
  let candidate = select(pair.x, pair.y, inside);
  if (candidate == INVALID_SEED) {
    return 0u;
  }
  let seedPosition = unpackSeed(candidate);
  let delta = vec2<f32>(seedPosition) - vec2<f32>(localPosition);
  let distance = sqrt(dot(delta, delta));
  let fixedDistance = u32(floor(min(distance, 1023.0) * 64.0 + 0.5));
  if (fixedDistance < 1u) {
    return 0u;
  }
  let quantizedDistance = f32(fixedDistance) / 64.0;
  let signedDistance = select(
    quantizedDistance - 0.5 - alpha,
    1.5 - alpha - quantizedDistance,
    inside
  );
  let f0 = rampAt(0.0, signedDistance);
  var coverage = 0.0;
  if (parameters.stylePosition == 2u) {
    coverage = rampAt(parameters.styleWidth, signedDistance) - f0;
  } else if (parameters.stylePosition == 0u) {
    coverage = f0 - rampAt(-parameters.styleWidth, signedDistance);
  } else {
    let radius = parameters.styleWidth * 0.5;
    coverage = rampAt(radius, signedDistance) - rampAt(-radius, signedDistance);
  }
  return u32(floor(clamp(coverage, 0.0, 1.0) * 255.0 + 0.5));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (globalId.y >= parameters.targetSize.y) {
    return;
  }
  let firstX = globalId.x * 4u;
  if (firstX >= parameters.targetSize.x) {
    return;
  }
  let firstOffset = vec2<u32>(firstX, globalId.y);
  let firstDocumentPosition = parameters.targetOrigin + firstOffset;
  var packedCoverage = 0u;
  for (var lane = 0u; lane < 4u; lane += 1u) {
    if (firstX + lane >= parameters.targetSize.x) {
      continue;
    }
    let offset = firstOffset + vec2<u32>(lane, 0u);
    let coverage = resolveCoverageByte(
      parameters.targetOrigin + offset,
      parameters.localTargetOrigin + offset
    );
    packedCoverage |= coverage << (lane * 8u);
  }
  let linearIndex = firstDocumentPosition.y * ${documentWidth}u
    + firstDocumentPosition.x;
  coverageField[linearIndex >> 2u] = packedCoverage;
}
`;
}


function strokeCompositionShaderSource(
  documentWidth: number,
  bindGroup = 0,
  coverageBinding = 5,
  heightBinding = 7,
  glossBinding = 8,
  bevelUniformBinding = 9,
  derivativeMode: "analytic" | "fragment" = "analytic",
): string {
  const contourAA = derivativeMode === "fragment"
    ? /* wgsl */ `
    if (bevel.flags.z == 1u) {
      let dt = 0.5 * fwidth(t);
      contour = (
        lightContour(t - dt) + lightContour(t) + lightContour(t + dt)
      ) / 3.0;
    }`
    : /* wgsl */ `
    if (bevel.flags.z == 1u) {
      let quadOrigin = position - (position & vec2<i32>(1));
      let leftT = bevelResponseAt(vec2<i32>(quadOrigin.x, position.y)).x;
      let rightT = bevelResponseAt(vec2<i32>(quadOrigin.x + 1, position.y)).x;
      let topT = bevelResponseAt(vec2<i32>(position.x, quadOrigin.y)).x;
      let bottomT = bevelResponseAt(vec2<i32>(position.x, quadOrigin.y + 1)).x;
      let dt = 0.5 * (abs(rightT - leftT) + abs(bottomT - topT));
      contour = (
        lightContour(t - dt) + lightContour(t) + lightContour(t + dt)
      ) / 3.0;
    }`;
  return /* wgsl */ `
struct BevelUniforms {
  flags: vec4<u32>,
  scalars: vec4<f32>,
  light: vec4<f32>,
  highlight: vec4<f32>,
  shadow: vec4<f32>,
};

@group(${bindGroup}) @binding(${coverageBinding})
var<storage, read> coverageField: array<u32>;
@group(${bindGroup}) @binding(${heightBinding}) var bevelHeight: texture_2d<f32>;
@group(${bindGroup}) @binding(${glossBinding}) var bevelGloss: texture_2d<f32>;
@group(${bindGroup}) @binding(${bevelUniformBinding}) var<uniform> bevel: BevelUniforms;

fn loadCoverageByte(position: vec2<i32>) -> u32 {
  let linearIndex = u32(position.y) * ${documentWidth}u + u32(position.x);
  let packed = coverageField[linearIndex >> 2u];
  let shift = (linearIndex & 3u) * 8u;
  return (packed >> shift) & 255u;
}

fn bevelHeightAt(position: vec2<i32>) -> f32 {
  let apron = vec2<i32>(${RASTER_BEVEL_NORMAL_APRON});
  if (
    any(position < -apron)
    || any(position >= DOCUMENT_SIZE + apron)
  ) {
    return 0.0;
  }
  return textureLoad(bevelHeight, position + apron, 0).r;
}

fn reliefResponse(normal: vec3<f32>, light: vec3<f32>) -> f32 {
  let value = clamp(dot(normal, light), -1.0, 1.0);
  let baseline = light.z;
  if (value >= baseline) {
    return clamp((value - baseline) / max(1e-5, 1.0 - baseline), -1.0, 1.0);
  }
  return clamp((value - baseline) / max(1e-5, 1.0 + baseline), -1.0, 1.0);
}

fn lightContour(value: f32) -> f32 {
  let size = textureDimensions(bevelGloss).x;
  let q = clamp(value, 0.0, 1.0) * f32(size - 1u);
  let first = u32(floor(q));
  let second = min(size - 1u, first + 1u);
  return mix(
    textureLoad(bevelGloss, vec2<i32>(i32(first), 0), 0).r,
    textureLoad(bevelGloss, vec2<i32>(i32(second), 0), 0).r,
    fract(q)
  );
}

fn bevelResponseAt(position: vec2<i32>) -> vec2<f32> {
  let nw = bevelHeightAt(position + vec2<i32>(-1, 1));
  let n = bevelHeightAt(position + vec2<i32>(0, 1));
  let ne = bevelHeightAt(position + vec2<i32>(1, 1));
  let w = bevelHeightAt(position + vec2<i32>(-1, 0));
  let e = bevelHeightAt(position + vec2<i32>(1, 0));
  let sw = bevelHeightAt(position + vec2<i32>(-1, -1));
  let s = bevelHeightAt(position + vec2<i32>(0, -1));
  let se = bevelHeightAt(position + vec2<i32>(1, -1));
  let gradient = vec2<f32>(
    (3.0 * (ne - nw) + 10.0 * (e - w) + 3.0 * (se - sw)) / 32.0,
    (3.0 * (nw - sw) + 10.0 * (n - s) + 3.0 * (ne - se)) / 32.0
  );
  let effectMask = smoothstep(1e-6, 2e-4, length(gradient));
  let normal = normalize(vec3<f32>(-bevel.scalars.x * gradient, 1.0));
  let response = reliefResponse(normal, normalize(bevel.light.xyz));
  return vec2<f32>(response * 0.5 + 0.5, effectMask);
}

fn overPlane(dst: vec4<f32>, color: vec3<f32>, sourceAlpha: f32) -> vec4<f32> {
  let alpha = clamp(sourceAlpha, 0.0, 1.0);
  return vec4<f32>(
    color * alpha + dst.rgb * (1.0 - alpha),
    alpha + dst.a * (1.0 - alpha)
  );
}

fn blendEffect(
  dst: vec4<f32>,
  color: vec3<f32>,
  sourceAlpha: f32,
  screenMode: bool,
) -> vec4<f32> {
  let alpha = clamp(sourceAlpha, 0.0, 1.0);
  if (alpha <= 0.0) {
    return dst;
  }
  if (dst.a <= 1e-6) {
    return overPlane(dst, color, alpha);
  }
  let base = dst.rgb / dst.a;
  let blended = select(base * color, base + color - base * color, screenMode);
  let outputAlpha = max(dst.a, alpha);
  return vec4<f32>(mix(base, blended, alpha) * outputAlpha, outputAlpha);
}

fn bevelNode(base: vec4<f32>, position: vec2<i32>) -> vec4<f32> {
  var node = vec4<f32>(base.rgb * bevel.scalars.y, base.a * bevel.scalars.y);
  let response = bevelResponseAt(position);
  let t = response.x;
  var contour = lightContour(t);
${contourAA}
  let signedLight = 2.0 * contour - 1.0;
  let highlightWeight = max(signedLight, 0.0) * bevel.highlight.a * response.y;
  let shadowWeight = max(-signedLight, 0.0) * bevel.shadow.a * response.y;
  let insideWeight = select(base.a, 0.0, bevel.flags.y == 1u);
  let outsideWeight = select(1.0 - base.a, 0.0, bevel.flags.y == 0u);
  let innerHighlight = highlightWeight * insideWeight;
  let innerShadow = shadowWeight * insideWeight;
  let outerHighlight = highlightWeight * outsideWeight;
  let outerShadow = shadowWeight * outsideWeight;
  var straight = vec3<f32>(0.0);
  if (base.a > 1e-6) {
    straight = base.rgb / base.a;
  }
  var group = vec4<f32>(0.0);
  group = overPlane(group, bevel.shadow.rgb, outerShadow);
  group = overPlane(group, bevel.highlight.rgb, outerHighlight);
  group = overPlane(group, straight, base.a * bevel.scalars.y);
  group = blendEffect(group, bevel.shadow.rgb, innerShadow, false);
  group = blendEffect(group, bevel.highlight.rgb, innerHighlight, true);
  node = group;
  return node;
}

fn traceOnlyNode(base: vec4<f32>, coverage: f32) -> vec4<f32> {
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
  let result = vec4<f32>(
    parameters.styleColor.rgb * strokeWeight + baseStraight * baseWeight,
    clamp(finalAlpha, 0.0, 1.0)
  );
  return vec4<f32>(
    clamp(result.rgb, vec3<f32>(0.0), vec3<f32>(result.a)),
    result.a
  );
}

fn combinedStrokeNode(sourceAlpha: f32, inputNode: vec4<f32>, coverage: f32) -> vec4<f32> {
  var node = inputNode;
  var strokeWeight = coverage * parameters.styleColor.a;
  if (parameters.stylePosition == 2u) {
    strokeWeight = min(strokeWeight, 1.0 - node.a);
  }
  if (strokeWeight > 0.0) {
    if (parameters.stylePosition == 2u) {
      let remainingAlpha = 1.0 - node.a;
      node = vec4<f32>(
        node.rgb + parameters.styleColor.rgb * strokeWeight * remainingAlpha,
        node.a + strokeWeight * remainingAlpha
      );
    } else {
      let alpha = node.a;
      let baseWeight = max(0.0, alpha - strokeWeight);
      var straight = vec3<f32>(0.0);
      if (alpha > 1e-6) {
        straight = node.rgb / alpha;
      }
      node = vec4<f32>(
        parameters.styleColor.rgb * strokeWeight + straight * baseWeight,
        max(alpha, strokeWeight)
      );
    }
  }
  return node;
}

fn hash32(input: u32) -> u32 {
  var value = input;
  value ^= value >> 16u;
  value *= 2146121005u;
  value ^= value >> 15u;
  value *= 2221713035u;
  value ^= value >> 16u;
  return value;
}

fn random24(position: vec2<u32>, seed: u32) -> f32 {
  let value = hash32(
    (position.x * 2654435769u) ^ (position.y * 2246822507u) ^ seed
  );
  return f32(value & 16777215u) / 16777215.0;
}

fn styledTexel(position: vec2<i32>) -> vec4<f32> {
  let base = sourceTexel(position);
  var coverage = 0.0;
  if (parameters.strokeEnabled == 1u) {
    coverage = f32(loadCoverageByte(position)) / 255.0;
  }
  if (bevel.flags.x == 0u) {
    if (parameters.strokeEnabled == 0u) {
      return base;
    }
    return traceOnlyNode(base, coverage);
  }
  var node = bevelNode(base, position);
  if (parameters.strokeEnabled == 1u) {
    node = combinedStrokeNode(base.a, node, coverage);
  }
  let clampedAlpha = clamp(node.a, 0.0, 1.0);
  node = vec4<f32>(
    clamp(node.rgb, vec3<f32>(0.0), vec3<f32>(clampedAlpha)),
    clampedAlpha
  );
  if (node.a > 1e-6) {
    var straight = node.rgb / node.a;
    let documentPosition = vec2<u32>(position);
    let noise = random24(documentPosition, 4660u)
      + random24(documentPosition, 40503u) - 1.0;
    straight = clamp(straight + noise * (0.75 / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));
    node = vec4<f32>(straight * node.a, node.a);
  }
  return node * bevel.scalars.z;
}
`;
}

function readbackComposeShader(
  documentWidth: number,
  documentHeight: number,
  layerFormat: "rgba8unorm" | "rgba16float",
): string {
  return `${shaderSourceCommon(documentWidth, documentHeight)}
${strokeCompositionShaderSource(documentWidth)}
@group(0) @binding(6) var styledTexture: texture_storage_2d<${layerFormat}, write>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let position = vec2<i32>(parameters.targetOrigin + globalId.xy);
  textureStore(styledTexture, position, styledTexel(position));
}
`;
}

function coarseComposeShader(
  documentWidth: number,
  documentHeight: number,
  layerFormat: "rgba8unorm" | "rgba16float",
): string {
  return `${shaderSourceCommon(documentWidth, documentHeight)}
${strokeCompositionShaderSource(documentWidth)}
@group(0) @binding(6) var coarseStyledTexture: texture_storage_2d<${layerFormat}, write>;

fn quantizedStyledTexel(position: vec2<i32>) -> vec4<f32> {
  return quantizeLayer(styledTexel(clamp(position, vec2<i32>(0), DOCUMENT_SIZE - 1)));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let coarsePosition = vec2<i32>(parameters.targetOrigin + globalId.xy);
  let sourceOrigin = coarsePosition * 2;
  let p00 = quantizedStyledTexel(sourceOrigin);
  let p10 = quantizedStyledTexel(sourceOrigin + vec2<i32>(1, 0));
  let p01 = quantizedStyledTexel(sourceOrigin + vec2<i32>(0, 1));
  let p11 = quantizedStyledTexel(sourceOrigin + vec2<i32>(1, 1));
  textureStore(coarseStyledTexture, coarsePosition, (p00 + p10 + p01 + p11) * 0.25);
}
`;
}

export function rasterStrokeDisplayShader(
  documentWidth: number,
  documentHeight: number,
): string {
  return /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  layerSize: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
${shaderSourceCommon(documentWidth, documentHeight, 1)}
${strokeCompositionShaderSource(documentWidth, 1, 5, 8, 9, 10, "fragment")}
@group(1) @binding(6) var coarseStyledTexture: texture_2d<f32>;
@group(1) @binding(7) var layerSampler: sampler;

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

fn directStyledSample(layerPosition: vec2<f32>) -> vec4<f32> {
  let origin = vec2<i32>(floor(layerPosition));
  let fraction = fract(layerPosition);
  let maximumCoordinate = DOCUMENT_SIZE - vec2<i32>(1);
  let p00 = quantizeLayer(styledTexel(clamp(origin, vec2<i32>(0), maximumCoordinate)));
  let p10 = quantizeLayer(styledTexel(clamp(
    origin + vec2<i32>(1, 0),
    vec2<i32>(0),
    maximumCoordinate
  )));
  let p01 = quantizeLayer(styledTexel(clamp(
    origin + vec2<i32>(0, 1),
    vec2<i32>(0),
    maximumCoordinate
  )));
  let p11 = quantizeLayer(styledTexel(clamp(
    origin + vec2<i32>(1, 1),
    vec2<i32>(0),
    maximumCoordinate
  )));
  return mix(mix(p00, p10, fraction.x), mix(p01, p11, fraction.x), fraction.y);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let layerPosition = display.viewCenter
    + (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < display.layerSize);

  var paint: vec4<f32>;
  if (display.selectedMipLevel < 0.5) {
    paint = directStyledSample(layerPosition);
  } else {
    let uv = clamp(
      (layerPosition + vec2<f32>(0.5)) / display.layerSize,
      vec2<f32>(0.0),
      vec2<f32>(1.0)
    );
    paint = textureSampleLevel(
      coarseStyledTexture,
      layerSampler,
      uv,
      display.selectedMipLevel - 1.0
    );
  }

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
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
@group(0) @binding(7) var<storage, read> coverageField: array<u32>;

const THRESHOLD_WORD_BITS = ${THRESHOLD_MASK_WORD_BITS}u;
const THRESHOLD_WORDS_PER_ROW = ${wordsPerRow}u;

fn loadCoverageByte(position: vec2<u32>) -> u32 {
  let linearIndex = position.y * ${documentWidth}u + position.x;
  let packed = coverageField[linearIndex >> 2u];
  let shift = (linearIndex & 3u) * 8u;
  return (packed >> shift) & 255u;
}

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
    let documentPosition = vec2<u32>(documentX, documentY);
    if (sourceTexel(vec2<i32>(documentPosition)).a >= 0.5) {
      nextBits |= bit;
    }
    if (loadCoverageByte(documentPosition) != 0u) {
      atomicOr(&changeState[0], 2u);
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
  scratchExtent: u32,
  strokeEnabled: u32,
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
  readonly styledMipLevelCount: number;
  readonly persistentMemoryBytes: number;
  readonly styledMemoryBytes: number;
  readonly coverageMemoryBytes: number;
  readonly thresholdMaskMemoryBytes: number;
  readonly controlMemoryBytes: number;

  private readonly device: GPUDevice;
  private readonly scratchPool: EffectsScratchPool;
  private readonly documentWidth: number;
  private readonly documentHeight: number;
  private readonly layerFormat: "rgba8unorm" | "rgba16float";
  private layerView: GPUTextureView;
  private readonly lightGlazeUniformBuffer: GPUBuffer;
  private readonly thicknessTailUniformBuffer: GPUBuffer;
  private readonly readbackEnabled: boolean;
  private readonly maximumScratchExtent: number;
  private _scratchExtent: number;
  private _scratchMemoryBytes = 0;
  private scratchPoolGeneration = -1;
  private scratchPoolLayoutVersion = -1;
  private readonly parameterBuffer: GPUBuffer;
  private readonly displayParameterBuffers: Record<SourceModeCode, GPUBuffer>;
  private readonly displayParameterUpload = new ArrayBuffer(DISPLAY_PARAMETER_BYTES);
  private readonly displayParameterUploadU32 = new Uint32Array(this.displayParameterUpload);
  private readonly displayParameterUploadF32 = new Float32Array(this.displayParameterUpload);
  private readonly parameterUpload = new ArrayBuffer(PARAMETER_CAPACITY * PARAMETER_STRIDE);
  private readonly bevelUniformBuffer: GPUBuffer;
  private readonly bevelUniformUpload = new ArrayBuffer(BEVEL_UNIFORM_BYTES);
  private readonly bevelUniformUploadU32 = new Uint32Array(this.bevelUniformUpload);
  private readonly bevelUniformUploadF32 = new Float32Array(this.bevelUniformUpload);

  private readonly parameterUploadI32 = new Int32Array(this.parameterUpload);
  private readonly parameterUploadU32 = new Uint32Array(this.parameterUpload);
  private readonly parameterUploadF32 = new Float32Array(this.parameterUpload);
  private readonly indirectTemplateUpload = new Uint32Array(
    PARAMETER_CAPACITY * INDIRECT_ARGUMENT_WORDS,
  );
  private readonly coverageBuffer: GPUBuffer;
  private readonly thresholdMaskBuffer: GPUBuffer;
  private readonly changeStateBuffer: GPUBuffer;
  private readonly indirectArgumentsBuffer: GPUBuffer;
  private readonly coarseStyledTexture: GPUTexture;
  private readonly coarseStyledStorageView: GPUTextureView;
  private readonly readbackStyledTexture: GPUTexture | null;
  private readonly readbackStyledStorageView: GPUTextureView | null;
  readonly goldenMip0SamplingView: GPUTextureView | null;
  private readonly dummyTexture: GPUTexture;
  private readonly dummyView: GPUTextureView;
  private readonly dummyBevelTexture: GPUTexture;
  private readonly dummyBevelView: GPUTextureView;
  private bevelHeightView: GPUTextureView;
  private bevelGlossView: GPUTextureView;

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
  private readbackComposePipeline: GPUComputePipeline | null = null;
  private thresholdMaskPipeline!: GPUComputePipeline;
  private indirectGatePipeline!: GPUComputePipeline;
  private jfaBindGroups!: readonly [GPUBindGroup, GPUBindGroup];
  private indirectGateBindGroup!: GPUBindGroup;
  private sourceViews: Record<SourceModeCode, GPUTextureView>;
  private seedBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private resolveBindGroups = new Map<string, GPUBindGroup>();
  private composeBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private readbackComposeBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private thresholdMaskBindGroups = new Map<SourceModeCode, GPUBindGroup>();
  private destroyed = false;

  private constructor(options: RasterStrokeRendererOptions) {
    this.device = options.device;
    this.scratchPool = options.scratchPool;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    if (this.documentWidth % COVERAGE_WORD_PIXELS !== 0) {
      throw new Error("La larghezza documento Traccia deve essere divisibile per 4.");
    }
    this.layerFormat = options.layerFormat;
    this.layerView = options.layerView;
    this.lightGlazeUniformBuffer = options.lightGlazeUniformBuffer;
    this.thicknessTailUniformBuffer = options.thicknessTailUniformBuffer;
    this.readbackEnabled = options.readbackEnabled === true;

    const maximumScratchFromBinding = Math.floor(Math.sqrt(
      Number(this.device.limits.maxStorageBufferBindingSize) / 8,
    ));
    const maximumScratchFromBuffer = Math.floor(Math.sqrt(
      Number(this.device.limits.maxBufferSize) / 16,
    ));
    this.maximumScratchExtent = Math.floor(
      Math.min(maximumScratchFromBinding, maximumScratchFromBuffer) / WORKGROUP_SIZE,
    ) * WORKGROUP_SIZE;
    this._scratchExtent = this.normalizeScratchExtent(
      options.scratchExtent ?? DEFAULT_SCRATCH_EXTENT,
    );
    this.updateScratchRequirement();
    const parameterBufferBytes = PARAMETER_CAPACITY * PARAMETER_STRIDE;
    this.parameterBuffer = this.device.createBuffer({
      label: "Traccia dynamic dispatch parameters",
      size: parameterBufferBytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.displayParameterBuffers = {
      0: this.device.createBuffer({
        label: "Traccia direct LOD 0 permanent display parameters",
        size: DISPLAY_PARAMETER_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      1: this.device.createBuffer({
        label: "Traccia direct LOD 0 Light Glaze display parameters",
        size: DISPLAY_PARAMETER_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      2: this.device.createBuffer({
        label: "Traccia direct LOD 0 thickness tail display parameters",
        size: DISPLAY_PARAMETER_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };
    this.bevelUniformBuffer = this.device.createBuffer({
      label: "Style stack Smusso/Rilievo composition parameters",
      size: BEVEL_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.updateBevelParameters(DEFAULT_RASTER_BEVEL_STYLE);
    const coverageWordCount = Math.ceil(
      this.documentWidth * this.documentHeight / COVERAGE_WORD_PIXELS,
    );
    this.coverageBuffer = this.device.createBuffer({
      label: "Traccia persistent packed R8 coverage",
      size: coverageWordCount * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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
      label: "Traccia threshold-or-coverage-overlap change flags",
      size: changeStateBytes,
      usage:
        GPUBufferUsage.STORAGE
        | GPUBufferUsage.COPY_DST
        | (this.readbackEnabled ? GPUBufferUsage.COPY_SRC : 0),
    });
    const indirectArgumentsBytes = PARAMETER_CAPACITY * INDIRECT_ARGUMENT_BYTES;
    this.indirectArgumentsBuffer = this.device.createBuffer({
      label: "Traccia threshold-or-coverage-gated indirect dispatch arguments",
      size: indirectArgumentsBytes,
      usage:
        GPUBufferUsage.STORAGE
        | GPUBufferUsage.INDIRECT
        | GPUBufferUsage.COPY_DST,
    });
    const mipLevelCount = Math.floor(
      Math.log2(Math.max(this.documentWidth, this.documentHeight)),
    ) + 1;
    this.styledMipLevelCount = mipLevelCount;
    const coarseWidth = Math.max(1, this.documentWidth >> 1);
    const coarseHeight = Math.max(1, this.documentHeight >> 1);
    const coarseMipLevelCount = mipLevelCount - 1;
    this.coarseStyledTexture = this.device.createTexture({
      label: `Traccia styled derived mip 1+ ${this.layerFormat}`,
      size: {
        width: coarseWidth,
        height: coarseHeight,
        depthOrArrayLayers: 1,
      },
      mipLevelCount: coarseMipLevelCount,
      format: this.layerFormat,
      usage:
        GPUTextureUsage.STORAGE_BINDING
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.RENDER_ATTACHMENT
        | (this.readbackEnabled ? GPUTextureUsage.COPY_SRC : 0),
    });
    this.coarseStyledStorageView = this.coarseStyledTexture.createView({
      label: "Traccia styled derived logical mip 1 storage view",
      baseMipLevel: 0,
      mipLevelCount: 1,
    });
    this.samplingView = this.coarseStyledTexture.createView({
      label: "Traccia styled derived mip 1+ sampling chain",
      baseMipLevel: 0,
      mipLevelCount: coarseMipLevelCount,
    });
    this.mipViews = Array.from({ length: coarseMipLevelCount }, (_, mipLevel) =>
      this.coarseStyledTexture.createView({
        label: `Traccia styled logical mip ${mipLevel + 1}`,
        baseMipLevel: mipLevel,
        mipLevelCount: 1,
      }));
    this.readbackStyledTexture = this.readbackEnabled
      ? this.device.createTexture({
        label: `Traccia golden logical mip 0 ${this.layerFormat}`,
        size: {
          width: this.documentWidth,
          height: this.documentHeight,
          depthOrArrayLayers: 1,
        },
        format: this.layerFormat,
        usage:
          GPUTextureUsage.STORAGE_BINDING
          | GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.COPY_SRC
          | GPUTextureUsage.TEXTURE_BINDING,
      })
      : null;
    this.readbackStyledStorageView = this.readbackStyledTexture?.createView({
      label: "Traccia golden logical mip 0 storage view",
    }) ?? null;
    this.goldenMip0SamplingView = this.readbackStyledTexture?.createView({
      label: "Traccia golden logical mip 0 sampling view",
    }) ?? null;
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
    this.dummyBevelTexture = this.device.createTexture({
      label: "Style stack disabled Smusso R32F placeholder",
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.dummyBevelTexture },
      new Float32Array(64),
      { bytesPerRow: 256, rowsPerImage: 1 },
      { width: 1, height: 1, depthOrArrayLayers: 1 },
    );
    this.dummyBevelView = this.dummyBevelTexture.createView();
    this.bevelHeightView = this.dummyBevelView;
    this.bevelGlossView = this.dummyBevelView;
    let styledPixels = 0;
    for (let mipLevel = 1; mipLevel < mipLevelCount; mipLevel += 1) {
      styledPixels += Math.max(1, this.documentWidth >> mipLevel)
        * Math.max(1, this.documentHeight >> mipLevel);
    }
    this.styledMemoryBytes = styledPixels * bytesPerPixel;
    this.coverageMemoryBytes = coverageWordCount * 4;
    this.thresholdMaskMemoryBytes = thresholdMaskBytes;
    this.controlMemoryBytes = parameterBufferBytes
      + DISPLAY_PARAMETER_BYTES * 3
      + changeStateBytes
      + indirectArgumentsBytes
      + BEVEL_UNIFORM_BYTES + 4;
    this.persistentMemoryBytes = this.coverageMemoryBytes
      + this.styledMemoryBytes
      + this.thresholdMaskMemoryBytes
      + this.controlMemoryBytes;
  }

  get scratchExtent(): number {
    return this._scratchExtent;
  }

  get scratchMemoryBytes(): number {
    return this._scratchMemoryBytes;
  }

  retarget(
    layerView: GPUTextureView,
    layerFormat: "rgba8unorm" | "rgba16float",
  ): void {
    if (this.destroyed) {
      throw new Error("Il renderer Traccia è già stato distrutto.");
    }
    if (layerFormat !== this.layerFormat) {
      throw new Error(
        `Formato Traccia ${this.layerFormat} incompatibile con ${layerFormat}; `
        + "serve la ricreazione completa del renderer.",
      );
    }
    this.layerView = layerView;
    this.rebuildSourceBindGroups(0);
    this.rebuildSourceBindGroups(1);
    this.rebuildSourceBindGroups(2);
  }

  createDisplayBindGroup(
    layout: GPUBindGroupLayout,
    sampler: GPUSampler,
    sourceMode: RasterStrokeSourceMode,
  ): GPUBindGroup {
    const mode = sourceModeCode(sourceMode);
    return this.device.createBindGroup({
      label: `Traccia direct/coarse display source mode ${sourceMode}`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.displayParameterBuffers[mode] } },
        { binding: 1, resource: this.layerView },
        { binding: 2, resource: this.sourceViews[mode] },
        { binding: 3, resource: { buffer: this.lightGlazeUniformBuffer } },
        { binding: 4, resource: { buffer: this.thicknessTailUniformBuffer } },
        { binding: 5, resource: { buffer: this.coverageBuffer } },
        { binding: 6, resource: this.samplingView },
        { binding: 7, resource: sampler },
        { binding: 8, resource: this.bevelHeightView },
        { binding: 9, resource: this.bevelGlossView },
        { binding: 10, resource: { buffer: this.bevelUniformBuffer } },
      ],
    });
  }

  private normalizeScratchExtent(requestedExtent: unknown): number {
    const requested = Math.max(
      WORKGROUP_SIZE,
      Math.trunc(Number(requestedExtent) || DEFAULT_SCRATCH_EXTENT),
    );
    const extent = Math.floor(
      Math.min(requested, this.maximumScratchExtent) / WORKGROUP_SIZE,
    ) * WORKGROUP_SIZE;
    if (extent < WORKGROUP_SIZE) {
      throw new Error("Limite storage GPU insufficiente per lo scratch Traccia.");
    }
    return extent;
  }

  private updateScratchRequirement(): EffectsScratchLease {
    const rangeBytes = this._scratchExtent * this._scratchExtent * 8;
    this._scratchMemoryBytes = rangeBytes * 2;
    const lease = this.scratchPool.declareEffect("stroke", [
      {
        id: "ping-a",
        label: `Traccia packed dual JFA scratch A ${this._scratchExtent}²`,
        size: rangeBytes,
      },
      {
        id: "ping-b",
        label: `Traccia packed dual JFA scratch B ${this._scratchExtent}²`,
        size: rangeBytes,
      },
    ]);
    if (!lease) {
      throw new Error("La Traccia richiede scratch ma il pool non ha restituito un lease.");
    }
    return lease;
  }

  private requireScratchLease(): EffectsScratchLease {
    const lease = this.scratchPool.lease("stroke");
    if (!lease) {
      throw new Error("Lease scratch Traccia non disponibile.");
    }
    return lease;
  }

  private scratchBinding(
    lease: EffectsScratchLease,
    index: ScratchIndex,
  ): GPUBufferBinding {
    const range = lease.ranges[index === 0 ? "ping-a" : "ping-b"];
    if (!range) {
      throw new Error(`Range scratch Traccia ${index} non disponibile.`);
    }
    return { buffer: lease.buffer, offset: range.offset, size: range.size };
  }

  private syncScratchBindGroups(): void {
    const lease = this.requireScratchLease();
    if (
      lease.generation === this.scratchPoolGeneration
      && lease.layoutVersion === this.scratchPoolLayoutVersion
    ) {
      return;
    }
    if (this.jfaBindGroupLayout) {
      this.rebuildScratchBindGroups();
    }
  }

  resizeScratch(requestedExtent: number): boolean {
    if (this.destroyed) {
      throw new Error("Renderer Traccia già distrutto.");
    }
    const nextExtent = this.normalizeScratchExtent(requestedExtent);
    if (nextExtent === this._scratchExtent) {
      return false;
    }
    this._scratchExtent = nextExtent;
    this.updateScratchRequirement();
    if (this.jfaBindGroupLayout) {
      this.rebuildScratchBindGroups();
    }
    return true;
  }

  async readStyledPixels(
    requestedRect?: RasterStrokeRect,
    mipLevel = 0,
  ): Promise<Uint8Array> {
    if (this.destroyed) {
      throw new Error("Renderer Traccia già distrutto.");
    }
    if (!this.readbackEnabled) {
      throw new Error("Readback Traccia non abilitato per questo renderer.");
    }
    if (!Number.isInteger(mipLevel) || mipLevel < 0 || mipLevel >= this.styledMipLevelCount) {
      throw new Error(`Mip Traccia non valido per il readback: ${mipLevel}.`);
    }
    const texture = mipLevel === 0 ? this.readbackStyledTexture : this.coarseStyledTexture;
    if (!texture) {
      throw new Error("Texture golden Traccia mip 0 non disponibile.");
    }
    const textureMipLevel = mipLevel === 0 ? 0 : mipLevel - 1;
    const mipWidth = Math.max(1, this.documentWidth >> mipLevel);
    const mipHeight = Math.max(1, this.documentHeight >> mipLevel);
    const rect = normalizedRect(
      requestedRect ?? {
        x: 0,
        y: 0,
        width: mipWidth,
        height: mipHeight,
      },
      mipWidth,
      mipHeight,
    );
    if (!rect) {
      return new Uint8Array();
    }
    const bytesPerPixel = this.layerFormat === "rgba16float" ? 8 : 4;
    const unpaddedBytesPerRow = rect.width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const readbackBuffer = this.device.createBuffer({
      label: `Traccia golden styled mip ${mipLevel} readback`,
      size: bytesPerRow * rect.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: `Traccia golden styled mip ${mipLevel} readback encoder`,
      });
      encoder.copyTextureToBuffer(
        {
          texture,
          mipLevel: textureMipLevel,
          origin: { x: rect.x, y: rect.y, z: 0 },
        },
        {
          buffer: readbackBuffer,
          bytesPerRow,
          rowsPerImage: rect.height,
        },
        {
          width: rect.width,
          height: rect.height,
          depthOrArrayLayers: 1,
        },
      );
      this.device.queue.submit([encoder.finish()]);
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readbackBuffer.getMappedRange());
      const compact = new Uint8Array(unpaddedBytesPerRow * rect.height);
      for (let row = 0; row < rect.height; row += 1) {
        compact.set(
          mapped.subarray(
            row * bytesPerRow,
            row * bytesPerRow + unpaddedBytesPerRow,
          ),
          row * unpaddedBytesPerRow,
        );
      }
      readbackBuffer.unmap();
      return compact;
    } finally {
      readbackBuffer.destroy();
    }
  }

  async readChangeStateFlags(): Promise<number> {
    if (this.destroyed) {
      throw new Error("Renderer Traccia già distrutto.");
    }
    if (!this.readbackEnabled) {
      throw new Error("Readback Traccia non abilitato per questo renderer.");
    }
    const readbackBuffer = this.device.createBuffer({
      label: "Traccia golden change-state flag readback",
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = this.device.createCommandEncoder({
        label: "Traccia golden change-state flag readback encoder",
      });
      encoder.copyBufferToBuffer(this.changeStateBuffer, 0, readbackBuffer, 0, 4);
      this.device.queue.submit([encoder.finish()]);
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const value = new Uint32Array(readbackBuffer.getMappedRange())[0] ?? 0;
      readbackBuffer.unmap();
      return value;
    } finally {
      readbackBuffer.destroy();
    }
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
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
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
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 9,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
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
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
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
      code: seedShader(this.documentWidth, this.documentHeight),
    });
    const jfaModule = this.device.createShaderModule({
      label: "Traccia packed dual JFA WGSL",
      code: jfaShader(),
    });
    const resolveModule = this.device.createShaderModule({
      label: "Traccia Q10.6 to packed R8 coverage WGSL",
      code: resolveShader(this.documentWidth, this.documentHeight),
    });
    const composeModule = this.device.createShaderModule({
      label: "Traccia styled logical mip 1 compose WGSL",
      code: coarseComposeShader(this.documentWidth, this.documentHeight, this.layerFormat),
    });
    const readbackComposeModule = this.readbackEnabled
      ? this.device.createShaderModule({
        label: "Traccia golden logical mip 0 compose WGSL",
        code: readbackComposeShader(this.documentWidth, this.documentHeight, this.layerFormat),
      })
      : null;
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
      { label: "coarse-compose", module: composeModule },
      ...(readbackComposeModule
        ? [{ label: "golden-readback-compose", module: readbackComposeModule }]
        : []),
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
      label: "Traccia packed R8 coverage resolve pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.resolveBindGroupLayout],
      }),
      compute: { module: resolveModule, entryPoint: "main" },
    });
    const composePipelineLayout = this.device.createPipelineLayout({
      label: "Traccia styled compose pipeline layout",
      bindGroupLayouts: [this.composeBindGroupLayout],
    });
    this.composePipeline = this.device.createComputePipeline({
      label: "Traccia styled logical mip 1 compose pipeline",
      layout: composePipelineLayout,
      compute: { module: composeModule, entryPoint: "main" },
    });
    this.readbackComposePipeline = readbackComposeModule
      ? this.device.createComputePipeline({
        label: "Traccia golden logical mip 0 compose pipeline",
        layout: composePipelineLayout,
        compute: { module: readbackComposeModule, entryPoint: "main" },
      })
      : null;
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

    this.rebuildScratchBindGroups();
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
  setBevelResources(heightView: GPUTextureView | null, glossView: GPUTextureView | null): void {
    this.bevelHeightView = heightView ?? this.dummyBevelView;
    this.bevelGlossView = glossView ?? this.dummyBevelView;
    if (this.composeBindGroupLayout) {
      this.rebuildSourceBindGroups(0);
      this.rebuildSourceBindGroups(1);
      this.rebuildSourceBindGroups(2);
    }
  }

  updateBevelParameters(source: RasterBevelStyle): void {
    if (this.destroyed) {
      throw new Error("Renderer style stack già distrutto.");
    }
    const style = normalizeRasterBevelStyle(source);
    const derived = deriveRasterBevelHeightfield(style);
    const light = rasterBevelLightVector(style.angle, style.altitude);
    const modeCode = style.mode === "inner"
      ? 0
      : style.mode === "outer"
        ? 1
        : style.mode === "emboss" ? 2 : 3;
    this.bevelUniformUploadU32.fill(0);
    this.bevelUniformUploadU32[0] = style.enabled ? 1 : 0;
    this.bevelUniformUploadU32[1] = modeCode;
    this.bevelUniformUploadU32[2] = style.contourAA ? 1 : 0;
    this.bevelUniformUploadF32[4] = derived.amplitudeScale
      * (style.depth / 100)
      * (style.direction === "down" ? -1 : 1);
    this.bevelUniformUploadF32[5] = style.fill / 100;
    this.bevelUniformUploadF32[6] = 1;
    this.bevelUniformUploadF32[8] = light[0];
    this.bevelUniformUploadF32[9] = light[1];
    this.bevelUniformUploadF32[10] = light[2];
    this.bevelUniformUploadF32[12] = style.highlightColor[0];
    this.bevelUniformUploadF32[13] = style.highlightColor[1];
    this.bevelUniformUploadF32[14] = style.highlightColor[2];
    this.bevelUniformUploadF32[15] = style.highlightOpacity / 100;
    this.bevelUniformUploadF32[16] = style.shadowColor[0];
    this.bevelUniformUploadF32[17] = style.shadowColor[1];
    this.bevelUniformUploadF32[18] = style.shadowColor[2];
    this.bevelUniformUploadF32[19] = style.shadowOpacity / 100;
    this.device.queue.writeBuffer(this.bevelUniformBuffer, 0, this.bevelUniformUpload);
  }


  private rebuildScratchBindGroups(): void {
    const lease = this.requireScratchLease();
    const scratchA = this.scratchBinding(lease, 0);
    const scratchB = this.scratchBinding(lease, 1);
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
          { binding: 1, resource: scratchA },
          { binding: 2, resource: scratchB },
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
          { binding: 1, resource: scratchB },
          { binding: 2, resource: scratchA },
        ],
      }),
    ];
    this.rebuildSourceBindGroups(0);
    this.rebuildSourceBindGroups(1);
    this.rebuildSourceBindGroups(2);
    this.scratchPoolGeneration = lease.generation;
    this.scratchPoolLayoutVersion = lease.layoutVersion;
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
    const scratchLease = this.requireScratchLease();
    this.seedBindGroups.set(mode, this.device.createBindGroup({
      label: `Traccia seed source mode ${mode}`,
      layout: this.seedBindGroupLayout,
      entries: [
        ...this.commonSourceEntries(mode),
        { binding: 5, resource: this.scratchBinding(scratchLease, 0) },
      ],
    }));
    for (const scratchIndex of [0, 1] as const) {
      this.resolveBindGroups.set(`${mode}:${scratchIndex}`, this.device.createBindGroup({
        label: `Traccia resolve source ${mode}, scratch ${scratchIndex}`,
        layout: this.resolveBindGroupLayout,
        entries: [
          ...this.commonSourceEntries(mode),
          { binding: 5, resource: this.scratchBinding(scratchLease, scratchIndex) },
          { binding: 6, resource: { buffer: this.coverageBuffer } },
        ],
      }));
    }
    this.composeBindGroups.set(mode, this.device.createBindGroup({
      label: `Style stack logical mip 1 compose source mode ${mode}`,
      layout: this.composeBindGroupLayout,
      entries: [
        ...this.commonSourceEntries(mode),
        { binding: 5, resource: { buffer: this.coverageBuffer } },
        { binding: 6, resource: this.coarseStyledStorageView },
        { binding: 7, resource: this.bevelHeightView },
        { binding: 8, resource: this.bevelGlossView },
        { binding: 9, resource: { buffer: this.bevelUniformBuffer } },
      ],
    }));
    if (this.readbackStyledStorageView) {
      this.readbackComposeBindGroups.set(mode, this.device.createBindGroup({
        label: `Style stack golden logical mip 0 compose source mode ${mode}`,
        layout: this.composeBindGroupLayout,
        entries: [
          ...this.commonSourceEntries(mode),
          { binding: 5, resource: { buffer: this.coverageBuffer } },
          { binding: 6, resource: this.readbackStyledStorageView },
          { binding: 7, resource: this.bevelHeightView },
          { binding: 8, resource: this.bevelGlossView },
          { binding: 9, resource: { buffer: this.bevelUniformBuffer } },
        ],
      }));
    }
    this.thresholdMaskBindGroups.set(mode, this.device.createBindGroup({
      label: `Traccia alpha-threshold mask source mode ${mode}`,
      layout: this.thresholdMaskBindGroupLayout,
      entries: [
        ...this.commonSourceEntries(mode),
        { binding: 5, resource: { buffer: this.thresholdMaskBuffer } },
        { binding: 6, resource: { buffer: this.changeStateBuffer } },
        { binding: 7, resource: { buffer: this.coverageBuffer } },
      ],
    }));
  }

  private buildJobs(rect: RasterStrokeRect, width: number): BuildJob[] {
    const apron = Math.ceil(width + 2);
    const maximumTargetExtent = Math.floor(
      (this.scratchExtent - apron * 2) / COVERAGE_WORD_PIXELS,
    ) * COVERAGE_WORD_PIXELS;
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

  updateDisplayParameters(
    sourceMode: RasterStrokeSourceMode,
    style: RasterStrokeStyle,
    bevelStyle: RasterBevelStyle = DEFAULT_RASTER_BEVEL_STYLE,
  ): void {
    if (this.destroyed) {
      throw new Error("Renderer Traccia già distrutto.");
    }
    const mode = sourceModeCode(sourceMode);
    this.displayParameterUploadU32.fill(0);
    this.displayParameterUploadU32[11] = mode;
    this.displayParameterUploadF32[12] = style.width;
    this.displayParameterUploadU32[13] = stylePositionCode(style.position);
    this.displayParameterUploadF32[16] = style.color[0];
    this.displayParameterUploadF32[17] = style.color[1];
    this.displayParameterUploadF32[18] = style.color[2];
    this.displayParameterUploadF32[19] = style.color[3];
    this.displayParameterUploadU32[15] = style.enabled && style.width > 0 ? 1 : 0;
    this.updateBevelParameters(bevelStyle);
    this.device.queue.writeBuffer(
      this.displayParameterBuffers[mode],
      0,
      this.displayParameterUpload,
    );
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
    this.parameterUploadU32[word + 14] = this.scratchExtent;
    this.parameterUploadU32[word + 15] = style.enabled && style.width > 0 ? 1 : 0;
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
    this.syncScratchBindGroups();
    const rebuildRect = wordAlignedCoverageRect(
      options.rebuildRect,
      this.documentWidth,
      this.documentHeight,
    );
    const requestedDetectionRect = expandedCoverageDetectionRect(
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
    this.updateDisplayParameters(
      options.sourceMode,
      options.style,
      options.bevelStyle ?? DEFAULT_RASTER_BEVEL_STYLE,
    );

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

    const coarseWidth = Math.max(1, this.documentWidth >> 1);
    const coarseHeight = Math.max(1, this.documentHeight >> 1);
    const coarseDirectComposeRects = directComposeRects
      .map((rect) => halfResolutionRect(rect, coarseWidth, coarseHeight))
      .filter((rect): rect is RasterStrokeRect => rect !== null);
    const coarseConditionalComposeRect = halfResolutionRect(
      conditionalComposeRect,
      coarseWidth,
      coarseHeight,
    );
    const readbackComposeRects = this.readbackEnabled
      ? [directComposeRect, requestedConditionalComposeRect]
        .filter((rect): rect is RasterStrokeRect => rect !== null)
      : [];

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
          Math.ceil(Math.ceil(job.targetWidth / COVERAGE_WORD_PIXELS) / WORKGROUP_SIZE),
          Math.ceil(job.targetHeight / WORKGROUP_SIZE),
        );
        jobIndirectArguments.push({ field, resolve });
      }
    }
    let conditionalComposeArgument = -1;
    if (coarseConditionalComposeRect) {
      conditionalComposeArgument = indirectArgumentCount;
      indirectArgumentCount = this.writeIndirectArgument(
        indirectArgumentCount,
        Math.ceil(coarseConditionalComposeRect.width / WORKGROUP_SIZE),
        Math.ceil(coarseConditionalComposeRect.height / WORKGROUP_SIZE),
      );
    }

    let parameterCount = schedules.reduce(
      (total, schedule) => total + schedule.length + 2,
      0,
    );
    parameterCount += coarseDirectComposeRects.length;
    parameterCount += coarseConditionalComposeRect ? 1 : 0;
    parameterCount += readbackComposeRects.length;
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
    const coarseDirectComposeSlots = coarseDirectComposeRects.map((rect) => {
      const slot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetX: rect.x,
        targetY: rect.y,
        targetWidth: rect.width,
        targetHeight: rect.height,
      }, 0, mode, options.style);
      return slot;
    });
    let coarseConditionalComposeSlot = -1;
    if (coarseConditionalComposeRect) {
      coarseConditionalComposeSlot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetX: coarseConditionalComposeRect.x,
        targetY: coarseConditionalComposeRect.y,
        targetWidth: coarseConditionalComposeRect.width,
        targetHeight: coarseConditionalComposeRect.height,
      }, 0, mode, options.style);
    }
    const readbackComposeSlots = readbackComposeRects.map((rect) => {
      const slot = parameterSlot;
      parameterSlot = this.writeParameters(parameterSlot, {
        targetX: rect.x,
        targetY: rect.y,
        targetWidth: rect.width,
        targetHeight: rect.height,
      }, 0, mode, options.style);
      return slot;
    });

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
    if (options.clearStyled) {
      options.encoder.clearBuffer(this.coverageBuffer);
    }
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
          ? "Detect Traccia threshold changes or existing coverage overlap"
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
        label: "Gate Traccia field dispatches from threshold or coverage overlap",
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
      const clearCoarsePass = options.encoder.beginRenderPass({
        label: "Clear Traccia styled logical mip 1",
        colorAttachments: [{
          view: this.mipViews[0],
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      clearCoarsePass.end();
      if (this.readbackStyledStorageView) {
        const clearReadbackPass = options.encoder.beginRenderPass({
          label: "Clear Traccia golden logical mip 0",
          colorAttachments: [{
            view: this.readbackStyledStorageView,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        clearReadbackPass.end();
      }
    }

    let jfaDispatches = 0;
    if (jobs.length > 0) {
      const fieldPass = options.encoder.beginComputePass({
        label: useThresholdGate
          ? "Traccia gated seed + packed dual JFA + packed R8 coverage"
          : "Traccia seed + packed dual JFA + packed R8 coverage",
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
            Math.ceil(Math.ceil(job.targetWidth / COVERAGE_WORD_PIXELS) / WORKGROUP_SIZE),
            Math.ceil(job.targetHeight / WORKGROUP_SIZE),
          );
        }
      }
      fieldPass.end();
    }

    const composeDispatches = directComposeRects.length + (conditionalComposeRect ? 1 : 0);
    const storedComposeDispatches = coarseDirectComposeRects.length
      + (coarseConditionalComposeRect ? 1 : 0);
    if (storedComposeDispatches > 0) {
      const composePass = options.encoder.beginComputePass({
        label: coarseConditionalComposeRect
          ? "Traccia logical mip 1 compose with gated coverage halo"
          : "Traccia logical mip 1 compose",
      });
      composePass.setPipeline(this.composePipeline);
      for (let index = 0; index < coarseDirectComposeRects.length; index += 1) {
        const rect = coarseDirectComposeRects[index];
        composePass.setBindGroup(
          0,
          this.composeBindGroups.get(mode)!,
          this.dynamicOffset(coarseDirectComposeSlots[index]),
        );
        composePass.dispatchWorkgroups(
          Math.ceil(rect.width / WORKGROUP_SIZE),
          Math.ceil(rect.height / WORKGROUP_SIZE),
        );
      }
      if (coarseConditionalComposeRect) {
        composePass.setBindGroup(
          0,
          this.composeBindGroups.get(mode)!,
          this.dynamicOffset(coarseConditionalComposeSlot),
        );
        composePass.dispatchWorkgroupsIndirect(
          this.indirectArgumentsBuffer,
          conditionalComposeArgument * INDIRECT_ARGUMENT_BYTES,
        );
      }
      composePass.end();
    }

    if (this.readbackComposePipeline && readbackComposeRects.length > 0) {
      const readbackPass = options.encoder.beginComputePass({
        label: "Traccia golden logical mip 0 compose",
      });
      readbackPass.setPipeline(this.readbackComposePipeline);
      for (let index = 0; index < readbackComposeRects.length; index += 1) {
        const rect = readbackComposeRects[index];
        readbackPass.setBindGroup(
          0,
          this.readbackComposeBindGroups.get(mode)!,
          this.dynamicOffset(readbackComposeSlots[index]),
        );
        readbackPass.dispatchWorkgroups(
          Math.ceil(rect.width / WORKGROUP_SIZE),
          Math.ceil(rect.height / WORKGROUP_SIZE),
        );
      }
      readbackPass.end();
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
    this.scratchPool.releaseRequirement("stroke");
    this.parameterBuffer.destroy();
    this.bevelUniformBuffer.destroy();
    this.displayParameterBuffers[0].destroy();
    this.displayParameterBuffers[1].destroy();
    this.displayParameterBuffers[2].destroy();
    this.coverageBuffer.destroy();
    this.thresholdMaskBuffer.destroy();
    this.changeStateBuffer.destroy();
    this.indirectArgumentsBuffer.destroy();
    this.coarseStyledTexture.destroy();
    this.readbackStyledTexture?.destroy();
    this.dummyTexture.destroy();
    this.dummyBevelTexture.destroy();
    this.seedBindGroups.clear();
    this.resolveBindGroups.clear();
    this.composeBindGroups.clear();
    this.readbackComposeBindGroups.clear();
    this.thresholdMaskBindGroups.clear();
  }
}
