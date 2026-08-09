import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DESTRUCTIVE_MOTION_BLUR_CORE_BUILD,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
  destructiveMotionBlurBounds,
  destructiveMotionBlurKernel,
  destructiveMotionBlurMaximumBounds,
  normalizeDestructiveMotionBlurAngle,
  normalizeDestructiveMotionBlurDistance,
  unionMotionBlurRects,
} from "../src/motion-blur-core.ts";

assert.equal(
  DESTRUCTIVE_MOTION_BLUR_CORE_BUILD,
  "destructive-motion-blur-core-v1-centered-power-of-two-exposures",
);
assert.equal(DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE, 500);
assert.equal(
  normalizeDestructiveMotionBlurDistance(Number.NaN),
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
);
assert.equal(normalizeDestructiveMotionBlurDistance(-10), 0);
assert.equal(normalizeDestructiveMotionBlurDistance(900), 500);
assert.equal(
  normalizeDestructiveMotionBlurAngle(Number.NaN),
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
);
assert.equal(normalizeDestructiveMotionBlurAngle(-900), -180);
assert.equal(normalizeDestructiveMotionBlurAngle(900), 180);

for (const [distance, samples, passes] of [
  [0, 1, 0],
  [1, 2, 1],
  [20, 32, 5],
  [100, 128, 7],
  [500, 512, 9],
]) {
  const kernel = destructiveMotionBlurKernel(distance, 0);
  assert.equal(kernel.sampleCount, samples);
  assert.equal(kernel.passCount, passes);
  assert.equal(kernel.shifts.length, passes);
  assert((kernel.sampleCount & (kernel.sampleCount - 1)) === 0);
  if (distance > 0) {
    assert(kernel.sampleSpacing <= 1);
    const totalPositiveShift = kernel.shifts.reduce((sum, shift) => sum + shift.x, 0);
    assert(Math.abs(totalPositiveShift - distance / 2) < 1e-9);
  }
}

const vertical = destructiveMotionBlurKernel(20, 90);
assert(Math.abs(vertical.directionX) < 1e-12);
assert(Math.abs(vertical.directionY + 1) < 1e-12);
assert.equal(vertical.supportX, 0);
assert(vertical.supportY >= 10);

const horizontal20 = destructiveMotionBlurKernel(20, 0);
assert.deepEqual(
  destructiveMotionBlurBounds(
    { x: 20, y: 30, width: 40, height: 50 },
    20,
    0,
    100,
    100,
  ),
  {
    x: 20 - horizontal20.supportX,
    y: 30,
    width: 40 + horizontal20.supportX * 2,
    height: 50,
  },
);
const maximumBounds = destructiveMotionBlurMaximumBounds(
  { x: 300, y: 300, width: 100, height: 100 },
  1000,
  1000,
);
assert(maximumBounds);
assert(maximumBounds.x <= 41 && maximumBounds.y <= 41);
assert(maximumBounds.width >= 618 && maximumBounds.height >= 618);
assert.deepEqual(
  unionMotionBlurRects(
    { x: 4, y: 8, width: 10, height: 12 },
    { x: 1, y: 9, width: 8, height: 20 },
  ),
  { x: 1, y: 8, width: 13, height: 21 },
);

const runtime = readFileSync(
  new URL("../src/engine-motion-blur-runtime.ts", import.meta.url),
  "utf8",
);
const engine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const history = readFileSync(
  new URL("../src/engine-history-types.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

assert.match(runtime, /format:\s*"rgba16float"/);
assert.match(runtime, /texture_2d<f32>/);
assert.match(runtime, /return \([\s\S]*\) \* 0\.5;/);
assert.match(runtime, /sampleInputLinear/);
assert.match(runtime, /immutable source/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /session\.previewFault/);
assert.doesNotMatch(runtime, /rgba8|unorm8|pack4x8|unpack4x8/i);

const restore = runtime.slice(
  runtime.indexOf("async function restoreOriginalPixels("),
  runtime.indexOf("export async function beginRasterMotionBlur("),
);
assert.match(restore, /copyTextureToTexture/);
assert.match(restore, /session\.sourceTexture/);
assert.doesNotMatch(restore, /flushPreview/);

const commit = runtime.slice(runtime.indexOf("export async function commitRasterMotionBlur("));
assert.match(commit, /kind:\s*"raster-filter"/);
assert.match(commit, /filter:\s*"motion-blur"/);
assert.match(commit, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(commit, /createLayerColdStorageCandidate\([\s\S]{0,260}"history"/);
assert.match(commit, /precision:\s*"rgba16float-f32-accumulation"/);
assert.match(history, /filter:\s*"motion-blur"/);
assert.match(engine, /activeRasterMotionBlurSession/);
assert.match(engine, /beginRasterMotionBlur/);
assert.match(main, /engine\.beginRasterMotionBlur/);
assert.match(main, /engine\.updateRasterMotionBlur/);
assert.match(main, /engine\.commitRasterMotionBlur/);
assert.match(main, /engine\.cancelRasterMotionBlur/);
assert.match(main, /historyState\.openEdit === "motion-blur"/);
assert.match(main, /blurTouchNavigationRequested/);

console.log("Destructive 16-bit Motion Blur verification passed.");
