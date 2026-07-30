// Compute-first WGSL for the dry Blend brush.
//
// The original port issued five render passes per ~6 px sweep segment; the
// CPU cost of hundreds of beginRenderPass calls per frame starved the GPU and
// let the stroke trail the pointer. This version keeps the exact same pigment
// model but runs gather → (pickup, deposit)×N inside a single compute pass per
// segment group: a dispatch costs microseconds instead of a full render pass.
//
// The sweep-mask math lives inside the deposit kernel now (compute shaders
// have no fwidth/dpdx, so the antialias widths use their analytic values) and
// the scratch state lives in storage buffers so deposits can read-modify-write
// in place without ping-pong copies.

const blendUniformsWgsl = /* wgsl */ `
struct BlendUniforms {
  documentAndRoi: vec4<f32>,      // document W,H; group ROI origin X,Y
  validAndFrom: vec4<f32>,        // group ROI size W,H; step from X,Y
  toAndFromHalfSize: vec4<f32>,   // step to X,Y; from half size W,H
  toHalfSizeAndAngles: vec4<f32>, // to half size W,H; from angle, to angle
  maskControls: vec4<f32>,        // dry: hardness/flow/spacing/arc; Wet: hardness/deposit/travel XY
  transportControls: vec4<f32>,   // dry: distance/diameter/strength/stretch; Wet: distance/diameter/pickup/dilution
  grainControls: vec4<f32>,       // grain scale, dry paint or Wet coat, depth, brightness
  grainAffineAndPhase: vec4<f32>, // contrast; Wet drain, spread and advection
  paintColor: vec4<f32>,           // RGB plus Wet paint-supply gate
  depositRect: vec4<f32>,         // step write rect in group-local pixels X,Y,W,H
  options: vec4<u32>,             // shape custom, grain mode, filtering, has previous
  slots: vec4<u32>,               // carrier/reservoir read, write, scratch stride, mode
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

fn stateIndex(pixel: vec2<i32>) -> u32 {
  return u32(pixel.y) * blend.slots.z + u32(pixel.x);
}

fn wetMode() -> bool {
  return blend.slots.w == 1u;
}

fn srgbToLinearChannel(value: f32) -> f32 {
  let channel = clamp(value, 0.0, 1.0);
  return select(
    pow((channel + 0.055) / 1.055, 2.4),
    channel / 12.92,
    channel <= 0.04045
  );
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let channel = clamp(value, 0.0, 1.0);
  return select(
    1.055 * pow(channel, 1.0 / 2.4) - 0.055,
    channel * 12.92,
    channel <= 0.0031308
  );
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
}

fn srgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    srgbToLinearChannel(value.r),
    srgbToLinearChannel(value.g),
    srgbToLinearChannel(value.b)
  );
}

fn premultipliedLinearToEncodedSrgb(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) {
    return vec4<f32>(0.0);
  }
  return vec4<f32>(linearToSrgb(value.rgb / alpha) * alpha, alpha);
}

fn premultipliedEncodedSrgbToLinear(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.000001) {
    return vec4<f32>(0.0);
  }
  return vec4<f32>(srgbToLinear(value.rgb / alpha) * alpha, alpha);
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

const blendStateSamplingWgsl = /* wgsl */ `
fn cleanState(pixel: vec2<i32>) -> vec4<f32> {
  if (
    any(pixel < vec2<i32>(0))
    || any(pixel >= validSize())
  ) {
    return vec4<f32>(0.0);
  }
  let value = stateBuffer[stateIndex(pixel)];
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

export const blendGatherShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var canonicalLayer: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> stateBuffer: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> coverageBuffer: array<f32>;

@compute @workgroup_size(8, 8)
fn gatherMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel = vec2<i32>(gid.xy);
  if (any(pixel >= validSize())) {
    return;
  }
  let index = stateIndex(pixel);
  coverageBuffer[index] = 0.0;
  let documentPixel = roiOrigin() + pixel;
  if (
    any(documentPixel < vec2<i32>(0))
    || any(documentPixel >= documentSize())
  ) {
    stateBuffer[index] = vec4<f32>(0.0);
    return;
  }

  // The target engine already stores authoritative premultiplied linear RGBA.
  // The source WebGL renderer's sRGB conversions must not be repeated here.
  let value = textureLoad(canonicalLayer, documentPixel, 0);
  let alpha = clamp(value.a, 0.0, 1.0);
  let clean = vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
  stateBuffer[index] = select(clean, premultipliedLinearToEncodedSrgb(clean), wetMode());
}
`;

export const DRY_BLEND_PICKUP_BORDER_STRATEGY =
  "exclude-outside-document-preserve-carrier";

export const blendPickupShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> carrierBuffer: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> wetReservoirBuffer: array<vec4<f32>>;

${blendStateSamplingWgsl}

const RUWA_WET_GRID_SIZE: u32 = 32u;
const RUWA_WET_TEXELS_PER_SLOT: u32 = RUWA_WET_GRID_SIZE * RUWA_WET_GRID_SIZE;

fn reservoirIndex(slot: u32, pixel: vec2<u32>) -> u32 {
  return slot * RUWA_WET_TEXELS_PER_SLOT
    + pixel.y * RUWA_WET_GRID_SIZE
    + pixel.x;
}

fn cleanReservoir(slot: u32, pixel: vec2<i32>) -> vec4<f32> {
  if (
    any(pixel < vec2<i32>(0))
    || any(pixel >= vec2<i32>(i32(RUWA_WET_GRID_SIZE)))
  ) {
    return vec4<f32>(0.0);
  }
  let value = wetReservoirBuffer[reservoirIndex(slot, vec2<u32>(pixel))];
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}

fn sampleReservoir(slot: u32, uv: vec2<f32>) -> vec4<f32> {
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) {
    return vec4<f32>(0.0);
  }
  let position = uv * f32(RUWA_WET_GRID_SIZE) - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(position));
  let interpolation = fract(position);
  return mix(
    mix(
      cleanReservoir(slot, lower),
      cleanReservoir(slot, lower + vec2<i32>(1, 0)),
      interpolation.x
    ),
    mix(
      cleanReservoir(slot, lower + vec2<i32>(0, 1)),
      cleanReservoir(slot, lower + vec2<i32>(1, 1)),
      interpolation.x
    ),
    interpolation.y
  );
}

fn straightRgb(value: vec4<f32>) -> vec3<f32> {
  return select(
    vec3<f32>(0.0),
    clamp(value.rgb / max(value.a, 0.000001), vec3<f32>(0.0), vec3<f32>(1.0)),
    value.a > 0.000001
  );
}

var<workgroup> pickupSums: array<vec4<f32>, 64>;
var<workgroup> pickupTotals: array<f32, 64>;

@compute @workgroup_size(8, 8)
fn pickupMain(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(local_invocation_index) threadIndex: u32,
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  if (wetMode()) {
    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / f32(RUWA_WET_GRID_SIZE);
    let normalized = uv * 2.0 - vec2<f32>(1.0);
    let halfSize = max(blend.toHalfSizeAndAngles.xy, vec2<f32>(0.001));
    let local = normalized * halfSize;
    let angle = blend.toHalfSizeAndAngles.w;
    let cosine = cos(angle);
    let sine = sin(angle);
    let documentPosition = blend.toAndFromHalfSize.xy + vec2<f32>(
      cosine * local.x - sine * local.y,
      sine * local.x + cosine * local.y
    );

    var tipCoverage = 1.0;
    if (blend.options.x == 0u) {
      let radiusSquared = dot(normalized, normalized);
      let hardness = clamp(blend.maskControls.x, 0.0, 1.0);
      let innerEdge = min(hardness * hardness, 0.999);
      tipCoverage = 1.0 - smoothstep(innerEdge, 1.0, radiusSquared);
    }

    var canvas = vec4<f32>(0.0);
    if (
      all(documentPosition >= vec2<f32>(0.0))
      && all(documentPosition < blend.documentAndRoi.xy)
    ) {
      let sampleDocumentPosition = clamp(
        documentPosition,
        vec2<f32>(0.5),
        blend.documentAndRoi.xy - vec2<f32>(0.5)
      );
      canvas = sampleState(sampleDocumentPosition - blend.documentAndRoi.zw);
    }

    var previous = vec4<f32>(0.0);
    var advected = vec4<f32>(0.0);
    if (blend.options.w != 0u) {
      previous = cleanReservoir(blend.slots.x, vec2<i32>(gid.xy));
      let travel = blend.maskControls.zw;
      let localTravel = vec2<f32>(
        cosine * travel.x + sine * travel.y,
        -sine * travel.x + cosine * travel.y
      );
      let previousDocumentLocal = local + localTravel;
      let previousUv = previousDocumentLocal / (2.0 * halfSize) + vec2<f32>(0.5);
      advected = sampleReservoir(blend.slots.x, previousUv);
    }

    let exchangeCoverage = tipCoverage
      * clamp(blend.transportControls.z, 0.0, 1.0);
    let spread = clamp(blend.grainAffineAndPhase.z, 0.0, 1.0);
    let drain = clamp(blend.grainAffineAndPhase.y, 0.0, 1.0);
    let advection = clamp(blend.grainAffineAndPhase.w, 0.0, 1.0);
    let canvasWeight = exchangeCoverage * (1.0 - spread) * canvas.a;
    let penWeight = tipCoverage * spread * clamp(blend.paintColor.a, 0.0, 1.0);
    let remainder = max(1.0 - canvasWeight - penWeight, 0.0) * (1.0 - drain);
    let previousWeight = remainder * (1.0 - advection) * previous.a;
    let advectedWeight = remainder * advection * advected.a;
    let total = canvasWeight + penWeight + previousWeight + advectedWeight;

    var result = vec4<f32>(0.0);
    if (total > 0.000001) {
      let straight = (
        straightRgb(canvas) * canvasWeight
        + clamp(blend.paintColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * penWeight
        + straightRgb(previous) * previousWeight
        + straightRgb(advected) * advectedWeight
      ) / total;
      var alpha = clamp(
        max(total, max(canvas.a * exchangeCoverage, max(previous.a, advected.a))),
        0.0,
        1.0
      );
      if (penWeight > 0.000001) {
        alpha = 1.0;
      }
      result = vec4<f32>(clamp(straight, vec3<f32>(0.0), vec3<f32>(1.0)) * alpha, alpha);
    }
    wetReservoirBuffer[reservoirIndex(blend.slots.y, gid.xy)] = result;
    return;
  }

  let angle = blend.toHalfSizeAndAngles.z;
  let cosine = cos(angle);
  let sine = sin(angle);
  let core = clamp(blend.maskControls.x, 0.0, 1.0) * 0.94;

  // One thread per tap of the 8x8 weighted footprint reduction.
  let uv = (vec2<f32>(f32(lid.x), f32(lid.y)) + vec2<f32>(0.5)) / 8.0;
  let normalized = uv * 2.0 - vec2<f32>(1.0);
  let radius = length(normalized);
  let weight = 1.0 - smoothstep(core, 1.0, radius);
  var tapSum = vec4<f32>(0.0);
  var tapTotal = 0.0;
  if (weight > 0.0) {
    let local = normalized * blend.toAndFromHalfSize.zw;
    let documentPosition = blend.validAndFrom.zw + vec2<f32>(
      cosine * local.x - sine * local.y,
      sine * local.x + cosine * local.y
    );
    if (
      all(documentPosition >= vec2<f32>(0.0))
      && all(documentPosition < blend.documentAndRoi.xy)
    ) {
      let sampleDocumentPosition = clamp(
        documentPosition,
        vec2<f32>(0.5),
        blend.documentAndRoi.xy - vec2<f32>(0.5)
      );
      tapSum = sampleState(
        sampleDocumentPosition - blend.documentAndRoi.zw
      ) * weight;
      tapTotal = weight;
    }
  }
  pickupSums[threadIndex] = tapSum;
  pickupTotals[threadIndex] = tapTotal;
  workgroupBarrier();
  for (var reduction = 32u; reduction >= 1u; reduction = reduction / 2u) {
    if (threadIndex < reduction) {
      pickupSums[threadIndex] += pickupSums[threadIndex + reduction];
      pickupTotals[threadIndex] += pickupTotals[threadIndex + reduction];
    }
    workgroupBarrier();
  }
  if (threadIndex != 0u) {
    return;
  }

  let sum = pickupSums[0u];
  let total = pickupTotals[0u];
  let hasPickup = total > 0.0;
  var pigment = sum / max(total, 0.000001);
  if (blend.options.w != 0u) {
    let previous = carrierBuffer[blend.slots.x];
    if (hasPickup) {
      pigment = mix(
        pigment,
        previous,
        clamp(blend.transportControls.w, 0.0, 1.0)
      );
    } else {
      // A completely off-canvas step transports the carrier unchanged.
      pigment = previous;
    }
  }

  let alpha = clamp(pigment.a, 0.0, 1.0);
  carrierBuffer[blend.slots.y] = vec4<f32>(
    clamp(pigment.rgb, vec3<f32>(0.0), vec3<f32>(alpha)),
    alpha
  );
}
`;
export const blendDepositShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read_write> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> coverageBuffer: array<f32>;
@group(0) @binding(3) var<storage, read> carrierBuffer: array<vec4<f32>>;
@group(0) @binding(4) var shapeTexture: texture_2d<f32>;
@group(0) @binding(5) var shapeSampler: sampler;
@group(0) @binding(6) var grainTexture: texture_2d<f32>;
@group(0) @binding(7) var grainSampler: sampler;
@group(0) @binding(8) var<storage, read> wetReservoirBuffer: array<vec4<f32>>;

