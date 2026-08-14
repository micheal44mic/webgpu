import {
  FILL_BLOCK_GRID_HEIGHT,
  FILL_BLOCK_GRID_WIDTH,
  FILL_BLOCK_SIZE,
  FILL_HISTORY_MASK_WORDS,
  FILL_HISTORY_WORDS_PER_ROW,
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
  FILL_TILE_HEIGHT,
  FILL_TILE_WIDTH,
  FILL_LAYER_HEIGHT,
  FILL_LAYER_WIDTH,
  FILL_RENDER_MASK_WORDS_PER_ROW,
} from "./fill-core.ts";
import { colorMatchShaderHelpers } from "./color-match-core.ts";

// Alcuni backend Vulkan/GLSL usati da Chrome Android compilano in modo errato
// lo shift dinamico `1u << 31u`: il bit alto sparisce e il risultato visibile è
// una riga non riempita ogni 32 pixel. Una lookup di costanti u32 conserva
// esattamente la rappresentazione 1-bit senza affidarsi a quello shift.
const fillBitMaskHelpers = /* wgsl */ `
const FILL_BIT_MASKS: array<u32, 32> = array<u32, 32>(
  0x00000001u, 0x00000002u, 0x00000004u, 0x00000008u,
  0x00000010u, 0x00000020u, 0x00000040u, 0x00000080u,
  0x00000100u, 0x00000200u, 0x00000400u, 0x00000800u,
  0x00001000u, 0x00002000u, 0x00004000u, 0x00008000u,
  0x00010000u, 0x00020000u, 0x00040000u, 0x00080000u,
  0x00100000u, 0x00200000u, 0x00400000u, 0x00800000u,
  0x01000000u, 0x02000000u, 0x04000000u, 0x08000000u,
  0x10000000u, 0x20000000u, 0x40000000u, 0x80000000u,
);

fn fillBitMask(bitIndex: u32) -> u32 {
  return FILL_BIT_MASKS[bitIndex & 31u];
}

fn fillMaskContains(word: u32, bitIndex: u32) -> bool {
  return (word & fillBitMask(bitIndex)) != 0u;
}
`;

// Fragment-stage workaround for ARM Valhall: the authoritative mask is
// expanded by compute into low bytes, so render never evaluates bit 31. The
// original 1-bit mask remains untouched for History and diagnostics.
const fillRenderBitMaskHelpers = /* wgsl */ `
const FILL_RENDER_BIT_MASKS: array<u32, 8> = array<u32, 8>(
  0x01u, 0x02u, 0x04u, 0x08u, 0x10u, 0x20u, 0x40u, 0x80u,
);

fn fillRenderMaskContains(word: u32, bitIndex: u32) -> bool {
  return (word & FILL_RENDER_BIT_MASKS[bitIndex & 7u]) != 0u;
}
`;

