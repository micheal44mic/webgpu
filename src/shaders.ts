import { mergedSurfaceSamplingShader } from "./merged-surface-shader";
import { activeClippingGroupTexelShader } from "./clipping-group-shader";
import {
  SHAPE_MASK_FILTER_CONTENT_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
  SHAPE_MASK_FILTER_UV_HALF_EXTENT,
} from "./engine-limits";

export const brushShader = /* wgsl */ `
const MAX_COUNT: u32 = 24u;
const COPY_COUNT_MASK: u32 = 0xffu;
const SYMMETRY_MODE_SHIFT: u32 = 8u;
const DIAGNOSTIC_8_BIT_FLAG: u32 = 2u;
const TAU: f32 = 6.283185307179586;
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;
const SHAPE_MASK_UV_HALF_EXTENT: f32 = ${SHAPE_MASK_FILTER_UV_HALF_EXTENT};

struct BrushUniforms {
  layerSize: vec2<f32>,
  renderTargetOrigin: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  positionJitter: vec4<f32>,
  options: vec4<u32>,
  documentSize: vec2<f32>,
  _documentPadding: vec2<f32>,
};

struct Stamp {
  center: vec2<f32>,
  radius: f32,
  pressure: f32,
  seed: u32,
  shapeLayer: u32,
  direction: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pointColor: vec3<f32>,
  @location(2) localBrushPixels: vec2<f32>,
  @location(3) @interpolate(flat) shapeLayer: u32,
};

struct ShapeOccupancy {
  words: array<vec4<u32>, 512>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(2) var shapeMaskTexture: texture_2d_array<f32>;
@group(0) @binding(3) var shapeMaskSampler: sampler;
@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;

fn hash32(value: u32) -> u32 {
  var x = value;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

fn random01(seed: u32, salt: u32) -> f32 {
  let bits = hash32(seed ^ (salt * 0x9e3779b9u)) & 0x00ffffffu;
  return f32(bits) / 16777216.0;
}

fn hueToRgb(p: f32, q: f32, inputT: f32) -> f32 {
  let t = fract(inputT);
  if (t < 1.0 / 6.0) {
    return p + (q - p) * 6.0 * t;
  }
  if (t < 1.0 / 2.0) {
    return q;
  }
  if (t < 2.0 / 3.0) {
    return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  }
  return p;
}

fn hslToSrgb(hsl: vec3<f32>) -> vec3<f32> {
  let h = fract(hsl.x);
  let s = clamp(hsl.y, 0.0, 1.0);
  let l = clamp(hsl.z, 0.0, 1.0);

  if (s <= 0.00001) {
    return vec3<f32>(l);
  }

  let q = select(l * (1.0 + s), l + s - l * s, l >= 0.5);
  let p = 2.0 * l - q;
  return vec3<f32>(
    hueToRgb(p, q, h + 1.0 / 3.0),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1.0 / 3.0)
  );
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

fn sourcePrecisionCoverage(value: f32) -> f32 {
  let continuous = clamp(value, 0.0, 1.0);
  return select(
    continuous,
    round(continuous * 255.0) / 255.0,
    (brush.options.z & DIAGNOSTIC_8_BIT_FLAG) != 0u
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

fn jitteredLinearColorFromCopySeed(copySeed: u32) -> vec3<f32> {
  let hueDelta = (random01(copySeed, 1u) - 0.5) * 2.0 * brush.jitter.x;
  let saturationDelta = (random01(copySeed, 2u) - 0.5) * 2.0 * brush.jitter.y;
  let lightnessDelta = (random01(copySeed, 3u) - 0.5) * 2.0 * brush.jitter.z;
  let darkness = random01(copySeed, 4u) * brush.jitter.w;

  let hue = fract(brush.baseHslAlpha.x + hueDelta);
  let saturation = clamp(brush.baseHslAlpha.y + saturationDelta, 0.0, 1.0);
  let lightnessBeforeDarkness = clamp(brush.baseHslAlpha.z + lightnessDelta, 0.0, 1.0);
  let lightness = clamp(lightnessBeforeDarkness * (1.0 - darkness), 0.0, 1.0);

  return srgbToLinear(hslToSrgb(vec3<f32>(hue, saturation, lightness)));
}

fn reflectedLayerPosition(
  layerPosition: vec2<f32>,
  symmetryMode: u32,
  symmetryCopyIndex: u32
) -> vec2<f32> {
  if (symmetryCopyIndex == 0u || symmetryMode == 0u) {
    return layerPosition;
  }
  let documentCenter = brush.documentSize * 0.5;
  let offset = layerPosition - documentCenter;
  let cosineDoubleAngle = brush.controls.w;
  let sineDoubleAngle = brush.positionJitter.w;
  return documentCenter + vec2<f32>(
    cosineDoubleAngle * offset.x + sineDoubleAngle * offset.y,
    sineDoubleAngle * offset.x - cosineDoubleAngle * offset.y
  );
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let copyCount = max(1u, min(brush.options.x & COPY_COUNT_MASK, MAX_COUNT));
  let symmetryMode = brush.options.x >> SYMMETRY_MODE_SHIFT;
  let symmetryCopyCount = select(1u, 2u, symmetryMode != 0u);
  let copiesPerStamp = copyCount * symmetryCopyCount;
  let stampIndex = instanceIndex / copiesPerStamp;
  let copyWithinStamp = instanceIndex % copiesPerStamp;
  let copyIndex = copyWithinStamp / symmetryCopyCount;
  let symmetryCopyIndex = copyWithinStamp % symmetryCopyCount;
  let stamp = stamps[stampIndex];
  let localPosition = corners[vertexIndex];
  let directionLength = length(stamp.direction);
  let direction = select(vec2<f32>(1.0, 0.0), stamp.direction / directionLength, directionLength > 0.0001);
  let copySeed = hash32(stamp.seed ^ (copyIndex * 0x85ebca6bu));
  let linearOffset = (random01(copySeed, 5u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.x;
  let lateralOffset = (random01(copySeed, 6u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.y;
  let jitteredCenter = stamp.center
    + direction * linearOffset
    + vec2<f32>(-direction.y, direction.x) * lateralOffset;
  let layerPosition = reflectedLayerPosition(
    jitteredCenter + localPosition * stamp.radius,
    symmetryMode,
    symmetryCopyIndex
  );
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.localBrushPixels = localPosition * stamp.radius;
  output.shapeLayer = 0u;
  var colorCopySeed = copySeed;
  if (brush.options.y == 0u) {
    colorCopySeed = hash32(stamp.seed);
  }
  output.pointColor = jitteredLinearColorFromCopySeed(colorCopySeed);
  return output;
}

@vertex
fn shapeVertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let copyCount = max(1u, min(brush.options.x & COPY_COUNT_MASK, MAX_COUNT));
  let symmetryMode = brush.options.x >> SYMMETRY_MODE_SHIFT;
  let symmetryCopyCount = select(1u, 2u, symmetryMode != 0u);
  let copiesPerStamp = copyCount * symmetryCopyCount;
  let stampIndex = instanceIndex / copiesPerStamp;
  let copyWithinStamp = instanceIndex % copiesPerStamp;
  let copyIndex = copyWithinStamp / symmetryCopyCount;
  let symmetryCopyIndex = copyWithinStamp % symmetryCopyCount;
  let stamp = stamps[stampIndex];
  let localPosition = corners[vertexIndex];
  let directionLength = length(stamp.direction);
  let direction = select(vec2<f32>(1.0, 0.0), stamp.direction / directionLength, directionLength > 0.0001);
  let copySeed = hash32(stamp.seed ^ (copyIndex * 0x85ebca6bu));
  let linearOffset = (random01(copySeed, 5u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.x;
  let lateralOffset = (random01(copySeed, 6u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.y;
  let jitteredCenter = stamp.center
    + direction * linearOffset
    + vec2<f32>(-direction.y, direction.x) * lateralOffset;

  var geometryPosition = localPosition;
  let scatter = clamp(brush.positionJitter.z, 0.0, 1.0);
  let followAngle = select(0.0, atan2(direction.y, direction.x), brush.options.w == 1u);
  if (scatter > 0.00001 || brush.options.w == 1u) {
    let angle = followAngle + (random01(copySeed, 7u) - 0.5) * TAU * scatter;
    let cosine = cos(angle);
    let sine = sin(angle);
    geometryPosition = vec2<f32>(
      localPosition.x * cosine - localPosition.y * sine,
      localPosition.x * sine + localPosition.y * cosine
    );
  }

  let layerPosition = reflectedLayerPosition(
    jitteredCenter + geometryPosition * stamp.radius,
    symmetryMode,
    symmetryCopyIndex
  );
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.localBrushPixels = localPosition * stamp.radius;
  output.shapeLayer = stamp.shapeLayer;
  var colorCopySeed = copySeed;
  if (brush.options.y == 0u) {
    colorCopySeed = hash32(stamp.seed);
  }
  output.pointColor = jitteredLinearColorFromCopySeed(colorCopySeed);
  return output;
}

fn paintAlpha(input: VertexOutput, coverage: f32) -> f32 {
  return clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * brush.controls.z,
    0.0,
    0.999999
  );
}

fn premultipliedPaint(input: VertexOutput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(input.pointColor * alpha, alpha);
}

fn premultipliedEncodedSrgbPaint(input: VertexOutput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(linearToSrgb(input.pointColor) * alpha, alpha);
}

fn highPrecisionCoveragePaint(input: VertexOutput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  // Light Glaze stores continuous MAX/no-build-up coverage in an r16float
  // attachment. The vec4 output keeps this entry point valid for WGSL; the
  // render target persists only its red component at half-float precision.
  return vec4<f32>(alpha);
}

fn circleCoverage(input: VertexOutput) -> f32 {
  let radiusSquared = dot(input.localPosition, input.localPosition);
  let antialiasWidth = max(fwidth(radiusSquared), 0.00001);

  if (radiusSquared > 1.0 + antialiasWidth) {
    discard;
  }

  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let innerEdge = min(hardness * hardness, 1.0 - antialiasWidth);
  let coverage = sourcePrecisionCoverage(
    1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared)
  );

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

fn shapeCoverage(input: VertexOutput) -> f32 {
  let uv = input.localPosition * SHAPE_MASK_UV_HALF_EXTENT + vec2<f32>(0.5);
  let sourceCoverage = sourcePrecisionCoverage(
    textureSample(shapeMaskTexture, shapeMaskSampler, uv, i32(input.shapeLayer)).r
  );
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, circleCoverage(input));
}

@fragment
fn encodedSrgbFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedEncodedSrgbPaint(input, circleCoverage(input));
}

@fragment
fn coverageFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return highPrecisionCoveragePaint(input, circleCoverage(input));
}

@fragment
fn shapeFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, shapeCoverage(input));
}

@fragment
fn encodedSrgbShapeFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedEncodedSrgbPaint(input, shapeCoverage(input));
}

@fragment
fn shapeCoverageFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return highPrecisionCoveragePaint(input, shapeCoverage(input));
}

fn shapeOccupancyMayContribute(uv: vec2<f32>) -> bool {
  let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.99999994));
  let cell = min(
    vec2<u32>(clampedUv * f32(SHAPE_OCCUPANCY_GRID_SIZE)),
    vec2<u32>(SHAPE_OCCUPANCY_GRID_SIZE - 1u)
  );
  let cellIndex = cell.y * SHAPE_OCCUPANCY_GRID_SIZE + cell.x;
  let wordIndex = cellIndex >> 5u;
  let packedVector = shapeOccupancy.words[wordIndex >> 2u];
  let packedWord = packedVector[wordIndex & 3u];
  return (packedWord & (1u << (cellIndex & 31u))) != 0u;
}

fn occupiedShapeCoverage(input: VertexOutput) -> f32 {
  let logicalUv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let samplingUv = input.localPosition * SHAPE_MASK_UV_HALF_EXTENT + vec2<f32>(0.5);
  let uvDx = dpdx(samplingUv);
  let uvDy = dpdy(samplingUv);

  if (!shapeOccupancyMayContribute(logicalUv)) {
    discard;
  }

  let sourceCoverage = sourcePrecisionCoverage(textureSampleGrad(
    shapeMaskTexture,
    shapeMaskSampler,
    samplingUv,
    i32(input.shapeLayer),
    uvDx,
    uvDy
  ).r);
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn shapeOccupancyFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, occupiedShapeCoverage(input));
}

@fragment
fn encodedSrgbShapeOccupancyFragmentMain(
  input: VertexOutput
) -> @location(0) vec4<f32> {
  return premultipliedEncodedSrgbPaint(input, occupiedShapeCoverage(input));
}

@fragment
fn shapeOccupancyCoverageFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return highPrecisionCoveragePaint(input, occupiedShapeCoverage(input));
}
`;

