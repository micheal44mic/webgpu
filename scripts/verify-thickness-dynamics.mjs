import { readEditorHtml } from "./ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";
import {
  THICKNESS_TAPER_WINDOW_MS,
  endThicknessFactor,
  endThicknessRadius,
  quadraticEaseOut,
  startThicknessFactor,
  thicknessDynamicsIsNeutral,
  thicknessDynamicsNeedsTailHoldback,
} from "../src/thickness-dynamics.ts";

assert.equal(quadraticEaseOut(0), 0);
assert.equal(quadraticEaseOut(1), 1);
assert.equal(quadraticEaseOut(0.5), 0.75);

assert.equal(startThicknessFactor(1, 0), 1);
assert.equal(startThicknessFactor(1, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(endThicknessFactor(1, 1, 0), 1);
assert.equal(endThicknessFactor(1, 1, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(thicknessDynamicsIsNeutral(1, 1), true);

assert.equal(startThicknessFactor(0, 0), 0);
assert.equal(startThicknessFactor(2, 0), 2);
assert.equal(startThicknessFactor(0, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(startThicknessFactor(2, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(endThicknessFactor(1, 0, 0), 0);
assert.equal(endThicknessFactor(1, 2, 0), 2);
assert.equal(endThicknessFactor(1, 0, THICKNESS_TAPER_WINDOW_MS), 1);
assert.equal(endThicknessRadius(25, 1, 0, 0), 0);
assert.equal(endThicknessRadius(25, 1, 0, THICKNESS_TAPER_WINDOW_MS), 25);
assert.equal(endThicknessRadius(25, 1.5, 2, 0), 50);

assert.equal(thicknessDynamicsNeedsTailHoldback(1), false);
assert.equal(thicknessDynamicsNeedsTailHoldback(0), true);
assert.equal(thicknessDynamicsIsNeutral(0, 1), false);
assert.equal(thicknessDynamicsIsNeutral(1, 0), false);

const slowTailLengthPx = 0.25 * THICKNESS_TAPER_WINDOW_MS;
const fastTailLengthPx = 2 * THICKNESS_TAPER_WINDOW_MS;
assert.equal(fastTailLengthPx / slowTailLengthPx, 8);

const brushEngineSource = readEngineSource();
const shaderSource = readFileSync(new URL("../src/shaders.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const indexHtmlSource = readEditorHtml();
assert(brushEngineSource.includes('"predictive-webgpu-tail-overlay"'));
assert(brushEngineSource.includes("prepareThicknessTailFrame"));
assert(brushEngineSource.includes("encodeThicknessTailFrame"));
assert(!brushEngineSource.includes("queueHeldThicknessAdaptivePreview"));
assert(shaderSource.includes("export const thicknessTailDisplayShader"));
assert(shaderSource.includes("layerPosition - brush.renderTargetOrigin"));
assert(shaderSource.includes("input.position.xy + brush.renderTargetOrigin"));
assert(shaderSource.includes("transientPaint + permanentPaint * (1.0 - transientPaint.a)"));
assert(!brushEngineSource.includes("speedThickness"));
assert(!brushEngineSource.includes("filterStrokeSpeed"));
assert(!brushEngineSource.includes("speedThicknessFactor"));
assert(!indexHtmlSource.includes('id="speedThickness"'));
assert(!indexHtmlSource.includes('id="humanStrokeTestThicknessMode"'));
assert(!mainSource.includes('rangeValue("speedThickness")'));
assert(!mainSource.includes("testThicknessMode"));
assert(!brushEngineSource.includes("pressureSize"));
assert(!brushEngineSource.includes("pressureOpacity"));
assert(!mainSource.includes('rangeValue("pressureSize")'));
assert(!mainSource.includes('rangeValue("pressureOpacity")'));
assert(!indexHtmlSource.includes('id="pressureSize"'));
assert(!indexHtmlSource.includes('id="pressureOpacity"'));
assert(!shaderSource.includes("pressureAlpha"));
assert(!shaderSource.includes("pressureInfluence"));
assert(!shaderSource.includes("input.pressure"));

console.log("Thickness dynamics verification passed.");
