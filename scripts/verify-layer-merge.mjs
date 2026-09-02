import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blendLayerPremultipliedLinear } from "../src/layer-blend-modes.ts";
import { LayerStack } from "../src/layer-stack.ts";
import { MixedSceneStack } from "../src/mixed-scene-stack.ts";
import { planMixedSceneLayerMerge } from "../src/layer-merge-core.ts";
import {
  borrowLayerMergeColdSeed,
  layerMergeColdSeedIsLiveAuthority,
  restoreBorrowedLayerMergeColdSeedAfterDetachFailure,
  transferBorrowedLayerMergeColdSeedForDetach,
} from "../src/layer-merge-seed-ownership.ts";
import {
  LAYER_MEMORY_ADMISSION_STRATEGY,
  planLayerDuplicateMemory,
  planLayerMergeCreateMemory,
  planLayerSwitchMemory,
} from "../src/layer-memory-admission-core.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const core = read("../src/layer-merge-core.ts");
const runtime = read("../src/engine-layer-merge-runtime.ts");
const layerRuntime = read("../src/engine-layer-runtime.ts");
const foldShader = read("../src/layer-blend-fold-shader.ts");
const layerResources = read("../src/engine-layer-resources.ts");
const vectorRaster = read("../src/engine-vector-raster-runtime.ts");
const history = read("../src/engine-history-types.ts");
const historyRuntime = read("../src/engine-history-runtime.ts");
const historyService = read("../src/history-service.ts");
const engine = read("../src/brush-engine.ts");
const controller = read("../src/mixed-scene-controller.ts");
const layerStack = read("../src/layer-stack.ts");
const coldStorage = read("../src/engine-cold-storage.ts");
const layerStructure = read("../src/engine-layer-structure-runtime.ts");
const storageCoordinator = read("../src/history-storage-coordinator.ts");
const gpuLab = read("../src/labs/gpu/layer-merge-gpu-test.ts");