// Grain remains an opt-in fragment path. Grain Off keeps its smaller shader
// entry points and bindings; the shared precision flag is resolved only where
// a coverage value is produced.
export const texturizedGrainShader = /* wgsl */ `
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;
const SHAPE_MASK_UV_HALF_EXTENT: f32 = ${SHAPE_MASK_FILTER_UV_HALF_EXTENT};
const DIAGNOSTIC_8_BIT_FLAG: u32 = 2u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  renderTargetOrigin: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  positionJitter: vec4<f32>,
  options: vec4<u32>,
  documentSize: vec2<f32>,
  _documentPadding: vec2<f32>,
};

struct GrainUniforms {
  inversePeriod: f32,
  depth: f32,
  brightness: f32,
  contrastFactor: f32,
  filteringMode: u32,
  coordinateMode: u32,
  mipLevelCount: u32,
  movement: f32,
};

struct FragmentInput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pointColor: vec3<f32>,
  @location(2) localBrushPixels: vec2<f32>,
  @location(3) @interpolate(flat) shapeLayer: u32,
};

struct ShapeOccupancy {
  words: array<vec4<u32>, 512>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(2) var shapeMaskTexture: texture_2d_array<f32>;
@group(0) @binding(3) var shapeMaskSampler: sampler;
@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;
@group(0) @binding(5) var grainTexture: texture_2d<f32>;
@group(0) @binding(6) var grainSampler: sampler;
@group(0) @binding(7) var<uniform> grain: GrainUniforms;

fn sourcePrecisionCoverage(value: f32) -> f32 {
  let continuous = clamp(value, 0.0, 1.0);
  return select(
    continuous,
    round(continuous * 255.0) / 255.0,
    (brush.options.z & DIAGNOSTIC_8_BIT_FLAG) != 0u
  );
}

fn adjustedGrainCoverage(
  grainUv: vec2<f32>,
  grainUvDx: vec2<f32>,
  grainUvDy: vec2<f32>
) -> f32 {
  var sourceSample: vec4<f32>;
  if (grain.filteringMode == 0u) {
    let baseDimensions = vec2<f32>(textureDimensions(grainTexture, 0));
    let footprint = max(
      length(grainUvDx * baseDimensions),
      length(grainUvDy * baseDimensions)
    );
    let mipLevel = u32(clamp(
      round(log2(max(footprint, 1.0))),
      0.0,
      f32(max(1u, grain.mipLevelCount) - 1u)
    ));
    // The No sampler uses nearest min/mag. Its mip filter is declared linear
    // only so it remains compatible with the shared filtering binding; an
    // exact integer LOD makes the effective mip choice nearest as well.
    sourceSample = textureSampleLevel(
      grainTexture,
      grainSampler,
      grainUv,
      f32(mipLevel)
    );
  } else {
    sourceSample = textureSampleGrad(
      grainTexture,
      grainSampler,
      grainUv,
      grainUvDx,
      grainUvDy
    );
  }
  // The Grain asset's RGB luma was already calculated during loading with
  // the same 0.299/0.587/0.114 weights and stored in a scalar channel. The
  // sampled value is identical to the previous per-fragment dot(rgb) result,
  // without carrying three unused channels.
  // The source image alpha does not modulate the paint, as before.
  let source = sourcePrecisionCoverage(sourceSample.r);
  let adjusted = clamp(
    (source - 0.5) * grain.contrastFactor + 0.5 + grain.brightness,
    0.0,
    1.0
  );
  return mix(1.0, adjusted, clamp(grain.depth, 0.0, 1.0));
}

fn selectedGrainUv(input: FragmentInput) -> vec2<f32> {
  if (grain.coordinateMode != 0u) {
    // Moving starts with a texture patch dragged in stamp-local *pixel* space.
    // Scale therefore controls the patch at every Movement value. Advancing
    // Movement rolls that same-frequency patch into authoritative layer space;
    // 100% converges exactly to Texturized instead of mixing incompatible UVs.
    let movement = clamp(grain.movement, 0.0, 1.0);
    let movingUv = input.localBrushPixels * grain.inversePeriod + vec2<f32>(0.5);
    let fixedUv = (input.position.xy + brush.renderTargetOrigin) * grain.inversePeriod;
    return mix(movingUv, fixedUv, movement);
  }
  // Fixed/Texturized is paper grain in authoritative layer coordinates.
  return (input.position.xy + brush.renderTargetOrigin) * grain.inversePeriod;
}

fn shapeOccupancyMayContribute(uv: vec2<f32>) -> bool {
  let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(0.99999994));
  let cell = min(
    vec2<u32>(clampedUv * f32(SHAPE_OCCUPANCY_GRID_SIZE)),
    vec2<u32>(SHAPE_OCCUPANCY_GRID_SIZE - 1u)
  );
  let cellIndex = cell.y * SHAPE_OCCUPANCY_GRID_SIZE + cell.x;
  let wordIndex = cellIndex >> 5u;
  let packedVector = shapeOccupancy.words[wordIndex >> 2u];
  let packedWord = packedVector[wordIndex & 3u];
  return (packedWord & (1u << (cellIndex & 31u))) != 0u;
}

fn paintAlpha(input: FragmentInput, coverage: f32) -> f32 {
  return clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * brush.controls.z,
    0.0,
    0.999999
  );
}

fn premultipliedPaint(input: FragmentInput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(input.pointColor * alpha, alpha);
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

fn premultipliedEncodedSrgbPaint(input: FragmentInput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(linearToSrgb(input.pointColor) * alpha, alpha);
}

fn highPrecisionCoveragePaint(input: FragmentInput, coverage: f32) -> vec4<f32> {
  let alpha = paintAlpha(input, coverage);
  return vec4<f32>(alpha);
}

fn circleGrainCoverage(input: FragmentInput) -> f32 {
  let grainUv = selectedGrainUv(input);
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  let radiusSquared = dot(input.localPosition, input.localPosition);
  let antialiasWidth = max(fwidth(radiusSquared), 0.00001);

  if (radiusSquared > 1.0 + antialiasWidth) {
    discard;
  }

  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  let innerEdge = min(hardness * hardness, 1.0 - antialiasWidth);
  var coverage = sourcePrecisionCoverage(
    1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared)
  );

  if (coverage <= 0.0) {
    discard;
  }

  coverage *= adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn fragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, circleGrainCoverage(input));
}

@fragment
fn encodedSrgbFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedEncodedSrgbPaint(input, circleGrainCoverage(input));
}

@fragment
fn coverageFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return highPrecisionCoveragePaint(input, circleGrainCoverage(input));
}

fn shapeGrainCoverage(input: FragmentInput) -> f32 {
  let grainUv = selectedGrainUv(input);
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  let uv = input.localPosition * SHAPE_MASK_UV_HALF_EXTENT + vec2<f32>(0.5);
  let sourceCoverage = sourcePrecisionCoverage(
    textureSample(shapeMaskTexture, shapeMaskSampler, uv, i32(input.shapeLayer)).r
  );
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  var coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }

  coverage *= adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn shapeFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, shapeGrainCoverage(input));
}

@fragment
fn encodedSrgbShapeFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedEncodedSrgbPaint(input, shapeGrainCoverage(input));
}

@fragment
fn shapeCoverageFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return highPrecisionCoveragePaint(input, shapeGrainCoverage(input));
}

fn occupiedShapeGrainCoverage(input: FragmentInput) -> f32 {
  let grainUv = selectedGrainUv(input);
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  let logicalUv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let samplingUv = input.localPosition * SHAPE_MASK_UV_HALF_EXTENT + vec2<f32>(0.5);
  let uvDx = dpdx(samplingUv);
  let uvDy = dpdy(samplingUv);

  if (!shapeOccupancyMayContribute(logicalUv)) {
    discard;
  }

  let sourceCoverage = sourcePrecisionCoverage(textureSampleGrad(
    shapeMaskTexture,
    shapeMaskSampler,
    samplingUv,
    i32(input.shapeLayer),
    uvDx,
    uvDy
  ).r);
  let hardness = clamp(brush.controls.y, 0.0, 1.0);
  var coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);

  if (coverage <= 0.0) {
    discard;
  }

  coverage *= adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

@fragment
fn shapeOccupancyFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return premultipliedPaint(input, occupiedShapeGrainCoverage(input));
}

@fragment
fn encodedSrgbShapeOccupancyFragmentMain(
  input: FragmentInput
) -> @location(0) vec4<f32> {
  return premultipliedEncodedSrgbPaint(input, occupiedShapeGrainCoverage(input));
}

@fragment
fn shapeOccupancyCoverageFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return highPrecisionCoveragePaint(input, occupiedShapeGrainCoverage(input));
}
`;

