import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  SHAPE_MASK_FILTER_CONTENT_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
  SHAPE_MASK_FILTER_UV_HALF_EXTENT,
  SHAPE_MASK_FILTER_UV_OFFSET,
  SHAPE_MASK_FILTER_UV_SCALE,
  SHAPE_MASK_SIZE,
} from "../src/engine-limits.ts";
import {
  downsampleShapeMask2x,
  resampleShapeMaskIntoTransparentGuard,
} from "../src/shape-mask-filtering.ts";
import { decodeGrayscalePng8 } from "../src/png-mask.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

assert.equal(SHAPE_MASK_SIZE, 2048);
assert.equal(SHAPE_MASK_FILTER_GUARD_TEXELS, 64);
assert.equal(SHAPE_MASK_FILTER_CONTENT_SIZE, 1920);
assert.equal(SHAPE_MASK_FILTER_UV_SCALE, 15 / 16);
assert.equal(SHAPE_MASK_FILTER_UV_OFFSET, 1 / 32);
assert.equal(SHAPE_MASK_FILTER_UV_HALF_EXTENT, 15 / 32);

assert.throws(
  () => resampleShapeMaskIntoTransparentGuard(new Uint8Array(3), 2, 0),
  /byte length/,
);
assert.throws(
  () => resampleShapeMaskIntoTransparentGuard(new Uint8Array(4), 2, 1),
  /does not fit/,
);
assert.throws(
  () => downsampleShapeMask2x(new Uint8Array(9), 3),
  /positive even integer/,
);

const lowCoverageSource = new Uint8Array(64).fill(1);
const lowCoverageSnapshot = Uint8Array.from(lowCoverageSource);
const lowCoverageProtected = resampleShapeMaskIntoTransparentGuard(
  lowCoverageSource,
  8,
  1,
);
assert.deepEqual(lowCoverageSource, lowCoverageSnapshot, "the logical source must remain immutable");
for (let index = 0; index < 8; index += 1) {
  assert.equal(lowCoverageProtected[index], 0);
  assert.equal(lowCoverageProtected[56 + index], 0);
  assert.equal(lowCoverageProtected[index * 8], 0);
  assert.equal(lowCoverageProtected[index * 8 + 7], 0);
}
for (let y = 1; y < 7; y += 1) {
  for (let x = 1; x < 7; x += 1) {
    assert.equal(
      lowCoverageProtected[y * 8 + x],
      1,
      "low-alpha authored coverage must not be thresholded away",
    );
  }
}

const sampleLinear = (mask, size, u, v) => {
  const sampleX = u * size - 0.5;
  const sampleY = v * size - 0.5;
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(sampleX)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(sampleY)));
  const x1 = Math.max(0, Math.min(size - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(size - 1, y0 + 1));
  const tx = Math.max(0, Math.min(1, sampleX - Math.floor(sampleX)));
  const ty = Math.max(0, Math.min(1, sampleY - Math.floor(sampleY)));
  const top = mask[y0 * size + x0] * (1 - tx) + mask[y0 * size + x1] * tx;
  const bottom = mask[y1 * size + x0] * (1 - tx) + mask[y1 * size + x1] * tx;
  return top * (1 - ty) + bottom * ty;
};

const opaqueLogical = new Uint8Array(SHAPE_MASK_SIZE * SHAPE_MASK_SIZE).fill(255);
const protectedOpaque = resampleShapeMaskIntoTransparentGuard(
  opaqueLogical,
  SHAPE_MASK_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
);
assert.equal(protectedOpaque.length, opaqueLogical.length, "GPU texture memory must stay unchanged");
assert.equal(protectedOpaque[0], 0);
assert.equal(
  protectedOpaque[
    SHAPE_MASK_FILTER_GUARD_TEXELS * SHAPE_MASK_SIZE
    + SHAPE_MASK_FILTER_GUARD_TEXELS
  ],
  255,
);
assert.equal(protectedOpaque[(SHAPE_MASK_SIZE / 2) * SHAPE_MASK_SIZE + SHAPE_MASK_SIZE / 2], 255);
assert.equal(
  sampleLinear(
    protectedOpaque,
    SHAPE_MASK_SIZE,
    SHAPE_MASK_FILTER_UV_OFFSET,
    0.5,
  ),
  127.5,
  "a full authored square must keep its logical extent with a filtered boundary",
);

