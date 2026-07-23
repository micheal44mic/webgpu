import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessFactor,
  endThicknessRadius,
  filterStrokeSpeed,
  quadraticEaseOut,
  speedThicknessFactor,
  startThicknessFactor,
  thicknessDynamicsIsNeutral,
  thicknessDynamicsNeedsTailHoldback,
} from "../src/thickness-dynamics.ts";
import {
  humanStrokeTestThicknessLabel,
  humanStrokeTestThicknessSettings,
} from "../src/human-stroke-test.ts";

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
assert.equal(endThicknessRadius(25, 1, 0, 0), 0);
assert.equal(endThicknessRadius(25, 1, 0, THICKNESS_TAPER_WINDOW_MS), 25);
assert.equal(endThicknessRadius(25, 1.5, 2, 0), 50);

assert.equal(speedThicknessFactor(1, 100, -200), 0);
assert.equal(speedThicknessFactor(1, 100, 200), 2);
assert.ok(speedThicknessFactor(0.25, 100, -200) < 1);
assert.ok(speedThicknessFactor(0.25, 100, 200) > 1);
assert.equal(thicknessDynamicsNeedsTailHoldback(1, 0), false);
assert.equal(thicknessDynamicsNeedsTailHoldback(0, 0), true);
assert.equal(thicknessDynamicsNeedsTailHoldback(1, 50), true);

assert.deepEqual(humanStrokeTestThicknessSettings("standard"), {
  startThickness: 1,
  endThickness: 1,
  speedThickness: 0,
});
assert.deepEqual(humanStrokeTestThicknessSettings("taper-0-0-speed100"), {
  startThickness: 0,
  endThickness: 0,
  speedThickness: 100,
});
assert.equal(humanStrokeTestThicknessLabel("standard"), "Spessore 100/100/0");
assert.equal(
  humanStrokeTestThicknessLabel("taper-0-0-speed100"),
  "Coda 0/0/+100",
);

const filteredSlow = filterStrokeSpeed(0, 0.5, 10, false);
const filteredFaster = filterStrokeSpeed(filteredSlow, 2, 10, true);
assert.equal(filteredSlow, 0.5);
assert.ok(filteredFaster > filteredSlow && filteredFaster < 2);

const slowTailLengthPx = 0.25 * THICKNESS_TAPER_WINDOW_MS;
const fastTailLengthPx = 2 * THICKNESS_TAPER_WINDOW_MS;
assert.equal(fastTailLengthPx / slowTailLengthPx, 8);

const brushEngineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const shaderSource = readFileSync(new URL("../src/shaders.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const indexHtmlSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert(brushEngineSource.includes('"predictive-webgpu-tail-overlay"'));
assert(brushEngineSource.includes("prepareThicknessTailFrame"));
assert(brushEngineSource.includes("encodeThicknessTailFrame"));
assert(!brushEngineSource.includes("queueHeldThicknessAdaptivePreview"));
assert(shaderSource.includes("export const thicknessTailDisplayShader"));
assert(shaderSource.includes("layerPosition - brush.renderTargetOrigin"));
assert(shaderSource.includes("input.position.xy + brush.renderTargetOrigin"));
assert(shaderSource.includes("transientPaint + permanentPaint * (1.0 - transientPaint.a)"));
assert(mainSource.includes("testThicknessMode: HumanStrokeTestThicknessMode"));
assert(mainSource.includes("humanStrokeTestThicknessModeSelect.disabled = operationLocked"));
assert(mainSource.includes("testThicknessMode,"));
assert(indexHtmlSource.includes('id="humanStrokeTestThicknessMode"'));
assert(indexHtmlSource.includes('value="standard"'));
assert(indexHtmlSource.includes('value="taper-0-0-speed100"'));

console.log("Thickness dynamics verification passed.");
