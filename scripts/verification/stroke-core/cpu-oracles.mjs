import assert from "node:assert/strict";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  RASTER_STROKE_ALPHA_THRESHOLD,
  RASTER_STROKE_DISTANCE_SCALE,
  RASTER_STROKE_JFA_TIE_ORDER,
  RASTER_STROKE_MAX_DISTANCE,
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
  RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH,
  RASTER_STROKE_FULL_SCRATCH_EXTENT,
  RASTER_STROKE_SCRATCH_STRATEGY,
  RASTER_STROKE_MAX_WIDTH,
  compositeRasterStrokePixel,
  copyRasterStrokeStyle,
  dilateRasterStrokeTileKeys,
  jfaScheduleForExtent,
  nextRasterStrokeMipValidThroughLevel,
  normalizeRasterStrokeStyle,
  packRasterStrokeDistanceQ10_6,
  partitionRasterStrokeBuildKeys,
  quantizeRasterStrokeDistance,
  rasterStrokeBuildRegion,
  rasterStrokeCoverageFromFixedDistance,
  rasterStrokeCoverageFromSignedDistance,
  rasterStrokeJfaCandidateWins,
  rasterStrokeJfaScheduleForRegion,
  rasterStrokeJfaSeedTieLess,
  rasterStrokeScratchExtentForRenderer,
  rasterStrokeScratchExtentForWidth,
  rasterStrokeSignedDistance,
  rasterStrokeStylesEqual,
  rasterStrokeTileHalo,
} from "../../../src/stroke-core.ts";
import {
  DEFAULT_RASTER_COLOR_OVERLAY_STYLE,
  compositeRasterColorOverlayPixel,
  normalizeRasterColorOverlayStyle,
} from "../../../src/raster-color-overlay-core.ts";