// Runtime mip generation for the scalar Grain texture. Each pass samples the
// immediately preceding mip with a linear clamp sampler and writes the next
// level. This keeps asset preparation on WebGPU/WGSL and handles the native
// source dimensions directly without an intermediate resample.
/** Converts native unsigned 16-bit scalar samples to the resident R16F field. */
export const grainLumaShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<u32>;

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
  let sample = textureLoad(sourceTexture, vec2<i32>(fragmentPosition.xy), 0).r;
  return vec4<f32>(f32(sample) / 65535.0, 0.0, 0.0, 1.0);
}
`;

/**
 * Reconstructs native unsigned 16-bit samples into the guarded R16F frame.
 * The diagnostic 8-bit entry point quantizes source texels before the same
 * bilinear reconstruction; guard geometry and every later R16F mip stay equal.
 */
export const shapeR16FloatBaseShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

const GUARD_TEXELS: f32 = ${SHAPE_MASK_FILTER_GUARD_TEXELS};
const CONTENT_SIZE: f32 = ${SHAPE_MASK_FILTER_CONTENT_SIZE};

@group(0) @binding(0) var sourceTexture: texture_2d<u32>;

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

fn sourceCoverage(coordinate: vec2<i32>, quantizeTo8Bit: bool) -> f32 {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let clamped = clamp(coordinate, vec2<i32>(0), dimensions - vec2<i32>(1));
  let normalized = f32(textureLoad(sourceTexture, clamped, 0).r) / 65535.0;
  return select(normalized, round(normalized * 255.0) / 255.0, quantizeTo8Bit);
}

fn reconstructedCoverage(fragmentPosition: vec4<f32>, quantizeTo8Bit: bool) -> f32 {
  let innerPosition = fragmentPosition.xy - vec2<f32>(GUARD_TEXELS);
  if (
    any(innerPosition < vec2<f32>(0.0))
    || any(innerPosition >= vec2<f32>(CONTENT_SIZE))
  ) {
    return 0.0;
  }
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let sourcePosition = innerPosition * dimensions / vec2<f32>(CONTENT_SIZE) - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(sourcePosition));
  let fraction = fract(sourcePosition);
  let top = mix(
    sourceCoverage(lower, quantizeTo8Bit),
    sourceCoverage(lower + vec2<i32>(1, 0), quantizeTo8Bit),
    fraction.x
  );
  let bottom = mix(
    sourceCoverage(lower + vec2<i32>(0, 1), quantizeTo8Bit),
    sourceCoverage(lower + vec2<i32>(1, 1), quantizeTo8Bit),
    fraction.x
  );
  return mix(top, bottom, fraction.y);
}

@fragment
fn fragmentMain16(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let coverage = reconstructedCoverage(fragmentPosition, false);
  return vec4<f32>(coverage, 0.0, 0.0, 1.0);
}

@fragment
fn fragmentMain8(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let coverage = reconstructedCoverage(fragmentPosition, true);
  return vec4<f32>(coverage, 0.0, 0.0, 1.0);
}
`;

export const grainMipShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;

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
  let sourceDimensions = vec2<u32>(textureDimensions(sourceTexture, 0));
  let targetDimensions = max(sourceDimensions / 2u, vec2<u32>(1u));
  let uv = fragmentPosition.xy / vec2<f32>(targetDimensions);
  return textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
}
`;

// Minimal presentation path for one authoritative RGBA16F raster surface.
// Bindings intentionally retain the matching slots from the full display ABI
// so this shader can reuse that bind group without compiling its composite
// surface graph. The render pipeline continues to own the canvas target format.
export const singleRasterRgba16FloatDisplayShader = /* wgsl */ `
struct SingleRasterDisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  _reservedSurface0: f32,
  _reservedSurface1: f32,
  rasterAlpha: f32,
  _reservedOrigin0: vec2<f32>,
  _reservedOrigin1: vec2<f32>,
  _reservedComposition0: f32,
  _reservedComposition1: f32,
  _reservedComposition2: f32,
  _reservedComposition3: f32,
  _reservedCompositionOrigin0: vec2<f32>,
  _reservedCompositionOrigin1: vec2<f32>,
  backgroundColor: vec4<f32>,
};

struct SingleRasterVertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: SingleRasterDisplayUniforms;
@group(0) @binding(1) var rasterMipZero: texture_2d<f32>;
@group(0) @binding(2) var rasterMipPyramid: texture_2d<f32>;
@group(0) @binding(5) var rasterSampler: sampler;

const SINGLE_RASTER_PIXEL_VIEW_ZOOM_THRESHOLD: f32 = 5.81;

fn singleRasterPixelViewEnabled() -> bool {
  return display.zoom >= SINGLE_RASTER_PIXEL_VIEW_ZOOM_THRESHOLD;
}

fn singleRasterPixelViewTexel(
  uv: vec2<f32>,
  dimensions: vec2<i32>
) -> vec2<i32> {
  return clamp(
    vec2<i32>(floor(uv * vec2<f32>(dimensions))),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
}

fn singleRasterSrgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn singleRasterSrgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    singleRasterSrgbToLinearChannel(value.r),
    singleRasterSrgbToLinearChannel(value.g),
    singleRasterSrgbToLinearChannel(value.b)
  );
}

fn singleRasterLinearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn singleRasterLinearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    singleRasterLinearToSrgbChannel(value.r),
    singleRasterLinearToSrgbChannel(value.g),
    singleRasterLinearToSrgbChannel(value.b)
  );
}

fn sampleSingleRasterMipZero(uv: vec2<f32>) -> vec4<f32> {
  if (singleRasterPixelViewEnabled()) {
    return textureLoad(
      rasterMipZero,
      singleRasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(rasterMipZero, 0))
      ),
      0
    );
  }
  return textureSampleLevel(rasterMipZero, rasterSampler, uv, 0.0);
}

fn sampleSingleRasterLogicalMip(
  uv: vec2<f32>,
  logicalMip: f32
) -> vec4<f32> {
  if (logicalMip < 0.5) {
    return sampleSingleRasterMipZero(uv);
  }
  return textureSampleLevel(
    rasterMipPyramid,
    rasterSampler,
    uv,
    logicalMip - 1.0
  );
}

