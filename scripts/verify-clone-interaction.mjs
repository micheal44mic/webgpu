import assert from "node:assert/strict";
import {
  CLONE_SOURCE_MOUSE_HIT_RADIUS_PX,
  CLONE_SOURCE_TOUCH_HIT_RADIUS_PX,
  DEFAULT_CLONE_ANGLE_DEGREES,
  DEFAULT_CLONE_ALIGNED,
  DEFAULT_CLONE_SAMPLE_MODE,
  cloneBeginSourceDrag,
  cloneBeginSourcePick,
  cloneBeginStroke,
  cloneCurrentStrokeSample,
  cloneClearHoverTarget,
  cloneDocumentPointToClient,
  cloneEndGesture,
  cloneHoverTarget,
  cloneSetAngle,
  cloneSetAligned,
  cloneSetSampleMode,
  cloneSetSourcePickArmed,
  cloneSetSourcePoint,
  cloneUpdateGesture,
  createCloneInteractionState,
  hitTestCloneSourceMarker,
  normalizeCloneSampleMode,
  normalizeCloneAngleDegrees,
} from "../src/clone-interaction-core.ts";

const point = (value) => value && {
  x: Number(value.x.toFixed(6)),
  y: Number(value.y.toFixed(6)),
};

let state = createCloneInteractionState();
assert.equal(state.sampleMode, DEFAULT_CLONE_SAMPLE_MODE);
assert.equal(state.sampleMode, "current-and-below");
assert.equal(state.aligned, DEFAULT_CLONE_ALIGNED);
assert.equal(state.aligned, false);
assert.equal(state.angleDegrees, DEFAULT_CLONE_ANGLE_DEGREES);
assert.equal(state.angleDegrees, 0);
assert.equal(state.sourcePoint, null);
assert.equal(state.markerPoint, null);
assert.equal(normalizeCloneSampleMode("all-visible"), "all-visible");
assert.equal(normalizeCloneSampleMode("invalid"), "current-and-below");
assert.equal(normalizeCloneAngleDegrees(Number.NaN), 0);
assert.equal(normalizeCloneAngleDegrees(-250), -180);
assert.equal(normalizeCloneAngleDegrees(250), 180);

state = cloneSetSampleMode(state, "all-visible");
assert.equal(state.sampleMode, "all-visible");
state = cloneSetSourcePickArmed(state, true);
assert.equal(state.sourcePickArmed, true);

// Source choice previews during the pointer and remains one-shot on commit.
state = cloneBeginSourcePick(state, { x: 100, y: 150 });
assert.equal(state.gesture?.kind, "source-pick");
state = cloneUpdateGesture(state, { x: 110, y: 160 });
assert.deepEqual(point(state.markerPoint), { x: 110, y: 160 });
const canceledPick = cloneEndGesture(state, false);
assert.equal(canceledPick.sourcePoint, null);
assert.equal(canceledPick.sourcePickArmed, true,
  "navigation cancellation must leave the explicit source mode ready for another tap");

state = cloneBeginSourcePick(canceledPick, { x: 100, y: 150 });
state = cloneEndGesture(state, true);
assert.deepEqual(point(state.sourcePoint), { x: 100, y: 150 });
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });
assert.equal(state.sourcePickArmed, false);

// The base mode keeps the source anchor persistent and restarts from it each stroke.
state = cloneBeginStroke(state, { x: 300, y: 350 });
assert.deepEqual(cloneCurrentStrokeSample(state), {
  targetPoint: { x: 300, y: 350 },
  samplePoint: { x: 100, y: 150 },
  sourceAnchorPoint: { x: 100, y: 150 },
  destinationAnchorPoint: { x: 300, y: 350 },
  angleDegrees: 0,
  offset: { x: -200, y: -200 },
});
state = cloneUpdateGesture(state, { x: 320, y: 390 });
assert.deepEqual(cloneCurrentStrokeSample(state), {
  targetPoint: { x: 320, y: 390 },
  samplePoint: { x: 120, y: 190 },
  sourceAnchorPoint: { x: 100, y: 150 },
  destinationAnchorPoint: { x: 300, y: 350 },
  angleDegrees: 0,
  offset: { x: -200, y: -200 },
});
state = cloneEndGesture(state, true);
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });
assert.equal(state.alignedOffset, null);
state = cloneBeginStroke(state, { x: 400, y: 500 });
assert.deepEqual(point(cloneCurrentStrokeSample(state)?.samplePoint), { x: 100, y: 150 },
  "every non-aligned stroke must restart at the persistent source anchor");
state = cloneEndGesture(state, true);

// Aligned remains optional and retains one affine mapping between strokes.
state = cloneSetAligned(state, true);
state = cloneBeginStroke(state, { x: 300, y: 350 });
state = cloneUpdateGesture(state, { x: 320, y: 390 });
state = cloneEndGesture(state, true);
assert.deepEqual(point(state.alignedOffset), { x: -200, y: -200 });
state = cloneHoverTarget(state, { x: 400, y: 500 });
assert.deepEqual(point(state.markerPoint), { x: 200, y: 300 },
  "Aligned hover must expose the retained mapping before the next stroke");
