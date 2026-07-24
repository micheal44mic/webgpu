import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_RASTER_BEVEL_STYLE,
  RASTER_BEVEL_HEIGHTFIELD_CALIBRATION,
  RASTER_BEVEL_MAX_RADIUS,
  RASTER_BEVEL_MAX_WORK_SIDE,
  RASTER_BEVEL_PROFILE_SIZE,
  RASTER_BEVEL_TECHNIQUES,
  classifyRasterBevelStyleChange,
  copyRasterBevelStyle,
  deriveRasterBevelHeightfield,
  makeRasterBevelSplineContourLut,
  normalizeRasterBevelStyle,
  rasterBevelGeometryKey,
  rasterBevelLightVector,
  rasterBevelRadiusBucket,
  rasterBevelStylesEqual,
  rasterBevelVisualBounds,
} from "../src/bevel-core.ts";

const approx = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

assert.deepEqual(normalizeRasterBevelStyle(), DEFAULT_RASTER_BEVEL_STYLE);
assert.equal(Object.isFrozen(DEFAULT_RASTER_BEVEL_STYLE), true);
assert.deepEqual(RASTER_BEVEL_HEIGHTFIELD_CALIBRATION, {
  smoothSigmaScale: 0.5,
  chiselSoftSigmaScale: 0.15,
  softenSigmaScale: 1,
  smoothAmplitudeScale: 0.31,
  rangeHypothesis: "A",
  adaptiveIso: false,
  blurKernel: "gaussian",
  defaultEffectOpacity: { highlight: 0.75, shadow: 0.75 },
});

const normalized = normalizeRasterBevelStyle({
  enabled: 1,
  mode: "outer",
  technique: "chiselSoft",
  direction: "down",
  size: 999,
  soften: -1,
  depth: 2_000,
  angle: -45,
  altitude: 100,
  highlight: "#804020",
  shadow: [2, -1, Number.NaN],
  highlightOpacity: -10,
  shadowOpacity: 120,
  gloss: "ring",
  contourAA: false,
  bevelContourEnabled: true,
  bevelContour: "cone",
  bevelRange: 0,
  fill: 150,
});
assert.deepEqual(normalized, {
  enabled: true,
  mode: "outer",
  technique: "chiselSoft",
  direction: "down",
  gloss: "ring",
  contourAA: false,
  bevelContourEnabled: true,
  bevelContour: "cone",
  size: 250,
  soften: 0,
  bevelRange: 1,
  fill: 100,
  depth: 1_000,
  angle: 315,
  altitude: 90,
  highlightColor: [128 / 255, 64 / 255, 32 / 255],
  highlightOpacity: 0,
  shadowColor: [1, 0, 0.035],
  shadowOpacity: 100,
});

const copy = copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE);
assert.notEqual(copy.highlightColor, DEFAULT_RASTER_BEVEL_STYLE.highlightColor);
assert.notEqual(copy.shadowColor, DEFAULT_RASTER_BEVEL_STYLE.shadowColor);
assert.equal(rasterBevelStylesEqual(copy, DEFAULT_RASTER_BEVEL_STYLE), true);

const defaultDerived = deriveRasterBevelHeightfield(DEFAULT_RASTER_BEVEL_STYLE);
assert.equal(defaultDerived.sigma1, 16);
assert.equal(defaultDerived.sigmaTech, 0);
assert.equal(defaultDerived.sigmaSoften, 4);
approx(defaultDerived.sigmaB, Math.hypot(0.5, 4));
assert.equal(defaultDerived.bandWidth, 32);
approx(defaultDerived.amplitudeScale, 9.92);
assert.equal(defaultDerived.apron, 63);

for (const technique of RASTER_BEVEL_TECHNIQUES) {
  for (const mode of ["inner", "outer", "emboss", "pillow"]) {
    const derived = deriveRasterBevelHeightfield({
      ...DEFAULT_RASTER_BEVEL_STYLE,
      technique,
      mode,
      size: 250,
      soften: 64,
    });
    assert.ok(derived.apron <= RASTER_BEVEL_MAX_RADIUS);
    assert.ok(256 + derived.apron * 2 <= RASTER_BEVEL_MAX_WORK_SIDE);
  }
}

const geometryStyle = { ...DEFAULT_RASTER_BEVEL_STYLE, enabled: true };
assert.equal(
  classifyRasterBevelStyleChange(
    geometryStyle,
    { ...geometryStyle, depth: 180 },
    rasterBevelRadiusBucket(geometryStyle),
  ).geometryRebuild,
  false,
);
assert.equal(
  classifyRasterBevelStyleChange(
    geometryStyle,
    { ...geometryStyle, size: 64 },
  ).geometryRebuild,
  true,
);
assert.notEqual(
  rasterBevelGeometryKey(geometryStyle),
  rasterBevelGeometryKey({ ...geometryStyle, bevelRange: 80 }),
);
assert.ok(rasterBevelRadiusBucket({ ...geometryStyle, size: 250, soften: 64 })
  <= RASTER_BEVEL_MAX_RADIUS);

assert.deepEqual(
  rasterBevelVisualBounds(
    { x: 100, y: 100, width: 20, height: 30 },
    { ...geometryStyle, mode: "inner" },
    512,
    512,
  ),
  { x: 100, y: 100, width: 20, height: 30 },
);
const outerBounds = rasterBevelVisualBounds(
  { x: 100, y: 100, width: 20, height: 30 },
  { ...geometryStyle, mode: "outer" },
  512,
  512,
);
assert.ok(outerBounds.x < 100 && outerBounds.y < 100);
assert.ok(outerBounds.width > 20 && outerBounds.height > 30);

const east = rasterBevelLightVector(0, 0);
approx(east[0], 1);
approx(east[1], 0);
approx(east[2], 0);
const zenith = rasterBevelLightVector(90, 90);
approx(zenith[0], 0);
approx(zenith[1], 0);
approx(zenith[2], 1);

for (const kind of ["linear", "soft", "gaussian", "cone", "ring"]) {
  const lut = makeRasterBevelSplineContourLut(kind, RASTER_BEVEL_PROFILE_SIZE);
  assert.equal(lut.length, RASTER_BEVEL_PROFILE_SIZE);
  assert.ok(lut.every((value) => value >= 0 && value <= 1));
}
assert.deepEqual(
  makeRasterBevelSplineContourLut("soft", 32),
  makeRasterBevelSplineContourLut("gaussian", 32),
);

const rendererSource = readFileSync(new URL("../src/bevel-renderer.ts", import.meta.url), "utf8");
const styleStackSource = readFileSync(new URL("../src/stroke-renderer.ts", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
assert(rendererSource.includes("texture_storage_2d<r32float, write>"));
assert(rendererSource.includes("marching"));
assert(rendererSource.includes("segmentDistance"));
assert(rendererSource.includes("jfaScheduleForExtent"));
assert(rendererSource.includes("beginComputePass"));
assert(!rendererSource.includes("mapAsync"));
assert(styleStackSource.includes("bevelNode(base, position)"));
assert(styleStackSource.indexOf("bevelNode(base, position)")
  < styleStackSource.indexOf("combinedStrokeNode(base.a, node, coverage)"));
assert(styleStackSource.includes("random24(documentPosition, 4660u)"));
assert(engineSource.includes("sourceMode: RasterStrokeSourceMode"));
assert(engineSource.includes("this.rasterBevelRenderer?.workspaceMemoryBytes"));

console.log("Raster bevel Heightfield V2 verification passed.");
