import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const runtime = readFileSync(
  new URL("src/engine-rasterize-layer-runtime.ts", root),
  "utf8",
);
const historyRuntime = readFileSync(
  new URL("src/engine-history-runtime.ts", root),
  "utf8",
);
const historyTypes = readFileSync(
  new URL("src/engine-history-types.ts", root),
  "utf8",
);
const replayPlanSource = readFileSync(
  new URL("src/history-replay-plan.ts", root),
  "utf8",
);
const historyStorage = readFileSync(
  new URL("src/history-storage-coordinator.ts", root),
  "utf8",
);
const historyMaintenance = readFileSync(
  new URL("src/history-maintenance-runtime.ts", root),
  "utf8",
);
const brushEngine = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const occupancySource = readFileSync(
  new URL("src/raster-occupancy-analysis.ts", root),
  "utf8",
);
const vectorRasterRuntime = readFileSync(
  new URL("src/engine-vector-raster-runtime.ts", root),
  "utf8",
);
const sceneEditor = readFileSync(
  new URL("src/scene-editor-controller.ts", root),
  "utf8",
);
const mixedScene = readFileSync(
  new URL("src/mixed-scene-controller.ts", root),
  "utf8",
);
const layerPanel = readFileSync(
  new URL("src/layer-panel-controller.ts", root),
  "utf8",
);
const html = readFileSync(new URL("index.html", root), "utf8");

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let effects;
let replayPlan;
let layerStorage;
try {
  [effects, replayPlan, layerStorage] = await Promise.all([
    moduleServer.ssrLoadModule("/src/raster-layer-effects.ts"),
    moduleServer.ssrLoadModule("/src/history-replay-plan.ts"),
    moduleServer.ssrLoadModule("/src/layer-storage-study.ts"),
  ]);
} finally {
  await moduleServer.close();
}

const first = effects.defaultRasterLayerEffects();
const second = effects.defaultRasterLayerEffects();
assert.notEqual(first, second);
assert.notEqual(first.strokeStyle, second.strokeStyle);
assert.notEqual(first.strokeStyle.color, second.strokeStyle.color);
assert.notEqual(first.colorOverlayStyle.color, second.colorOverlayStyle.color);
assert.equal(effects.rasterLayerEffectsNeedBake(first), false);

first.strokeStyle.enabled = true;
assert.equal(effects.rasterLayerEffectsNeedBake(first), true);
first.strokeStyle.width = 0;
assert.equal(effects.rasterLayerEffectsNeedBake(first), false);
first.bevelStyle.enabled = true;
assert.equal(effects.rasterLayerEffectsNeedBake(first), true);
first.bevelStyle.enabled = false;
first.colorOverlayStyle.enabled = true;
first.colorOverlayStyle.opacity = 0;
first.colorOverlayStyle.uniformAlpha = false;
assert.equal(effects.rasterLayerEffectsNeedBake(first), false);
assert.equal(effects.rasterLayerEffectsAreConfigured(first), true);
first.colorOverlayStyle.uniformAlpha = true;
assert.equal(
  effects.rasterLayerEffectsNeedBake(first),
  true,
  "uniform-alpha at zero opacity still rasterizes occupied source pixels to transparency",
);

const target = effects.defaultRasterLayerEffects();
effects.applyRasterLayerEffects(target, first);
assert.deepEqual(target, first);
assert.notEqual(target.colorOverlayStyle, first.colorOverlayStyle);
assert.notEqual(target.colorOverlayStyle.color, first.colorOverlayStyle.color);

