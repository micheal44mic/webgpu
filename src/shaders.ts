import { mergedSurfaceSamplingShader } from "./merged-surface-shader";
import { activeClippingGroupTexelShader } from "./clipping-group-shader";
import { perceptualRasterShaderSource } from "./perceptual-raster-resampling.ts";

export const brushShader = /* wgsl */ `
const MAX_COUNT: u32 = 24u;
const TAU: f32 = 6.283185307179586;
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  renderTargetOrigin: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  positionJitter: vec4<f32>,
  options: vec4<u32>,
};

struct Stamp {
  center: vec2<f32>,
  radius: f32,
  pressure: f32,
  seed: u32,
  _pad0: u32,
  direction: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pointColor: vec3<f32>,
  @location(2) localBrushPixels: vec2<f32>,
};

struct ShapeOccupancy {
  words: array<vec4<u32>, 512>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(2) var shapeMaskTexture: texture_2d<f32>;
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

  let copyCount = max(1u, min(brush.options.x, MAX_COUNT));
  let stampIndex = instanceIndex / copyCount;
  let copyIndex = instanceIndex % copyCount;
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
  let layerPosition = jitteredCenter + localPosition * stamp.radius;
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.localBrushPixels = localPosition * stamp.radius;
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

  let copyCount = max(1u, min(brush.options.x, MAX_COUNT));
  let stampIndex = instanceIndex / copyCount;
  let copyIndex = instanceIndex % copyCount;
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

  let layerPosition = jitteredCenter + geometryPosition * stamp.radius;
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.localBrushPixels = localPosition * stamp.radius;
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
  let coverage = 1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared);

  if (coverage <= 0.0) {
    discard;
  }
  return coverage;
}

fn shapeCoverage(input: VertexOutput) -> f32 {
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let sourceCoverage = textureSample(shapeMaskTexture, shapeMaskSampler, uv).r;
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
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let uvDx = dpdx(uv);
  let uvDy = dpdy(uv);

  if (!shapeOccupancyMayContribute(uv)) {
    discard;
  }

  let sourceCoverage = textureSampleGrad(shapeMaskTexture, shapeMaskSampler, uv, uvDx, uvDy).r;
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

// Grain remains an opt-in fragment path. The legacy brushShader above is not
// modified or given an inactive branch: Grain Off therefore keeps compiling
// and executing the exact previous shader entry points and bindings.
export const texturizedGrainShader = /* wgsl */ `
const SHAPE_OCCUPANCY_GRID_SIZE: u32 = 256u;

struct BrushUniforms {
  layerSize: vec2<f32>,
  renderTargetOrigin: vec2<f32>,
  baseHslAlpha: vec4<f32>,
  jitter: vec4<f32>,
  controls: vec4<f32>,
  positionJitter: vec4<f32>,
  options: vec4<u32>,
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
};

struct ShapeOccupancy {
  words: array<vec4<u32>, 512>,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(2) var shapeMaskTexture: texture_2d<f32>;
@group(0) @binding(3) var shapeMaskSampler: sampler;
@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;
@group(0) @binding(5) var grainTexture: texture_2d<f32>;
@group(0) @binding(6) var grainSampler: sampler;
@group(0) @binding(7) var<uniform> grain: GrainUniforms;

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
  // La luma RGB dell'asset Grain e' gia' stata calcolata al carico, con
  // gli stessi pesi 0.299/0.587/0.114, e conservata su un canale scalare. Il
  // valore campionato qui e' quello che prima veniva ricavato a ogni fragment
  // dal dot(rgb): identico, ma senza portarsi dietro tre canali inutilizzati.
  // L'alpha dell'immagine sorgente non modula la pittura, come prima.
  let source = sourceSample.r;
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
  var coverage = 1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared);

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
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let sourceCoverage = textureSample(shapeMaskTexture, shapeMaskSampler, uv).r;
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
  let uv = input.localPosition * 0.5 + vec2<f32>(0.5);
  let uvDx = dpdx(uv);
  let uvDy = dpdy(uv);

  if (!shapeOccupancyMayContribute(uv)) {
    discard;
  }

  let sourceCoverage = textureSampleGrad(shapeMaskTexture, shapeMaskSampler, uv, uvDx, uvDy).r;
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
/**
 * Conversione della sorgente RGBA in campo scalare, una sola volta al carico.
 *
 * La luma e' esattamente quella che il fragment shader di pittura calcolava a
 * ogni campionamento: stessi pesi, stesso risultato. Cambia solo **quando**
 * viene calcolata. E poiche' la luma e' una combinazione lineare di R, G e B e
 * anche il downsample delle mip e' lineare, le due operazioni commutano: la
 * catena mip generata sulla luma coincide con la luma della catena generata su
 * RGB. L'unica differenza e' la quantizzazione, e va nella direzione buona —
 * prima ogni livello mip veniva arrotondato a 8 bit per canale, ora resta in
 * mezza precisione.
 *
 * `textureLoad` invece di un campionamento filtrato: sorgente e destinazione
 * hanno la stessa taglia, quindi la corrispondenza deve essere texel a texel.
 */
