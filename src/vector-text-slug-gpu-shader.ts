/*
 * WGSL adaptation of the Slug reference coverage solver.
 *
 * Original algorithm/shaders: Copyright 2017 Eric Lengyel, MIT.
 * TypeScript source used for comparison: three-text 0.6.5, MIT.
 */

export const VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY =
  "webgpu-slug-source-clipper-effect-mesh-msaa4-stable-lines-v4" as const;
export const VECTOR_TEXT_SLUG_UNIFORM_FLOATS = 40;
export const VECTOR_TEXT_SLUG_UNIFORM_BYTES =
  VECTOR_TEXT_SLUG_UNIFORM_FLOATS * 4;

export const vectorTextSlugGpuShader = /* wgsl */ `
struct SlugUniforms {
  canvasAndViewRotation: vec4<f32>,
  viewCenterAndZoom: vec4<f32>,
  nodePositionAndRotation: vec4<f32>,
  scaleAndLocalOffset: vec4<f32>,
  color: vec4<f32>,
  targetOriginAndSize: vec4<f32>,
  shapeBounds: vec4<f32>,
  bandTransform: vec4<f32>,
  bandBasesAndCounts: vec4<u32>,
  textureLogWidths: vec4<u32>,
};

struct SlugVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) localPosition: vec2<f32>,
};

@group(0) @binding(0) var<uniform> slug: SlugUniforms;
@group(0) @binding(1) var curveTexture: texture_2d<f32>;
@group(0) @binding(2) var bandTexture: texture_2d<u32>;

fn localToClip(localPosition: vec2<f32>) -> vec4<f32> {
  let canvasSize = slug.canvasAndViewRotation.xy;
  let viewRotation = slug.canvasAndViewRotation.zw;
  let viewCenter = slug.viewCenterAndZoom.xy;
  let zoom = slug.viewCenterAndZoom.z;
  let nodePosition = slug.nodePositionAndRotation.xy;
  let nodeRotation = slug.nodePositionAndRotation.zw;
  let targetOrigin = slug.targetOriginAndSize.xy;
  let targetSize = slug.targetOriginAndSize.zw;
  let scaled = (
    localPosition + slug.scaleAndLocalOffset.yz
  ) * slug.scaleAndLocalOffset.x;
  let layerPosition = nodePosition + vec2<f32>(
    nodeRotation.x * scaled.x - nodeRotation.y * scaled.y,
    nodeRotation.y * scaled.x + nodeRotation.x * scaled.y
  );
  let layerDelta = layerPosition - viewCenter;
  let canvasPosition = canvasSize * 0.5 + zoom * vec2<f32>(
    viewRotation.x * layerDelta.x - viewRotation.y * layerDelta.y,
    viewRotation.y * layerDelta.x + viewRotation.x * layerDelta.y
  );
  let targetPosition = canvasPosition - targetOrigin;
  return vec4<f32>(
    targetPosition.x / targetSize.x * 2.0 - 1.0,
    1.0 - targetPosition.y / targetSize.y * 2.0,
    0.0,
    1.0
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> SlugVertexOutput {
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 1.0)
  );
  let localPixelsPerUnit = max(
    abs(slug.scaleAndLocalOffset.x * slug.viewCenterAndZoom.z),
    1.0e-8
  );
  let pad = 1.5 / localPixelsPerUnit;
  let bounds = slug.shapeBounds + vec4<f32>(-pad, -pad, pad, pad);
  let corner = corners[vertexIndex];
  let localPosition = mix(bounds.xy, bounds.zw, corner);
  var output: SlugVertexOutput;
  output.position = localToClip(localPosition);
  output.localPosition = localPosition;
  return output;
}

fn linearTextureLocation(linearIndex: u32, logWidth: u32) -> vec2<i32> {
  let mask = (1u << logWidth) - 1u;
  return vec2<i32>(
    i32(linearIndex & mask),
    i32(linearIndex >> logWidth)
  );
}

fn loadBand(linearIndex: u32) -> vec4<u32> {
  return textureLoad(
    bandTexture,
    linearTextureLocation(linearIndex, slug.textureLogWidths.y),
    0
  );
}

fn loadCurve(linearIndex: u32) -> vec4<f32> {
  return textureLoad(
    curveTexture,
    linearTextureLocation(linearIndex, slug.textureLogWidths.x),
    0
  );
}

fn calcRootCode(y1: f32, y2: f32, y3: f32) -> u32 {
  let i1 = bitcast<u32>(y1) >> 31u;
  let i2 = bitcast<u32>(y2) >> 30u;
  let i3 = bitcast<u32>(y3) >> 29u;
  var shift = (i2 & 2u) | (i1 & ~2u);
  shift = (i3 & 4u) | (shift & ~4u);
  return (0x2E74u >> shift) & 0x0101u;
}

fn solveHorizontalPolynomial(
  p12: vec4<f32>,
  p3: vec2<f32>
) -> vec2<f32> {
  let a = p12.xy - p12.zw * 2.0 + p3;
  let b = p12.xy - p12.zw;
  let linearScale = max(
    1.0,
    max(
      abs(p12.y - p12.w),
      max(abs(p12.w - p3.y), abs(p12.y - p3.y))
    )
  );
  // Midpoints that are exact in f64 need not remain exact after rgba32float
  // upload. Treat only a few f32 ulps of second difference as a line and use
  // endpoint interpolation, avoiding the unstable near-zero quadratic root.
  if (abs(a.y) <= linearScale / 1048576.0) {
    let denominator = p12.y - p3.y;
    if (abs(denominator) <= linearScale / 16777216.0) {
      return vec2<f32>(p12.x, p12.x);
    }
    let t = p12.y / denominator;
    let value = mix(p12.x, p3.x, t);
    return vec2<f32>(value, value);
  }
  let reciprocalA = 1.0 / a.y;
  let discriminant = sqrt(max(b.y * b.y - a.y * p12.y, 0.0));
  let first = (b.y - discriminant) * reciprocalA;
  let second = (b.y + discriminant) * reciprocalA;
  return vec2<f32>(
    (a.x * first - b.x * 2.0) * first + p12.x,
    (a.x * second - b.x * 2.0) * second + p12.x
  );
}

fn solveVerticalPolynomial(
  p12: vec4<f32>,
  p3: vec2<f32>
) -> vec2<f32> {
  let a = p12.xy - p12.zw * 2.0 + p3;
  let b = p12.xy - p12.zw;
  let linearScale = max(
    1.0,
    max(
      abs(p12.x - p12.z),
      max(abs(p12.z - p3.x), abs(p12.x - p3.x))
    )
  );
  if (abs(a.x) <= linearScale / 1048576.0) {
    let denominator = p12.x - p3.x;
    if (abs(denominator) <= linearScale / 16777216.0) {
      return vec2<f32>(p12.y, p12.y);
    }
    let t = p12.x / denominator;
    let value = mix(p12.y, p3.y, t);
    return vec2<f32>(value, value);
  }
  let reciprocalA = 1.0 / a.x;
  let discriminant = sqrt(max(b.x * b.x - a.x * p12.x, 0.0));
  let first = (b.x - discriminant) * reciprocalA;
  let second = (b.x + discriminant) * reciprocalA;
  return vec2<f32>(
    (a.y * first - b.y * 2.0) * first + p12.y,
    (a.y * second - b.y * 2.0) * second + p12.y
  );
}

fn slugCoverage(renderCoordinate: vec2<f32>) -> f32 {
  let localPerPixelX = max(
    length(vec2<f32>(
      dpdx(renderCoordinate.x),
      dpdy(renderCoordinate.x)
    )),
    1.0 / 65536.0
  );
  let localPerPixelY = max(
    length(vec2<f32>(
      dpdx(renderCoordinate.y),
      dpdy(renderCoordinate.y)
    )),
    1.0 / 65536.0
  );
  let pixelsPerLocal = vec2<f32>(
    1.0 / localPerPixelX,
    1.0 / localPerPixelY
  );
  let bandCounts = slug.bandBasesAndCounts.zw;
  let bandMaximum = vec2<i32>(
    i32(max(1u, bandCounts.y) - 1u),
    i32(max(1u, bandCounts.x) - 1u)
  );
  let bandIndex = clamp(
    vec2<i32>(
      renderCoordinate * slug.bandTransform.xy
      + slug.bandTransform.zw
    ),
    vec2<i32>(0),
    bandMaximum
  );

  var horizontalCoverage = 0.0;
  var horizontalWeight = 0.0;
  let horizontalHeader = loadBand(
    slug.bandBasesAndCounts.x + u32(bandIndex.y)
  );
  for (
    var curveIndex = 0u;
    curveIndex < horizontalHeader.x;
    curveIndex += 1u
  ) {
    let curveLinear = loadBand(horizontalHeader.y + curveIndex).x;
    let p12 = loadCurve(curveLinear)
      - vec4<f32>(renderCoordinate, renderCoordinate);
    let p3 = loadCurve(curveLinear + 1u).xy - renderCoordinate;
    if (
      max(max(p12.x, p12.z), p3.x) * pixelsPerLocal.x < -0.5
    ) {
      break;
    }
    let code = calcRootCode(p12.y, p12.w, p3.y);
    if (code != 0u) {
      let roots = solveHorizontalPolynomial(p12, p3) * pixelsPerLocal.x;
      if ((code & 1u) != 0u) {
        horizontalCoverage += clamp(roots.x + 0.5, 0.0, 1.0);
        horizontalWeight = max(
          horizontalWeight,
          clamp(1.0 - abs(roots.x) * 2.0, 0.0, 1.0)
        );
      }
      if (code > 1u) {
        horizontalCoverage -= clamp(roots.y + 0.5, 0.0, 1.0);
        horizontalWeight = max(
          horizontalWeight,
          clamp(1.0 - abs(roots.y) * 2.0, 0.0, 1.0)
        );
      }
    }
  }

  var verticalCoverage = 0.0;
  var verticalWeight = 0.0;
  let verticalHeader = loadBand(
    slug.bandBasesAndCounts.y + u32(bandIndex.x)
  );
  for (
    var curveIndex = 0u;
    curveIndex < verticalHeader.x;
    curveIndex += 1u
  ) {
    let curveLinear = loadBand(verticalHeader.y + curveIndex).x;
    let p12 = loadCurve(curveLinear)
      - vec4<f32>(renderCoordinate, renderCoordinate);
    let p3 = loadCurve(curveLinear + 1u).xy - renderCoordinate;
    if (
      max(max(p12.y, p12.w), p3.y) * pixelsPerLocal.y < -0.5
    ) {
      break;
    }
    let code = calcRootCode(p12.x, p12.z, p3.x);
    if (code != 0u) {
      let roots = solveVerticalPolynomial(p12, p3) * pixelsPerLocal.y;
      if ((code & 1u) != 0u) {
        verticalCoverage -= clamp(roots.x + 0.5, 0.0, 1.0);
        verticalWeight = max(
          verticalWeight,
          clamp(1.0 - abs(roots.x) * 2.0, 0.0, 1.0)
        );
      }
      if (code > 1u) {
        verticalCoverage += clamp(roots.y + 0.5, 0.0, 1.0);
        verticalWeight = max(
          verticalWeight,
          clamp(1.0 - abs(roots.y) * 2.0, 0.0, 1.0)
        );
      }
    }
  }

  let coverage = max(
    abs(
      horizontalCoverage * horizontalWeight
      + verticalCoverage * verticalWeight
    ) / max(
      horizontalWeight + verticalWeight,
      1.0 / 65536.0
    ),
    min(abs(horizontalCoverage), abs(verticalCoverage))
  );
  return clamp(coverage, 0.0, 1.0);
}

@fragment
fn fragmentMain(
  input: SlugVertexOutput
) -> @location(0) vec4<f32> {
  let coverage = slugCoverage(input.localPosition);
  let alpha = coverage * slug.color.a;
  return vec4<f32>(slug.color.rgb * alpha, alpha);
}
`;
