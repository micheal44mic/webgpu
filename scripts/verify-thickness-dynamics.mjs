import assert from "node:assert/strict";
import {
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessFactor,
  filterStrokeSpeed,
  quadraticEaseOut,
  speedThicknessFactor,
  startThicknessFactor,
  thicknessDynamicsIsNeutral,
  thicknessDynamicsNeedsTailHoldback,
} from "../src/thickness-dynamics.ts";

assert.equal(quadraticEaseOut(0), 0);
assert.equal(quadraticEaseOut(1), 1);
assert.equal(quadraticEaseOut(0.5), 0.75);

for (const speed of [0, 0.25, 1, 10]) {
  assert.equal(speedThicknessFactor(speed, 100, 0), 1);
}
assert.equal(startThicknessFactor(1, 1, 0), 1);
assert.equal(startThicknessFactor(1, 1, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(endThicknessFactor(1, 1, 0), 1);
assert.equal(endThicknessFactor(1, 1, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(thicknessDynamicsIsNeutral(1, 1, 0), true);

assert.equal(startThicknessFactor(0, 1, 0), 0);
assert.equal(startThicknessFactor(2, 1, 0), 2);
assert.equal(startThicknessFactor(0, 1, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(endThicknessFactor(1, 0, 0), 0);
assert.equal(endThicknessFactor(1, 2, 0), 2);
assert.equal(endThicknessFactor(1, 0, THICKNESS_TAPER_WINDOW_MS), 1);

assert.equal(speedThicknessFactor(1, 100, -200), 0);
assert.equal(speedThicknessFactor(1, 100, 200), 2);
assert.ok(speedThicknessFactor(0.25, 100, -200) < 1);
assert.ok(speedThicknessFactor(0.25, 100, 200) > 1);
assert.equal(thicknessDynamicsNeedsTailHoldback(1, 0), false);
assert.equal(thicknessDynamicsNeedsTailHoldback(0, 0), true);
assert.equal(thicknessDynamicsNeedsTailHoldback(1, 50), true);

const filteredSlow = filterStrokeSpeed(0, 0.5, 10, false);
const filteredFaster = filterStrokeSpeed(filteredSlow, 2, 10, true);
assert.equal(filteredSlow, 0.5);
assert.ok(filteredFaster > filteredSlow && filteredFaster < 2);

const slowTailLengthPx = 0.25 * THICKNESS_TAPER_WINDOW_MS;
const fastTailLengthPx = 2 * THICKNESS_TAPER_WINDOW_MS;
assert.equal(fastTailLengthPx / slowTailLengthPx, 8);

console.log("Thickness dynamics verification passed.");