export const grainLumaShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

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
  let texel = textureLoad(sourceTexture, vec2<i32>(fragmentPosition.xy), 0);
  let luma = dot(texel.rgb, vec3<f32>(0.299, 0.587, 0.114));
  return vec4<f32>(luma, 0.0, 0.0, 1.0);
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

${perceptualRasterShaderSource({
  sampling: true,
  interpolate: true,
  sourceOver: true,
  presentation: true,
})}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return linearPremultipliedSourceOver(source, destination);
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
    if (display.zoom < 0.999999) {
      return perceptualSampleBilinear(activeLayerBase, uv, 0u, true);
    }
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
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
}

fn sampleActiveLayerLogicalMip(uv: vec2<f32>, logicalMip: f32) -> vec4<f32> {
  if (logicalMip < 0.5) {
    return sampleActiveLayerMipZero(uv);
  }
  return perceptualSampleBilinear(
    activeLayerPyramid,
    uv,
    u32(logicalMip - 1.0),
    true
  );
}

fn sampleActiveLayer(uv: vec2<f32>) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  let lowerMip = floor(lod);
  let upperMip = ceil(lod);
  if (upperMip <= lowerMip) {
    return sampleActiveLayerLogicalMip(uv, lowerMip);
  }
  let interpolation = lod - lowerMip;
  return perceptualInterpolate(
    sampleActiveLayerLogicalMip(uv, lowerMip),
    sampleActiveLayerLogicalMip(uv, upperMip),
    interpolation
  );
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
fn sampleCompositedLayerStackFiltered(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = compositedLayerStackTexel(lower);
  let p10 = compositedLayerStackTexel(lower + vec2<i32>(1, 0));
  let p01 = compositedLayerStackTexel(lower + vec2<i32>(0, 1));
  let p11 = compositedLayerStackTexel(lower + vec2<i32>(1, 1));
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
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
    paint = sampleCompositedLayerStackFiltered(layerPosition);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  return vec4<f32>(rasterPresentationCompositeOverSrgbBackground(
    paint,
    backgroundSrgb
  ), 1.0);
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
      mipZero = sampleCompositedLayerStackFiltered(layerPosition);
    }
    if (lod <= 0.0) {
      paint = mipZero;
    } else {
      let mipOne = perceptualSampleBilinear(activeLayerPyramid, uv, 0u, true);
      paint = perceptualInterpolate(mipZero, mipOne, lod);
    }
  } else {
    paint = perceptualSampleTrilinear(activeLayerPyramid, uv, lod - 1.0, true);
  }
  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  return vec4<f32>(rasterPresentationCompositeOverSrgbBackground(
    paint,
    backgroundSrgb
  ), 1.0);
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
};

struct ThicknessTailUniforms {
  origin: vec2<f32>,
  textureSize: vec2<f32>,
  compositionMode: u32,
  _pad0: u32,
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

${perceptualRasterShaderSource({
  sampling: true,
  interpolate: true,
  sourceOver: true,
  presentation: true,
})}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return linearPremultipliedSourceOver(source, destination);
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
    if (display.zoom < 0.999999) {
      return perceptualSampleBilinear(activeLayerBase, uv, 0u, true);
    }
    return textureSampleLevel(activeLayerBase, layerSampler, uv, 0.0);
  }
  return perceptualSampleBilinear(
    activeLayerPyramid,
    uv,
    u32(logicalMip - 1.0),
    true
  );
}

