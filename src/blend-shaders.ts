const blendUniformsWgsl = /* wgsl */ `
struct BlendUniforms {
  documentAndRoi: vec4<f32>,
  validAndFrom: vec4<f32>,
  toAndFromHalfSize: vec4<f32>,
  toHalfSizeAndAngles: vec4<f32>,
  maskControls: vec4<f32>,
  transportControls: vec4<f32>,
  grainControls: vec4<f32>,
  grainAffineAndPhase: vec4<f32>,
  paintColor: vec4<f32>,
  options: vec4<u32>,
};

@group(0) @binding(0) var<uniform> blend: BlendUniforms;

fn documentSize() -> vec2<i32> {
  return vec2<i32>(blend.documentAndRoi.xy);
}

fn roiOrigin() -> vec2<i32> {
  return vec2<i32>(blend.documentAndRoi.zw);
}

fn validSize() -> vec2<i32> {
  return vec2<i32>(blend.validAndFrom.xy);
}

@vertex
fn fullscreenVertex(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}
`;

export const blendGatherShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var canonicalLayer: texture_2d<f32>;

@fragment
fn gatherFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPixel = roiOrigin() + vec2<i32>(fragmentPosition.xy);
  if (
    any(documentPixel < vec2<i32>(0))
    || any(documentPixel >= documentSize())
  ) {
    return vec4<f32>(0.0);
  }

  // The target engine already stores authoritative premultiplied linear RGBA.
  // The source WebGL renderer's sRGB conversions must not be repeated here.
  let value = textureLoad(canonicalLayer, documentPixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`;

export const blendMaskShader = /* wgsl */ `
${blendUniformsWgsl}

const GRAIN_MIP_LEVEL_COUNT: u32 = 12u;

struct MaskOutput {
  @location(0) stepCoverage: f32,
  @location(1) unionCoverage: f32,
};

struct LocalSample {
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

struct CustomSample {
  coverage: f32,
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

@group(0) @binding(1) var shapeTexture: texture_2d<f32>;
@group(0) @binding(2) var shapeSampler: sampler;
@group(0) @binding(3) var grainTexture: texture_2d<f32>;
@group(0) @binding(4) var grainSampler: sampler;

fn localAt(documentPosition: vec2<f32>, interpolation: f32) -> LocalSample {
  let center = mix(blend.validAndFrom.zw, blend.toAndFromHalfSize.xy, interpolation);
  let halfSize = max(
    mix(blend.toAndFromHalfSize.zw, blend.toHalfSizeAndAngles.xy, interpolation),
    vec2<f32>(0.001)
  );
  let angle = mix(
    blend.toHalfSizeAndAngles.z,
    blend.toHalfSizeAndAngles.w,
    interpolation
  );
  let cosine = cos(angle);
  let sine = sin(angle);
  let delta = documentPosition - center;
  let local = vec2<f32>(
    cosine * delta.x + sine * delta.y,
    -sine * delta.x + cosine * delta.y
  );

  var result: LocalSample;
  result.uv = vec2<f32>(
    local.x / (2.0 * halfSize.x) + 0.5,
    local.y / (2.0 * halfSize.y) + 0.5
  );
  result.brushPixels = local;
  return result;
}

fn customAt(documentPosition: vec2<f32>, interpolation: f32) -> CustomSample {
  let local = localAt(documentPosition, interpolation);
  var result: CustomSample;
  result.uv = local.uv;
  result.brushPixels = local.brushPixels;
  if (
    any(local.uv < vec2<f32>(0.0))
    || any(local.uv > vec2<f32>(1.0))
  ) {
    result.coverage = 0.0;
    return result;
  }
  result.coverage = textureSampleLevel(shapeTexture, shapeSampler, local.uv, 0.0).r;
  return result;
}

fn adjustedGrainCoverage(grainUv: vec2<f32>) -> f32 {
  let grainUvDx = dpdx(grainUv);
  let grainUvDy = dpdy(grainUv);
  var sourceSample: vec4<f32>;
  if (blend.options.z == 0u) {
    let baseDimensions = vec2<f32>(textureDimensions(grainTexture, 0));
    let footprint = max(
      length(grainUvDx * baseDimensions),
      length(grainUvDy * baseDimensions)
    );
    let mipLevel = u32(clamp(
      round(log2(max(footprint, 1.0))),
      0.0,
      f32(GRAIN_MIP_LEVEL_COUNT - 1u)
    ));
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

  let source = dot(sourceSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let adjusted = clamp(
    (source - 0.5) * blend.grainAffineAndPhase.x
      + 0.5
      + blend.grainControls.w,
    0.0,
    1.0
  );
  return mix(1.0, adjusted, clamp(blend.grainControls.z, 0.0, 1.0));
}

@fragment
fn maskFragment(@builtin(position) fragmentPosition: vec4<f32>) -> MaskOutput {
  let documentPosition = blend.documentAndRoi.zw + fragmentPosition.xy;
  let segment = blend.toAndFromHalfSize.xy - blend.validAndFrom.zw;
  let denominator = max(dot(segment, segment), 0.00000001);
  let closest = clamp(
    dot(documentPosition - blend.validAndFrom.zw, segment) / denominator,
    0.0,
    1.0
  );

  var coverage = 0.0;
  var bestInterpolation = closest;
  var bestLocal = localAt(documentPosition, closest);

  if (blend.options.x == 0u) {
    let halfSize = max(
      mix(blend.toAndFromHalfSize.zw, blend.toHalfSizeAndAngles.xy, closest),
      vec2<f32>(0.001)
    );
    let center = mix(blend.validAndFrom.zw, blend.toAndFromHalfSize.xy, closest);
    let radius = max(0.001, min(halfSize.x, halfSize.y));
    let normalizedRadius = length(documentPosition - center) / radius;
    let core = clamp(blend.maskControls.x, 0.0, 1.0) * 0.94;
    let antialiasWidth = max(
      fwidth(normalizedRadius) * 1.35,
      0.55 / max(radius, 1.0)
    );
    coverage = 1.0 - smoothstep(
      core - antialiasWidth,
      1.0 + antialiasWidth,
      normalizedRadius
    );
  } else {
    var selected = customAt(documentPosition, closest);
    coverage = selected.coverage;
    bestLocal.uv = selected.uv;
    bestLocal.brushPixels = selected.brushPixels;

    for (var index = 0u; index <= 32u; index += 1u) {
      let interpolation = f32(index) / 32.0;
      let candidate = customAt(documentPosition, interpolation);
      if (candidate.coverage > coverage) {
        coverage = candidate.coverage;
        bestInterpolation = interpolation;
        bestLocal.uv = candidate.uv;
        bestLocal.brushPixels = candidate.brushPixels;
      }
    }
  }

  let spacing = blend.maskControls.z;
  if (spacing > 1.0) {
    let period = max(1.0, blend.transportControls.y * spacing);
    let support = max(0.5, blend.transportControls.y * 0.5);
    let arcPosition = blend.maskControls.w
      + bestInterpolation * blend.transportControls.x;
    let phase = abs(
      ((arcPosition + period * 0.5) % period) - period * 0.5
    );
    let antialiasWidth = max(fwidth(arcPosition), 0.5);
    coverage *= 1.0 - smoothstep(
      support - antialiasWidth,
      support + antialiasWidth,
      phase
    );
  }

  var grainCoverage = 1.0;
  if (blend.options.y != 0u) {
    var grainUv: vec2<f32>;
    if (blend.options.y == 2u) {
      // Moving maps one complete grain image to the selected brush footprint.
      grainUv = bestLocal.uv;
    } else {
      // Fixed is anchored to authoritative top-left layer coordinates.
      grainUv = documentPosition * blend.grainControls.x;
    }
    grainCoverage = adjustedGrainCoverage(grainUv);
  }

  let documentPixel = vec2<i32>(floor(documentPosition));
  var finalCoverage = 0.0;
  if (
    all(documentPixel >= vec2<i32>(0))
    && all(documentPixel < documentSize())
  ) {
    finalCoverage = clamp(
      coverage * grainCoverage * blend.maskControls.y,
      0.0,
      1.0
    );
  }

  var output: MaskOutput;
  output.stepCoverage = finalCoverage;
  output.unionCoverage = finalCoverage;
  return output;
}
`;

const blendStateSamplingWgsl = /* wgsl */ `
@group(0) @binding(1) var stateTexture: texture_2d<f32>;

fn cleanState(pixel: vec2<i32>) -> vec4<f32> {
  if (
    any(pixel < vec2<i32>(0))
    || any(pixel >= validSize())
  ) {
    return vec4<f32>(0.0);
  }
  let value = textureLoad(stateTexture, pixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}

fn sampleState(center: vec2<f32>) -> vec4<f32> {
  let samplePosition = center - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(samplePosition));
  let interpolation = fract(samplePosition);
  return mix(
    mix(cleanState(lower), cleanState(lower + vec2<i32>(1, 0)), interpolation.x),
    mix(
      cleanState(lower + vec2<i32>(0, 1)),
      cleanState(lower + vec2<i32>(1, 1)),
      interpolation.x
    ),
    interpolation.y
  );
}
`;

export const blendPickupShader = /* wgsl */ `
${blendUniformsWgsl}
${blendStateSamplingWgsl}

@group(0) @binding(2) var previousCarrier: texture_2d<f32>;

@fragment
fn pickupFragment() -> @location(0) vec4<f32> {
  var sum = vec4<f32>(0.0);
  var total = 0.0;
  let angle = blend.toHalfSizeAndAngles.z;
  let cosine = cos(angle);
  let sine = sin(angle);
  let core = clamp(blend.maskControls.x, 0.0, 1.0) * 0.94;

  for (var y = 0u; y < 8u; y += 1u) {
    for (var x = 0u; x < 8u; x += 1u) {
      let uv = (vec2<f32>(f32(x), f32(y)) + vec2<f32>(0.5)) / 8.0;
      let normalized = uv * 2.0 - vec2<f32>(1.0);
      let radius = length(normalized);
      let weight = 1.0 - smoothstep(core, 1.0, radius);
      if (weight > 0.0) {
        let local = normalized * blend.toAndFromHalfSize.zw;
        let documentPosition = blend.validAndFrom.zw + vec2<f32>(
          cosine * local.x - sine * local.y,
          sine * local.x + cosine * local.y
        );
        sum += sampleState(documentPosition - blend.documentAndRoi.zw) * weight;
        total += weight;
      }
    }
  }

  var pigment = select(vec4<f32>(0.0), sum / total, total > 0.0);
  if (blend.options.w != 0u) {
    let previous = textureLoad(previousCarrier, vec2<i32>(0), 0);
    pigment = mix(
      pigment,
      previous,
      clamp(blend.transportControls.w, 0.0, 1.0)
    );
  }

  let alpha = clamp(pigment.a, 0.0, 1.0);
  return vec4<f32>(
    clamp(pigment.rgb, vec3<f32>(0.0), vec3<f32>(alpha)),
    alpha
  );
}
`;

export const blendDepositShader = /* wgsl */ `
${blendUniformsWgsl}
${blendStateSamplingWgsl}

@group(0) @binding(2) var stepMask: texture_2d<f32>;
@group(0) @binding(3) var carrierTexture: texture_2d<f32>;

@fragment
fn depositFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(fragmentPosition.xy);
  let canvas = cleanState(pixel);
  let coverage = clamp(
    textureLoad(stepMask, pixel, 0).r * blend.transportControls.z,
    0.0,
    1.0
  );
  if (coverage <= 0.0) {
    return canvas;
  }

  let carrier = textureLoad(carrierTexture, vec2<i32>(0), 0);
  let loaded = vec4<f32>(clamp(blend.paintColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  let pigment = mix(
    carrier,
    loaded,
    clamp(blend.grainControls.y, 0.0, 1.0)
  );
  let mixed = mix(canvas, pigment, coverage);
  let resultAlpha = clamp(mixed.a, 0.0, 1.0);
  let result = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(resultAlpha)),
    resultAlpha
  );
  if (resultAlpha <= blend.grainAffineAndPhase.w) {
    return vec4<f32>(0.0);
  }
  return result;
}
`;

export const blendScatterShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var resolvedState: texture_2d<f32>;
@group(0) @binding(2) var unionMask: texture_2d<f32>;

@fragment
fn scatterFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPixel = vec2<i32>(fragmentPosition.xy);
  let localPixel = documentPixel - roiOrigin();
  if (
    any(localPixel < vec2<i32>(0))
    || any(localPixel >= validSize())
    || textureLoad(unionMask, localPixel, 0).r <= 0.0
  ) {
    discard;
  }

  let value = textureLoad(resolvedState, localPixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`;