assert.match(history, /kind: "layer-merge"/);
assert.match(history, /readonly inputs: readonly LayerMergeHistoryInput\[\]/);
assert.match(history, /readonly output: LayerMergeHistoryOutput/);
assert.match(history, /baseTileMask: Uint32Array/);
assert.match(runtime, /prepareAndApplyLayerMerge/);
assert.match(runtime, /applyLayerMergeHistory/);
assert.match(runtime, /reserveLayerMergeCreateMemory/);
assert.match(runtime, /memoryReservation = await reserveLayerMergeCreateMemory/);
assert.match(runtime, /return engine\.reservePlannedMemory\(request\)/);
assert.match(runtime, /const workingBytes = allocation\.width \* allocation\.height \* 8/);
assert.match(runtime, /const foldScratchBytes = foldTileWidth \* foldTileHeight \* 8 \* 2/);
assert.match(runtime, /VECTOR_TEXT_GPU_SAMPLE_COUNT \+ 1/);
assert.doesNotMatch(runtime, /planMemoryAdmission|reserveMemoryWithAdmissionOverride/);
assert.match(runtime, /baseTileMask: rendered\.record\.storageTileMask\.slice\(\)/);
assert.match(runtime, /entry\.layerRecord\.storageTileMask\.set\(entry\.baseTileMask\)/);
assert.match(history, /payloadsRetiredBelowFloor: boolean/);
assert.match(runtime, /payloadsRetiredBelowFloor: false/);
assert.match(runtime, /action\.output\.layerRecord\.visible = false/);
const applyMergedStart = runtime.indexOf("async function applyMergedState(");
const applyMergedEnd = runtime.indexOf("async function applyInputState(", applyMergedStart);
const applyMergedBody = runtime.slice(applyMergedStart, applyMergedEnd);
assert.equal(
  (applyMergedBody.match(/await engine\.activateLayer\(/g) ?? []).length,
  2,
  "il percorso principale deve attivare una volta; la seconda attivazione appartiene solo al rollback",
);
assert.doesNotMatch(
  applyMergedBody.slice(0, applyMergedBody.indexOf("} catch (error)")),
  /await engine\.waitForIdle\(\)/,
  "il merge non deve ricostruire e drenare una presentazione transitoria",
);
assert.match(
  runtime,
  /plan\.bakesParentBlendModesFromTransparentBackdrop\s*\? parent\.blendMode\s*:\s*"normal"/,
);
assert.match(
  core,
  /bakesParentBlendModesFromTransparentBackdrop\s*=\s*!onlyOneCompleteRasterUnit\s*&& sceneIndex === 0/,
);
assert.match(runtime, /const outerAdvancedBlend = plan\.rasterLayerIds\.some/);
assert.match(
  runtime,
  /const requiresSemanticBackdrop = plan\.vectorKeys\.length > 0[\s\S]*?encoded-srgb-premultiplied/,
  "a bottom semantic merge in encoded storage must preserve linear canvas composition",
);
assert.match(
  runtime,
  /plan\.bakesParentBlendModesFromTransparentBackdrop[\s\S]*?outerAdvancedBlend \|\| requiresSemanticBackdrop[\s\S]*?engine\.documentBackground\.visible[\s\S]*?createMergeBackdropSeedResources/,
  "a bottom-starting advanced merge must capture its known visible canvas backdrop",
);
assert.match(runtime, /documentBackgroundEncodedSrgbPremultiplied/);
assert.match(runtime, /documentBackgroundLinearPremultiplied/);
assert.match(runtime, /srcFactor: "one-minus-dst-alpha"/);
assert.match(runtime, /seedMergeSurfaceWithKnownBackdrop/);
assert.match(
  runtime,
  /&& engine\.documentBackground\.visible\s*\? createMergeBackdropSeedResources/,
  "a hidden document background must leave the merge surface transparent",
);
assert.ok(
  runtime.indexOf("seedMergeSurfaceWithKnownBackdrop(\n            engine")
    < runtime.indexOf("const folded = unit.length > 1"),
  "the known backdrop must be present before the advanced raster fold",
);
assert.match(layerRuntime, /u32\[39\] = sceneDomain === "linear-source"[\s\S]*?linear-stored-source/);
assert.match(
  layerRuntime,
  /const usesLinearSceneFold = sceneDomain !== "storage"[\s\S]*?encoded-srgb-premultiplied[\s\S]*?!hasAdvancedComposition/,
  "normal mixed raster/vector folds must use linear scene algebra without changing advanced raster semantics",
);
assert.match(foldShader, /sceneDomain: u32/);
assert.match(foldShader, /fn layerBlendFoldDecodeBackdrop/);
assert.match(foldShader, /fn layerBlendFoldDecodeSource/);
assert.match(foldShader, /layer\.sceneDomain == 2u/);
assert.match(foldShader, /fn layerBlendFoldEncodeWorking/);
assert.match(
  runtime,
  /const sceneDomain: LayerFoldSceneDomain = plan\.vectorKeys\.length > 0[\s\S]*?"linear-stored-source"[\s\S]*?foldRasterRecordIntoMergedSurface[\s\S]*?sceneDomain/,
  "a heterogeneous merge must opt its normal outer folds into linear scene composition",
);
assert.match(layerResources, /interface MergedSurfaceResources[\s\S]*?format: LayerFormat/);
assert.match(
  runtime,
  /usesCroppedWorkingSurface[\s\S]*?allocateMergedSurface\([\s\S]*?"rgba16float"[\s\S]*?alignedMergedSurfaceBounds\([\s\S]*?plannedContentBounds/,
  "encoded RGBA8 merges must allocate only a cropped high-precision working surface",
);
assert.match(runtime, /finalizeMergeWorkingSurface\([\s\S]*?outputSurface[\s\S]*?actionId/);
assert.match(runtime, /quantizeRgba8SpatialAdjacent\([\s\S]*?documentCoordinate[\s\S]*?finalize\.actionSeed/);
assert.doesNotMatch(
  runtime.slice(
    runtime.indexOf("const MERGE_WORKING_FINALIZE_WGSL"),
    runtime.indexOf("function mergeWorkingFinalizePipeline"),
  ),
  /linearToSrgb|srgbToLinear/i,
  "the merge working run is already encoded-premultiplied; finalization must quantize only",
);
assert.match(vectorRaster, /outputDomain: "document-storage" \| "linear-premultiplied"/);
assert.match(runtime, /renderVectorDrawsToTexture\([\s\S]*?"linear-premultiplied"/);
assert.match(runtime, /sceneDomain === "storage" \? "storage" : "linear-source"/);
assert.match(
  layerRuntime,
  /layerColdTileCompositePipelinesForFormat\([\s\S]*?mergedSurfaceFormat\(engine, destination\)[\s\S]*?\)/,
  "direct cold-tile folds must select a pipeline for the destination working format",
);
assert.match(
  layerRuntime,
  /coldTileDrawRangesForBounds\(tileIndices, destination\.bounds\)[\s\S]*?pass\.draw\(6, range\.instanceCount, 0, range\.firstInstance\)/,
  "cropped working tiles must draw only intersecting authoritative cold-tile instances",
);
assert.match(historyRuntime, /await applyLayerMergeHistory\(engine, crossedAction, delta, true\)/);
assert.match(
  historyService,
  /appendWithoutPush\(this\.discardedLayerMergeActions, action\)/,
  "il proprietario History deve raccogliere i merge abbandonati dal Redo",
);
assert.match(historyRuntime, /destroyLayerMergeHistorySeeds\(action\)/);
assert.match(engine, /get discardedLayerMergeHistoryActions\(\): LayerMergeHistoryAction\[\]/);
assert.match(engine, /async mergeMixedSceneItems\(/);
assert.match(engine, /private async reserveLayerSwitchMemory\(/);
assert.match(engine, /memoryReservation = await this\.reserveLayerSwitchMemory\(index\)/);
assert.match(controller, /async mergeSceneItems\(/);
assert.match(controller, /this\.host\.mergeMixedSceneItems\(\{ keys: \[\.\.\.keys\], vectorDraws \}\)/);
assert.match(gpuLab, /function documentCenter\(engine: BrushEngine\)/);
assert.match(gpuLab, /Math\.min\(760, environment\.canvasWidth - 8, engine\.documentWidth\)/);
assert.doesNotMatch(gpuLab, /const center = \{ x: 2048, y: 2048 \}/);
assert.match(gpuLab, /variant === "precision"/);
assert.match(gpuLab, /const highPrecision = \[0, 0, 0, 0\]/);
assert.match(gpuLab, /quantizeUnorm8SpatialAdjacent\(/);
assert.match(
  gpuLab,
  /distinguishesPerPassQuantization: oracleSeparation >= 3[\s\S]*?perPassMaxDelta >= 2[\s\S]*?singleFinalizeMaxDelta < perPassMaxDelta/,
);
assert.match(gpuLab, /redoByteExact: redoReturned && redoByteDiff === 0/);
assert.match(
  gpuLab,
  /\["out-of-memory", "internal", "validation"\][\s\S]*?runtimeOutOfMemoryClean/,
  "the precision probe must cover asynchronous allocation and validation failures",
);
assert.match(
  layerRuntime,
  /tile \$\{x\},\$\{y\} transaction[\s\S]*?finalizeRgba8SurfaceTile/,
  "each bounded high-precision tile must remain inside a GPU allocation transaction",
);
assert.match(engine, /private layerSwitchPersistentAuxiliaryBytes\(targetIndex: number\)/);
assert.match(engine, /bounds\.width \* bounds\.height \* 2 \* 4/);
assert.match(
  engine,
  /parentIndex === this\.layerStack\.activeIndex[\s\S]*?contentBounds: this\.layerContentBounds/,
  "the outgoing active clipping parent must reserve from its live bounds before persistence",
);

// Vectors are drawn into a transient cropped surface. They must never take the
// old per-node conversion path, which would publish N layers and N actions.
assert.match(runtime, /renderVectorDrawsToTexture/);
assert.doesNotMatch(runtime, /rasterizeVectorNodeToLayer/);
assert.doesNotMatch(runtime, /kind: "vector-rasterize"/);

// Conservative representability gates are part of the correctness contract.
for (const fragment of [
  "keys.length < 2",
  "new Set(keys).size !== keys.length",
  "must be contiguous",
  "must be merged in full",
  "depends on the external",
  "extend the selection to the bottom",
  "item.kind === \"image\"",
  "clippingGroupRequiresSegmentedComposition",
]) {
  assert.ok(core.includes(fragment), `validazione merge mancante: ${fragment}`);
}

const mergeStyles = () => ({
  strokeStyle: {},
  bevelStyle: {},
  outerShadowStyle: {},
  innerShadowStyle: {},
  colorOverlayStyle: {},
});
const mergeTextSeed = (text = "TEXT") => ({
  text,
  fontFamily: "sans-serif",
  fontSize: 32,
  color: "#ffffff",
  outlineWidth: 0,
  outlineColor: "#000000",
  outlineJoin: "round",
  blockShadowEnabled: false,
  blockShadowColor: "#000000",
  blockShadowOpacity: 1,
  blockShadowOffset: 0,
  blockShadowAngle: 0,
  blockShadowOutlineWidth: 0,
  singleShadowEnabled: false,
  singleShadowColor: "#000000",
  singleShadowOpacity: 1,
  singleShadowOffset: 0,
  singleShadowAngle: 0,
  singleShadowBlur: 0,
  innerShadowEnabled: false,
  innerShadowColor: "#000000",
  innerShadowOpacity: 1,
  innerShadowOffset: 0,
  innerShadowAngle: 0,
  innerShadowBlur: 0,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
});

{
  const stack = new LayerStack(mergeStyles);
  const scene = new MixedSceneStack([1]);
  scene.addTextAboveSelection(mergeTextSeed("ORDINARY"));
  assert.doesNotThrow(() => planMixedSceneLayerMerge(
    stack,
    scene,
    ["raster:1", "text:1"],
  ));
  scene.setClippingEnabled("text:1", true);
  assert.throws(
    () => planMixedSceneLayerMerge(stack, scene, ["raster:1", "text:1"]),
    /clipping groups containing editable text or SVG/,
  );
}

{
  const stack = new LayerStack(mergeStyles);
  stack.add("Middle");
  stack.add("Top");
  const scene = new MixedSceneStack([1, 2, 3]);
  const floorPlan = planMixedSceneLayerMerge(
    stack,
    scene,
    ["raster:1", "raster:2"],
  );
  assert.equal(floorPlan.sceneIndex, 0);
  assert.equal(floorPlan.bakesParentBlendModesFromTransparentBackdrop, true);
  stack.at(1).blendMode = "multiply";
  assert.throws(
    () => planMixedSceneLayerMerge(stack, scene, ["raster:2", "raster:3"]),
    /external backdrop/,
    "a subset above an unselected raster must not bake a guessed document floor",
  );
}

{
  const stack = new LayerStack(mergeStyles);
  stack.add("Raster child");
  const scene = new MixedSceneStack([1, 2]);
  scene.select("raster:1");
  scene.addTextAboveSelection(mergeTextSeed("BASE"));
  scene.setClippingEnabled("raster:2", true);
  assert.throws(
    () => planMixedSceneLayerMerge(stack, scene, ["text:1", "raster:2"]),
    /clipping groups containing editable text or SVG/,
  );
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
assert.match(runtime, /const reservation = await reserveLayerMergeHistoryMemory/);
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

// Admission is proportional to the real cold-tile payloads, not a fixed
// number of selected layers. Full-document resources stay explicit because
// WebGPU has to allocate them even when a layer is sparse.
const fullLayerBytes = 32 * 1024 * 1024;
const fullMergedSurfaceBytes = Math.floor(fullLayerBytes * 4 / 3);
assert.equal(
  LAYER_MEMORY_ADMISSION_STRATEGY,
  "tile-aware-merge-create-duplicate-and-persistent-auxiliary-layer-switch-peaks-v4",
);
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
  persistentAuxiliaryBytes: 384 * 1024,
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
    + 384 * 1024
    + fullLayerBytes * 2,
);
const tileNativeLayerSwitch = planLayerSwitchMemory({
  outgoingColdBytes: fullLayerBytes,
  incomingHotBytes: fullLayerBytes,
  adjacentPrefetchBytes: 0,
  fullMergedSurfaceBytes,
  persistentAuxiliaryBytes: 0,
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

// Multiple advanced modes need the same backdrop used by live presentation.
// At scene index zero that backdrop is the known document background when it
// is visible, so the bounded ordered fold can become a Normal/100% output.
const withOpacity = (pixel, opacity) => [
  pixel[0] * opacity,
  pixel[1] * opacity,
  pixel[2] * opacity,
  pixel[3] * opacity,
];
const transparent = [0, 0, 0, 0];
const knownDocumentBackdrop = [1, 1, 1, 1];
const bottomPixel = withOpacity([0.72, 0.14, 0.08, 0.8], 0.35);
const topPixel = withOpacity([0.05, 0.36, 0.63, 0.9], 0.7);
const foldedBottom = blendLayerPremultipliedLinear(
  knownDocumentBackdrop,
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
  "l'output Normal/100% deve conservare il fold opaco dal backdrop noto",
);
const externalBackdrop = [0.18, 0.04, 0.31, 0.65];
const originalWithExternalBackdrop = blendLayerPremultipliedLinear(
  blendLayerPremultipliedLinear(externalBackdrop, bottomPixel, "multiply"),
  topPixel,
  "screen",
);
const knownBackdropBakeOverExternalBackdrop = blendLayerPremultipliedLinear(
  externalBackdrop,
  foldedSelection,
  "normal",
);
assert.notDeepEqual(
  knownBackdropBakeOverExternalBackdrop,
  originalWithExternalBackdrop,
  "un bake creato sul fondo del documento non è valido sopra un backdrop esterno",
);
assert.match(
  core,
  /!onlyOneCompleteRasterUnit && !bakesParentBlendModesFromTransparentBackdrop/,
  "un backdrop esterno reale deve continuare a bloccare i blend avanzati",
);

console.log("layer merge verification passed");
