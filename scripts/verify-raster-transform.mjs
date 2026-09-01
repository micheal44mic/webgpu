import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SerialAsyncQueue } from "../src/serial-async-queue.ts";
import {
  RASTER_TRANSFORM_DOCUMENT_HEIGHT,
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  RASTER_TRANSFORM_DOCUMENT_WIDTH,
  RASTER_TRANSFORM_MATH_STRATEGY,
  RASTER_TRANSFORM_TILE_GRID_SIZE,
  RASTER_TRANSFORM_TILE_HEIGHT,
  RASTER_TRANSFORM_TILE_SIZE,
  RASTER_TRANSFORM_TILE_WIDTH,
  RASTER_TRANSFORM_UNIFORM_BYTES,
  clipRasterTransformRect,
  normalizeRasterTransform,
  packRasterTransformUniforms,
  rasterInverseTransformPoint,
  rasterTransformBounds,
  rasterTransformDirtyRect,
  rasterTransformInverseRows,
  rasterTransformPoint,
  rasterTransformSamplingBounds,
  rasterTransformSamplingPadding,
  rasterTransformScratchRect,
  rasterTransformTileIndices,
  rasterTransformTileMask,
  tileMaskCoveringRect,
} from "../src/raster-transform-math.ts";
import {
  RASTER_SELECTION_TRANSLATE_SHADER_STRATEGY,
  RASTER_TRANSFORM_SHADER_STRATEGY,
  rasterSelectionTranslateShader,
  rasterTransformMipmapShader,
  rasterTransformShader,
} from "../src/raster-transform-shader.ts";
import {
  RASTER_LAYER_SOURCE_STRATEGY,
  cloneRasterLayerSource,
  composeRasterLayerSourceTransform,
  rasterLayerSourceBounds,
  rasterLayerSourcesEqual,
} from "../src/raster-layer-source.ts";

assert.equal(
  RASTER_TRANSFORM_MATH_STRATEGY,
  "document-space-axis-scale-affine-sampling-per-source-tile-mask-v3",
);
assert.equal(
  RASTER_TRANSFORM_SHADER_STRATEGY,
  "gamma-box-mips-transparent-border-inverse-affine-continuous-lod-v5",
);
assert.equal(
  RASTER_SELECTION_TRANSLATE_SHADER_STRATEGY,
  "integer-cut-selection-mask-immutable-source-over-destination-v1",
);
assert.equal(
  RASTER_LAYER_SOURCE_STRATEGY,
  "immutable-encoded-master-cumulative-document-matrix-derived-raster-cache-v1",
);
assert.equal(
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  Math.max(RASTER_TRANSFORM_DOCUMENT_WIDTH, RASTER_TRANSFORM_DOCUMENT_HEIGHT),
);
assert.equal(
  RASTER_TRANSFORM_TILE_SIZE,
  Math.max(RASTER_TRANSFORM_TILE_WIDTH, RASTER_TRANSFORM_TILE_HEIGHT),
);
assert.equal(
  Math.ceil(RASTER_TRANSFORM_DOCUMENT_WIDTH / RASTER_TRANSFORM_TILE_WIDTH),
  RASTER_TRANSFORM_TILE_GRID_SIZE,
);
assert.equal(
  Math.ceil(RASTER_TRANSFORM_DOCUMENT_HEIGHT / RASTER_TRANSFORM_TILE_HEIGHT),
  RASTER_TRANSFORM_TILE_GRID_SIZE,
);

const identity = { translationX: 0, translationY: 0, scale: 1, rotation: 0 };
const pivot = { x: 100, y: 80 };
assert.deepEqual(normalizeRasterTransform(identity), {
  ...identity,
  scaleX: 1,
  scaleY: 1,
});
assert.deepEqual(
  normalizeRasterTransform({
    translationX: 0,
    translationY: 0,
    scaleX: 2,
    scaleY: 0.5,
    rotation: 0,
  }),
  {
    translationX: 0,
    translationY: 0,
    scale: 2,
    scaleX: 2,
    scaleY: 0.5,
    rotation: 0,
  },
  "axis-only callers must not need the legacy uniform field",
);
const immutableSource = {
  document: {
    assetId: "raster-layer-source-7",
    sourceName: "mockup.png",
    mimeType: "image/png",
    sourceBytes: 4096,
    width: 100,
    height: 40,
  },
  x: 159.382,
  y: 375.209,
  scale: 1,
  rotation: 0,
};
const clonedSource = cloneRasterLayerSource(immutableSource);
assert.ok(clonedSource);
assert.notEqual(clonedSource, immutableSource);
assert.notEqual(clonedSource.document, immutableSource.document);
assert.ok(rasterLayerSourcesEqual(clonedSource, immutableSource));
const nudgedSource = composeRasterLayerSourceTransform(immutableSource, {
  translationX: 1,
  translationY: 0,
  scale: 1,
  rotation: 0,
});
assert.equal(nudgedSource.x, 160.382, "ArrowRight must add exactly one document unit");
assert.equal(nudgedSource.y, immutableSource.y);
assert.equal(immutableSource.x, 159.382, "the immutable source state must not be rewritten");
assert.ok(!rasterLayerSourcesEqual(nudgedSource, immutableSource));
assert.deepEqual(
  rasterLayerSourceBounds({ ...immutableSource, x: 50, y: 20 }),
  { x: 0, y: 0, width: 100, height: 40 },
);
const cumulativeSource = composeRasterLayerSourceTransform(nudgedSource, {
  translationX: -0.5,
  translationY: 2,
  scale: 2,
  rotation: Math.PI / 2,
});
assert.equal(cumulativeSource.x, 159.882);
assert.equal(cumulativeSource.y, 377.209);
assert.equal(cumulativeSource.scale, 2);
assert.ok(Math.abs(cumulativeSource.rotation - Math.PI / 2) < 1e-12);
assert.deepEqual(rasterTransformPoint({ x: 120, y: 70 }, pivot, identity), {
  x: 120,
  y: 70,
});
assert.deepEqual(
  rasterTransformPoint(
    { x: 120, y: 80 },
    pivot,
    { translationX: 5, translationY: -7, scale: 2, rotation: Math.PI / 2 },
  ),
  { x: 105, y: 113 },
);
assert.deepEqual(
  rasterTransformPoint(
    { x: 120, y: 90 },
    pivot,
    { translationX: 0, translationY: 0, scaleX: 2, scaleY: 0.5, rotation: 0 },
  ),
  { x: 140, y: 85 },
);

