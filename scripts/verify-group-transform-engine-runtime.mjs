import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const runtime = read("src/engine-mixed-scene-group-transform-runtime.ts");
const rasterRuntime = read("src/engine-raster-transform-runtime.ts");
const engine = read("src/brush-engine.ts");

assert.match(
  engine,
  /activeMixedSceneGroupTransformSession: ActiveMixedSceneGroupTransformSession \| null = null/,
  "BrushEngine must own one explicit group transaction.",
);
assert.match(
  runtime,
  /beginMixedSceneGroupTransform[\s\S]*?forceWholeLayer|beginMixedSceneGroupTransform[\s\S]*?setMixedSceneRasterTransformPreview/,
);
assert.match(
  runtime,
  /rasters\.length \+ semantics\.length !== uniqueKeys\.length/,
  "The engine must reject a group when any exact selected key cannot participate.",
);
assert.match(
  runtime,
  /updateMixedSceneGroupTransform[\s\S]*?scene\.updateText[\s\S]*?scene\.updateSvg[\s\S]*?updateMixedSceneRasterTransformPreview/,
  "Live updates must batch semantic mutations and use the uniform-only raster preview.",
);
assert.match(
  runtime,
  /commitMixedSceneGroupTransform[\s\S]*?clearMixedSceneRasterTransformPreview[\s\S]*?forceWholeLayer: true[\s\S]*?materializeRasterLayerTransformHistoryAction[\s\S]*?recordMixedSceneGroupTransformHistoryAction/,
  "Apply must materialize whole rasters before publishing one compound action.",
);
assert.match(
  runtime,
  /an unchanged group legitimately produces no history action\.[\s\S]*?return true;/,
  "Apply without changes must still acknowledge and close the open session.",
);
assert.equal(
  (runtime.match(/recordMixedSceneGroupTransformHistoryAction\(/g) ?? []).length,
  1,
  "The group runtime may expose only one history publication point.",
);
assert.match(
  runtime,
  /restoreMaterializedRasters[\s\S]*?rebuildActiveLayerFromHistory/,
  "Unpublished raster mutations must roll back through the previous history cursor.",
);
assert.match(
  runtime,
  /destroyUnpublishedRasterActions[\s\S]*?destroyLayerColdStorage/,
  "Failed compound commits must release every unpublished raster seed.",
);
assert.match(
  runtime,
  /cancelMixedSceneGroupTransform[\s\S]*?restoreSemanticMembers[\s\S]*?clearMixedSceneRasterTransformPreview/,
  "Cancel must restore semantic state and remove the raster preview.",
);
assert.match(
  rasterRuntime,
  /materializeRasterLayerTransformHistoryAction[\s\S]*?scope !== "layer"[\s\S]*?return session\.samplingBounds && seed/,
  "The nested raster checkpoint API must reject Pixel Selection and return an owned seed.",
);

console.log("Group Transform engine lifecycle and rollback verification passed.");