fn sampleSingleRaster(uv: vec2<f32>) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  let lowerMip = floor(lod);
  let upperMip = ceil(lod);
  if (upperMip <= lowerMip) {
    return sampleSingleRasterLogicalMip(uv, lowerMip);
  }
  return mix(
    sampleSingleRasterLogicalMip(uv, lowerMip),
    sampleSingleRasterLogicalMip(uv, upperMip),
    lod - lowerMip
  );
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32
) -> SingleRasterVertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: SingleRasterVertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let singleRasterDisplayOffset =
    (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let rasterOffset = vec2<f32>(
    display.viewRotation.x * singleRasterDisplayOffset.x
      + display.viewRotation.y * singleRasterDisplayOffset.y,
    -display.viewRotation.y * singleRasterDisplayOffset.x
      + display.viewRotation.x * singleRasterDisplayOffset.y
  );
  let rasterPosition = display.viewCenter + rasterOffset;
  let rasterSize = vec2<f32>(textureDimensions(rasterMipZero, 0));
  let insideRaster = all(rasterPosition >= vec2<f32>(0.0))
    && all(rasterPosition < rasterSize);
  if (!insideRaster) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let uv = clamp(
    rasterPosition / rasterSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let paint = sampleSingleRaster(uv) * display.rasterAlpha;
  let checkerCell = vec2<i32>(floor(rasterPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let checkerSrgb = select(
    vec3<f32>(0.82),
    vec3<f32>(0.91),
    checkerParity == 0
  );
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = singleRasterSrgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(singleRasterLinearToSrgb(compositedLinear), 1.0);
}
`;

export const displayShader = /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var activeLayerBase: texture_2d<f32>;
@group(0) @binding(2) var activeLayerPyramid: texture_2d<f32>;
@group(0) @binding(3) var mergedBelowTexture: texture_2d<f32>;
@group(0) @binding(4) var mergedAboveTexture: texture_2d<f32>;
@group(0) @binding(5) var layerSampler: sampler;
@group(0) @binding(6) var activeClippingPrefix: texture_2d<f32>;
@group(0) @binding(7) var activeClippingSuffix: texture_2d<f32>;

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

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}

${activeClippingGroupTexelShader}

fn sampleActiveLayerMipZero(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(activeLayerBase, 0));
  if (rasterPixelViewEnabled(1.0)) {
    let pixel = rasterPixelViewTexel(uv, dimensions);
    let activeTexel = textureLoad(activeLayerBase, pixel, 0);
    if (display.clippingMode < 0.5) {
      return activeTexel;
    }
    return composeActiveClippingGroupTexel(activeTexel, pixel);
  }
  if (display.clippingMode < 0.5) {
    return textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0);
  }

  // Mip 0 lives in a separate texture and clipping composition is nonlinear.
  // Compose each source texel first, then reproduce bilinear filtering.
  let texelPosition = uv * vec2<f32>(dimensions) - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let maximum = dimensions - vec2<i32>(1);
  let p00i = clamp(lower, vec2<i32>(0), maximum);
  let p10i = clamp(lower + vec2<i32>(1, 0), vec2<i32>(0), maximum);
  let p01i = clamp(lower + vec2<i32>(0, 1), vec2<i32>(0), maximum);
  let p11i = clamp(lower + vec2<i32>(1, 1), vec2<i32>(0), maximum);
  let p00 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p00i, 0), p00i);
  let p10 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p10i, 0), p10i);
  let p01 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p01i, 0), p01i);
  let p11 = composeActiveClippingGroupTexel(textureLoad(activeLayerBase, p11i, 0), p11i);
  return mix(
    mix(p00, p10, interpolation.x),
    mix(p01, p11, interpolation.x),
    interpolation.y
  );
}

fn sampleActiveLayerLogicalMip(uv: vec2<f32>, logicalMip: f32) -> vec4<f32> {
  if (logicalMip < 0.5) {
    return sampleActiveLayerMipZero(uv);
  }
  return textureSampleLevel(
    activeLayerPyramid,
    layerSampler,
    uv,
    logicalMip - 1.0
  );
}

fn sampleActiveLayer(uv: vec2<f32>) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  let lowerMip = floor(lod);
  let upperMip = ceil(lod);
  var sampled: vec4<f32>;
  if (upperMip <= lowerMip) {
    sampled = sampleActiveLayerLogicalMip(uv, lowerMip);
  } else {
    let interpolation = lod - lowerMip;
    sampled = mix(
      sampleActiveLayerLogicalMip(uv, lowerMip),
      sampleActiveLayerLogicalMip(uv, upperMip),
      interpolation
    );
  }
  return sampled;
}

${mergedSurfaceSamplingShader}
fn composeLayerStackSamples(
  activePaint: vec4<f32>,
  belowPaint: vec4<f32>,
  abovePaint: vec4<f32>
) -> vec4<f32> {
  var paint = belowPaint;
  let activeContribution = select(
    activePaint,
    activePaint * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
  paint = sourceOver(activeContribution, paint);
  paint = sourceOver(abovePaint, paint);
  return paint;
}

fn loadActiveDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let activeTexel = textureLoad(activeLayerBase, documentPixel, 0);
  if (display.clippingMode < 0.5) {
    return activeTexel;
  }
  return composeActiveClippingGroupTexel(activeTexel, documentPixel);
}

fn loadMergedBelowDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedBelow < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedBelowOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedBelowTexture, 0));
  let inside = all(localPixel >= vec2<i32>(0)) && all(localPixel < dimensions);
  if (!inside) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedBelowTexture, localPixel, 0);
}

fn loadMergedAboveDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedAbove < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedAboveOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedAboveTexture, 0));
  let inside = all(localPixel >= vec2<i32>(0)) && all(localPixel < dimensions);
  if (!inside) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedAboveTexture, localPixel, 0);
}

fn compositedLayerStackTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(activeLayerBase, 0));
  let pixel = clamp(documentPixel, vec2<i32>(0), dimensions - vec2<i32>(1));
  return composeLayerStackSamples(
    loadActiveDocumentTexel(pixel),
    loadMergedBelowDocumentTexel(pixel),
    loadMergedAboveDocumentTexel(pixel)
  );
}

// Hardware bilinear filtering is linear, but source-over is not: filtering
// coincident layer edges independently lets the covered lower color leak into
// the transition. Compose the four document texels first, then interpolate the
// final premultiplied results. This is used only where any participating
// stack surface has an alpha gradient.
fn sampleCompositedLayerStackLinear(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = compositedLayerStackTexel(lower);
  let p10 = compositedLayerStackTexel(lower + vec2<i32>(1, 0));
  let p01 = compositedLayerStackTexel(lower + vec2<i32>(0, 1));
  let p11 = compositedLayerStackTexel(lower + vec2<i32>(1, 1));
  return mix(
    mix(p00, p10, interpolation.x),
    mix(p01, p11, interpolation.x),
    interpolation.y
  );
}

fn mergedSurfacesUseDocumentResolution() -> bool {
  return display.hasMergedBelow <= 1.0001
    && display.hasMergedAbove <= 1.0001;
}

fn jointLayerFilteringCandidate() -> bool {
  let lodZeroSmooth = display.selectedMipLevel < 0.000001
    && !rasterPixelViewEnabled(1.0);
  let activePresent = display.activeLayerAlpha > 0.0;
  let belowPresent = display.hasMergedBelow > 0.5;
  let abovePresent = display.hasMergedAbove > 0.5;
  let multipleSurfaces = (activePresent && (belowPresent || abovePresent))
    || (belowPresent && abovePresent);
  return lodZeroSmooth
    && mergedSurfacesUseDocumentResolution()
    && (multipleSurfaces || display.clippingMode > 0.5);
}

fn needsJointLayerFiltering(stackAlphaGradient: f32) -> bool {
  return jointLayerFilteringCandidate()
    && (display.clippingMode > 0.5 || stackAlphaGradient > 0.00001);
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
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  let uv = clamp(layerPosition / layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  let jointFilteringCandidate = jointLayerFilteringCandidate();
  var activePaint = vec4<f32>(0.0);
  var belowPaint = vec4<f32>(0.0);
  var abovePaint = vec4<f32>(0.0);
  var stackAlphaGradient = 0.0;
  if (jointFilteringCandidate) {
    activePaint = sampleActiveLayer(uv);
    if (display.hasMergedBelow > 0.5) {
      belowPaint = sampleMergedBelow(layerPosition);
    }
    if (display.hasMergedAbove > 0.5) {
      abovePaint = sampleMergedAbove(layerPosition);
    }
    // The candidate depends only on uniforms, so derivatives remain in
    // uniform control flow and still precede the position-dependent return.
    stackAlphaGradient = fwidth(activePaint.a)
      + fwidth(belowPaint.a)
      + fwidth(abovePaint.a);
  }

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  if (!jointFilteringCandidate) {
    activePaint = sampleActiveLayer(uv);
    if (display.hasMergedBelow > 0.5) {
      belowPaint = sampleMergedBelow(layerPosition);
    }
    if (display.hasMergedAbove > 0.5) {
      abovePaint = sampleMergedAbove(layerPosition);
    }
  }

  var paint = composeLayerStackSamples(activePaint, belowPaint, abovePaint);
  if (needsJointLayerFiltering(stackAlphaGradient)) {
    paint = sampleCompositedLayerStackLinear(layerPosition);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let checkerSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}

// Mip 1+ can store the already-composited raster stack. This entry point is
// selected only for that content mode, so the filtered result must not be
// source-over composited with the merged surfaces a second time.
@fragment
fn finalStackFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);
  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let uv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let lod = max(display.selectedMipLevel, 0.0);
  var paint: vec4<f32>;
  if (lod < 1.0) {
    var mipZero: vec4<f32>;
    if (rasterPixelViewEnabled(1.0)) {
      mipZero = compositedLayerStackTexel(
        rasterPixelViewTexel(uv, vec2<i32>(textureDimensions(activeLayerBase, 0)))
      );
    } else {
      mipZero = sampleCompositedLayerStackLinear(layerPosition);
    }
    if (lod <= 0.0) {
      paint = mipZero;
    } else {
      let mipOne = textureSampleLevel(activeLayerPyramid, layerSampler, uv, 0.0);
      paint = mix(mipZero, mipOne, lod);
    }
  } else {
    let lowerMip = floor(lod);
    let upperMip = ceil(lod);
    if (upperMip <= lowerMip) {
      paint = textureSampleLevel(activeLayerPyramid, layerSampler, uv, lowerMip - 1.0);
    } else {
      paint = mix(
        textureSampleLevel(activeLayerPyramid, layerSampler, uv, lowerMip - 1.0),
        textureSampleLevel(activeLayerPyramid, layerSampler, uv, upperMip - 1.0),
        lod - lowerMip
      );
    }
  }
  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let checkerSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}

@fragment
fn activeFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);
  if (!insideLayer) {
    return vec4<f32>(0.0);
  }
  let uv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let sampled = sampleActiveLayer(uv);
  return select(
    sampled,
    sampled * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
}

@fragment
fn activeSourceFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  if (any(layerPosition < vec2<f32>(0.0)) || any(layerPosition >= layerSize)) {
    return vec4<f32>(0.0);
  }
  let uv = clamp(layerPosition / layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  let lod = max(display.selectedMipLevel, 0.0);
  let source = select(
    textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0),
    textureSampleLevel(activeLayerPyramid, layerSampler, uv, max(0.0, lod - 1.0)),
    lod >= 0.5,
  );
  return source * display.activeLayerAlpha;
}

@fragment
fn activeCutoutFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  if (any(layerPosition < vec2<f32>(0.0)) || any(layerPosition >= layerSize)) {
    return vec4<f32>(0.0);
  }
  let uv = clamp(layerPosition / layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  let raw = textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0);
  let opacity = select(
    display.activeLayerAlpha,
    display.clippingParentOpacity,
    display.clippingMode >= 0.5 && display.clippingMode < 1.5,
  );
  return raw * opacity;
}
`;

// Predictive thickness tails use the exact brush pipeline in a transparent,
// layer-aligned texture. This display-only variant composes that transient
// texture over the permanent paint without mutating the authoritative layer.
export const thicknessTailDisplayShader = /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
};

struct ThicknessTailUniforms {
  origin: vec2<f32>,
  textureSize: vec2<f32>,
  compositionMode: u32,
  documentMipMode: u32,
  _pad1: vec2<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var activeLayerBase: texture_2d<f32>;
@group(0) @binding(2) var layerSampler: sampler;
@group(0) @binding(3) var tailTexture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> tail: ThicknessTailUniforms;
@group(0) @binding(5) var activeLayerPyramid: texture_2d<f32>;
@group(0) @binding(6) var mergedBelowTexture: texture_2d<f32>;
@group(0) @binding(7) var mergedAboveTexture: texture_2d<f32>;
@group(0) @binding(8) var vectorTextBelowTexture: texture_2d<f32>;
@group(0) @binding(9) var vectorTextAboveTexture: texture_2d<f32>;
@group(0) @binding(10) var activeClippingPrefix: texture_2d<f32>;
@group(0) @binding(11) var activeClippingSuffix: texture_2d<f32>;

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

fn linearPremultipliedToGamma(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(linearToSrgb(straight) * alpha, alpha);
}

fn gammaPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(srgbToLinear(straight) * alpha, alpha);
}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}

${activeClippingGroupTexelShader}

fn sampleViewportTexture(
  source: texture_2d<f32>,
  fragmentPosition: vec2<f32>
) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(source, 0));
  let pixel = clamp(vec2<i32>(fragmentPosition), vec2<i32>(0), dimensions - vec2<i32>(1));
  return textureLoad(source, pixel, 0);
}

fn samplePermanentLogicalMip(uv: vec2<f32>, logicalMip: f32) -> vec4<f32> {
  if (logicalMip < 0.5) {
    if (rasterPixelViewEnabled(1.0)) {
      return textureLoad(
        activeLayerBase,
        rasterPixelViewTexel(
          uv,
          vec2<i32>(textureDimensions(activeLayerBase, 0))
        ),
        0
      );
    }
    return textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0);
  }
  return textureSampleLevel(
    activeLayerPyramid,
    layerSampler,
    uv,
    logicalMip - 1.0
  );
}

