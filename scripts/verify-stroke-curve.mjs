import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  CausalStrokeCurvePlanner,
  STROKE_CURVE_FLATTENING_TOLERANCE_PX,
  STROKE_CURVE_MAXIMUM_SMOOTH_TURN_RADIANS,
  STROKE_CURVE_MAXIMUM_SUBDIVISIONS,
  STROKE_CURVE_STRATEGY,
  evaluateStrokeCurveX,
  evaluateStrokeCurveY,
} from "../src/stroke-curve-core.ts";
import {
  nextPaintStampSeed,
  resamplePaintCurveSegment,
} from "../src/paint-stamp-generation-core.ts";
import { readEngineSource } from "./engine-source.mjs";

const approximate = (actual, expected, epsilon = 1e-8) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} != ${expected} (epsilon ${epsilon})`,
  );
};

const pointOnSegment = (segment, parameter) => ({
  x: evaluateStrokeCurveX(segment, parameter),
  y: evaluateStrokeCurveY(segment, parameter),
});

const flattenedLength = (segment) => {
  let previous = { x: segment.startX, y: segment.startY };
  let length = 0;
  for (let index = 1; index <= segment.subdivisionCount; index += 1) {
    const current = index === segment.subdivisionCount
      ? { x: segment.endX, y: segment.endY }
      : pointOnSegment(segment, index / segment.subdivisionCount);
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
  }
  return length;
};

const maximumFlatteningError = (segment, samples = 4096) => {
  let maximum = 0;
  const subdivisions = segment.subdivisionCount;
  for (let sample = 0; sample <= samples; sample += 1) {
    const parameter = sample / samples;
    const scaled = parameter * subdivisions;
    const subdivision = Math.min(subdivisions - 1, Math.floor(scaled));
    const local = Math.min(1, scaled - subdivision);
    const startParameter = subdivision / subdivisions;
    const endParameter = (subdivision + 1) / subdivisions;
    const curve = pointOnSegment(segment, parameter);
    const lineStart = pointOnSegment(segment, startParameter);
    const lineEnd = pointOnSegment(segment, endParameter);
    const lineX = lineStart.x + (lineEnd.x - lineStart.x) * local;
    const lineY = lineStart.y + (lineEnd.y - lineStart.y) * local;
    maximum = Math.max(maximum, Math.hypot(curve.x - lineX, curve.y - lineY));
  }
  return maximum;
};

assert.equal(
  STROKE_CURVE_STRATEGY,
  "causal-endpoint-exact-predictive-hermite-corrective-tangents-quarter-pixel-target-v1",
);
assert.equal(STROKE_CURVE_MAXIMUM_SMOOTH_TURN_RADIANS, Math.PI / 3);
assert.equal(STROKE_CURVE_FLATTENING_TOLERANCE_PX, 0.25);
assert.equal(STROKE_CURVE_MAXIMUM_SUBDIVISIONS, 512);

const reusePlanner = new CausalStrokeCurvePlanner();
const reusedSegment = reusePlanner.plan(0, 0, 100, 0);
assert.equal(reusePlanner.plan(100, 0, 200, 0), reusedSegment);
assert.equal(reusedSegment.smoothed, false);
assert.equal(reusedSegment.subdivisionCount, 1);
approximate(evaluateStrokeCurveX(reusedSegment, 0.5), 150);
approximate(evaluateStrokeCurveY(reusedSegment, 0.5), 0);
reusePlanner.reset();
const resetSegment = reusePlanner.plan(0, 0, 25, 0);
assert.equal(resetSegment.smoothed, false);
assert.equal(resetSegment.startX, 0);
assert.equal(resetSegment.endX, 25);

// The shared Paint sampler preserves spacing carry, curve-parameter pressure
// and timestamps, direction, the per-input cap and the authoritative seed ABI.
const spacingPlanner = new CausalStrokeCurvePlanner();
const emitted = [];
const collectStampSample = (output, point, directionX, directionY) => {
  output.push({ ...point, directionX, directionY });
};
const spacingStart = { x: 0, y: 0, pressure: 0.2, timeMs: 0 };
const spacingMiddle = { x: 10, y: 0, pressure: 0.8, timeMs: 100 };
let distanceSinceStamp = resamplePaintCurveSegment(
  spacingPlanner.plan(0, 0, 10, 0),
  spacingStart,
  spacingMiddle,
  3,
  0,
  65_536,
  emitted,
  collectStampSample,
);
assert.equal(emitted.length, 3);
for (let index = 0; index < emitted.length; index += 1) {
  const expectedX = (index + 1) * 3;
  approximate(emitted[index].x, expectedX);
  approximate(emitted[index].pressure, 0.2 + 0.6 * expectedX / 10);
  approximate(emitted[index].timeMs, expectedX * 10);
  approximate(emitted[index].directionX, 1);
  approximate(emitted[index].directionY, 0);
}
approximate(distanceSinceStamp, 1);

const spacingEnd = { x: 14, y: 0, pressure: 1, timeMs: 140 };
distanceSinceStamp = resamplePaintCurveSegment(
  spacingPlanner.plan(10, 0, 14, 0),
  spacingMiddle,
  spacingEnd,
  3,
  distanceSinceStamp,
  65_536,
  emitted,
  collectStampSample,
);
assert.equal(emitted.length, 4);
approximate(emitted[3].x, 12);
approximate(emitted[3].pressure, 0.9);
approximate(emitted[3].timeMs, 120);
approximate(distanceSinceStamp, 2);

const capped = [];
const cappedPlanner = new CausalStrokeCurvePlanner();
const cappedCarry = resamplePaintCurveSegment(
  cappedPlanner.plan(0, 0, 10, 0),
  spacingStart,
  spacingMiddle,
  1,
  0,
  2,
  capped,
  collectStampSample,
);
assert.deepEqual(capped.map((sample) => sample.x), [1, 2]);
approximate(cappedCarry, 0);
assert.deepEqual(
  [0, 1, 2, 123_456_789].map(nextPaintStampSeed),
  [2_769_414_579, 992_382_978, 2_575_243_985, 3_673_903_414],
);

// A sparse 24-segment circle is the visual regression that exposed the
// polygonal stroke. From the second segment onward the causal prediction is
// already circular; the first segment stays immediate and therefore linear.
const radius = 1000;
const circleSegments = 24;
const circlePlanner = new CausalStrokeCurvePlanner();
let circleRawLength = 0;
let circleCurveLength = 0;
let circleMaximumRadialError = 0;
let circleFlattenedSegments = 0;
let previousEndTangent = null;
for (let index = 1; index <= circleSegments; index += 1) {
  const startAngle = (index - 1) * Math.PI * 2 / circleSegments;
  const endAngle = index * Math.PI * 2 / circleSegments;
  const startX = radius * Math.cos(startAngle);
  const startY = radius * Math.sin(startAngle);
  const endX = radius * Math.cos(endAngle);
  const endY = radius * Math.sin(endAngle);
  circleRawLength += Math.hypot(endX - startX, endY - startY);
  const segment = circlePlanner.plan(startX, startY, endX, endY);
  assert.equal(segment.startX, startX);
  assert.equal(segment.startY, startY);
  assert.equal(segment.endX, endX);
  assert.equal(segment.endY, endY);
  assert.ok(segment.subdivisionCount <= STROKE_CURVE_MAXIMUM_SUBDIVISIONS);
  assert.ok(
    segment.flatteningErrorBoundPx
      <= STROKE_CURVE_FLATTENING_TOLERANCE_PX + 1e-9,
  );
  circleCurveLength += flattenedLength(segment);
  circleFlattenedSegments += segment.subdivisionCount;
  if (index > 1) {
    assert.equal(segment.smoothed, true);
    assert.equal(segment.sharpCornerBypass, false);
    if (index > 2 && previousEndTangent) {
      approximate(segment.startTangentX, previousEndTangent.x, 1e-10);
      approximate(segment.startTangentY, previousEndTangent.y, 1e-10);
    }
    for (let sample = 0; sample <= 256; sample += 1) {
      const point = pointOnSegment(segment, sample / 256);
      circleMaximumRadialError = Math.max(
        circleMaximumRadialError,
        Math.abs(Math.hypot(point.x, point.y) - radius),
      );
    }
  }
  previousEndTangent = {
    x: segment.endTangentX,
    y: segment.endTangentY,
  };
}
assert.ok(circleMaximumRadialError < 0.001, circleMaximumRadialError);
assert.ok(circleFlattenedSegments > circleSegments);
assert.ok(Math.abs(circleCurveLength - 2 * Math.PI * radius) / (2 * Math.PI * radius) < 0.001);
assert.ok(circleCurveLength > circleRawLength);
assert.ok(
  Math.abs(Math.floor(circleCurveLength / 0.8) - Math.floor(circleRawLength / 0.8))
    / Math.floor(circleRawLength / 0.8)
    < 0.01,
);

// The corner decision must not change when the exact same 60°/61° geometry
// is scaled. 60° is rounded; 61° is an intentional sharp-corner bypass.
for (const scale of [0.1, 1, 10, 100, 1000, 4096]) {
  for (const [degrees, bypass] of [[60, false], [61, true]]) {
    const planner = new CausalStrokeCurvePlanner();
    planner.plan(0, 0, scale, 0);
    const radians = degrees * Math.PI / 180;
    const segment = planner.plan(
      scale,
      0,
      scale + scale * Math.cos(radians),
      scale * Math.sin(radians),
    );
    assert.equal(segment.sharpCornerBypass, bypass, `${degrees}° @ ${scale}`);
  }
}

const largeTurnPlanner = new CausalStrokeCurvePlanner();
largeTurnPlanner.plan(0, 0, 192_000, 0);
const largeTurnRadians = 59 * Math.PI / 180;
const largeTurn = largeTurnPlanner.plan(
  192_000,
  0,
  192_000 + 192_000 * Math.cos(largeTurnRadians),
  192_000 * Math.sin(largeTurnRadians),
);
assert.ok(largeTurn.subdivisionCount < STROKE_CURVE_MAXIMUM_SUBDIVISIONS);
assert.ok(
  largeTurn.flatteningErrorBoundPx <= STROKE_CURVE_FLATTENING_TOLERANCE_PX,
);
assert.ok(
  maximumFlatteningError(largeTurn)
    <= STROKE_CURVE_FLATTENING_TOLERANCE_PX + 1e-6,
);

const sharpPlanner = new CausalStrokeCurvePlanner();
sharpPlanner.plan(0, 0, 100, 0);
const sharp = sharpPlanner.plan(100, 0, 100, 100);
assert.equal(sharp.sharpCornerBypass, true);
assert.equal(sharp.smoothed, false);
assert.equal(sharp.subdivisionCount, 1);
for (const parameter of [0, 0.25, 0.5, 0.75, 1]) {
  approximate(evaluateStrokeCurveX(sharp, parameter), 100);
  approximate(evaluateStrokeCurveY(sharp, parameter), parameter * 100);
}

// A predicted turn followed by a straight continuation is corrected in the
// very next input segment instead of producing a hook beyond the raw path.
const correctionPlanner = new CausalStrokeCurvePlanner();
correctionPlanner.plan(0, 0, 100, 0);
const turn = 50 * Math.PI / 180;
const turnEnd = {
  x: 100 + 100 * Math.cos(turn),
  y: 100 * Math.sin(turn),
};
correctionPlanner.plan(100, 0, turnEnd.x, turnEnd.y);
const straightAfterTurn = correctionPlanner.plan(
  turnEnd.x,
  turnEnd.y,
  turnEnd.x + 100 * Math.cos(turn),
  turnEnd.y + 100 * Math.sin(turn),
);
assert.equal(straightAfterTurn.smoothed, false);
assert.equal(straightAfterTurn.subdivisionCount, 1);

// Grouping coalesced events differently cannot affect state or geometry.
const batchingFixture = [
  [0, 0], [100, 0], [195, 31], [276, 90], [335, 171], [366, 266],
];
const runGrouped = (groups) => {
  const planner = new CausalStrokeCurvePlanner();
  const output = [];
  let previous = batchingFixture[0];
  for (const group of groups) {
    for (const point of group) {
      const segment = planner.plan(previous[0], previous[1], point[0], point[1]);
      output.push(
        segment.control1X,
        segment.control1Y,
        segment.control2X,
        segment.control2Y,
        segment.subdivisionCount,
      );
      previous = point;
    }
  }
  return output;
};
assert.deepEqual(
  runGrouped([batchingFixture.slice(1)]),
  runGrouped([
    batchingFixture.slice(1, 2),
    batchingFixture.slice(2, 4),
    batchingFixture.slice(4),
  ]),
);

const engineSource = readEngineSource();
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const humanLabSource = readFileSync(
  new URL("../src/labs/human-stroke-lab.ts", import.meta.url),
  "utf8",
);
const strokeTypesSource = readFileSync(
  new URL("../src/engine-stroke-types.ts", import.meta.url),
  "utf8",
);
assert.match(engineSource, /private readonly paintCurvePlanner = new CausalStrokeCurvePlanner\(\);/);
assert.match(engineSource, /const curvePlanner = tool === "paint" \? this\.paintCurvePlanner : null;/);
assert.match(engineSource, /curvePlanner\?\.reset\(\);/);
assert.match(engineSource, /const curveSegment = stroke\.curvePlanner\?\.plan\(/);
assert.match(engineSource, /pressure:[\s\S]*?curveParameter/);
assert.match(engineSource, /timeMs:[\s\S]*?curveParameter/);
assert.match(engineSource, /if \(stroke\.tool === "blend"\)[\s\S]*?blendPlanner\?\.pushSample/);
assert.match(engineSource, /if \(tool !== "blend"\) \{\s*emitStamp\(this, normalizedPoint, 1, 0\);/);
assert.equal((engineSource.match(/resamplePaintCurveSegment\(/g) ?? []).length, 2);
assert.match(engineSource, /nextPaintStampSeed\(engine\.seedSequence\+\+\)/);
assert.match(strokeTypesSource, /curvePlanner: CausalStrokeCurvePlanner \| null;/);
assert.match(engineSource, /strokeCurveStrategy: STROKE_CURVE_STRATEGY/);
assert.match(humanLabSource, /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 64/);

const canonicalPath = new URL("../.tmp-canonical-human-stroke.json", import.meta.url);
let canonicalSummary = null;
if (existsSync(canonicalPath)) {
  const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
  const planner = new CausalStrokeCurvePlanner();
  let previous = canonical.points[0];
  let rawLength = 0;
  let curveLength = 0;
  let nonzeroSegments = 0;
  let smoothedSegments = 0;
  let flattenedSegments = 0;
  let maximumBound = 0;
  for (let index = 1; index < canonical.points.length; index += 1) {
    const point = canonical.points[index];
    const length = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (length <= 0.0001) {
      previous = point;
      continue;
    }
    const segment = planner.plan(previous.x, previous.y, point.x, point.y);
    rawLength += length;
    curveLength += flattenedLength(segment);
    nonzeroSegments += 1;
    smoothedSegments += Number(segment.smoothed);
    flattenedSegments += segment.subdivisionCount;
    maximumBound = Math.max(maximumBound, segment.flatteningErrorBoundPx);
    previous = point;
  }
  const spacing = canonical.settings.size * canonical.settings.spacingPercent / 100;
  const rawStamps = 1 + Math.floor(rawLength / spacing);
  const curveStamps = 1 + Math.floor(curveLength / spacing);
  assert.equal(nonzeroSegments, 1565);
  assert.ok(smoothedSegments > 1300);
  assert.ok(maximumBound <= STROKE_CURVE_FLATTENING_TOLERANCE_PX + 1e-9);
  assert.ok(Math.abs(curveLength / rawLength - 1) < 0.002);
  assert.ok(Math.abs(curveStamps / rawStamps - 1) < 0.002);
  canonicalSummary = {
    nonzeroSegments,
    smoothedSegments,
    flattenedSegments,
    rawStamps,
    curveStamps,
    curveLengthDeltaPercent: (curveLength / rawLength - 1) * 100,
    maximumBound,
  };
}

console.log("Stroke curve verification passed.", canonicalSummary ?? "canonical trace unavailable");
