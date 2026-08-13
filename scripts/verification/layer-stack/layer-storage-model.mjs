import assert from "node:assert/strict";
import {
  LAYER_STACK_MAXIMUM,
  LayerStack,
} from "../../../src/layer-stack.ts";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
} from "../../../src/shadow-core.ts";
import {
  DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  copyRasterColorOverlayStyle,
} from "../../../src/raster-color-overlay-core.ts";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_MASK_WORD_COUNT,
  LAYER_STORAGE_STRATEGY,
  LAYER_STORAGE_TILE_COUNT,
  alignedBoundsTileCount,
  clearLayerStorageTileMask,
  compareLayerStorageMasks,
  countLayerStorageTiles,
  createLayerStorageTileMask,
  exactLayerStorageTileMask,
  layerStorageTileMemoryMiB,
  markLayerStorageRect,
  layerStorageTileIndices,
} from "../../../src/layer-storage-study.ts";

const createStyles = () => ({
  strokeStyle: { enabled: false, width: 14, position: "outside", color: [1, 0.643, 0.282, 1] },
  bevelStyle: { enabled: false, mode: "inner", technique: "smooth", size: 32, soften: 4 },
  outerShadowStyle: copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE),
  innerShadowStyle: copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE),
  colorOverlayStyle: copyRasterColorOverlayStyle(DEFAULT_RASTER_COLOR_OVERLAY_STYLE),
});
const newStack = () => new LayerStack(createStyles);

// The cap is enforced. Only the authoritative mip 0 scales per layer
// (64 MiB RGBA8 / 128 MiB RGBA16F); display pyramids are shared.
{
  const stack = newStack();
  while (stack.count < LAYER_STACK_MAXIMUM) {
    stack.add();
  }
  assert.equal(stack.count, LAYER_STACK_MAXIMUM);
  assert.throws(() => stack.add(), /Massimo/);
}

// Fill Reference adds at most one second full canvas; every other inactive
// layer remains a deterministic 256² tile array.
assert.equal(
  LAYER_STORAGE_STRATEGY,
  "single-active-plus-optional-reference-full-inactive-256-array-tiles-direct-native-fold-fallback-rehydrate",
);
assert.equal(LAYER_STORAGE_GRID_SIZE, 16);
assert.equal(LAYER_STORAGE_TILE_COUNT, 256);
assert.equal(LAYER_STORAGE_MASK_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT, 32);

// Every record owns a fresh mask. Sharing one would make painting on B mark A.
{
  const stack = newStack();
  stack.add();
  assert.notEqual(stack.at(0).storageTileMask, stack.at(1).storageTileMask);
  assert.equal(countLayerStorageTiles(stack.at(0).storageTileMask), 0);
  assert.equal(countLayerStorageTiles(stack.at(1).storageTileMask), 0);
  markLayerStorageRect(stack.at(0).storageTileMask, {
    x: 32,
    y: 48,
    width: 8,
    height: 12,
  });
  assert.equal(countLayerStorageTiles(stack.at(0).storageTileMask), 1);
  assert.equal(countLayerStorageTiles(stack.at(1).storageTileMask), 0);
}

// A rect straddling both 256-pixel seams touches exactly four tiles. Clamping a
// document-sized rect must cover all 256 without writing outside the bitset.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 255, y: 255, width: 2, height: 2 });
  assert.equal(countLayerStorageTiles(mask), 4);
  clearLayerStorageTileMask(mask);
  markLayerStorageRect(mask, { x: -50, y: -80, width: 5000, height: 5000 });
  assert.equal(countLayerStorageTiles(mask), LAYER_STORAGE_TILE_COUNT);
  clearLayerStorageTileMask(mask);
  assert.equal(countLayerStorageTiles(mask), 0);
}

// Sparse corners demonstrate the storage win: two occupied
// pages versus a full-document aligned bbox.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 0, y: 0, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 4095, y: 4095, width: 1, height: 1 });
  assert.equal(countLayerStorageTiles(mask), 2);
  assert.equal(
    alignedBoundsTileCount({ x: 0, y: 0, width: 4096, height: 4096 }),
    256,
  );
  assert.equal(layerStorageTileMemoryMiB(1, 4), 0.25);
  assert.equal(layerStorageTileMemoryMiB(1, 8), 0.5);
  assert.equal(layerStorageTileMemoryMiB(256, 4), 64);
  assert.equal(layerStorageTileMemoryMiB(256, 8), 128);
}

// Array slices must be deterministic because hydration uses the same ordered
// list to map each slice back to its document tile.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 4095, y: 4095, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 0, y: 256, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 3840, y: 0, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(layerStorageTileIndices(mask), [0, 15, 16, 255]);
}
// Exact occupancy means any non-zero raw byte, not alpha. This preserves a
// future or malformed transparent-RGB texel byte-for-byte.
{
  const pixels = new Uint8Array(512 * 512 * 4);
  pixels[0] = 17; // RGB non-zero, alpha remains zero.
  pixels[(300 * 512 + 300) * 4 + 3] = 255;
  const exact = exactLayerStorageTileMask(pixels, 512, 512, 4);
  assert.equal(countLayerStorageTiles(exact), 2);

  const conservative = createLayerStorageTileMask();
  markLayerStorageRect(conservative, { x: 0, y: 0, width: 1, height: 1 });
  markLayerStorageRect(conservative, { x: 300, y: 300, width: 1, height: 1 });
  assert.deepEqual(compareLayerStorageMasks(exact, conservative), {
    missedReferenceTiles: 0,
    extraCandidateTiles: 0,
  });

  const underMarked = createLayerStorageTileMask();
  markLayerStorageRect(underMarked, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(compareLayerStorageMasks(exact, underMarked).missedReferenceTiles, 1);
}

// RGBA16F is scanned as raw bytes too: a non-zero high half in the second word
// of a texel must still keep the tile.
{
  const pixels = new Uint8Array(256 * 256 * 8);
  pixels[7] = 0x80;
  assert.equal(
    countLayerStorageTiles(exactLayerStorageTileMask(pixels, 256, 256, 8)),
    1,
  );
}

// Deterministic differential fuzz: every non-zero texel chosen inside a dirty
// rect must be covered by the conservative mask. Over-marking is allowed.
{
  let state = 0x12345678;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const pixels = new Uint8Array(512 * 512 * 4);
  const conservative = createLayerStorageTileMask();
  for (let index = 0; index < 128; index += 1) {
    const x = Math.floor(random() * 500);
    const y = Math.floor(random() * 500);
    const width = 1 + Math.floor(random() * (512 - x));
    const height = 1 + Math.floor(random() * (512 - y));
    markLayerStorageRect(conservative, { x, y, width, height });
    const pixelX = x + Math.floor(random() * width);
    const pixelY = y + Math.floor(random() * height);
    pixels[(pixelY * 512 + pixelX) * 4] = 1;
  }
  const exact = exactLayerStorageTileMask(pixels, 512, 512, 4);
  assert.equal(compareLayerStorageMasks(exact, conservative).missedReferenceTiles, 0);
}

assert.throws(
  () => exactLayerStorageTileMask(new Uint8Array(3), 1, 1, 4),
  /Readback non valido/,
);

{
  const stack = newStack();
  assert.equal(stack.anyHasContent(), false);
  stack.add();
  stack.at(0).hasContent = true;
  assert.equal(stack.anyHasContent(), true);
}
