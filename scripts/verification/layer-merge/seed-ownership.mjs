import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  borrowLayerMergeColdSeed,
  layerMergeColdSeedIsLiveAuthority,
  restoreBorrowedLayerMergeColdSeedAfterDetachFailure,
  transferBorrowedLayerMergeColdSeedForDetach,
} from "../../../src/layer-merge-seed-ownership.ts";

const read = (sourcePath) => readFileSync(new URL(sourcePath, import.meta.url), "utf8");
const runtime = read("../../../src/engine-layer-merge-runtime.ts");
const layerStack = read("../../../src/layer-stack.ts");
const coldStorage = read("../../../src/engine-cold-storage.ts");
const layerStructure = read("../../../src/engine-layer-structure-runtime.ts");
const storageCoordinator = read("../../../src/history-storage-coordinator.ts");

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

// Empty restored inputs never allocate one full texture each. Painted inputs
// are cloned cold-to-cold and durable stored-only sources are streamed one at a
// time; only the active raster (plus the explicit Fill Reference exception) is
// hot after Undo.
assert.match(layerStructure, /gpu = createColdLayerGpuResources\(\)/);
assert.match(coldStorage, /export async function cloneLayerColdStorageResources/);
assert.match(runtime, /await engine\.historyLocalStorage\.ensureLayerMergeSeedResident\(seed\)/);
assert.match(runtime, /cloneLayerColdStorageResources\([\s\S]*?demoteStoredLayerMergeSeed\(seed\)/);
assert.match(
  storageCoordinator,
  /crossed\?\.kind === "layer-merge"[\s\S]*?assertRequiredPayloadsAvailable\(required\)/,
);
assert.match(runtime, /const reservation = reserveLayerMergeHistoryMemory/);
assert.match(
  runtime,
  /if \(committed\) engine\.memoryReservations\.settle\(reservation\);[\s\S]*?engine\.memoryReservations\.release\(reservation\)/,
);

const undoReservationModel = (
  seedBytes,
  storedOnly,
  fullTextureBytes,
  referenceDistinct = false,
) => {
  const clonedColdBytes = seedBytes.reduce((total, bytes) => total + bytes, 0);
  const maximumMissingSeedBytes = storedOnly ? Math.max(0, ...seedBytes) : 0;
  const hotDestinations = 1 + Number(referenceDistinct);
  const steadyBytes = clonedColdBytes + fullTextureBytes * hotDestinations;
  return {
    steadyBytes,
    peakBytes: steadyBytes + maximumMissingSeedBytes + fullTextureBytes,
  };
};
for (const documentSize of [2048, 4096]) {
  const fullTextureBytes = documentSize * documentSize * 8;
  for (const count of [2, 16]) {
    const empty = undoReservationModel(Array(count).fill(0), true, fullTextureBytes);
    assert.equal(empty.steadyBytes, fullTextureBytes);
    assert.equal(empty.peakBytes, fullTextureBytes * 2);

    const tileSparseBytes = fullTextureBytes / 16;
    const painted = undoReservationModel(
      Array(count).fill(tileSparseBytes),
      true,
      fullTextureBytes,
    );
    assert.equal(painted.steadyBytes, count * tileSparseBytes + fullTextureBytes);
    assert.equal(
      painted.peakBytes,
      count * tileSparseBytes + tileSparseBytes + fullTextureBytes * 2,
    );
    const fullCanvasPainted = undoReservationModel(
      Array(count).fill(fullTextureBytes),
      true,
      fullTextureBytes,
    );
    assert.equal(fullCanvasPainted.steadyBytes, (count + 1) * fullTextureBytes);
    assert.equal(fullCanvasPainted.peakBytes, (count + 3) * fullTextureBytes);

    let residentStoredSourceBytes = 0;
    let maximumResidentStoredSourceBytes = 0;
    let independentLiveColdBytes = 0;
    for (let index = 0; index < count; index += 1) {
      residentStoredSourceBytes += tileSparseBytes;
      maximumResidentStoredSourceBytes = Math.max(
        maximumResidentStoredSourceBytes,
        residentStoredSourceBytes,
      );
      independentLiveColdBytes += tileSparseBytes;
      residentStoredSourceBytes -= tileSparseBytes;
    }
    assert.equal(maximumResidentStoredSourceBytes, tileSparseBytes);
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
