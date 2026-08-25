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
import {
  DEFAULT_LAYER_TONAL_BLEND,
  LAYER_CUTOUT_MODE_CODES,
  layerTonalBlendMask,
  type LayerCutoutMode,
  type LayerTonalBlend,
} from "./layer-composition.ts";

/**
 * Reusable two-input GPU compositor for viewport-sized raster surfaces.
 *
 * Both inputs and the render target contain linear-light premultiplied RGBA.
 * Non-Normal blend functions are evaluated by LAYER_BLEND_MODE_WGSL on
 * unassociated sRGB, while Porter-Duff coverage remains linear and
 * premultiplied. Source opacity must already be baked into the source texel.
 */
export const LAYER_BLEND_COMPOSITOR_STRATEGY =
  "viewport-textureload-tonal-gate-residual-cutout-source-opacity-w3c-over-clipping-atop-document-anchored-dissolve-v6" as const;

export const LAYER_BLEND_COMPOSITOR_OPERATOR_CODES = {
  "source-over": 0,
  "source-atop": 1,
} as const;

export type LayerBlendCompositeOperator =
  keyof typeof LAYER_BLEND_COMPOSITOR_OPERATOR_CODES;

export type LayerBlendCompositorContext =
  | "direct"
  | "clipping-child"
  | "clipping-outer";

export const LAYER_BLEND_COMPOSITOR_CONTEXT_CODES:
Readonly<Record<LayerBlendCompositorContext, number>> = {
  direct: 0,
  "clipping-child": 1,
  "clipping-outer": 2,
};

/** Per-fold controls; the first four words retain the original mode/operator ABI. */
export const LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE = 64 as const;
export const LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_STRIDE = 64 as const;
export const LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE = 16 as const;
export const LAYER_BLEND_COMPOSITOR_MODE_BYTE_OFFSET = 0 as const;
export const LAYER_BLEND_COMPOSITOR_OPERATOR_BYTE_OFFSET = 4 as const;

/**
 * Writes one compositor uniform record without allocating.
 */
