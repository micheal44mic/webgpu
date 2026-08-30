import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RASTER_IMAGE_IMPORT_STRATEGY,
  RasterImageImportError,
  decodeRasterImage,
  inspectRasterImage,
  releaseDecodedRasterImage,
} from "../src/raster-image-import.ts";
import {
  RASTER_IMAGE_LAYER_IMPORT_STRATEGY,
  rasterImageLayerBlitShader,
  rasterImageLayerRebuildShader,
} from "../src/raster-image-layer-import-shader.ts";
import {
  planRasterImageMemory,
  rasterImageMipChainBytes,
  RASTER_IMAGE_DECODED_BYTES_PER_PIXEL,
  RASTER_IMAGE_LINEAR_BYTES_PER_PIXEL,
  RASTER_IMAGE_UNIFORM_BYTES,
} from "../src/raster-image-budget.ts";

const runtimeSource = readFileSync(
  new URL("../src/engine-raster-image-runtime.ts", import.meta.url),
  "utf8",
);
const shaderSource = readFileSync(
  new URL("../src/raster-image-layer-import-shader.ts", import.meta.url),
  "utf8",
);
const controllerSource = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);
const engineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const displayShaderSource = readFileSync(
  new URL("../src/shaders.ts", import.meta.url),
  "utf8",
);
const htmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function u32be(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function u16be(value) {
  return [(value >>> 8) & 255, value & 255];
}

function u32le(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function isoBox(type, data = []) {
  return [...u32be(data.length + 8), ...Buffer.from(type, "ascii"), ...data];
}

function pngChunk(type, data = []) {
  return [...u32be(data.length), ...Buffer.from(type, "ascii"), ...data, 0, 0, 0, 0];
}

function structuralPng(width, height, extraChunks = []) {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
    ...extraChunks.flat(),
    ...pngChunk("IDAT", [0]),
    ...pngChunk("IEND"),
  ]);
}

function structuralJpeg(width, height, trailing = []) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x08, 0x08, ...u16be(height), ...u16be(width), 0x01,
    0xff, 0xd9,
    ...trailing,
  ]);
}

function structuralWebp(width, height, animated = false) {
  const packed = ((width - 1) | ((height - 1) << 14)) >>> 0;
  const chunks = animated
    ? [
      ...Buffer.from("VP8X", "ascii"), ...u32le(10), 0x02, 0, 0, 0,
      ...[...u32le(width - 1)].slice(0, 3),
      ...[...u32le(height - 1)].slice(0, 3),
    ]
    : [
      ...Buffer.from("VP8L", "ascii"), ...u32le(5), 0x2f, ...u32le(packed), 0,
    ];
  const payload = [...Buffer.from("WEBP", "ascii"), ...chunks];
  return new Uint8Array([
    ...Buffer.from("RIFF", "ascii"),
    ...u32le(payload.length),
    ...payload,
  ]);
}

function structuralAvif(width, height, auxiliaryDimensions = null) {
  const fullBox = [0, 0, 0, 0];
  const properties = [
    ...isoBox("ispe", [...fullBox, ...u32be(width), ...u32be(height)]),
    ...(auxiliaryDimensions
      ? isoBox("ispe", [
        ...fullBox,
        ...u32be(auxiliaryDimensions.width),
        ...u32be(auxiliaryDimensions.height),
      ])
      : []),
  ];
  const ipco = isoBox("ipco", properties);
  const ipma = isoBox("ipma", [
    ...fullBox,
    ...u32be(1),
    ...u16be(1),
    1,
    1,
  ]);
  const iprp = isoBox("iprp", [...ipco, ...ipma]);
  const pitm = isoBox("pitm", [...fullBox, ...u16be(1)]);
  const meta = isoBox("meta", [...fullBox, ...pitm, ...iprp]);
  const ftyp = isoBox("ftyp", [
    ...Buffer.from("avif", "ascii"),
    ...u32be(0),
    ...Buffer.from("avif", "ascii"),
    ...Buffer.from("mif1", "ascii"),
  ]);
  return new Uint8Array([...ftyp, ...meta]);
}

