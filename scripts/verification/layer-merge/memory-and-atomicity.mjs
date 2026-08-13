import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blendLayerPremultipliedLinear } from "../../../src/layer-blend-modes.ts";
import {
  planLayerDuplicateMemory,
  planLayerMergeCreateMemory,
  planLayerSwitchMemory,
} from "../../../src/layer-memory-admission-core.ts";

const read = (sourcePath) => readFileSync(new URL(sourcePath, import.meta.url), "utf8");
const core = read("../../../src/layer-merge-core.ts");
const runtime = read("../../../src/engine-layer-merge-runtime.ts");

// Admission is proportional to the real cold-tile payloads, not a fixed
// number of selected layers. Full-document resources stay explicit because
// WebGPU has to allocate them even when a layer is sparse.
const fullLayerBytes = 32 * 1024 * 1024;
const fullMergedSurfaceBytes = Math.floor(fullLayerBytes * 4 / 3);
const sparseSeeds = [128 * 1024, 512 * 1024, 0, 256 * 1024];
const mergeCreate = planLayerMergeCreateMemory({
  fullLayerBytes,
  inputSeedBytes: sparseSeeds,
  outputSeedBytes: fullLayerBytes,
  foldTransientBytes: fullLayerBytes * 2 + fullMergedSurfaceBytes,
});
assert.equal(mergeCreate.category, "layer-merge-create");
assert.equal(mergeCreate.steadyBytes, fullLayerBytes * 2);
assert.equal(
  mergeCreate.peakBytes,
  fullLayerBytes * 4
    + fullMergedSurfaceBytes
    + sparseSeeds.reduce((total, value) => total + value, 0),
);
const smallerMerge = planLayerMergeCreateMemory({
  fullLayerBytes,
  inputSeedBytes: sparseSeeds.slice(0, 1),
  outputSeedBytes: fullLayerBytes,
  foldTransientBytes: fullLayerBytes * 2 + fullMergedSurfaceBytes,
});
assert.ok(smallerMerge.peakBytes < mergeCreate.peakBytes);

const layerSwitch = planLayerSwitchMemory({
  outgoingColdBytes: 512 * 1024,
  incomingHotBytes: fullLayerBytes,
  adjacentPrefetchBytes: 256 * 1024,
  fullMergedSurfaceBytes,
  reclaimableCompositeBytes: fullMergedSurfaceBytes,
  foldTransientBytes: fullLayerBytes * 2,
});
assert.equal(layerSwitch.category, "layer-switch");
assert.equal(layerSwitch.steadyBytes, 0);
assert.equal(
  layerSwitch.peakBytes,
  512 * 1024
    + fullLayerBytes
    + 256 * 1024
    + fullMergedSurfaceBytes
    + fullLayerBytes * 2,
);
const tileNativeLayerSwitch = planLayerSwitchMemory({
  outgoingColdBytes: fullLayerBytes,
  incomingHotBytes: fullLayerBytes,
  adjacentPrefetchBytes: 0,
  fullMergedSurfaceBytes,
  reclaimableCompositeBytes: fullMergedSurfaceBytes * 2,
  foldTransientBytes: 512 * 1024,
});
assert.equal(
  tileNativeLayerSwitch.peakBytes,
  fullLayerBytes * 2 + 512 * 1024,
);

const sparseDuplicate = planLayerDuplicateMemory({
  historySeedBytes: 512 * 1024,
  sourceColdBytes: 512 * 1024,
  additionalHotBytes: 0,
  fullMergedSurfaceBytes,
  foldTransientBytes: fullLayerBytes * 2,
});
assert.equal(sparseDuplicate.category, "layer-duplicate");
assert.equal(sparseDuplicate.steadyBytes, 1024 * 1024);
assert.equal(
  sparseDuplicate.peakBytes,
  1024 * 1024 + fullMergedSurfaceBytes * 2 + fullLayerBytes * 2,
);
const referenceDuplicate = planLayerDuplicateMemory({
  historySeedBytes: 512 * 1024,
  sourceColdBytes: 0,
  additionalHotBytes: fullLayerBytes,
  fullMergedSurfaceBytes,
  foldTransientBytes: fullLayerBytes * 2,
});
assert.equal(referenceDuplicate.steadyBytes, fullLayerBytes + 512 * 1024);
assert.ok(referenceDuplicate.peakBytes > sparseDuplicate.peakBytes);

