import {
  FILL_BLOCK_GRID_SIZE,
  FILL_BLOCK_SIZE,
  FILL_BLOCKS_PER_TILE,
  FILL_LABEL_WORDS_PER_BLOCK,
  FILL_MAX_COMPONENTS_PER_BLOCK,
  FILL_META_ACTIVE_BLOCKS,
  FILL_META_ACTIVE_COMPONENTS,
  FILL_META_DIAGNOSTIC,
  FILL_META_MAX_X,
  FILL_META_MAX_Y,
  FILL_META_MIN_X,
  FILL_META_MIN_Y,
  FILL_META_SELECTED_PIXELS,
  FILL_META_TILE_MASK_START,
  FILL_TILE_GRID_SIZE,
} from "./fill-core.ts";
import { LAYER_SIZE } from "./engine-limits.ts";

export const fillComputeShader = /* wgsl */ `
const LAYER_EXTENT: u32 = ${LAYER_SIZE}u;
const BLOCK_EXTENT: u32 = ${FILL_BLOCK_SIZE}u;
const BLOCK_GRID: u32 = ${FILL_BLOCK_GRID_SIZE}u;
const ACTIVE_NODE_CAPACITY: u32 = ${FILL_BLOCK_GRID_SIZE * FILL_BLOCK_GRID_SIZE}u;
const COMPONENTS_PER_BLOCK: u32 = ${FILL_MAX_COMPONENTS_PER_BLOCK}u;
const LABEL_WORDS_PER_BLOCK: u32 = ${FILL_LABEL_WORDS_PER_BLOCK}u;
const INVALID_LABEL: u32 = 255u;
const INVALID_U32: u32 = 0xffffffffu;

struct FillUniforms {
  seed: vec2<u32>,
  size: vec2<u32>,
  tolerance: f32,
  _padding0: f32,
  _padding1: f32,
  _padding2: f32,
  fillColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: FillUniforms;
@group(0) @binding(1) var sourceLayer: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> packedLabels: array<u32>;
@group(0) @binding(3) var<storage, read_write> globalParents: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> activeParentNodes: array<u32>;
@group(0) @binding(5) var<storage, read_write> selectedMask: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> activeBlocks: array<u32>;
@group(0) @binding(7) var<storage, read_write> metadata: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> drawIndirect: array<atomic<u32>>;

var<workgroup> localParents: array<atomic<u32>, 256>;
var<workgroup> localComponents: array<u32, 256>;
var<workgroup> scanA: array<u32, 256>;
var<workgroup> scanB: array<u32, 256>;
var<workgroup> reduceCount: array<u32, 256>;
var<workgroup> reduceMinX: array<u32, 256>;
var<workgroup> reduceMinY: array<u32, 256>;
var<workgroup> reduceMaxX: array<u32, 256>;
var<workgroup> reduceMaxY: array<u32, 256>;
var<workgroup> seedColor: vec4<f32>;

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

fn matchesSeed(value: vec4<f32>) -> bool {
  let delta = abs(straightSrgb(value) - straightSrgb(seedColor));
  return max(max(delta.r, delta.g), max(delta.b, delta.a)) <= uniforms.tolerance + 0.0000001;
}

fn findLocalRoot(start: u32) -> u32 {
  var node = start;
  loop {
    let parent = atomicLoad(&localParents[node]);
    if (parent == node) { return node; }
    node = parent;
  }
}

fn unionLocal(left: u32, right: u32) {
  var first = left;
  var second = right;
  loop {
    let rootA = findLocalRoot(first);
    let rootB = findLocalRoot(second);
    if (rootA == rootB) { return; }
    let high = max(rootA, rootB);
    let low = min(rootA, rootB);
    let result = atomicCompareExchangeWeak(&localParents[high], high, low);
    if (result.exchanged) { return; }
    first = low;
    second = result.old_value;
  }
}

fn findGlobalRoot(start: u32) -> u32 {
  var node = start;
  loop {
    let parent = atomicLoad(&globalParents[node]);
    if (parent == node) { return node; }
    node = parent;
  }
}

fn unionGlobal(left: u32, right: u32) {
  var first = left;
  var second = right;
  loop {
    let rootA = findGlobalRoot(first);
    let rootB = findGlobalRoot(second);
    if (rootA == rootB) { return; }
    let high = max(rootA, rootB);
    let low = min(rootA, rootB);
    let result = atomicCompareExchangeWeak(&globalParents[high], high, low);
    if (result.exchanged) { return; }
    first = low;
    second = result.old_value;
  }
}

fn blockIndex(block: vec2<u32>) -> u32 {
  return block.y * BLOCK_GRID + block.x;
}

fn labelAt(pixel: vec2<u32>) -> u32 {
  let block = pixel / BLOCK_EXTENT;
  let local = pixel % BLOCK_EXTENT;
  let wordIndex = blockIndex(block) * LABEL_WORDS_PER_BLOCK
    + local.y * (BLOCK_EXTENT / 4u) + local.x / 4u;
  return (packedLabels[wordIndex] >> ((local.x % 4u) * 8u)) & 255u;
}

fn nodeForPixel(pixel: vec2<u32>, label: u32) -> u32 {
  return blockIndex(pixel / BLOCK_EXTENT) * COMPONENTS_PER_BLOCK + label;
}

@compute @workgroup_size(16, 16, 1)
fn classifyLocal(
  @builtin(workgroup_id) workgroup: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let pixel = workgroup.xy * BLOCK_EXTENT + local.xy;
  if (localIndex == 0u) {
    seedColor = textureLoad(sourceLayer, vec2<i32>(uniforms.seed), 0);
  }
  workgroupBarrier();

  let inside = all(pixel < uniforms.size);
  let matches = matchesSeed(textureLoad(sourceLayer, vec2<i32>(pixel), 0));
  let eligible = inside && matches;
  if (all(workgroup.xy == vec2<u32>(0u)) && localIndex == 0u) {
    atomicStore(
      &metadata[${FILL_META_DIAGNOSTIC}u],
      (uniforms.size.x & 65535u)
        | select(0u, 1u << 16u, inside)
        | select(0u, 1u << 17u, matches),
    );
  }
  atomicStore(&localParents[localIndex], select(INVALID_U32, localIndex, eligible));
  localComponents[localIndex] = INVALID_LABEL;
  workgroupBarrier();

  if (eligible) {
    if (local.x > 0u && atomicLoad(&localParents[localIndex - 1u]) != INVALID_U32) {
      unionLocal(localIndex, localIndex - 1u);
    }
    if (local.y > 0u && atomicLoad(&localParents[localIndex - BLOCK_EXTENT]) != INVALID_U32) {
      unionLocal(localIndex, localIndex - BLOCK_EXTENT);
    }
  }
  workgroupBarrier();

  var root = INVALID_U32;
  if (eligible) { root = findLocalRoot(localIndex); }
  scanA[localIndex] = select(0u, 1u, eligible && root == localIndex);
  workgroupBarrier();
  var offset = 1u;
  var round = 0u;
  loop {
    if (offset >= 256u) { break; }
    if ((round & 1u) == 0u) {
      var addition = 0u;
      if (localIndex >= offset) { addition = scanA[localIndex - offset]; }
      scanB[localIndex] = scanA[localIndex] + addition;
    } else {
      var addition = 0u;
      if (localIndex >= offset) { addition = scanB[localIndex - offset]; }
      scanA[localIndex] = scanB[localIndex] + addition;
    }
    workgroupBarrier();
    offset = offset << 1u;
    round += 1u;
  }

  if (eligible) {
    let component = scanA[root] - 1u;
    localComponents[localIndex] = component;
    if (root == localIndex) {
      let node = blockIndex(workgroup.xy) * COMPONENTS_PER_BLOCK + component;
      atomicStore(&globalParents[node], node);
      let slot = atomicAdd(&metadata[${FILL_META_ACTIVE_COMPONENTS}u], 1u);
      if (slot < ACTIVE_NODE_CAPACITY) { activeParentNodes[slot] = node; }
    }
  }
  workgroupBarrier();

  if ((local.x & 3u) == 0u) {
    let base = localIndex;
    let packed = localComponents[base]
      | (localComponents[base + 1u] << 8u)
      | (localComponents[base + 2u] << 16u)
      | (localComponents[base + 3u] << 24u);
    packedLabels[blockIndex(workgroup.xy) * LABEL_WORDS_PER_BLOCK
      + local.y * (BLOCK_EXTENT / 4u) + local.x / 4u] = packed;
  }
}

// Un solo workgroup da 16 thread per blocco visita i bordi destro e inferiore.
// Sono 16x meno invocazioni rispetto a rilanciare tutti i 256 pixel del blocco.
@compute @workgroup_size(16, 1, 1)
fn unionBoundaries(
  @builtin(workgroup_id) workgroup: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
) {
  let origin = workgroup.xy * BLOCK_EXTENT;
  let edgeIndex = local.x;
  if (origin.x + BLOCK_EXTENT < uniforms.size.x) {
    let leftPixel = origin + vec2<u32>(BLOCK_EXTENT - 1u, edgeIndex);
    let rightPixel = leftPixel + vec2<u32>(1u, 0u);
    let leftLabel = labelAt(leftPixel);
    let rightLabel = labelAt(rightPixel);
    if (leftLabel != INVALID_LABEL && rightLabel != INVALID_LABEL) {
      unionGlobal(
        nodeForPixel(leftPixel, leftLabel),
        nodeForPixel(rightPixel, rightLabel),
      );
    }
  }
  if (origin.y + BLOCK_EXTENT < uniforms.size.y) {
    let topPixel = origin + vec2<u32>(edgeIndex, BLOCK_EXTENT - 1u);
    let bottomPixel = topPixel + vec2<u32>(0u, 1u);
    let topLabel = labelAt(topPixel);
    let bottomLabel = labelAt(bottomPixel);
    if (topLabel != INVALID_LABEL && bottomLabel != INVALID_LABEL) {
      unionGlobal(
        nodeForPixel(topPixel, topLabel),
        nodeForPixel(bottomPixel, bottomLabel),
      );
    }
  }
}

@compute @workgroup_size(256, 1, 1)
fn compressComponents(@builtin(global_invocation_id) global: vec3<u32>) {
  let count = min(atomicLoad(&metadata[${FILL_META_ACTIVE_COMPONENTS}u]), ACTIVE_NODE_CAPACITY);
  if (global.x >= count) { return; }
  let node = activeParentNodes[global.x];
  atomicStore(&globalParents[node], findGlobalRoot(node));
}

fn reduceAndRecord(
  pixel: vec2<u32>,
  selected: bool,
  block: vec2<u32>,
  localIndex: u32,
) {
  reduceCount[localIndex] = select(0u, 1u, selected);
  reduceMinX[localIndex] = select(INVALID_U32, pixel.x, selected);
  reduceMinY[localIndex] = select(INVALID_U32, pixel.y, selected);
  reduceMaxX[localIndex] = select(0u, pixel.x + 1u, selected);
  reduceMaxY[localIndex] = select(0u, pixel.y + 1u, selected);
  workgroupBarrier();

  var stride = 128u;
  loop {
    if (stride == 0u) { break; }
    if (localIndex < stride) {
      reduceCount[localIndex] += reduceCount[localIndex + stride];
      reduceMinX[localIndex] = min(reduceMinX[localIndex], reduceMinX[localIndex + stride]);
      reduceMinY[localIndex] = min(reduceMinY[localIndex], reduceMinY[localIndex + stride]);
      reduceMaxX[localIndex] = max(reduceMaxX[localIndex], reduceMaxX[localIndex + stride]);
      reduceMaxY[localIndex] = max(reduceMaxY[localIndex], reduceMaxY[localIndex + stride]);
    }
    workgroupBarrier();
    stride = stride >> 1u;
  }

  if (localIndex == 0u && reduceCount[0] > 0u) {
    let activeIndex = atomicAdd(&drawIndirect[1], 1u);
    activeBlocks[activeIndex] = blockIndex(block);
    atomicAdd(&metadata[${FILL_META_SELECTED_PIXELS}u], reduceCount[0]);
    atomicMin(&metadata[${FILL_META_MIN_X}u], reduceMinX[0]);
    atomicMin(&metadata[${FILL_META_MIN_Y}u], reduceMinY[0]);
    atomicMax(&metadata[${FILL_META_MAX_X}u], reduceMaxX[0]);
    atomicMax(&metadata[${FILL_META_MAX_Y}u], reduceMaxY[0]);
    atomicAdd(&metadata[${FILL_META_ACTIVE_BLOCKS}u], 1u);
    let coldTile = (block.y / ${FILL_BLOCKS_PER_TILE}u) * ${FILL_TILE_GRID_SIZE}u
      + block.x / ${FILL_BLOCKS_PER_TILE}u;
    atomicOr(&metadata[${FILL_META_TILE_MASK_START}u + coldTile / 32u], 1u << (coldTile & 31u));
  }
}

@compute @workgroup_size(16, 16, 1)
fn selectSeedComponent(
  @builtin(workgroup_id) workgroup: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let pixel = workgroup.xy * BLOCK_EXTENT + local.xy;
  let seedLabel = labelAt(uniforms.seed);
  let seedRoot = findGlobalRoot(nodeForPixel(uniforms.seed, seedLabel));
  let label = labelAt(pixel);
  let selected = label != INVALID_LABEL
    && findGlobalRoot(nodeForPixel(pixel, label)) == seedRoot;
  if (selected) {
    let word = pixel.y * (LAYER_EXTENT / 32u) + pixel.x / 32u;
    atomicOr(&selectedMask[word], 1u << (pixel.x & 31u));
  }
  reduceAndRecord(pixel, selected, workgroup.xy, localIndex);
}

@compute @workgroup_size(16, 16, 1)
fn rebuildSelection(
  @builtin(workgroup_id) workgroup: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let pixel = workgroup.xy * BLOCK_EXTENT + local.xy;
  let word = pixel.y * (LAYER_EXTENT / 32u) + pixel.x / 32u;
  let selected = (atomicLoad(&selectedMask[word]) & (1u << (pixel.x & 31u))) != 0u;
  reduceAndRecord(pixel, selected, workgroup.xy, localIndex);
}
`;

