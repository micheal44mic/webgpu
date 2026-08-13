import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (sourcePath) => readFileSync(new URL(sourcePath, import.meta.url), "utf8");
const core = read("../../../src/layer-merge-core.ts");
const runtime = read("../../../src/engine-layer-merge-runtime.ts");
const history = read("../../../src/engine-history-types.ts");
const historyRuntime = read("../../../src/engine-history-runtime.ts");
const historyService = read("../../../src/history-service.ts");
const engine = read("../../../src/brush-engine.ts");
const controller = read("../../../src/mixed-scene-controller.ts");

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
assert.match(
  historyService,
  /appendWithoutPush\(this\.discardedLayerMergeActions, action\)/,
  "il proprietario History deve raccogliere i merge abbandonati dal Redo",
);
assert.match(historyRuntime, /destroyLayerMergeHistorySeeds\(action\)/);
assert.match(engine, /get discardedLayerMergeHistoryActions\(\): LayerMergeHistoryAction\[\]/);
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
