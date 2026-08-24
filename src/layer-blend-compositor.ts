import {
  DEFAULT_LAYER_BLEND_MODE,
  LAYER_BLEND_MODE_CODES,
  LAYER_BLEND_MODE_WGSL,
  blendLayerPremultipliedLinear,
  dissolveLayerSourcePremultipliedLinear,
  normalizeLayerBlendMode,
  type LayerBlendDocumentPixel,
  type LayerBlendMode,
  type LinearPremultipliedRgba,
} from "./layer-blend-modes.ts";

/**
 * Reusable two-input GPU compositor for viewport-sized raster surfaces.
 *
 * Both inputs and the render target contain linear-light premultiplied RGBA.
 * Non-Normal blend functions are evaluated by LAYER_BLEND_MODE_WGSL on
 * unassociated sRGB, while Porter-Duff coverage remains linear and
 * premultiplied. Source opacity must already be baked into the source texel.
 */
export const LAYER_BLEND_COMPOSITOR_STRATEGY =
  "viewport-textureload-w3c-over-clipping-atop-document-anchored-dissolve-v3" as const;

export const LAYER_BLEND_COMPOSITOR_OPERATOR_CODES = {
  "source-over": 0,
  "source-atop": 1,
} as const;

export type LayerBlendCompositeOperator =
  keyof typeof LAYER_BLEND_COMPOSITOR_OPERATOR_CODES;

/** Stable uniform ABI: four u32 words, suitable for one uniform binding. */
export const LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE = 16 as const;
export const LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_STRIDE = 16 as const;
export const LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE = 4 as const;
export const LAYER_BLEND_COMPOSITOR_MODE_BYTE_OFFSET = 0 as const;
export const LAYER_BLEND_COMPOSITOR_OPERATOR_BYTE_OFFSET = 4 as const;

/**
 * Writes one compositor uniform record without allocating. The two reserved
 * words are always cleared so a future ABI extension starts deterministically.
 */
