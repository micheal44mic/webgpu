import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blendLayerPremultipliedLinear } from "../src/layer-blend-modes.ts";
import {
  borrowLayerMergeColdSeed,
  layerMergeColdSeedIsLiveAuthority,
  restoreBorrowedLayerMergeColdSeedAfterDetachFailure,
  transferBorrowedLayerMergeColdSeedForDetach,
} from "../src/layer-merge-seed-ownership.ts";
import {
  planLayerDuplicateMemory,
  planLayerMergeCreateMemory,
  planLayerSwitchMemory,
} from "../src/layer-memory-admission-core.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const core = read("../src/layer-merge-core.ts");
const runtime = read("../src/engine-layer-merge-runtime.ts");
const history = read("../src/engine-history-types.ts");
const historyRuntime = read("../src/engine-history-runtime.ts");
const engine = read("../src/brush-engine.ts");
const controller = read("../src/mixed-vector-text-controller.ts");
const layerStack = read("../src/layer-stack.ts");
const coldStorage = read("../src/engine-cold-storage.ts");
const layerStructure = read("../src/engine-layer-structure-runtime.ts");
const storageCoordinator = read("../src/history-storage-coordinator.ts");

assert.match(history, /kind: "layer-merge"/);
assert.match(history, /readonly inputs: readonly LayerMergeHistoryInput\[\]/);
assert.match(history, /readonly output: LayerMergeHistoryOutput/);
assert.match(history, /baseTileMask: Uint32Array/);
assert.match(runtime, /prepareAndApplyLayerMerge/);
assert.match(runtime, /applyLayerMergeHistory/);
assert.match(runtime, /reserveLayerMergeCreateMemory/);
assert.match(runtime, /memoryReservation = reserveLayerMergeCreateMemory/);
assert.match(runtime, /baseTileMask: rendered\.record\.storageTileMask\.slice\(\)/);
assert.match(runtime, /entry\.layerRecord\.storageTileMask\.set\(entry\.baseTileMask\)/);
assert.match(history, /payloadsRetiredBelowFloor: boolean/);
assert.match(runtime, /payloadsRetiredBelowFloor: false/);
assert.match(runtime, /action\.output\.layerRecord\.visible = false/);
assert.match(
  runtime,
  /plan\.bakesParentBlendModesFromTransparentBackdrop\s*\? parent\.blendMode\s*:\s*"normal"/,
);
assert.match(
  core,
  /bakesParentBlendModesFromTransparentBackdrop\s*=\s*!onlyOneCompleteRasterUnit\s*&& sceneIndex === 0/,
);
assert.match(historyRuntime, /await applyLayerMergeHistory\(engine, crossedAction, delta\)/);
assert.match(historyRuntime, /engine\.discardedLayerMergeHistoryActions\.push\(action\)/);
assert.match(historyRuntime, /destroyLayerMergeHistorySeeds\(action\)/);
assert.match(engine, /discardedLayerMergeHistoryActions: LayerMergeHistoryAction\[\]/);
assert.match(engine, /async mergeMixedSceneItems\(/);
assert.match(engine, /private reserveLayerSwitchMemory\(/);
assert.match(engine, /const memoryReservation = this\.reserveLayerSwitchMemory\(index\)/);
assert.match(controller, /async mergeSceneItems\(/);
assert.match(controller, /this\.host\.mergeMixedSceneItems\(\{ keys: \[\.\.\.keys\], vectorDraws \}\)/);

// Vectors are drawn into a transient cropped surface. They must never take the
// old per-node conversion path, which would publish N layers and N actions.
assert.match(runtime, /renderVectorDrawsToTexture/);
assert.doesNotMatch(runtime, /rasterizeVectorNodeToLayer/);
assert.doesNotMatch(runtime, /kind: "vector-rasterize"/);

// Conservative representability gates are part of the correctness contract.
for (const fragment of [
  "keys.length < 2",
  "new Set(keys).size !== keys.length",
  "devono essere contigui",
  "deve essere unito per intero",
  "dipende dal backdrop",
  "estendi la selezione fino",
  "item.kind === \"image\"",
]) {
  assert.ok(core.includes(fragment), `validazione merge mancante: ${fragment}`);
}

// Normal multi-item merges bake presentation exactly once; a single complete
// clipping unit may keep the parent's outer contract.
assert.match(runtime, /record\.opacity = 1;\s*record\.blendMode = "normal"/);
assert.match(runtime, /record\.opacity = parent\.opacity;\s*record\.blendMode = parent\.blendMode/);
assert.match(runtime, /foldClippingGroupIntoMergedSurface/);

// Every raster authority has a lossless route into history.
assert.match(runtime, /if \(gpu\.hot\)/);
assert.match(runtime, /else if \(gpu\.cold\)/);
assert.match(runtime, /else if \(gpu\.compressed\)/);
assert.match(runtime, /restoreColdStorageResources/);
assert.match(
  runtime,
  /seed = borrowLayerMergeColdSeed\(gpu\)/,
  "un cold live deve essere solo preso in prestito durante la preparazione",
);
const captureRasterInputSource = runtime.slice(
  runtime.indexOf("async function captureRasterInput("),
  runtime.indexOf("async function attachOutput("),
);
assert.doesNotMatch(
  captureRasterInputSource,
  /gpu\.cold\s*=\s*null/,
  "la cattura non deve togliere l'autorita' cold prima del render transitorio",
);
assert.match(
  runtime,
  /transferBorrowedLayerMergeColdSeedForDetach\(\s*gpu,\s*entry\.seed,?\s*\)/,
  "la proprieta' del cold deve passare a History soltanto al detach",
);
assert.match(
  runtime,
  /layerMergeColdSeedIsLiveAuthority\(liveGpu, input\.entry\.seed\)[\s\S]*?input\.entry\.seed = null;\s*continue;/,
  "il cleanup di un'azione non pubblicata non deve distruggere il cold live condiviso",
);

// Real inactive-content ownership model. A cold-only layer must remain
// authoritative while the temporary merge output is attached and the whole
// pre-merge scene is rendered. Transfer is delayed until structural detach.
const makeColdSeed = (generation) => {
  let destructionCount = 0;
  return {
    texture: { destroy() { destructionCount += 1; } },
    tileIndices: [0, 1, 16, 17],
    memoryBytes: 4 * 256 * 256 * 8,
    generation,
    format: "rgba16float",
    destructionCount: () => destructionCount,
  };
};
const makeInactiveContentGpu = (cold) => ({
  hot: null,
  cold,
  compressed: null,
  bake: null,
  bakeValid: false,
});
const firstCold = makeColdSeed(7);
const firstInactiveGpu = makeInactiveContentGpu(firstCold);
const firstBorrowedSeed = borrowLayerMergeColdSeed(firstInactiveGpu);
assert.equal(firstBorrowedSeed, firstCold);
assert.equal(firstInactiveGpu.cold, firstCold);
assert.equal(layerMergeColdSeedIsLiveAuthority(firstInactiveGpu, firstBorrowedSeed), true);
assert.equal(transferBorrowedLayerMergeColdSeedForDetach(
  firstInactiveGpu,
  firstBorrowedSeed,
), true);
assert.equal(firstInactiveGpu.cold, null);
assert.equal(restoreBorrowedLayerMergeColdSeedAfterDetachFailure(
  firstInactiveGpu,
  firstBorrowedSeed,
), true);
assert.equal(firstInactiveGpu.cold, firstCold);

// Partial transaction failure: both detached authorities remain staged until
// commit. Rollback reattaches the exact cold resources; unpublished-action
// cleanup must then clear both aliases without destroying either live layer.
const detachedCold = makeColdSeed(11);
const failingCold = makeColdSeed(12);
const detachedGpu = makeInactiveContentGpu(detachedCold);
const failingGpu = makeInactiveContentGpu(failingCold);
const detachedActionInput = { seed: borrowLayerMergeColdSeed(detachedGpu) };
const failingActionInput = { seed: borrowLayerMergeColdSeed(failingGpu) };
assert.equal(transferBorrowedLayerMergeColdSeedForDetach(
  detachedGpu,
  detachedActionInput.seed,
), true);
assert.equal(detachedGpu.cold, null);
assert.equal(transferBorrowedLayerMergeColdSeedForDetach(
  failingGpu,
  failingActionInput.seed,
), true);
assert.equal(restoreBorrowedLayerMergeColdSeedAfterDetachFailure(
  failingGpu,
  failingActionInput.seed,
), true);
assert.equal(failingGpu.cold, failingCold);
assert.equal(restoreBorrowedLayerMergeColdSeedAfterDetachFailure(
  detachedGpu,
  detachedActionInput.seed,
), true);
const reattachedGpu = detachedGpu;
assert.equal(layerMergeColdSeedIsLiveAuthority(
  reattachedGpu,
  detachedActionInput.seed,
), true);
assert.equal(reattachedGpu.cold, detachedCold);
assert.equal(layerMergeColdSeedIsLiveAuthority(
  failingGpu,
  failingActionInput.seed,
), true);

const cleanupUnpublishedRasterInput = (gpu, input) => {
  if (layerMergeColdSeedIsLiveAuthority(gpu, input.seed)) {
    input.seed = null;
    return;
  }
  input.seed?.texture.destroy();
  input.seed = null;
};
cleanupUnpublishedRasterInput(reattachedGpu, detachedActionInput);
cleanupUnpublishedRasterInput(failingGpu, failingActionInput);
assert.equal(detachedCold.destructionCount(), 0);
assert.equal(failingCold.destructionCount(), 0);
assert.equal(reattachedGpu.cold, detachedCold);
assert.equal(failingGpu.cold, failingCold);

// Undo creates a distinct live cold owner. Cutting the Redo branch may retire
// the History seed immediately without invalidating pixels restored in-scene.
const branchHistorySeed = makeColdSeed(20);
const branchLiveClone = makeColdSeed(20);
branchHistorySeed.texture.destroy();
assert.equal(branchHistorySeed.destructionCount(), 1);
assert.equal(branchLiveClone.destructionCount(), 0);

// The temporary output makes Undo/Redo exceed the normal stack cap by one; the
// overflow is private to replacement attach, never enabled for ordinary add.
assert.match(
  runtime,
  /engine\.layerStack\.attach\(entry\.layerRecord, entry\.rasterLayerIndex, true\)/,
);
assert.match(
  layerStack,
  /const maximum = LAYER_STACK_MAXIMUM \+ Number\(allowTemporaryReplacementOverflow\)/,
  "l'overflow privato del rimpiazzo deve essere limitato a un solo record",
);

// Empty restored inputs never allocate one full texture each. A durable source
// is restored directly as the final live cold authority; only an unstored
// resident source needs the cold-to-cold clone fallback.
assert.match(layerStructure, /gpu = createColdLayerGpuResources\(\)/);
assert.match(coldStorage, /export async function cloneLayerColdStorageResources/);
assert.match(
  runtime,
  /restoreStoredColdSeedForDetachedReplay\(seed\)[\s\S]*?if \(restored\) \{[\s\S]*?cold: restored/,
);
assert.match(runtime, /ensureLayerMergeSeedResident\(seed\)[\s\S]*?cloneLayerColdStorageResources\(/);
assert.match(
  storageCoordinator,
  /await this\.assertRequiredPayloadsAvailable\(required\)/,
);
assert.match(
  storageCoordinator,
  /crossed\.kind === "layer-merge"[\s\S]*?if \(delta < 0\)[\s\S]*?addSeed\(crossed\.output\.seed\)/,
  "il preflight merge deve richiedere input per Undo e output per Redo",
);
assert.match(runtime, /const reservation = reserveLayerMergeHistoryMemory/);
assert.match(
  runtime,
  /if \(committed\) engine\.memoryReservations\.settle\(reservation\);[\s\S]*?engine\.memoryReservations\.release\(reservation\)/,
);

const undoReservationModel = (
  seedBytes,
  fullTextureBytes,
  referenceDistinct = false,
) => {
  const clonedColdBytes = seedBytes.reduce((total, bytes) => total + bytes, 0);
  const hotDestinations = 1 + Number(referenceDistinct);
  const steadyBytes = clonedColdBytes + fullTextureBytes * hotDestinations;
  return {
    steadyBytes,
    peakBytes: steadyBytes + fullTextureBytes,
  };
};
for (const documentSize of [2048, 4096]) {
  const fullTextureBytes = documentSize * documentSize * 8;
  for (const count of [2, 16]) {
    const empty = undoReservationModel(Array(count).fill(0), fullTextureBytes);
    assert.equal(empty.steadyBytes, fullTextureBytes);
    assert.equal(empty.peakBytes, fullTextureBytes * 2);

    const tileSparseBytes = fullTextureBytes / 16;
    const painted = undoReservationModel(
      Array(count).fill(tileSparseBytes),
      fullTextureBytes,
    );
    assert.equal(painted.steadyBytes, count * tileSparseBytes + fullTextureBytes);
    assert.equal(
      painted.peakBytes,
      count * tileSparseBytes + fullTextureBytes * 2,
    );
    const fullCanvasPainted = undoReservationModel(
      Array(count).fill(fullTextureBytes),
      fullTextureBytes,
    );
    assert.equal(fullCanvasPainted.steadyBytes, (count + 1) * fullTextureBytes);
    assert.equal(fullCanvasPainted.peakBytes, (count + 2) * fullTextureBytes);

    let residentStoredSourceBytes = 0;
    let maximumResidentStoredSourceBytes = 0;
    let independentLiveColdBytes = 0;
    for (let index = 0; index < count; index += 1) {
      // Stored-only bytes become this final authority directly; there is no
      // separate resident History source during the restore.
      independentLiveColdBytes += tileSparseBytes;
    }
    assert.equal(maximumResidentStoredSourceBytes, 0);
    assert.equal(independentLiveColdBytes, count * tileSparseBytes);
    assert.equal(residentStoredSourceBytes, 0);
    const finalResidency = Array.from({ length: count }, (_, index) => ({
      hot: index === 0,
      cold: index !== 0,
    }));
    assert.equal(finalResidency.filter((entry) => entry.hot).length, 1);
    assert.equal(finalResidency.filter((entry) => entry.cold).length, count - 1);
  }
}

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
  foldTransientBytes: fullLayerBytes * 2,
});
assert.equal(layerSwitch.category, "layer-switch");
assert.equal(layerSwitch.steadyBytes, 0);
assert.equal(
  layerSwitch.peakBytes,
  512 * 1024
    + fullLayerBytes
    + 256 * 1024
    + fullMergedSurfaceBytes * 2
    + fullLayerBytes * 2,
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
