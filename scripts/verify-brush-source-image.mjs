import assert from "node:assert/strict";

const source = await import("../src/brush-source-image.ts");

const png = new Uint8Array(24);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
png.set([0x49, 0x48, 0x44, 0x52], 12);
png.set([0x00, 0x00, 0x10, 0x00], 16);
png.set([0x00, 0x00, 0x08, 0x00], 20);
assert.deepEqual(
  source.brushSourceDimensionsFromBytes(png),
  { width: 4096, height: 2048 },
);

const jpeg = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x0b, 0xb8, 0x0f, 0xa0, 0x01, 0x01,
]);
assert.deepEqual(
  source.brushSourceDimensionsFromBytes(jpeg),
  { width: 4000, height: 3000 },
);

const webp = new Uint8Array(30);
webp.set([..."RIFF"].map((value) => value.charCodeAt(0)), 0);
webp.set([..."WEBP"].map((value) => value.charCodeAt(0)), 8);
webp.set([..."VP8X"].map((value) => value.charCodeAt(0)), 12);
const webpWidthMinusOne = 2499;
const webpHeightMinusOne = 1249;
webp.set([
  webpWidthMinusOne & 0xff,
  (webpWidthMinusOne >> 8) & 0xff,
  (webpWidthMinusOne >> 16) & 0xff,
], 24);
webp.set([
  webpHeightMinusOne & 0xff,
  (webpHeightMinusOne >> 8) & 0xff,
  (webpHeightMinusOne >> 16) & 0xff,
], 27);
assert.deepEqual(
  source.brushSourceDimensionsFromBytes(webp),
  { width: 2500, height: 1250 },
);

assert.deepEqual(
  source.brushSourceResizePlan(4096, 2048),
  { sourceWidth: 4096, sourceHeight: 2048, width: 2048, height: 1024 },
);
assert.throws(
  () => source.brushSourceResizePlan(8000, 6000),
  /too large to decode safely/,
  "a compressed 48 MP photo must be rejected before full-resolution decode",
);

console.log("Brush source image verification passed.");
