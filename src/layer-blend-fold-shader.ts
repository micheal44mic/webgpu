import { LAYER_BLEND_MODE_WGSL } from "./layer-blend-modes.ts";

/**
 * Backdrop-sampling variant of the cropped merged-surface fold. The caller
 * renders into a distinct scratch attachment and copies the completed dirty
 * rectangle back, so WebGPU never samples and attaches the same subresource.
 */
export const LAYER_BLEND_FOLD_STRATEGY =
  "cropped-document-1024-tile-ping-pong-dual-storage-tonal-gate-residual-cutout-w3c-over-clipping-atop-dissolve-v7" as const;

export const LAYER_BLEND_FOLD_TILE_EXTENT = 1024 as const;

export type LayerBlendFoldCompositionContext =
  | "direct"
  | "clipping-child"
  | "clipping-outer";

export const LAYER_BLEND_FOLD_COMPOSITION_CONTEXT_CODES:
Readonly<Record<LayerBlendFoldCompositionContext, number>> = {
  direct: 0,
  "clipping-child": 1,
  "clipping-outer": 2,
};

/** Matches LayerBlendFoldUniforms; the first 48 bytes retain the legacy ABI. */
export const LAYER_BLEND_FOLD_UNIFORM_BYTES = 160 as const;

export const LAYER_BLEND_FOLD_WGSL = /* wgsl */ `
${LAYER_BLEND_MODE_WGSL}

const LAYER_BLEND_FOLD_SOURCE_OVER: u32 = 0u;
const LAYER_BLEND_FOLD_SOURCE_ATOP: u32 = 1u;

struct LayerBlendFoldUniforms {
  destinationOrigin: vec2<f32>,
  destinationScale: f32,
  opacity: f32,
  sourceOrigin: vec2<f32>,
  sourceScale: f32,
  _pad0: f32,
  sourceDimensions: vec2<u32>,
  blendMode: u32,
  compositeOperator: u32,
  currentRange: vec4<f32>,
  underlyingRange: vec4<f32>,
  cutoutMode: u32,
  compositionContext: u32,
  clippingBaseScale: f32,
  documentMaskOpacity: f32,
  cutoutOrigin: vec2<f32>,
  cutoutScale: f32,
  _pad1: f32,
  cutoutDimensions: vec2<u32>,
  clippingBaseOrigin: vec2<f32>,
  documentMaskOrigin: vec2<f32>,
  documentMaskScale: f32,
  _pad2: f32,
  documentMaskDimensions: vec2<u32>,
  storageColorSpace: u32,
  sceneDomain: u32,
};

@group(0) @binding(0) var backdropTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> layer: LayerBlendFoldUniforms;
@group(0) @binding(3) var cutoutTexture: texture_2d<f32>;
@group(0) @binding(4) var clippingBaseTexture: texture_2d<f32>;
@group(0) @binding(5) var documentMaskTexture: texture_2d<f32>;
@group(0) @binding(6) var deepFloorTexture: texture_2d<f32>;

const LAYER_BLEND_CONTEXT_DIRECT: u32 = 0u;
const LAYER_BLEND_CONTEXT_CLIPPING_CHILD: u32 = 1u;
const LAYER_BLEND_CONTEXT_CLIPPING_OUTER: u32 = 2u;
const LAYER_CUTOUT_GROUP: u32 = 1u;
const LAYER_CUTOUT_DOCUMENT: u32 = 2u;
const LAYER_STORAGE_LINEAR_PREMULTIPLIED: u32 = 0u;
const LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED: u32 = 1u;

fn layerBlendFoldDecodeBackdrop(input: vec4<f32>) -> vec4<f32> {
  if (
    layer.sceneDomain == 0u
    || layer.storageColorSpace != LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED
  ) {
    return input;
  }
  let alpha = clamp(input.a, 0.0, 1.0);
  if (alpha <= 0.0) { return vec4<f32>(0.0); }
  let straight = clamp(input.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(layerBlendSrgbToLinear(straight) * alpha, alpha);
}

fn layerBlendFoldDecodeSource(input: vec4<f32>) -> vec4<f32> {
  // Mode 2 receives a source that was authored directly in linear RGBA16F.
  // The backdrop still belongs to the encoded-premultiplied working run.
  if (layer.sceneDomain == 2u) {
    return input;
  }
  return layerBlendFoldDecodeBackdrop(input);
}

fn layerBlendFoldEncodeWorking(input: vec4<f32>) -> vec4<f32> {
  if (
    layer.sceneDomain == 0u
    || layer.storageColorSpace != LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED
  ) {
    return input;
  }
  let alpha = clamp(input.a, 0.0, 1.0);
  if (alpha <= 0.0) { return vec4<f32>(0.0); }
  let straight = clamp(input.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(layerBlendLinearToSrgb(straight) * alpha, alpha);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

fn foldDocumentPosition(fragmentPosition: vec2<f32>) -> vec2<f32> {
  let destinationScale = max(layer.destinationScale, 1.0);
  let targetPixel = fragmentPosition - vec2<f32>(0.5);
  return layer.destinationOrigin + targetPixel / destinationScale;
}

fn sampleFoldTexture(
  inputTexture: texture_2d<f32>,
  documentPosition: vec2<f32>,
  sourceOrigin: vec2<f32>,
  sourceScaleInput: f32,
  sourceDimensions: vec2<u32>,
) -> vec4<f32> {
  let sourceScale = max(sourceScaleInput, 1.0);
  let sourcePosition = (documentPosition - sourceOrigin) * sourceScale;
  let dimensions = vec2<f32>(sourceDimensions);
  if (
    any(sourcePosition < vec2<f32>(0.0))
    || any(sourcePosition >= dimensions)
  ) {
    return vec4<f32>(0.0);
  }
  let sourceFloor = floor(sourcePosition);
  let fraction = sourcePosition - sourceFloor;
  let origin = vec2<i32>(sourceFloor);
  let maximum = vec2<i32>(sourceDimensions) - 1;
  let top = mix(
    textureLoad(inputTexture, clamp(origin, vec2<i32>(0), maximum), 0),
    textureLoad(inputTexture, clamp(origin + vec2<i32>(1, 0), vec2<i32>(0), maximum), 0),
    fraction.x,
  );
  let bottom = mix(
    textureLoad(inputTexture, clamp(origin + vec2<i32>(0, 1), vec2<i32>(0), maximum), 0),
    textureLoad(inputTexture, clamp(origin + vec2<i32>(1, 1), vec2<i32>(0), maximum), 0),
    fraction.x,
  );
  return mix(top, bottom, fraction.y);
}

fn layerTonalValue(input: vec4<f32>) -> f32 {
  let alpha = clamp(input.a, 0.0, 1.0);
  if (alpha <= 0.0) { return 0.0; }
  let straightStored = clamp(input.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let straightSrgb = select(
    layerBlendLinearToSrgb(straightStored),
    straightStored,
    layer.storageColorSpace == LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED
      && layer.sceneDomain == 0u,
  );
  return dot(straightSrgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn layerTonalRangeMask(value: f32, range: vec4<f32>) -> f32 {
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

fn layerTonalMask(source: vec4<f32>, backdrop: vec4<f32>) -> f32 {
  return layerTonalRangeMask(layerTonalValue(source), layer.currentRange)
    * layerTonalRangeMask(layerTonalValue(backdrop), layer.underlyingRange);
}

fn layerBlendFoldSourceAtop(
  backdropInput: vec4<f32>,
  sourceInput: vec4<f32>,
  clippingAlphaInput: f32,
  mode: u32,
  documentPixel: vec2<i32>,
) -> vec4<f32> {
  // Clipping children recolor the parent's straight RGB while preserving its
  // alpha matte; this is intentionally not general W3C blend+source-atop.
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
  if (mode == LAYER_BLEND_NORMAL || mode == LAYER_BLEND_DISSOLVE) {
    let outputAlpha = sourceAlpha * clippingAlpha
      + backdropAlpha * (1.0 - sourceAlpha);
    return vec4<f32>(
      clamp(
        sourcePremultiplied * clippingAlpha
        + backdropPremultiplied * (1.0 - sourceAlpha),
        vec3<f32>(0.0),
        vec3<f32>(outputAlpha),
      ),
      outputAlpha,
    );
  }
  if (sourceAlpha <= 0.0) {
    return vec4<f32>(backdropPremultiplied, backdropAlpha);
  }
  var backdropStored = vec3<f32>(0.0);
  var sourceStored = vec3<f32>(0.0);
  if (backdropAlpha > 0.0) { backdropStored = backdropPremultiplied / backdropAlpha; }
  if (sourceAlpha > 0.0) { sourceStored = sourcePremultiplied / sourceAlpha; }
  let encodedStorage = layer.storageColorSpace
    == LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED
    && layer.sceneDomain == 0u;
  let blendedSrgb = layerBlendSrgb(
    select(layerBlendLinearToSrgb(backdropStored), backdropStored, encodedStorage),
    select(layerBlendLinearToSrgb(sourceStored), sourceStored, encodedStorage),
    mode,
  );
  let blendedStored = select(
    layerBlendSrgbToLinear(blendedSrgb),
    blendedSrgb,
    encodedStorage,
  );
  let outputAlpha = sourceAlpha * clippingAlpha
    + backdropAlpha * (1.0 - sourceAlpha);
  return vec4<f32>(
    clamp(
      blendedStored * (sourceAlpha * clippingAlpha)
        + backdropPremultiplied * (1.0 - sourceAlpha),
      vec3<f32>(0.0),
      vec3<f32>(outputAlpha),
    ),
    outputAlpha,
  );
}

fn layerBlendFoldClippingBase(documentPosition: vec2<f32>) -> vec4<f32> {
  return layerBlendFoldDecodeBackdrop(sampleFoldTexture(
    clippingBaseTexture,
    documentPosition,
    layer.clippingBaseOrigin,
    layer.clippingBaseScale,
    textureDimensions(clippingBaseTexture, 0),
  ));
}

fn layerBlendFoldDocumentMask(documentPosition: vec2<f32>) -> f32 {
  return clamp(sampleFoldTexture(
    documentMaskTexture,
    documentPosition,
    layer.documentMaskOrigin,
    layer.documentMaskScale,
    layer.documentMaskDimensions,
  ).a, 0.0, 1.0);
}

fn layerBlendFoldResidualCutout(
  source: vec4<f32>,
  rawMatte: vec4<f32>,
  opacity: f32,
  tonalMask: f32,
) -> f32 {
  let coverage = clamp(rawMatte.a * opacity * tonalMask, 0.0, 1.0);
  return clamp(coverage - clamp(source.a, 0.0, 1.0), 0.0, 1.0);
}

@fragment
fn documentMaskFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(fragmentPosition.xy);
  let previous = clamp(textureLoad(documentMaskTexture, pixel, 0).a, 0.0, 1.0);
  if (
    layer.compositionContext != LAYER_BLEND_CONTEXT_CLIPPING_CHILD
    || layer.cutoutMode != LAYER_CUTOUT_DOCUMENT
  ) {
    return vec4<f32>(previous);
  }
  let backdrop = layerBlendFoldDecodeBackdrop(textureLoad(backdropTexture, pixel, 0));
  let documentPosition = foldDocumentPosition(fragmentPosition.xy);
  let opacity = clamp(layer.opacity, 0.0, 1.0);
  let unfilteredSource = layerBlendFoldDecodeSource(sampleFoldTexture(
    sourceTexture,
    documentPosition,
    layer.sourceOrigin,
    layer.sourceScale,
    layer.sourceDimensions,
  )) * opacity;
  let tonalMask = layerTonalMask(unfilteredSource, backdrop);
  let source = unfilteredSource * tonalMask;
  let rawMatte = sampleFoldTexture(
    cutoutTexture,
    documentPosition,
    layer.cutoutOrigin,
    layer.cutoutScale,
    layer.cutoutDimensions,
  );
  let residual = layerBlendFoldResidualCutout(
    source,
    rawMatte,
    opacity,
    tonalMask,
  );
  let accumulated = previous + residual * (1.0 - previous);
  return vec4<f32>(accumulated);
}

@fragment
fn documentMaskContributionFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  if (
    layer.compositionContext != LAYER_BLEND_CONTEXT_CLIPPING_CHILD
    || layer.cutoutMode != LAYER_CUTOUT_DOCUMENT
  ) {
    return vec4<f32>(0.0);
  }
  let pixel = vec2<i32>(fragmentPosition.xy);
  let backdrop = layerBlendFoldDecodeBackdrop(textureLoad(backdropTexture, pixel, 0));
  let documentPosition = foldDocumentPosition(fragmentPosition.xy);
  let opacity = clamp(layer.opacity, 0.0, 1.0);
  let unfilteredSource = layerBlendFoldDecodeSource(sampleFoldTexture(
    sourceTexture,
    documentPosition,
    layer.sourceOrigin,
    layer.sourceScale,
    layer.sourceDimensions,
  )) * opacity;
  let tonalMask = layerTonalMask(unfilteredSource, backdrop);
  let source = unfilteredSource * tonalMask;
  let rawMatte = sampleFoldTexture(
    cutoutTexture,
    documentPosition,
    layer.cutoutOrigin,
    layer.cutoutScale,
    layer.cutoutDimensions,
  );
  let residual = layerBlendFoldResidualCutout(
    source,
    rawMatte,
    opacity,
    tonalMask,
  );
  return vec4<f32>(residual);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  let pixel = vec2<i32>(fragmentPosition.xy);
  var backdrop = layerBlendFoldDecodeBackdrop(textureLoad(backdropTexture, pixel, 0));
  let documentPosition = foldDocumentPosition(fragmentPosition.xy);
  let documentPixel = vec2<i32>(floor(documentPosition));
  let opacity = clamp(layer.opacity, 0.0, 1.0);
  let unfilteredSource = layerBlendFoldDecodeSource(sampleFoldTexture(
    sourceTexture,
    documentPosition,
    layer.sourceOrigin,
    layer.sourceScale,
    layer.sourceDimensions,
  )) * opacity;
  let tonalMask = layerTonalMask(unfilteredSource, backdrop);
  let source = unfilteredSource * tonalMask;
  let clippingBase = layerBlendFoldClippingBase(documentPosition);
  var deepFloor = vec4<f32>(0.0);
  if (
    layer.cutoutMode == LAYER_CUTOUT_DOCUMENT
    || layer.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_OUTER
  ) {
    deepFloor = layerBlendFoldDecodeBackdrop(textureLoad(deepFloorTexture, pixel, 0));
  }
  if (layer.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_OUTER) {
    let documentCoverage = layerBlendFoldDocumentMask(documentPosition)
      * clamp(clippingBase.a, 0.0, 1.0)
      * clamp(layer.documentMaskOpacity, 0.0, 1.0);
    backdrop = mix(backdrop, deepFloor, clamp(documentCoverage, 0.0, 1.0));
  }
  var compositionBackdrop = backdrop;
  var residual = 0.0;
  if (layer.cutoutMode != 0u) {
    let rawMatte = sampleFoldTexture(
      cutoutTexture,
      documentPosition,
      layer.cutoutOrigin,
      layer.cutoutScale,
      layer.cutoutDimensions,
    );
    residual = layerBlendFoldResidualCutout(
      source,
      rawMatte,
      opacity,
      tonalMask,
    );
    if (layer.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_CHILD) {
      if (layer.cutoutMode == LAYER_CUTOUT_GROUP) {
        compositionBackdrop = mix(backdrop, clippingBase, residual);
      } else if (layer.cutoutMode == LAYER_CUTOUT_DOCUMENT) {
        compositionBackdrop = backdrop * (1.0 - residual);
      }
    }
  }
  var composited: vec4<f32>;
  if (layer.compositeOperator == LAYER_BLEND_FOLD_SOURCE_ATOP) {
    composited = layerBlendFoldSourceAtop(
      compositionBackdrop,
      source,
      select(
        clamp(compositionBackdrop.a, 0.0, 1.0),
        clamp(clippingBase.a, 0.0, 1.0),
        layer.compositionContext == LAYER_BLEND_CONTEXT_CLIPPING_CHILD,
      ),
      layer.blendMode,
      documentPixel,
    );
  } else {
    if (
      layer.storageColorSpace == LAYER_STORAGE_ENCODED_SRGB_PREMULTIPLIED
      && layer.sceneDomain == 0u
    ) {
      composited = layerBlendPremultipliedEncodedSrgbSourceOver(
        compositionBackdrop,
        source,
        layer.blendMode,
        documentPixel,
      );
    } else {
      composited = layerBlendPremultipliedLinearSourceOver(
        compositionBackdrop,
        source,
        layer.blendMode,
        documentPixel,
      );
    }
  }
  if (
    layer.cutoutMode != 0u
    && layer.compositionContext != LAYER_BLEND_CONTEXT_CLIPPING_CHILD
  ) {
    var knocked = composited - backdrop * residual;
    if (layer.cutoutMode == LAYER_CUTOUT_DOCUMENT) {
      knocked += deepFloor * residual;
    }
    let outputAlpha = clamp(knocked.a, 0.0, 1.0);
    return layerBlendFoldEncodeWorking(vec4<f32>(
      clamp(knocked.rgb, vec3<f32>(0.0), vec3<f32>(outputAlpha)),
      outputAlpha,
    ));
  }
  return layerBlendFoldEncodeWorking(composited);
}
`;