fn samplePermanentLayer(uv: vec2<f32>) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  let lowerMip = floor(lod);
  let upperMip = ceil(lod);
  if (upperMip <= lowerMip) {
    return samplePermanentLogicalMip(uv, lowerMip);
  }
  return mix(
    samplePermanentLogicalMip(uv, lowerMip),
    samplePermanentLogicalMip(uv, upperMip),
    lod - lowerMip
  );
}

fn sampleTailLayer(uv: vec2<f32>) -> vec4<f32> {
  if (rasterPixelViewEnabled(1.0)) {
    return textureLoad(
      tailTexture,
      rasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(tailTexture, 0))
      ),
      0
    );
  }
  return textureSampleLevel(tailTexture, layerSampler, uv, 0.0);
}

fn tailActiveTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let maximum = vec2<i32>(textureDimensions(activeLayerBase, 0)) - vec2<i32>(1);
  let pixel = clamp(documentPixel, vec2<i32>(0), maximum);
  let permanentPaint = textureLoad(activeLayerBase, pixel, 0);
  let local = pixel - vec2<i32>(tail.origin);
  let tailDimensions = vec2<i32>(tail.textureSize);
  if (any(local < vec2<i32>(0)) || any(local >= tailDimensions)) {
    return permanentPaint;
  }
  let transientPaint = textureLoad(tailTexture, local, 0);
  if (tail.compositionMode == 2u) {
    return transientPaint;
  }
  if (tail.compositionMode == 1u) {
    return vec4<f32>(
      permanentPaint.rgb + transientPaint.rgb,
      transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
    );
  }
  return transientPaint + permanentPaint * (1.0 - transientPaint.a);
}

fn sampleTailClippingGroupLinear(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p10i = lower + vec2<i32>(1, 0);
  let p01i = lower + vec2<i32>(0, 1);
  let p11i = lower + vec2<i32>(1, 1);
  let p00 = composeActiveClippingGroupTexel(tailActiveTexel(lower), lower);
  let p10 = composeActiveClippingGroupTexel(tailActiveTexel(p10i), p10i);
  let p01 = composeActiveClippingGroupTexel(tailActiveTexel(p01i), p01i);
  let p11 = composeActiveClippingGroupTexel(tailActiveTexel(p11i), p11i);
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
}

fn sampleTailActiveMipZero(
  layerPosition: vec2<f32>,
  layerUv: vec2<f32>
) -> vec4<f32> {
  let permanentPaint = samplePermanentLogicalMip(layerUv, 0.0);
  let tailPosition = layerPosition - tail.origin;
  let insideTail = all(tailPosition >= vec2<f32>(0.0))
    && all(tailPosition < tail.textureSize);
  if (!insideTail) {
    return permanentPaint;
  }
  let tailUv = clamp(
    tailPosition / tail.textureSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let transientPaint = sampleTailLayer(tailUv);
  if (tail.compositionMode == 2u) {
    return transientPaint;
  }
  if (tail.compositionMode == 1u) {
    return vec4<f32>(
      permanentPaint.rgb + transientPaint.rgb,
      transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
    );
  }
  return transientPaint + permanentPaint * (1.0 - transientPaint.a);
}

fn sampleTailDisplayActive(
  layerPosition: vec2<f32>,
  layerUv: vec2<f32>
) -> vec4<f32> {
  let mipZero = sampleTailActiveMipZero(layerPosition, layerUv);
  let lod = max(display.selectedMipLevel, 0.0);
  if (tail.documentMipMode == 0u || lod <= 0.000001) {
    return mipZero;
  }
  if (lod < 1.0) {
    return mix(mipZero, samplePermanentLogicalMip(layerUv, 1.0), lod);
  }
  return samplePermanentLayer(layerUv);
}

fn sampleTailDisplayClippingGroup(
  layerPosition: vec2<f32>,
  layerUv: vec2<f32>
) -> vec4<f32> {
  var mipZero = sampleTailClippingGroupLinear(layerPosition);
  if (rasterPixelViewEnabled(1.0)) {
    let pixel = vec2<i32>(floor(layerPosition));
    mipZero = composeActiveClippingGroupTexel(tailActiveTexel(pixel), pixel);
  }
  let lod = max(display.selectedMipLevel, 0.0);
  if (tail.documentMipMode == 0u || lod <= 0.000001) {
    return mipZero;
  }
  if (lod < 1.0) {
    return mix(mipZero, samplePermanentLogicalMip(layerUv, 1.0), lod);
  }
  return samplePermanentLayer(layerUv);
}

fn loadTailMergedBelowDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedBelow < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedBelowOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedBelowTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedBelowTexture, localPixel, 0);
}

fn loadTailMergedAboveDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedAbove < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedAboveOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedAboveTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedAboveTexture, localPixel, 0);
}

fn tailFinalStackDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(activeLayerBase, 0));
  let pixel = clamp(documentPixel, vec2<i32>(0), dimensions - vec2<i32>(1));
  var paint = loadTailMergedBelowDocumentTexel(pixel);
  paint = sourceOver(
    composeActiveClippingGroupTexel(tailActiveTexel(pixel), pixel),
    paint
  );
  return sourceOver(loadTailMergedAboveDocumentTexel(pixel), paint);
}

fn sampleTailFinalStackMipZero(layerPosition: vec2<f32>) -> vec4<f32> {
  if (rasterPixelViewEnabled(1.0)) {
    return tailFinalStackDocumentTexel(vec2<i32>(floor(layerPosition)));
  }
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = tailFinalStackDocumentTexel(lower);
  let p10 = tailFinalStackDocumentTexel(lower + vec2<i32>(1, 0));
  let p01 = tailFinalStackDocumentTexel(lower + vec2<i32>(0, 1));
  let p11 = tailFinalStackDocumentTexel(lower + vec2<i32>(1, 1));
  return mix(
    mix(p00, p10, interpolation.x),
    mix(p01, p11, interpolation.x),
    interpolation.y
  );
}

fn sampleTailDisplayFinalStack(
  layerPosition: vec2<f32>,
  layerUv: vec2<f32>
) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  if (lod < 1.0) {
    let mipZero = sampleTailFinalStackMipZero(layerPosition);
    if (lod <= 0.000001) {
      return mipZero;
    }
    return mix(mipZero, samplePermanentLogicalMip(layerUv, 1.0), lod);
  }
  return samplePermanentLayer(layerUv);
}

// Logical mip 1 is built on the document grid from the already composited
// live Paint texels. Later levels can use the ordinary 2×2 downsampler.
@fragment
fn activeMipFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let p00 = tailActiveTexel(sourceOrigin);
  let p10 = tailActiveTexel(sourceOrigin + vec2<i32>(1, 0));
  let p01 = tailActiveTexel(sourceOrigin + vec2<i32>(0, 1));
  let p11 = tailActiveTexel(sourceOrigin + vec2<i32>(1, 1));
  let gammaAverage = (
    linearPremultipliedToGamma(p00)
    + linearPremultipliedToGamma(p10)
    + linearPremultipliedToGamma(p01)
    + linearPremultipliedToGamma(p11)
  ) * 0.25;
  return gammaPremultipliedToLinear(gammaAverage);
}

@fragment
fn activeClippingGroupMipFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let p00 = composeActiveClippingGroupTexel(tailActiveTexel(sourceOrigin), sourceOrigin);
  let p10i = sourceOrigin + vec2<i32>(1, 0);
  let p01i = sourceOrigin + vec2<i32>(0, 1);
  let p11i = sourceOrigin + vec2<i32>(1, 1);
  let p10 = composeActiveClippingGroupTexel(tailActiveTexel(p10i), p10i);
  let p01 = composeActiveClippingGroupTexel(tailActiveTexel(p01i), p01i);
  let p11 = composeActiveClippingGroupTexel(tailActiveTexel(p11i), p11i);
  return (p00 + p10 + p01 + p11) * 0.25;
}

@fragment
fn finalStackMipFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let p00 = tailFinalStackDocumentTexel(sourceOrigin);
  let p10 = tailFinalStackDocumentTexel(sourceOrigin + vec2<i32>(1, 0));
  let p01 = tailFinalStackDocumentTexel(sourceOrigin + vec2<i32>(0, 1));
  let p11 = tailFinalStackDocumentTexel(sourceOrigin + vec2<i32>(1, 1));
  let gammaAverage = (
    linearPremultipliedToGamma(p00)
    + linearPremultipliedToGamma(p10)
    + linearPremultipliedToGamma(p01)
    + linearPremultipliedToGamma(p11)
  ) * 0.25;
  return gammaPremultipliedToLinear(gammaAverage);
}

${mergedSurfaceSamplingShader}
fn composeLayerStack(
  activePaint: vec4<f32>,
  layerPosition: vec2<f32>,
  fragmentPosition: vec2<f32>
) -> vec4<f32> {
  var paint = vec4<f32>(0.0);
  if (display.hasMergedBelow > 0.5) {
    paint = sampleMergedBelow(layerPosition);
  }
  paint = sourceOver(
    sampleViewportTexture(vectorTextBelowTexture, fragmentPosition),
    paint
  );
  let activeContribution = select(
    activePaint,
    activePaint * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
  paint = sourceOver(activeContribution, paint);
  paint = sourceOver(
    sampleViewportTexture(vectorTextAboveTexture, fragmentPosition),
    paint
  );
  if (display.hasMergedAbove > 0.5) {
    paint = sourceOver(sampleMergedAbove(layerPosition), paint);
  }
  return paint;
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
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let layerUv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  var paint: vec4<f32>;
  if (tail.documentMipMode == 2u) {
    paint = sampleTailDisplayFinalStack(layerPosition, layerUv);
  } else {
    paint = sampleTailDisplayActive(layerPosition, layerUv);
    if (display.clippingMode > 0.5) {
      paint = sampleTailDisplayClippingGroup(layerPosition, layerUv);
    }
    paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let checkerSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}

@fragment
fn activeFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);
  if (!insideLayer) {
    return vec4<f32>(0.0);
  }

  let layerUv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let paint = sampleTailDisplayActive(layerPosition, layerUv);
  if (display.clippingMode > 0.5) {
    return sampleTailDisplayClippingGroup(layerPosition, layerUv);
  }
  return paint * display.activeLayerAlpha;
}