const affine = {
  translationX: 23.25,
  translationY: -19.5,
  scale: 0.375,
  rotation: 0.713,
};
const sourcePoint = { x: 271.25, y: 122.75 };
const transformedPoint = rasterTransformPoint(sourcePoint, pivot, affine);
const roundTrip = rasterInverseTransformPoint(transformedPoint, pivot, affine);
assert.ok(Math.abs(roundTrip.x - sourcePoint.x) < 1e-9);
assert.ok(Math.abs(roundTrip.y - sourcePoint.y) < 1e-9);
const inverseRows = rasterTransformInverseRows(affine);
assert.equal(inverseRows.row0.length, 2);
assert.equal(inverseRows.row1.length, 2);

const anisotropicAffine = {
  translationX: -13.5,
  translationY: 7.25,
  scaleX: 2.5,
  scaleY: 0.4,
  rotation: -0.37,
};
const anisotropicDestination = rasterTransformPoint(sourcePoint, pivot, anisotropicAffine);
const anisotropicRoundTrip = rasterInverseTransformPoint(
  anisotropicDestination,
  pivot,
  anisotropicAffine,
);
assert.ok(Math.abs(anisotropicRoundTrip.x - sourcePoint.x) < 1e-9);
assert.ok(Math.abs(anisotropicRoundTrip.y - sourcePoint.y) < 1e-9);

assert.deepEqual(
  rasterTransformBounds(
    { x: 10, y: 20, width: 30, height: 40 },
    { x: 25, y: 40 },
    identity,
    { padding: 0 },
  ),
  { x: 10, y: 20, width: 30, height: 40 },
);
assert.deepEqual(
  rasterTransformBounds(
    { x: 10, y: 20, width: 30, height: 40 },
    { x: 25, y: 40 },
    { ...identity, rotation: Math.PI / 2 },
    { padding: 0 },
  ),
  { x: 5, y: 25, width: 40, height: 30 },
);
assert.deepEqual(
  rasterTransformBounds(
    { x: 80, y: 80, width: 20, height: 40 },
    { x: 90, y: 100 },
    { ...identity, scaleX: 2, scaleY: 0.5 },
    { padding: 0 },
  ),
  { x: 70, y: 90, width: 40, height: 20 },
);
assert.deepEqual(
  rasterTransformBounds(
    { x: 80, y: 80, width: 20, height: 40 },
    { x: 90, y: 100 },
    { ...identity, scaleX: 2, scaleY: 0.5, rotation: Math.PI / 2 },
    { padding: 0 },
  ),
  { x: 80, y: 80, width: 20, height: 40 },
);
assert.deepEqual(
  rasterTransformBounds(
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 10, y: 10 },
    { ...identity, translationX: -15, translationY: -12 },
    { padding: 0 },
  ),
  { x: 0, y: 0, width: 5, height: 8 },
);
assert.equal(
  rasterTransformBounds(
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 10, y: 10 },
    { ...identity, translationX: -100, translationY: -100 },
    { padding: 0 },
  ),
  null,
);
assert.deepEqual(
  rasterTransformDirtyRect(
    { x: 5, y: 7, width: 10, height: 12 },
    { x: 13, y: 3, width: 11, height: 9 },
  ),
  { x: 3, y: 1, width: 23, height: 20 },
);
assert.deepEqual(
  rasterTransformDirtyRect(
    { x: 5, y: 7, width: 10, height: 12 },
    { x: 13, y: 3, width: 11, height: 9 },
    RASTER_TRANSFORM_DOCUMENT_WIDTH,
    0,
    RASTER_TRANSFORM_DOCUMENT_HEIGHT,
  ),
  { x: 5, y: 3, width: 19, height: 16 },
);
assert.equal(rasterTransformSamplingPadding(identity), 0);
assert.equal(rasterTransformSamplingPadding({ ...identity, translationX: 17 }), 0);
assert.equal(rasterTransformSamplingPadding({ ...identity, translationX: 0.5 }), 2);
assert.deepEqual(
  rasterTransformSamplingBounds(
    { x: 500, y: 500, width: 10, height: 10 },
    { x: 505, y: 505 },
    { ...identity, translationX: 17, translationY: -9 },
  ),
  { x: 517, y: 491, width: 10, height: 10 },
  "integer translation must not accumulate conservative filter padding",
);
assert.equal(
  rasterTransformSamplingPadding({ ...identity, scale: 20 }),
  11,
  "magnification must scale the half-texel destination support",
);
assert.equal(
  rasterTransformSamplingPadding({ ...identity, scale: 20, rotation: Math.PI / 4 }),
  16,
  "rotated bilinear support must use its destination AABB",
);
assert.equal(rasterTransformSamplingPadding({ ...identity, scale: 0.05 }), 2);
assert.equal(
  rasterTransformSamplingPadding({ ...identity, scaleX: 20, scaleY: 2 }),
  11,
  "axis-aligned anisotropic padding must use the largest projected radius",
);
assert.equal(
  rasterTransformSamplingPadding({
    ...identity,
    scaleX: 20,
    scaleY: 2,
    rotation: Math.PI / 4,
  }),
  9,
  "rotation must project both independent axis radii",
);
assert.deepEqual(
  rasterTransformSamplingBounds(
    { x: 500, y: 500, width: 10, height: 10 },
    { x: 505, y: 505 },
    { ...identity, scale: 20 },
    RASTER_TRANSFORM_DOCUMENT_WIDTH,
    RASTER_TRANSFORM_DOCUMENT_HEIGHT,
  ),
  { x: 394, y: 394, width: 222, height: 222 },
);
assert.deepEqual(
  clipRasterTransformRect({ x: -2.4, y: 4094.2, width: 9, height: 8 }),
  { x: 0, y: 4094, width: 7, height: 2 },
);