let mip = protectedOpaque;
let mipSize = SHAPE_MASK_SIZE;
for (let level = 1; level <= 6; level += 1) {
  mip = downsampleShapeMask2x(mip, mipSize);
  mipSize /= 2;
  const guard = SHAPE_MASK_FILTER_GUARD_TEXELS >> level;
  assert.ok(guard >= 1);
  for (let edge = 0; edge < guard; edge += 1) {
    for (let coordinate = 0; coordinate < mipSize; coordinate += 1) {
      assert.equal(mip[edge * mipSize + coordinate], 0, `mip ${level} top guard`);
      assert.equal(
        mip[(mipSize - 1 - edge) * mipSize + coordinate],
        0,
        `mip ${level} bottom guard`,
      );
      assert.equal(mip[coordinate * mipSize + edge], 0, `mip ${level} left guard`);
      assert.equal(
        mip[coordinate * mipSize + mipSize - 1 - edge],
        0,
        `mip ${level} right guard`,
      );
    }
  }
}
assert.equal(mipSize, 32, "the 64 px guard must survive through the 30 px-tip mip");

const pencilPng = readFileSync(new URL("Shapepencil.png", root));
const pencilSource = pencilPng.buffer.slice(
  pencilPng.byteOffset,
  pencilPng.byteOffset + pencilPng.byteLength,
);
const decodedPencil = await decodeGrayscalePng8(pencilSource);
const logicalPencil = Uint8Array.from(decodedPencil.pixels, (value) => 255 - value);
const protectedPencil = resampleShapeMaskIntoTransparentGuard(
  logicalPencil,
  SHAPE_MASK_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
);
assert.equal(protectedPencil[0], 0);
assert.ok(
  protectedPencil.some((value) => value > 0),
  "the real Pencil coverage must survive guard preparation",
);

const resourceSource = read("src/engine-resource-setup.ts");
const shadersSource = read("src/shaders.ts");
const blendShadersSource = read("src/blend-shaders.ts");
const outlineIndex = resourceSource.indexOf("buildBrushMaskOutline(baseMask");
const occupancyIndex = resourceSource.indexOf("buildShapeOccupancyMaps(occupancyMipMasks)");
const guardIndex = resourceSource.indexOf("resampleShapeMaskIntoTransparentGuard(");
const uploadIndex = resourceSource.indexOf("engine.device.createTexture", guardIndex);
assert.ok(outlineIndex >= 0 && occupancyIndex > outlineIndex);
assert.ok(guardIndex > occupancyIndex && uploadIndex > guardIndex,
  "outline/occupancy/preview must use logical coverage before the GPU-only guard");

assert.equal(
  (shadersSource.match(/const SHAPE_MASK_UV_HALF_EXTENT: f32 = \$\{SHAPE_MASK_FILTER_UV_HALF_EXTENT\}/g)
    ?? []).length,
  2,
  "both Shape fragment modules must receive the shared protected UV extent",
);
assert.ok(
  (shadersSource.match(/input\.localPosition \* SHAPE_MASK_UV_HALF_EXTENT/g) ?? []).length >= 4,
  "every regular and occupied Shape sample must use protected coordinates",
);
assert.match(
  shadersSource,
  /shapeOccupancyMayContribute\(logicalUv\)[\s\S]*?textureSampleGrad\([\s\S]*?samplingUv/,
  "occupancy must stay in logical coordinates while sampling uses the protected UV",
);
assert.match(
  blendShadersSource,
  /SHAPE_MASK_UV_SCALE: f32 = \$\{SHAPE_MASK_FILTER_UV_SCALE\}/,
);
assert.match(
  blendShadersSource,
  /SHAPE_MASK_UV_OFFSET: f32 = \$\{SHAPE_MASK_FILTER_UV_OFFSET\}/,
);
assert.match(
  blendShadersSource,
  /local\.uv \* SHAPE_MASK_UV_SCALE \+ vec2<f32>\(SHAPE_MASK_UV_OFFSET\)/,
  "dry Blend must sample the same protected Shape coordinates as Paint",
);

const buildFullMipChain = (base) => {
  let level = base;
  let size = SHAPE_MASK_SIZE;
  while (size > 1) {
    level = downsampleShapeMask2x(level, size);
    size /= 2;
  }
  return level[0];
};
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const measure = (operation, runs = 3) => {
  operation();
  const durations = [];
  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now();
    operation();
    durations.push(performance.now() - startedAt);
  }
  return median(durations);
};

const logicalMipMedianMs = measure(() => buildFullMipChain(logicalPencil));
const guardMedianMs = measure(() => resampleShapeMaskIntoTransparentGuard(
  logicalPencil,
  SHAPE_MASK_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
));
const protectedMipMedianMs = measure(() => buildFullMipChain(protectedPencil));

console.log(
  "Shape mask filtering verified: immutable logical mask, 64 px transparent guard, "
  + "mip-6 boundary, Paint/Blend UV parity, unchanged GPU bytes. "
  + `Preparation medians: guard ${guardMedianMs.toFixed(1)} ms, `
  + `logical mips ${logicalMipMedianMs.toFixed(1)} ms, `
  + `protected mips ${protectedMipMedianMs.toFixed(1)} ms.`,
);