fn samplePermanentLayer(uv: vec2<f32>) -> vec4<f32> {
  let lod = max(display.selectedMipLevel, 0.0);
  let lowerMip = floor(lod);
  let upperMip = ceil(lod);
  if (upperMip <= lowerMip) {
    return samplePermanentLogicalMip(uv, lowerMip);
  }
  return perceptualInterpolate(
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
  if (display.zoom < 0.999999) {
    return perceptualSampleBilinear(tailTexture, uv, 0u, true);
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
  if (tail.compositionMode == 1u) {
    return vec4<f32>(
      permanentPaint.rgb + transientPaint.rgb,
      transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
    );
  }
  return transientPaint + permanentPaint * (1.0 - transientPaint.a);
}

fn sampleTailClippingGroupFiltered(layerPosition: vec2<f32>) -> vec4<f32> {
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
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
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
  let permanentPaint = samplePermanentLayer(layerUv);

  var paint = permanentPaint;
  let tailPosition = layerPosition - tail.origin;
  let insideTail = all(tailPosition >= vec2<f32>(0.0))
    && all(tailPosition < tail.textureSize);
  if (insideTail) {
    let tailUv = clamp(
      tailPosition / tail.textureSize,
      vec2<f32>(0.0),
      vec2<f32>(1.0)
    );
    let transientPaint = sampleTailLayer(tailUv);
    if (tail.compositionMode == 1u) {
      paint = vec4<f32>(
        permanentPaint.rgb + transientPaint.rgb,
        transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
      );
    } else {
      paint = transientPaint + permanentPaint * (1.0 - transientPaint.a);
    }
  }
  if (display.clippingMode > 0.5) {
    if (rasterPixelViewEnabled(1.0)) {
      let pixel = vec2<i32>(floor(layerPosition));
      paint = composeActiveClippingGroupTexel(tailActiveTexel(pixel), pixel);
    } else {
      paint = sampleTailClippingGroupFiltered(layerPosition);
    }
  }
  paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  return vec4<f32>(rasterPresentationCompositeOverSrgbBackground(
    paint,
    backgroundSrgb
  ), 1.0);
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
  let permanentPaint = samplePermanentLayer(layerUv);
  var paint = permanentPaint;
  let tailPosition = layerPosition - tail.origin;
  let insideTail = all(tailPosition >= vec2<f32>(0.0))
    && all(tailPosition < tail.textureSize);
  if (insideTail) {
    let tailUv = clamp(
      tailPosition / tail.textureSize,
      vec2<f32>(0.0),
      vec2<f32>(1.0)
    );
    let transientPaint = sampleTailLayer(tailUv);
    if (tail.compositionMode == 1u) {
      paint = vec4<f32>(
        permanentPaint.rgb + transientPaint.rgb,
        transientPaint.a + permanentPaint.a * (1.0 - transientPaint.a)
      );
    } else {
      paint = transientPaint + permanentPaint * (1.0 - transientPaint.a);
    }
  }
  if (display.clippingMode > 0.5) {
    if (rasterPixelViewEnabled(1.0)) {
      let pixel = vec2<i32>(floor(layerPosition));
      return composeActiveClippingGroupTexel(tailActiveTexel(pixel), pixel);
    }
    return sampleTailClippingGroupFiltered(layerPosition);
  }
  return paint * display.activeLayerAlpha;
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

${perceptualRasterShaderSource({
  sampling: true,
  interpolate: true,
  sourceOver: true,
  presentation: true,
})}

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
  return linearPremultipliedSourceOver(source, destination);
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

fn sampleCompositedLayerFiltered(uv: vec2<f32>) -> vec4<f32> {
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
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
}

fn sampleCompositedLayerNearest(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(layerTexture, 0));
  return compositedLayerTexel(rasterPixelViewTexel(uv, dimensions));
}

fn sampleCompositedClippingGroupFiltered(layerPosition: vec2<f32>) -> vec4<f32> {
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
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
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
    return sampleCompositedClippingGroupFiltered(layerPosition);
  }
  if (rasterPixelViewEnabled(1.0)) {
    return sampleCompositedLayerNearest(uv);
  }
  return sampleCompositedLayerFiltered(uv);
}

fn sampleCompositedActiveLogicalMip(
  uv: vec2<f32>,
  layerPosition: vec2<f32>,
  logicalMip: f32
) -> vec4<f32> {
  if (logicalMip < 0.5) {
    return sampleCompositedActiveMipZero(uv, layerPosition);
  }
  return perceptualSampleBilinear(
    compositedMipTexture,
    uv,
    u32(logicalMip - 1.0),
    true
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
  return perceptualInterpolate(
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
fn sampleCompositedFinalRasterStackFiltered(layerPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = layerPosition - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(texelPosition));
  let interpolation = fract(texelPosition);
  let p00 = compositedFinalRasterStackTexel(lower);
  let p10 = compositedFinalRasterStackTexel(lower + vec2<i32>(1, 0));
  let p01 = compositedFinalRasterStackTexel(lower + vec2<i32>(0, 1));
  let p11 = compositedFinalRasterStackTexel(lower + vec2<i32>(1, 1));
  if (display.zoom < 0.999999) {
    return perceptualInterpolateFour(p00, p10, p01, p11, interpolation);
  }
  return mix(mix(p00, p10, interpolation.x), mix(p01, p11, interpolation.x), interpolation.y);
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
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  return vec4<f32>(rasterPresentationCompositeOverSrgbBackground(
    paint,
    backgroundSrgb
  ), 1.0);
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
    activePaint = sampleCompositedLayerFiltered(uv);
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
        activePaint = sampleCompositedLayerFiltered(uv);
        if (display.hasMergedBelow > 0.5) {
          belowPaint = sampleMergedBelow(layerPosition);
        }
        if (display.hasMergedAbove > 0.5) {
          abovePaint = sampleMergedAbove(layerPosition);
        }
      }
      mipZero = composeFinalRasterStackSamples(activePaint, belowPaint, abovePaint);
      if (needsJointFinalStackFiltering(stackAlphaGradient)) {
        mipZero = sampleCompositedFinalRasterStackFiltered(layerPosition);
      }
    }
    if (lod <= 0.0) {
      paint = mipZero;
    } else {
      let mipOne = perceptualSampleBilinear(compositedMipTexture, uv, 0u, true);
      paint = perceptualInterpolate(mipZero, mipOne, lod);
    }
  } else {
    paint = perceptualSampleTrilinear(compositedMipTexture, uv, lod - 1.0, true);
  }

  let checkerCell = vec2<i32>(floor(layerPosition / display.checkerSize));
  let checkerParity = (checkerCell.x + checkerCell.y) & 1;
  let backgroundSrgb = select(vec3<f32>(0.82), vec3<f32>(0.91), checkerParity == 0);
  return vec4<f32>(rasterPresentationCompositeOverSrgbBackground(
    paint,
    backgroundSrgb
  ), 1.0);
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
${perceptualRasterShaderSource({ reduceFour: true, sourceOver: true })}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return linearPremultipliedSourceOver(source, destination);
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
  return perceptualReduceFour(
    compositedSource(sourceOrigin),
    compositedSource(sourceOrigin + vec2<i32>(1, 0)),
    compositedSource(sourceOrigin + vec2<i32>(0, 1)),
    compositedSource(sourceOrigin + vec2<i32>(1, 1))
  );
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
  return perceptualReduceFour(p00, p10, p01, p11);
}
`;

// Intense Blending cannot use fixed-function blending against the permanent
// linear layer: Procreate's measured law performs source-over in encoded sRGB.
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
// Downsample each exact 2x2 footprint with the display-only perceptual policy.
// Bounded SDR color is averaged in encoded sRGB while alpha and signed/HDR
// residuals remain linear. Authoritative layer pixels are never written here.
export const paintMipDownsampleShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

${perceptualRasterShaderSource({ reduceFour: true })}

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
  return perceptualReduceFour(p00, p10, p01, p11);
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

${perceptualRasterShaderSource({ reduceFour: true, sourceOver: true })}

fn sourceOver(source: vec4<f32>, destination: vec4<f32>) -> vec4<f32> {
  return linearPremultipliedSourceOver(source, destination);
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
  return perceptualReduceFour(p00, p10, p01, p11);
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
  return perceptualReduceFour(p00, p10, p01, p11);
}
`;
