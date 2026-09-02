import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const runtime = read("src/engine-mixed-scene-group-transform-runtime.ts");
const rasterRuntime = read("src/engine-raster-transform-runtime.ts");
const engine = read("src/brush-engine.ts");
const historyRuntime = read("src/engine-history-runtime.ts");
const gpuLab = read("src/labs/gpu/group-transform-gpu-test.ts");
const editorLabs = read("src/labs/editor-labs.ts");

assert.match(
  engine,
  /activeMixedSceneGroupTransformSession: ActiveMixedSceneGroupTransformSession \| null = null/,
  "BrushEngine must own one explicit group transaction.",
);
assert.match(
  runtime,
  /beginMixedSceneGroupTransform[\s\S]*?await engine\.setMixedSceneRasterTransformPreview\(/,
  "Group Transform must finish preparing its raster preview before becoming interactive.",
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
  /commitMixedSceneGroupTransform[\s\S]*?beginPresentationTransaction[\s\S]*?clearMixedSceneRasterTransformPreview[\s\S]*?forceWholeLayer: true[\s\S]*?materializeRasterLayerTransformHistoryAction[\s\S]*?recordMixedSceneGroupTransformHistoryAction[\s\S]*?endPresentationTransaction/,
  "Apply must keep every intermediate cache behind one presentation transaction.",
);
assert.match(
  runtime,
  /cancelMixedSceneGroupTransform[\s\S]*?beginPresentationTransaction[\s\S]*?restoreSemanticMembers[\s\S]*?clearMixedSceneRasterTransformPreview[\s\S]*?endPresentationTransaction/,
  "Cancel must not expose a mixed semantic/raster rollback frame.",
);
assert.match(
  engine,
  /presentationTransactionDepth = 0[\s\S]*?beginPresentationTransaction\(\)[\s\S]*?await this\.waitForIdle\(\)[\s\S]*?presentationTransactionDepth \+= 1[\s\S]*?endPresentationTransaction\(\)[\s\S]*?presentationTransactionDepth -= 1[\s\S]*?this\.requestRender\(\)/,
  "The presentation transaction must drain the live frame, retain independent ownership, and publish once.",
);
assert.match(
  engine,
  /submitImmediate\([\s\S]*?present = present && !this\.presentationBlocked\(\)/,
  "Direct GPU submissions must not bypass the presentation transaction.",
);
assert.match(
  historyRuntime,
  /applyMixedSceneGroupTransformHistory[\s\S]*?beginPresentationTransaction[\s\S]*?replayGroupRasterMembers[\s\S]*?applyGroupVectorHistoryStates[\s\S]*?endPresentationTransaction/,
  "Group Transform Undo and Redo must use the same atomic presentation handoff.",
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

for (const scenario of [
  "two-uniform-shrink",
  "three-independent-axes",
  "three-rotation",
  "five-combined-affine",
]) {
  assert.ok(gpuLab.includes(scenario), `The GPU regression matrix is missing ${scenario}.`);
}
assert.match(
  gpuLab,
  /sourceBackedLayerCount === 5[\s\S]*?!expandedLayerHasRasterSource/,
  "The GPU regression must reproduce one painted copy beside source-backed duplicates.",
);
assert.match(
  gpuLab,
  /for \(const memberCount of \[2, 3, 5\]\)/,
  "The sequential provenance matrix must cover two, three, and five raster members.",
);
assert.match(
  gpuLab,
  /engine\.layerFormat === "rgba16float"[\s\S]*?engine\.layerFormat === "rgba8unorm"[\s\S]*?engine\.documentStorageColorSpace === "encoded-srgb-premultiplied"/,
  "The Group Transform GPU matrix must accept both linear high-precision and encoded RGBA8 documents.",
);
assert.match(
  gpuLab,
  /bytesPerPixel === 4 \|\| bytesPerPixel === 8/,
  "The Group Transform marker oracle must inspect the native document format.",
);
for (const invariant of [
  "shrink did not preserve every immutable raster source",
  "upscale did not preserve every immutable raster source",
  "upscale pixel quality diverged",
  "isolated presentation pixels differ after upscale",
  "isolated presentation edge energy differs after upscale",
  "active/inactive presentation pixels differ after upscale",
  "active/inactive presentation edge energy differs after upscale",
  "Non-uniform scale did not rasterize every selected source",
]) {
  assert.ok(gpuLab.includes(invariant), `The provenance regression is missing: ${invariant}.`);
}
assert.match(
  gpuLab,
  /for \(const zoom of \[1, 0\.6, 0\.5, 0\.25\]\)/,
  "The presentation parity matrix must exercise the discriminating fractional zoom and controls.",
);
assert.match(
  gpuLab,
  /memberCount === 2[\s\S]*?isolatedPresentationParity\(engine, fixtures\)/,
  "Presentation path parity must run once on the two-copy policy probe.",
);
for (const invariant of [
  "Undo must restore the painted copy's immutable raster provenance",
  "Redo must discard stale immutable raster provenance again",
  "Redo did not restore the extension stroke byte-for-byte",
  "Cancel did not restore the baseline",
  "Undo did not restore every raster",
  "Redo differs from Apply",
  "depends on layer-key order",
]) {
  assert.ok(gpuLab.includes(invariant), `The GPU regression is missing: ${invariant}.`);
}
assert.match(
  editorLabs,
  /case "group-transform"[\s\S]{0,300}ensureMixedSceneController\(\)[\s\S]{0,300}group-transform-gpu-test/,
  "The Group Transform GPU lab must initialize its compositor before running.",
);

assert.match(
  runtime,
  /mixedSceneGroupRasterMaterializationPivot\([\s\S]*?destinationPivot\.x[\s\S]*?destinationPivot\.y/,
  "Apply must convert the preview pivot into the authoritative raster pivot.",
);

const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
try {
  const runtimeModule = await vite.ssrLoadModule(
    "/src/engine-mixed-scene-group-transform-runtime.ts",
  );
  const destinationPivot = runtimeModule.mixedSceneGroupRasterMaterializationPivot;
  const close = (actual, expected, message) => {
    assert.ok(
      Math.abs(actual - expected) <= 1e-9,
      `${message}: expected ${expected}, received ${actual}`,
    );
  };
  const mapFromPivot = (point, pivot, destination, update) => {
    const cosine = Math.cos(update.rotation);
    const sine = Math.sin(update.rotation);
    const deltaX = point.x - pivot.x;
    const deltaY = point.y - pivot.y;
    return {
      x: destination.x
        + cosine * update.scaleX * deltaX
        - sine * update.scaleY * deltaY,
      y: destination.y
        + sine * update.scaleX * deltaX
        + cosine * update.scaleY * deltaY,
    };
  };
  const cases = [
    {
      name: "translation",
      previewPivot: { x: 40, y: 55 },
      sourcePivot: { x: 61, y: 33 },
      update: { x: 145, y: 172, scaleX: 1, scaleY: 1, rotation: 0 },
    },
    {
      name: "uniform shrink",
      previewPivot: { x: 80, y: 110 },
      sourcePivot: { x: 42, y: 137 },
      update: { x: 206, y: 188, scaleX: 0.37, scaleY: 0.37, rotation: 0 },
    },
    {
      name: "independent axes",
      previewPivot: { x: 122, y: 76 },
      sourcePivot: { x: 151, y: 41 },
      update: { x: 281, y: 203, scaleX: 1.8, scaleY: 0.42, rotation: 0 },
    },
    {
      name: "rotation",
      previewPivot: { x: 180, y: 210 },
      sourcePivot: { x: 144, y: 262 },
      update: { x: 330, y: 298, scaleX: 1, scaleY: 1, rotation: Math.PI / 3 },
    },
    {
      name: "combined affine",
      previewPivot: { x: 250, y: 95 },
      sourcePivot: { x: 203, y: 143 },
      update: { x: 96, y: 314, scaleX: 0.58, scaleY: 1.47, rotation: -Math.PI / 5 },
    },
  ];
  const probeOffsets = [
    { x: 0, y: 0 },
    { x: -37, y: -19 },
    { x: 42, y: -28 },
    { x: 31, y: 46 },
    { x: -24, y: 39 },
  ];

  for (const testCase of cases) {
    const materializedPivot = destinationPivot(
      testCase.previewPivot,
      testCase.sourcePivot,
      testCase.update,
    );
    for (const offset of probeOffsets) {
      const point = {
        x: testCase.sourcePivot.x + offset.x,
        y: testCase.sourcePivot.y + offset.y,
      };
      const previewPoint = mapFromPivot(
        point,
        testCase.previewPivot,
        testCase.update,
        testCase.update,
      );
      const appliedPoint = mapFromPivot(
        point,
        testCase.sourcePivot,
        materializedPivot,
        testCase.update,
      );
      close(appliedPoint.x, previewPoint.x, `${testCase.name} x`);
      close(appliedPoint.y, previewPoint.y, `${testCase.name} y`);
    }
  }

  const memberMatrix = Array.from({ length: 5 }, (_, index) => ({
    previewPivot: { x: 45 + index * 57, y: 70 + index * 31 },
    sourcePivot: { x: 61 + index * 43, y: 38 + index * 48 },
  }));
  const groupUpdate = {
    x: 318,
    y: 267,
    scaleX: 0.41,
    scaleY: 1.32,
    rotation: Math.PI / 7,
  };
  const forward = memberMatrix.map((member) => destinationPivot(
    member.previewPivot,
    member.sourcePivot,
    groupUpdate,
  ));
  const reverse = [...memberMatrix].reverse().map((member) => destinationPivot(
    member.previewPivot,
    member.sourcePivot,
    groupUpdate,
  )).reverse();
  assert.deepEqual(forward, reverse, "member order must not alter pivot conversion");
} finally {
  await vite.close();
}

console.log("Group Transform engine lifecycle and rollback verification passed.");