${blendStateSamplingWgsl}

const RUWA_WET_GRID_SIZE: u32 = 32u;
const RUWA_WET_TEXELS_PER_SLOT: u32 = RUWA_WET_GRID_SIZE * RUWA_WET_GRID_SIZE;

fn wetReservoirIndex(slot: u32, pixel: vec2<u32>) -> u32 {
  return slot * RUWA_WET_TEXELS_PER_SLOT
    + pixel.y * RUWA_WET_GRID_SIZE
    + pixel.x;
}

fn cleanWetReservoir(slot: u32, pixel: vec2<i32>) -> vec4<f32> {
  if (
    any(pixel < vec2<i32>(0))
    || any(pixel >= vec2<i32>(i32(RUWA_WET_GRID_SIZE)))
  ) {
    return vec4<f32>(0.0);
  }
  let value = wetReservoirBuffer[wetReservoirIndex(slot, vec2<u32>(pixel))];
  let alpha = clamp(value.a, 0.0, 1.0);
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}

fn sampleWetReservoir(slot: u32, uv: vec2<f32>) -> vec4<f32> {
  if (any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0))) {
    return vec4<f32>(0.0);
  }
  let position = uv * f32(RUWA_WET_GRID_SIZE) - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(position));
  let interpolation = fract(position);
  return mix(
    mix(
      cleanWetReservoir(slot, lower),
      cleanWetReservoir(slot, lower + vec2<i32>(1, 0)),
      interpolation.x
    ),
    mix(
      cleanWetReservoir(slot, lower + vec2<i32>(0, 1)),
      cleanWetReservoir(slot, lower + vec2<i32>(1, 1)),
      interpolation.x
    ),
    interpolation.y
  );
}

