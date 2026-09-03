/**
 * Experimental per-copy preparation ABI used only by the isolated GPU lab.
 *
 * The compute entry point expands the packed 32-byte base-stamp records into
 * one stable 48-byte record per physical copy. The vertex entry point consumes
 * those records as step-mode `instance` attributes while preserving the
 * production fragment-stage interface.
 */
export const PREPARED_COPY_INSTANCE_STRIDE_BYTES = 48;

export const PREPARED_COPY_CENTER_ROTATION_OFFSET_BYTES = 0;
export const PREPARED_COPY_COLOR_RADIUS_OFFSET_BYTES = 16;
export const PREPARED_COPY_METADATA_OFFSET_BYTES = 32;

export const PREPARED_COPY_DISPATCH_UNIFORM_BYTES = 16;
export const PREPARED_COPY_WORKGROUP_SIZE = 64;

export const PREPARED_COPY_COMPUTE_ENTRY_POINT = "prepareMain";
export const PREPARED_COPY_VERTEX_ENTRY_POINT = "preparedShapeVertexMain";

/**
 * Bindings used by `prepareMain` in group 0:
 *
 * - 0: production-compatible BrushUniforms uniform
 * - 1: packed base stamps, read-only storage
 * - 2: prepared-copy records, writable storage and later a vertex buffer
 * - 3: vec4<u32> dispatch parameters
 *
 * Dispatch parameter words are baseStampOffset, stampCount, outputCopyOffset
 * and one reserved word. Copy count has a single authoritative source in the
 * production-compatible brush uniform. Prepared records are written in
 * stamp -> copy -> symmetry order. The current lab caller deliberately uses
 * symmetry off; a production caller must size dispatch and storage for the
 * additional physical symmetry copies.
 *
 * `preparedShapeVertexMain` only accesses binding 0. Its remaining inputs are
 * three per-instance attributes:
 *
 * - location 0: float32x4 at byte offset 0
 * - location 1: float32x4 at byte offset 16
 * - location 2: uint32x4 at byte offset 32
 */
export const PREPARED_COPY_INSTANCE_SHADER = /* wgsl */ `
const MAX_COUNT: u32 = 24u;
const COPY_COUNT_MASK: u32 = 0xffu;
const SYMMETRY_MODE_SHIFT: u32 = 8u;
const TAU: f32 = 6.283185307179586;

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

struct PreparedCopy {
  // Jittered center.xy followed by the optional Shape rotation cosine/sine.
  centerRotation: vec4<f32>,
  // Linear point color.rgb followed by the base stamp radius.
  colorRadius: vec4<f32>,
  // Shape layer, symmetry copy index, rotation-active flag, reserved.
  metadata: vec4<u32>,
};

struct PreparationParams {
  baseStampOffset: u32,
  stampCount: u32,
  outputCopyOffset: u32,
  _reserved: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
  @location(1) @interpolate(flat) pointColor: vec3<f32>,
  @location(2) localBrushPixels: vec2<f32>,
  @location(3) @interpolate(flat) shapeLayer: u32,
};

@group(0) @binding(0) var<uniform> brush: BrushUniforms;
@group(0) @binding(1) var<storage, read> stamps: array<Stamp>;
@group(0) @binding(2) var<storage, read_write> preparedCopies: array<PreparedCopy>;
@group(0) @binding(3) var<uniform> preparation: PreparationParams;

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

@compute @workgroup_size(${PREPARED_COPY_WORKGROUP_SIZE})
fn prepareMain(@builtin(global_invocation_id) globalInvocationId: vec3<u32>) {
  let copyCount = max(1u, min(brush.options.x & COPY_COUNT_MASK, MAX_COUNT));
  let symmetryMode = brush.options.x >> SYMMETRY_MODE_SHIFT;
  let symmetryCopyCount = select(1u, 2u, symmetryMode != 0u);
  let copiesPerStamp = copyCount * symmetryCopyCount;
  let localPreparedIndex = globalInvocationId.x;
  let preparedCount = preparation.stampCount * copiesPerStamp;
  if (localPreparedIndex >= preparedCount) {
    return;
  }

  let localStampIndex = localPreparedIndex / copiesPerStamp;
  let copyWithinStamp = localPreparedIndex % copiesPerStamp;
  let copyIndex = copyWithinStamp / symmetryCopyCount;
  let symmetryCopyIndex = copyWithinStamp % symmetryCopyCount;
  let stamp = stamps[preparation.baseStampOffset + localStampIndex];

  let directionLength = length(stamp.direction);
  let direction = select(
    vec2<f32>(1.0, 0.0),
    stamp.direction / directionLength,
    directionLength > 0.0001
  );
  let copySeed = hash32(stamp.seed ^ (copyIndex * 0x85ebca6bu));
  let linearOffset =
    (random01(copySeed, 5u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.x;
  let lateralOffset =
    (random01(copySeed, 6u) - 0.5) * 4.0 * stamp.radius * brush.positionJitter.y;
  let jitteredCenter = stamp.center
    + direction * linearOffset
    + vec2<f32>(-direction.y, direction.x) * lateralOffset;

  let scatter = clamp(brush.positionJitter.z, 0.0, 1.0);
  let followsStroke = brush.options.w == 1u;
  let rotationActive = scatter > 0.00001 || followsStroke;
  var cosine = 1.0;
  var sine = 0.0;
  if (rotationActive) {
    let followAngle = select(0.0, atan2(direction.y, direction.x), followsStroke);
    let angle = followAngle + (random01(copySeed, 7u) - 0.5) * TAU * scatter;
    cosine = cos(angle);
    sine = sin(angle);
  }

  var colorCopySeed = copySeed;
  if (brush.options.y == 0u) {
    colorCopySeed = hash32(stamp.seed);
  }
  let pointColor = jitteredLinearColorFromCopySeed(colorCopySeed);

  preparedCopies[preparation.outputCopyOffset + localPreparedIndex] = PreparedCopy(
    vec4<f32>(jitteredCenter, cosine, sine),
    vec4<f32>(pointColor, stamp.radius),
    vec4<u32>(stamp.shapeLayer, symmetryCopyIndex, select(0u, 1u, rotationActive), 0u)
  );
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
fn preparedShapeVertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) centerRotation: vec4<f32>,
  @location(1) colorRadius: vec4<f32>,
  @location(2) metadata: vec4<u32>
) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  let localPosition = corners[vertexIndex];
  var geometryPosition = localPosition;
  if (metadata.z != 0u) {
    let cosine = centerRotation.z;
    let sine = centerRotation.w;
    geometryPosition = vec2<f32>(
      localPosition.x * cosine - localPosition.y * sine,
      localPosition.x * sine + localPosition.y * cosine
    );
  }

  let radius = colorRadius.w;
  let symmetryMode = brush.options.x >> SYMMETRY_MODE_SHIFT;
  let layerPosition = reflectedLayerPosition(
    centerRotation.xy + geometryPosition * radius,
    symmetryMode,
    metadata.y
  );
  let targetPosition = layerPosition - brush.renderTargetOrigin;
  let clipPosition = vec2<f32>(
    targetPosition.x / brush.layerSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / brush.layerSize.y * 2.0
  );

  var output: VertexOutput;
  output.position = vec4<f32>(clipPosition, 0.0, 1.0);
  output.localPosition = localPosition;
  output.pointColor = colorRadius.xyz;
  // Moving Grain remains in unrotated stamp-local pixel coordinates.
  output.localBrushPixels = localPosition * radius;
  output.shapeLayer = metadata.x;
  return output;
}
`;