// Opening a saved project creates an invisible cursor-zero baseline. The first
// session edit must replay on top of it, and Undo must return to it byte-for-byte
// instead of interpreting an empty journal as an empty layer.
const savedBaselineMask = new Uint32Array(8);
savedBaselineMask[0] = 1;
const savedBaseline = {
  compressed: { tag: "saved-compressed" },
  baseBounds: { x: 4, y: 5, width: 6, height: 7 },
  baseTileMask: savedBaselineMask,
  noiseMipSmoothing: true,
};
const firstSessionStroke = { id: 7, kind: "stroke", layerId: 3 };
const firstSessionBatch = { actionId: 7, layerId: 3, kind: "paint" };
const loadedAtCursorZero = replayPlan.planRasterHistoryReplay({
  actions: [firstSessionStroke],
  cursor: 0,
  batches: [firstSessionBatch],
  layerId: 3,
  periodicSelection: null,
  sessionBaseline: savedBaseline,
});
assert.equal(loadedAtCursorZero.sessionBaseline, savedBaseline);
assert.equal(loadedAtCursorZero.seedAction, undefined);
assert.equal(loadedAtCursorZero.visibleActionIds.size, 0);
assert.equal(loadedAtCursorZero.batches.length, 0);

const loadedAfterFirstStroke = replayPlan.planRasterHistoryReplay({
  actions: [firstSessionStroke],
  cursor: 1,
  batches: [firstSessionBatch],
  layerId: 3,
  periodicSelection: null,
  sessionBaseline: savedBaseline,
});
assert.equal(loadedAfterFirstStroke.sessionBaseline, savedBaseline);
assert.deepEqual([...loadedAfterFirstStroke.visibleActionIds], [7]);
assert.deepEqual(loadedAfterFirstStroke.batches, [firstSessionBatch]);

// Clear is a visible history barrier. Redoing it must stay blank instead of
// resurrecting the saved project baseline.
const clearLoadedLayer = replayPlan.planRasterHistoryReplay({
  actions: [{ id: 8, kind: "clear", layerId: 3 }],
  cursor: 1,
  batches: [],
  layerId: 3,
  periodicSelection: null,
  sessionBaseline: savedBaseline,
});
assert.equal(clearLoadedLayer.sessionBaseline, undefined);
assert.equal(clearLoadedLayer.seedAction, undefined);
assert.equal(clearLoadedLayer.batches.length, 0);

// Any newer checkpoint owns the current lineage and supersedes the saved base.
const checkpointSeed = { tag: "checkpoint" };
const checkpointAction = {
  id: 8,
  kind: "raster-filter",
  layerId: 3,
  filter: "gaussian-blur",
  seed: checkpointSeed,
  baseBounds: { x: 2, y: 3, width: 4, height: 5 },
  baseTileMask: new Uint32Array(8),
};
const checkpointPlan = replayPlan.planRasterHistoryReplay({
  actions: [checkpointAction],
  cursor: 1,
  batches: [],
  layerId: 3,
  periodicSelection: null,
  sessionBaseline: savedBaseline,
});
assert.equal(checkpointPlan.seedAction, checkpointAction);
assert.equal(checkpointPlan.sessionBaseline, undefined);

// A pre-Rasterize checkpoint is the authoritative baseline even when a loaded
// project intentionally has no earlier journal entry.
const beforeSeed = { tag: "before" };
const afterSeed = { tag: "after" };
const beforeTileMask = new Uint32Array(8);
beforeTileMask[0] = 1;
const afterTileMask = new Uint32Array(8);
const rasterizeAction = {
  id: 9,
  kind: "raster-filter",
  layerId: 3,
  filter: "rasterize-layer",
  beforeSeed,
  beforeBounds: { x: 1, y: 2, width: 3, height: 4 },
  beforeTileMask,
  seed: afterSeed,
  baseBounds: null,
  baseTileMask: afterTileMask,
};
const beforePlan = replayPlan.planRasterHistoryReplay({
  actions: [rasterizeAction],
  cursor: 0,
  batches: [],
  layerId: 3,
  periodicSelection: null,
  sessionBaseline: savedBaseline,
});
assert.equal(beforePlan.seedAction.seed, beforeSeed);
assert.deepEqual(beforePlan.seedAction.baseBounds, rasterizeAction.beforeBounds);
assert.equal(beforePlan.sessionBaseline, undefined);
assert.equal(beforePlan.batches.length, 0);
const afterPlan = replayPlan.planRasterHistoryReplay({
  actions: [rasterizeAction],
  cursor: 1,
  batches: [],
  layerId: 3,
  periodicSelection: null,
  sessionBaseline: savedBaseline,
});
assert.equal(afterPlan.seedAction.seed, afterSeed);
assert.equal(afterPlan.seedAction.baseBounds, null);
assert.equal(afterPlan.sessionBaseline, undefined);

