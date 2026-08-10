/**
 * GPU contract for Liquify.
 *
 * RG in the persistent rgba16float texture stores a destination-to-source
 * displacement in document pixels. Every new dab is composed with the existing
 * inverse warp instead of merely adding vectors. The immutable source is then
 * resolved once, so repeated passes do not repeatedly resample painted pixels.
 */
export const LIQUIFY_DISPLACEMENT_FORMAT = "rgba16float" as const;
export const LIQUIFY_WORKGROUP_SIZE = 8 as const;
export const LIQUIFY_SHADER_STRATEGY =
  "composed-inverse-warp-v2-stable-chaos-faceted-crystals-line-fold-edge" as const;

const SHARED_WGSL = /* wgsl */ `
const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;

struct LiquifyUniforms {
  dispatchOrigin: vec2<i32>,
  dispatchSize: vec2<u32>,
  fieldOrigin: vec2<i32>,
  fieldSize: vec2<u32>,
  center: vec2<f32>,
  previousCenter: vec2<f32>,
  delta: vec2<f32>,
  size: f32,
  pressure: f32,
  distortion: f32,
  momentum: f32,
  spacing: f32,
  elapsedSeconds: f32,
  seed: u32,
  mode: u32,
  strength: f32,
  maximumDisplacement: f32,
  sourceOrigin: vec2<i32>,
  sourceSize: vec2<u32>,
  documentSize: vec2<u32>,
  strokeDirection: vec2<f32>,
}

fn insideU32(point: vec2<i32>, size: vec2<u32>) -> bool {
  return all(point >= vec2<i32>(0)) && all(point < vec2<i32>(size));
}

fn safeNormalize(value: vec2<f32>) -> vec2<f32> {
  let magnitudeSquared = dot(value, value);
  if (magnitudeSquared <= 1e-8) {
    return vec2<f32>(0.0);
  }
  return value * inverseSqrt(magnitudeSquared);
}

fn rotateVector(value: vec2<f32>, angle: f32) -> vec2<f32> {
  let sine = sin(angle);
  let cosine = cos(angle);
  return vec2<f32>(
    cosine * value.x - sine * value.y,
    sine * value.x + cosine * value.y,
  );
}

fn hash2(cell: vec2<i32>, seed: u32) -> vec2<f32> {
  var x = bitcast<u32>(cell.x) * 0x8da6b343u;
  var y = bitcast<u32>(cell.y) * 0xd8163841u;
  x = (x ^ (y >> 1u) ^ seed) * 0xcb1ab31fu;
  y = (y ^ (x >> 1u) ^ (seed * 0x165667b1u)) * 0x9e3779b9u;
  x = x ^ (x >> 16u);
  y = y ^ (y >> 16u);
  return vec2<f32>(f32(x & 0x00ffffffu), f32(y & 0x00ffffffu)) /
    16777215.0;
}

fn quintic(value: vec2<f32>) -> vec2<f32> {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

fn valueNoise(position: vec2<f32>, seed: u32) -> f32 {
  let cell = vec2<i32>(floor(position));
  let fraction = fract(position);
  let blend = quintic(fraction);
  let upper = mix(
    hash2(cell, seed).x,
    hash2(cell + vec2<i32>(1, 0), seed).x,
    blend.x,
  );
  let lower = mix(
    hash2(cell + vec2<i32>(0, 1), seed).x,
    hash2(cell + vec2<i32>(1, 1), seed).x,
    blend.x,
  );
  return mix(upper, lower, blend.y) * 2.0 - 1.0;
}

fn turbulence2(position: vec2<f32>, seed: u32) -> vec2<f32> {
  let x0 = valueNoise(position, seed);
  let y0 = valueNoise(position + vec2<f32>(19.17, -7.31), seed ^ 0x68bc21ebu);
  let x1 = valueNoise(position * 1.93 + vec2<f32>(3.7, 11.9), seed ^ 0x02e5be93u);
  let y1 = valueNoise(position * 2.11 + vec2<f32>(-13.1, 5.3), seed ^ 0x967a889bu);
  return vec2<f32>(x0 * 0.72 + x1 * 0.28, y0 * 0.72 + y1 * 0.28);
}

fn turbulenceY(position: vec2<f32>, seed: u32) -> f32 {
  let low = valueNoise(position + vec2<f32>(19.17, -7.31), seed ^ 0x68bc21ebu);
  let high = valueNoise(
    position * 2.11 + vec2<f32>(-13.1, 5.3),
    seed ^ 0x967a889bu,
  );
  return low * 0.72 + high * 0.28;
}

fn pressureResponse(value: f32) -> f32 {
  let pressure = clamp(value, 0.0, 1.0);
  let smoothedPressure = pressure * pressure * (3.0 - 2.0 * pressure);
  return mix(pressure, smoothedPressure, 0.45);
}

fn influenceFalloff(distance: f32, radius: f32, distortion: f32) -> f32 {
  let interior = clamp(1.0 - distance / max(radius, 0.5), 0.0, 1.0);
  let smoothedFalloff = interior * interior * interior *
    (interior * (interior * 6.0 - 15.0) + 10.0);
  return pow(
    max(smoothedFalloff, 0.0),
    mix(0.82, 1.32, clamp(distortion, 0.0, 1.0)),
  );
}

fn closestPointOnSegment(point: vec2<f32>, start: vec2<f32>, end: vec2<f32>) -> vec2<f32> {
  let segment = end - start;
  let lengthSquared = dot(segment, segment);
  if (lengthSquared <= 1e-8) {
    return end;
  }
  let along = clamp(dot(point - start, segment) / lengthSquared, 0.0, 1.0);
  return start + segment * along;
}

fn seedDirection(seed: u32) -> vec2<f32> {
  let angle = hash2(vec2<i32>(0, 0), seed).x * TAU;
  return vec2<f32>(cos(angle), sin(angle));
}

fn dabTimeScale(delta: vec2<f32>, elapsedSeconds: f32) -> f32 {
  if (dot(delta, delta) > 1e-6) {
    return 1.0;
  }
  return clamp(elapsedSeconds * 60.0, 0.0, 2.0);
}
`;

