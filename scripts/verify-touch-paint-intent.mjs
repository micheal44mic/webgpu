import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TOUCH_PAINT_INTENT_HOLD_MS,
  TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
  TOUCH_PAINT_INTENT_STRATEGY,
  shouldHoldTouchPaintIntent,
  touchPaintIntentMovementReached,
} from "../src/touch-paint-intent-core.ts";

const root = new URL("../", import.meta.url);
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");

assert.equal(
  TOUCH_PAINT_INTENT_STRATEGY,
  "touch-paint-input-buffer-move-3-css-px-timeout-28ms-v1",
);
assert.equal(TOUCH_PAINT_INTENT_HOLD_MS, 28);
assert.equal(TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX, 3);

assert.equal(shouldHoldTouchPaintIntent(true, "touch", "paint"), true);
for (const [enabled, pointerType, tool] of [
  [false, "touch", "paint"],
  [true, "pen", "paint"],
  [true, "mouse", "paint"],
  [true, "touch", "blend"],
]) {
  assert.equal(
    shouldHoldTouchPaintIntent(enabled, pointerType, tool),
    false,
    `${pointerType}/${tool}/${enabled} must retain the immediate path`,
  );
}

const start = { clientX: 100, clientY: 200 };
assert.equal(touchPaintIntentMovementReached(start, []), false);
assert.equal(
  touchPaintIntentMovementReached(start, [{ clientX: 102.99, clientY: 200 }]),
  false,
  "sub-threshold motion must keep the pinch decision cancellable",
);
assert.equal(
  touchPaintIntentMovementReached(start, [{ clientX: 103, clientY: 200 }]),
  true,
  "the exact 3 px threshold must release drawing",
);
assert.equal(
  touchPaintIntentMovementReached(start, [{ clientX: 101.8, clientY: 202.4 }]),
  true,
  "diagonal distance must use Euclidean CSS pixels",
);
assert.equal(
  touchPaintIntentMovementReached(start, [
    { clientX: 100.5, clientY: 200.5 },
    { clientX: 104, clientY: 200 },
  ]),
  true,
  "any coalesced sample crossing the threshold must release the ordered batch",
);

assert.match(
  mainSource,
  /const touchPaintIntentHoldEnabled = pageSearchParams\.get\("touchPaintIntentHold"\) !== "0"/,
  "the isolated experiment needs a production A/B escape hatch",
);
assert.match(
  mainSource,
  /const holdPaintIntent = paintSample !== null && shouldHoldTouchPaintIntent\([\s\S]*?event\.pointerType,[\s\S]*?activeCanvasTool,[\s\S]*?\);[\s\S]*?if \(paintSample && !holdPaintIntent\) \{[\s\S]*?if \(!engine\.beginStroke\(paintSample\)\)[\s\S]*?if \(paintSample && holdPaintIntent\) \{[\s\S]*?startTouchPaintIntentHold\(event\.pointerId, paintSample\);/,
  "only eligible touch Paint input may leave the immediate, acknowledged beginStroke path",
);
assert.match(
  mainSource,
  /if \(!engine\.beginStroke\(hold\.initialSample\)\) \{[\s\S]*?return false;\s*\}[\s\S]*?if \(hold\.bufferedSamples\.length > 0\) \{\s*engine\.extendStroke\(hold\.bufferedSamples\);/,
  "release must acknowledge begin before replaying original timestamped samples in order",
);
assert.match(
  mainSource,
  /const canceledHeldIntent = cancelTouchPaintIntentHold\("navigation"\);\s*if \(!canceledHeldIntent && !engine\.cancelStrokeBeforeRender\(\)\)/,
  "a second finger must discard the held input before touching BrushEngine",
);
assert.match(
  mainSource,
  /heldIntent\.bufferedSamples\.push\(\.\.\.samples\);[\s\S]*?touchPaintIntentMovementReached\(heldIntent\.initialSample, samples\)[\s\S]*?releaseTouchPaintIntentHold\("movement"\);[\s\S]*?return;/,
  "movement release must consume the buffered samples once and skip duplicate extension",
);
assert.match(
  mainSource,
  /event\.type === "pointerup"\) \{\s*releaseTouchPaintIntentHold\("pointer-up"\);\s*\} else \{\s*cancelTouchPaintIntentHold\("pointer-end"\);/,
  "a tap must commit at lift while cancellation/lost capture stays side-effect free",
);
assert.equal(
  (mainSource.match(/performanceTelemetryRevision: 64/g) ?? []).length,
  2,
  "the pointer arbitration contract must be signed by telemetry revision 64",
);
assert.match(mainSource, /touchPaintIntentCanceledForNavigation/);
assert.match(mainSource, /touchPaintIntentMaximumBufferedSamples/);

console.log("Touch Paint intent hold: eligibility, thresholds, replay order and pinch cancellation verified.");