// Two sparse occupied tiles must stay two tiles instead of becoming the whole
// bounding rectangle. Any non-zero raw component remains authoritative.
const tileWidth = layerStorage.LAYER_STORAGE_TILE_WIDTH;
const tileHeight = layerStorage.LAYER_STORAGE_TILE_HEIGHT;
const sparseWidth = tileWidth * 3;
const sparseHeight = tileHeight * 3;
const sparsePixels = new Uint8Array(sparseWidth * sparseHeight * 4);
sparsePixels[3] = 255;
sparsePixels[((sparseHeight - 1) * sparseWidth + sparseWidth - 1) * 4 + 3] = 255;
const sparseMask = layerStorage.exactLayerStorageTileMask(
  sparsePixels,
  sparseWidth,
  sparseHeight,
  4,
);
assert.equal(layerStorage.countLayerStorageTiles(sparseMask), 2);
assert.deepEqual(
  layerStorage.layerStorageTileIndices(sparseMask),
  [0, 2 * layerStorage.LAYER_STORAGE_GRID_SIZE + 2],
);
const transparentPixels = new Uint8Array(tileWidth * tileHeight * 4);
assert.equal(
  layerStorage.countLayerStorageTiles(
    layerStorage.exactLayerStorageTileMask(
      transparentPixels,
      tileWidth,
      tileHeight,
      4,
    ),
  ),
  0,
);
transparentPixels[0] = 1;
assert.equal(
  layerStorage.countLayerStorageTiles(
    layerStorage.exactLayerStorageTileMask(
      transparentPixels,
      tileWidth,
      tileHeight,
      4,
    ),
  ),
  1,
  "raw RGB below zero alpha remains byte-authoritative",
);