@fragment
fn activeSourceFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(activeLayerBase, 0));
  if (any(layerPosition < vec2<f32>(0.0)) || any(layerPosition >= layerSize)) {
    return vec4<f32>(0.0);
  }
  let layerUv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  return sampleTailDisplayActive(layerPosition, layerUv) * display.activeLayerAlpha;
}
`;

// Light Glaze keeps the permanent paint layer unchanged while a stroke is in
// progress. This display-only variant composes the per-stroke accumulator over
// the permanent layer with one stroke-wide opacity multiplier. The legacy
// display shader above remains byte-for-byte independent from this path.
export const lightGlazeDisplayShader = /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
};

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var layerTexture: texture_2d<f32>;
@group(0) @binding(2) var strokeTexture: texture_2d<f32>;
@group(0) @binding(3) var layerSampler: sampler;
@group(0) @binding(4) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(5) var compositedMipTexture: texture_2d<f32>;
@group(0) @binding(6) var mergedBelowTexture: texture_2d<f32>;
@group(0) @binding(7) var mergedAboveTexture: texture_2d<f32>;
@group(0) @binding(8) var vectorTextBelowTexture: texture_2d<f32>;
@group(0) @binding(9) var vectorTextAboveTexture: texture_2d<f32>;
@group(0) @binding(10) var activeClippingPrefix: texture_2d<f32>;
@group(0) @binding(11) var activeClippingSuffix: texture_2d<f32>;

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

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}

${activeClippingGroupTexelShader}

fn sampleViewportTexture(
  source: texture_2d<f32>,
  fragmentPosition: vec2<f32>
) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(source, 0));
  let pixel = clamp(vec2<i32>(fragmentPosition), vec2<i32>(0), dimensions - vec2<i32>(1));
  return textureLoad(source, pixel, 0);
}

${mergedSurfaceSamplingShader}
fn composeLayerStack(
  activePaint: vec4<f32>,
  layerPosition: vec2<f32>,
  fragmentPosition: vec2<f32>
) -> vec4<f32> {
  var paint = vec4<f32>(0.0);
  if (display.hasMergedBelow > 0.5) {
    paint = sampleMergedBelow(layerPosition);
  }
  paint = sourceOver(
    sampleViewportTexture(vectorTextBelowTexture, fragmentPosition),
    paint
  );
  let activeContribution = select(
    activePaint,
    activePaint * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
  paint = sourceOver(activeContribution, paint);
  paint = sourceOver(
    sampleViewportTexture(vectorTextAboveTexture, fragmentPosition),
    paint
  );
  if (display.hasMergedAbove > 0.5) {
    paint = sourceOver(sampleMergedAbove(layerPosition), paint);
  }
  return paint;
}

fn quantizeLayer(value: vec4<f32>) -> vec4<f32> {
  let redGreen = unpack2x16float(pack2x16float(value.rg));
  let blueAlpha = unpack2x16float(pack2x16float(value.ba));
  return vec4<f32>(redGreen, blueAlpha);
}

fn storedLightCoverage(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
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

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
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
  let strokePaint = resolvedStrokePaint(accumulatedStroke);
  if (lightGlaze.accumulationMode == 2u) {
    // Outside the physical stamp Intense must be an exact identity operation.
    // In particular, do not round-trip signed/HDR Noise through bounded sRGB.
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
    let extendedResult = vec4<f32>(
      clamp(
        boundedResult.rgb + extendedResidual * (1.0 - strokePaint.a),
        vec3<f32>(-65504.0),
        vec3<f32>(65504.0)
      ),
      boundedResult.a
    );
    return quantizeLayer(extendedResult);
  }
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
}

fn compositedLayerTexel(position: vec2<i32>) -> vec4<f32> {
  let permanentPaint = textureLoad(layerTexture, position, 0);
  let accumulatedStroke = textureLoad(strokeTexture, position, 0);
  return compositeLightGlazeOverPermanent(permanentPaint, accumulatedStroke);
}

fn compositedClippingGroupTexel(position: vec2<i32>) -> vec4<f32> {
  let activeTexel = compositedLayerTexel(position);
  if (display.clippingMode < 0.5) {
    return activeTexel;
  }
  return composeActiveClippingGroupTexel(activeTexel, position);
}

fn sampleCompositedLayerLinear(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(layerTexture, 0));
  let maximumCoordinate = dimensions - vec2<i32>(1);
  let texelPosition = uv * vec2<f32>(dimensions) - vec2<f32>(0.5);
  let lowerCoordinate = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = compositedLayerTexel(clamp(lowerCoordinate, vec2<i32>(0), maximumCoordinate));
  let p10 = compositedLayerTexel(clamp(
    lowerCoordinate + vec2<i32>(1, 0),
    vec2<i32>(0),
    maximumCoordinate
  ));
  let p01 = compositedLayerTexel(clamp(
    lowerCoordinate + vec2<i32>(0, 1),
    vec2<i32>(0),
    maximumCoordinate
  ));
  let p11 = compositedLayerTexel(clamp(
    lowerCoordinate + vec2<i32>(1, 1),
    vec2<i32>(0),
    maximumCoordinate
  ));
  return mix(
    mix(p00, p10, interpolation.x),
    mix(p01, p11, interpolation.x),
    interpolation.y
  );
}

fn sampleCompositedLayerNearest(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(layerTexture, 0));
  return compositedLayerTexel(rasterPixelViewTexel(uv, dimensions));
}

fn sampleCompositedClippingGroupLinear(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let maximum = vec2<i32>(textureDimensions(layerTexture, 0)) - vec2<i32>(1);
  let p00i = clamp(lower, vec2<i32>(0), maximum);
  let p10i = clamp(lower + vec2<i32>(1, 0), vec2<i32>(0), maximum);
  let p01i = clamp(lower + vec2<i32>(0, 1), vec2<i32>(0), maximum);
  let p11i = clamp(lower + vec2<i32>(1, 1), vec2<i32>(0), maximum);
  let p00 = compositedClippingGroupTexel(p00i);
  let p10 = compositedClippingGroupTexel(p10i);
  let p01 = compositedClippingGroupTexel(p01i);
  let p11 = compositedClippingGroupTexel(p11i);
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
}

fn sampleCompositedActiveMipZero(
  uv: vec2<f32>,
  layerPosition: vec2<f32>
) -> vec4<f32> {
  if (display.clippingMode > 0.5) {
    if (rasterPixelViewEnabled(1.0)) {
      let pixel = rasterPixelViewTexel(
        uv,
        vec2<i32>(textureDimensions(layerTexture, 0))
      );
      return compositedClippingGroupTexel(pixel);
    }
    return sampleCompositedClippingGroupLinear(layerPosition);
  }
  if (rasterPixelViewEnabled(1.0)) {
    return sampleCompositedLayerNearest(uv);
  }
  return sampleCompositedLayerLinear(uv);
}

fn sampleCompositedActiveLogicalMip(
  uv: vec2<f32>,
  layerPosition: vec2<f32>,
  logicalMip: f32
) -> vec4<f32> {
  if (logicalMip < 0.5) {
    return sampleCompositedActiveMipZero(uv, layerPosition);
  }
  return textureSampleLevel(
    compositedMipTexture,
    layerSampler,
    uv,
    logicalMip - 1.0
  );
}

fn sampleCompositedActiveLayer(
  uv: vec2<f32>,
  layerPosition: vec2<f32>
) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  let lowerMip = floor(lod);
  let upperMip = ceil(lod);
  if (upperMip <= lowerMip) {
    return sampleCompositedActiveLogicalMip(uv, layerPosition, lowerMip);
  }
  return mix(
    sampleCompositedActiveLogicalMip(uv, layerPosition, lowerMip),
    sampleCompositedActiveLogicalMip(uv, layerPosition, upperMip),
    lod - lowerMip
  );
}

fn composeFinalRasterStackSamples(
  activePaint: vec4<f32>,
  belowPaint: vec4<f32>,
  abovePaint: vec4<f32>
) -> vec4<f32> {
  var paint = belowPaint;
  let activeContribution = select(
    activePaint,
    activePaint * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
  paint = sourceOver(activeContribution, paint);
  paint = sourceOver(abovePaint, paint);
  return paint;
}

fn loadFinalMergedBelowDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedBelow < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedBelowOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedBelowTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedBelowTexture, localPixel, 0);
}

fn loadFinalMergedAboveDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedAbove < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedAboveOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedAboveTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedAboveTexture, localPixel, 0);
}

fn resolvedFinalActiveTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let activePaint = compositedLayerTexel(documentPixel);
  if (display.clippingMode < 0.5) {
    return activePaint;
  }
  return composeActiveClippingGroupTexel(activePaint, documentPixel);
}

fn compositedFinalRasterStackTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(layerTexture, 0));
  let pixel = clamp(documentPixel, vec2<i32>(0), dimensions - vec2<i32>(1));
  return composeFinalRasterStackSamples(
    resolvedFinalActiveTexel(pixel),
    loadFinalMergedBelowDocumentTexel(pixel),
    loadFinalMergedAboveDocumentTexel(pixel)
  );
}

// Source-over is nonlinear at coincident alpha edges. Compose the four
// document texels first and only then interpolate the final premultiplied
// colors, matching the canonical raster-stack presenter at mip 0.
fn sampleCompositedFinalRasterStackLinear(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = compositedFinalRasterStackTexel(lower);
  let p10 = compositedFinalRasterStackTexel(lower + vec2<i32>(1, 0));
  let p01 = compositedFinalRasterStackTexel(lower + vec2<i32>(0, 1));
  let p11 = compositedFinalRasterStackTexel(lower + vec2<i32>(1, 1));
  return mix(
    mix(p00, p10, interpolation.x),
    mix(p01, p11, interpolation.x),
    interpolation.y
  );
}

fn finalStackSurfacesUseDocumentResolution() -> bool {
  return display.hasMergedBelow <= 1.0001
    && display.hasMergedAbove <= 1.0001
    && display.clippingPrefixScale <= 1.0001
    && display.clippingSuffixScale <= 1.0001;
}

fn jointFinalStackFilteringCandidate() -> bool {
  let lodZeroSmooth = display.selectedMipLevel < 1.0
    && !rasterPixelViewEnabled(1.0);
  let activePresent = display.activeLayerAlpha > 0.0;
  let belowPresent = display.hasMergedBelow > 0.5;
  let abovePresent = display.hasMergedAbove > 0.5;
  let multipleSurfaces = (activePresent && (belowPresent || abovePresent))
    || (belowPresent && abovePresent);
  return lodZeroSmooth
    && finalStackSurfacesUseDocumentResolution()
    && (multipleSurfaces || display.clippingMode > 0.5);
}

fn needsJointFinalStackFiltering(stackAlphaGradient: f32) -> bool {
  return jointFinalStackFilteringCandidate()
    && (display.clippingMode > 0.5 || stackAlphaGradient > 0.00001);
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
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(layerTexture, 0));

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);

  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let uv = clamp(layerPosition / layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  // Logical mip 0 is the exact permanent+stroke composite; mip 1+ lives in
  // the derived texture. Mix adjacent logical levels explicitly because the
  // shared sampler intentionally keeps nearest-mip behavior for legacy paths.
  var paint = sampleCompositedActiveLayer(uv, layerPosition);
  paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let checkerSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);

  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}

// This entry point is selected only when the live pyramid represents the
// complete simple raster stack. Mip 1+ is already final-composited; mip 0
// mirrors the canonical compose-before-filter edge behavior directly.
@fragment
fn finalStackFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(layerTexture, 0));
  let uv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );

  let jointFilteringCandidate = jointFinalStackFilteringCandidate();
  var activePaint = vec4<f32>(0.0);
  var belowPaint = vec4<f32>(0.0);
  var abovePaint = vec4<f32>(0.0);
  var stackAlphaGradient = 0.0;
  if (jointFilteringCandidate) {
    activePaint = sampleCompositedLayerLinear(uv);
    if (display.hasMergedBelow > 0.5) {
      belowPaint = sampleMergedBelow(layerPosition);
    }
    if (display.hasMergedAbove > 0.5) {
      abovePaint = sampleMergedAbove(layerPosition);
    }
    // Keep derivatives in uniform control flow and before the position-based
    // early return, as required for stable edge detection across a quad.
    stackAlphaGradient = fwidth(activePaint.a)
      + fwidth(belowPaint.a)
      + fwidth(abovePaint.a);
  }

  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);
  if (!insideLayer) {
    return vec4<f32>(vec3<f32>(0.055), 1.0);
  }

  let lod = max(display.selectedMipLevel, 0.0);
  var paint: vec4<f32>;
  if (lod < 1.0) {
    var mipZero: vec4<f32>;
    if (rasterPixelViewEnabled(1.0)) {
      mipZero = compositedFinalRasterStackTexel(
        rasterPixelViewTexel(uv, vec2<i32>(textureDimensions(layerTexture, 0)))
      );
    } else {
      if (!jointFilteringCandidate) {
        activePaint = sampleCompositedLayerLinear(uv);
        if (display.hasMergedBelow > 0.5) {
          belowPaint = sampleMergedBelow(layerPosition);
        }
        if (display.hasMergedAbove > 0.5) {
          abovePaint = sampleMergedAbove(layerPosition);
        }
      }
      mipZero = composeFinalRasterStackSamples(activePaint, belowPaint, abovePaint);
      if (needsJointFinalStackFiltering(stackAlphaGradient)) {
        mipZero = sampleCompositedFinalRasterStackLinear(layerPosition);
      }
    }
    if (lod <= 0.0) {
      paint = mipZero;
    } else {
      let mipOne = textureSampleLevel(compositedMipTexture, layerSampler, uv, 0.0);
      paint = mix(mipZero, mipOne, lod);
    }
  } else {
    let lowerMip = floor(lod);
    let upperMip = ceil(lod);
    if (upperMip <= lowerMip) {
      paint = textureSampleLevel(compositedMipTexture, layerSampler, uv, lowerMip - 1.0);
    } else {
      paint = mix(
        textureSampleLevel(compositedMipTexture, layerSampler, uv, lowerMip - 1.0),
        textureSampleLevel(compositedMipTexture, layerSampler, uv, upperMip - 1.0),
        lod - lowerMip
      );
    }
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let checkerSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  let backgroundSrgb = select(
    checkerSrgb,
    display.backgroundColor.rgb,
    display.backgroundColor.a > 0.5
  );
  let backgroundLinear = srgbToLinear(backgroundSrgb);
  let compositedLinear = paint.rgb + backgroundLinear * (1.0 - paint.a);
  return vec4<f32>(linearToSrgb(compositedLinear), 1.0);
}

@fragment
fn activeFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(layerTexture, 0));
  let insideLayer = all(layerPosition >= vec2<f32>(0.0))
    && all(layerPosition < layerSize);
  if (!insideLayer) {
    return vec4<f32>(0.0);
  }

  let uv = clamp(
    layerPosition / layerSize,
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  );
  let paint = sampleCompositedActiveLayer(uv, layerPosition);
  return select(
    paint,
    paint * display.activeLayerAlpha,
    display.clippingMode < 0.5
  );
}

@fragment
fn activeSourceFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let displayOffset = (fragmentPosition.xy - display.canvasSize * 0.5) / display.zoom;
  let layerOffset = vec2<f32>(
    display.viewRotation.x * displayOffset.x + display.viewRotation.y * displayOffset.y,
    -display.viewRotation.y * displayOffset.x + display.viewRotation.x * displayOffset.y
  );
  let layerPosition = display.viewCenter + layerOffset;
  let layerSize = vec2<f32>(textureDimensions(layerTexture, 0));
  if (any(layerPosition < vec2<f32>(0.0)) || any(layerPosition >= layerSize)) {
    return vec4<f32>(0.0);
  }
  let uv = clamp(layerPosition / layerSize, vec2<f32>(0.0), vec2<f32>(1.0));
  let lod = max(display.selectedMipLevel, 0.0);
  var paint: vec4<f32>;
  if (lod < 0.5) {
    paint = select(
      sampleCompositedLayerLinear(uv),
      sampleCompositedLayerNearest(uv),
      rasterPixelViewEnabled(1.0),
    );
  } else {
    paint = textureSampleLevel(
      compositedMipTexture,
      layerSampler,
      uv,
      max(0.0, lod - 1.0),
    );
  }
  return paint * display.activeLayerAlpha;
}
`;