export const fillSelectionIntersectionShader = /* wgsl */ `
const FILL_MASK_WORDS: u32 = ${LAYER_SIZE * LAYER_SIZE / 32}u;

@group(0) @binding(0) var<storage, read_write> fillMask: array<u32>;
@group(0) @binding(1) var<storage, read> selectionMask: array<u32>;

@compute @workgroup_size(256, 1, 1)
fn intersectFillWithSelection(@builtin(global_invocation_id) global: vec3<u32>) {
  if (global.x >= FILL_MASK_WORDS) { return; }
  fillMask[global.x] = fillMask[global.x] & selectionMask[global.x];
}
`;

export const fillRenderShader = /* wgsl */ `
const LAYER_EXTENT: f32 = ${LAYER_SIZE}.0;
const BLOCK_EXTENT: u32 = ${FILL_BLOCK_SIZE}u;
const BLOCK_GRID: u32 = ${FILL_BLOCK_GRID_SIZE}u;

struct FillUniforms {
  seed: vec2<u32>,
  size: vec2<u32>,
  tolerance: f32,
  _padding0: f32,
  _padding1: f32,
  _padding2: f32,
  fillColor: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: FillUniforms;
@group(0) @binding(1) var<storage, read> selectedMask: array<u32>;
@group(0) @binding(2) var<storage, read> activeBlocks: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) pixel: vec2<f32>,
};

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  let corners = array<vec2<u32>, 4>(
    vec2<u32>(0u, 0u),
    vec2<u32>(1u, 0u),
    vec2<u32>(0u, 1u),
    vec2<u32>(1u, 1u),
  );
  let blockIndex = activeBlocks[instanceIndex];
  let block = vec2<u32>(blockIndex % BLOCK_GRID, blockIndex / BLOCK_GRID);
  let pixel = vec2<f32>((block + corners[vertexIndex]) * BLOCK_EXTENT);
  var output: VertexOutput;
  output.position = vec4<f32>(
    pixel.x / LAYER_EXTENT * 2.0 - 1.0,
    1.0 - pixel.y / LAYER_EXTENT * 2.0,
    0.0,
    1.0,
  );
  output.pixel = pixel;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let pixel = vec2<u32>(floor(input.pixel));
  let word = pixel.y * (${LAYER_SIZE}u / 32u) + pixel.x / 32u;
  if ((selectedMask[word] & (1u << (pixel.x & 31u))) == 0u) {
    discard;
  }
  return uniforms.fillColor;
}
`;