const gridWidth = Math.ceil(RASTER_TRANSFORM_DOCUMENT_WIDTH / RASTER_TRANSFORM_TILE_WIDTH);
const gridHeight = Math.ceil(RASTER_TRANSFORM_DOCUMENT_HEIGHT / RASTER_TRANSFORM_TILE_HEIGHT);
const tileMask = (...indices) => {
  const mask = new Uint32Array(Math.ceil(gridWidth * gridHeight / 32));
  for (const index of indices) {
    mask[index >>> 5] = (mask[index >>> 5] | (1 << (index & 31))) >>> 0;
  }
  return mask;
};
const tileIndex = (x, y) => y * gridWidth + x;

const sparseSource = tileMask(tileIndex(0, 0), tileIndex(2, 2));
assert.deepEqual(rasterTransformTileIndices(sparseSource), [
  tileIndex(0, 0),
  tileIndex(2, 2),
]);
assert.deepEqual(rasterTransformScratchRect(sparseSource), {
  x: 0,
  y: 0,
  width: RASTER_TRANSFORM_TILE_WIDTH * 3,
  height: RASTER_TRANSFORM_TILE_HEIGHT * 3,
});
const sparseIdentity = rasterTransformTileMask(
  sparseSource,
  {
    x: 0,
    y: 0,
    width: RASTER_TRANSFORM_TILE_WIDTH * 3,
    height: RASTER_TRANSFORM_TILE_HEIGHT * 3,
  },
  { x: 0, y: 0 },
  identity,
  {
    documentWidth: RASTER_TRANSFORM_DOCUMENT_WIDTH,
    documentHeight: RASTER_TRANSFORM_DOCUMENT_HEIGHT,
    tileWidth: RASTER_TRANSFORM_TILE_WIDTH,
    tileHeight: RASTER_TRANSFORM_TILE_HEIGHT,
    padding: 0,
  },
);
assert.deepEqual(
  rasterTransformTileIndices(sparseIdentity),
  [tileIndex(0, 0), tileIndex(2, 2)],
  "sparse tiles must be transformed independently rather than through one union AABB",
);

const translatedTile = rasterTransformTileMask(
  tileMask(tileIndex(1, 1)),
  { x: 256, y: 256, width: 256, height: 256 },
  { x: 384, y: 384 },
  { ...identity, translationX: 256 },
  { padding: 0 },
);
assert.deepEqual(rasterTransformTileIndices(translatedTile), [tileIndex(2, 1)]);

const clippedTile = rasterTransformTileMask(
  tileMask(tileIndex(0, 0)),
  { x: 0, y: 0, width: 256, height: 256 },
  { x: 128, y: 128 },
  { ...identity, translationX: -192 },
  { padding: 0 },
);
assert.deepEqual(rasterTransformTileIndices(clippedTile), [tileIndex(0, 0)]);
assert.throws(
  () => rasterTransformTileIndices(new Uint32Array(1)),
  /Invalid tile mask/,
);

