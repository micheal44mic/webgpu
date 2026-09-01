import { RASTER_BEVEL_NORMAL_APRON } from "./bevel-core";
import { createComputePipelineAsync } from "./engine-gpu-utils";

export type RasterBevelBoundingFieldTestMutation =
  | "none"
  | "zero-outside"
  | "omit-origin";

export interface RasterStrokeProgramWarmupOptions {
  device: GPUDevice;
  layerFormat: "rgba8unorm" | "rgba16float";
  bevelBoundingFieldEnabled?: boolean;
  /** Golden-only compile mutation; never set by the application renderer. */
  bevelBoundingFieldTestMutation?: RasterBevelBoundingFieldTestMutation;
}

const WORKGROUP_SIZE = 8;
const PARAMETER_BYTES = 96;
const INVALID_PACKED_SEED = 0xffff_ffff;
const THRESHOLD_MASK_WORD_BITS = 32;
const INDIRECT_ARGUMENT_WORDS = 3;
const INDIRECT_GATE_WORKGROUP_SIZE = 64;
export function shaderSourceCommon(bindGroup = 0): string {
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
  colorOverlay: vec4<f32>,
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

const INVALID_SEED: u32 = ${INVALID_PACKED_SEED}u;

@group(${bindGroup}) @binding(0) var<uniform> parameters: StrokeParameters;
@group(${bindGroup}) @binding(1) var permanentTexture: texture_2d<f32>;
@group(${bindGroup}) @binding(2) var transientTexture: texture_2d<f32>;
@group(${bindGroup}) @binding(3) var<uniform> lightGlaze: LightGlazeUniforms;
@group(${bindGroup}) @binding(4) var<uniform> thicknessTail: ThicknessTailUniforms;

fn documentSize() -> vec2<i32> {
  return vec2<i32>(textureDimensions(permanentTexture));
}

fn insideDocument(position: vec2<i32>) -> bool {
  return all(position >= vec2<i32>(0)) && all(position < documentSize());
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
      if (thicknessTail.compositionMode == 2u) {
        return transientPaint;
      }
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

function seedShader(): string {
  return `${shaderSourceCommon()}
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
  colorOverlay: vec4<f32>,
};

const INVALID_SEED: u32 = ${INVALID_PACKED_SEED}u;

@group(0) @binding(0) var<uniform> parameters: StrokeParameters;
// Both disjoint subranges live in one physical buffer. A buffer is a single
// subresource, and each dispatch is its own usage scope, so the usage list must be
// homogeneous: storage + read-only-storage on the same buffer is rejected even when
// the ranges do not intersect. Both bindings are therefore storage — the spec's
// "usage scope storage exception" permits it, and disjoint ranges keep the separate
// per-dispatch aliasing check from firing. This shader never writes inputSeeds.
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

function resolveShader(): string {
  return `${shaderSourceCommon()}
@group(0) @binding(5) var<storage, read> propagatedSeeds: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read_write> coverageField: array<u32>;

fn rampAt(offset: f32, signedDistance: f32) -> f32 {
  return clamp(offset + 0.5 - signedDistance, 0.0, 1.0);
}

fn resolveCoverage(
  documentPosition: vec2<u32>,
  localPosition: vec2<u32>
) -> f32 {
  let pair = propagatedSeeds[
    localPosition.y * parameters.scratchExtent + localPosition.x
  ];
  let alpha = sourceTexel(vec2<i32>(documentPosition)).a;
  let inside = alpha >= 0.5;
  let candidate = select(pair.x, pair.y, inside);
  if (candidate == INVALID_SEED) {
    return 0.0;
  }
  let seedPosition = unpackSeed(candidate);
  let delta = vec2<f32>(seedPosition) - vec2<f32>(localPosition);
  let distance = sqrt(dot(delta, delta));
  let fixedDistance = u32(floor(min(distance, 1023.0) * 64.0 + 0.5));
  if (fixedDistance < 1u) {
    return 0.0;
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
  return clamp(coverage, 0.0, 1.0);
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
  var coveragePair = vec2<f32>(0.0);
  for (var lane = 0u; lane < 2u; lane += 1u) {
    if (firstX + lane >= parameters.targetSize.x) {
      continue;
    }
    let offset = firstOffset + vec2<u32>(lane, 0u);
    coveragePair[lane] = resolveCoverage(
      parameters.targetOrigin + offset,
      parameters.localTargetOrigin + offset
    );
  }
  let coverageWordsPerRow = (u32(documentSize().x) + 1u) / 2u;
  let wordIndex = firstDocumentPosition.y * coverageWordsPerRow
    + (firstDocumentPosition.x >> 1u);
  coverageField[wordIndex] = pack2x16float(coveragePair);
}
`;
}

export function strokeCompositionShaderSource(
  bindGroup = 0,
  coverageBinding = 5,
  heightBinding = 7,
  glossBinding = 8,
  bevelUniformBinding = 9,
  outerShadowCoverageBinding = 10,
  outerShadowUniformBinding = 11,
  innerShadowCoverageBinding = 12,
  innerShadowUniformBinding = 13,
  derivativeMode: "analytic" | "fragment" = "analytic",
  boundingFieldEnabled = false,
  boundingFieldTestMutation: RasterBevelBoundingFieldTestMutation = "none",
): string {
  const contourAA =
    derivativeMode === "fragment"
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
  const fieldUniformMembers = boundingFieldEnabled
    ? `
  fieldStorage: vec4<i32>,
  fieldValid: vec4<i32>,`
    : "";
  const fieldPositionExpression =
    boundingFieldTestMutation === "omit-origin"
      ? "position + apron"
      : "position - bevel.fieldStorage.xy + apron";
  const heightLookup = boundingFieldEnabled
    ? /* wgsl */ `fn bevelHeightAt(position: vec2<i32>) -> f32 {
  let validOrigin = bevel.fieldValid.xy;
  let validSize = bevel.fieldValid.zw;
  if (any(validSize <= vec2<i32>(0))) {
    return bevel.scalars.w;
  }
  let validEnd = validOrigin + validSize;
  let apron = vec2<i32>(${RASTER_BEVEL_NORMAL_APRON});
  let readableOrigin = validOrigin - select(
    vec2<i32>(0),
    apron,
    validOrigin == vec2<i32>(0)
  );
  let readableEnd = validEnd + select(
    vec2<i32>(0),
    apron,
    validEnd == documentSize()
  );
  if (
    any(position < readableOrigin)
    || any(position >= readableEnd)
  ) {
    return bevel.scalars.w;
  }
  let fieldPosition = ${fieldPositionExpression};
  return textureLoad(bevelHeight, fieldPosition, 0).r;
}`
    : /* wgsl */ `fn bevelHeightAt(position: vec2<i32>) -> f32 {
  let apron = vec2<i32>(${RASTER_BEVEL_NORMAL_APRON});
  if (
    any(position < -apron)
    || any(position >= documentSize() + apron)
  ) {
    return 0.0;
  }
  return textureLoad(bevelHeight, position + apron, 0).r;
}`;
  return /* wgsl */ `
struct BevelUniforms {
  flags: vec4<u32>,
  scalars: vec4<f32>,
  light: vec4<f32>,
  highlight: vec4<f32>,
  shadow: vec4<f32>,${fieldUniformMembers}
};

struct ShadowUniforms {
  flags: vec4<u32>,
  colorOpacity: vec4<f32>,
  geometry: vec4<f32>,
  metadata: vec4<u32>,
};

@group(${bindGroup}) @binding(${coverageBinding})
var<storage, read> coverageField: array<u32>;
@group(${bindGroup}) @binding(${heightBinding}) var bevelHeight: texture_2d<f32>;
@group(${bindGroup}) @binding(${glossBinding}) var bevelGloss: texture_2d<f32>;
@group(${bindGroup}) @binding(${bevelUniformBinding}) var<uniform> bevel: BevelUniforms;
@group(${bindGroup}) @binding(${outerShadowCoverageBinding})
var<storage, read> outerShadowField: array<u32>;
@group(${bindGroup}) @binding(${outerShadowUniformBinding})
var<uniform> outerShadow: ShadowUniforms;
@group(${bindGroup}) @binding(${innerShadowCoverageBinding})
var<storage, read> innerShadowField: array<u32>;
@group(${bindGroup}) @binding(${innerShadowUniformBinding})
var<uniform> innerShadow: ShadowUniforms;

fn coverageWordsPerRow() -> u32 {
  return (u32(documentSize().x) + 1u) / 2u;
}

fn loadCoverage(position: vec2<i32>) -> f32 {
  let x = u32(position.x);
  let pair = unpack2x16float(coverageField[u32(position.y) * coverageWordsPerRow() + (x >> 1u)]);
  return select(pair.x, pair.y, (x & 1u) == 1u);
}

fn loadOuterShadow(position: vec2<i32>) -> f32 {
  if (any(position < vec2<i32>(0)) || any(position >= documentSize())) {
    return 0.0;
  }
  let x = u32(position.x);
  let pair = unpack2x16float(outerShadowField[u32(position.y) * coverageWordsPerRow() + (x >> 1u)]);
  return select(pair.x, pair.y, (x & 1u) == 1u);
}

fn loadInnerShadow(position: vec2<i32>) -> f32 {
  if (any(position < vec2<i32>(0)) || any(position >= documentSize())) {
    return 0.0;
  }
  let x = u32(position.x);
  let pair = unpack2x16float(innerShadowField[u32(position.y) * coverageWordsPerRow() + (x >> 1u)]);
  return select(pair.x, pair.y, (x & 1u) == 1u);
}

fn sampleOuterShadow(position: vec2<f32>) -> f32 {
  let origin = vec2<i32>(floor(position));
  let fraction = fract(position);
  let p00 = loadOuterShadow(origin);
  let p10 = loadOuterShadow(origin + vec2<i32>(1, 0));
  let p01 = loadOuterShadow(origin + vec2<i32>(0, 1));
  let p11 = loadOuterShadow(origin + vec2<i32>(1, 1));
  return mix(mix(p00, p10, fraction.x), mix(p01, p11, fraction.x), fraction.y);
}

fn sampleInnerShadow(position: vec2<f32>) -> f32 {
  let origin = vec2<i32>(floor(position));
  let fraction = fract(position);
  let p00 = loadInnerShadow(origin);
  let p10 = loadInnerShadow(origin + vec2<i32>(1, 0));
  let p01 = loadInnerShadow(origin + vec2<i32>(0, 1));
  let p11 = loadInnerShadow(origin + vec2<i32>(1, 1));
  return mix(mix(p00, p10, fraction.x), mix(p01, p11, fraction.x), fraction.y);
}

fn shadowContourRaw(value: f32, contourCode: u32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  if (contourCode == 1u) {
    return 1.0 - abs(2.0 * x - 1.0);
  }
  if (contourCode == 2u) {
    let normalized = (1.0 - x) / 0.35;
    let zeroPoint = exp(-0.5 / (0.35 * 0.35));
    let gaussian = exp(-0.5 * normalized * normalized);
    return clamp((gaussian - zeroPoint) / (1.0 - zeroPoint), 0.0, 1.0);
  }
  if (contourCode == 3u) {
    return clamp(0.5 - 0.5 * cos(2.0 * 3.14159265359 * x), 0.0, 1.0);
  }
  return x;
}

fn shadowContourValue(value: f32, contourCode: u32, antialias: u32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  if (x <= 0.0) {
    return 0.0;
  }
  var result = shadowContourRaw(x, contourCode);
  if (antialias == 1u && contourCode != 0u) {
    let lower = clamp(x - 0.5 / 1024.0, 0.0, 1.0);
    let upper = clamp(x + 0.5 / 1024.0, 0.0, 1.0);
    result = (
      shadowContourRaw(lower, contourCode)
      + result
      + shadowContourRaw(upper, contourCode)
    ) / 3.0;
  }
  return clamp(result, 0.0, 1.0);
}

${heightLookup}

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

fn bevelNode(base: vec4<f32>, shapeAlpha: f32, position: vec2<i32>) -> vec4<f32> {
  var node = vec4<f32>(base.rgb * bevel.scalars.y, base.a * bevel.scalars.y);
  let response = bevelResponseAt(position);
  let t = response.x;
  var contour = lightContour(t);
${contourAA}
  let signedLight = 2.0 * contour - 1.0;
  let highlightWeight = max(signedLight, 0.0) * bevel.highlight.a * response.y;
  let shadowWeight = max(-signedLight, 0.0) * bevel.shadow.a * response.y;
  let effectAlpha = select(base.a, shapeAlpha, bevel.scalars.z < 0.999999);
  let insideWeight = select(effectAlpha, 0.0, bevel.flags.y == 1u);
  let outsideWeight = select(1.0 - effectAlpha, 0.0, bevel.flags.y == 0u);
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

fn traceOnlyNode(base: vec4<f32>, shapeAlpha: f32, coverage: f32) -> vec4<f32> {
  let alpha = base.a;
  var strokeWeight = coverage * parameters.styleColor.a;
  if (parameters.stylePosition == 2u) {
    let boundaryAlpha = select(alpha, shapeAlpha, bevel.scalars.z < 0.999999);
    strokeWeight = min(strokeWeight, 1.0 - boundaryAlpha);
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
    let boundaryAlpha = select(node.a, sourceAlpha, bevel.scalars.z < 0.999999);
    strokeWeight = min(strokeWeight, 1.0 - boundaryAlpha);
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

fn shadowNoise(
  coverage: f32,
  position: vec2<i32>,
  amount: f32,
  seed: u32
) -> f32 {
  if (amount <= 0.0) {
    return coverage;
  }
  let grain = select(0.0, 1.0, random24(vec2<u32>(position), seed) < coverage);
  return mix(coverage, grain, clamp(amount, 0.0, 1.0));
}

fn outerShadowPlane(shape: vec4<f32>, position: vec2<i32>) -> vec4<f32> {
  if (outerShadow.flags.x == 0u) {
    return vec4<f32>(0.0);
  }
  let samplePosition = vec2<f32>(position) - outerShadow.geometry.xy;
  var coverage = sampleOuterShadow(samplePosition);
  coverage = shadowContourValue(
    coverage,
    outerShadow.flags.z,
    outerShadow.flags.w
  );
  coverage = shadowNoise(
    coverage,
    position,
    outerShadow.geometry.z,
    outerShadow.metadata.x
  );
  coverage *= outerShadow.colorOpacity.a;
  if (outerShadow.geometry.w > 0.5) {
    coverage *= 1.0 - shape.a;
  }
  coverage = clamp(coverage, 0.0, 1.0);
  return vec4<f32>(outerShadow.colorOpacity.rgb * coverage, coverage);
}

fn innerShadowNode(base: vec4<f32>, shape: vec4<f32>, position: vec2<i32>) -> vec4<f32> {
  if (innerShadow.flags.x == 0u || shape.a <= 1e-6) {
    return base;
  }
  let samplePosition = vec2<f32>(position) - innerShadow.geometry.xy;
  var coverage = 1.0 - sampleInnerShadow(samplePosition);
  coverage = shadowContourValue(
    coverage,
    innerShadow.flags.z,
    innerShadow.flags.w
  );
  coverage = shadowNoise(
    coverage,
    position,
    innerShadow.geometry.z,
    innerShadow.metadata.x
  );
  let shapeWeight = clamp(coverage * innerShadow.colorOpacity.a * shape.a, 0.0, 1.0);
  if (bevel.scalars.z < 0.999999) {
    let effect = vec4<f32>(innerShadow.colorOpacity.rgb * shapeWeight, shapeWeight);
    return effect + base * (1.0 - effect.a);
  }
  let weight = shapeWeight;
  let straight = base.rgb / base.a;
  let effectColor = select(
    innerShadow.colorOpacity.rgb,
    straight * innerShadow.colorOpacity.rgb,
    innerShadow.flags.y == 1u
  );
  return vec4<f32>(mix(straight, effectColor, weight) * base.a, base.a);
}

fn colorOverlayNode(base: vec4<f32>, shape: vec4<f32>) -> vec4<f32> {
  let encodedMode = parameters.colorOverlay.a;
  let uniformAlpha = encodedMode < 0.0;
  let opacity = select(
    clamp(encodedMode, 0.0, 1.0),
    clamp(-encodedMode - 1.0, 0.0, 1.0),
    uniformAlpha
  );
  if (uniformAlpha) {
    if (shape.a <= 0.0) {
      return vec4<f32>(0.0);
    }
    return vec4<f32>(parameters.colorOverlay.rgb * opacity, opacity);
  }
  // The condition depends only on a uniform, so every invocation takes the
  // same branch. Disabled and zero-strength preserve-alpha Color Overlay add
  // no RGB multiply/mix to the hot style-stack pixel path.
  if (opacity <= 0.0) {
    return base;
  }
  if (bevel.scalars.z < 0.999999) {
    return vec4<f32>(
      mix(base.rgb, parameters.colorOverlay.rgb * shape.a, opacity),
      mix(base.a, shape.a, opacity)
    );
  }
  return vec4<f32>(
    mix(base.rgb, parameters.colorOverlay.rgb * base.a, opacity),
    base.a
  );
}

fn styledTexel(position: vec2<i32>) -> vec4<f32> {
  // Applying Color Overlay to the virtual base makes Inner Shadow, Bevel and
  // Stroke consume the recolored node without allocating another surface.
  // The default mode preserves alpha; the optional uniform mode replaces only
  // positive source alpha while alpha zero remains unoccupied.
  let shape = sourceTexel(position);
  let base = colorOverlayNode(shape * bevel.scalars.z, shape);
  var coverage = 0.0;
  if (parameters.strokeEnabled == 1u) {
    coverage = loadCoverage(position);
  }
  let shadowsDisabled = outerShadow.flags.x == 0u && innerShadow.flags.x == 0u;
  if (shadowsDisabled) {
    if (bevel.flags.x == 0u) {
      if (parameters.strokeEnabled == 0u) {
        return base;
      }
      return traceOnlyNode(base, shape.a, coverage);
    }
    var legacyNode = bevelNode(base, shape.a, position);
    if (parameters.strokeEnabled == 1u) {
      legacyNode = combinedStrokeNode(shape.a, legacyNode, coverage);
    }
    let legacyAlpha = clamp(legacyNode.a, 0.0, 1.0);
    legacyNode = vec4<f32>(
      clamp(legacyNode.rgb, vec3<f32>(0.0), vec3<f32>(legacyAlpha)),
      legacyAlpha
    );
    return legacyNode;
  }

  let shadowedBase = innerShadowNode(base, shape, position);
  var node = select(
    shadowedBase,
    bevelNode(shadowedBase, shape.a, position),
    bevel.flags.x == 1u
  );
  if (parameters.strokeEnabled == 1u) {
    node = select(
      traceOnlyNode(shadowedBase, shape.a, coverage),
      combinedStrokeNode(shape.a, node, coverage),
      bevel.flags.x == 1u
    );
  }
  let outerPlane = outerShadowPlane(shape, position);
  node = node + outerPlane * (1.0 - node.a);
  let clampedAlpha = clamp(node.a, 0.0, 1.0);
  node = vec4<f32>(
    clamp(node.rgb, vec3<f32>(0.0), vec3<f32>(clampedAlpha)),
    clampedAlpha
  );
  return node;
}
`;
}

function readbackComposeShader(
  layerFormat: "rgba8unorm" | "rgba16float",
  bevelBoundingFieldEnabled = false,
  bevelBoundingFieldTestMutation: RasterBevelBoundingFieldTestMutation = "none",
): string {
  return `${shaderSourceCommon()}
${strokeCompositionShaderSource(
  0,
  5,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  "analytic",
  bevelBoundingFieldEnabled,
  bevelBoundingFieldTestMutation,
)}
@group(0) @binding(6) var styledTexture: texture_storage_2d<${layerFormat}, write>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let position = vec2<i32>(parameters.targetOrigin + globalId.xy);
  let storagePosition = vec2<i32>(parameters.localTargetOrigin + globalId.xy);
  textureStore(styledTexture, storagePosition, styledTexel(position));
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn authoredMatteMain(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= parameters.targetSize)) {
    return;
  }
  let position = vec2<i32>(parameters.targetOrigin + globalId.xy);
  let storagePosition = vec2<i32>(parameters.localTargetOrigin + globalId.xy);
  textureStore(styledTexture, storagePosition, sourceTexel(position));
}
`;
}

function coarseComposeShader(
  layerFormat: "rgba8unorm" | "rgba16float",
  bevelBoundingFieldEnabled = false,
  bevelBoundingFieldTestMutation: RasterBevelBoundingFieldTestMutation = "none",
): string {
  return `${shaderSourceCommon()}
${strokeCompositionShaderSource(
  0,
  5,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  "analytic",
  bevelBoundingFieldEnabled,
  bevelBoundingFieldTestMutation,
)}
@group(0) @binding(6) var coarseStyledTexture: texture_storage_2d<${layerFormat}, write>;

fn quantizedStyledTexel(position: vec2<i32>) -> vec4<f32> {
  return quantizeLayer(styledTexel(clamp(position, vec2<i32>(0), documentSize() - 1)));
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
  let gammaAverage = (
    linearPremultipliedToEncodedSrgb(p00)
    + linearPremultipliedToEncodedSrgb(p10)
    + linearPremultipliedToEncodedSrgb(p01)
    + linearPremultipliedToEncodedSrgb(p11)
  ) * 0.25;
  textureStore(
    coarseStyledTexture,
    coarsePosition,
    encodedSrgbPremultipliedToLinear(gammaAverage)
  );
}
`;
}

function thresholdMaskShader(): string {
  return `${shaderSourceCommon()}
@group(0) @binding(5) var<storage, read_write> thresholdMask: array<u32>;
@group(0) @binding(6) var<storage, read_write> changeState: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read> coverageField: array<u32>;

const THRESHOLD_WORD_BITS = ${THRESHOLD_MASK_WORD_BITS}u;

fn loadCoverage(position: vec2<u32>) -> f32 {
  let coverageWordsPerRow = (textureDimensions(permanentTexture).x + 1u) / 2u;
  let wordIndex = position.y * coverageWordsPerRow + (position.x >> 1u);
  let pair = unpack2x16float(coverageField[wordIndex]);
  return select(pair.x, pair.y, (position.x & 1u) == 1u);
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let documentExtent = textureDimensions(permanentTexture);
  let thresholdWordsPerRow = (
    documentExtent.x + THRESHOLD_WORD_BITS - 1u
  ) / THRESHOLD_WORD_BITS;
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
      || documentX >= documentExtent.x
    ) {
      continue;
    }
    let bit = 1u << lane;
    writeMask |= bit;
    let documentPosition = vec2<u32>(documentX, documentY);
    if (sourceTexel(vec2<i32>(documentPosition)).a >= 0.5) {
      nextBits |= bit;
    }
    if (loadCoverage(documentPosition) > 0.0) {
      atomicOr(&changeState[0], 2u);
    }
  }

  let maskIndex = documentY * thresholdWordsPerRow + wordX;
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
  colorOverlay: vec4<f32>,
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
      .map(
        (message) =>
          `${label}:${message.lineNum}:${message.linePos} ${message.message}`,
      ),
  );
  if (errors.length > 0) {
    throw new Error(`Invalid Stroke WGSL shader:\n${errors.join("\n")}`);
  }
}

export interface RasterStrokeProgramResources {
  seedBindGroupLayout: GPUBindGroupLayout;
  jfaBindGroupLayout: GPUBindGroupLayout;
  resolveBindGroupLayout: GPUBindGroupLayout;
  composeBindGroupLayout: GPUBindGroupLayout;
  thresholdMaskBindGroupLayout: GPUBindGroupLayout;
  indirectGateBindGroupLayout: GPUBindGroupLayout;
  seedPipeline: GPUComputePipeline;
  jfaPipeline: GPUComputePipeline;
  resolvePipeline: GPUComputePipeline;
  composePipeline: GPUComputePipeline;
  readbackComposePipeline: GPUComputePipeline;
  authoredMatteBakePipeline: GPUComputePipeline;
  thresholdMaskPipeline: GPUComputePipeline;
  indirectGatePipeline: GPUComputePipeline;
}

interface RasterStrokeProgramCompilationContext {
  readonly device: GPUDevice;
  readonly layerFormat: RasterStrokeProgramWarmupOptions["layerFormat"];
  readonly bevelBoundingFieldEnabled: boolean;
  readonly bevelBoundingFieldTestMutation: RasterBevelBoundingFieldTestMutation;
  seedBindGroupLayout: GPUBindGroupLayout;
  jfaBindGroupLayout: GPUBindGroupLayout;
  resolveBindGroupLayout: GPUBindGroupLayout;
  composeBindGroupLayout: GPUBindGroupLayout;
  thresholdMaskBindGroupLayout: GPUBindGroupLayout;
  indirectGateBindGroupLayout: GPUBindGroupLayout;
  seedPipeline: GPUComputePipeline;
  jfaPipeline: GPUComputePipeline;
  resolvePipeline: GPUComputePipeline;
  composePipeline: GPUComputePipeline;
  readbackComposePipeline: GPUComputePipeline | null;
  authoredMatteBakePipeline: GPUComputePipeline | null;
  thresholdMaskPipeline: GPUComputePipeline;
  indirectGatePipeline: GPUComputePipeline;
}

const strokeProgramCache = new WeakMap<
  GPUDevice,
  Map<string, Promise<RasterStrokeProgramResources>>
>();

function strokeProgramCacheKey(
  options: RasterStrokeProgramWarmupOptions,
): string {
  return [
    options.layerFormat,
    `bbox:${options.bevelBoundingFieldEnabled === true ? 1 : 0}`,
    `mutation:${options.bevelBoundingFieldTestMutation ?? "none"}`,
  ].join("|");
}

function strokeProgramCompilationContext(
  options: RasterStrokeProgramWarmupOptions,
): RasterStrokeProgramCompilationContext {
  return {
    device: options.device,
    layerFormat: options.layerFormat,
    bevelBoundingFieldEnabled: options.bevelBoundingFieldEnabled === true,
    bevelBoundingFieldTestMutation:
      options.bevelBoundingFieldTestMutation ?? "none",
    readbackComposePipeline: null,
    authoredMatteBakePipeline: null,
  } as RasterStrokeProgramCompilationContext;
}

function acquireStrokeProgramResources(
  device: GPUDevice,
  key: string,
  factory: () => Promise<RasterStrokeProgramResources>,
): Promise<RasterStrokeProgramResources> {
  let deviceCache = strokeProgramCache.get(device);
  if (!deviceCache) {
    deviceCache = new Map();
    strokeProgramCache.set(device, deviceCache);
  }
  const cached = deviceCache.get(key);
  if (cached) {
    return cached;
  }
  const pending = factory();
  deviceCache.set(key, pending);
  void pending.then(undefined, () => {
    if (deviceCache?.get(key) === pending) {
      deviceCache.delete(key);
    }
  });
  return pending;
}

async function createStrokeProgramResources(
  this: RasterStrokeProgramCompilationContext,
): Promise<RasterStrokeProgramResources> {
  this.seedBindGroupLayout = this.device.createBindGroupLayout({
    label: "Stroke seed bind group layout",
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
        texture: { sampleType: "float" },
      },
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
    ],
  });
  this.jfaBindGroupLayout = this.device.createBindGroupLayout({
    label: "Stroke JFA bind group layout",
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
        buffer: { type: "storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  this.resolveBindGroupLayout = this.device.createBindGroupLayout({
    label: "Stroke resolve bind group layout",
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
        texture: { sampleType: "float" },
      },
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
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 6,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });
  this.composeBindGroupLayout = this.device.createBindGroupLayout({
    label: "Stroke compose bind group layout",
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
        texture: { sampleType: "float" },
      },
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
        buffer: { type: "read-only-storage" },
      },
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
      {
        binding: 10,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 11,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      {
        binding: 12,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 13,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });

  this.thresholdMaskBindGroupLayout = this.device.createBindGroupLayout({
    label: "Stroke alpha-threshold mask bind group layout",
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
        texture: { sampleType: "float" },
      },
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
      {
        binding: 7,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
    ],
  });
  this.indirectGateBindGroupLayout = this.device.createBindGroupLayout({
    label: "Stroke indirect dispatch gate bind group layout",
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
        buffer: { type: "storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ],
  });

  const seedModule = this.device.createShaderModule({
    label: "Stroke dual seed WGSL",
    code: seedShader(),
  });
  const jfaModule = this.device.createShaderModule({
    label: "Stroke packed dual JFA WGSL",
    code: jfaShader(),
  });
  const resolveModule = this.device.createShaderModule({
    label: "Stroke Q10.6 to packed f16 coverage WGSL",
    code: resolveShader(),
  });
  const composeModule = this.device.createShaderModule({
    label: "Stroke styled logical mip 1 compose WGSL",
    code: coarseComposeShader(
      this.layerFormat,
      this.bevelBoundingFieldEnabled,
      this.bevelBoundingFieldTestMutation,
    ),
  });
  // Compiled for every renderer: the application uses it for inactive-layer
  // bakes, while readbackEnabled only controls the golden-owned target texture.
  const readbackComposeModule = this.device.createShaderModule({
    label: "Style stack analytic logical mip 0 bake WGSL",
    code: readbackComposeShader(
      this.layerFormat,
      this.bevelBoundingFieldEnabled,
      this.bevelBoundingFieldTestMutation,
    ),
  });
  const thresholdMaskModule = this.device.createShaderModule({
    label: "Stroke alpha-threshold mask WGSL",
    code: thresholdMaskShader(),
  });
  const indirectGateModule = this.device.createShaderModule({
    label: "Stroke indirect dispatch gate WGSL",
    code: indirectGateShader(),
  });
  await assertShaderModules([
    { label: "seed", module: seedModule },
    { label: "jfa", module: jfaModule },
    { label: "resolve", module: resolveModule },
    { label: "coarse-compose", module: composeModule },
    { label: "analytic-mip0-bake", module: readbackComposeModule },
    { label: "threshold-mask", module: thresholdMaskModule },
    { label: "indirect-gate", module: indirectGateModule },
  ]);

  this.device.pushErrorScope("validation");
  const composePipelineLayout = this.device.createPipelineLayout({
    label: "Stroke styled compose pipeline layout",
    bindGroupLayouts: [this.composeBindGroupLayout],
  });
  const pipelineResults = await Promise.allSettled([
    createComputePipelineAsync(this.device, {
      label: "Stroke dual seed pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.seedBindGroupLayout],
      }),
      compute: { module: seedModule, entryPoint: "main" },
    }),
    createComputePipelineAsync(this.device, {
      label: "Stroke packed dual JFA pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.jfaBindGroupLayout],
      }),
      compute: { module: jfaModule, entryPoint: "main" },
    }),
    createComputePipelineAsync(this.device, {
      label: "Stroke packed f16 coverage resolve pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.resolveBindGroupLayout],
      }),
      compute: { module: resolveModule, entryPoint: "main" },
    }),
    createComputePipelineAsync(this.device, {
      label: "Stroke styled logical mip 1 compose pipeline",
      layout: composePipelineLayout,
      compute: { module: composeModule, entryPoint: "main" },
    }),
    createComputePipelineAsync(this.device, {
      label: "Style stack analytic logical mip 0 bake pipeline",
      layout: composePipelineLayout,
      compute: { module: readbackComposeModule, entryPoint: "main" },
    }),
    createComputePipelineAsync(this.device, {
      label: "Authored matte analytic logical mip 0 bake pipeline",
      layout: composePipelineLayout,
      compute: {
        module: readbackComposeModule,
        entryPoint: "authoredMatteMain",
      },
    }),
    createComputePipelineAsync(this.device, {
      label: "Stroke alpha-threshold mask pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.thresholdMaskBindGroupLayout],
      }),
      compute: { module: thresholdMaskModule, entryPoint: "main" },
    }),
    createComputePipelineAsync(this.device, {
      label: "Stroke indirect dispatch gate pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.indirectGateBindGroupLayout],
      }),
      compute: { module: indirectGateModule, entryPoint: "main" },
    }),
  ]);
  const validationError = await this.device.popErrorScope();
  const pipelineCreationErrors = pipelineResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (pipelineCreationErrors.length > 0 || validationError) {
    throw new AggregateError(
      [
        ...pipelineCreationErrors,
        ...(validationError ? [validationError] : []),
      ],
      "Stroke pipeline creation failed validation.",
    );
  }
  const pipelines = pipelineResults.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  [
    this.seedPipeline,
    this.jfaPipeline,
    this.resolvePipeline,
    this.composePipeline,
    this.readbackComposePipeline,
    this.authoredMatteBakePipeline,
    this.thresholdMaskPipeline,
    this.indirectGatePipeline,
  ] = pipelines;

  return {
    seedBindGroupLayout: this.seedBindGroupLayout,
    jfaBindGroupLayout: this.jfaBindGroupLayout,
    resolveBindGroupLayout: this.resolveBindGroupLayout,
    composeBindGroupLayout: this.composeBindGroupLayout,
    thresholdMaskBindGroupLayout: this.thresholdMaskBindGroupLayout,
    indirectGateBindGroupLayout: this.indirectGateBindGroupLayout,
    seedPipeline: this.seedPipeline,
    jfaPipeline: this.jfaPipeline,
    resolvePipeline: this.resolvePipeline,
    composePipeline: this.composePipeline,
    readbackComposePipeline: this.readbackComposePipeline!,
    authoredMatteBakePipeline: this.authoredMatteBakePipeline!,
    thresholdMaskPipeline: this.thresholdMaskPipeline,
    indirectGatePipeline: this.indirectGatePipeline,
  };
}

export function acquireRasterStrokeProgramResources(
  options: RasterStrokeProgramWarmupOptions,
): Promise<RasterStrokeProgramResources> {
  return acquireStrokeProgramResources(
    options.device,
    strokeProgramCacheKey(options),
    () =>
      createStrokeProgramResources.call(
        strokeProgramCompilationContext(options),
      ),
  );
}

/**
 * Warms the Stroke program cache shared by every renderer on one device/format
 * pair without creating textures, buffers or document-sized bind groups.
 */
export async function prewarmRasterStrokePrograms(
  options: RasterStrokeProgramWarmupOptions,
): Promise<void> {
  await acquireRasterStrokeProgramResources(options);
}
