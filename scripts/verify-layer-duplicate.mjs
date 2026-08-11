import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hasVisibleContent,
  historyStepTargetsMissingLayer,
  latestLayerReplayCheckpoint,
  selectLayerReplayAfterCheckpoint,
} from "../src/history-journal.ts";
import {
  planLayerDuplicateMemory,
} from "../src/layer-memory-admission-core.ts";
import { uniqueLayerDuplicateName } from "../src/mixed-scene-stack.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const engine = read("../src/brush-engine.ts");
const types = read("../src/engine-history-types.ts");
const structure = read("../src/engine-layer-structure-runtime.ts");
const journal = read("../src/history-journal.ts");
const storage = read("../src/history-storage-coordinator.ts");
const maintenance = read("../src/history-maintenance-runtime.ts");
const mixed = read("../src/mixed-scene-stack.ts");
const gpuHistoryTest = read("../src/layer-history-gpu-test.ts");
const html = read("../index.html");
const main = read("../src/main.ts");

assert.equal(uniqueLayerDuplicateName("Ink", ["Ink"]), "Ink copia");
assert.equal(
  uniqueLayerDuplicateName("Ink copia 2", ["Ink", "Ink copia", "Ink copia 2"]),
  "Ink copia 3",
);

assert.match(types, /interface LayerAddHistoryAction extends RasterHistoryCheckpoint/);
assert.match(types, /creation: "blank" \| "duplicate"/);
assert.match(types, /baseNoiseMipSmoothing: boolean/);
assert.match(structure, /seed: action\.seed,[\s\S]*?baseBounds: action\.baseBounds/);
assert.match(journal, /\| "layer-add"[\s\S]*?\| "layer-merge"/);
assert.match(storage, /action\.kind === "layer-add"[\s\S]*?this\.wrapSeed/);
assert.match(maintenance, /kind === "layer-add"/);

const duplicateStart = engine.indexOf("  private async duplicateRasterLayer(");
const duplicateEnd = engine.indexOf("  /** Duplicates the selected raster", duplicateStart);
assert.ok(duplicateStart >= 0 && duplicateEnd > duplicateStart);
const duplicate = engine.slice(duplicateStart, duplicateEnd);
assert.match(duplicate, /reserveLayerDuplicateMemory\(source\)/);
assert.ok(
  duplicate.indexOf("persistActiveLayerState()")
    < duplicate.indexOf("reserveLayerDuplicateMemory(source)")
    && duplicate.indexOf("reserveLayerDuplicateMemory(source)")
      < duplicate.indexOf("createLayerColdStorageCandidate("),
  "l'ammissione deve usare i tile persistiti e precedere qualsiasi seed GPU",
);
assert.match(duplicate, /createLayerColdStorageCandidate\([\s\S]*?"history"/);
assert.match(duplicate, /this\.layerStack\.clippingUnit\(source\.id\)/);
assert.match(duplicate, /clippingParentId: source\.clippingParentId/);
assert.match(duplicate, /applyLayerAddHistory\(this, action, 1\)/);
assert.match(duplicate, /commitHistoryActionAtomically\(this, action\)/);
assert.match(duplicate, /applyLayerAddHistory\(this, action, -1\)/);
assert.doesNotMatch(
  duplicate,
  /copyTextureToBuffer|mapAsync|getMappedRange|Uint8Array\([^)]*pixel/i,
  "Duplicate non deve portare i pixel sulla CPU",
);

for (const field of [
  "visible",
  "opacity",
  "blendMode",
  "clippingParentId",
  "contentBounds",
  "storageTileMask",
  "hasContent",
  "noiseMipSmoothing",
  "strokeStyle",
  "bevelStyle",
  "outerShadowStyle",
  "innerShadowStyle",
  "colorOverlayStyle",
]) {
  assert.match(engine, new RegExp(`record\\.${field}`), `metadato ${field} non copiato`);
}
assert.match(mixed, /duplicateSelectedSemanticAboveSelection/);
assert.match(mixed, /cloneVectorSvgNodeForHistory\(source\)/);
assert.match(mixed, /cloneRasterImageNodeForHistory\(source\)/);
assert.match(mixed, /cloneVectorTextNode\(source\)/);

const duplicateAction = {
  id: 1,
  kind: "layer-add",
  layerId: 9,
  baseBounds: { x: 0, y: 0, width: 256, height: 256 },
};
const paintAction = { id: 2, kind: "stroke", layerId: 9 };
const actions = [duplicateAction, paintAction];
assert.equal(latestLayerReplayCheckpoint(actions, 1, 9)?.action.id, 1);
assert.equal(hasVisibleContent(actions, 1, 9), true);
assert.deepEqual(
  selectLayerReplayAfterCheckpoint(
    actions,
    2,
    [{ actionId: 2, layerId: 9 }],
    9,
  ).batches.map((batch) => batch.actionId),
  [2],
);
assert.equal(historyStepTargetsMissingLayer([duplicateAction], 1, -1, new Set([9])), false);
assert.equal(historyStepTargetsMissingLayer([duplicateAction], 1, -1, new Set()), true);
assert.equal(historyStepTargetsMissingLayer([duplicateAction], 0, 1, new Set()), false);
assert.equal(historyStepTargetsMissingLayer([duplicateAction], 0, 1, new Set([9])), true);

const sparse = planLayerDuplicateMemory({
  historySeedBytes: 256,
  sourceColdBytes: 256,
  additionalHotBytes: 0,
  fullMergedSurfaceBytes: 1024,
  foldTransientBytes: 2048,
});
assert.equal(sparse.steadyBytes, 512);
assert.equal(sparse.peakBytes, 4608);

assert.match(html, /id="mobileCopyLayer"[\s\S]*?aria-label="Duplicate selected layer"/);
assert.match(main, /mobileCopyLayerButton\.addEventListener\("click"/);
assert.match(main, /await engine\.duplicateSelectedLayer\(\)/);
const mobileLayerRenderStart = main.indexOf("function syncMobileLayerToolbarState(");
const mobileLayerRenderEnd = main.indexOf("function runMobileLayerAction(", mobileLayerRenderStart);
const mobileLayerRender = main.slice(mobileLayerRenderStart, mobileLayerRenderEnd);
assert.ok(mobileLayerRenderStart >= 0 && mobileLayerRenderEnd > mobileLayerRenderStart);
assert.match(mobileLayerRender, /mobileCopyLayerButton\.disabled = mobileLayerMultiSelectEnabled/);
assert.doesNotMatch(mobileLayerRender, /mobileCopyLayerButton\.disabled = true;/);
assert.match(main, /layerSwitching = true;[\s\S]*?renderMobileLayerList\(beforeStats\);[\s\S]*?await engine\.duplicateSelectedLayer\(\)/);
assert.match(main, /setMobileLayerMergeStatus\(message, true\)/);
assert.match(main, /\.mobile-layer-row\.is-active-layer \.mobile-layer-select/);
assert.match(main, /mobileLayerMultiSelectButton\.disabled[\s\S]*?\|\| layerSwitching[\s\S]*?\|\| interactionLocked\(\)/);
assert.match(gpuHistoryTest, /const duplicateResult = await engine\.duplicateSelectedLayer\(\)/);
assert.match(gpuHistoryTest, /duplicateWasInitiallyByteExact/);
assert.match(gpuHistoryTest, /duplicatePaintUndoUsedSeedByteExactly/);
assert.match(gpuHistoryTest, /duplicateStructuralUndoRedoWasByteExact/);
assert.match(gpuHistoryTest, /duplicateCleanupReleasedTransientLayerMemory/);

console.log("Layer duplicate verification passed.");