const approx = (actual, expected, epsilon = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} != ${expected}`,
  );
};

// Style normalization is copied from raster-stroke-style-gpu.js.
assert.deepEqual(normalizeRasterStrokeStyle(), {
  enabled: false,
  width: 14,
  position: "outside",
  color: [1, 0.643, 0.282, 1],
});
assert.equal(Object.isFrozen(DEFAULT_RASTER_STROKE_STYLE), true);
assert.equal(Object.isFrozen(DEFAULT_RASTER_STROKE_STYLE.color), true);
assert.deepEqual(
  normalizeRasterStrokeStyle({
    enabled: "false",
    width: -20,
    position: "CENTER",
    color: [2, -1, Number.NaN, 0.25],
  }),
  {
    enabled: true,
    width: 0,
    position: "center",
    color: [1, 0, 0.282, 0.25],
  },
);
assert.equal(normalizeRasterStrokeStyle({ width: 900 }).width, RASTER_STROKE_MAX_WIDTH);
assert.equal(normalizeRasterStrokeStyle({ width: Number.NaN }).width, 14);
assert.equal(normalizeRasterStrokeStyle({ position: "diagonal" }).position, "outside");
assert.deepEqual(normalizeRasterStrokeStyle({ color: [0.1] }).color, [
  0.1,
  0.643,
  0.282,
  1,
]);
const copiedStyle = copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE);
assert.notEqual(copiedStyle.color, DEFAULT_RASTER_STROKE_STYLE.color);
assert.equal(rasterStrokeStylesEqual(copiedStyle, DEFAULT_RASTER_STROKE_STYLE), true);
assert.equal(rasterStrokeStylesEqual(copiedStyle, { ...copiedStyle, width: 15 }), false);

// Normal Color Overlay changes premultiplied RGB only: source alpha is the
// clipping mask and must remain byte-identical for every opacity.
assert.deepEqual(DEFAULT_RASTER_COLOR_OVERLAY_STYLE, {
  enabled: false,
  color: [0, 0, 0],
  opacity: 100,
});
const normalizedColorOverlay = normalizeRasterColorOverlayStyle({
  enabled: true,
  color: [0.8, 0.2, 0.1],
  opacity: 25,
});
const overlaidPixel = compositeRasterColorOverlayPixel(
  [0.12, 0.24, 0.06, 0.5],
  normalizedColorOverlay,
);
approx(overlaidPixel[0], 0.19);
approx(overlaidPixel[1], 0.205);
approx(overlaidPixel[2], 0.0575);
assert.equal(overlaidPixel[3], 0.5);
assert.deepEqual(
  compositeRasterColorOverlayPixel(
    [0.12, 0.24, 0.06, 0.5],
    { ...normalizedColorOverlay, enabled: false },
  ),
  [0.12, 0.24, 0.06, 0.5],
);
assert.deepEqual(
  compositeRasterColorOverlayPixel([0, 0, 0, 0], normalizedColorOverlay),
  [0, 0, 0, 0],
);

assert.equal(
  RASTER_STROKE_SCRATCH_STRATEGY,
  "compositor-only-8-otherwise-width-tiered-1024-through-128-or-2048",
);
assert.equal(
  rasterStrokeScratchExtentForRenderer(false, 14),
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
);
assert.equal(
  rasterStrokeScratchExtentForRenderer(true, 0),
  RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT,
);
assert.equal(
  rasterStrokeScratchExtentForRenderer(true, 14),
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
);
assert.equal(rasterStrokeScratchExtentForWidth(14), RASTER_STROKE_COMPACT_SCRATCH_EXTENT);
assert.equal(
  rasterStrokeScratchExtentForWidth(RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH),
  RASTER_STROKE_COMPACT_SCRATCH_EXTENT,
);
assert.equal(
  rasterStrokeScratchExtentForWidth(RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH + 1),
  RASTER_STROKE_FULL_SCRATCH_EXTENT,
);
assert.equal(rasterStrokeScratchExtentForWidth(512), RASTER_STROKE_FULL_SCRATCH_EXTENT);
const compactTargetExtent = RASTER_STROKE_COMPACT_SCRATCH_EXTENT
  - 2 * Math.ceil(RASTER_STROKE_COMPACT_SCRATCH_MAX_WIDTH + 2);
const compactFullDocumentJobs = Math.ceil(4_096 / compactTargetExtent) ** 2;
const compactParameters = compactFullDocumentJobs
  * (jfaScheduleForExtent(RASTER_STROKE_COMPACT_SCRATCH_EXTENT, { plusOne: true }).length + 2);
assert.ok(compactParameters < 2_048);

// A mip-0 change makes every coarser level not rebuilt in the same frame
// stale. Zooming out later must rebuild it instead of reusing old pixels.
assert.equal(nextRasterStrokeMipValidThroughLevel(4, 0, true), 0);
assert.equal(nextRasterStrokeMipValidThroughLevel(4, 1, true), 1);
assert.equal(nextRasterStrokeMipValidThroughLevel(1, 4, false), 4);
assert.equal(nextRasterStrokeMipValidThroughLevel(4, 1, false), 4);

// The distance-validity halo is ceil((width + 1.5) / tileSize), minimum one.
assert.equal(rasterStrokeTileHalo(256, 0), 1);
assert.equal(rasterStrokeTileHalo(256, 14), 1);
assert.equal(rasterStrokeTileHalo(256, 254.5), 1);
assert.equal(rasterStrokeTileHalo(256, 255), 2);
assert.equal(rasterStrokeTileHalo(256, 512), 3);
assert.equal(rasterStrokeTileHalo(256, 900), 3);
assert.deepEqual(
  dilateRasterStrokeTileKeys([5], 4, 4, 256, 14),
  [0, 1, 2, 4, 5, 6, 8, 9, 10],
);
const tileMask = new Uint8Array(16);
tileMask[0] = 1;
assert.deepEqual(
  dilateRasterStrokeTileKeys(tileMask, 4, 4, 256, 14),
  [0, 1, 4, 5],
);

// Build regions retain the old width + 2 apron and the [-1, document + 1]
// virtual border. The first vector is an interior 256 px tile.
const interiorRegion = rasterStrokeBuildRegion([5], 1024, 1024, 256, 14);
assert.deepEqual(interiorRegion, {
  x0: 240,
  y0: 240,
  x1: 528,
  y1: 528,
  w: 288,
  h: 288,
  halo: 16,
});
assert.deepEqual(rasterStrokeBuildRegion([0], 1024, 1024, 256, 14), {
  x0: -1,
  y0: -1,
  x1: 272,
  y1: 272,
  w: 273,
  h: 273,
  halo: 16,
});
assert.equal(rasterStrokeBuildRegion([], 1024, 1024, 256, 14), null);
assert.deepEqual(
  partitionRasterStrokeBuildKeys(
    [15, 0, 12, 3, 15, -1, 99],
    1024,
    1024,
    256,
    600,
    14,
  ),
  [[0], [12], [3], [15]],
);
assert.throws(
  () => partitionRasterStrokeBuildKeys([5], 1024, 1024, 256, 200, 14),
  /non partizionabile/,
);

// Stroke uses the REGION EXTENT, plus the historical extra step 1.
assert.deepEqual(jfaScheduleForExtent(1), [1, 1]);
assert.deepEqual(jfaScheduleForExtent(2), [1, 1]);
assert.deepEqual(jfaScheduleForExtent(3), [2, 1, 1]);
assert.deepEqual(jfaScheduleForExtent(288), [
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1,
  1,
]);
assert.deepEqual(jfaScheduleForExtent(288, { plusOne: false }), [
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1,
]);
assert.deepEqual(rasterStrokeJfaScheduleForRegion(interiorRegion), [
  256,
  128,
  64,
  32,
  16,
  8,
  4,
  2,
  1,
  1,
]);
assert.equal(RASTER_STROKE_JFA_TIE_ORDER, "yx");
assert.equal(
  rasterStrokeJfaSeedTieLess({ x: 2, y: 1 }, { x: 1, y: 2 }),
  true,
);
assert.equal(
  rasterStrokeJfaSeedTieLess({ x: 1, y: 2 }, { x: 2, y: 1 }),
  false,
);
assert.equal(
  rasterStrokeJfaSeedTieLess({ x: 1, y: 1 }, { x: 2, y: 1 }),
  true,
);
assert.equal(
  rasterStrokeJfaCandidateWins(
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
  ),
  true,
);

// DISTANCE_FRAGMENT: Q10.6, half-up, capped at 1023 px, packed low/high.
assert.equal(RASTER_STROKE_DISTANCE_SCALE, 64);
assert.equal(RASTER_STROKE_MAX_DISTANCE, 1023);
assert.equal(quantizeRasterStrokeDistance(0), 0);
assert.equal(quantizeRasterStrokeDistance(1 / 128), 1);
assert.equal(quantizeRasterStrokeDistance(1), 64);
assert.equal(quantizeRasterStrokeDistance(4.5), 288);
assert.equal(quantizeRasterStrokeDistance(1023), 65472);
assert.equal(quantizeRasterStrokeDistance(2000), 65472);
assert.deepEqual(packRasterStrokeDistanceQ10_6(4.5), [32, 1]);
assert.deepEqual(packRasterStrokeDistanceQ10_6(1023), [192, 255]);

// NODE_FRAGMENT signed-distance correction around the alpha=0.5 isoline.
assert.equal(RASTER_STROKE_ALPHA_THRESHOLD, 0.5);
assert.equal(rasterStrokeSignedDistance(0.5, 1), 0);
assert.equal(rasterStrokeSignedDistance(1, 1), -0.5);
assert.equal(rasterStrokeSignedDistance(0, 1), 0.5);

// Keep the CPU geometry endpoint checks, but do not make its historical
// byte-quantized midpoint an oracle for the packed-f16 runtime coverage.
assert.equal(
  rasterStrokeCoverageFromSignedDistance(0, 2, "center"),
  1,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(1, 64, 2, "inside"),
  1,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(1, 64, 2, "outside"),
  0,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(0, 64, 2, "outside"),
  1,
);
assert.equal(
  rasterStrokeCoverageFromFixedDistance(0.5, 0, 512, "center"),
  0,
);

// NODE_FRAGMENT/COVERAGE_NODE_FRAGMENT compositing vectors. `base` is
// premultiplied, while the stroke color is straight RGBA.
const shaderStyle = {
  enabled: true,
  width: 2,
  position: "outside",
  color: [1, 0.25, 0, 0.8],
};
const outsidePixel = compositeRasterStrokePixel(
  [0.2, 0.1, 0.05, 0.5],
  0.5,
  shaderStyle,
  0.5,
);
approx(outsidePixel[0], 0.3);
approx(outsidePixel[1], 0.1);
approx(outsidePixel[2], 0.025);
approx(outsidePixel[3], 0.45);

const insidePixel = compositeRasterStrokePixel(
  [0.2, 0.1, 0.05, 0.5],
  0.5,
  { ...shaderStyle, position: "inside" },
);
approx(insidePixel[0], 0.44);
approx(insidePixel[1], 0.12);
approx(insidePixel[2], 0.01);
approx(insidePixel[3], 0.5);

const transparentBase = compositeRasterStrokePixel(
  [0, 0, 0, 0],
  1,
  shaderStyle,
);
approx(transparentBase[0], 0.8);
approx(transparentBase[1], 0.2);
approx(transparentBase[2], 0);
approx(transparentBase[3], 0.8);