/**
 * Bindings:
 *  0 uniform buffer (256-byte stride; first 128 bytes used)
 *  1 persistent displacement field, TEXTURE_BINDING
 *  2 preallocated dirty scratch, STORAGE_BINDING rgba16float/write-only
 *
 * Dispatch ceil(dispatchSize / 8), then copy scratch [0, dispatchSize) to the
 * persistent field at dispatchOrigin. Update and copy are ordered per dab.
 */
export const LIQUIFY_UPDATE_SHADER = /* wgsl */ `${SHARED_WGSL}
@group(0) @binding(0) var<uniform> uniforms: LiquifyUniforms;
@group(0) @binding(1) var displacementField: texture_2d<f32>;
@group(0) @binding(2) var displacementScratch: texture_storage_2d<rgba16float, write>;

fn loadDisplacement(documentPixel: vec2<i32>) -> vec2<f32> {
  let fieldPixel = documentPixel - uniforms.fieldOrigin;
  if (!insideU32(fieldPixel, uniforms.fieldSize)) {
    return vec2<f32>(0.0);
  }
  return textureLoad(displacementField, fieldPixel, 0).xy;
}

fn sampleDisplacementBilinear(documentPosition: vec2<f32>) -> vec2<f32> {
  let fieldPosition = documentPosition - vec2<f32>(uniforms.fieldOrigin) - vec2<f32>(0.5);
  let baseField = vec2<i32>(floor(fieldPosition));
  let baseDocument = baseField + uniforms.fieldOrigin;
  let fraction = fract(fieldPosition);
  let upper = mix(
    loadDisplacement(baseDocument),
    loadDisplacement(baseDocument + vec2<i32>(1, 0)),
    fraction.x,
  );
  let lower = mix(
    loadDisplacement(baseDocument + vec2<i32>(0, 1)),
    loadDisplacement(baseDocument + vec2<i32>(1, 1)),
    fraction.x,
  );
  return mix(upper, lower, fraction.y);
}

fn composeWarp(pixelCenter: vec2<f32>, localWarp: vec2<f32>) -> vec2<f32> {
  // Dnew(x) = w(x) + Dold(x + w(x)): true inverse-warp composition.
  return localWarp + sampleDisplacementBilinear(pixelCenter + localWarp);
}

fn clampDisplacement(value: vec2<f32>) -> vec2<f32> {
  let limit = max(uniforms.maximumDisplacement, 1.0);
  let magnitudeSquared = dot(value, value);
  if (magnitudeSquared <= limit * limit) {
    return value;
  }
  return value * (limit * inverseSqrt(max(magnitudeSquared, 1e-8)));
}

@compute @workgroup_size(8, 8, 1)
fn updateLiquify(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= uniforms.dispatchSize)) {
    return;
  }

  let documentPixel = uniforms.dispatchOrigin + vec2<i32>(globalId.xy);
  let fieldPixel = documentPixel - uniforms.fieldOrigin;
  if (!insideU32(fieldPixel, uniforms.fieldSize) ||
      !insideU32(documentPixel, uniforms.documentSize)) {
    textureStore(displacementScratch, vec2<i32>(globalId.xy), vec4<f32>(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let oldDisplacement = textureLoad(displacementField, fieldPixel, 0).xy;
  let pixelCenter = vec2<f32>(documentPixel) + vec2<f32>(0.5);
  let radius = max(uniforms.size * 0.5, 0.5);
  let offset = pixelCenter - uniforms.center;
  let radialDistance = length(offset);
  var influenceDistance = radialDistance;
  if (uniforms.mode == 0u) {
    let sweptCenter = closestPointOnSegment(
      pixelCenter,
      uniforms.previousCenter,
      uniforms.center,
    );
    influenceDistance = length(pixelCenter - sweptCenter);
  }

  if (influenceDistance >= radius) {
    textureStore(displacementScratch, vec2<i32>(globalId.xy),
      vec4<f32>(oldDisplacement, 0.0, 1.0));
    return;
  }

  let distortionForFalloff = select(uniforms.distortion, 0.0, uniforms.mode == 7u);
  let falloff = influenceFalloff(influenceDistance, radius, distortionForFalloff);
  let amount = pressureResponse(uniforms.pressure) * max(uniforms.strength, 0.0) *
    dabTimeScale(uniforms.delta, uniforms.elapsedSeconds) * falloff;
  let radialDirection = safeNormalize(offset);
  let tangentDirection = vec2<f32>(-radialDirection.y, radialDirection.x);
  // Distortion noise is intentionally lazy. turbulence2 performs sixteen
  // hash lookups per pixel, so evaluating it for zero Distortion, Crystals,
  // or Reconstruct would dominate the cost of large dabs without changing
  // their result. This condition is uniform across the dispatch.
  var chaos = vec2<f32>(0.0);
  if (
    uniforms.distortion > 0.0001
    && uniforms.mode <= 4u
  ) {
    let noiseScale = max(4.0, radius * mix(0.22, 0.07, uniforms.distortion));
    chaos = turbulence2(pixelCenter / noiseScale, uniforms.seed);
  }
  var localWarp = vec2<f32>(0.0);
  var nextDisplacement = oldDisplacement;

  switch uniforms.mode {
    case 0u: { // Push
      let motionLength = length(uniforms.delta);
      let maximumMotion = max(uniforms.spacing * 1.5, radius * 0.42);
      let limitedMotion = uniforms.delta * min(1.0, maximumMotion / max(motionLength, 1e-6));
      let inverseMotion = -limitedMotion;
      let directionalChaos = chaos.x * uniforms.distortion * 0.32;
      localWarp = rotateVector(inverseMotion, directionalChaos) * amount;
      localWarp += chaos * length(limitedMotion) * uniforms.distortion * 0.12 * amount;
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    case 1u: { // Twirl right
      let angularGain = mix(0.052, 0.105, uniforms.distortion);
      let angle = -amount * angularGain *
        (1.0 + chaos.x * uniforms.distortion * 0.45);
      localWarp = rotateVector(offset, angle) - offset;
      localWarp += chaos * radius * uniforms.distortion * 0.0045 * amount;
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    case 2u: { // Twirl left
      let angularGain = mix(0.052, 0.105, uniforms.distortion);
      let angle = amount * angularGain *
        (1.0 + chaos.x * uniforms.distortion * 0.45);
      localWarp = rotateVector(offset, angle) - offset;
      localWarp += chaos * radius * uniforms.distortion * 0.0045 * amount;
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    case 3u: { // Pinch
      let radialGain = amount * mix(0.043, 0.105, uniforms.distortion) *
        (1.0 + chaos.x * uniforms.distortion * 0.28);
      let sourceScale = exp(radialGain);
      localWarp = offset * (sourceScale - 1.0);
      localWarp += tangentDirection * chaos.y * radius * uniforms.distortion *
        0.0055 * amount;
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    case 4u: { // Expand
      let radialGain = amount * mix(0.043, 0.105, uniforms.distortion) *
        (1.0 + chaos.x * uniforms.distortion * 0.28);
      let sourceScale = exp(-radialGain);
      localWarp = offset * (sourceScale - 1.0);
      localWarp += tangentDirection * chaos.y * radius * uniforms.distortion *
        0.0055 * amount;
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    case 5u: { // Crystals
      // Stable polar facets push the visible image outward in sharp shards.
      let angle = atan2(offset.y, offset.x);
      let facetCount = floor(mix(7.0, 22.0, uniforms.distortion) + 0.5);
      let sector = i32(floor(((angle + PI) / TAU) * facetCount));
      let ringSize = max(2.0, radius * mix(0.28, 0.13, uniforms.distortion));
      let ring = i32(floor(radialDistance / ringSize));
      let random = hash2(vec2<i32>(sector, ring), uniforms.seed);
      let facetAngle = ((f32(sector) + 0.5 + (random.x - 0.5) *
        uniforms.distortion * 0.82) / facetCount) * TAU - PI;
      let sectorDirection = vec2<f32>(cos(facetAngle), sin(facetAngle));
      var baseDirection = radialDirection;
      if (dot(baseDirection, baseDirection) <= 1e-8) {
        baseDirection = seedDirection(uniforms.seed);
      }
      let facetDirection = safeNormalize(mix(
        baseDirection,
        sectorDirection,
        mix(0.34, 0.82, uniforms.distortion),
      ));
      let shardScale = 0.68 + random.y * 0.72;
      let crystalAmount = radius * mix(0.012, 0.055, uniforms.distortion) *
        amount * shardScale;
      let facetTangent = vec2<f32>(-facetDirection.y, facetDirection.x);
      localWarp = -facetDirection * crystalAmount;
      localWarp += facetTangent * (random.x - 0.5) * radius *
        uniforms.distortion * 0.018 * amount;
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    case 6u: { // Edge
      // A line-fold mapping samples away from the line, pulling visible halves inward.
      var lineTangent = safeNormalize(uniforms.strokeDirection);
      if (dot(lineTangent, lineTangent) <= 1e-8) {
        lineTangent = safeNormalize(uniforms.delta);
      }
      if (dot(lineTangent, lineTangent) <= 1e-8) {
        lineTangent = seedDirection(uniforms.seed);
      }
      let lineNormal = vec2<f32>(-lineTangent.y, lineTangent.x);
      let alongDistance = dot(offset, lineTangent);
      var wobble = 0.0;
      var edgeChaos = 0.0;
      if (uniforms.distortion > 0.0001) {
        let noiseScale = max(4.0, radius * mix(0.22, 0.07, uniforms.distortion));
        edgeChaos = turbulenceY(pixelCenter / noiseScale, uniforms.seed);
        let lineNoise = valueNoise(
          vec2<f32>(alongDistance / max(radius * 0.16, 3.0), f32(uniforms.seed & 31u)),
          uniforms.seed ^ 0x7f4a7c15u,
        );
        wobble = lineNoise * radius * uniforms.distortion * 0.15 * sqrt(falloff);
      }
      let signedDistance = dot(offset, lineNormal) - wobble;
      let sideDistance = abs(signedDistance) / radius;
      let lineShoulder = mix(0.35, 1.0, smoothstep(0.0, 0.22, sideDistance));
      let foldGain = amount * mix(0.047, 0.14, uniforms.distortion) * lineShoulder;
      let sourceScale = exp(foldGain);
      localWarp = lineNormal * signedDistance * (sourceScale - 1.0);
      localWarp += lineTangent * edgeChaos * radius * uniforms.distortion *
        0.004 * amount * sign(signedDistance);
      nextDisplacement = composeWarp(pixelCenter, localWarp);
    }
    default: { // Reconstruct
      // Exponential repair is monotonic and cannot overshoot through zero.
      let repair = clamp(1.0 - exp(-amount * 0.62), 0.0, 0.985);
      nextDisplacement = oldDisplacement * (1.0 - repair);
    }
  }

  textureStore(displacementScratch, vec2<i32>(globalId.xy),
    vec4<f32>(clampDisplacement(nextDisplacement), 0.0, 1.0));
}
`;

