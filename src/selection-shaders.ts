import {
  SELECTION_LAYER_HEIGHT,
  SELECTION_LAYER_WIDTH,
  SELECTION_MASK_WORDS,
  SELECTION_META_MAX_X,
  SELECTION_META_MAX_Y,
  SELECTION_META_MIN_X,
  SELECTION_META_MIN_Y,
  SELECTION_META_SELECTED_PIXELS,
  SELECTION_META_TILE_MASK_START,
  SELECTION_TILE_GRID_SIZE,
  SELECTION_TILE_HEIGHT,
  SELECTION_TILE_WIDTH,
  SELECTION_WORDS_PER_ROW,
} from "./selection-core.ts";
import { colorMatchShaderHelpers } from "./color-match-core.ts";

export const selectionComputeShader = /* wgsl */ `
const LAYER_EXTENT: vec2<u32> = vec2<u32>(${SELECTION_LAYER_WIDTH}u, ${SELECTION_LAYER_HEIGHT}u);
const WORDS_PER_ROW: u32 = ${SELECTION_WORDS_PER_ROW}u;
const MASK_WORDS: u32 = ${SELECTION_MASK_WORDS}u;

struct SelectionUniforms {
  size: vec2<u32>,
  combineMode: u32,
  spanCount: u32,
  tolerance: f32,
  _padding0: f32,
  _padding1: f32,
  _padding2: f32,
  targetColor: vec4<f32>,
};

struct LassoSpan {
  y: u32,
  startX: u32,
  endX: u32,
  _padding: u32,
};

@group(0) @binding(0) var<uniform> uniforms: SelectionUniforms;
@group(0) @binding(1) var sourceLayer: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> selectionMask: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> externalMask: array<u32>;
@group(0) @binding(4) var<storage, read> lassoSpans: array<LassoSpan>;
@group(0) @binding(5) var<storage, read_write> metadata: array<atomic<u32>>;

fn linearToSrgb(channel: f32) -> f32 {
  let value = clamp(channel, 0.0, 1.0);
  return select(1.055 * pow(value, 1.0 / 2.4) - 0.055, 12.92 * value, value <= 0.0031308);
}

fn straightSrgb(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  var inverseAlpha = 0.0;
  if (alpha > 0.000001) { inverseAlpha = 1.0 / alpha; }
  return vec4<f32>(
    linearToSrgb(value.r * inverseAlpha),
    linearToSrgb(value.g * inverseAlpha),
    linearToSrgb(value.b * inverseAlpha),
    alpha,
  );
}

${colorMatchShaderHelpers}

fn applyBit(wordIndex: u32, bit: u32) {
  if (uniforms.combineMode == 2u) {
    atomicAnd(&selectionMask[wordIndex], ~bit);
  } else {
    atomicOr(&selectionMask[wordIndex], bit);
  }
}

@compute @workgroup_size(256, 1, 1)
fn selectGlobalColor(@builtin(global_invocation_id) global: vec3<u32>) {
  let wordIndex = global.x;
  if (wordIndex >= MASK_WORDS) { return; }
  let y = wordIndex / WORDS_PER_ROW;
  let baseX = (wordIndex % WORDS_PER_ROW) * 32u;
  var candidate = 0u;
  for (var bit = 0u; bit < 32u; bit += 1u) {
    let pixel = vec2<u32>(baseX + bit, y);
    if (pixel.x >= LAYER_EXTENT.x || pixel.y >= LAYER_EXTENT.y) { continue; }
    let source = straightSrgb(textureLoad(sourceLayer, vec2<i32>(pixel), 0));
    let matches = globalStraightSrgbColorsMatch(
      source,
      uniforms.targetColor,
      uniforms.tolerance,
    );
    if (matches) { candidate |= 1u << bit; }
  }
  if (uniforms.combineMode == 2u) {
    atomicAnd(&selectionMask[wordIndex], ~candidate);
  } else {
    atomicOr(&selectionMask[wordIndex], candidate);
  }
}

fn spanWordMask(wordX: u32, startX: u32, endX: u32) -> u32 {
  let wordStart = wordX * 32u;
  let localStart = min(32u, max(startX, wordStart) - wordStart);
  let localEnd = min(32u, max(endX, wordStart) - wordStart);
  if (localEnd <= localStart) { return 0u; }
  var lowMask = 0u;
  if (localStart > 0u) { lowMask = (1u << localStart) - 1u; }
  var highMask = 0xffffffffu;
  if (localEnd < 32u) { highMask = (1u << localEnd) - 1u; }
  return highMask & ~lowMask;
}

@compute @workgroup_size(64, 1, 1)
fn rasterizeLassoSpans(@builtin(global_invocation_id) global: vec3<u32>) {
  if (global.x >= uniforms.spanCount) { return; }
  let span = lassoSpans[global.x];
  if (span.y >= LAYER_EXTENT.y || span.endX <= span.startX) { return; }
  let firstWord = span.startX / 32u;
  let lastWord = (span.endX - 1u) / 32u;
  var wordX = firstWord;
  loop {
    let bits = spanWordMask(wordX, span.startX, span.endX);
    if (bits != 0u) {
      applyBit(span.y * WORDS_PER_ROW + wordX, bits);
    }
    if (wordX == lastWord) { break; }
    wordX += 1u;
  }
}

@compute @workgroup_size(256, 1, 1)
fn combineExternalMask(@builtin(global_invocation_id) global: vec3<u32>) {
  let wordIndex = global.x;
  if (wordIndex >= MASK_WORDS) { return; }
  let candidate = externalMask[wordIndex];
  if (uniforms.combineMode == 0u) {
    atomicStore(&selectionMask[wordIndex], candidate);
  } else if (uniforms.combineMode == 1u) {
    atomicOr(&selectionMask[wordIndex], candidate);
  } else {
    atomicAnd(&selectionMask[wordIndex], ~candidate);
  }
}

@compute @workgroup_size(256, 1, 1)
fn invertSelection(@builtin(global_invocation_id) global: vec3<u32>) {
  let wordIndex = global.x;
  if (wordIndex >= MASK_WORDS) { return; }
  let wordX = wordIndex % WORDS_PER_ROW;
  let validPixels = min(32u, LAYER_EXTENT.x - wordX * 32u);
  var validMask = 0xffffffffu;
  if (validPixels < 32u) { validMask = (1u << validPixels) - 1u; }
  atomicStore(&selectionMask[wordIndex], ~externalMask[wordIndex] & validMask);
}

@compute @workgroup_size(256, 1, 1)
fn translateExternalMask(@builtin(global_invocation_id) global: vec3<u32>) {
  let wordIndex = global.x;
  if (wordIndex >= MASK_WORDS) { return; }
  let destinationY = i32(wordIndex / WORDS_PER_ROW);
  let destinationBaseX = i32((wordIndex % WORDS_PER_ROW) * 32u);
  let delta = vec2<i32>(round(uniforms.targetColor.xy));
  var translated = 0u;
  for (var bit = 0u; bit < 32u; bit += 1u) {
    if (destinationBaseX + i32(bit) >= i32(LAYER_EXTENT.x)) { continue; }
    let source = vec2<i32>(destinationBaseX + i32(bit), destinationY) - delta;
    if (all(source >= vec2<i32>(0)) && all(source < vec2<i32>(LAYER_EXTENT))) {
      let sourcePixel = vec2<u32>(source);
      let sourceWord = sourcePixel.y * WORDS_PER_ROW + sourcePixel.x / 32u;
      if ((externalMask[sourceWord] & (1u << (sourcePixel.x & 31u))) != 0u) {
        translated |= 1u << bit;
      }
    }
  }
  atomicStore(&selectionMask[wordIndex], translated);
}

fn firstSetBit(word: u32) -> u32 {
  var bit = 0u;
  loop {
    if ((word & (1u << bit)) != 0u) { return bit; }
    bit += 1u;
  }
}

fn lastSetBit(word: u32) -> u32 {
  var bit = 31u;
  loop {
    if ((word & (1u << bit)) != 0u) { return bit; }
    bit -= 1u;
  }
}

@compute @workgroup_size(256, 1, 1)
fn summarizeSelection(@builtin(global_invocation_id) global: vec3<u32>) {
  let wordIndex = global.x;
  if (wordIndex >= MASK_WORDS) { return; }
  var word = atomicLoad(&selectionMask[wordIndex]);
  let wordX = wordIndex % WORDS_PER_ROW;
  let validPixels = min(32u, LAYER_EXTENT.x - wordX * 32u);
  if (validPixels < 32u) { word &= (1u << validPixels) - 1u; }
  if (word == 0u) { return; }
  let y = wordIndex / WORDS_PER_ROW;
  let minX = wordX * 32u + firstSetBit(word);
  let maxX = wordX * 32u + lastSetBit(word) + 1u;
  atomicAdd(&metadata[${SELECTION_META_SELECTED_PIXELS}u], countOneBits(word));
  atomicMin(&metadata[${SELECTION_META_MIN_X}u], minX);
  atomicMin(&metadata[${SELECTION_META_MIN_Y}u], y);
  atomicMax(&metadata[${SELECTION_META_MAX_X}u], maxX);
  atomicMax(&metadata[${SELECTION_META_MAX_Y}u], y + 1u);
  let tileY = min(y / ${SELECTION_TILE_HEIGHT}u, ${SELECTION_TILE_GRID_SIZE - 1}u);
  let firstTileX = min(minX / ${SELECTION_TILE_WIDTH}u, ${SELECTION_TILE_GRID_SIZE - 1}u);
  let lastTileX = min((maxX - 1u) / ${SELECTION_TILE_WIDTH}u, ${SELECTION_TILE_GRID_SIZE - 1}u);
  var tileX = firstTileX;
  loop {
    let tile = tileY * ${SELECTION_TILE_GRID_SIZE}u + tileX;
    atomicOr(
      &metadata[${SELECTION_META_TILE_MASK_START}u + tile / 32u],
      1u << (tile & 31u),
    );
    if (tileX == lastTileX) { break; }
    tileX += 1u;
  }
}
`;