export function writeLayerBlendCompositorUniforms(
  target: Uint32Array,
  mode: LayerBlendMode = DEFAULT_LAYER_BLEND_MODE,
  operator: LayerBlendCompositeOperator = "source-over",
  wordOffset = 0,
  composition: {
    readonly cutoutMode: LayerCutoutMode;
    readonly tonalBlend: LayerTonalBlend;
  } | null = null,
  sourceOpacity = 1,
  context: LayerBlendCompositorContext = "direct",
  documentMaskOpacity = 1,
): Uint32Array {
  if (!Number.isSafeInteger(wordOffset) || wordOffset < 0) {
    throw new RangeError("layer blend compositor wordOffset must be a non-negative integer");
  }
  if (target.length - wordOffset < LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE) {
    throw new RangeError("layer blend compositor uniform target is smaller than 64 bytes");
  }
  const normalizedMode = normalizeLayerBlendMode(mode);
  target[wordOffset] = LAYER_BLEND_MODE_CODES[normalizedMode];
  target[wordOffset + 1] = LAYER_BLEND_COMPOSITOR_OPERATOR_CODES[operator];
  target[wordOffset + 2] = LAYER_CUTOUT_MODE_CODES[composition?.cutoutMode ?? "off"];
  const f32 = new Float32Array(
    target.buffer,
    target.byteOffset + wordOffset * 4,
    LAYER_BLEND_COMPOSITOR_UNIFORM_U32_STRIDE,
  );
  f32[3] = clamp01(sourceOpacity);
  const tonalBlend = composition?.tonalBlend ?? DEFAULT_LAYER_TONAL_BLEND;
  tonalBlend.current.forEach((value, index) => { f32[4 + index] = value / 255; });
  tonalBlend.underlying.forEach((value, index) => { f32[8 + index] = value / 255; });
  target[wordOffset + 12] = LAYER_BLEND_COMPOSITOR_CONTEXT_CODES[context];
  f32[13] = clamp01(documentMaskOpacity);
  target[wordOffset + 14] = 0;
  target[wordOffset + 15] = 0;
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

/** Numeric oracle shared by tests and diagnostics for residual authored matte. */
export function layerResidualCutoutCoverage(
  authoredCoverage: number,
  visibleCoverage: number,
): number {
  return clamp01(clamp01(authoredCoverage) - clamp01(visibleCoverage));
}

/**
 * Applies a clipping child's residual cutout inside its isolated group.
 * Group scope restores the immutable base; document scope leaves a local hole
 * that is propagated separately by a normalized union mask.
 */
export function applyClippingChildResidualCutout(
  currentInput: LinearPremultipliedRgba,
  immutableBaseInput: LinearPremultipliedRgba,
  residualInput: number,
  scope: Exclude<LayerCutoutMode, "off">,
): LinearPremultipliedRgba {
  const current = sanitizePremultiplied(currentInput);
  const immutableBase = sanitizePremultiplied(immutableBaseInput);
  const residual = clamp01(residualInput);
  if (scope === "document") {
    return [
      current[0] * (1 - residual),
      current[1] * (1 - residual),
      current[2] * (1 - residual),
      current[3] * (1 - residual),
    ];
  }
  return [
    current[0] * (1 - residual) + immutableBase[0] * residual,
    current[1] * (1 - residual) + immutableBase[1] * residual,
    current[2] * (1 - residual) + immutableBase[2] * residual,
    current[3] * (1 - residual) + immutableBase[3] * residual,
  ];
}

/** Normalized source-over union used by successive document-scoped cutouts. */
export function accumulateDocumentCutoutCoverage(
  accumulatedInput: number,
  residualInput: number,
): number {
  const accumulated = clamp01(accumulatedInput);
  const residual = clamp01(residualInput);
  return accumulated + residual * (1 - accumulated);
}

/** Applies an isolated clipping group's propagated document cutout externally. */
export function applyDocumentCutoutToBackdrop(
  backdropInput: LinearPremultipliedRgba,
  immutableBaseAlphaInput: number,
  accumulatedCoverageInput: number,
  groupOpacityInput: number,
): LinearPremultipliedRgba {
  const backdrop = sanitizePremultiplied(backdropInput);
  const coverage = clamp01(immutableBaseAlphaInput)
    * clamp01(accumulatedCoverageInput)
    * clamp01(groupOpacityInput);
  return [
    backdrop[0] * (1 - coverage),
    backdrop[1] * (1 - coverage),
    backdrop[2] * (1 - coverage),
    backdrop[3] * (1 - coverage),
  ];
}

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
  composition: {
    readonly cutoutMode: LayerCutoutMode;
    readonly tonalBlend: LayerTonalBlend;
    readonly cutoutAlpha?: number;
  } | null = null,
): LinearPremultipliedRgba {
  const mask = composition
    ? layerTonalBlendMask(source, backdrop, composition.tonalBlend)
    : 1;
  const gatedSource: LinearPremultipliedRgba = [
    source[0] * mask,
    source[1] * mask,
    source[2] * mask,
    source[3] * mask,
  ];
  const composited = operator === "source-atop"
    ? blendLayerPremultipliedLinearSourceAtop(
      backdrop,
      gatedSource,
      mode,
      documentPixel,
    )
    : blendLayerPremultipliedLinear(backdrop, gatedSource, mode, documentPixel);
  if (!composition || composition.cutoutMode === "off") return composited;
  const cutoutCoverage = clamp01((composition.cutoutAlpha ?? source[3]) * mask);
  // The normal composite already replaces backdrop under visible source
  // coverage. Remove only authored coverage left uncovered by the visible
  // source (notably when Fill is below 100%); subtracting the full matte again
  // would make antialiased edges translucent even when Fill is 100%.
  const extraHole = clamp01(cutoutCoverage - clamp01(gatedSource[3]));
  const outputAlpha = clamp01(composited[3] - backdrop[3] * extraHole);
  return [
    Math.min(outputAlpha, Math.max(0, composited[0] - backdrop[0] * extraHole)),
    Math.min(outputAlpha, Math.max(0, composited[1] - backdrop[1] * extraHole)),
    Math.min(outputAlpha, Math.max(0, composited[2] - backdrop[2] * extraHole)),
    outputAlpha,
  ];
}

