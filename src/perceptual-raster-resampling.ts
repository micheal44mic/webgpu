/**
 * Display/resampling-only transfer policy.
 *
 * Authoritative document pixels stay linear-premultiplied RGBA. Only bounded
 * SDR color is filtered in encoded sRGB; alpha/coverage, source-over and the
 * signed/HDR residual remain linear. In particular, minification must not
 * change the density of translucent paint merely because the view crossed a
 * LOD boundary. Keeping the split here prevents presentation policy from
 * leaking into Paint, Blend, History or project storage.
 */
export const PERCEPTUAL_RASTER_RESAMPLING_STRATEGY =
  "bounded-sdr-encoded-srgb-filter-linear-alpha-source-over-extended-residual-v2" as const;

export type PerceptualRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

type MutablePerceptualRgba = [number, number, number, number];

interface PreparedPerceptualSample {
  readonly encoded: PerceptualRgba;
  readonly extendedResidual: PerceptualRgba;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function perceptualSrgbToLinearChannel(value: number): number {
  const bounded = clamp(value, 0, 1);
  return bounded <= 0.04045
    ? bounded / 12.92
    : ((bounded + 0.055) / 1.055) ** 2.4;
}

export function perceptualLinearToSrgbChannel(value: number): number {
  const bounded = clamp(value, 0, 1);
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function preparePerceptualSample(value: PerceptualRgba): PreparedPerceptualSample {
  const alpha = clamp(value[3], 0, 1);
  const boundedPremultiplied = [
    clamp(value[0], 0, alpha),
    clamp(value[1], 0, alpha),
    clamp(value[2], 0, alpha),
  ] as const;
  const encoded = alpha > 0
    ? [
        perceptualLinearToSrgbChannel(boundedPremultiplied[0] / alpha) * alpha,
        perceptualLinearToSrgbChannel(boundedPremultiplied[1] / alpha) * alpha,
        perceptualLinearToSrgbChannel(boundedPremultiplied[2] / alpha) * alpha,
        alpha,
      ] as const
    : [0, 0, 0, 0] as const;
  return {
    encoded,
    extendedResidual: [
      value[0] - boundedPremultiplied[0],
      value[1] - boundedPremultiplied[1],
      value[2] - boundedPremultiplied[2],
      value[3] - alpha,
    ],
  };
}

function resolvePreparedPerceptualSample(
  encoded: PerceptualRgba,
  extendedResidual: PerceptualRgba,
): PerceptualRgba {
  const alpha = clamp(encoded[3], 0, 1);
  const boundedPremultiplied = alpha > 0
    ? [
        perceptualSrgbToLinearChannel(encoded[0] / alpha) * alpha,
        perceptualSrgbToLinearChannel(encoded[1] / alpha) * alpha,
        perceptualSrgbToLinearChannel(encoded[2] / alpha) * alpha,
      ] as const
    : [0, 0, 0] as const;
  return [
    boundedPremultiplied[0] + extendedResidual[0],
    boundedPremultiplied[1] + extendedResidual[1],
    boundedPremultiplied[2] + extendedResidual[2],
    alpha + extendedResidual[3],
  ];
}

/** Reference oracle used by verifiers and Labs for arbitrary weighted taps. */
export function perceptualResolveWeightedSamples(
  samples: readonly PerceptualRgba[],
  weights: readonly number[],
): PerceptualRgba {
  if (samples.length === 0 || samples.length !== weights.length) {
    throw new RangeError("Campioni e pesi percettivi devono essere non vuoti e allineati.");
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(weightSum) || weightSum <= 0) {
    throw new RangeError("La somma dei pesi percettivi deve essere positiva e finita.");
  }
  const encoded: MutablePerceptualRgba = [0, 0, 0, 0];
  const residual: MutablePerceptualRgba = [0, 0, 0, 0];
  for (let index = 0; index < samples.length; index += 1) {
    const weight = weights[index] / weightSum;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError("I pesi percettivi devono essere finiti e non negativi.");
    }
    const prepared = preparePerceptualSample(samples[index]);
    for (let channel = 0; channel < 4; channel += 1) {
      encoded[channel] += prepared.encoded[channel] * weight;
      residual[channel] += prepared.extendedResidual[channel] * weight;
    }
  }
  return resolvePreparedPerceptualSample(encoded, residual);
}

export function perceptualReduceFour(
  p00: PerceptualRgba,
  p10: PerceptualRgba,
  p01: PerceptualRgba,
  p11: PerceptualRgba,
): PerceptualRgba {
  return perceptualResolveWeightedSamples([p00, p10, p01, p11], [1, 1, 1, 1]);
}

/** Presentation-only interpolation between two linear-premultiplied pixels. */
export function perceptualInterpolate(
  first: PerceptualRgba,
  second: PerceptualRgba,
  amount: number,
): PerceptualRgba {
  const boundedAmount = clamp(amount, 0, 1);
  return perceptualResolveWeightedSamples(
    [first, second],
    [1 - boundedAmount, boundedAmount],
  );
}

/** CPU oracle matching `perceptualInterpolateFour` in the shared WGSL. */
export function perceptualInterpolateFour(
  p00: PerceptualRgba,
  p10: PerceptualRgba,
  p01: PerceptualRgba,
  p11: PerceptualRgba,
  amount: readonly [number, number],
): PerceptualRgba {
  const horizontal = clamp(amount[0], 0, 1);
  const vertical = clamp(amount[1], 0, 1);
  return perceptualResolveWeightedSamples(
    [p00, p10, p01, p11],
    [
      (1 - horizontal) * (1 - vertical),
      horizontal * (1 - vertical),
      (1 - horizontal) * vertical,
      horizontal * vertical,
    ],
  );
}

/** Stable premultiplied source-over shared by CPU regression oracles. */
export function linearPremultipliedSourceOver(
  source: PerceptualRgba,
  destination: PerceptualRgba,
): PerceptualRgba {
  return [
    source[0] + destination[0] * (1 - source[3]),
    source[1] + destination[1] * (1 - source[3]),
    source[2] + destination[2] * (1 - source[3]),
    source[3] + destination[3] * (1 - source[3]),
  ];
}

/** Legacy 100%+ display conversion: composite in linear light, then encode. */
export function linearCompositeOverSrgbBackground(
  paint: PerceptualRgba,
  backgroundSrgb: readonly [number, number, number],
): readonly [number, number, number] {
  const alpha = clamp(paint[3], 0, 1);
  return [
    perceptualLinearToSrgbChannel(
      paint[0] + perceptualSrgbToLinearChannel(backgroundSrgb[0]) * (1 - alpha),
    ),
    perceptualLinearToSrgbChannel(
      paint[1] + perceptualSrgbToLinearChannel(backgroundSrgb[1]) * (1 - alpha),
    ),
    perceptualLinearToSrgbChannel(
      paint[2] + perceptualSrgbToLinearChannel(backgroundSrgb[2]) * (1 - alpha),
    ),
  ];
}

/**
 * Final presentation keeps the established linear source-over law at every
 * zoom. Perceptual minification is already encoded in the filtered paint;
 * applying gamma-space compositing here as well would darken translucent
 * regions when crossing below 100%.
 */
export function rasterPresentationCompositeOverSrgbBackground(
  paint: PerceptualRgba,
  backgroundSrgb: readonly [number, number, number],
): readonly [number, number, number] {
  return linearCompositeOverSrgbBackground(paint, backgroundSrgb);
}

const perceptualRasterTransferShader = /* wgsl */ `
fn perceptualSrgbToLinearChannel(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  if (bounded <= 0.04045) {
    return bounded / 12.92;
  }
  return pow((bounded + 0.055) / 1.055, 2.4);
}

fn perceptualLinearToSrgbChannel(value: f32) -> f32 {
  let bounded = clamp(value, 0.0, 1.0);
  if (bounded <= 0.0031308) {
    return bounded * 12.92;
  }
  return 1.055 * pow(bounded, 1.0 / 2.4) - 0.055;
}

fn perceptualSrgbToLinear(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    perceptualSrgbToLinearChannel(value.r),
    perceptualSrgbToLinearChannel(value.g),
    perceptualSrgbToLinearChannel(value.b)
  );
}

fn perceptualLinearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    perceptualLinearToSrgbChannel(value.r),
    perceptualLinearToSrgbChannel(value.g),
    perceptualLinearToSrgbChannel(value.b)
  );
}
`;

const perceptualRasterPreparedSampleShader = /* wgsl */ `
struct PerceptualResamplingSample {
  encoded: vec4<f32>,
  extendedResidual: vec4<f32>,
};

fn perceptualPrepareSample(value: vec4<f32>) -> PerceptualResamplingSample {
  let alpha = clamp(value.a, 0.0, 1.0);
  let boundedPremultiplied = clamp(value.rgb, vec3<f32>(0.0), vec3<f32>(alpha));
  var encodedPremultiplied = vec3<f32>(0.0);
  if (alpha > 0.0) {
    encodedPremultiplied = perceptualLinearToSrgb(boundedPremultiplied / alpha) * alpha;
  }
  var result: PerceptualResamplingSample;
  result.encoded = vec4<f32>(encodedPremultiplied, alpha);
  result.extendedResidual = value - vec4<f32>(boundedPremultiplied, alpha);
  return result;
}

fn perceptualResolveSample(value: PerceptualResamplingSample) -> vec4<f32> {
  let alpha = clamp(value.encoded.a, 0.0, 1.0);
  var boundedPremultiplied = vec3<f32>(0.0);
  if (alpha > 0.0) {
    let straightEncoded = clamp(
      value.encoded.rgb / alpha,
      vec3<f32>(0.0),
      vec3<f32>(1.0)
    );
    boundedPremultiplied = perceptualSrgbToLinear(straightEncoded) * alpha;
  }
  return vec4<f32>(boundedPremultiplied, alpha) + value.extendedResidual;
}
`;

const perceptualRasterReductionShader = /* wgsl */ `
fn perceptualReduceFour(
  p00: vec4<f32>,
  p10: vec4<f32>,
  p01: vec4<f32>,
  p11: vec4<f32>
) -> vec4<f32> {
  let s00 = perceptualPrepareSample(p00);
  let s10 = perceptualPrepareSample(p10);
  let s01 = perceptualPrepareSample(p01);
  let s11 = perceptualPrepareSample(p11);
  var reduced: PerceptualResamplingSample;
  reduced.encoded = (s00.encoded + s10.encoded + s01.encoded + s11.encoded) * 0.25;
  reduced.extendedResidual = (
    s00.extendedResidual
    + s10.extendedResidual
    + s01.extendedResidual
    + s11.extendedResidual
  ) * 0.25;
  return perceptualResolveSample(reduced);
}
`;

const perceptualRasterPreparedMixShader = /* wgsl */ `
fn perceptualMixPreparedSamples(
  first: PerceptualResamplingSample,
  second: PerceptualResamplingSample,
  amount: f32
) -> PerceptualResamplingSample {
  let boundedAmount = clamp(amount, 0.0, 1.0);
  var mixed: PerceptualResamplingSample;
  mixed.encoded = mix(first.encoded, second.encoded, boundedAmount);
  mixed.extendedResidual = mix(
    first.extendedResidual,
    second.extendedResidual,
    boundedAmount
  );
  return mixed;
}
`;

const perceptualRasterInterpolationShader = /* wgsl */ `
fn perceptualInterpolate(
  first: vec4<f32>,
  second: vec4<f32>,
  amount: f32
) -> vec4<f32> {
  return perceptualResolveSample(perceptualMixPreparedSamples(
    perceptualPrepareSample(first),
    perceptualPrepareSample(second),
    amount
  ));
}

fn perceptualInterpolateFour(
  p00: vec4<f32>,
  p10: vec4<f32>,
  p01: vec4<f32>,
  p11: vec4<f32>,
  amount: vec2<f32>
) -> vec4<f32> {
  let top = perceptualMixPreparedSamples(
    perceptualPrepareSample(p00),
    perceptualPrepareSample(p10),
    amount.x
  );
  let bottom = perceptualMixPreparedSamples(
    perceptualPrepareSample(p01),
    perceptualPrepareSample(p11),
    amount.x
  );
  return perceptualResolveSample(
    perceptualMixPreparedSamples(top, bottom, amount.y)
  );
}
`;

const perceptualRasterSourceOverShader = /* wgsl */ `
fn linearPremultipliedSourceOver(
  source: vec4<f32>,
  destination: vec4<f32>
) -> vec4<f32> {
  return source + destination * (1.0 - source.a);
}
`;

const perceptualRasterPresentationShader = /* wgsl */ `
fn linearCompositeOverSrgbBackground(
  paint: vec4<f32>,
  backgroundSrgb: vec3<f32>
) -> vec3<f32> {
  let alpha = clamp(paint.a, 0.0, 1.0);
  let backgroundLinear = perceptualSrgbToLinear(backgroundSrgb);
  return perceptualLinearToSrgb(
    paint.rgb + backgroundLinear * (1.0 - alpha)
  );
}

fn rasterPresentationCompositeOverSrgbBackground(
  paint: vec4<f32>,
  backgroundSrgb: vec3<f32>
) -> vec3<f32> {
  return linearCompositeOverSrgbBackground(paint, backgroundSrgb);
}
`;

const perceptualRasterTextureSamplingShader = /* wgsl */ `
fn perceptualLoadPrepared(
  sourceTexture: texture_2d<f32>,
  coordinate: vec2<i32>,
  mipLevel: u32,
  clampToEdge: bool
) -> PerceptualResamplingSample {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, mipLevel));
  if (!clampToEdge && (
    any(coordinate < vec2<i32>(0)) || any(coordinate >= dimensions)
  )) {
    return perceptualPrepareSample(vec4<f32>(0.0));
  }
  let safeCoordinate = clamp(coordinate, vec2<i32>(0), dimensions - vec2<i32>(1));
  return perceptualPrepareSample(
    textureLoad(sourceTexture, safeCoordinate, i32(mipLevel))
  );
}

fn perceptualSampleBilinearPrepared(
  sourceTexture: texture_2d<f32>,
  uv: vec2<f32>,
  mipLevel: u32,
  clampToEdge: bool
) -> PerceptualResamplingSample {
  let dimensions = vec2<f32>(textureDimensions(sourceTexture, mipLevel));
  let texelPosition = uv * dimensions - vec2<f32>(0.5);
  let base = vec2<i32>(floor(texelPosition));
  let fraction = fract(texelPosition);
  let exactX = fraction.x <= 0.000001;
  let exactY = fraction.y <= 0.000001;
  if (exactX && exactY) {
    return perceptualLoadPrepared(
      sourceTexture,
      base,
      mipLevel,
      clampToEdge
    );
  }
  if (exactX) {
    return perceptualMixPreparedSamples(
      perceptualLoadPrepared(sourceTexture, base, mipLevel, clampToEdge),
      perceptualLoadPrepared(
        sourceTexture,
        base + vec2<i32>(0, 1),
        mipLevel,
        clampToEdge
      ),
      fraction.y
    );
  }
  if (exactY) {
    return perceptualMixPreparedSamples(
      perceptualLoadPrepared(sourceTexture, base, mipLevel, clampToEdge),
      perceptualLoadPrepared(
        sourceTexture,
        base + vec2<i32>(1, 0),
        mipLevel,
        clampToEdge
      ),
      fraction.x
    );
  }
  let top = perceptualMixPreparedSamples(
    perceptualLoadPrepared(sourceTexture, base, mipLevel, clampToEdge),
    perceptualLoadPrepared(
      sourceTexture,
      base + vec2<i32>(1, 0),
      mipLevel,
      clampToEdge
    ),
    fraction.x
  );
  let bottom = perceptualMixPreparedSamples(
    perceptualLoadPrepared(
      sourceTexture,
      base + vec2<i32>(0, 1),
      mipLevel,
      clampToEdge
    ),
    perceptualLoadPrepared(
      sourceTexture,
      base + vec2<i32>(1, 1),
      mipLevel,
      clampToEdge
    ),
    fraction.x
  );
  return perceptualMixPreparedSamples(top, bottom, fraction.y);
}

fn perceptualSampleBilinear(
  sourceTexture: texture_2d<f32>,
  uv: vec2<f32>,
  mipLevel: u32,
  clampToEdge: bool
) -> vec4<f32> {
  return perceptualResolveSample(
    perceptualSampleBilinearPrepared(
      sourceTexture,
      uv,
      mipLevel,
      clampToEdge
    )
  );
}

fn perceptualSampleTrilinear(
  sourceTexture: texture_2d<f32>,
  uv: vec2<f32>,
  mipLevel: f32,
  clampToEdge: bool
) -> vec4<f32> {
  let maximumLevel = textureNumLevels(sourceTexture) - 1u;
  let boundedLevel = clamp(mipLevel, 0.0, f32(maximumLevel));
  let lowerLevel = u32(floor(boundedLevel));
  let upperLevel = min(lowerLevel + 1u, maximumLevel);
  let lower = perceptualSampleBilinearPrepared(
    sourceTexture,
    uv,
    lowerLevel,
    clampToEdge
  );
  let levelFraction = fract(boundedLevel);
  if (upperLevel == lowerLevel || levelFraction <= 0.000001) {
    return perceptualResolveSample(lower);
  }
  let upper = perceptualSampleBilinearPrepared(
    sourceTexture,
    uv,
    upperLevel,
    clampToEdge
  );
  return perceptualResolveSample(
    perceptualMixPreparedSamples(lower, upper, levelFraction)
  );
}

fn perceptualMipLevelFromGradients(
  sourceTexture: texture_2d<f32>,
  uvDx: vec2<f32>,
  uvDy: vec2<f32>
) -> f32 {
  let baseDimensions = vec2<f32>(textureDimensions(sourceTexture, 0));
  let footprint = max(
    length(uvDx * baseDimensions),
    length(uvDy * baseDimensions)
  );
  let maximumLevel = f32(textureNumLevels(sourceTexture) - 1u);
  return clamp(log2(max(footprint, 1.0)), 0.0, maximumLevel);
}
`;

export interface PerceptualRasterShaderFeatures {
  readonly preparedSamples?: boolean;
  readonly reduceFour?: boolean;
  readonly interpolate?: boolean;
  readonly sourceOver?: boolean;
  readonly presentation?: boolean;
  readonly sampling?: boolean;
}

/**
 * Builds the smallest exact WGSL contract required by one shader module.
 * WebGPU has no source-level imports: interpolating the historical all-in-one
 * string made every backend parse and optimize reducers, presentation and
 * manual texture sampling even when an entry point used only one operation.
 * This composition changes no math; it only removes unused source before the
 * browser hands WGSL to Metal, D3D12 or Vulkan.
 */
export function perceptualRasterShaderSource(
  features: Readonly<PerceptualRasterShaderFeatures>,
): string {
  const preparedSamples = features.preparedSamples === true
    || features.reduceFour === true
    || features.interpolate === true
    || features.sampling === true;
  const preparedMix = features.interpolate === true || features.sampling === true;
  const transfer = preparedSamples || features.presentation === true;
  return [
    transfer ? perceptualRasterTransferShader : "",
    preparedSamples ? perceptualRasterPreparedSampleShader : "",
    features.reduceFour ? perceptualRasterReductionShader : "",
    preparedMix ? perceptualRasterPreparedMixShader : "",
    features.interpolate ? perceptualRasterInterpolationShader : "",
    features.sourceOver ? perceptualRasterSourceOverShader : "",
    features.presentation ? perceptualRasterPresentationShader : "",
    features.sampling ? perceptualRasterTextureSamplingShader : "",
  ].filter((source) => source.length > 0).join("\n");
}

/** Shared arithmetic-only WGSL retained as the complete public contract. */
export const perceptualRasterResamplingShader = perceptualRasterShaderSource({
  reduceFour: true,
  interpolate: true,
  sourceOver: true,
  presentation: true,
});

/** Complete sampling contract retained for compatibility and verifier probes. */
export const perceptualRasterSamplingShader = perceptualRasterShaderSource({
  reduceFour: true,
  interpolate: true,
  sourceOver: true,
  presentation: true,
  sampling: true,
});