export const fillComputeShader = /* wgsl */ `
const LAYER_EXTENT: vec2<u32> = vec2<u32>(${FILL_LAYER_WIDTH}u, ${FILL_LAYER_HEIGHT}u);
const BLOCK_EXTENT: u32 = ${FILL_BLOCK_SIZE}u;
const BLOCK_GRID: vec2<u32> = vec2<u32>(${FILL_BLOCK_GRID_WIDTH}u, ${FILL_BLOCK_GRID_HEIGHT}u);
const ACTIVE_NODE_CAPACITY: u32 = ${FILL_BLOCK_GRID_WIDTH * FILL_BLOCK_GRID_HEIGHT}u;
const COMPONENTS_PER_BLOCK: u32 = ${FILL_MAX_COMPONENTS_PER_BLOCK}u;
const LABEL_WORDS_PER_BLOCK: u32 = ${FILL_LABEL_WORDS_PER_BLOCK}u;
const INVALID_LABEL: u32 = 255u;
const INVALID_U32: u32 = 0xffffffffu;

${fillBitMaskHelpers}

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

${colorMatchShaderHelpers}

fn matchesSeed(value: vec4<f32>) -> bool {
  return connectedStraightSrgbColorsMatch(
    straightSrgb(value),
    straightSrgb(seedColor),
    uniforms.tolerance,
  );
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
  return block.y * BLOCK_GRID.x + block.x;
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
  let matches = inside && matchesSeed(textureLoad(
    sourceLayer,
    vec2<i32>(min(pixel, uniforms.size - vec2<u32>(1u))),
    0,
  ));
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
    // Custom document dimensions make cold-storage tile edges independent of
    // the 16 px CCL block grid. One fill block can therefore overlap several
    // cold tiles; marking only the tile containing the block origin would lose
    // pixels after eviction/save. Use the reduced bounds of the pixels that
    // were actually selected in this block and mark every overlapping tile.
    let firstTile = min(
      vec2<u32>(reduceMinX[0] / ${FILL_TILE_WIDTH}u, reduceMinY[0] / ${FILL_TILE_HEIGHT}u),
      vec2<u32>(${FILL_TILE_GRID_SIZE - 1}u),
    );
    let lastTile = min(
      vec2<u32>(
        (reduceMaxX[0] - 1u) / ${FILL_TILE_WIDTH}u,
        (reduceMaxY[0] - 1u) / ${FILL_TILE_HEIGHT}u,
      ),
      vec2<u32>(${FILL_TILE_GRID_SIZE - 1}u),
    );
    var tileY = firstTile.y;
    loop {
      var tileX = firstTile.x;
      loop {
        let coldTile = tileY * ${FILL_TILE_GRID_SIZE}u + tileX;
        atomicOr(
          &metadata[${FILL_META_TILE_MASK_START}u + coldTile / 32u],
          fillBitMask(coldTile),
        );
        if (tileX == lastTile.x) { break; }
        tileX += 1u;
      }
      if (tileY == lastTile.y) { break; }
      tileY += 1u;
    }
  }
}

@compute @workgroup_size(16, 16, 1)
fn selectSeedComponent(
  @builtin(workgroup_id) workgroup: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let pixel = workgroup.xy * BLOCK_EXTENT + local.xy;
  let inside = all(pixel < uniforms.size);
  let seedLabel = labelAt(uniforms.seed);
  let seedRoot = findGlobalRoot(nodeForPixel(uniforms.seed, seedLabel));
  let safePixel = min(pixel, uniforms.size - vec2<u32>(1u));
  let label = labelAt(safePixel);
  let selected = inside && label != INVALID_LABEL
    && findGlobalRoot(nodeForPixel(safePixel, label)) == seedRoot;
  if (selected) {
    let word = pixel.y * ${FILL_HISTORY_WORDS_PER_ROW}u + pixel.x / 32u;
    atomicOr(&selectedMask[word], fillBitMask(pixel.x));
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
  let inside = all(pixel < uniforms.size);
  let safePixel = min(pixel, uniforms.size - vec2<u32>(1u));
  let word = safePixel.y * ${FILL_HISTORY_WORDS_PER_ROW}u + safePixel.x / 32u;
  let selected = inside
    && fillMaskContains(atomicLoad(&selectedMask[word]), safePixel.x);
  reduceAndRecord(pixel, selected, workgroup.xy, localIndex);
}

@compute @workgroup_size(256, 1, 1)
fn expandRenderMask(@builtin(global_invocation_id) global: vec3<u32>) {
  const SOURCE_WORDS: u32 = ${FILL_HISTORY_MASK_WORDS}u;
  const SOURCE_WORDS_PER_ROW: u32 = ${FILL_HISTORY_WORDS_PER_ROW}u;
  const TARGET_WORDS_PER_ROW: u32 = ${FILL_RENDER_MASK_WORDS_PER_ROW}u;
  if (global.x >= SOURCE_WORDS) { return; }
  let source = atomicLoad(&selectedMask[global.x]);
  let sourceRow = global.x / SOURCE_WORDS_PER_ROW;
  let sourceWordX = global.x % SOURCE_WORDS_PER_ROW;
  let targetWordX = sourceWordX * 4u;
  let targetWord = sourceRow * TARGET_WORDS_PER_ROW + targetWordX;
  // packedLabels is no longer needed once selectedMask has been produced. Its
  // capacity is twice this expanded mask even at the maximum document size.
  if (targetWordX < TARGET_WORDS_PER_ROW) {
    packedLabels[targetWord] = source & 0xffu;
  }
  if (targetWordX + 1u < TARGET_WORDS_PER_ROW) {
    packedLabels[targetWord + 1u] = (source >> 8u) & 0xffu;
  }
  if (targetWordX + 2u < TARGET_WORDS_PER_ROW) {
    packedLabels[targetWord + 2u] = (source >> 16u) & 0xffu;
  }
  if (targetWordX + 3u < TARGET_WORDS_PER_ROW) {
    packedLabels[targetWord + 3u] = (source >> 24u) & 0xffu;
  }
}
`;