const GRAIN_MIP_LEVEL_COUNT: u32 = 12u;

struct LocalSample {
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

struct CustomSample {
  coverage: f32,
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

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
  result.coverage = textureSampleLevel(
    shapeTexture,
    shapeSampler,
    local.uv,
    0.0
  ).r;
  return result;
}

// Compute shaders cannot use dpdx/dpdy, so the caller provides the analytic
// texture-space gradients of the grain UV instead.
fn adjustedGrainCoverage(
  grainUv: vec2<f32>,
  grainUvDx: vec2<f32>,
  grainUvDy: vec2<f32>,
) -> f32 {
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

@compute @workgroup_size(8, 8)
fn depositMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (
    f32(gid.x) >= blend.depositRect.z
    || f32(gid.y) >= blend.depositRect.w
  ) {
    return;
  }
  let pixel = vec2<i32>(blend.depositRect.xy) + vec2<i32>(gid.xy);
  // Pixel-center document position, matching gl_FragCoord in the render port.
  let documentPosition = blend.documentAndRoi.zw
    + vec2<f32>(pixel)
    + vec2<f32>(0.5);
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
    // Analytic stand-in for fwidth(normalizedRadius) * 1.35: the gradient of a
    // normalized distance field is 1 / radius per pixel.
    let antialiasWidth = max(
      1.6 / max(radius, 0.001),
      0.55 / max(radius, 1.0)
    );
    coverage = 1.0 - smoothstep(
      core - antialiasWidth,
      1.0 + antialiasWidth,
      normalizedRadius
    );
    if (wetMode()) {
      // Parità con il fragment Paint del cerchio: smoothstep sul raggio al
      // quadrato con innerEdge = hardness^2, così un parametro Wet appena
      // sopra il neutro non cambia il profilo del bordo dello stamp.
      let radiusSquared = normalizedRadius * normalizedRadius;
      let squaredAntialias = max(3.2 / max(radius, 0.001), 0.00001);
      let hardnessWet = clamp(blend.maskControls.x, 0.0, 1.0);
      let innerEdge = min(
        hardnessWet * hardnessWet,
        1.0 - squaredAntialias
      );
      coverage = 1.0 - smoothstep(
        innerEdge,
        1.0 + squaredAntialias,
        radiusSquared
      );
    }
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
    if (wetMode()) {
      // Parità con shapeCoverage del Paint: mix(mask^2, mask, hardness).
      let hardnessWet = clamp(blend.maskControls.x, 0.0, 1.0);
      coverage = mix(coverage * coverage, coverage, hardnessWet);
    }
  }

