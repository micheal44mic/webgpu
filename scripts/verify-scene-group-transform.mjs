import assert from "node:assert/strict";
import { sceneLocalToLayer } from "../src/scene-transform-geometry.ts";
import {
  sceneSideScaleUpdate,
  transformSceneGroupMember,
} from "../src/scene-group-transform.ts";

const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);
};

const base = {
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
};
const current = {
  x: 5,
  y: 7,
  scale: 2,
  scaleX: 2,
  scaleY: 0.5,
  rotation: Math.PI / 2,
};
const left = transformSceneGroupMember(base, current, {
  ...base,
  x: -10,
  scale: 0.75,
  scaleX: 0.75,
  scaleY: 1.25,
  rotation: 0.25,
});
close(left.x, 5, "group rotation x");
close(left.y, -13, "group rotation y");
close(left.scaleX, 1.5, "member horizontal scale");
close(left.scaleY, 0.625, "member vertical scale");
close(left.rotation, 0.25 + Math.PI / 2, "member rotation");

const bounds = { left: -50, top: -50, right: 50, bottom: 50 };
const east = sceneSideScaleUpdate({
  start: base,
  bounds,
  handle: "east",
  pointer: { x: 100, y: 0 },
  minimumScale: 0.05,
  maximumScale: 20,
});
assert.ok(east);
close(east.scaleX, 1.5, "east handle scale");
close(east.scaleY, 1, "east handle preserves vertical scale");
close(east.x + bounds.left * east.scaleX, -50, "east handle pins west edge");
close(east.x + bounds.right * east.scaleX, 100, "east handle follows pointer");

const rotatedStart = { ...base, rotation: Math.PI / 2 };
const northPointer = sceneLocalToLayer({ x: 0, y: -100 }, rotatedStart);
const north = sceneSideScaleUpdate({
  start: rotatedStart,
  bounds,
  handle: "north",
  pointer: northPointer,
  minimumScale: 0.05,
  maximumScale: 20,
});
assert.ok(north);
close(north.scaleX, 1, "north handle preserves horizontal scale");
close(north.scaleY, 1.5, "north handle scale");
const fixedBefore = sceneLocalToLayer({ x: 0, y: bounds.bottom }, rotatedStart);
const fixedAfter = sceneLocalToLayer({ x: 0, y: bounds.bottom }, north);
close(fixedAfter.x, fixedBefore.x, "rotated north handle pins opposite x");
close(fixedAfter.y, fixedBefore.y, "rotated north handle pins opposite y");

const clamped = sceneSideScaleUpdate({
  start: base,
  bounds,
  handle: "west",
  pointer: { x: 80, y: 0 },
  minimumScale: 0.05,
  maximumScale: 20,
});
assert.ok(clamped);
close(clamped.scaleX, 0.05, "side resize does not flip through the opposite edge");

const asymmetricBounds = { left: -20, top: -35, right: 80, bottom: 65 };
const centeredStart = {
  ...base,
  x: 12,
  y: -8,
  scale: 1.25,
  scaleX: 1.25,
  scaleY: 0.75,
  rotation: 0.4,
};
const boundsCenter = {
  x: (asymmetricBounds.left + asymmetricBounds.right) * 0.5,
  y: (asymmetricBounds.top + asymmetricBounds.bottom) * 0.5,
};
const centeredPointer = sceneLocalToLayer({
  x: boundsCenter.x + (asymmetricBounds.right - boundsCenter.x) * 2,
  y: boundsCenter.y,
}, centeredStart);
const centeredEast = sceneSideScaleUpdate({
  start: centeredStart,
  bounds: asymmetricBounds,
  handle: "east",
  pointer: centeredPointer,
  minimumScale: 0.05,
  maximumScale: 20,
  centered: true,
});
assert.ok(centeredEast);
close(centeredEast.scaleX, 2.5, "centered east handle scale");
close(centeredEast.scaleY, 0.75, "centered resize preserves the other axis");
const centerBefore = sceneLocalToLayer(boundsCenter, centeredStart);
const centerAfter = sceneLocalToLayer(boundsCenter, centeredEast);
close(centerAfter.x, centerBefore.x, "centered resize keeps rotated center x");
close(centerAfter.y, centerBefore.y, "centered resize keeps rotated center y");
const eastAfter = sceneLocalToLayer({
  x: asymmetricBounds.right,
  y: boundsCenter.y,
}, centeredEast);
close(eastAfter.x, centeredPointer.x, "centered east side follows pointer x");
close(eastAfter.y, centeredPointer.y, "centered east side follows pointer y");
const westBefore = sceneLocalToLayer({
  x: asymmetricBounds.left,
  y: boundsCenter.y,
}, centeredStart);
const westAfter = sceneLocalToLayer({
  x: asymmetricBounds.left,
  y: boundsCenter.y,
}, centeredEast);
const eastBefore = sceneLocalToLayer({
  x: asymmetricBounds.right,
  y: boundsCenter.y,
}, centeredStart);
close(
  Math.hypot(westAfter.x - westBefore.x, westAfter.y - westBefore.y),
  Math.hypot(eastAfter.x - eastBefore.x, eastAfter.y - eastBefore.y),
  "centered resize moves opposite sides by the same distance",
);

console.log("Scene group Transform verification passed.");