// Fixture rettangolare: il tile 255 deve rappresentare il vero angolo in basso
// a destra con bordi X/Y ritagliati indipendentemente.
{
  const documentWidth = 1080;
  const documentHeight = 1920;
  const tileWidth = Math.ceil(documentWidth / RASTER_TRANSFORM_TILE_GRID_SIZE);
  const tileHeight = Math.ceil(documentHeight / RASTER_TRANSFORM_TILE_GRID_SIZE);
  const mask = new Uint32Array(RASTER_TRANSFORM_TILE_GRID_SIZE ** 2 / 32);
  mask[7] = 0x80000000;
  assert.deepEqual(
    rasterTransformTileIndices(mask, documentWidth, tileWidth, documentHeight, tileHeight),
    [255],
  );
  assert.deepEqual(
    rasterTransformScratchRect(mask, documentWidth, tileWidth, documentHeight, tileHeight),
    { x: 1020, y: 1800, width: 60, height: 120 },
  );
  const covered = tileMaskCoveringRect(
    new Uint32Array(mask.length),
    { x: documentWidth - 1, y: documentHeight - 1, width: 1, height: 1 },
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(covered[7] >>> 0, 0x80000000);
}

const uniforms = packRasterTransformUniforms({
  sourceScratchRect: { x: 256, y: 512, width: 768, height: 512 },
  sourceContentBounds: { x: 300, y: 540, width: 600, height: 400 },
  sourcePivot: { x: 600, y: 740 },
  transform: { translationX: 10, translationY: -20, scale: 2, rotation: 0 },
});
assert.equal(uniforms.byteLength, RASTER_TRANSFORM_UNIFORM_BYTES);
assert.deepEqual([...uniforms.slice(0, 12)], [
  256, 512, 768, 512,
  300, 540, 900, 940,
  600, 740, 610, 720,
]);
assert.deepEqual([...uniforms.slice(12, 16)], [0.5, 0, 0, 0.5]);
assert.deepEqual(
  [...uniforms.slice(16)],
  [RASTER_TRANSFORM_DOCUMENT_WIDTH, RASTER_TRANSFORM_DOCUMENT_HEIGHT, 0, 0],
);
const anisotropicUniforms = packRasterTransformUniforms({
  sourceScratchRect: { x: 256, y: 512, width: 768, height: 512 },
  sourceContentBounds: { x: 300, y: 540, width: 600, height: 400 },
  sourcePivot: { x: 600, y: 740 },
  transform: {
    translationX: 10,
    translationY: -20,
    scaleX: 2,
    scaleY: 0.5,
    rotation: 0,
  },
});
assert.deepEqual(
  [...anisotropicUniforms.slice(12, 16)],
  [0.5, 0, 0, 2],
  "the original 64-byte ABI prefix must carry the anisotropic inverse matrix rows",
);
const rectangularDocumentUniforms = packRasterTransformUniforms({
  sourceScratchRect: { x: 0, y: 0, width: 100, height: 100 },
  sourceContentBounds: { x: 0, y: 0, width: 100, height: 100 },
  sourcePivot: { x: 50, y: 50 },
  transform: identity,
  documentWidth: 1080,
  documentHeight: 1920,
});
assert.deepEqual([...rectangularDocumentUniforms.slice(16)], [1080, 1920, 0, 0]);
assert.throws(
  () => packRasterTransformUniforms({
    sourceScratchRect: { x: 256, y: 512, width: 256, height: 256 },
    sourceContentBounds: { x: 0, y: 0, width: 100, height: 100 },
    sourcePivot: { x: 50, y: 50 },
    transform: identity,
  }),
  /contained within the scratch area/,
);

assert.match(rasterTransformShader, /textureSampleLevel\s*\(/);
assert.doesNotMatch(rasterTransformShader, /\btextureSample\s*\(/);
assert.doesNotMatch(rasterTransformShader, /textureSampleGrad\s*\(/);
assert.doesNotMatch(rasterTransformShader, /\b(?:dpdx|dpdy|fwidth)\s*\(/);
assert.match(rasterTransformShader, /transparentBorderWeight/);
assert.match(rasterTransformShader, /textureNumLevels/);
assert.doesNotMatch(rasterTransformShader, /if \(!insideContent/);
assert.doesNotMatch(rasterTransformShader, /insideScratch/);
assert.match(rasterTransformShader, /let continuousLod = clamp\(/);
assert.match(rasterTransformShader, /let lowerLevel = u32\(floor\(continuousLod\)\)/);
assert.match(rasterTransformShader, /let upperLevel = min\(lowerLevel \+ 1u, maximumLevel\)/);
assert.match(rasterTransformShader, /sampleTransparentLevel\(sourceUv, lowerLevel\)/);
assert.match(rasterTransformShader, /sampleTransparentLevel\(sourceUv, upperLevel\)/);
assert.match(rasterTransformShader, /let lodBlend = fract\(continuousLod\)/);
assert.match(rasterTransformShader, /return mix\(lower, upper, lodBlend\)/);
assert.doesNotMatch(
  rasterTransformShader,
  /preserveDarkCoverage|encodedCoverage|displayAlpha/,
);
assert.doesNotMatch(rasterTransformShader, /rgba8unorm|rgba16float/);

const mipThresholdLevels = [0.42, 0.2, 0.09];
const continuousAlphaAtScale = (scale) => {
  const lod = Math.min(
    mipThresholdLevels.length - 1,
    Math.max(0, Math.log2(1 / scale)),
  );
  const lowerLevel = Math.floor(lod);
  const upperLevel = Math.min(lowerLevel + 1, mipThresholdLevels.length - 1);
  const blend = lod - lowerLevel;
  return mipThresholdLevels[lowerLevel]
    + (mipThresholdLevels[upperLevel] - mipThresholdLevels[lowerLevel]) * blend;
};
assert.ok(
  Math.abs(continuousAlphaAtScale(0.5001) - continuousAlphaAtScale(0.5)) < 0.001,
  "crossing the first mip threshold must not cause a discrete alpha jump",
);

assert.match(rasterTransformMipmapShader, /textureLoad\s*\(/);
assert.match(rasterTransformMipmapShader, /accumulatedWeight/);
assert.match(rasterTransformMipmapShader, /for \(var [xy] = 0; [xy] < 3/);
assert.match(rasterTransformMipmapShader, /linearPremultipliedToGamma/);
assert.match(rasterTransformMipmapShader, /gammaPremultipliedToLinear/);
assert.doesNotMatch(rasterTransformMipmapShader, /textureSample/);
assert.doesNotMatch(rasterTransformMipmapShader, /rgba8unorm|rgba16float/);

assert.match(rasterSelectionTranslateShader, /var<storage, read> selectionMask/);
assert.match(rasterSelectionTranslateShader, /textureLoad\(sourceTexture, local, 0\)/);
assert.match(rasterSelectionTranslateShader, /round\(transform\.destinationPivot - transform\.sourcePivot\)/);
assert.match(rasterSelectionTranslateShader, /if \(selectedAt\(destination\)\) \{ base = vec4<f32>\(0\.0\); \}/);
assert.match(rasterSelectionTranslateShader, /if \(selectedAt\(source\)\) \{ moved = loadOriginal\(source\); \}/);
assert.match(rasterSelectionTranslateShader, /return moved \+ base \* \(1\.0 - moved\.a\)/);
assert.doesNotMatch(rasterSelectionTranslateShader, /textureSample/);

const mathSource = readFileSync(
  new URL("../src/raster-transform-math.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../src/engine-raster-transform-runtime.ts", import.meta.url),
  "utf8",
);
const programSource = readFileSync(
  new URL("../src/raster-transform-programs.ts", import.meta.url),
  "utf8",
);
const controllerSource = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);
const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(mathSource, /GPU(?:Device|Texture|Buffer|Queue)/);
assert.doesNotMatch(mathSource, /CanvasRenderingContext|ImageBitmap/);
assert.match(mathSource, /DOCUMENT_WIDTH as RASTER_TRANSFORM_DOCUMENT_WIDTH/);
assert.match(mathSource, /DOCUMENT_HEIGHT as RASTER_TRANSFORM_DOCUMENT_HEIGHT/);
assert.match(mathSource, /DOCUMENT_TILE_WIDTH as RASTER_TRANSFORM_TILE_WIDTH/);
assert.match(mathSource, /DOCUMENT_TILE_HEIGHT as RASTER_TRANSFORM_TILE_HEIGHT/);
assert.match(runtimeSource, /RASTER_TRANSFORM_TRANSPARENT_GUARD_PX = 2/);
assert.doesNotMatch(
  runtimeSource,
  /engine\.layerSize|\bLAYER_SIZE\b|\bRASTER_TRANSFORM_DOCUMENT_SIZE\b|\bRASTER_TRANSFORM_TILE_SIZE\b|documentSize:|tileSize:/,
  "Il runtime Trasforma non deve ripiegare sui vecchi lati quadrati.",
);
assert.match(
  runtimeSource,
  /engine\.assertLayerSwitchAllowed\(\);\s*engine\.persistActiveLayerState\(\);\s*if \(!record\.hasContent \|\| !record\.contentBounds\)/,
  "l'apertura GPU deve sincronizzare il raster attivo appena dipinto prima del controllo contenuto",
);
assert.match(runtimeSource, /origin: \{[\s\S]{0,120}RASTER_TRANSFORM_TRANSPARENT_GUARD_PX/);
assert.match(runtimeSource, /padding: 0/);
assert.match(runtimeSource, /rasterTransformSamplingPadding\(transform\)/);
assert.match(runtimeSource, /scaleX: session\.transform\.scaleX/);
assert.match(runtimeSource, /scaleY: session\.transform\.scaleY/);
assert.match(
  runtimeSource,
  /scaleX: update\.scaleX \?\? update\.scale \?\? session\.transform\.scaleX/,
  "the legacy scale update must remain a uniform fallback",
);
assert.match(
  runtimeSource,
  /scaleY: update\.scaleY \?\? update\.scale \?\? session\.transform\.scaleY/,
);
assert.match(runtimeSource, /const a = cosine \* session\.transform\.scaleX/);
assert.match(runtimeSource, /const d = cosine \* session\.transform\.scaleY/);
assert.match(runtimeSource, /Math\.abs\(session\.transform\.scaleX - 1\)/);
assert.match(runtimeSource, /Math\.abs\(session\.transform\.scaleY - 1\)/);
assert.match(
  runtimeSource,
  /Math\.abs\(session\.transform\.scaleX - session\.transform\.scaleY\) < 1e-7/,
  "an imported source may retain its uniform source model only when both axes match",
);
assert.match(runtimeSource, /independent axis scale cannot be represented/);
assert.match(runtimeSource, /presentedSamplingBounds/);
assert.match(runtimeSource, /samplingBounds/);
assert.match(runtimeSource, /sourceRasterBounds/);
assert.match(
  runtimeSource,
  /presentedSamplingBounds: selectionScope[\s\S]{0,120}\{ \.\.\.sourceBounds \}[\s\S]{0,120}\{ \.\.\.sourceRasterBounds \}/,
);
assert.doesNotMatch(runtimeSource, /presentedSamplingBounds: \{ \.\.\.sourceBounds \}/);
assert.match(runtimeSource, /geometryBounds: copyRect\(session\.resultBounds\)/);
assert.match(
  runtimeSource,
  /setAuthoritativeMetadata\(engine, session\.samplingBounds, session\.resultTileMask\)/,
);
assert.match(runtimeSource, /baseBounds: \{ \.\.\.session\.samplingBounds \}/);
assert.doesNotMatch(runtimeSource, /baseBounds: \{ \.\.\.session\.resultBounds \}/);
assert.match(runtimeSource, /session\.terminal = true/);
assert.match(runtimeSource, /if \(session\.terminal\)/);
assert.match(runtimeSource, /retainSessionForRecovery = true/);
assert.doesNotMatch(runtimeSource, /callbacks\.onStatus/);
assert.match(programSource, /programCompilationQueue\(shared\.device\)\.run/);
const programBundleSource = programSource.slice(
  programSource.indexOf("async function createProgramBundle("),
  programSource.indexOf("export async function ensureRasterTransformProgramBundle("),
);
assert.doesNotMatch(
  programBundleSource,
  /runGpuAllocationTransaction|pushErrorScope|popErrorScope/,
  "long-running transform compilation must not hold device-global error scopes",
);
assert.match(programSource, /const \[deformPipeline, clearPipeline\] = await Promise\.all/);
assert.doesNotMatch(
  runtimeSource,
  /\.createRenderPipeline\(/,
  "cold Transform mode changes must never compile a pipeline synchronously",
);
assert.match(
  runtimeSource,
  /await ensureRasterTransformProgramBundle\([\s\S]{0,160}requestedMode === "affine" \? "affine" : "deform"[\s\S]{0,160}updateRasterLayerTransform/,
  "an open Transform session must await its cold mode bundle before publication",
);
assert.match(
  controllerSource,
  /await this\.host\.prewarmRasterTransformPrograms\(mode\)[\s\S]{0,500}this\.host\.updateRasterLayerTransform\(\{ mode \}\)/,
  "the UI mode switch must await asynchronous preparation before changing the session",
);
assert.match(
  controllerSource,
  /const requestedMode = this\.rasterTransformToolMode;[\s\S]{0,160}const generation = this\.rasterTransformModeSwitchGeneration;[\s\S]{0,420}runRasterTransformPreparation\(requestedMode, generation\)/,
  "initial raster preparation must capture both requested mode and generation",
);
assert.match(
  controllerSource,
  /generation !== this\.rasterTransformModeSwitchGeneration[\s\S]{0,120}this\.rasterTransformToolMode !== requestedMode[\s\S]{0,320}cancelRasterLayerTransform/,
  "a stale initial mode must roll back instead of publishing",
);
assert.match(
  controllerSource,
  /node\.mode === mode[\s\S]{0,240}this\.rasterTransformPreparation !== null[\s\S]{0,100}this\.rasterTransformRecoveryOnly[\s\S]{0,280}this\.rasterTransformPreparation = null[\s\S]{0,100}this\.rasterTransformRecoveryOnly = false/,
  "returning to the published mode must detach an obsolete cold request and leave recovery",
);
assert.match(
  controllerSource,
  /updateRasterLayerTransform\(\{ mode \}\);[\s\S]{0,100}this\.rasterTransformRecoveryOnly = false/,
  "a successful cold-mode retry must restore normal interaction",
);
assert.match(
  controllerSource,
  /const preparing = this\.rasterTransformPreparation !== null[\s\S]{0,600}canApply: active[\s\S]{0,120}!preparing[\s\S]{0,360}canCancel: active[\s\S]{0,120}!preparing/,
  "Apply and Cancel controls must remain disabled during mode preparation",
);
assert.match(
  controllerSource,
  /if \(event\.key === "Escape"\)[\s\S]{0,180}this\.cancelTransform\(\)[\s\S]{0,180}this\.applyTransform\(\)/,
  "keyboard settlement must use the preparation-aware public actions",
);
assert.match(
  runtimeSource,
  /const action: RasterTransformHistoryAction[\s\S]{0,1200}commitHistoryActionAtomically\(engine, action\)/,
  "il checkpoint Trasforma deve pubblicare journal e ramo Redo con rollback comune",
);
assert.match(runtimeSource, /released|destroyLayerColdStorage\(seed\)/);
assert.match(runtimeSource, /session\.scope === "selection"[\s\S]{0,240}Math\.round\(transform\.translationX\)/);
assert.match(runtimeSource, /Pixel Selection can only be moved/);
assert.match(runtimeSource, /captureSelectionHistoryMask\([\s\S]{0,300}translatePixelSelection\([\s\S]{0,300}captureSelectionHistoryMask\(/);
assert.match(runtimeSource, /selectionOverlaySuppressed = false/);
assert.match(runtimeSource, /selectionOverlayOffsetX = session\.transform\.translationX/);
assert.match(runtimeSource, /selectionOverlayOffsetY = session\.transform\.translationY/);
assert.match(runtimeSource, /export function nudgeRasterLayerTransform/);
assert.match(runtimeSource, /rebuildRasterLayerFromImmutableSource\(engine, record\)/);
assert.match(runtimeSource, /composeRasterLayerSourceTransform/);
assert.match(runtimeSource, /rasterSourceBefore/);
assert.match(runtimeSource, /rasterSourceAfter/);
assert.match(
  controllerSource,
  /this\.transformCommitBusy[\s\S]{0,120}this\.rasterTransformRecoveryOnly[\s\S]{0,160}!resumedAfterPreparation && this\.rasterTransformPreparation !== null/,
  "pointer input must remain blocked while a cold raster mode is preparing",
);
assert.match(controllerSource, /rasterTransformRecoveryOnly/);
assert.match(
  controllerSource,
  /if \(isRasterLayerTransformNode\(node\) && node\.scope === "selection"\) return null/,
);
assert.match(
  controllerSource,
  /private async nudgeSelectedTransform\([\s\S]*?await this\.prepareSelectedRasterTransform\(\)[\s\S]*?this\.host\.nudgeRasterLayerTransform\(deltaX, deltaY\)/,
  "keyboard movement must lazily prepare the raster transaction before updating it",
);
assert.match(controllerSource, /const rasterKeyboardMove = Boolean/);
assert.match(controllerSource, /event\.shiftKey \? 10 : 1/);
assert.match(
  controllerSource,
  /setTransformToolActive\([\s\S]{0,100}active: boolean,[\s\S]{0,100}\): boolean \{[\s\S]{0,500}const latestSnapshot = this\.runtimeSceneSnapshot\(\);[\s\S]{0,120}this\.syncScene\(latestSnapshot\);[\s\S]{0,120}this\.transformToolActive = active;/,
  "l'ingresso in Trasforma deve aggiornare la scena dopo l'ultimo gesto raster",
);
const transformActivationStart = controllerSource.indexOf("  setTransformToolActive(");
const transformActivationEnd = controllerSource.indexOf(
  "  private updateTransformUi()",
  transformActivationStart,
);
assert.ok(transformActivationStart >= 0 && transformActivationEnd > transformActivationStart);
assert.doesNotMatch(
  controllerSource.slice(transformActivationStart, transformActivationEnd),
  /prepareSelectedRasterTransform/,
  "l'ingresso in Trasforma non deve aprire una transazione raster prima del primo gesto",
);
assert.match(
  brushEngineSource,
  /const rasterIsActive = record\.id === this\.layerStack\.active\.id;[\s\S]{0,240}const rasterHasContent = rasterIsActive \? this\.layerHasContent : record\.hasContent;[\s\S]{0,240}const rasterContentBounds = rasterIsActive[\s\S]{0,120}\? this\.layerContentBounds[\s\S]{0,120}: record\.contentBounds;/,
  "Trasforma deve leggere contenuto e bbox vivi del livello raster attivo appena dipinto",
);

console.log("Raster transform math/shader verification passed.");

// Cold compiler jobs must run in strict FIFO order, and one rejected operation
// must not poison a later retry.
{
  const queue = new SerialAsyncQueue();
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = queue.run(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return 1;
  });
  const second = queue.run(async () => {
    events.push("second:start");
    return 2;
  });
  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);

  await assert.rejects(
    queue.run(async () => {
      events.push("failed");
      throw new Error("expected queue failure");
    }),
    /expected queue failure/,
  );
  assert.equal(await queue.run(async () => {
    events.push("recovered");
    return 3;
  }), 3);
  assert.deepEqual(events.slice(-2), ["failed", "recovered"]);
}

// --- Invariante contenuto/tile ------------------------------------------------
// Lo scratch si deriva dalla maschera di tile, e `packRasterTransformUniforms`
// pretende che il contenuto ci stia dentro. Bounds e maschera nascono pero' da
// calcoli diversi — continui i primi, per tile proiettata la seconda — e
// divergono di pochi pixel a ogni Applica. Misurato in browser dopo due
// Applica: contenuto `0,0 903x490` contro maschera `0,0 896x512`, sette pixel
// fuori a destra. Da li' Trasforma non si riapriva piu' su quel livello.
{
  const documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH;
  const documentHeight = RASTER_TRANSFORM_DOCUMENT_HEIGHT;
  const tileWidth = RASTER_TRANSFORM_TILE_WIDTH;
  const tileHeight = RASTER_TRANSFORM_TILE_HEIGHT;
  const gridWidth = Math.ceil(documentWidth / tileWidth);
  const gridHeight = Math.ceil(documentHeight / tileHeight);
  const parole = Math.ceil((gridWidth * gridHeight) / 32);
  const accendi = (mask, tileX, tileY) => {
    const indice = tileY * gridWidth + tileX;
    mask[indice >>> 5] |= 1 << (indice & 31);
  };
  const identita = { translationX: 0, translationY: 0, scale: 1, rotation: 0 };

  const maschera = new Uint32Array(parole);
  for (let tileY = 0; tileY < 4; tileY += 1) {
    for (let tileX = 0; tileX < 7; tileX += 1) accendi(maschera, tileX, tileY);
  }
  const scratchPrima = rasterTransformScratchRect(
    maschera,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(scratchPrima.width, 7 * tileWidth, "scratch di partenza inatteso");

  // Il caso reale: il contenuto sfora la maschera di 7 px a destra.
  const contenuto = {
    x: 0,
    y: 0,
    width: 7 * tileWidth + 7,
    height: 4 * tileHeight - 22,
  };
  assert.throws(
    () => packRasterTransformUniforms({
      sourceScratchRect: scratchPrima,
      sourceContentBounds: contenuto,
      sourcePivot: { x: 0, y: 0 },
      transform: identita,
    }),
    /sourceContentBounds must be contained within the scratch area/,
    "senza copertura il caso misurato deve ancora fallire: e' la regressione",
  );

  const coperta = tileMaskCoveringRect(
    maschera,
    contenuto,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  const scratchDopo = rasterTransformScratchRect(
    coperta,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(scratchDopo.width, 8 * tileWidth, "la copertura deve accendere la colonna mancante");
  packRasterTransformUniforms({
    sourceScratchRect: scratchDopo,
    sourceContentBounds: contenuto,
    sourcePivot: { x: 0, y: 0 },
    transform: identita,
  });

  // Non deve mutare l'ingresso: la maschera del record e' condivisa.
  assert.equal(rasterTransformScratchRect(
    maschera,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  ).width, 7 * tileWidth,
    "tileMaskCoveringRect non deve mutare la maschera ricevuta");

  // Bordo esatto: `right` e' esclusivo, quindi un rettangolo che finisce sul
  // confine non deve accendere la colonna successiva.
  const esatto = tileMaskCoveringRect(
    maschera,
    { x: 0, y: 0, width: 7 * tileWidth, height: 4 * tileHeight },
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(rasterTransformScratchRect(
    esatto,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  ).width, 7 * tileWidth,
    "un rettangolo allineato al tile non deve accendere una colonna vuota");

  // La maschera puo' solo crescere, e un rettangolo nullo la lascia com'e'.
  const nulla = tileMaskCoveringRect(
    maschera,
    null,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.deepEqual([...nulla], [...maschera], "rect nullo deve lasciare la maschera invariata");
  for (let parola = 0; parola < parole; parola += 1) {
    assert.equal(coperta[parola] & maschera[parola], maschera[parola],
      "la copertura non puo' spegnere tile gia' accesi");
  }
}

// --- Guardie del runtime ------------------------------------------------------
{
  const engine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
  const guardStart = engine.indexOf("  assertLayerSwitchAllowed(): void {");
  const guardia = engine.slice(
    guardStart,
    engine.indexOf("  persistActiveLayerState(): void {", guardStart),
  );
  // La sessione Trasforma tiene viva la texture hot del sorgente: un cambio di
  // livello la evacua e l'Applica successivo la trova mancante, perdendo la
  // trasformazione in silenzio. L'Undo era gia' protetto, `addLayer` no.
  assert.ok(
    guardia.includes("this.activeRasterTransformSession"),
    "il cambio livello va rifiutato mentre una sessione Trasforma e' aperta",
  );
  assert.ok(
    guardia.indexOf("this.activeRasterTransformSession")
      < guardia.indexOf("this.activeStroke"),
    "il caso Trasforma va controllato per primo, per dare il messaggio che dice cosa fare",
  );

  const runtime = readFileSync(
    new URL("../src/engine-raster-transform-runtime.ts", import.meta.url),
    "utf8",
  );
  const metadati = runtime.slice(
    runtime.indexOf("function setAuthoritativeMetadata("),
    runtime.indexOf("function encodeTransformPass("),
  );
  assert.match(
    metadati,
    /record\.storageTileMask\.set\(\s*\n?\s*tileMaskCoveringRect\(tileMask, bounds\),?\s*\n?\s*\)/,
    "bounds e maschera vanno scritti insieme rispettando l'invariante",
  );
  assert.match(
    runtime,
    /const sourceTileMask = tileMaskCoveringRect\(\s*\n\s*record\.storageTileMask,\s*\n\s*sourceBounds,/,
    "anche in lettura, per riparare un livello gia' divergente",
  );
}

{
  const limitsRuntime = await import("../src/engine-limits.ts");
  const blendRuntime = await import("../src/blend-core.ts");
  const originalWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH;
  const originalHeight = RASTER_TRANSFORM_DOCUMENT_HEIGHT;
  try {
    limitsRuntime.reconfigureDocumentDimensions(1080, 1920);
    assert.equal(RASTER_TRANSFORM_DOCUMENT_WIDTH, 1080);
    assert.equal(RASTER_TRANSFORM_DOCUMENT_HEIGHT, 1920);
    assert.equal(RASTER_TRANSFORM_DOCUMENT_SIZE, 1920);
    assert.equal(RASTER_TRANSFORM_TILE_WIDTH, 68);
    assert.equal(RASTER_TRANSFORM_TILE_HEIGHT, 120);
    assert.equal(RASTER_TRANSFORM_TILE_SIZE, 120);
    assert.equal(blendRuntime.DRY_BLEND_DEFAULT_DOCUMENT_SIZE, 1920);
  } finally {
    limitsRuntime.reconfigureDocumentDimensions(originalWidth, originalHeight, {
      allowLegacy4096: true,
    });
  }
}

console.log("Raster transform tile/bounds invariant verified.");