  let spacing = blend.maskControls.z;
  if (!wetMode() && spacing > 1.0) {
    let period = max(1.0, blend.transportControls.y * spacing);
    let support = max(0.5, blend.transportControls.y * 0.5);
    let arcPosition = blend.maskControls.w
      + bestInterpolation * blend.transportControls.x;
    let phase = abs(
      ((arcPosition + period * 0.5) % period) - period * 0.5
    );
    // The arc coordinate advances ~1 unit per pixel along the stroke.
    let antialiasWidth = 1.0;
    coverage *= 1.0 - smoothstep(
      support - antialiasWidth,
      support + antialiasWidth,
      phase
    );
  }

  var grainCoverage = 1.0;
  if (blend.options.y != 0u) {
    var grainUv: vec2<f32>;
    var grainUvDx: vec2<f32>;
    var grainUvDy: vec2<f32>;
    if (blend.options.y == 2u) {
      // Moving maps one complete grain image to the selected brush footprint.
      grainUv = bestLocal.uv;
      let halfSize = max(
        mix(
          blend.toAndFromHalfSize.zw,
          blend.toHalfSizeAndAngles.xy,
          bestInterpolation
        ),
        vec2<f32>(0.001)
      );
      grainUvDx = vec2<f32>(0.5 / halfSize.x, 0.0);
      grainUvDy = vec2<f32>(0.0, 0.5 / halfSize.y);
    } else {
      // Fixed is anchored to authoritative top-left layer coordinates.
      grainUv = documentPosition * blend.grainControls.x;
      grainUvDx = vec2<f32>(blend.grainControls.x, 0.0);
      grainUvDy = vec2<f32>(0.0, blend.grainControls.x);
    }
    grainCoverage = adjustedGrainCoverage(grainUv, grainUvDx, grainUvDy);
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

  let index = stateIndex(pixel);

  if (wetMode()) {
    if (finalCoverage <= 0.0) {
      return;
    }
    let reservoir = sampleWetReservoir(blend.slots.y, bestLocal.uv);
    let reservoirAlpha = clamp(reservoir.a, 0.0, 1.0);
    if (reservoirAlpha <= 0.000001) {
      return;
    }
    let reservoirStraight = clamp(
      reservoir.rgb / reservoirAlpha,
      vec3<f32>(0.0),
      vec3<f32>(1.0)
    );
    let coatPerDab = blend.grainControls.y;
    var rate = finalCoverage;
    if (coatPerDab >= 0.0) {
      // Buildup has its own distance-normalized coating law. Its first dab is
      // exactly zero, avoiding the stationary start blob of stamp accumulation.
      rate = clamp(coverage * grainCoverage * coatPerDab, 0.0, 1.0);
    }
    let sourceAlpha = clamp(reservoirAlpha * rate, 0.0, 1.0);
    if (sourceAlpha <= 0.000001) {
      return;
    }
    let canvas = cleanState(pixel);
    let source = vec4<f32>(reservoirStraight * sourceAlpha, sourceAlpha);
    let mixed = source + canvas * (1.0 - sourceAlpha);
    let resultAlpha = clamp(mixed.a, 0.0, 1.0);
    coverageBuffer[index] = max(coverageBuffer[index], sourceAlpha);
    stateBuffer[index] = vec4<f32>(
      clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(resultAlpha)),
      resultAlpha
    );
    return;
  }
  if (finalCoverage > 0.0) {
    coverageBuffer[index] = max(coverageBuffer[index], finalCoverage);
  }
  let depositCoverage = clamp(
    finalCoverage * blend.transportControls.z,
    0.0,
    1.0
  );
  if (depositCoverage <= 0.0) {
    return;
  }