assert.match(
  runtime,
  /materializeLayerCompositeSource\(\s*engine,\s*record,\s*"structural-history"/,
  "Rasterize must use the same analytic layer-effects bake as structural composition",
);
assert.match(
  runtime,
  /origin: \{ x: copyBounds\.x, y: copyBounds\.y \}[\s\S]*?width: copyBounds\.width,[\s\S]*?height: copyBounds\.height/,
  "only initialized bake bounds may be copied into authoritative pixels",
);
assert.match(runtime, /analyzeRasterTextureOccupancy\(/);
assert.match(runtime, /let resultTileMask = originalTileMask\.slice\(\)/);
assert.match(runtime, /if \(!bakedEffects\)[\s\S]*?seed = beforeSeed/);
assert.match(runtime, /else if \(record\.hasContent\)/);
assert.match(runtime, /baseBounds: resultBounds \? \{ \.\.\.resultBounds \} : null/);
assert.match(runtime, /beforeSeed,[\s\S]*?beforeBounds:[\s\S]*?beforeTileMask:/);
assert.match(
  runtime,
  /rebuildActiveLayerFromHistory\(engine, \{[\s\S]*?seed: beforeSeed,[\s\S]*?baseTileMask: originalTileMask/,
  "failed Rasterize must restore its immutable pre-action checkpoint",
);
assert.match(runtime, /applyRasterLayerEffects\(record, effectsAfter\)/);
assert.match(runtime, /commitHistoryActionAtomically\(engine, action\)/);
assert.equal(
  runtime.match(/commitHistoryActionAtomically\(engine, action\)/g)?.length,
  1,
  "Rasterize must publish exactly one Undo action",
);
assert.match(runtime, /filter: "rasterize-layer"/);
assert.match(runtime, /preservesLayerOpacity: true/);
assert.match(runtime, /preservesBlendMode: true/);
assert.match(runtime, /preservesClipping: true/);
assert.doesNotMatch(runtime, /record\.(?:blendMode|opacity|clippingParentId)\s*=/);
assert.match(runtime, /engine\.scheduleEffectsScratchShrink\(\)/);
assert.match(runtime, /engine\.scheduleBevelFieldShrink\(\)/);
assert.match(runtime, /record\.rasterSource !== null/);
assert.match(runtime, /if \(!effectsConfigured && !detachedSource\) return null/);

assert.match(historyTypes, /filter: "rasterize-layer"[\s\S]*?effectsBefore[\s\S]*?effectsAfter/);
assert.match(
  historyTypes,
  /filter: "rasterize-layer";[\s\S]*?beforeSeed: LayerColdStorageResources;[\s\S]*?beforeBounds: DirtyRect;[\s\S]*?beforeTileMask: Uint32Array;/,
);
assert.match(
  replayPlanSource,
  /nextAction\.beforeSeed[\s\S]*?nextAction\.beforeBounds[\s\S]*?nextAction\.beforeTileMask/,
);
assert.match(
  historyRuntime,
  /function rasterEffectsHistoryTransition\([\s\S]*?action\.filter !== "rasterize-layer"/,
);
assert.match(historyStorage, /addSeed\(crossed\.beforeSeed\)/);
assert.match(historyStorage, /action\.beforeSeed = this\.wrapSeed\(/);
assert.match(historyMaintenance, /account\(action\.beforeSeed\)/);
assert.match(historyRuntime, /destroyLayerColdStorage\(action\.beforeSeed\)/);
assert.match(brushEngine, /destroyLayerColdStorage\(action\.beforeSeed\)/);

assert.match(occupancySource, /gpu-exact-nonzero-pixel-bounds-and-256-tile-mask-v1/);
assert.match(occupancySource, /if \(any\(value != vec4<f32>\(0\.0\)\)\)/);
assert.match(occupancySource, /atomicOr\(&result\.mask/);
assert.match(occupancySource, /atomicMin\(&result\.minX/);
assert.match(occupancySource, /atomicMax\(&result\.maxY/);
assert.match(occupancySource, /GPUBufferUsage\.MAP_READ/);
assert.match(occupancySource, /uniformBuffer\.destroy\(\)/);
assert.match(occupancySource, /readbackBuffer\.destroy\(\)/);
assert.match(occupancySource, /resultBuffer\.destroy\(\)/);

assert.match(vectorRasterRuntime, /analyzeRasterTextureOccupancy\(/);
assert.match(vectorRasterRuntime, /record\.storageTileMask\.set\(occupancy\.tileMask\)/);
assert.match(vectorRasterRuntime, /baseBounds: \{ \.\.\.occupancy\.bounds \}/);
assert.doesNotMatch(vectorRasterRuntime, /markLayerStorageRect\(record\.storageTileMask/);
assert.match(
  historyRuntime,
  /applyRasterLayerEffects\([\s\S]*?await rebuildActiveLayerFromHistory\(engine\)/,
  "Undo/Redo must restore effect metadata before rebuilding authoritative pixels",
);
assert.match(
  historyRuntime,
  /if \(rasterEffectsTransition\)[\s\S]*?restoreEffectsWorkbenchToActiveLayer\([\s\S]*?"history-replay"/,
  "Undo must recreate effect resources on demand after Rasterize released them",
);

assert.match(sceneEditor, /target\.kind !== "raster" && target\.kind !== "svg"/);
assert.match(sceneEditor, /this\.options\.engine\.rasterizeActiveRasterLayer\(\)/);
assert.match(sceneEditor, /vector\.rasterizeSelectedSvgLayer\(\)/);
assert.match(mixedScene, /async rasterizeSelectedSvgLayer\(\)/);
assert.match(mixedScene, /return this\.rasterizeSelectedSvg\(true\)/);
assert.match(mixedScene, /if \(propagateError\) throw error/);
assert.match(layerPanel, /properties\.kind === "raster" \|\| properties\.kind === "svg"/);
assert.match(html, /id="mobileLayerRasterize"[\s\S]*?>\s*Rasterize\s*<\/button>/);

console.log(
  "Layer Rasterize: exact occupancy, loaded-project Undo/Redo, effect/source bake, blend preservation and SVG routing verified.",
);