// Every fallible attach/detach happens before staged GPU destruction. Output
// attach compensates stack/map/scene partial success locally; the outer
// rollback restores exact active, selection and Reference state.
const attachOutputSource = runtime.slice(
  runtime.indexOf("async function attachOutput("),
  runtime.indexOf("interface StagedMergeRaster"),
);
assert.match(attachOutputSource, /let stackAttached = false/);
assert.match(attachOutputSource, /scene\.removeRaster\(entry\.layerRecord\.id, fallbackLayerId\)/);
assert.match(attachOutputSource, /engine\.layerStack\.remove\(index\)/);
assert.match(attachOutputSource, /destroyLayerGpuResources\(engine, gpu\)/);
assert.match(runtime, /const originalActiveId = engine\.layerStack\.active\.id/);
assert.match(runtime, /scene\.restoreState\(sceneState, true\)/);
assert.match(runtime, /restoreReferenceLayerId\(engine, previousReferenceId\)/);
assert.match(runtime, /switchActiveForStructuralHistory\(engine, originalIndex\)/);

// Pure order model: insert output at the interval start, remove inputs top-down,
// then invert by inserting inputs at +1 and deleting output.
const original = ["raster:1", "text:1", "raster:2", "svg:1", "raster:3"];
const selected = original.slice(1, 4);
const output = "raster:99";
const merged = [...original];
merged.splice(1, 0, output);
for (const key of [...selected].reverse()) {
  const index = merged.indexOf(key);
  assert.notEqual(index, -1);
  merged.splice(index, 1);
}
assert.deepEqual(merged, ["raster:1", output, "raster:3"]);

const restored = [...merged];
for (let offset = 0; offset < selected.length; offset += 1) {
  restored.splice(1 + 1 + offset, 0, selected[offset]);
}
restored.splice(restored.indexOf(output), 1);
assert.deepEqual(restored, original);

// Multiple advanced modes are backdrop-dependent only when something exists
// below the selection. At scene index zero the backdrop is transparent, so the
// complete ordered fold can be baked into a Normal/100% output exactly.
const withOpacity = (pixel, opacity) => [
  pixel[0] * opacity,
  pixel[1] * opacity,
  pixel[2] * opacity,
  pixel[3] * opacity,
];
const transparent = [0, 0, 0, 0];
const bottomPixel = withOpacity([0.72, 0.14, 0.08, 0.8], 0.35);
const topPixel = withOpacity([0.05, 0.36, 0.63, 0.9], 0.7);
const foldedBottom = blendLayerPremultipliedLinear(
  transparent,
  bottomPixel,
  "multiply",
);
const foldedSelection = blendLayerPremultipliedLinear(
  foldedBottom,
  topPixel,
  "screen",
);
const incorrectlyNormalizedSelection = blendLayerPremultipliedLinear(
  foldedBottom,
  topPixel,
  "normal",
);
assert.notDeepEqual(
  incorrectlyNormalizedSelection,
  foldedSelection,
  "il fold deve usare davvero il blend del parent superiore, non forzare Normal",
);
assert.deepEqual(
  blendLayerPremultipliedLinear(transparent, foldedSelection, "normal"),
  foldedSelection,
  "l'output Normal/100% deve conservare il fold avanzato dal backdrop trasparente",
);
const externalBackdrop = [0.18, 0.04, 0.31, 0.65];
const originalWithExternalBackdrop = blendLayerPremultipliedLinear(
  blendLayerPremultipliedLinear(externalBackdrop, bottomPixel, "multiply"),
  topPixel,
  "screen",
);
const transparentBakeOverExternalBackdrop = blendLayerPremultipliedLinear(
  externalBackdrop,
  foldedSelection,
  "normal",
);
assert.notDeepEqual(
  transparentBakeOverExternalBackdrop,
  originalWithExternalBackdrop,
  "un bake creato su trasparenza non è valido quando esiste un backdrop esterno",
);
assert.match(
  core,
  /!onlyOneCompleteRasterUnit && !bakesParentBlendModesFromTransparentBackdrop/,
  "un backdrop esterno reale deve continuare a bloccare i blend avanzati",
);

console.log("layer merge verification passed");