  let canvas = cleanState(pixel);
  let carrier = carrierBuffer[blend.slots.y];
  let loaded = vec4<f32>(
    clamp(blend.paintColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)),
    1.0
  );
  let pigment = mix(
    carrier,
    loaded,
    clamp(blend.grainControls.y, 0.0, 1.0)
  );
  let mixed = mix(canvas, pigment, depositCoverage);
  let resultAlpha = clamp(mixed.a, 0.0, 1.0);
  var result = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(resultAlpha)),
    resultAlpha
  );
  if (resultAlpha <= blend.grainAffineAndPhase.w) {
    result = vec4<f32>(0.0);
  }
  stateBuffer[index] = result;
}
`;

export const blendScatterShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> coverageBuffer: array<f32>;

@fragment
fn scatterFragment(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let documentPixel = vec2<i32>(fragmentPosition.xy);
  let localPixel = documentPixel - roiOrigin();
  if (
    any(localPixel < vec2<i32>(0))
    || any(localPixel >= validSize())
    || coverageBuffer[stateIndex(localPixel)] <= 0.0
  ) {
    discard;
  }

  let value = stateBuffer[stateIndex(localPixel)];
  let alpha = clamp(value.a, 0.0, 1.0);
  let clean = vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
  return select(clean, premultipliedEncodedSrgbToLinear(clean), wetMode());
}
`;