assert.equal(
  RASTER_IMAGE_IMPORT_STRATEGY,
  "byte-sniff-static-png-jpeg-webp-avif-create-image-bitmap-v1",
);
assert.equal(
  RASTER_IMAGE_LAYER_IMPORT_STRATEGY,
  "decoded-rgba8-srgb-to-gamma-premultiplied-rgba16float-exact-npot-mips-immutable-master-continuous-lod-v5",
);
assert.equal(RASTER_IMAGE_DECODED_BYTES_PER_PIXEL, 4);
assert.equal(RASTER_IMAGE_LINEAR_BYTES_PER_PIXEL, 8);
assert.match(
  rasterImageLayerBlitShader,
  /let texcoords = array<vec2<f32>, 4>\(\s*vec2<f32>\(0\.0, 1\.0\),\s*vec2<f32>\(1\.0, 1\.0\),\s*vec2<f32>\(0\.0, 0\.0\),\s*vec2<f32>\(1\.0, 0\.0\)/,
  "il blit deve associare il bordo superiore del framebuffer a V=0 della bitmap",
);

assert.deepEqual(planRasterImageMemory(1, 1, 7), {
  width: 1,
  height: 1,
  mipLevelCount: 1,
  residentGpuBytes: 8 + RASTER_IMAGE_UNIFORM_BYTES,
  uploadTextureBytes: 4,
  decodedBitmapBytes: 4,
  inspectionBytes: 7,
  logicalImportPeakBytes: 8 + RASTER_IMAGE_UNIFORM_BYTES + 4 + 4 + 7,
});
assert.equal(rasterImageMipChainBytes(3, 1), 32, "NPOT RGBA16F mips must include 3×1 and 1×1");
assert.equal(
  rasterImageMipChainBytes(2 ** 32 + 1, 1, 2),
  ((2 ** 32 + 1) + 2 ** 31) * 8,
  "pure accounting must not truncate dimensions through signed bit shifts",
);
assert.throws(() => rasterImageMipChainBytes(3, 1, 3), /at most 2 mip levels/);
assert.deepEqual(planRasterImageMemory(3, 1, 5), {
  width: 3,
  height: 1,
  mipLevelCount: 2,
  residentGpuBytes: 32 + RASTER_IMAGE_UNIFORM_BYTES,
  uploadTextureBytes: 12,
  decodedBitmapBytes: 12,
  inspectionBytes: 5,
  logicalImportPeakBytes: 32 + RASTER_IMAGE_UNIFORM_BYTES + 12 + 12 + 5,
});
const desktopSizedBudget = planRasterImageMemory(4096, 4096, 16 * 1024 * 1024);
assert.ok(desktopSizedBudget.logicalImportPeakBytes < 384 * 1024 * 1024);
const decoderHeavyBudget = planRasterImageMemory(6000, 6000, 1);
assert.ok(
  decoderHeavyBudget.logicalImportPeakBytes > 384 * 1024 * 1024,
  "logical peak must include the decoded bitmap as well as upload and resident textures",
);
const one4k = planRasterImageMemory(4096, 4096, 1);
assert.equal(one4k.uploadTextureBytes, 64 * 1024 * 1024);

const png = structuralPng(320, 240);
const inspected = await inspectRasterImage(new Blob([png], { type: "image/png" }));
assert.equal(inspected.format, "png");
assert.equal(inspected.mimeType, "image/png");
assert.equal(inspected.encodedWidth, 320);
assert.equal(inspected.encodedHeight, 240);
assert.equal(inspected.animated, false);

const realPng = await inspectRasterImage(new Blob([
  readFileSync(new URL("../Shape.png", import.meta.url)),
], { type: "image/png" }));
assert.equal(realPng.format, "png");
assert.ok(realPng.encodedWidth > 0 && realPng.encodedHeight > 0);

const jpeg = await inspectRasterImage(new Blob([
  structuralJpeg(640, 480, [0, 0, 0]),
], { type: "image/jpeg" }));
assert.deepEqual(
  [jpeg.format, jpeg.encodedWidth, jpeg.encodedHeight],
  ["jpeg", 640, 480],
);
await assert.rejects(
  inspectRasterImage(new Blob([
    structuralJpeg(8, 8, [0xff, 0xd8, 0xff, 0xd9]),
  ], { type: "image/jpeg" })),
  (error) => error instanceof RasterImageImportError && error.code === "invalid-image",
);

const webp = await inspectRasterImage(new Blob([
  structuralWebp(321, 241),
], { type: "image/webp" }));
assert.deepEqual(
  [webp.format, webp.encodedWidth, webp.encodedHeight],
  ["webp", 321, 241],
);
await assert.rejects(
  inspectRasterImage(new Blob([structuralWebp(8, 8, true)], { type: "image/webp" })),
  (error) => error instanceof RasterImageImportError && error.code === "animated-image",
);

const avif = await inspectRasterImage(new Blob([
  structuralAvif(800, 600, { width: 4096, height: 4096 }),
], { type: "image/avif" }));
assert.deepEqual(
  [avif.format, avif.encodedWidth, avif.encodedHeight],
  ["avif", 800, 600],
  "AVIF must resolve pitm/ipma instead of selecting the largest auxiliary ispe",
);

await assert.rejects(
  inspectRasterImage(new Blob([
    structuralPng(8, 8, [pngChunk("acTL", [...u32be(2), ...u32be(0)])]),
  ], { type: "image/png" })),
  (error) => error instanceof RasterImageImportError && error.code === "animated-image",
);

const originalCreateImageBitmap = globalThis.createImageBitmap;
let createImageBitmapCalls = 0;
let closeCalls = 0;
let capturedBitmapOptions = null;
try {
  globalThis.createImageBitmap = async (_source, options) => {
    createImageBitmapCalls += 1;
    capturedBitmapOptions = options;
    return {
      width: 320,
      height: 240,
      close() { closeCalls += 1; },
    };
  };
  const decoded = await decodeRasterImage(
    new Blob([png], { type: "image/png" }),
    { sourceName: "cartella/prova.png" },
  );
  assert.equal(decoded.metadata.sourceName, "prova.png");
  assert.equal(decoded.metadata.pixelCount, 320 * 240);
  assert.deepEqual(capturedBitmapOptions, {
    colorSpaceConversion: "default",
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
  });
  releaseDecodedRasterImage(decoded);
  assert.equal(closeCalls, 1);

  createImageBitmapCalls = 0;
  await assert.rejects(
    decodeRasterImage(new Blob([png], { type: "image/png" }), {
      preflight: () => { throw new Error("budget-mip"); },
    }),
    /budget-mip/,
  );
  assert.equal(createImageBitmapCalls, 0, "preflight must run before bitmap allocation");

  globalThis.createImageBitmap = async () => ({
    width: 1024,
    height: 1024,
    close() { closeCalls += 1; },
  });
  await assert.rejects(
    decodeRasterImage(new Blob([png], { type: "image/png" }), {
      limits: { maximumPixels: 320 * 240 },
    }),
    (error) => error instanceof RasterImageImportError
      && error.code === "dimensions-too-large",
  );
  assert.equal(closeCalls, 2, "failed post-decode validation must close the bitmap");
} finally {
  if (originalCreateImageBitmap === undefined) {
    delete globalThis.createImageBitmap;
  } else {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
}
await assert.rejects(
  inspectRasterImage(new Blob([png], { type: "image/jpeg" })),
  (error) => error instanceof RasterImageImportError && error.code === "mime-mismatch",
);
await assert.rejects(
  inspectRasterImage(new Blob([png], { type: "image/png" }), { maximumWidth: 100 }),
  (error) => error instanceof RasterImageImportError && error.code === "dimensions-too-large",
);

assert.match(runtimeSource, /copyExternalImageToTexture\(/);
assert.match(runtimeSource, /premultipliedAlpha: false/);
assert.match(
  runtimeSource,
  /GPUTextureUsage\.COPY_DST[\s\S]{0,100}GPUTextureUsage\.TEXTURE_BINDING[\s\S]{0,100}GPUTextureUsage\.RENDER_ATTACHMENT/,
  "copyExternalImageToTexture destination must allow Dawn's render path",
);
assert.equal(
  (runtimeSource.match(/format: "rgba8unorm-srgb"/g) ?? []).length,
  1,
  "only the browser-decoded straight source may remain RGBA8-sRGB",
);
assert.ok(
  (runtimeSource.match(/format: "rgba16float"/g) ?? []).length >= 3,
  "premultiply target, mip target and linear mip texture must be RGBA16F",
);
assert.doesNotMatch(shaderSource, /pack4x8unorm|unpack4x8unorm/);
assert.match(shaderSource, /sourceTransform\.documentExtent/);
assert.doesNotMatch(shaderSource, /DOCUMENT_(?:WIDTH|HEIGHT)|engine-limits/);
assert.match(runtimeSource, /upload\[6\] = Math\.fround\(engine\.documentWidth\)/);
assert.match(runtimeSource, /upload\[7\] = Math\.fround\(engine\.documentHeight\)/);
assert.match(runtimeSource, /GPUTextureUsage\.RENDER_ATTACHMENT/);
assert.match(runtimeSource, /allocateLayerGpuResources\(/);
assert.match(runtimeSource, /createLayerColdStorageCandidate\(/);
assert.match(runtimeSource, /scene\.addRasterAboveSelection\(record\.id\)/);
assert.match(runtimeSource, /record\.storageTileMask\.fill\(0\)/);
assert.match(runtimeSource, /markLayerStorageRect\(record\.storageTileMask, bounds\)/);
assert.match(runtimeSource, /applyRasterImportHistory/);
assert.match(runtimeSource, /insertRasterAt\(action\.layerId, sceneInsertionIndex/);
assert.match(runtimeSource, /action\.rasterLayerIndex = targetIndex/);
assert.match(runtimeSource, /action\.sceneIndex = currentSceneIndex/);
assert.match(runtimeSource, /activeRasterLayerIdBefore/);
assert.match(runtimeSource, /raster-import Undo rollback failed/);
assert.match(runtimeSource, /raster-import Redo rollback failed/);
const redoImportStart = runtimeSource.indexOf("async function redoRasterImport(");
const redoImportEnd = runtimeSource.indexOf("export async function applyRasterImportHistory", redoImportStart);
assert.notEqual(redoImportStart, -1);
assert.notEqual(redoImportEnd, -1);
const redoImportSource = runtimeSource.slice(redoImportStart, redoImportEnd);
assert.match(
  redoImportSource,
  /prepareActiveLayerForSwitch\(\);[\s\S]{0,3000}if \(attached\)[\s\S]{0,1500}else \{[\s\S]{0,500}engine\.layerStack\.setActiveIndex\(originalIndex\);[\s\S]{0,120}await engine\.activateLayer\(previousIndex, "structural-history"\);/,
  "Redo pre-attach rollback must always rehydrate the prepared original layer",
);
assert.doesNotMatch(
  redoImportSource,
  /else \{[\s\S]{0,300}if \(engine\.layerStack\.active\.id !== originalActiveId\)/,
  "Redo must not skip original activation merely because its selected id did not change",
);
assert.match(runtimeSource, /runGpuAllocationTransaction\(/);
assert.match(runtimeSource, /preflight: \(inspection\)/);
assert.match(runtimeSource, /RASTER_IMAGE_MAXIMUM_TOTAL_GPU_BYTES/);
assert.match(runtimeSource, /nativeRasterImportResidentBytes\(engine\)/);
assert.doesNotMatch(runtimeSource, /RASTER_IMAGE_MAXIMUM_IMPORT_PEAK_BYTES/);
assert.doesNotMatch(runtimeSource, /picco aggregato previsto|engine\.getStats\(\)\.gpuMemory\.countedTotalMiB/);
assert.match(
  runtimeSource,
  /const scale = Math\.min\(1, DOCUMENT_WIDTH \/ width, DOCUMENT_HEIGHT \/ height\)/,
);
assert.match(
  runtimeSource,
  /const outputWidth = Math\.max\(1, Math\.min\(DOCUMENT_WIDTH, Math\.round\(width \* scale\)\)\)/,
);
assert.match(
  runtimeSource,
  /const outputHeight = Math\.max\(1, Math\.min\(DOCUMENT_HEIGHT, Math\.round\(height \* scale\)\)\)/,
);
assert.match(runtimeSource, /x: Math\.floor\(\(DOCUMENT_WIDTH - outputWidth\) \* 0\.5\)/);
assert.match(runtimeSource, /y: Math\.floor\(\(DOCUMENT_HEIGHT - outputHeight\) \* 0\.5\)/);
assert.match(
  runtimeSource,
  /DOCUMENT_WIDTH \* DOCUMENT_HEIGHT \* bytesPerPixel[\s\S]{0,180}LAYER_STORAGE_TILE_WIDTH[\s\S]{0,80}LAYER_STORAGE_TILE_HEIGHT/,
  "Il budget import deve usare area documento e area tile rettangolari.",
);
assert.doesNotMatch(
  runtimeSource,
  /engine\.layerSize|\bLAYER_SIZE\b|LAYER_STORAGE_TILE_SIZE \*\* 2/,
  "L'import raster non deve ridurre il documento a un lato quadrato.",
);
assert.match(
  runtimeSource,
  /assertNativeRasterImportResidentBudget\(engine, bounds, (?:sourceMipBytes|decodedMipBytes) \+ 32\)/,
);
assert.match(
  runtimeSource,
  /transient = await encodeBitmapIntoLayer[\s\S]{0,600}releaseDecodedRasterImage\(decoded\);\s*decoded = null;[\s\S]{0,400}seed = await createLayerColdStorageCandidate/,
  "la bitmap decodificata deve essere rilasciata prima del seed Undo/Redo",
);
assert.match(runtimeSource, /export function rasterImageGpuMemoryBytes/);
assert.match(runtimeSource, /rasterImageImportsInFlight/);
assert.match(runtimeSource, /if \(decoded\) releaseDecodedRasterImage\(decoded\)/);
assert.match(engineSource, /sweepRasterImageGpuResources\(\): number/);
assert.doesNotMatch(runtimeSource, /CanvasRenderingContext2D|getContext\("2d"\)|drawImage\(/);
assert.doesNotMatch(runtimeSource, /addImageAboveSelection\(/);
assert.match(shaderSource, /textureSampleLevel\(/);
for (const [label, samplingShader] of [
  ["preview", rasterImageLayerBlitShader],
  ["rebuild", rasterImageLayerRebuildShader],
]) {
  assert.match(samplingShader, /let continuousLod = sourceLod/);
  assert.doesNotMatch(samplingShader, /let lod = floor\(continuousLod\)/);
  assert.match(
    samplingShader,
    /textureSampleLevel\([\s\S]{0,160}continuousLod[\s\S]{0,80}return decodedSource\(sampled\)/,
    `${label} must sample the same fractional mip footprint`,
  );
  assert.match(samplingShader, /return vec4<f32>\(straightLinear \* alpha, alpha\)/);
  assert.doesNotMatch(
    samplingShader,
    /preserveDarkCoverage|encodedCoverage|displayAlpha/,
    `${label} must preserve sampled premultiplied alpha`,
  );
}
assert.match(shaderSource, /fragmentPremultiplyMain/);
assert.match(shaderSource, /linearToSrgb\(straightLinear\.rgb\) \* straightLinear\.a/);
assert.match(shaderSource, /alpha <= 0\.000001/);
assert.match(shaderSource, /texelOverlap/);
assert.match(shaderSource, /for \(var y = 0; y < 3/);
assert.match(engineSource, /kind: "raster-import"/);
assert.match(runtimeSource, /record\.rasterSource = initialRasterLayerSource\(document, bounds\)/);
assert.match(runtimeSource, /createRasterImageGpuResource\(/);
assert.match(runtimeSource, /rebuildRasterLayerFromImmutableSource/);
assert.match(runtimeSource, /rasterImageMipLevelCount\(width, height\)/);
assert.match(
  runtimeSource,
  /mipmapFilter: "linear"/,
  "fractional image-source LOD requires interpolation between mip levels",
);
assert.doesNotMatch(
  displayShaderSource,
  /preserveMinifiedDarkCoverage|preserveMergedDarkCoverage|preserveStyledDarkCoverage/,
  "generic layer presentation must not expand alpha after sampling",
);
assert.match(engineSource, /commitRasterImportHistory\(history/);
assert.match(runtimeSource, /commitHistory\(historySeed\);[\s\S]{0,100}seed = null/);
assert.match(engineSource, /publishActiveLayerChange\(\): void \{[\s\S]{0,240}catch \(error\)/);
assert.doesNotMatch(runtimeSource, /callbacks\.onActiveLayerChange/);
const publicResultStart = runtimeSource.indexOf("export interface NativeRasterImageImportResult");
const publicResultEnd = runtimeSource.indexOf("export type RasterImageImportResult", publicResultStart);
assert.notEqual(publicResultStart, -1);
assert.notEqual(publicResultEnd, -1);
assert.doesNotMatch(
  runtimeSource.slice(publicResultStart, publicResultEnd),
  /history|GPUTexture|LayerRecord|LayerColdStorageResources/,
  "the public import DTO must not expose authoritative history/GPU ownership",
);
assert.match(engineSource, /beginRasterLayerTransform\(mode\?: RasterTransformMode\)/);

assert.match(engineSource, /beginVectorHistoryEdit\(scope: "property" \| "transform"/);
assert.match(engineSource, /async cancelVectorHistoryEdit\(\): Promise<boolean>/);
assert.match(
  engineSource,
  /await applyVectorHistoryState\(this, edit\.before\);[\s\S]{0,300}this\.activeVectorHistoryEdit = null/,
  "Cancel must keep the global edit gate until async rollback succeeds",
);
assert.match(controllerSource, /beginVectorHistoryEdit\("transform"\)/);
assert.match(controllerSource, /beginRasterLayerTransform\(requestedMode\)/);
assert.match(controllerSource, /commitRasterLayerTransform\(\)/);
assert.match(controllerSource, /cancelRasterLayerTransform\(\)/);
assert.match(controllerSource, /private async applyTransformSession/);
assert.match(controllerSource, /private async cancelTransformSession/);
assert.match(controllerSource, /private abortActiveTransformInteraction/);
assert.match(controllerSource, /event\.key === "Escape"/);
assert.match(controllerSource, /event\.key === "Enter"/);
assert.match(
  controllerSource,
  /setSelectedSvgPaintColor\(index: number, color: string\): void \{[\s\S]{0,160}this\.sceneOperationBusy \|\| this\.transformSessionOpen/,
  "la porta SVG deve bloccare direttamente le modifiche durante operazioni o trasformazioni",
);
assert.match(controllerSource, /private enterTouchNavigation\(\)/);
assert.match(controllerSource, /this\.host\.rotateViewBy\(/);
assert.match(controllerSource, /kind: "raster-layer"/);
assert.match(controllerSource, /imported directly as a raster/);
assert.match(
  controllerSource,
  /const imported = await this\.host\.importRasterImageFile\(file\);[\s\S]{0,500}await this\.host\.waitForIdle\(\);[\s\S]{0,500}imported directly as a raster/,
  "l'import deve restare bloccato finche upload, mip e prima presentazione sono conclusi",
);
assert.match(htmlSource, /data-mobile-canvas-tool="transform"/);
assert.match(htmlSource, /id="mobileTransformApply"/);
assert.match(htmlSource, /id="mobileTransformCancel"/);
assert.doesNotMatch(htmlSource, /id="transformApply"|id="transformCancel"/);
assert.match(htmlSource, /accept="\.png,\.jpg,\.jpeg,\.webp,\.avif/);

const srgbToLinearChannel = (value) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgbChannel = (value) => value <= 0.0031308
  ? value * 12.92
  : 1.055 * value ** (1 / 2.4) - 0.055;
const blackCoverageInLinearCache = (alpha) =>
  1 - srgbToLinearChannel(1 - alpha);

assert.equal(blackCoverageInLinearCache(0), 0, "fully transparent stays transparent");
assert.equal(blackCoverageInLinearCache(1), 1, "fully opaque stays fully opaque");
const halfBlackCoverage = blackCoverageInLinearCache(0.5);
assert.ok(Math.abs(halfBlackCoverage - 0.7859588595) < 1e-9);
assert.ok(
  Math.abs(linearToSrgbChannel(1 - halfBlackCoverage) - 0.5) < 1e-9,
  "50/50 black-transparent reduced in sRGB must display as 127, not linear-light 188",
);
assert.ok(
  Math.abs(linearToSrgbChannel(0.5) - 0.7353569831) < 1e-9,
  "the numerical oracle must distinguish an accidental linear-light box filter",
);

console.log("Native raster image import and shared Transform transaction verified.");
