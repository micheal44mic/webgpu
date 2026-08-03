import assert from "node:assert/strict";
import {
  CausalFadedStrokeStabilizer,
  STROKE_STABILIZATION_DEFAULT_CAPACITY,
  STROKE_STABILIZATION_MAXIMUM_TIME_CONSTANT_MS,
  STROKE_STABILIZATION_STRATEGY,
  normalizeStrokeStabilizationAmount,
  strokeStabilizationSmoothstep,
  strokeStabilizationTimeConstantMs,
} from "../src/stroke-stabilization-core.ts";
import { CausalStrokeCurvePlanner } from "../src/stroke-curve-core.ts";

const approximate = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} != ${expected} (epsilon ${epsilon})`,
  );
};

assert.equal(
  STROKE_STABILIZATION_STRATEGY,
  "causal-linear-input-ema-speed-lag-mature-prefix-smoothstep-revision-tail-endpoint-exact-v1",
);
assert.equal(STROKE_STABILIZATION_MAXIMUM_TIME_CONSTANT_MS, 160);
assert.equal(STROKE_STABILIZATION_DEFAULT_CAPACITY, 1024);
assert.equal(normalizeStrokeStabilizationAmount(Number.NaN), 0);
assert.equal(normalizeStrokeStabilizationAmount(-1), 0);
assert.equal(normalizeStrokeStabilizationAmount(2), 1);
approximate(strokeStabilizationTimeConstantMs(0.5), 40);
approximate(strokeStabilizationTimeConstantMs(1), 160);

// The taper is the requested cubic smoothstep: exact endpoints, monotonic,
// and zero first derivative at both the mature seam and the raw pointer.
assert.equal(strokeStabilizationSmoothstep(-1), 0);
assert.equal(strokeStabilizationSmoothstep(0), 0);
assert.equal(strokeStabilizationSmoothstep(1), 1);
assert.equal(strokeStabilizationSmoothstep(2), 1);
let previousSmoothstep = 0;
for (let index = 0; index <= 1000; index += 1) {
  const value = strokeStabilizationSmoothstep(index / 1000);
  assert.ok(value >= previousSmoothstep);
  previousSmoothstep = value;
}
const derivativeStep = 1e-7;
assert.ok(strokeStabilizationSmoothstep(derivativeStep) / derivativeStep < 1e-6);
assert.ok(
  (1 - strokeStabilizationSmoothstep(1 - derivativeStep)) / derivativeStep
    < 1e-6,
);

// Zero is a hard bypass: no revisionable tail, no matured substitute, and
// every coordinate/pressure/time value is returned exactly as supplied.
const bypass = new CausalFadedStrokeStabilizer();
const bypassBegin = bypass.begin({ x: 3, y: 7, pressure: 0.4, timeMs: 10 }, 0);
assert.equal(bypassBegin.bypassed, true);
assert.equal(bypassBegin.tailCount, 0);
assert.equal(bypassBegin.matureCount, 0);
const bypassPoint = { x: 31.25, y: -9.5, pressure: 0.73, timeMs: 19.5 };
const bypassUpdate = bypass.push(bypassPoint);
assert.equal(bypassUpdate.bypassX, bypassPoint.x);
assert.equal(bypassUpdate.bypassY, bypassPoint.y);
assert.equal(bypassUpdate.bypassPressure, bypassPoint.pressure);
assert.equal(bypassUpdate.bypassTimeMs, bypassPoint.timeMs);
assert.equal(bypassUpdate.tailCount, 0);
assert.equal(bypassUpdate.matureCount, 0);
const bypassFinish = bypass.finish();
assert.equal(bypassFinish.finished, true);
assert.equal(bypassFinish.bypassX, bypassPoint.x);
assert.equal(bypassFinish.bypassY, bypassPoint.y);

// A straight constant-speed stroke produces a monotonic tail whose newest
// point is always exactly raw. Mature points remain fully filtered.
const straight = new CausalFadedStrokeStabilizer();
straight.begin({ x: 0, y: 0, pressure: 1, timeMs: 0 }, 1);
let maturePointCount = 0;
let lastMatureX = Number.NEGATIVE_INFINITY;
let lastUpdate;
for (let index = 1; index <= 100; index += 1) {
  const rawX = index * 10;
  lastUpdate = straight.push({ x: rawX, y: 0, pressure: 1, timeMs: index * 10 });
  assert.equal(lastUpdate.bypassed, false);
  assert.equal(lastUpdate.tailX[lastUpdate.tailCount - 1], rawX);
  assert.equal(lastUpdate.tailY[lastUpdate.tailCount - 1], 0);
  assert.equal(lastUpdate.tailWeight[0], 1);
  assert.equal(lastUpdate.tailWeight[lastUpdate.tailCount - 1], 0);
  for (let tailIndex = 1; tailIndex < lastUpdate.tailCount; tailIndex += 1) {
    assert.ok(
      lastUpdate.tailWeight[tailIndex]
        <= lastUpdate.tailWeight[tailIndex - 1] + 1e-12,
    );
    assert.ok(lastUpdate.tailX[tailIndex] >= lastUpdate.tailX[tailIndex - 1]);
  }
  for (let matureIndex = 0; matureIndex < lastUpdate.matureCount; matureIndex += 1) {
    const sequence = lastUpdate.matureSequence[matureIndex];
    const filteredX = lastUpdate.matureX[matureIndex];
    assert.ok(filteredX <= sequence * 10);
    assert.ok(filteredX >= lastMatureX);
    lastMatureX = filteredX;
    maturePointCount += 1;
  }
}
assert.ok(maturePointCount > 0);
assert.ok(lastUpdate.tailCount > 2);

// The exact linear-input EMA is sample-rate invariant for constant velocity.
const runConstantVelocity = (intervalMs, durationMs, velocityPxPerMs) => {
  const planner = new CausalFadedStrokeStabilizer();
  planner.begin({ x: 0, y: 0, pressure: 1, timeMs: 0 }, 1);
  let update;
  for (let timeMs = intervalMs; timeMs <= durationMs; timeMs += intervalMs) {
    update = planner.push({
      x: velocityPxPerMs * timeMs,
      y: 0,
      pressure: 1,
      timeMs,
    });
  }
  return {
    raw: velocityPxPerMs * durationMs,
    filtered: update.tailFilteredX[update.tailCount - 1],
  };
};
const fineSampling = runConstantVelocity(2, 1000, 1);
const coarseSampling = runConstantVelocity(20, 1000, 1);
approximate(fineSampling.filtered, coarseSampling.filtered, 1e-8);

const irregular = new CausalFadedStrokeStabilizer();
irregular.begin({ x: 0, y: 0, pressure: 1, timeMs: 0 }, 1);
let irregularTimeMs = 0;
let irregularUpdate;
const irregularSteps = [3, 17, 4, 29, 11, 1, 37, 8, 23, 19, 5, 31, 12];
let irregularStepIndex = 0;
while (irregularTimeMs < 1000) {
  const proposed = irregularSteps[irregularStepIndex % irregularSteps.length];
  const delta = Math.min(proposed, 1000 - irregularTimeMs);
  irregularTimeMs += delta;
  irregularUpdate = irregular.push({
    x: irregularTimeMs,
    y: 0,
    pressure: 1,
    timeMs: irregularTimeMs,
  });
  irregularStepIndex += 1;
}
approximate(
  irregularUpdate.tailFilteredX[irregularUpdate.tailCount - 1],
  fineSampling.filtered,
  1e-8,
);

// At the same path endpoint, faster motion has a larger spatial lag.
const runToEndpoint = (intervalMs) => {
  const planner = new CausalFadedStrokeStabilizer();
  planner.begin({ x: 0, y: 0, pressure: 1, timeMs: 0 }, 1);
  let update;
  for (let index = 1; index <= 100; index += 1) {
    update = planner.push({
      x: index * 10,
      y: 0,
      pressure: 1,
      timeMs: index * intervalMs,
    });
  }
  return 1000 - update.tailFilteredX[update.tailCount - 1];
};
const fastLag = runToEndpoint(2);
const slowLag = runToEndpoint(20);
assert.ok(fastLag > slowLag * 4, `${fastLag} <= ${slowLag} * 4`);

// Pointer-up freezes the geometry already visible. It neither ages the tail
// nor snaps the filtered centreline to the raw pointer.
const beforeFinishCount = lastUpdate.tailCount;
const beforeFinishX = Array.from(lastUpdate.tailX.slice(0, beforeFinishCount));
const beforeFinishY = Array.from(lastUpdate.tailY.slice(0, beforeFinishCount));
const beforeFinishWeight = Array.from(
  lastUpdate.tailWeight.slice(0, beforeFinishCount),
);
const finished = straight.finish();
assert.equal(finished.finished, true);
assert.equal(finished.matureCount, 0);
assert.equal(finished.tailCount, beforeFinishCount);
assert.deepEqual(Array.from(finished.tailX.slice(0, finished.tailCount)), beforeFinishX);
assert.deepEqual(Array.from(finished.tailY.slice(0, finished.tailCount)), beforeFinishY);
assert.deepEqual(
  Array.from(finished.tailWeight.slice(0, finished.tailCount)),
  beforeFinishWeight,
);
assert.equal(finished.tailX[finished.tailCount - 1], 1000);
assert.ok(
  finished.tailFilteredX[finished.tailCount - 1]
    < finished.tailX[finished.tailCount - 1],
);

// `matureCount` is a delta for this call only. The same update exposes the
// last promoted point once as tail[0], where it is a non-emitting seam anchor.
const seam = new CausalFadedStrokeStabilizer();
seam.begin({ x: 0, y: 0, pressure: 1, timeMs: 0 }, 1);
seam.push({ x: 10, y: 0, pressure: 1, timeMs: 10 });
const promoted = seam.push({ x: 200, y: 0, pressure: 1, timeMs: 200 });
assert.equal(promoted.matureCount, 1);
assert.equal(promoted.tailX[0], promoted.matureX[promoted.matureCount - 1]);
assert.equal(promoted.tailY[0], promoted.matureY[promoted.matureCount - 1]);
const noPromotion = seam.push({ x: 201, y: 0, pressure: 1, timeMs: 201 });
assert.equal(noPromotion.matureCount, 0);

// Fixed storage has an explicit, observable degradation mode instead of an
// allocation or crash. Even under overflow the raw endpoint remains exact.
const tiny = new CausalFadedStrokeStabilizer(4);
tiny.begin({ x: 0, y: 0, pressure: 1, timeMs: 0 }, 1);
let forced = 0;
let tinyUpdate;
for (let index = 1; index <= 12; index += 1) {
  tinyUpdate = tiny.push({ x: index, y: index, pressure: 1, timeMs: 0 });
  forced += tinyUpdate.forcedMatureCount;
}
assert.ok(forced > 0);
assert.equal(tinyUpdate.tailX[tinyUpdate.tailCount - 1], 12);
assert.equal(tinyUpdate.tailY[tinyUpdate.tailCount - 1], 12);

// Preview geometry can clone the mature Hermite planner without mutating it.
const authoritativeCurve = new CausalStrokeCurvePlanner();
authoritativeCurve.plan(0, 0, 100, 0);
authoritativeCurve.plan(100, 0, 180, 60);
const previewCurve = new CausalStrokeCurvePlanner();
previewCurve.copyStateFrom(authoritativeCurve);
const authoritativeNext = authoritativeCurve.plan(180, 60, 230, 140);
const previewNext = previewCurve.plan(180, 60, 230, 140);
assert.deepEqual(
  [
    previewNext.control1X,
    previewNext.control1Y,
    previewNext.control2X,
    previewNext.control2Y,
    previewNext.subdivisionCount,
  ],
  [
    authoritativeNext.control1X,
    authoritativeNext.control1Y,
    authoritativeNext.control2X,
    authoritativeNext.control2Y,
    authoritativeNext.subdivisionCount,
  ],
);

console.log("Stroke stabilization verification passed.", {
  fastLag,
  slowLag,
  maturePointCount,
  finalTailPoints: finished.tailCount,
});
