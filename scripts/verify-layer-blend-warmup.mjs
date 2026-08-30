import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const engineSource = source("src/brush-engine.ts");
const tileRuntimeSource = source("src/engine-layer-blend-tile-runtime.ts");
const tileCompositorSource = source("src/layer-blend-tile-compositor.ts");
const strokeRendererSource = source("src/stroke-renderer.ts");
const layerRuntimeSource = source("src/engine-layer-runtime.ts");
const mainSource = source("src/main.ts");

const blendStart = engineSource.indexOf("async ensureLayerBlendEditorResources(): Promise<void>");
const blendEnd = engineSource.indexOf("async ensureSpatialBlurEditorResources()", blendStart);
assert.ok(blendStart >= 0 && blendEnd > blendStart);
const blendBody = engineSource.slice(blendStart, blendEnd);
assert.match(blendBody, /this\.layerBlendTileWarmupAttempted/);
assert.match(blendBody, /await ensureLayerBlendTilePresentationResources\(this\)/);
assert.doesNotMatch(
  blendBody,
  /ensureMixedSceneEditorResources|finishStaticResourceCreation/,
  "the raster-only layer-blend compositor must not compile semantic scene programs",
);
assert.match(
  blendBody,
  /layerBlendTileWarmupAttempted = true;[\s\S]*?try \{[\s\S]*?ensureLayerBlendTilePresentationResources\(this\)[\s\S]*?catch \(error\)/,
  "a layer-blend warm-up failure must remain isolated from unrelated editor resources",
);
assert.match(
  blendBody,
  /finally \{[\s\S]*?this\.layerBlendEditorResourcesPromise = null/,
  "a later resource retarget must be able to request another idle warm-up",
);
const compatibilityStart = engineSource.indexOf(
  "async ensureOptionalEditorResources(): Promise<void>",
);
const compatibilityEnd = engineSource.indexOf(
  "async prewarmRasterToneCurvesResources()",
  compatibilityStart,
);
assert.ok(compatibilityStart >= 0 && compatibilityEnd > compatibilityStart);
const compatibilityBody = engineSource.slice(compatibilityStart, compatibilityEnd);
assert.match(compatibilityBody, /await this\.ensureLayerBlendEditorResources\(\)/);

assert.match(tileRuntimeSource, /layerBlendTileResourcesPromise/);
assert.match(tileRuntimeSource, /layerBlendTileResourcesRevision/);
assert.match(tileRuntimeSource, /if \(engine\.layerBlendTileResourcesPromise\)/);
assert.match(
  tileRuntimeSource,
  /revision !== engine\.layerBlendTileResourcesRevision[\s\S]*?compositor\.destroy\(\)/,
  "a release during compilation must prevent stale resources from being published",
);
assert.match(
  tileRuntimeSource,
  /releaseLayerBlendTilePresentationResources[\s\S]*?layerBlendTileResourcesRevision \+= 1[\s\S]*?layerBlendTileWarmupAttempted = false/,
);

const tileCreateStart = tileCompositorSource.indexOf("static async create(");
const tileCreateEnd = tileCompositorSource.indexOf("beginFrame(): void", tileCreateStart);
assert.ok(tileCreateStart >= 0 && tileCreateEnd > tileCreateStart);
const tileCreateBody = tileCompositorSource.slice(tileCreateStart, tileCreateEnd);
assert.match(tileCreateBody, /createRenderPipelineAsync/);
assert.match(tileCreateBody, /Promise\.allSettled/);
assert.doesNotMatch(tileCreateBody, /device\.createRenderPipeline\(/);

const strokeProgramCreateStart = strokeRendererSource.indexOf(
  "private async createProgramResources(",
);
const strokeProgramCreateEnd = strokeRendererSource.indexOf(
  "private async initialize(",
  strokeProgramCreateStart,
);
assert.ok(strokeProgramCreateStart >= 0 && strokeProgramCreateEnd > strokeProgramCreateStart);
const strokeProgramCreateBody = strokeRendererSource.slice(
  strokeProgramCreateStart,
  strokeProgramCreateEnd,
);
assert.match(strokeProgramCreateBody, /createComputePipelineAsync/);
assert.match(strokeProgramCreateBody, /Promise\.allSettled/);
assert.doesNotMatch(strokeProgramCreateBody, /this\.device\.createComputePipeline\(/);
const strokeInitializeStart = strokeProgramCreateEnd;
const strokeInitializeEnd = strokeRendererSource.indexOf(
  "setLightGlazeView(",
  strokeInitializeStart,
);
const strokeInitializeBody = strokeRendererSource.slice(
  strokeInitializeStart,
  strokeInitializeEnd,
);
assert.match(strokeInitializeBody, /acquireStrokeProgramResources/);

const modeStart = layerRuntimeSource.indexOf("export async function setLayerBlendMode(");
const modeCatch = layerRuntimeSource.indexOf("} catch (error) {", modeStart);
assert.ok(modeStart >= 0 && modeCatch > modeStart);
const successfulModePath = layerRuntimeSource.slice(modeStart, modeCatch);
assert.doesNotMatch(
  successfulModePath,
  /releaseLayerBlendTilePresentationResources\(engine\)/,
  "returning to Normal must retain the warmed compositor for the next blend choice",
);

assert.doesNotMatch(
  mainSource,
  /scheduleDeferredStartupTask|deferred-gpu-pipelines/,
  "the optional blend compositor must not be allocated during startup",
);
assert.match(
  engineSource,
  /settings\.tool === "blend"[\s\S]{0,180}!this\.blendRenderer\?\.selectedVariantPipelinesReady\(settings\)[\s\S]{0,180}await this\.ensureBlendRendererResources\(settings\)/,
  "selecting Blend must retain a dedicated variant-aware on-demand resource path",
);
assert.doesNotMatch(
  engineSource,
  /settings\.tool === "blend"[\s\S]{0,180}await this\.ensureOptionalEditorResources\(\)/,
  "Blend must not pull unrelated optional editor pipelines into its first-use path",
);

console.log("Layer blend on-demand warm-up and asynchronous pipeline verification passed.");
