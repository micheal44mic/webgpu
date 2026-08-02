import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RASTER_TRANSFORM_DOCUMENT_SIZE,
  RASTER_TRANSFORM_MATH_STRATEGY,
  RASTER_TRANSFORM_TILE_SIZE,
  RASTER_TRANSFORM_UNIFORM_BYTES,
  clipRasterTransformRect,
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
} from "../src/raster-transform-math.ts";
import {
  RASTER_TRANSFORM_SHADER_STRATEGY,
  rasterTransformMipmapShader,
  rasterTransformShader,
} from "../src/raster-transform-shader.ts";

assert.equal(
  RASTER_TRANSFORM_MATH_STRATEGY,
  "document-space-uniform-affine-scale-aware-sampling-per-source-tile-mask-v2",
);
assert.equal(
  RASTER_TRANSFORM_SHADER_STRATEGY,
  "premultiplied-linear-transparent-border-inverse-affine-manual-trilinear-v3",
);

const identity = { translationX: 0, translationY: 0, scale: 1, rotation: 0 };
const pivot = { x: 100, y: 80 };
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
    RASTER_TRANSFORM_DOCUMENT_SIZE,
    0,
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
assert.deepEqual(
  rasterTransformSamplingBounds(
    { x: 500, y: 500, width: 10, height: 10 },
    { x: 505, y: 505 },
    { ...identity, scale: 20 },
    4096,
  ),
  { x: 394, y: 394, width: 222, height: 222 },
);
assert.deepEqual(
  clipRasterTransformRect({ x: -2.4, y: 4094.2, width: 9, height: 8 }),
  { x: 0, y: 4094, width: 7, height: 2 },
);

const gridSize = RASTER_TRANSFORM_DOCUMENT_SIZE / RASTER_TRANSFORM_TILE_SIZE;
const tileMask = (...indices) => {
  const mask = new Uint32Array(Math.ceil(gridSize * gridSize / 32));
  for (const index of indices) {
    mask[index >>> 5] = (mask[index >>> 5] | (1 << (index & 31))) >>> 0;
  }
  return mask;
};
const tileIndex = (x, y) => y * gridSize + x;

const sparseSource = tileMask(tileIndex(0, 0), tileIndex(2, 2));
assert.deepEqual(rasterTransformTileIndices(sparseSource), [
  tileIndex(0, 0),
  tileIndex(2, 2),
]);
assert.deepEqual(rasterTransformScratchRect(sparseSource), {
  x: 0,
  y: 0,
  width: RASTER_TRANSFORM_TILE_SIZE * 3,
  height: RASTER_TRANSFORM_TILE_SIZE * 3,
});
const sparseIdentity = rasterTransformTileMask(
  sparseSource,
  { x: 0, y: 0, width: RASTER_TRANSFORM_TILE_SIZE * 3, height: RASTER_TRANSFORM_TILE_SIZE * 3 },
  { x: 0, y: 0 },
  identity,
  { padding: 0 },
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
  /Maschera tile non valida/,
);

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
assert.deepEqual([...uniforms.slice(12)], [0.5, 0, 0, 0.5]);
assert.throws(
  () => packRasterTransformUniforms({
    sourceScratchRect: { x: 256, y: 512, width: 256, height: 256 },
    sourceContentBounds: { x: 0, y: 0, width: 100, height: 100 },
    sourcePivot: { x: 50, y: 50 },
    transform: identity,
  }),
  /contenuto nello scratch/,
);

