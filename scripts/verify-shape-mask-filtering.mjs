import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { performance } from "node:perf_hooks";
import { deflateSync } from "node:zlib";
import {
  SHAPE_MASK_FILTER_CONTENT_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
  SHAPE_MASK_FILTER_UV_HALF_EXTENT,
  SHAPE_MASK_FILTER_UV_OFFSET,
  SHAPE_MASK_FILTER_UV_SCALE,
  SHAPE_MASK_SIZE,
  SHAPE_OCCUPANCY_GRID_SIZE,
  SHAPE_OCCUPANCY_MAP_COUNT,
  SHAPE_OCCUPANCY_WORDS_PER_MAP,
} from "../src/engine-limits.ts";
import {
  downsampleShapeMask2x,
  downsampleShapeMaskSupport2x,
  resampleShapeMaskIntoTransparentGuard,
  resampleShapeMaskSupportIntoTransparentGuard,
} from "../src/shape-mask-filtering.ts";
import { decodeGrayscalePng, decodeGrayscalePng8 } from "../src/png-mask.ts";

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, payload) => {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + payload.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, payload.length, false);
  output.set(typeBytes, 4);
  output.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(output.subarray(4, 8 + payload.length)), false);
  return output;
};
const grayscalePng = (width, height, bitDepth, samples) => {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = bitDepth;
  const bytesPerSample = bitDepth / 8;
  const rows = new Uint8Array((width * bytesPerSample + 1) * height);
  for (let y = 0; y < height; y += 1) {
    let offset = y * (width * bytesPerSample + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      const value = samples[y * width + x];
      if (bitDepth === 16) rows[offset++] = value >>> 8;
      rows[offset++] = value & 0xff;
    }
  }
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", new Uint8Array())];
  const totalBytes = signature.length + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const png = new Uint8Array(totalBytes);
  png.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png.buffer;
};

