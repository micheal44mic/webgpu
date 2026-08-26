import assert from "node:assert/strict";
import {
  addShapeCreationPointer,
  beginShapeCreation,
  currentShapeCreationDraft,
  endShapeCreationPointer,
  removeShapeCreationPointer,
  setShapeCreationConstraintRequested,
  updateShapeCreationPointer,
} from "../src/shape-creation-interaction-core.ts";

const input = (
  pointerId,
  pointerType,
  x,
  y,
  constrainAspect,
) => ({
  pointerId,
  pointerType,
  point: { x, y },
  ...(constrainAspect === undefined ? {} : { constrainAspect }),
});

// Mouse and pen always grow symmetrically from the initial center and can
// request 1:1 dynamically.
for (const pointerType of ["mouse", "pen"]) {
  let gesture = beginShapeCreation(
    "rectangle",
    input(1, pointerType, 10, 20, false),
  );
  gesture = updateShapeCreationPointer(
    gesture,
    input(1, pointerType, 90, 60, false),
  );
  assert.deepEqual(currentShapeCreationDraft(gesture), {
    kind: "rectangle",
    startPoint: { x: 10, y: 20 },
    rawEndPoint: { x: 90, y: 60 },
    endPoint: { x: 90, y: 60 },
    frame: { x: -70, y: -20, width: 160, height: 80 },
    signedHalfWidth: 80,
    signedHalfHeight: 40,
    aspectConstrained: false,
    constraintSource: "none",
  });

  gesture = setShapeCreationConstraintRequested(gesture, true);
  let draft = currentShapeCreationDraft(gesture);
  assert.deepEqual(draft.endPoint, { x: 90, y: 100 });
  assert.deepEqual(draft.frame, { x: -70, y: -60, width: 160, height: 160 });
  assert.equal(draft.constraintSource, "requested");

  gesture = updateShapeCreationPointer(
    gesture,
    input(1, pointerType, -20, -40, true),
  );
  draft = currentShapeCreationDraft(gesture);
  assert.deepEqual(draft.endPoint, { x: -50, y: -40 });
  assert.deepEqual(draft.frame, { x: -50, y: -40, width: 120, height: 120 });

  gesture = setShapeCreationConstraintRequested(gesture, false);
  draft = currentShapeCreationDraft(gesture);
  assert.deepEqual(draft.endPoint, { x: -20, y: -40 });
  assert.deepEqual(draft.frame, { x: -20, y: -40, width: 60, height: 120 });
}

// The first touch remains the sole drawing pointer. Any later touch is only a
// modifier, so its position cannot alter the origin, raw endpoint or size.
let touchGesture = beginShapeCreation(
  "ellipse",
  input(11, "touch", 100, 100),
);
touchGesture = updateShapeCreationPointer(
  touchGesture,
  input(11, "touch", 180, 140),
);
const freeEllipse = currentShapeCreationDraft(touchGesture);
assert.deepEqual(freeEllipse.frame, { x: 20, y: 60, width: 160, height: 80 });
assert.equal(freeEllipse.constraintSource, "none");

const rawBeforeModifier = freeEllipse.rawEndPoint;
touchGesture = addShapeCreationPointer(
  touchGesture,
  input(22, "touch", -5000, 9000),
);
let circle = currentShapeCreationDraft(touchGesture);
assert.deepEqual(circle.startPoint, { x: 100, y: 100 });
assert.deepEqual(circle.rawEndPoint, rawBeforeModifier);
assert.deepEqual(circle.frame, { x: 20, y: 20, width: 160, height: 160 });
assert.equal(circle.constraintSource, "multi-touch");

// Moving the modifier touch cannot drive the shape.
const unchangedByModifier = updateShapeCreationPointer(
  touchGesture,
  input(22, "touch", 5000, -9000),
);
assert.equal(unchangedByModifier, touchGesture);
assert.deepEqual(
  currentShapeCreationDraft(unchangedByModifier),
  circle,
);

// The drawing touch continues through all quadrants while constrained.
touchGesture = updateShapeCreationPointer(
  touchGesture,
  input(11, "touch", 160, 70),
);
circle = currentShapeCreationDraft(touchGesture);
assert.deepEqual(circle.endPoint, { x: 160, y: 40 });
assert.deepEqual(circle.frame, { x: 40, y: 40, width: 120, height: 120 });

// With three touches, lifting one modifier keeps the constraint until only the
// drawing touch remains.
touchGesture = addShapeCreationPointer(
  touchGesture,
  input(33, "touch", 0, 0),
);
touchGesture = removeShapeCreationPointer(touchGesture, 22);
assert.equal(currentShapeCreationDraft(touchGesture).constraintSource, "multi-touch");
const modifierEnd = endShapeCreationPointer(touchGesture, 33);
assert.equal(modifierEnd.primaryEnded, false);
assert.equal(modifierEnd.completedDraft, null);
touchGesture = modifierEnd.gesture;
assert.ok(touchGesture);

// Releasing the last modifier restores the live, unconstrained frame without
// restarting the gesture or replacing the drawing pointer.
const freeAgain = currentShapeCreationDraft(touchGesture);
assert.deepEqual(freeAgain.startPoint, { x: 100, y: 100 });
assert.deepEqual(freeAgain.rawEndPoint, { x: 160, y: 70 });
assert.deepEqual(freeAgain.endPoint, { x: 160, y: 70 });
assert.deepEqual(freeAgain.frame, { x: 40, y: 70, width: 120, height: 60 });
assert.equal(freeAgain.constraintSource, "none");

const touchCompletion = endShapeCreationPointer(touchGesture, 11);
assert.equal(touchCompletion.primaryEnded, true);
assert.equal(touchCompletion.gesture, null);
assert.deepEqual(touchCompletion.completedDraft, freeAgain);

// A canceled primary gesture produces no completed shape.
const canceled = endShapeCreationPointer(
  beginShapeCreation("rectangle", input(4, "touch", 0, 0)),
  4,
  false,
);
assert.equal(canceled.primaryEnded, true);
assert.equal(canceled.gesture, null);
assert.equal(canceled.completedDraft, null);

// Stars use an intrinsic 1:1 frame; a second touch does not change their
// aspect policy or raw drawing coordinates.
let starGesture = beginShapeCreation("star", input(8, "touch", 50, 50));
starGesture = updateShapeCreationPointer(
  starGesture,
  input(8, "touch", 90, 70),
);
const star = currentShapeCreationDraft(starGesture);
assert.equal(star.constraintSource, "shape");
assert.deepEqual(star.frame, { x: 10, y: 10, width: 80, height: 80 });
starGesture = addShapeCreationPointer(
  starGesture,
  input(9, "touch", 400, 400),
);
assert.deepEqual(currentShapeCreationDraft(starGesture), star);

console.log(
  "Shape creation interaction: fixed-center frames, stable multi-touch 1:1 constraint and reversible pointer ownership verified.",
);
