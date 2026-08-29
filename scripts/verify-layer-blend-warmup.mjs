import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const engineSource = source("src/brush-engine.ts");
const tileRuntimeSource = source("src/engine-layer-blend-tile-runtime.ts");
const tileCompositorSource = source("src/layer-blend-tile-compositor.ts");
const strokeRendererSource = source("src/stroke-renderer.ts");
const layerRuntimeSource = source("src/engine-layer-runtime.ts");
const mainSource = source("src/main.ts");

const optionalStart = engineSource.indexOf("async ensureOptionalEditorResources(): Promise<void>");
const optionalEnd = engineSource.indexOf("allocateLayerTexture(", optionalStart);
assert.ok(optionalStart >= 0 && optionalEnd > optionalStart);
const optionalBody = engineSource.slice(optionalStart, optionalEnd);
assert.match(optionalBody, /const layerBlendResourcesPending = this\.mixedSceneEnabled/);
assert.match(optionalBody, /!this\.layerBlendTileWarmupAttempted/);
assert.match(optionalBody, /await ensureLayerBlendTilePresentationResources\(this\)/);
assert.match(
  optionalBody,
  /layerBlendTileWarmupAttempted = true;[\s\S]*?try \{[\s\S]*?ensureLayerBlendTilePresentationResources\(this\)[\s\S]*?catch \(error\)/,
  "an optional warm-up failure must not block unrelated editor resources",
);
assert.ok(
  optionalBody.indexOf('finishStaticResourceCreation(this, "optional")')
    < optionalBody.indexOf("ensureLayerBlendTilePresentationResources(this)"),
  "the shared mixed-scene modules must exist before the blend compositor warm-up",
);
assert.match(
  optionalBody,
  /finally \{[\s\S]*?this\.optionalEditorResourcesPromise = null/,
  "a later resource retarget must be able to request another idle warm-up",
);

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

const strokeInitializeStart = strokeRendererSource.indexOf("private async initialize(");
const strokeInitializeEnd = strokeRendererSource.indexOf("setLightGlazeView(", strokeInitializeStart);
assert.ok(strokeInitializeStart >= 0 && strokeInitializeEnd > strokeInitializeStart);
const strokeInitializeBody = strokeRendererSource.slice(
  strokeInitializeStart,
  strokeInitializeEnd,
);
assert.match(strokeInitializeBody, /createComputePipelineAsync/);
assert.match(strokeInitializeBody, /Promise\.allSettled/);
assert.doesNotMatch(strokeInitializeBody, /this\.device\.createComputePipeline\(/);

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
  /settings\.tool === "blend" && !this\.blendRenderer[\s\S]{0,160}await this\.ensureOptionalEditorResources\(\)/,
  "selecting Blend must retain an explicit on-demand resource path",
);

console.log("Layer blend on-demand warm-up and asynchronous pipeline verification passed.");
