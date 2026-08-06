import { vectorTextSlugGpuShader } from "./vector-text-slug-gpu-shader";

export const VECTOR_TEXT_INNER_SHADOW_GPU_STRATEGY =
  "slug-analytic-fill-times-inverse-shifted-mask-v1" as const;

export const vectorTextInnerShadowGpuShader = /* wgsl */ `
${vectorTextSlugGpuShader}

@group(1) @binding(0) var innerBlurredMask: texture_2d<f32>;
@group(1) @binding(1) var innerBlurredSampler: sampler;

@vertex
fn innerShadowBlurVertexMain(
  @builtin(vertex_index) vertexIndex: u32
) -> SlugVertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 1.0)
  );
  // shapeBounds is the absolute local-space blur ROI. Slug curves are packed
  // around their own origin, so coverage uses the origin-relative coordinate
  // while localToClip restores that origin for the node transform.
  let absolutePosition = mix(
    slug.shapeBounds.xy,
    slug.shapeBounds.zw,
    corners[vertexIndex]
  );
  let localPosition = absolutePosition - slug.scaleAndLocalOffset.yz;
  var output: SlugVertexOutput;
  output.position = localToClip(localPosition);
  output.localPosition = localPosition;
  return output;
}

fn innerShadowColor(coverage: f32) -> vec4<f32> {
  let alpha = clamp(coverage, 0.0, 1.0) * slug.color.a;
  return vec4<f32>(slug.color.rgb * alpha, alpha);
}

@fragment
fn innerShadowDirectFragmentMain(
  input: SlugVertexOutput
) -> @location(0) vec4<f32> {
  let fillCoverage = slugCoverage(input.localPosition);
  let shiftedFillCoverage = slugCoverage(
    input.localPosition - slug.effectSampleOffset.xy
  );
  return innerShadowColor(
    fillCoverage * (1.0 - shiftedFillCoverage)
  );
}

@fragment
fn innerShadowBlurFragmentMain(
  input: SlugVertexOutput
) -> @location(0) vec4<f32> {
  let fillCoverage = slugCoverage(input.localPosition);
  let absolutePosition = input.localPosition + slug.scaleAndLocalOffset.yz;
  let shiftedAbsolutePosition =
    absolutePosition - slug.effectSampleOffset.xy;
  let blurSpan = max(
    slug.shapeBounds.zw - slug.shapeBounds.xy,
    vec2<f32>(1.0e-8)
  );
  let uv = (shiftedAbsolutePosition - slug.shapeBounds.xy) / blurSpan;
  var shiftedBlurredFill = 0.0;
  if (all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0))) {
    shiftedBlurredFill = textureSampleLevel(
      innerBlurredMask,
      innerBlurredSampler,
      uv,
      0.0
    ).r;
  }
  return innerShadowColor(
    fillCoverage * (1.0 - clamp(shiftedBlurredFill, 0.0, 1.0))
  );
}
`;
