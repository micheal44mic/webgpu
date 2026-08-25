import {
  DRY_BLEND_BLUR_MAX_SUPPORT_PX,
  DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX,
} from "./blend-core.ts";
import {
  SHAPE_MASK_FILTER_UV_OFFSET,
  SHAPE_MASK_FILTER_UV_SCALE,
} from "./engine-limits.ts";

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
  maskControls: vec4<f32>,        // hardness, flow, spacing, arc start
  transportControls: vec4<f32>,   // distance, diameter, strength, stretch
  grainControls: vec4<f32>,       // grain scale, paint, grain depth, grain brightness
  grainAffineAndPhase: vec4<f32>, // grain contrast, movement, mip count, blur amount
  paintColor: vec4<f32>,
  depositRect: vec4<f32>,         // step write rect in group-local pixels X,Y,W,H
  options: vec4<u32>,             // shape custom, grain mode, filtering, has previous
  slots: vec4<u32>,               // carrier read slot, carrier write slot, scratch row stride, 0
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

const BLEND_BLUR_WORKGROUP_SIZE = 64;
const BLEND_BLUR_WEIGHT_VEC4_COUNT = Math.ceil(
  (DRY_BLEND_BLUR_MAX_SUPPORT_PX + 1) / 4,
);
const BLEND_BLUR_CACHE_LENGTH = BLEND_BLUR_WORKGROUP_SIZE
  + DRY_BLEND_BLUR_MAX_SUPPORT_PX * 2;

const blendBlurKernelWgsl = /* wgsl */ `
struct BlendBlurKernel {
  controls: vec4<u32>, // support radius, 0, 0, 0
  weights: array<vec4<f32>, ${BLEND_BLUR_WEIGHT_VEC4_COUNT}>,
};

@group(0) @binding(3) var<uniform> blurKernel: BlendBlurKernel;

const BLEND_BLUR_MAX_RADIUS = ${DRY_BLEND_BLUR_MAX_SUPPORT_PX}u;

fn blendBlurWeight(index: u32) -> f32 {
  return blurKernel.weights[index / 4u][index % 4u];
}

fn packBlendBlurTexel(value: vec4<f32>) -> vec2<u32> {
  return vec2<u32>(pack2x16float(value.xy), pack2x16float(value.zw));
}

fn unpackBlendBlurTexel(value: vec2<u32>) -> vec4<f32> {
  return vec4<f32>(unpack2x16float(value.x), unpack2x16float(value.y));
}
`;

export const blendBlurHorizontalShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> blurBuffer: array<vec2<u32>>;

${blendStateSamplingWgsl}
${blendBlurKernelWgsl}

var<workgroup> blurCache: array<vec2<u32>, ${BLEND_BLUR_CACHE_LENGTH}>;

fn documentClampedState(documentPosition: vec2<i32>) -> vec4<f32> {
  let maximum = max(documentSize() - vec2<i32>(1), vec2<i32>(0));
  let clampedPosition = clamp(documentPosition, vec2<i32>(0), maximum);
  return cleanState(clampedPosition - roiOrigin());
}