export const selectionOverlayShader = /* wgsl */ `
const LAYER_EXTENT: vec2<i32> = vec2<i32>(${SELECTION_LAYER_WIDTH}, ${SELECTION_LAYER_HEIGHT});
const WORDS_PER_ROW: u32 = ${SELECTION_WORDS_PER_ROW}u;

struct OverlayUniforms {
  canvasSize: vec2<f32>,
  viewCenter: vec2<f32>,
  viewRotation: vec2<f32>,
  zoom: f32,
  layerSize: f32,
  selectedPixels: u32,
  _padding0: u32,
  selectionOffset: vec2<f32>,
};

@group(0) @binding(0) var<uniform> overlay: OverlayUniforms;
@group(0) @binding(1) var<storage, read> selectionMask: array<u32>;
@group(0) @binding(2) var<storage, read> selectionMetadata: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

fn screenToLayerFloat(screen: vec2<f32>) -> vec2<f32> {
  let displayOffset = (screen - overlay.canvasSize * 0.5) / overlay.zoom;
  let layerOffset = vec2<f32>(
    overlay.viewRotation.x * displayOffset.x + overlay.viewRotation.y * displayOffset.y,
    -overlay.viewRotation.y * displayOffset.x + overlay.viewRotation.x * displayOffset.y,
  );
  return overlay.viewCenter + layerOffset - overlay.selectionOffset;
}

fn selectionWordRangeMask(localStart: u32, localEnd: u32) -> u32 {
  if (localEnd <= localStart) { return 0u; }
  var lowMask = 0u;
  if (localStart > 0u) { lowMask = (1u << localStart) - 1u; }
  var highMask = 0xffffffffu;
  if (localEnd < 32u) { highMask = (1u << localEnd) - 1u; }
  return highMask & ~lowMask;
}

fn anySelectedInLayerBounds(rawMin: vec2<i32>, rawMax: vec2<i32>) -> bool {
  let minimum = clamp(rawMin, vec2<i32>(0), LAYER_EXTENT);
  let maximum = clamp(rawMax, vec2<i32>(0), LAYER_EXTENT);
  if (any(maximum <= minimum)) {
    return false;
  }

  let selectedMinimum = vec2<i32>(
    i32(selectionMetadata[${SELECTION_META_MIN_X}u]),
    i32(selectionMetadata[${SELECTION_META_MIN_Y}u]),
  );
  let selectedMaximum = vec2<i32>(
    i32(selectionMetadata[${SELECTION_META_MAX_X}u]),
    i32(selectionMetadata[${SELECTION_META_MAX_Y}u]),
  );
  if (any(maximum <= selectedMinimum) || any(minimum >= selectedMaximum)) {
    return false;
  }

  let clippedMinimum = max(minimum, selectedMinimum);
  let clippedMaximum = min(maximum, selectedMaximum);
  let firstTile = vec2<u32>(
    u32(clippedMinimum.x) / ${SELECTION_TILE_WIDTH}u,
    u32(clippedMinimum.y) / ${SELECTION_TILE_HEIGHT}u,
  );
  let lastTile = min(
    vec2<u32>(
      u32(clippedMaximum.x - 1) / ${SELECTION_TILE_WIDTH}u,
      u32(clippedMaximum.y - 1) / ${SELECTION_TILE_HEIGHT}u,
    ),
    vec2<u32>(${SELECTION_TILE_GRID_SIZE - 1}u),
  );
  var activeTileFound = false;
  var tileY = firstTile.y;
  loop {
    var tileX = firstTile.x;
    loop {
      let tile = tileY * ${SELECTION_TILE_GRID_SIZE}u + tileX;
      let tileWord = selectionMetadata[${SELECTION_META_TILE_MASK_START}u + tile / 32u];
      if ((tileWord & (1u << (tile & 31u))) != 0u) {
        activeTileFound = true;
        break;
      }
      if (tileX == lastTile.x) { break; }
      tileX += 1u;
    }
    if (activeTileFound || tileY == lastTile.y) { break; }
    tileY += 1u;
  }
  if (!activeTileFound) { return false; }

  let firstWord = u32(clippedMinimum.x) / 32u;
  let lastWord = u32(clippedMaximum.x - 1) / 32u;
  var y = u32(clippedMinimum.y);
  loop {
    var wordX = firstWord;
    loop {
      let wordStart = wordX * 32u;
      let localStart = min(32u, max(u32(clippedMinimum.x), wordStart) - wordStart);
      let localEnd = min(32u, max(u32(clippedMaximum.x), wordStart) - wordStart);
      let rangeMask = selectionWordRangeMask(localStart, localEnd);
      if ((selectionMask[y * WORDS_PER_ROW + wordX] & rangeMask) != 0u) {
        return true;
      }
      if (wordX == lastWord) { break; }
      wordX += 1u;
    }
    if (y + 1u >= u32(clippedMaximum.y)) { break; }
    y += 1u;
  }
  return false;
}

fn selectedInScreenPixel(screen: vec2<f32>) -> bool {
  let first = screenToLayerFloat(screen + vec2<f32>(-0.5, -0.5));
  let second = screenToLayerFloat(screen + vec2<f32>(0.5, -0.5));
  let third = screenToLayerFloat(screen + vec2<f32>(-0.5, 0.5));
  let fourth = screenToLayerFloat(screen + vec2<f32>(0.5, 0.5));
  let minimum = vec2<i32>(floor(min(min(first, second), min(third, fourth))));
  let maximum = vec2<i32>(ceil(max(max(first, second), max(third, fourth))));
  return anySelectedInLayerBounds(minimum, maximum);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  if (overlay.selectedPixels == 0u) { return vec4<f32>(0.0); }
  if (!selectedInScreenPixel(position.xy)) { return vec4<f32>(0.0); }
  let boundary = !selectedInScreenPixel(position.xy + vec2<f32>(-1.0, 0.0))
    || !selectedInScreenPixel(position.xy + vec2<f32>(1.0, 0.0))
    || !selectedInScreenPixel(position.xy + vec2<f32>(0.0, -1.0))
    || !selectedInScreenPixel(position.xy + vec2<f32>(0.0, 1.0));
  if (boundary) {
    let dash = (u32(floor(position.x / 4.0)) + u32(floor(position.y / 4.0))) & 1u;
    let color = select(vec3<f32>(0.03), vec3<f32>(1.0), dash == 0u);
    return vec4<f32>(color * 0.92, 0.92);
  }
  let alpha = 0.12;
  return vec4<f32>(vec3<f32>(0.16, 0.48, 1.0) * alpha, alpha);
}
`;
