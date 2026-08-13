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
const canvasInputSource = readFileSync(
  new URL("src/canvas-input-controller.ts", root),
  "utf8",
);
const humanLabSource = readFileSync(
  new URL("src/labs/human-stroke-lab.ts", root),
  "utf8",
);

assert.equal(
  TOUCH_PAINT_INTENT_STRATEGY,
  "touch-paint-input-buffer-move-3-css-px-timeout-28ms-v1",
);
assert.equal(TOUCH_PAINT_INTENT_HOLD_MS, 28);
assert.equal(TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX, 3);

assert.equal(shouldHoldTouchPaintIntent(true, "touch", true), true);
for (const [enabled, pointerType, eligible] of [
  [false, "touch", true],
  [true, "pen", true],
  [true, "mouse", true],
  [true, "touch", false],
]) {
  assert.equal(
    shouldHoldTouchPaintIntent(enabled, pointerType, eligible),
    false,
    `${pointerType}/${eligible}/${enabled} must retain the immediate path`,
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
  canvasInputSource,
  /const holdPaintIntent = paintSample !== null && shouldHoldTouchPaintIntent\([\s\S]*?event\.pointerType,[\s\S]*?toolCapabilities\.holdsTouchPaintIntent,[\s\S]*?\);[\s\S]*?if \(paintSample && rasterStrokeOperation && !holdPaintIntent\)[\s\S]*?engine\.beginStroke\(paintSample, rasterStrokeOperation\)[\s\S]*?pointerMode === "raster-stroke"[\s\S]*?startTouchPaintIntentHold\([\s\S]*?rasterStrokeOperation,[\s\S]*?toolCapabilities\.recordsPaintExtension,/,
  "only eligible touch Paint/Eraser input may leave the acknowledged beginStroke path",
);
assert.match(
  canvasInputSource,
  /if \(!engine\.beginStroke\(hold\.initialSample, hold\.operation\)\) \{[\s\S]*?return false;\s*\}[\s\S]*?if \(hold\.bufferedSamples\.length > 0\)\s*engine\.extendStroke\(hold\.bufferedSamples\);/,
  "release must acknowledge begin before replaying original timestamped samples in order",
);
assert.match(
  canvasInputSource,
  /const canceledHeldIntent = cancelTouchPaintIntentHold\("navigation"\);\s*if \(!canceledHeldIntent && !engine\.cancelStrokeBeforeRender\(\)\)/,
  "a second finger must discard the held input before touching BrushEngine",
);
assert.match(
  canvasInputSource,
  /heldIntent\.bufferedSamples\.push\(\.\.\.samples\);[\s\S]*?touchPaintIntentMovementReached\(heldIntent\.initialSample, samples\)[\s\S]*?releaseTouchPaintIntentHold\("movement"\);[\s\S]*?return;/,
  "movement release must consume the buffered samples once and skip duplicate extension",
);
assert.match(
  canvasInputSource,
  /if \(event\.type === "pointerup"\) releaseTouchPaintIntentHold\("pointer-up"\);\s*else cancelTouchPaintIntentHold\("pointer-end"\);/,
  "a tap must commit at lift while cancellation/lost capture stays side-effect free",
);
assert.match(
  humanLabSource,
  /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 64/,
  "the persisted lab telemetry contract must retain revision 64",
);
assert.match(canvasInputSource, /touchPaintIntentCanceledForNavigation/);
assert.match(canvasInputSource, /touchPaintIntentMaximumBufferedSamples/);
assert.match(
  mainSource,
  /collectInputDiagnostics\(\)[\s\S]*?canvasInputController\?\.diagnostics\(\)/,
  "main must only configure and expose diagnostics from the input owner",
);
assert.match(
  mainSource,
  /canvasInputController = new CanvasInputController\(\{[\s\S]*?touchPaintIntentHoldEnabled,/,
);
assert.doesNotMatch(mainSource, /touchPaintIntentDiagnostics/);

console.log("Touch raster intent hold: Paint/Eraser eligibility, replay order and pinch cancellation verified.");