// Mip 0 of the Light Glaze texture is the raw per-stroke accumulator. Mip 1
// starts a different, derived chain: each destination texel composes the four
// permanent/stroke source pairs independently and only then box-filters them.
// Higher levels can use the ordinary premultiplied box downsampler.
export const lightGlazeCompositeMipShader = /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
};

struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var permanentTexture: texture_2d<f32>;
@group(0) @binding(1) var strokeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(3) var<uniform> display: DisplayUniforms;
@group(0) @binding(4) var activeClippingPrefix: texture_2d<f32>;
@group(0) @binding(5) var activeClippingSuffix: texture_2d<f32>;
@group(0) @binding(6) var mergedBelowTexture: texture_2d<f32>;
@group(0) @binding(7) var mergedAboveTexture: texture_2d<f32>;

${activeClippingGroupTexelShader}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}

fn loadMergedBelow(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedBelow < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedBelowOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedBelowTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedBelowTexture, localPixel, 0);
}

fn loadMergedAbove(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedAbove < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedAboveOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedAboveTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedAboveTexture, localPixel, 0);
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

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
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
  let strokePaint = resolvedStrokePaint(accumulatedStroke);
  if (lightGlaze.accumulationMode == 2u) {
    // Outside the physical stamp Intense must be an exact identity operation.
    // In particular, do not round-trip signed/HDR Noise through bounded sRGB.
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
    let extendedResult = vec4<f32>(
      clamp(
        boundedResult.rgb + extendedResidual * (1.0 - strokePaint.a),
        vec3<f32>(-65504.0),
        vec3<f32>(65504.0)
      ),
      boundedResult.a
    );
    return quantizeLayer(extendedResult);
  }
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
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

fn compositedSource(sourcePosition: vec2<i32>) -> vec4<f32> {
  let permanentPaint = textureLoad(permanentTexture, sourcePosition, 0);
  let accumulatedStroke = textureLoad(strokeTexture, sourcePosition, 0);
  let activeTexel = compositeLightGlazeOverPermanent(permanentPaint, accumulatedStroke);
  if (display.clippingMode < 0.5) {
    return activeTexel;
  }
  return composeActiveClippingGroupTexel(activeTexel, sourcePosition);
}

fn compositedFinalStackSource(sourcePosition: vec2<i32>) -> vec4<f32> {
  let permanentPaint = textureLoad(permanentTexture, sourcePosition, 0);
  let accumulatedStroke = textureLoad(strokeTexture, sourcePosition, 0);
  let activeGroup = composeActiveClippingGroupTexel(
    compositeLightGlazeOverPermanent(permanentPaint, accumulatedStroke),
    sourcePosition
  );
  var paint = loadMergedBelow(sourcePosition);
  paint = sourceOver(activeGroup, paint);
  paint = sourceOver(loadMergedAbove(sourcePosition), paint);
  return paint;
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  return (
    compositedSource(sourceOrigin)
    + compositedSource(sourceOrigin + vec2<i32>(1, 0))
    + compositedSource(sourceOrigin + vec2<i32>(0, 1))
    + compositedSource(sourceOrigin + vec2<i32>(1, 1))
  ) * 0.25;
}