assert.match(rasterTransformShader, /textureSampleLevel\s*\(/);
assert.doesNotMatch(rasterTransformShader, /\btextureSample\s*\(/);
assert.doesNotMatch(rasterTransformShader, /textureSampleGrad\s*\(/);
assert.doesNotMatch(rasterTransformShader, /\b(?:dpdx|dpdy|fwidth)\s*\(/);
assert.match(rasterTransformShader, /transparentBorderWeight/);
assert.match(rasterTransformShader, /textureNumLevels/);
assert.doesNotMatch(rasterTransformShader, /if \(!insideContent/);
assert.doesNotMatch(rasterTransformShader, /insideScratch/);
assert.match(rasterTransformShader, /if \(upperLevel == lowerLevel \|\| lodBlend <= 0\.000001\)/);
assert.match(rasterTransformShader, /return mix\(lower, upper, lodBlend\)/);
assert.doesNotMatch(rasterTransformShader, /\.rgb\s*\/|\/\s*[^;]*\.a/);
assert.doesNotMatch(rasterTransformShader, /rgba8unorm|rgba16float/);

assert.match(rasterTransformMipmapShader, /textureLoad\s*\(/);
assert.match(rasterTransformMipmapShader, /accumulatedWeight/);
assert.match(rasterTransformMipmapShader, /for \(var [xy] = 0; [xy] < 3/);
assert.doesNotMatch(rasterTransformMipmapShader, /textureSample/);
assert.doesNotMatch(rasterTransformMipmapShader, /rgba8unorm|rgba16float/);

const mathSource = readFileSync(
  new URL("../src/raster-transform-math.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../src/engine-raster-transform-runtime.ts", import.meta.url),
  "utf8",
);
const controllerSource = readFileSync(
  new URL("../src/mixed-vector-text-controller.ts", import.meta.url),
  "utf8",
);
const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(mathSource, /GPU(?:Device|Texture|Buffer|Queue)/);
assert.doesNotMatch(mathSource, /CanvasRenderingContext|ImageBitmap/);
assert.match(runtimeSource, /RASTER_TRANSFORM_TRANSPARENT_GUARD_PX = 2/);
assert.match(
  runtimeSource,
  /engine\.assertLayerSwitchAllowed\(\);\s*engine\.persistActiveLayerState\(\);\s*if \(!record\.hasContent \|\| !record\.contentBounds\)/,
  "l'apertura GPU deve sincronizzare il raster attivo appena dipinto prima del controllo contenuto",
);
assert.match(runtimeSource, /origin: \{[\s\S]{0,120}RASTER_TRANSFORM_TRANSPARENT_GUARD_PX/);
assert.match(runtimeSource, /padding: 0/);
assert.match(runtimeSource, /rasterTransformSamplingPadding\(transform\)/);
assert.match(runtimeSource, /presentedSamplingBounds/);
assert.match(runtimeSource, /samplingBounds/);
assert.match(runtimeSource, /sourceRasterBounds/);
assert.match(runtimeSource, /presentedSamplingBounds: \{ \.\.\.sourceRasterBounds \}/);
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
assert.match(runtimeSource, /runGpuAllocationTransaction\([\s\S]{0,180}Pipeline Trasforma raster/);
assert.match(runtimeSource, /const action: RasterTransformHistoryAction[\s\S]{0,2000}truncateRedoHistory/);
assert.match(runtimeSource, /released|destroyLayerColdStorage\(seed\)/);
assert.match(controllerSource, /if \(this\.transformCommitBusy \|\| this\.rasterTransformRecoveryOnly\) return/);
assert.match(controllerSource, /rasterTransformRecoveryOnly/);
assert.match(
  controllerSource,
  /setTransformToolActive\(active: boolean\): void \{[\s\S]{0,260}const latestSnapshot = this\.host\.getMixedSceneSnapshot\(\);[\s\S]{0,120}this\.syncScene\(latestSnapshot\);[\s\S]{0,120}this\.transformToolActive = active;/,
  "l'ingresso in Trasforma deve aggiornare la scena dopo l'ultimo gesto raster",
);
assert.match(
  brushEngineSource,
  /const rasterIsActive = record\.id === this\.layerStack\.active\.id;[\s\S]{0,240}const rasterHasContent = rasterIsActive \? this\.layerHasContent : record\.hasContent;[\s\S]{0,240}const rasterContentBounds = rasterIsActive[\s\S]{0,120}\? this\.layerContentBounds[\s\S]{0,120}: record\.contentBounds;/,
  "Trasforma deve leggere contenuto e bbox vivi del livello raster attivo appena dipinto",
);

console.log("Raster transform math/shader verification passed.");