export function writeLayerBlendCompositorUniforms(
  target: Uint32Array,
  mode: LayerBlendMode = DEFAULT_LAYER_BLEND_MODE,
  operator: LayerBlendCompositeOperator = "source-over",
  wordOffset = 0,
): Uint32Array {
  if (!Number.isSafeInteger(wordOffset) || wordOffset < 0) {
    throw new RangeError("layer blend compositor wordOffset must be a non-negative integer");
  }
  if (target.length - wordOffset < LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE) {
    throw new RangeError("layer blend compositor uniform target is smaller than 16 bytes");
  }
  const normalizedMode = normalizeLayerBlendMode(mode);
  target[wordOffset] = LAYER_BLEND_MODE_CODES[normalizedMode];
  target[wordOffset + 1] = LAYER_BLEND_COMPOSITOR_OPERATOR_CODES[operator];
  target[wordOffset + 2] = 0;
  target[wordOffset + 3] = 0;
  return target;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const sanitizePremultiplied = (
  input: LinearPremultipliedRgba,
): LinearPremultipliedRgba => {
  const alpha = clamp01(input[3]);
  return [
    Math.min(alpha, Math.max(0, input[0])),
    Math.min(alpha, Math.max(0, input[1])),
    Math.min(alpha, Math.max(0, input[2])),
    alpha,
  ];
};

/**
 * CPU reference for the clipping operator used by the shader. This is not a
 * rendering fallback. It exists for deterministic tests and diagnostics.
 *
 * A clipping child changes the parent's unassociated color while retaining the
 * parent's matte. Therefore the overlap color is B(Cb,Cs) directly and the
 * result is `As * Ab * B(Cb,Cs) + cb * (1 - As)`, with alpha `Ab`.
 *
 * This is deliberately the matte-preserving semantics of a clipping layer,
 * not W3C's general "blend first, then source-atop" group equation (which
 * mixes a source-only term into a partially transparent parent's edge).
 */
export function blendLayerPremultipliedLinearSourceAtop(
  backdropInput: LinearPremultipliedRgba,
  sourceInput: LinearPremultipliedRgba,
  mode: LayerBlendMode = DEFAULT_LAYER_BLEND_MODE,
  documentPixel: LayerBlendDocumentPixel = [0, 0],
): LinearPremultipliedRgba {
  const backdrop = sanitizePremultiplied(backdropInput);
  const sanitizedSource = sanitizePremultiplied(sourceInput);
  const source = mode === "dissolve"
    ? dissolveLayerSourcePremultipliedLinear(sanitizedSource, documentPixel)
    : sanitizedSource;
  const backdropAlpha = backdrop[3];
  const sourceOnlyCoverage = 1 - backdropAlpha;
  const sourceOver = blendLayerPremultipliedLinear(
    backdrop,
    source,
    mode === "dissolve" ? "normal" : mode,
    documentPixel,
  );
  return [
    Math.min(backdropAlpha, Math.max(0, sourceOver[0] - source[0] * sourceOnlyCoverage)),
    Math.min(backdropAlpha, Math.max(0, sourceOver[1] - source[1] * sourceOnlyCoverage)),
    Math.min(backdropAlpha, Math.max(0, sourceOver[2] - source[2] * sourceOnlyCoverage)),
    backdropAlpha,
  ];
}

/** Pure CPU oracle matching the shader's dynamic operator selection. */
export function compositeLayerPremultipliedLinear(
  backdrop: LinearPremultipliedRgba,
  source: LinearPremultipliedRgba,
  mode: LayerBlendMode = DEFAULT_LAYER_BLEND_MODE,
  operator: LayerBlendCompositeOperator = "source-over",
  documentPixel: LayerBlendDocumentPixel = [0, 0],
): LinearPremultipliedRgba {
  return operator === "source-atop"
    ? blendLayerPremultipliedLinearSourceAtop(backdrop, source, mode, documentPixel)
    : blendLayerPremultipliedLinear(backdrop, source, mode, documentPixel);
}

/**
 * Bindings:
 *   0 = backdrop texture (linear premultiplied RGBA)
 *   1 = source texture (linear premultiplied RGBA)
 *   2 = LayerBlendCompositorUniforms
 *   3 = viewport state used only to map framebuffer pixels to document pixels
 *
 * The render target is deliberately not sampled: callers can ping-pong two
 * viewport textures without a read/write attachment hazard. Both textures are
 * loaded at the exact framebuffer pixel, so no sampler or filtering can alter
 * stored texels. Normal takes the conversion-free fast path in both operators.
 */
export const LAYER_BLEND_COMPOSITOR_WGSL = /* wgsl */ `
${LAYER_BLEND_MODE_WGSL}

const LAYER_BLEND_COMPOSITOR_SOURCE_OVER: u32 = 0u;
const LAYER_BLEND_COMPOSITOR_SOURCE_ATOP: u32 = 1u;

struct LayerBlendCompositorUniforms {
  blendMode: u32,
  compositeOperator: u32,
  reserved0: u32,
  reserved1: u32,
};

struct LayerBlendViewportUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  _checkerSize: f32,
};

@group(0) @binding(0) var layerBlendBackdropTexture: texture_2d<f32>;
@group(0) @binding(1) var layerBlendSourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> layerBlendCompositor: LayerBlendCompositorUniforms;
@group(0) @binding(3) var<uniform> layerBlendViewport: LayerBlendViewportUniforms;

fn layerBlendDocumentPixel(fragmentPosition: vec2<f32>) -> vec2<i32> {
  let displayOffset = (
    fragmentPosition - layerBlendViewport.canvasSize * 0.5
  ) / max(layerBlendViewport.zoom, 0.000001);
  let documentOffset = vec2<f32>(
    layerBlendViewport.viewRotation.x * displayOffset.x
      + layerBlendViewport.viewRotation.y * displayOffset.y,
    -layerBlendViewport.viewRotation.y * displayOffset.x
      + layerBlendViewport.viewRotation.x * displayOffset.y,
  );
  return vec2<i32>(floor(layerBlendViewport.viewCenter + documentOffset));
}

fn layerBlendPremultipliedLinearSourceAtop(
  backdropInput: vec4<f32>,
  sourceInput: vec4<f32>,
  mode: u32,
  documentPixel: vec2<i32>,
) -> vec4<f32> {
  let backdropAlpha = clamp(backdropInput.a, 0.0, 1.0);
  var sourceAlpha = clamp(sourceInput.a, 0.0, 1.0);
  let backdropPremultiplied = clamp(
    backdropInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(backdropAlpha),
  );
  var sourcePremultiplied = clamp(
    sourceInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(sourceAlpha),
  );

  if (mode == LAYER_BLEND_DISSOLVE) {
    let dissolved = layerBlendDissolveSource(
      sourcePremultiplied,
      sourceAlpha,
      documentPixel,
    );
    sourcePremultiplied = dissolved.rgb;
    sourceAlpha = dissolved.a;
  }

  // Exact matte-preserving clipping atop; Dissolve has Normal color after its
  // document-anchored binary-coverage decision.
  if (mode == LAYER_BLEND_NORMAL || mode == LAYER_BLEND_DISSOLVE) {
    let sourceAtop = sourcePremultiplied * backdropAlpha
      + backdropPremultiplied * (1.0 - sourceAlpha);
    return vec4<f32>(
      clamp(sourceAtop, vec3<f32>(0.0), vec3<f32>(backdropAlpha)),
      backdropAlpha,
    );
  }

  if (sourceAlpha <= 0.0) {
    return vec4<f32>(backdropPremultiplied, backdropAlpha);
  }
  if (backdropAlpha <= 0.0) {
    return vec4<f32>(0.0);
  }

  var backdropLinear = vec3<f32>(0.0);
  var sourceLinear = vec3<f32>(0.0);
  if (backdropAlpha > 0.0) { backdropLinear = backdropPremultiplied / backdropAlpha; }
  if (sourceAlpha > 0.0) { sourceLinear = sourcePremultiplied / sourceAlpha; }
  let blendedSrgb = layerBlendSrgb(
    layerBlendLinearToSrgb(backdropLinear),
    layerBlendLinearToSrgb(sourceLinear),
    mode,
  );
  let blendedLinear = layerBlendSrgbToLinear(blendedSrgb);
  let outputRgb = blendedLinear * (sourceAlpha * backdropAlpha)
    + backdropPremultiplied * (1.0 - sourceAlpha);
  return vec4<f32>(
    clamp(outputRgb, vec3<f32>(0.0), vec3<f32>(backdropAlpha)),
    backdropAlpha,
  );
}

fn layerBlendCompositorValidatedMode(mode: u32) -> u32 {
  if (mode <= LAYER_BLEND_LUMINOSITY) { return mode; }
  return LAYER_BLEND_NORMAL;
}

@vertex
fn layerBlendCompositorVertexMain(
  @builtin(vertex_index) vertexIndex: u32
) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

fn layerBlendCompositorLoadOrTransparent(
  source: texture_2d<f32>,
  pixel: vec2<i32>
) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(source, 0));
  if (any(pixel < vec2<i32>(0)) || any(pixel >= dimensions)) {
    return vec4<f32>(0.0);
  }
  return textureLoad(source, pixel, 0);
}

@fragment
fn layerBlendCompositorFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(floor(fragmentPosition.xy));
  let backdrop = layerBlendCompositorLoadOrTransparent(
    layerBlendBackdropTexture,
    pixel,
  );
  let source = layerBlendCompositorLoadOrTransparent(
    layerBlendSourceTexture,
    pixel,
  );
  let mode = layerBlendCompositorValidatedMode(layerBlendCompositor.blendMode);
  let documentPixel = layerBlendDocumentPixel(fragmentPosition.xy);
  if (layerBlendCompositor.compositeOperator == LAYER_BLEND_COMPOSITOR_SOURCE_ATOP) {
    return layerBlendPremultipliedLinearSourceAtop(
      backdrop,
      source,
      mode,
      documentPixel,
    );
  }
  return layerBlendPremultipliedLinearSourceOver(
    backdrop,
    source,
    mode,
    documentPixel,
  );
}
`;