@fragment
fn finalStackFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let p00 = compositedFinalStackSource(sourceOrigin);
  let p10 = compositedFinalStackSource(sourceOrigin + vec2<i32>(1, 0));
  let p01 = compositedFinalStackSource(sourceOrigin + vec2<i32>(0, 1));
  let p11 = compositedFinalStackSource(sourceOrigin + vec2<i32>(1, 1));
  return (p00 + p10 + p01 + p11) * 0.25;
}
`;

// Intense Blending cannot use fixed-function blending against the permanent
// linear layer: the measured calibration performs source-over in encoded sRGB.
// This tile resolver reads both inputs, evaluates the exact live formula, and
// writes layer-format pixels to a small preallocated copy scratch.
export const lightGlazeCommitTileShader = /* wgsl */ `
struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct CommitTileUniforms {
  sourceOrigin: vec2<u32>,
  _pad0: vec2<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var permanentTexture: texture_2d<f32>;
@group(0) @binding(1) var strokeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> lightGlaze: LightGlazeUniforms;
@group(0) @binding(3) var<uniform> commitTile: CommitTileUniforms;

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

fn resolvedStrokePaint(accumulatedStroke: vec4<f32>) -> vec4<f32> {
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
  let strokePaint = resolvedStrokePaint(accumulatedStroke);
  if (lightGlaze.accumulationMode == 2u) {
    // Outside the physical stamp Intense must be an exact identity operation.
    // In particular, do not round-trip signed/HDR Noise through bounded sRGB.
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
    let extendedResult = vec4<f32>(
      clamp(
        boundedResult.rgb + extendedResidual * (1.0 - strokePaint.a),
        vec3<f32>(-65504.0),
        vec3<f32>(65504.0)
      ),
      boundedResult.a
    );
    return quantizeLayer(extendedResult);
  }
  return quantizeLayer(strokePaint + permanentPaint * (1.0 - strokePaint.a));
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
  let sourcePosition = vec2<i32>(commitTile.sourceOrigin) + vec2<i32>(fragmentPosition.xy);
  return compositeLightGlazeOverPermanent(
    textureLoad(permanentTexture, sourcePosition, 0),
    textureLoad(strokeTexture, sourcePosition, 0)
  );
}
`;
// The final Light Glaze commit reads the already accumulated per-stroke pixel
// one-to-one and lets fixed-function premultiplied source-over blend it into
// the permanent layer. Applying opacity here caps this stroke's source alpha,
// while later strokes can still accumulate normally on the permanent layer.
export const lightGlazeCompositeShader = /* wgsl */ `
struct LightGlazeUniforms {
  opacity: f32,
  formatCode: u32,
  accumulationMode: u32,
  _pad1: u32,
  tintLinear: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var strokeTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> lightGlaze: LightGlazeUniforms;

fn storedLightCoverage(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
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
  let source = textureLoad(strokeTexture, vec2<i32>(fragmentPosition.xy), 0);
  let opacity = clamp(lightGlaze.opacity, 0.0, 1.0);
  if (lightGlaze.accumulationMode == 1u) {
    let coverage = storedLightCoverage(source.r);
    return vec4<f32>(lightGlaze.tintLinear.rgb * coverage, coverage) * opacity;
  }
  // Mode 2 (Intense encoded-sRGB) must never use this fixed-function
  // destination blend. Uniformed and Intense are resolved by the exact tile
  // shader, which samples both the permanent layer and the stroke.
  if (lightGlaze.accumulationMode == 2u) {
    return vec4<f32>(0.0);
  }
  return source * opacity;
}
`;

// Folds one premultiplied layer into a merged surface. The fixed-function
// source-over blend owns the destination term, so the pass never samples and
// renders the same texture subresource.
export const layerCompositeShader = /* wgsl */ `
struct LayerCompositeUniforms {
  destinationOrigin: vec2<f32>,
  destinationScale: f32,
  opacity: f32,
  sourceOrigin: vec2<f32>,
  sourceScale: f32,
  _pad0: f32,
  sourceDimensions: vec2<u32>,
  _pad1: vec2<u32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> layer: LayerCompositeUniforms;

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

fn loadSource(pixel: vec2<i32>) -> vec4<f32> {
  let maximum = vec2<i32>(layer.sourceDimensions) - vec2<i32>(1);
  return textureLoad(sourceTexture, clamp(pixel, vec2<i32>(0), maximum), 0);
}

@fragment
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let destinationScale = max(layer.destinationScale, 1.0);
  let sourceScale = max(layer.sourceScale, 1.0);
  let targetPixel = fragmentPosition.xy - vec2<f32>(0.5);
  let documentPosition = layer.destinationOrigin + targetPixel / destinationScale;
  let sourcePosition = (documentPosition - layer.sourceOrigin) * sourceScale;
  let sourceFloor = floor(sourcePosition);
  let fraction = sourcePosition - sourceFloor;
  let origin = vec2<i32>(sourceFloor);
  let top = mix(loadSource(origin), loadSource(origin + vec2<i32>(1, 0)), fraction.x);
  let bottom = mix(
    loadSource(origin + vec2<i32>(0, 1)),
    loadSource(origin + vec2<i32>(1, 1)),
    fraction.x
  );
  return mix(top, bottom, fraction.y) * clamp(layer.opacity, 0.0, 1.0);
}
`;
export const PAINT_DISPLAY_MINIFICATION_STRATEGY =
  "gamma-premultiplied-box-preserve-alpha-no-post-sample-coverage-rewrite-v2" as const;

// Downsample exact 2x2 footprints in encoded-sRGB premultiplied space while
// keeping every stored mip in the engine's normal linear-premultiplied format.
// Re-encoding each input and decoding the average makes recursive levels equal
// to a gamma-space box pyramid without changing authoritative mip 0. Alpha is
// averaged exactly and is never expanded after sampling: brush-shape noise at
// the edge of a stamp must not turn into a visible rectangular footprint.
export const paintMipDownsampleShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearPremultipliedToGamma(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    linearToSrgbChannel(straight.r),
    linearToSrgbChannel(straight.g),
    linearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

fn gammaPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = vec3<f32>(
    srgbToLinearChannel(straight.r),
    srgbToLinearChannel(straight.g),
    srgbToLinearChannel(straight.b)
  );
  return vec4<f32>(linear * alpha, alpha);
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
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let dimensions = vec2<i32>(textureDimensions(sourceTexture));
  let maximumCoordinate = dimensions - vec2<i32>(1);
  let p00 = textureLoad(sourceTexture, min(sourceOrigin, maximumCoordinate), 0);
  let p10 = textureLoad(
    sourceTexture,
    min(sourceOrigin + vec2<i32>(1, 0), maximumCoordinate),
    0
  );
  let p01 = textureLoad(
    sourceTexture,
    min(sourceOrigin + vec2<i32>(0, 1), maximumCoordinate),
    0
  );
  let p11 = textureLoad(
    sourceTexture,
    min(sourceOrigin + vec2<i32>(1, 1), maximumCoordinate),
    0
  );
  let gammaAverage = (
    linearPremultipliedToGamma(p00)
    + linearPremultipliedToGamma(p10)
    + linearPremultipliedToGamma(p01)
    + linearPremultipliedToGamma(p11)
  ) * 0.25;
  return gammaPremultipliedToLinear(gammaAverage);
}
`;

// Builds logical mip 1 from the final raster stack, not from each layer in
// isolation. Source-over is nonlinear: averaging the independently filtered
// layers and composing them later creates dark/color fringes at coincident
// antialiased edges. The following mip levels can use the ordinary exact 2x2
// downsampler because mip 1 already contains final premultiplied pixels.
export const paintStackCompositeMipShader = /* wgsl */ `
struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
  clippingMode: f32,
  clippingParentOpacity: f32,
  clippingPrefixScale: f32,
  clippingSuffixScale: f32,
  clippingPrefixOrigin: vec2<f32>,
  clippingSuffixOrigin: vec2<f32>,
  backgroundColor: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var activeLayerBase: texture_2d<f32>;
@group(0) @binding(2) var mergedBelowTexture: texture_2d<f32>;
@group(0) @binding(3) var mergedAboveTexture: texture_2d<f32>;
@group(0) @binding(4) var activeClippingPrefix: texture_2d<f32>;
@group(0) @binding(5) var activeClippingSuffix: texture_2d<f32>;

fn srgbToLinearChannel(value: f32) -> f32 {
  if (value <= 0.04045) { return value / 12.92; }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) { return clamped * 12.92; }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn linearPremultipliedToGamma(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    linearToSrgbChannel(straight.r),
    linearToSrgbChannel(straight.g),
    linearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

fn gammaPremultipliedToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) { return vec4<f32>(0.0); }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let linear = vec3<f32>(
    srgbToLinearChannel(straight.r),
    srgbToLinearChannel(straight.g),
    srgbToLinearChannel(straight.b)
  );
  return vec4<f32>(linear * alpha, alpha);
}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}

${activeClippingGroupTexelShader}

fn loadMergedBelow(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedBelow < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedBelowOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedBelowTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedBelowTexture, localPixel, 0);
}

fn loadMergedAbove(documentPixel: vec2<i32>) -> vec4<f32> {
  if (display.hasMergedAbove < 0.5) {
    return vec4<f32>(0.0);
  }
  let localPixel = documentPixel - vec2<i32>(display.mergedAboveOrigin);
  let dimensions = vec2<i32>(textureDimensions(mergedAboveTexture, 0));
  if (any(localPixel < vec2<i32>(0)) || any(localPixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(mergedAboveTexture, localPixel, 0);
}

fn compositedDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(activeLayerBase, 0));
  let pixel = clamp(documentPixel, vec2<i32>(0), dimensions - vec2<i32>(1));
  var paint = loadMergedBelow(pixel);
  paint = sourceOver(composeActiveClippingGroupTexel(
    textureLoad(activeLayerBase, pixel, 0),
    pixel
  ), paint);
  paint = sourceOver(loadMergedAbove(pixel), paint);
  return paint;
}

fn activeClippingGroupDocumentTexel(documentPixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(activeLayerBase, 0));
  let pixel = clamp(documentPixel, vec2<i32>(0), dimensions - vec2<i32>(1));
  return composeActiveClippingGroupTexel(textureLoad(activeLayerBase, pixel, 0), pixel);
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
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let p00 = compositedDocumentTexel(sourceOrigin);
  let p10 = compositedDocumentTexel(sourceOrigin + vec2<i32>(1, 0));
  let p01 = compositedDocumentTexel(sourceOrigin + vec2<i32>(0, 1));
  let p11 = compositedDocumentTexel(sourceOrigin + vec2<i32>(1, 1));
  let gammaAverage = (
    linearPremultipliedToGamma(p00)
    + linearPremultipliedToGamma(p10)
    + linearPremultipliedToGamma(p01)
    + linearPremultipliedToGamma(p11)
  ) * 0.25;
  return gammaPremultipliedToLinear(gammaAverage);
}

@fragment
fn activeGroupFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceOrigin = vec2<i32>(fragmentPosition.xy) * 2;
  let p00 = activeClippingGroupDocumentTexel(sourceOrigin);
  let p10 = activeClippingGroupDocumentTexel(sourceOrigin + vec2<i32>(1, 0));
  let p01 = activeClippingGroupDocumentTexel(sourceOrigin + vec2<i32>(0, 1));
  let p11 = activeClippingGroupDocumentTexel(sourceOrigin + vec2<i32>(1, 1));
  return (p00 + p10 + p01 + p11) * 0.25;
}
`;