@compute @workgroup_size(${BLEND_BLUR_WORKGROUP_SIZE})
fn blurHorizontalMain(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>,
) {
  if (groupId.y >= u32(validSize().y)) {
    return;
  }
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${BLEND_BLUR_CACHE_LENGTH}u;
    cacheIndex += ${BLEND_BLUR_WORKGROUP_SIZE}u
  ) {
    let localX = i32(
      groupId.x * ${BLEND_BLUR_WORKGROUP_SIZE}u + cacheIndex
    ) - i32(BLEND_BLUR_MAX_RADIUS);
    let localPixel = vec2<i32>(localX, i32(groupId.y));
    blurCache[cacheIndex] = packBlendBlurTexel(
      documentClampedState(roiOrigin() + localPixel)
    );
  }
  workgroupBarrier();

  let outputX = groupId.x * ${BLEND_BLUR_WORKGROUP_SIZE}u + localId.x;
  if (outputX >= u32(validSize().x)) {
    return;
  }
  let center = BLEND_BLUR_MAX_RADIUS + localId.x;
  var result = unpackBlendBlurTexel(blurCache[center]) * blendBlurWeight(0u);
  for (var offset = 1u; offset <= BLEND_BLUR_MAX_RADIUS; offset += 1u) {
    if (offset > blurKernel.controls.x) {
      break;
    }
    let weight = blendBlurWeight(offset);
    result += unpackBlendBlurTexel(blurCache[center - offset]) * weight;
    result += unpackBlendBlurTexel(blurCache[center + offset]) * weight;
  }
  let pixel = vec2<i32>(i32(outputX), i32(groupId.y));
  blurBuffer[stateIndex(pixel)] = packBlendBlurTexel(result);
}
`;

export const blendBlurVerticalShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> blurBuffer: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> stateBuffer: array<vec4<f32>>;

${blendStateSamplingWgsl}
${blendBlurKernelWgsl}

var<workgroup> blurCache: array<vec2<u32>, ${BLEND_BLUR_CACHE_LENGTH}>;

fn cleanBlurState(pixel: vec2<i32>) -> vec4<f32> {
  if (any(pixel < vec2<i32>(0)) || any(pixel >= validSize())) {
    return vec4<f32>(0.0);
  }
  return unpackBlendBlurTexel(blurBuffer[stateIndex(pixel)]);
}

@compute @workgroup_size(${BLEND_BLUR_WORKGROUP_SIZE})
fn blurVerticalMain(
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) groupId: vec3<u32>,
) {
  if (groupId.y >= u32(validSize().x)) {
    return;
  }
  for (
    var cacheIndex = localId.x;
    cacheIndex < ${BLEND_BLUR_CACHE_LENGTH}u;
    cacheIndex += ${BLEND_BLUR_WORKGROUP_SIZE}u
  ) {
    let localY = i32(
      groupId.x * ${BLEND_BLUR_WORKGROUP_SIZE}u + cacheIndex
    ) - i32(BLEND_BLUR_MAX_RADIUS);
    blurCache[cacheIndex] = packBlendBlurTexel(
      cleanBlurState(vec2<i32>(i32(groupId.y), localY))
    );
  }
  workgroupBarrier();

  let outputY = groupId.x * ${BLEND_BLUR_WORKGROUP_SIZE}u + localId.x;
  if (outputY >= u32(validSize().y)) {
    return;
  }
  let center = BLEND_BLUR_MAX_RADIUS + localId.x;
  var result = unpackBlendBlurTexel(blurCache[center]) * blendBlurWeight(0u);
  for (var offset = 1u; offset <= BLEND_BLUR_MAX_RADIUS; offset += 1u) {
    if (offset > blurKernel.controls.x) {
      break;
    }
    let weight = blendBlurWeight(offset);
    result += unpackBlendBlurTexel(blurCache[center - offset]) * weight;
    result += unpackBlendBlurTexel(blurCache[center + offset]) * weight;
  }

  let pixel = vec2<i32>(i32(groupId.y), i32(outputY));
  let original = cleanState(pixel);
  let mixed = mix(original, result, clamp(blend.grainAffineAndPhase.w, 0.0, 1.0));
  let alpha = clamp(mixed.a, 0.0, 1.0);
  stateBuffer[stateIndex(pixel)] = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(alpha)),
    alpha
  );
}
`;

const blendBlurReducedGridWgsl = /* wgsl */ `
fn positiveModulo(value: i32, divisor: i32) -> i32 {
  return ((value % divisor) + divisor) % divisor;
}

fn reducedScale() -> i32 {
  return max(2, i32(blurKernel.controls.y));
}

fn reducedPhase() -> vec2<i32> {
  let scale = reducedScale();
  return vec2<i32>(
    positiveModulo(roiOrigin().x, scale),
    positiveModulo(roiOrigin().y, scale)
  );
}

fn reducedSize() -> vec2<i32> {
  let scale = reducedScale();
  return (validSize() + reducedPhase() + vec2<i32>(scale - 1)) / scale;
}

fn reducedIndex(pixel: vec2<i32>) -> u32 {
  return u32(pixel.y * reducedSize().x + pixel.x);
}
`;

export const blendBlurDownsampleShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> reducedOutput: array<vec2<u32>>;

${blendStateSamplingWgsl}
${blendBlurKernelWgsl}
${blendBlurReducedGridWgsl}