/**
 * Bindings:
 *   0 = backdrop texture (linear premultiplied RGBA)
 *   1 = source texture (linear premultiplied RGBA)
 *   2 = LayerBlendCompositorUniforms
 *   3 = viewport state used only to map framebuffer pixels to document pixels
 *   4 = raw authored matte rendered in the same viewport coordinates
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
  cutoutMode: u32,
  sourceOpacity: f32,
  currentRange: vec4<f32>,
  underlyingRange: vec4<f32>,
  compositionContext: u32,
  documentMaskOpacity: f32,
  _pad0: vec2<u32>,
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
@group(0) @binding(4) var layerBlendCutoutTexture: texture_2d<f32>;
@group(0) @binding(5) var layerBlendClippingBaseTexture: texture_2d<f32>;
@group(0) @binding(6) var layerBlendDocumentMaskTexture: texture_2d<f32>;

const LAYER_BLEND_CONTEXT_DIRECT: u32 = 0u;
const LAYER_BLEND_CONTEXT_CLIPPING_CHILD: u32 = 1u;
const LAYER_BLEND_CONTEXT_CLIPPING_OUTER: u32 = 2u;
const LAYER_CUTOUT_GROUP: u32 = 1u;
const LAYER_CUTOUT_DOCUMENT: u32 = 2u;

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
  clippingAlphaInput: f32,
  mode: u32,
  documentPixel: vec2<i32>,
) -> vec4<f32> {
  let backdropAlpha = clamp(backdropInput.a, 0.0, 1.0);
  let clippingAlpha = clamp(clippingAlphaInput, 0.0, 1.0);
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
    let outputAlpha = sourceAlpha * clippingAlpha
      + backdropAlpha * (1.0 - sourceAlpha);
    let sourceAtop = sourcePremultiplied * clippingAlpha
      + backdropPremultiplied * (1.0 - sourceAlpha);
    return vec4<f32>(
      clamp(sourceAtop, vec3<f32>(0.0), vec3<f32>(outputAlpha)),
      outputAlpha,
    );
  }

  if (sourceAlpha <= 0.0) {
    return vec4<f32>(backdropPremultiplied, backdropAlpha);
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
  let outputAlpha = sourceAlpha * clippingAlpha
    + backdropAlpha * (1.0 - sourceAlpha);
  let outputRgb = blendedLinear * (sourceAlpha * clippingAlpha)
    + backdropPremultiplied * (1.0 - sourceAlpha);
  return vec4<f32>(
    clamp(outputRgb, vec3<f32>(0.0), vec3<f32>(outputAlpha)),
    outputAlpha,
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

fn layerBlendCompositorTonalValue(input: vec4<f32>) -> f32 {
  let alpha = clamp(input.a, 0.0, 1.0);
  if (alpha <= 0.0) { return 0.0; }
  let straightSrgb = layerBlendLinearToSrgb(clamp(input.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0)));
  return dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn layerBlendCompositorRangeMask(value: f32, range: vec4<f32>) -> f32 {
  let low = select(
    select(0.0, 1.0, value >= range.y),
    clamp((value - range.x) / (range.y - range.x), 0.0, 1.0),
    range.y > range.x,
  );
  let high = select(
    select(0.0, 1.0, value <= range.z),
    1.0 - clamp((value - range.z) / (range.w - range.z), 0.0, 1.0),
    range.w > range.z,
  );
  return low * high;
}

fn layerBlendCompositorTonalMask(
  source: vec4<f32>,
  backdrop: vec4<f32>,
) -> f32 {
  return layerBlendCompositorRangeMask(
    layerBlendCompositorTonalValue(source),
    layerBlendCompositor.currentRange,
  ) * layerBlendCompositorRangeMask(
    layerBlendCompositorTonalValue(backdrop),
    layerBlendCompositor.underlyingRange,
  );
}

fn layerBlendCompositorResidualCutout(
  source: vec4<f32>,
  rawMatte: vec4<f32>,
  tonalMask: f32,
) -> f32 {
  let coverage = clamp(rawMatte.a * tonalMask, 0.0, 1.0);
  return clamp(coverage - clamp(source.a, 0.0, 1.0), 0.0, 1.0);
}

@fragment
fn layerBlendDocumentMaskFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  if (
    layerBlendCompositor.compositionContext != LAYER_BLEND_CONTEXT_CLIPPING_CHILD
    || layerBlendCompositor.cutoutMode != LAYER_CUTOUT_DOCUMENT
  ) {
    return vec4<f32>(0.0);
  }
  let pixel = vec2<i32>(floor(fragmentPosition.xy));
  let backdrop = layerBlendCompositorLoadOrTransparent(
    layerBlendBackdropTexture,
    pixel,
  );
  let unfilteredSource = layerBlendCompositorLoadOrTransparent(
    layerBlendSourceTexture,
    pixel,
  );
  let tonalMask = layerBlendCompositorTonalMask(unfilteredSource, backdrop);
  let source = unfilteredSource * tonalMask * layerBlendCompositor.sourceOpacity;
  let rawMatte = layerBlendCompositorLoadOrTransparent(
    layerBlendCutoutTexture,
    pixel,
  );
  let residual = layerBlendCompositorResidualCutout(source, rawMatte, tonalMask);
  return vec4<f32>(residual);
}

@fragment
fn layerBlendCompositorFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(floor(fragmentPosition.xy));
  var backdrop = layerBlendCompositorLoadOrTransparent(
    layerBlendBackdropTexture,
    pixel,
  );
  let unfilteredSource = layerBlendCompositorLoadOrTransparent(
    layerBlendSourceTexture,
    pixel,
  );
  let tonalMask = layerBlendCompositorTonalMask(unfilteredSource, backdrop);
  let source = unfilteredSource * tonalMask * layerBlendCompositor.sourceOpacity;
  let clippingBase = layerBlendCompositorLoadOrTransparent(
    layerBlendClippingBaseTexture,
    pixel,
  );
  if (layerBlendCompositor.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_OUTER) {
    let documentMask = layerBlendCompositorLoadOrTransparent(
      layerBlendDocumentMaskTexture,
      pixel,
    );
    let documentCoverage = clamp(documentMask.a, 0.0, 1.0)
      * clamp(clippingBase.a, 0.0, 1.0)
      * clamp(layerBlendCompositor.documentMaskOpacity, 0.0, 1.0);
    backdrop *= 1.0 - clamp(documentCoverage, 0.0, 1.0);
  }
  var compositionBackdrop = backdrop;
  var residual = 0.0;
  if (layerBlendCompositor.cutoutMode != 0u) {
    let rawMatte = layerBlendCompositorLoadOrTransparent(
      layerBlendCutoutTexture,
      pixel,
    );
    residual = layerBlendCompositorResidualCutout(source, rawMatte, tonalMask);
    if (layerBlendCompositor.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_CHILD) {
      if (layerBlendCompositor.cutoutMode == LAYER_CUTOUT_GROUP) {
        compositionBackdrop = mix(backdrop, clippingBase, residual);
      } else if (layerBlendCompositor.cutoutMode == LAYER_CUTOUT_DOCUMENT) {
        compositionBackdrop = backdrop * (1.0 - residual);
      }
    }
  }
  let mode = layerBlendCompositorValidatedMode(layerBlendCompositor.blendMode);
  let documentPixel = layerBlendDocumentPixel(fragmentPosition.xy);
  var composited: vec4<f32>;
  if (layerBlendCompositor.compositeOperator == LAYER_BLEND_COMPOSITOR_SOURCE_ATOP) {
    composited = layerBlendPremultipliedLinearSourceAtop(
      compositionBackdrop,
      source,
      select(
        clamp(compositionBackdrop.a, 0.0, 1.0),
        clamp(clippingBase.a, 0.0, 1.0),
        layerBlendCompositor.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_CHILD,
      ),
      mode,
      documentPixel,
    );
  } else {
    composited = layerBlendPremultipliedLinearSourceOver(
      compositionBackdrop,
      source,
      mode,
      documentPixel,
    );
  }
  if (
    layerBlendCompositor.cutoutMode != 0u
    && layerBlendCompositor.compositionContext != LAYER_BLEND_CONTEXT_CLIPPING_CHILD
  ) {
    let knocked = composited - backdrop * residual;
    let outputAlpha = clamp(knocked.a, 0.0, 1.0);
    return vec4<f32>(
      clamp(knocked.rgb, vec3<f32>(0.0), vec3<f32>(outputAlpha)),
      outputAlpha,
    );
  }
  return composited;
}
`;