/**
 * Resolve bindings:
 *  0 the same uniform layout
 *  1 persistent displacement field
 *  2 immutable, premultiplied source snapshot (never the target)
 *  3 target rgba16float storage texture
 *
 * Manual bilinear sampling keeps cropped snapshots and transparent document
 * edges explicit. Since the source never changes, this resampling is not
 * cumulative even after hundreds of Liquify dabs.
 */
export const LIQUIFY_RESOLVE_SHADER = /* wgsl */ `${SHARED_WGSL}
@group(0) @binding(0) var<uniform> uniforms: LiquifyUniforms;
@group(0) @binding(1) var displacementField: texture_2d<f32>;
@group(0) @binding(2) var immutableSource: texture_2d<f32>;
@group(0) @binding(3) var targetTexture: texture_storage_2d<rgba16float, write>;

fn loadSource(sourcePixel: vec2<i32>) -> vec4<f32> {
  if (!insideU32(sourcePixel, uniforms.sourceSize)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(immutableSource, sourcePixel, 0);
}

fn sampleSourceBilinear(documentPosition: vec2<f32>) -> vec4<f32> {
  let sourcePosition = documentPosition - vec2<f32>(uniforms.sourceOrigin) - vec2<f32>(0.5);
  let base = vec2<i32>(floor(sourcePosition));
  let fraction = fract(sourcePosition);
  let upper = mix(loadSource(base), loadSource(base + vec2<i32>(1, 0)), fraction.x);
  let lower = mix(loadSource(base + vec2<i32>(0, 1)),
    loadSource(base + vec2<i32>(1, 1)), fraction.x);
  return mix(upper, lower, fraction.y);
}

@compute @workgroup_size(8, 8, 1)
fn resolveLiquify(@builtin(global_invocation_id) globalId: vec3<u32>) {
  if (any(globalId.xy >= uniforms.dispatchSize)) {
    return;
  }
  let documentPixel = uniforms.dispatchOrigin + vec2<i32>(globalId.xy);
  if (!insideU32(documentPixel, uniforms.documentSize)) {
    return;
  }

  let fieldPixel = documentPixel - uniforms.fieldOrigin;
  var displacement = vec2<f32>(0.0);
  if (insideU32(fieldPixel, uniforms.fieldSize)) {
    // strength is the non-destructive Adjust Amount for the resolve pass.
    displacement = textureLoad(displacementField, fieldPixel, 0).xy *
      clamp(uniforms.strength, 0.0, 1.0);
  }
  let sourceDocumentPosition = vec2<f32>(documentPixel) + vec2<f32>(0.5) + displacement;
  let color = sampleSourceBilinear(sourceDocumentPosition);
  textureStore(targetTexture, documentPixel, color);
}
`;