const clearedAlignedHover = cloneClearHoverTarget(state);
assert.equal(clearedAlignedHover.hoverTargetPoint, null);
assert.deepEqual(point(clearedAlignedHover.markerPoint), { x: 100, y: 150 });
state = cloneHoverTarget(clearedAlignedHover, { x: 400, y: 500 });
state = cloneBeginStroke(state, { x: 410, y: 510 });
assert.deepEqual(point(cloneCurrentStrokeSample(state)?.samplePoint), { x: 210, y: 310 },
  "Aligned strokes must retain the established offset");
const canceledStroke = cloneEndGesture(state, false);
assert.deepEqual(point(canceledStroke.alignedOffset), { x: -200, y: -200 });
assert.deepEqual(point(canceledStroke.markerPoint), { x: 200, y: 300 });

// Turning alignment off returns the idle marker to the anchor and resets each stroke.
state = cloneSetAligned(canceledStroke, false);
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });
assert.equal(state.alignedOffset, null,
  "turning Aligned off must not leave a mapping that can be resurrected later");
state = cloneBeginStroke(state, { x: 500, y: 600 });
state = cloneUpdateGesture(state, { x: 530, y: 650 });
assert.deepEqual(point(cloneCurrentStrokeSample(state)?.samplePoint), { x: 130, y: 200 });
state = cloneEndGesture(state, true);
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });
assert.equal(state.alignedOffset, null);

// Positive angles rotate the cloned appearance clockwise, so lookup moves in
// the inverse direction: target-right samples source-up at +90°.
state = cloneSetAngle(state, 90);
assert.equal(state.angleDegrees, 90);
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });
state = cloneBeginStroke(state, { x: 300, y: 350 });
assert.deepEqual(point(cloneCurrentStrokeSample(state)?.samplePoint), { x: 100, y: 150 });
state = cloneUpdateGesture(state, { x: 320, y: 350 });
assert.deepEqual(point(cloneCurrentStrokeSample(state)?.samplePoint), { x: 100, y: 130 });
assert.equal(cloneCurrentStrokeSample(state)?.angleDegrees, 90);
state = cloneEndGesture(state, true);
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });

// Changing the angle invalidates a retained aligned affine mapping and safely re-anchors.
state = cloneSetAligned(state, true);
state = cloneBeginStroke(state, { x: 300, y: 350 });
state = cloneEndGesture(state, true);
assert.notEqual(state.alignedOffset, null);
state = cloneSetAngle(state, -90);
assert.equal(state.alignedOffset, null);
assert.deepEqual(point(state.markerPoint), { x: 100, y: 150 });
state = cloneSetAligned(state, false);

// Dragging the marker is reversible and a committed move clears the old offset.
const beforeDrag = state;
state = cloneBeginSourceDrag(state, { x: 100, y: 150 });
state = cloneUpdateGesture(state, { x: 180, y: 220 });
state = cloneEndGesture(state, false);
assert.deepEqual(point(state.sourcePoint), point(beforeDrag.sourcePoint));
state = cloneBeginSourceDrag(state, { x: 100, y: 150 });
state = cloneUpdateGesture(state, { x: 180, y: 220 });
state = cloneEndGesture(state, true);
assert.deepEqual(point(state.sourcePoint), { x: 180, y: 220 });
assert.deepEqual(point(state.markerPoint), { x: 180, y: 220 });
assert.equal(state.alignedOffset, null);

state = cloneSetSourcePoint(state, null);
assert.equal(state.sourcePoint, null);
assert.equal(state.markerPoint, null);

assert.equal(CLONE_SOURCE_MOUSE_HIT_RADIUS_PX, 20);
assert.equal(CLONE_SOURCE_TOUCH_HIT_RADIUS_PX, 28);
assert.equal(hitTestCloneSourceMarker({ x: 50, y: 50 }, { x: 70, y: 50 }, "mouse"), true);
assert.equal(hitTestCloneSourceMarker({ x: 50, y: 50 }, { x: 70.01, y: 50 }, "mouse"), false);
assert.equal(hitTestCloneSourceMarker({ x: 50, y: 50 }, { x: 77.9, y: 50 }, "touch"), true);
assert.equal(hitTestCloneSourceMarker(null, { x: 50, y: 50 }, "touch"), false);

// Document-to-client mapping includes backing-store scale, zoom and rotation.
const rectangle = { left: 10, top: 20, width: 500, height: 400 };
assert.deepEqual(point(cloneDocumentPointToClient(
  { x: 200, y: 300 },
  {
    canvasWidth: 1000,
    canvasHeight: 800,
    centerX: 500,
    centerY: 400,
    zoom: 1,
    rotationCos: 1,
    rotationSin: 0,
  },
  rectangle,
)), { x: 110, y: 170 });
assert.deepEqual(point(cloneDocumentPointToClient(
  { x: 600, y: 400 },
  {
    canvasWidth: 1000,
    canvasHeight: 800,
    centerX: 500,
    centerY: 400,
    zoom: 2,
    rotationCos: 0,
    rotationSin: 1,
  },
  rectangle,
)), { x: 260, y: 320 });

console.log("Clone interaction: persistent source, angle, affine alignment, hit testing and view mapping verified.");
