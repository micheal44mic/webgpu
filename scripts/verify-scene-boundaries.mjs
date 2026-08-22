import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  hitSceneTransformHandle,
  hitsSceneTransformBody,
  sceneLayerToLocal,
  sceneLocalToLayer,
  sceneRotationHandle,
  sceneTransformCorners,
} from "../src/scene-transform-geometry.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const stack = read("src/mixed-scene-stack.ts");
const controller = read("src/mixed-scene-controller.ts");
const controllerContract = read("src/mixed-scene-controller-contract.ts");
const nodeOwnership = read("src/mixed-scene-node.ts");
const gpuPaint = read("src/scene-gpu-paint.ts");
const interactionOverlay = read("src/scene-interaction-overlay.ts");
const engine = read("src/brush-engine.ts");
const main = read("src/main.ts");

for (const path of [
  "src/scene-text-model.ts",
  "src/scene-svg-model.ts",
  "src/scene-image-model.ts",
  "src/scene-vector-effects.ts",
  "src/scene-transform-geometry.ts",
  "src/mixed-scene-controller-contract.ts",
  "src/mixed-scene-node.ts",
  "src/scene-gpu-paint.ts",
  "src/scene-interaction-overlay.ts",
]) assert.equal(existsSync(new URL(path, root)), true, `${path} missing`);

assert.equal(existsSync(new URL("src/mixed-vector-text-controller.ts", root)), false);
assert.doesNotMatch(stack, /export interface (?:VectorTextNode|VectorSvgNode|RasterImageNode)/);
assert.match(stack, /from "\.\/scene-text-model\.ts"/);
assert.match(stack, /from "\.\/scene-svg-model\.ts"/);
assert.match(stack, /from "\.\/scene-image-model\.ts"/);
assert.match(controller, /class MixedSceneController/);
assert.match(controller, /from "\.\/scene-transform-geometry"/);
assert.match(controller, /from "\.\/mixed-scene-controller-contract"/);
assert.match(controller, /from "\.\/mixed-scene-node"/);
assert.match(controller, /from "\.\/scene-gpu-paint"/);
assert.match(controller, /from "\.\/scene-interaction-overlay"/);
assert.doesNotMatch(controller, /function pointInConvexPolygon|function pointToSegmentDistance/);
assert.doesNotMatch(
  controller,
  /export interface (?:MixedSceneHost|MixedSceneDiagnostics|MixedSceneControllerOptions)/,
);
assert.doesNotMatch(
  controller,
  /function (?:gpuLinearColor|svgGradientGpuData|renderDistortEditingOverlay)/,
);
assert.match(controllerContract, /export interface MixedSceneHost/);
assert.match(controllerContract, /export interface MixedSceneDiagnostics/);
assert.match(nodeOwnership, /export type TransformSceneNode/);
assert.match(nodeOwnership, /export function copyTransformNode/);
assert.match(gpuPaint, /export function gpuLinearColor/);
assert.match(gpuPaint, /export function svgGradientGpuData/);
assert.match(interactionOverlay, /export function renderSceneInteractionOverlay/);
assert.match(interactionOverlay, /export function sceneDistortCanvasPoints/);
assert.match(
  interactionOverlay,
  /SCENE_TRANSFORM_HANDLE_RADIUS_CSS_PX = 5/,
  "Transform handles must stay compact in CSS pixels.",
);
assert.match(
  interactionOverlay,
  /SCENE_BOUNDING_BOX_STROKE_STYLE = "#ff7a33"/,
  "Every scene bounding box must share the orange accent.",
);
assert.match(
  interactionOverlay,
  /SCENE_BOUNDING_BOX_HANDLE_FILL_STYLE = "#ffffff"/,
  "Every scene handle must keep its white fill.",
);
assert.match(
  interactionOverlay,
  /SCENE_BOUNDING_BOX_LINE_WIDTH_CSS_PX = 2/,
  "Bounding-box lines must remain slightly heavier than the old 1.25 px style.",
);
assert.match(
  interactionOverlay,
  /function renderSceneBoundingBoxHandle[\s\S]*?context\.arc\(/,
  "All transform, Distort, Warp and Perspective handles must use the shared circle renderer.",
);
assert.doesNotMatch(
  interactionOverlay,
  /context\.rect\(/,
  "Scene interaction handles must never fall back to square corners.",
);
assert.doesNotMatch(
  interactionOverlay,
  /#8d9aff|#ffb06f|#ff8b43|#4d83ff|#9aa6ff|rgba\(141, 154, 255/,
  "Legacy mode-specific bounding-box colors must not reappear.",
);
assert.match(engine, /readonly mixedSceneEnabled: boolean/);
assert.doesNotMatch(engine, /vectorTextPrototypeEnabled/);
assert.doesNotMatch(main, /vectorTextPrototype|MixedVectorText/);

const transform = { x: 30, y: -12, scale: 2.5, rotation: Math.PI / 5 };
const local = { x: 7, y: -4 };
const layer = sceneLocalToLayer(local, transform);
const roundTrip = sceneLayerToLocal(layer, transform);
assert.ok(Math.abs(roundTrip.x - local.x) < 1e-10);
assert.ok(Math.abs(roundTrip.y - local.y) < 1e-10);

const view = {
  centerX: 0,
  centerY: 0,
  zoom: 1,
  rotationCos: 1,
  rotationSin: 0,
  canvasWidth: 400,
  canvasHeight: 300,
  cssWidth: 400,
  cssHeight: 300,
};
const corners = sceneTransformCorners(
  { left: -10, top: -5, right: 10, bottom: 5 },
  { x: 0, y: 0, scale: 1, rotation: 0 },
  view,
);
assert.equal(hitsSceneTransformBody({ x: 200, y: 150 }, corners), true);
assert.equal(hitsSceneTransformBody({ x: 0, y: 0 }, corners), false);
const rotationHandle = sceneRotationHandle(
  corners,
  { x: 0, y: 0, scale: 1, rotation: 0 },
  view,
  38,
);
assert.equal(
  hitSceneTransformHandle(rotationHandle, corners, rotationHandle, 2),
  "rotate",
);

console.log("Scene boundaries: models, naming and transform geometry ownership verified.");