const sourceRootUrl = new URL("../src/", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(sourceRootUrl)
      && /^\.{1,2}\//.test(specifier)
      && !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const [
  {
    shapeTextureMemoryMiB,
    shapeTextureSequentialTransitionPeakMemoryMiB,
    shapeTextureUploadStagingMemoryMiB,
  },
  { buildShapeOccupancyMaps },
] = await Promise.all([
  import("../src/engine-memory-model.ts"),
  import("../src/shape-occupancy.ts"),
]);

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const native16Fixture = grayscalePng(2, 2, 16, [0, 1, 256, 65535]);
const decodedNative16 = await decodeGrayscalePng(native16Fixture);
assert.equal(decodedNative16.sourceBitDepth, 16);
assert.equal(decodedNative16.width, 2);
assert.equal(decodedNative16.height, 2);
assert.deepEqual([...decodedNative16.pixels], [0, 1, 256, 65535]);
assert.deepEqual(
  [...(await decodeGrayscalePng8(native16Fixture)).pixels],
  [0, 0, 1, 255],
  "the compatibility proxy must not replace native16 authoritative samples",
);
const expanded8 = await decodeGrayscalePng(grayscalePng(3, 1, 8, [0, 128, 255]));
assert.equal(expanded8.sourceBitDepth, 8);
assert.deepEqual([...expanded8.pixels], [0, 128 * 257, 65535]);

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
assert.throws(
  () => resampleShapeMaskSupportIntoTransparentGuard(new Uint8Array(3), 2, 0),
  /byte length/,
);
assert.throws(
  () => resampleShapeMaskSupportIntoTransparentGuard(new Uint8Array(4), 2, 1),
  /does not fit/,
);
assert.throws(
  () => downsampleShapeMaskSupport2x(new Uint8Array(9), 3),
  /positive even integer/,
);

const faintImpulse = new Uint8Array([
  1, 0,
  0, 0,
]);
assert.equal(
  downsampleShapeMask2x(faintImpulse, 2)[0],
  0,
  "the R8 visual mip demonstrates the expected quarter-code rounding loss",
);
assert.equal(
  downsampleShapeMaskSupport2x(faintImpulse, 2)[0],
  1,
  "R16F occupancy support must preserve a non-zero texel through max reduction",
);
const supportSnapshot = Uint8Array.from(faintImpulse);
downsampleShapeMaskSupport2x(faintImpulse, 2);
assert.deepEqual(faintImpulse, supportSnapshot, "support max-pooling must not mutate its input");

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

const sparseLogical = new Uint8Array(SHAPE_MASK_SIZE * SHAPE_MASK_SIZE);
sparseLogical[(SHAPE_MASK_SIZE / 2) * SHAPE_MASK_SIZE + SHAPE_MASK_SIZE / 2] = 1;
const protectedSupport = resampleShapeMaskSupportIntoTransparentGuard(
  sparseLogical,
  SHAPE_MASK_SIZE,
  SHAPE_MASK_FILTER_GUARD_TEXELS,
);
assert.equal(protectedSupport[0], 0, "the conservative support frame keeps its guard empty");
assert.ok(
  protectedSupport.some((value) => value === 1),
  "a one-code authored impulse must survive protected-frame reconstruction",
);
let supportMip = protectedSupport;
let supportMipSize = SHAPE_MASK_SIZE;
const protectedSupportMips = [protectedSupport];
for (let level = 1; level <= 4; level += 1) {
  supportMip = downsampleShapeMaskSupport2x(supportMip, supportMipSize);
  supportMipSize /= 2;
  protectedSupportMips.push(supportMip);
  assert.ok(
    supportMip.some((value) => value === 1),
    `a one-code authored impulse must survive support mip ${level}`,
  );
}
const sparseProtectedOccupancy = buildShapeOccupancyMaps(
  protectedSupportMips,
  { coordinateFrame: "protected" },
);
assert.ok(
  sparseProtectedOccupancy.activeCells.every((count) => count > 0),
  "the conservative one-code impulse must remain eligible through every occupancy mip",
);

const emptyOccupancyMips = Array.from(
  { length: SHAPE_OCCUPANCY_MAP_COUNT },
  (_, mipLevel) => new Uint8Array((SHAPE_MASK_SIZE >> mipLevel) ** 2),
);
const protectedEdgeMips = emptyOccupancyMips.map((mask) => Uint8Array.from(mask));
protectedEdgeMips[0][
  SHAPE_MASK_FILTER_GUARD_TEXELS * SHAPE_MASK_SIZE
  + SHAPE_MASK_FILTER_GUARD_TEXELS
] = 1;
const protectedEdgeOccupancy = buildShapeOccupancyMaps(
  protectedEdgeMips,
  { coordinateFrame: "protected" },
);
const logicalEdgeOccupancy = buildShapeOccupancyMaps(protectedEdgeMips);
const occupancyHasCell = (words, mipLevel, cellX, cellY) => {
  const cellIndex = cellY * SHAPE_OCCUPANCY_GRID_SIZE + cellX;
  const word = words[
    mipLevel * SHAPE_OCCUPANCY_WORDS_PER_MAP + (cellIndex >>> 5)
  ];
  return (word & ((1 << (cellIndex & 31)) >>> 0)) !== 0;
};
assert.equal(
  occupancyHasCell(protectedEdgeOccupancy.words, 0, 0, 0),
  true,
  "the inner protected-frame edge must map back to the first authored cell",
);
assert.equal(
  occupancyHasCell(protectedEdgeOccupancy.words, 0, 8, 8),
  false,
  "protected coordinates must not leak into logical occupancy as raw texel coordinates",
);
assert.equal(
  occupancyHasCell(logicalEdgeOccupancy.words, 0, 8, 8),
  true,
  "the control case proves that logical-frame occupancy interprets the same texel directly",
);

const protectedGuardMips = emptyOccupancyMips.map((mask) => Uint8Array.from(mask));
protectedGuardMips[0][0] = 1;
const protectedGuardOccupancy = buildShapeOccupancyMaps(
  protectedGuardMips,
  { coordinateFrame: "protected" },
);
assert.equal(
  protectedGuardOccupancy.activeCells[0],
  0,
  "support wholly inside the transparent guard must not occupy authored cells",
);

let expectedMipPixels = 0;
for (let dimension = SHAPE_MASK_SIZE; dimension >= 1; dimension /= 2) {
  expectedMipPixels += dimension * dimension;
}
const mebibyteBytes = 1024 * 1024;
const r8ShapeMemoryMiB = shapeTextureMemoryMiB("r8unorm");
const r16ShapeMemoryMiB = shapeTextureMemoryMiB("r16float");
assert.equal(shapeTextureMemoryMiB(), r16ShapeMemoryMiB, "R16F is the resident memory profile");
assert.equal(r8ShapeMemoryMiB, expectedMipPixels * 2 / mebibyteBytes);
assert.equal(r16ShapeMemoryMiB, expectedMipPixels * 2 / mebibyteBytes);
assert.equal(r16ShapeMemoryMiB, r8ShapeMemoryMiB, "both comparisons retain identical R16F storage");
assert.equal(
  shapeTextureMemoryMiB("r16float", 4),
  r16ShapeMemoryMiB * 4,
  "four Shape layers must account for four complete guarded mip chains",
);
const scalar16StagingMiB = shapeTextureUploadStagingMemoryMiB();
assert.equal(scalar16StagingMiB, 8, "one 2048-square scalar16 staging texture is 8 MiB");
const sequentialFourToFourPeakMiB = shapeTextureSequentialTransitionPeakMemoryMiB(4, 4);
assert.equal(
  sequentialFourToFourPeakMiB,
  r16ShapeMemoryMiB * 8 + scalar16StagingMiB,
  "a four-to-four retarget must overlap two resident arrays and only one staging texture",
);
assert.ok(
  sequentialFourToFourPeakMiB
    < r16ShapeMemoryMiB * 8 + scalar16StagingMiB * 4,
  "the sequential loader must stay below the former four-staging GPU peak",
);

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
const preprocessingSource = read("src/shape-preprocessing-core.ts");
const shadersSource = read("src/shaders.ts");
const blendShadersSource = read("src/blend-shaders.ts");
const outlineIndex = preprocessingSource.indexOf("buildBrushMaskOutline(");
const supportGuardIndex = preprocessingSource.indexOf(
  "resampleShapeMaskSupportIntoTransparentGuard(",
);
const occupancyIndex = preprocessingSource.indexOf("const occupancy = buildShapeOccupancyMaps(");
const r16UploadIndex = resourceSource.indexOf(
  "const texture = await createR16FloatShapeTexture(",
);
assert.ok(outlineIndex >= 0 && supportGuardIndex > outlineIndex);
assert.ok(occupancyIndex > supportGuardIndex && r16UploadIndex >= 0);
assert.match(
  preprocessingSource,
  /coordinateFrame: "protected"/,
  "both comparisons use the same protected R16F sampling frame",
);
assert.match(
  resourceSource,
  /prepared = await shapePreprocessingClient\.prepare\([\s\S]*?const texture = await createR16FloatShapeTexture\(/,
  "Shape CPU preprocessing must finish before the GPU upload begins",
);
assert.doesNotMatch(resourceSource, /format: "r8unorm"/);
assert.match(resourceSource, /format: "r16uint"/);
assert.match(resourceSource, /basePipelines\[sourceFormat\]/);
assert.match(
  resourceSource,
  /for await \(const batch of sources\.batches\)[\s\S]*?queue\.submit[\s\S]*?await engine\.device\.queue\.onSubmittedWorkDone\(\)[\s\S]*?stagingTexture\?\.destroy\(\)/,
  "each unique Shape source must finish on the GPU before its sole staging texture is destroyed",
);
assert.match(
  resourceSource,
  /for \(const \[assetId, layers\] of layersByAsset\)[\s\S]*?await decodeShapeMaskResource[\s\S]*?yield \{ source: decoded, layers \}/,
  "unique Shape sources must decode lazily instead of accumulating every scalar16 source",
);
assert.doesNotMatch(
  resourceSource,
  /const stagingTextures: GPUTexture\[\]/,
  "the Shape array loader must not retain one staging texture per unique source",
);
assert.match(shadersSource, /f32\(textureLoad\(sourceTexture,[\s\S]*?\/ 65535\.0/);
assert.match(shadersSource, /round\(normalized \* 255\.0\) \/ 255\.0/);

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
  + "R16F max-pooled support/protected occupancy, Paint/Blend UV parity, "
  + `${r8ShapeMemoryMiB.toFixed(2)} MiB R8 / ${r16ShapeMemoryMiB.toFixed(2)} MiB R16F. `
  + `Preparation medians: guard ${guardMedianMs.toFixed(1)} ms, `
  + `logical mips ${logicalMipMedianMs.toFixed(1)} ms, `
  + `protected mips ${protectedMipMedianMs.toFixed(1)} ms.`,
);
