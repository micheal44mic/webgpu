import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MixedSceneStack } from "../src/mixed-scene-stack.ts";
import {
  MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES,
  mixedSceneRasterPreviewInverseAffine,
  mixedSceneRasterSegmentUniformValues,
  normalizeMixedSceneRasterTransformPreview,
} from "../src/mixed-scene-raster-transform-preview.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const runtimeSource = read("src/engine-mixed-scene-raster-preview-runtime.ts");
const compositorSource = read("src/mixed-scene-compositor-shader.ts");
const engineSource = read("src/brush-engine.ts");
const resourceSetupSource = read("src/engine-runtime-misc.ts");

const transform = normalizeMixedSceneRasterTransformPreview({
  key: "raster:7",
  pivotX: 120,
  pivotY: 80,
  translationX: 35,
  translationY: -12,
  scaleX: 1.7,
  scaleY: 0.65,
  rotation: Math.PI / 5,
});
assert.equal(transform.rasterLayerId, 7);
const inverse = mixedSceneRasterPreviewInverseAffine(transform);
const source = { x: 166, y: 43 };
const dx = source.x - transform.pivotX;
const dy = source.y - transform.pivotY;
const cosine = Math.cos(transform.rotation);
const sine = Math.sin(transform.rotation);
const destination = {
  x: transform.pivotX + transform.translationX
    + cosine * transform.scaleX * dx
    - sine * transform.scaleY * dy,
  y: transform.pivotY + transform.translationY
    + sine * transform.scaleX * dx
    + cosine * transform.scaleY * dy,
};
assert.ok(Math.abs(inverse[0] * destination.x + inverse[1] * destination.y + inverse[2] - source.x) < 1e-9);
assert.ok(Math.abs(inverse[3] * destination.x + inverse[4] * destination.y + inverse[5] - source.y) < 1e-9);

const uniform = mixedSceneRasterSegmentUniformValues({
  bounds: { x: 64, y: 32, width: 128, height: 96 },
  resolutionScale: 1,
}, 0.75, transform);
assert.equal(uniform.byteLength, MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES);
assert.equal(uniform.length, 12);
assert.deepEqual([...uniform.slice(0, 4)], [64, 32, 1, 0.75]);
assert.ok(Math.abs(uniform[7] - 1 / Math.abs(transform.scaleY)) < 1e-6);
assert.throws(
  () => normalizeMixedSceneRasterTransformPreview({ ...transform, scaleY: 0 }),
  /invertible/,
);

const stack = new MixedSceneStack([1, 2, 3]);
stack.setClippingEnabled("raster:2", true);
assert.deepEqual(
  stack.compositionSegments(1, [1, 2], null, [2]).map((segment) => segment.key),
  [
    "active-raster:1",
    "raster-run:2@scene-clipping-source",
    "raster-run:3",
  ],
  "isolating one clipping child must preserve the active base in its exact slot",
);
assert.deepEqual(
  stack.compositionSegments(1, [1, 2], null, [1]).map((segment) => segment.key),
  [
    "raster-run:1@scene-clipping-source",
    "raster-run:2@scene-clipping-source",
    "raster-run:3",
  ],
  "isolating the active base must publish it as an immutable raster segment",
);
assert.deepEqual(
  stack.compositionSegments(1, [1, 2], null, [2, 3]).map((segment) => segment.key),
  [
    "active-raster:1",
    "raster-run:2@scene-clipping-source",
    "raster-run:3",
  ],
  "non-adjacent selected rasters must remain separate and ordered",
);

assert.match(runtimeSource, /nextSignature === state\.preparedSignature[\s\S]*?writePreparedPreviewUniforms/);
assert.match(runtimeSource, /while \(state\.preparedSignature !== state\.requestedSignature\)[\s\S]*?rebuildMergedLayerSurfaces/);
const hotUpdateStart = runtimeSource.indexOf("export function updateMixedSceneRasterTransformPreview");
const hotUpdateEnd = runtimeSource.indexOf("/** IDs used", hotUpdateStart);
const hotUpdateSource = runtimeSource.slice(hotUpdateStart, hotUpdateEnd);
assert.match(hotUpdateSource, /writePreparedPreviewUniforms/);
assert.doesNotMatch(hotUpdateSource, /rebuildMergedLayerSurfaces|await /);
assert.match(runtimeSource, /documentCutoutBaseUniformBuffer[\s\S]*?documentCutoutMaskUniformBuffer/);
assert.match(compositorSource, /sourceLayerPosition[\s\S]*?inverseRowX[\s\S]*?inverseRowY/);
assert.match(resourceSetupSource, /minBindingSize: MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES/);
assert.match(engineSource, /compositionSegments\([\s\S]*?mixedSceneRasterTransformPreviewCompositionLayerIds/);

console.log("Mixed-scene raster transform preview verification passed.");