fn documentClampedReducedSource(documentPosition: vec2<i32>) -> vec4<f32> {
  let maximum = max(documentSize() - vec2<i32>(1), vec2<i32>(0));
  let clampedPosition = clamp(documentPosition, vec2<i32>(0), maximum);
  return cleanState(clampedPosition - roiOrigin());
}

@compute @workgroup_size(8, 8)
fn blurDownsampleMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel = vec2<i32>(gid.xy);
  if (any(pixel >= reducedSize())) {
    return;
  }
  let scale = reducedScale();
  let base = pixel * scale - reducedPhase();
  var result = vec4<f32>(0.0);
  for (var offsetY = 0; offsetY < scale; offsetY += 1) {
    for (var offsetX = 0; offsetX < scale; offsetX += 1) {
      result += documentClampedReducedSource(
        roiOrigin() + base + vec2<i32>(offsetX, offsetY)
      );
    }
  }
  result /= f32(scale * scale);
  reducedOutput[reducedIndex(pixel)] = packBlendBlurTexel(result);
}
`;

export const blendBlurReducedHorizontalShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> reducedInput: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> reducedOutput: array<vec2<u32>>;

${blendBlurKernelWgsl}
${blendBlurReducedGridWgsl}

fn cleanReducedInput(pixel: vec2<i32>) -> vec4<f32> {
  if (any(pixel < vec2<i32>(0)) || any(pixel >= reducedSize())) {
    return vec4<f32>(0.0);
  }
  return unpackBlendBlurTexel(reducedInput[reducedIndex(pixel)]);
}

@compute @workgroup_size(8, 8)
fn blurReducedHorizontalMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel = vec2<i32>(gid.xy);
  if (any(pixel >= reducedSize())) {
    return;
  }
  var result = cleanReducedInput(pixel) * blendBlurWeight(0u);
  for (
    var offset = 1u;
    offset <= ${DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX}u;
    offset += 1u
  ) {
    if (offset > blurKernel.controls.x) {
      break;
    }
    let weight = blendBlurWeight(offset);
    let delta = vec2<i32>(i32(offset), 0);
    result += cleanReducedInput(pixel - delta) * weight;
    result += cleanReducedInput(pixel + delta) * weight;
  }
  reducedOutput[reducedIndex(pixel)] = packBlendBlurTexel(result);
}
`;

export const blendBlurReducedVerticalShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> reducedInput: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> reducedOutput: array<vec2<u32>>;

${blendBlurKernelWgsl}
${blendBlurReducedGridWgsl}

fn cleanReducedInput(pixel: vec2<i32>) -> vec4<f32> {
  if (any(pixel < vec2<i32>(0)) || any(pixel >= reducedSize())) {
    return vec4<f32>(0.0);
  }
  return unpackBlendBlurTexel(reducedInput[reducedIndex(pixel)]);
}

@compute @workgroup_size(8, 8)
fn blurReducedVerticalMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel = vec2<i32>(gid.xy);
  if (any(pixel >= reducedSize())) {
    return;
  }
  var result = cleanReducedInput(pixel) * blendBlurWeight(0u);
  for (
    var offset = 1u;
    offset <= ${DRY_BLEND_BLUR_REDUCED_MAX_SUPPORT_PX}u;
    offset += 1u
  ) {
    if (offset > blurKernel.controls.x) {
      break;
    }
    let weight = blendBlurWeight(offset);
    let delta = vec2<i32>(0, i32(offset));
    result += cleanReducedInput(pixel - delta) * weight;
    result += cleanReducedInput(pixel + delta) * weight;
  }
  reducedOutput[reducedIndex(pixel)] = packBlendBlurTexel(result);
}
`;

export const blendBlurUpsampleShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> reducedInput: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> stateBuffer: array<vec4<f32>>;

${blendStateSamplingWgsl}
${blendBlurKernelWgsl}
${blendBlurReducedGridWgsl}

fn cleanReducedInput(pixel: vec2<i32>) -> vec4<f32> {
  if (any(pixel < vec2<i32>(0)) || any(pixel >= reducedSize())) {
    return vec4<f32>(0.0);
  }
  return unpackBlendBlurTexel(reducedInput[reducedIndex(pixel)]);
}

fn sampleReduced(center: vec2<f32>) -> vec4<f32> {
  let samplePosition = center - vec2<f32>(0.5);
  let lower = vec2<i32>(floor(samplePosition));
  let interpolation = fract(samplePosition);
  return mix(
    mix(
      cleanReducedInput(lower),
      cleanReducedInput(lower + vec2<i32>(1, 0)),
      interpolation.x
    ),
    mix(
      cleanReducedInput(lower + vec2<i32>(0, 1)),
      cleanReducedInput(lower + vec2<i32>(1, 1)),
      interpolation.x
    ),
    interpolation.y
  );
}

@compute @workgroup_size(8, 8)
fn blurUpsampleMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel = vec2<i32>(gid.xy);
  if (any(pixel >= validSize())) {
    return;
  }
  let scale = f32(reducedScale());
  let reducedCenter = (
    vec2<f32>(pixel + reducedPhase()) + vec2<f32>(0.5)
  ) / scale;
  let original = cleanState(pixel);
  let blurred = sampleReduced(reducedCenter);
  let mixed = mix(
    original,
    blurred,
    clamp(blend.grainAffineAndPhase.w, 0.0, 1.0)
  );
  let alpha = clamp(mixed.a, 0.0, 1.0);
  stateBuffer[stateIndex(pixel)] = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(alpha)),
    alpha
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
  stateBuffer[index] = vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`;