export const fillSelectionIntersectionShader = /* wgsl */ `
const FILL_MASK_WORDS: u32 = ${FILL_HISTORY_MASK_WORDS}u;

@group(0) @binding(0) var<storage, read_write> fillMask: array<u32>;
@group(0) @binding(1) var<storage, read> selectionMask: array<u32>;

@compute @workgroup_size(256, 1, 1)
fn intersectFillWithSelection(@builtin(global_invocation_id) global: vec3<u32>) {
  if (global.x >= FILL_MASK_WORDS) { return; }
  fillMask[global.x] = fillMask[global.x] & selectionMask[global.x];
}
`;

/**
 * Lazy diagnostic shader. It runs only from the Copy report and distinguishes
 * four operations that old Android compilers/drivers have historically handled
 * differently: a literal high bit, atomicOr, a dynamic constant lookup and a
 * dynamic shift. Keeping it outside the normal Fill modules avoids adding any
 * pipeline cost to startup or to the tool hot path.
 */
export const fillBitProbeShader = /* wgsl */ `
${fillBitMaskHelpers}

struct ProbeUniforms {
  bitIndex: u32,
  _padding0: u32,
  _padding1: u32,
  _padding2: u32,
};

@group(0) @binding(0) var<uniform> probe: ProbeUniforms;
@group(0) @binding(1) var<storage, read_write> results: array<atomic<u32>>;

@compute @workgroup_size(1, 1, 1)
fn probeBit31() {
  let bit = probe.bitIndex & 31u;
  atomicStore(&results[0], 0x80000000u);
  atomicOr(&results[1], 0x80000000u);
  atomicStore(&results[2], fillBitMask(bit));
  atomicStore(&results[3], 1u << bit);
  atomicStore(&results[4], select(0u, 1u, fillMaskContains(0x80000000u, bit)));
}
`;

export const fillRenderShader = /* wgsl */ `
const LAYER_EXTENT: vec2<f32> = vec2<f32>(${FILL_LAYER_WIDTH}.0, ${FILL_LAYER_HEIGHT}.0);
const BLOCK_EXTENT: u32 = ${FILL_BLOCK_SIZE}u;
const BLOCK_GRID: vec2<u32> = vec2<u32>(${FILL_BLOCK_GRID_WIDTH}u, ${FILL_BLOCK_GRID_HEIGHT}u);

${fillRenderBitMaskHelpers}

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
@group(0) @binding(1) var<storage, read> renderMask: array<u32>;
@group(0) @binding(2) var<storage, read> activeBlocks: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
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
  let block = vec2<u32>(blockIndex % BLOCK_GRID.x, blockIndex / BLOCK_GRID.x);
  let pixel = vec2<f32>((block + corners[vertexIndex]) * BLOCK_EXTENT);
  var output: VertexOutput;
  output.position = vec4<f32>(
    pixel.x / LAYER_EXTENT.x * 2.0 - 1.0,
    1.0 - pixel.y / LAYER_EXTENT.y * 2.0,
    0.0,
    1.0,
  );
  return output;
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // La posizione framebuffer è già il texel autorevole del target. Evitare un
  // varying interpolato elimina anche le differenze di precisione ai bordi dei
  // quad istanziati sui driver mobile.
  let pixel = vec2<u32>(position.xy);
  if (pixel.x >= ${FILL_LAYER_WIDTH}u || pixel.y >= ${FILL_LAYER_HEIGHT}u) { discard; }
  let word = pixel.y * ${FILL_RENDER_MASK_WORDS_PER_ROW}u + pixel.x / 8u;
  if (!fillRenderMaskContains(renderMask[word], pixel.x)) {
    discard;
  }
  return uniforms.fillColor;
}
`;