export const DRY_BLEND_PICKUP_BORDER_STRATEGY =
  "exclude-outside-document-preserve-carrier";

export const blendPickupShader = /* wgsl */ `
${blendUniformsWgsl}

@group(0) @binding(1) var<storage, read> stateBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> carrierBuffer: array<vec4<f32>>;

${blendStateSamplingWgsl}

var<workgroup> pickupSums: array<vec4<f32>, 64>;
var<workgroup> pickupTotals: array<f32, 64>;

@compute @workgroup_size(8, 8)
fn pickupMain(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(local_invocation_index) threadIndex: u32,
) {
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
      // Outside the authoritative document is not transparent pigment.
      // Clamp only the bilinear lookup so a valid edge tap cannot mix with
      // the zero-filled scratch texels that surround the document.
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

const SHAPE_MASK_UV_SCALE: f32 = ${SHAPE_MASK_FILTER_UV_SCALE};
const SHAPE_MASK_UV_OFFSET: f32 = ${SHAPE_MASK_FILTER_UV_OFFSET};

// These are pipeline constants, not per-pixel branches. The renderer creates
// four resident variants so Circle/Grain-off never carries the register and
// instruction pressure of the custom-shape and grain paths.
override blendCustomShape: bool = false;
override blendGrainEnabled: bool = false;

${blendStateSamplingWgsl}

struct LocalSample {
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

struct CustomSample {
  coverage: f32,
  uv: vec2<f32>,
  brushPixels: vec2<f32>,
};

fn localAt(
  documentPosition: vec2<f32>,
  interpolation: f32,
  halfSize: vec2<f32>,
  cosine: f32,
  sine: f32,
) -> LocalSample {
  let center = mix(blend.validAndFrom.zw, blend.toAndFromHalfSize.xy, interpolation);
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

fn customAt(
  documentPosition: vec2<f32>,
  interpolation: f32,
  halfSize: vec2<f32>,
  cosine: f32,
  sine: f32,
) -> CustomSample {
  let local = localAt(documentPosition, interpolation, halfSize, cosine, sine);
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
  let samplingUv = local.uv * SHAPE_MASK_UV_SCALE + vec2<f32>(SHAPE_MASK_UV_OFFSET);
  result.coverage = textureSampleLevel(shapeTexture, shapeSampler, samplingUv, 0.0).r;
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
      max(1.0, blend.grainAffineAndPhase.z) - 1.0
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

  // Grain assets are converted once at upload into a scalar R16F field.
  // Sampling RGB here silently attenuates that field to 0.299 × R because
  // the implicit G/B components of an R16F texture are zero.
  let source = sourceSample.r;
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

  // The dry planner currently emits constant size and angle inside one sweep.
  // Compute this basis once per output pixel instead of once for every one of
  // the 34 custom-shape candidates below.
  let constantHalfSize = max(blend.toAndFromHalfSize.zw, vec2<f32>(0.001));
  let constantAngle = blend.toHalfSizeAndAngles.z;
  let constantCosine = cos(constantAngle);
  let constantSine = sin(constantAngle);

  var coverage = 0.0;
  var bestInterpolation = closest;
  var bestLocal = localAt(
    documentPosition,
    closest,
    constantHalfSize,
    constantCosine,
    constantSine
  );

  if (!blendCustomShape) {
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
  } else {
    var selected = customAt(
      documentPosition,
      closest,
      constantHalfSize,
      constantCosine,
      constantSine
    );
    coverage = selected.coverage;
    bestLocal.uv = selected.uv;
    bestLocal.brushPixels = selected.brushPixels;

    for (var index = 0u; index <= 32u; index += 1u) {
      let interpolation = f32(index) / 32.0;
      let candidate = customAt(
        documentPosition,
        interpolation,
        constantHalfSize,
        constantCosine,
        constantSine
      );
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
    // The arc coordinate advances ~1 unit per pixel along the stroke.
    let antialiasWidth = 1.0;
    coverage *= 1.0 - smoothstep(
      support - antialiasWidth,
      support + antialiasWidth,
      phase
    );
  }

  var grainCoverage = 1.0;
  if (blendGrainEnabled) {
    var grainUv: vec2<f32>;
    var grainUvDx: vec2<f32>;
    var grainUvDy: vec2<f32>;
    if (blend.options.y == 2u) {
      // Use the same physical grain period for the dragged and rolling ends.
      // This keeps Scale active at Movement 0 and makes 100% exactly match the
      // Texturized document-space mapping.
      let movingUv = bestLocal.brushPixels * blend.grainControls.x + vec2<f32>(0.5);
      let angle = mix(
        blend.toHalfSizeAndAngles.z,
        blend.toHalfSizeAndAngles.w,
        bestInterpolation
      );
      let cosine = cos(angle);
      let sine = sin(angle);
      let movingUvDx = vec2<f32>(cosine, -sine) * blend.grainControls.x;
      let movingUvDy = vec2<f32>(sine, cosine) * blend.grainControls.x;
      let movement = clamp(blend.grainAffineAndPhase.y, 0.0, 1.0);
      let fixedUv = documentPosition * blend.grainControls.x;
      let fixedUvDx = vec2<f32>(blend.grainControls.x, 0.0);
      let fixedUvDy = vec2<f32>(0.0, blend.grainControls.x);
      grainUv = mix(movingUv, fixedUv, movement);
      grainUvDx = mix(movingUvDx, fixedUvDx, movement);
      grainUvDy = mix(movingUvDy, fixedUvDy, movement);
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
  if (finalCoverage > 0.0) {
    coverageBuffer[index] = max(coverageBuffer[index], finalCoverage);
  }
  // Paint 0 + Stretch 0 makes Blur a colorless Gaussian brush. Coverage must
  // still reach scatter, but redepositing the freshly picked-up carrier would
  // cover the Gaussian result and make the brush appear to do nothing.
  let blurAmount = clamp(blend.grainAffineAndPhase.w, 0.0, 1.0);
  let stretchAmount = clamp(blend.transportControls.w, 0.0, 1.0);
  let paintAmount = clamp(blend.grainControls.y, 0.0, 1.0);
  var pigmentDepositScale = 1.0 - blurAmount;
  if (
    blurAmount > 0.0
    && stretchAmount <= 0.0
    && paintAmount <= 0.0
  ) {
    pigmentDepositScale = 0.0;
  }
  let depositCoverage = clamp(
    finalCoverage * blend.transportControls.z * pigmentDepositScale,
    0.0,
    1.0
  );
  if (depositCoverage <= 0.0) {
    return;
  }

  let canvas = cleanState(pixel);
  let carrier = carrierBuffer[blend.slots.y];
  let loaded = vec4<f32>(clamp(blend.paintColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
  let pigment = mix(
    carrier,
    loaded,
    paintAmount
  );
  let mixed = mix(canvas, pigment, depositCoverage);
  let resultAlpha = clamp(mixed.a, 0.0, 1.0);
  var result = vec4<f32>(
    clamp(mixed.rgb, vec3<f32>(0.0), vec3<f32>(resultAlpha)),
    resultAlpha
  );
  if (resultAlpha <= 0.0) {
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
  return vec4<f32>(clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha)), alpha);
}
`;
