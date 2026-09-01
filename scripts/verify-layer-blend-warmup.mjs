import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const engineSource = source("src/brush-engine.ts");
const tileRuntimeSource = source("src/engine-layer-blend-tile-runtime.ts");
const tileCompositorSource = source("src/layer-blend-tile-compositor.ts");
const strokeRendererSource = source("src/stroke-renderer.ts");
const layerRuntimeSource = source("src/engine-layer-runtime.ts");
const mainSource = source("src/main.ts");
const staticResourcesSource = source("src/engine-runtime-misc.ts");
const presentationResourcesSource = source("src/mixed-scene-presentation-resources.ts");
const vectorRuntimeSource = source("src/engine-vector-text-runtime.ts");

const blendStart = engineSource.indexOf("async ensureLayerBlendEditorResources(): Promise<void>");
const blendEnd = engineSource.indexOf("async ensureSpatialBlurEditorResources()", blendStart);
assert.ok(blendStart >= 0 && blendEnd > blendStart);
const blendBody = engineSource.slice(blendStart, blendEnd);
assert.match(blendBody, /this\.layerBlendTileWarmupAttempted/);
assert.match(blendBody, /await ensureLayerBlendTilePresentationResources\(this\)/);
for (const resource of [
  "mixedScenePresentShaderModule",
  "mixedSceneClearShaderModule",
  "mixedScenePresentBindGroupLayout",
  "mixedSceneBackgroundBindGroupLayout",
  "mixedSceneBackgroundBindGroup",
  "mixedSceneRasterSegmentBindGroupLayout",
  "mixedScenePresentPipeline",
]) {
  assert.match(
    blendBody,
    new RegExp(`this\\.${resource} !== null`),
    `the layer-blend readiness gate must include ${resource}`,
  );
}
assert.match(
  blendBody,
  /await ensureMixedScenePresentationResources\(this\)[\s\S]*?await ensureLayerBlendTilePresentationResources\(this\)/,
  "layer-blend warm-up must prepare the shared checker program before its tile compositor",
);
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
assert.match(
  successfulModePath,
  /candidateAdvanced[\s\S]*?await ensureMixedScenePresentationResources\(engine\)[\s\S]*?await prewarmMixedSceneLinearTextureForLayerBlend/,
  "a direct first blend change must own its minimal presentation-resource gate",
);
assert.match(
  successfulModePath,
  /candidateUsesTileComposition = candidateAdvanced[\s\S]*?layerBlendTilePresentationEligible\(engine\)[\s\S]*?candidateNeedsTile = candidateAdvanced[\s\S]*?layerBlendTilePresentationEligible\(engine\)/,
  "blend changes must classify both first-use and already-advanced raster documents without viewport over-allocation",
);
assert.equal(
  (successfulModePath.match(/await ensureLayerBlendTilePresentationResources\(engine\);/g) ?? []).length,
  2,
  "both live and rebuilt blend paths must gate their raster-only tile candidate",
);
assert.match(
  successfulModePath,
  /record\.blendMode = blendMode;[\s\S]*?if \(!candidateUsesTileComposition\) \{[\s\S]*?releaseLayerBlendTilePresentationResources\(engine\)/,
  "a live transition away from tile composition must release its document-sized working set",
);
assert.doesNotMatch(
  successfulModePath,
  /semanticCount/,
  "hidden semantic nodes must not force full-size viewport blend scratch during a layer-mode edit",
);

const compositionFieldStart = layerRuntimeSource.indexOf(
  "async function setLayerCompositionField(",
);
const compositionFieldEnd = layerRuntimeSource.indexOf(
  "export async function setLayerContentOpacity(",
  compositionFieldStart,
);
assert.ok(compositionFieldStart >= 0 && compositionFieldEnd > compositionFieldStart);
const compositionFieldBody = layerRuntimeSource.slice(
  compositionFieldStart,
  compositionFieldEnd,
);
assert.match(
  compositionFieldBody,
  /await engine\.waitForIdle\(\);[\s\S]*?engine\.layerPresentationFrozen = true;[\s\S]*?apply\(record\);[\s\S]*?candidateUsesTileComposition = candidateAdvanced[\s\S]*?layerBlendTilePresentationEligible\(engine\)/,
  "a direct cutout or tonal-blend change must freeze before publishing and classifying its candidate path",
);
assert.match(
  compositionFieldBody,
  /if \(candidateNeedsViewportBlend\) \{[\s\S]*?await engine\.ensureMixedSceneEditorResources\(\);[\s\S]*?\} else \{[\s\S]*?await ensureMixedScenePresentationResources\(engine\);/,
  "semantic viewport composition must own the full gate while raster-only composition uses the minimal gate",
);
assert.match(
  compositionFieldBody,
  /prewarmMixedSceneLinearTextureForLayerBlend\([\s\S]*?candidateNeedsViewportBlend,[\s\S]*?if \(candidateUsesTileComposition\) \{[\s\S]*?await ensureLayerBlendTilePresentationResources\(engine\);/,
  "advanced composition must allocate the tile compositor only for its current raster-only candidate",
);
assert.doesNotMatch(
  compositionFieldBody,
  /usesOrderedScenePresentation\(\)/,
  "candidate composition fields must not mistake raster-only ordered presentation for viewport composition",
);
assert.doesNotMatch(
  compositionFieldBody,
  /semanticCount/,
  "cutout and tonal edits must allocate viewport scratch only for the currently selected family",
);

const rebuildStart = engineSource.indexOf("async rebuildMergedLayerSurfaces(");
const rebuildEviction = engineSource.indexOf(
  "this.mergedBelow = null",
  rebuildStart,
);
assert.ok(rebuildStart >= 0 && rebuildEviction > rebuildStart);
const rebuildPreflight = engineSource.slice(rebuildStart, rebuildEviction);
assert.match(
  rebuildPreflight,
  /this\.layerPresentationFrozen = true;[\s\S]*?advancedLayerCompositionRequired = orderedLayerBlendPresentationRequired\(this\)/,
  "every structural or history transition must freeze before classifying optional presentation resources",
);
assert.match(
  rebuildPreflight,
  /needsViewportBlend = advancedLayerCompositionRequired[\s\S]*?&& !this\.usesLayerBlendTilePresentation\(\)[\s\S]*?if \(needsViewportBlend \|\| clippingScratchRequired\) \{[\s\S]*?ensureMixedSceneEditorResources\(\)[\s\S]*?else \{[\s\S]*?ensureMixedScenePresentationResources\(this\)/,
  "the central transition gate must preflight the currently selected viewport or compact family",
);
assert.match(
  rebuildPreflight,
  /orderedPresentationRequired = this\.usesOrderedScenePresentation\(\)[\s\S]*?prewarmMixedSceneLinearTextureForLayerBlend\([\s\S]*?needsViewportBlend,[\s\S]*?if \(advancedLayerCompositionRequired && this\.usesLayerBlendTilePresentation\(\)\) \{[\s\S]*?ensureLayerBlendTilePresentationResources\(this\)/,
  "central rebuilds must prewarm every ordered linear target and allocate tile resources only for the current tile family",
);
assert.doesNotMatch(
  rebuildPreflight,
  /semanticCount/,
  "the central transition gate must not retain full-size viewport scratch for hidden semantic nodes",
);
assert.match(
  engineSource,
  /candidatePublished = true;[\s\S]*?!this\.usesLayerBlendTilePresentation\(\)[\s\S]*?releaseLayerBlendTilePresentationResources\(this\)[\s\S]*?releaseUnusedMixedSceneBlendScratch\(this\);\s*releaseUnusedMixedSceneClippingScratch\(this\);\s*this\.layerPresentationFrozen = false;/,
  "a successful family transition must release obsolete tile and viewport working sets before presentation resumes",
);

const recreateStart = layerRuntimeSource.indexOf(
  "export async function recreateLayerResources(",
);
const recreateEnd = layerRuntimeSource.indexOf(
  "export async function retargetEffectsWorkingSetInternal(",
  recreateStart,
);
assert.ok(recreateStart >= 0 && recreateEnd > recreateStart);
const recreateBody = layerRuntimeSource.slice(recreateStart, recreateEnd);
const recreateOrderedPreflightStart = recreateBody.lastIndexOf(
  "if (engine.usesOrderedScenePresentation())",
);
assert.ok(recreateOrderedPreflightStart >= 0);
const recreateOrderedPreflight = recreateBody.slice(recreateOrderedPreflightStart);
assert.match(
  recreateOrderedPreflight,
  /if \(engine\.usesOrderedScenePresentation\(\)\) \{[\s\S]*?advancedLayerCompositionRequired = orderedLayerBlendPresentationRequired\(engine\)[\s\S]*?needsViewportBlend = advancedLayerCompositionRequired[\s\S]*?&& !engine\.usesLayerBlendTilePresentation\(\)[\s\S]*?prewarmMixedSceneLinearTextureForLayerBlend\([\s\S]*?needsViewportBlend,/,
  "document recreation must rebuild the linear target for simple ordered scenes as well as advanced ones",
);
assert.match(
  recreateOrderedPreflight,
  /if \(advancedLayerCompositionRequired && engine\.usesLayerBlendTilePresentation\(\)\) \{\s*await ensureLayerBlendTilePresentationResources\(engine\);/,
  "document recreation must allocate tile resources only when the recreated scene currently selects the tile family",
);
assert.equal(
  (recreateOrderedPreflight.match(/ensureLayerBlendTilePresentationResources\(engine\)/g) ?? []).length,
  1,
  "document recreation must not retain an off-family tile fallback",
);
assert.doesNotMatch(
  recreateOrderedPreflight,
  /semanticCount/,
  "document recreation must not infer viewport scratch retention from hidden semantic nodes",
);

const linearTextureStart = vectorRuntimeSource.indexOf(
  "export function ensureMixedSceneLinearTexture(",
);
const linearTextureEnd = vectorRuntimeSource.indexOf(
  "export function rebuildVectorTextDependentDisplayBindGroups(",
  linearTextureStart,
);
assert.ok(linearTextureStart >= 0 && linearTextureEnd > linearTextureStart);
const linearTextureBody = vectorRuntimeSource.slice(linearTextureStart, linearTextureEnd);
assert.match(
  linearTextureBody,
  /needsAdvancedBlend = !engine\.usesLayerBlendTilePresentation\(\)[\s\S]*?rasterLayerNeedsBackdropComposition/,
  "steady-state viewport scratch must follow the current presentation family",
);
assert.doesNotMatch(
  linearTextureBody,
  /semanticCount/,
  "a normal tile frame must release viewport-sized blend scratch even when hidden semantic nodes exist",
);

assert.doesNotMatch(
  mainSource,
  /scheduleDeferredStartupTask|deferred-gpu-pipelines/,
  "the optional blend compositor must not be allocated during startup",
);
assert.match(
  mainSource,
  /openLayerOptions: \(trigger\) => \{[\s\S]*?runRuntimeOperation\([\s\S]*?"Preparing Layer Options"[\s\S]*?ensureLayerBlendEditorResources\(\)[\s\S]*?waitForIdle\(\)[\s\S]*?open\("layer-options", trigger\)/,
  "opening Layer Options must expose the one-time blend-compositor preparation through the shared overlay",
);
assert.match(
  mainSource,
  /setSelectedLayerBlendMode: \(blendMode\) => \{[\s\S]*?runRuntimeOperation\([\s\S]*?"Applying layer blend mode"[\s\S]*?setRasterBlendMode\(properties\.key, blendMode\)[\s\S]*?waitForIdle\(\)/,
  "a first layer blend change must remain visibly loading until its composition work reaches the GPU fence",
);
assert.match(presentationResourcesSource, /createRenderPipelineAsync\(engine\.device/);
assert.match(presentationResourcesSource, /const creationPromises = new WeakMap/);
assert.doesNotMatch(
  presentationResourcesSource,
  /vectorText|rasterImage|mixedSceneRasterSegmentShader|mixedSceneTextSegment/,
  "the shared checker gate must not compile semantic-scene programs",
);
assert.match(
  staticResourcesSource,
  /if \(createOptional\) \{\s*await ensureMixedSceneVectorShapeResources\(engine\);\s*await ensureMixedScenePresentationResources\(engine\)/,
  "the full optional graph must reuse the small shape and checker programs",
);
const rasterSegmentStart = vectorRuntimeSource.indexOf(
  "export function createMixedSceneRasterSegmentResources(",
);
const rasterSegmentEnd = vectorRuntimeSource.indexOf(
  "export function ensureVectorTextGpuScratch(",
  rasterSegmentStart,
);
assert.ok(rasterSegmentStart >= 0 && rasterSegmentEnd > rasterSegmentStart);
const rasterSegmentBody = vectorRuntimeSource.slice(rasterSegmentStart, rasterSegmentEnd);
assert.match(
  rasterSegmentBody,
  /const layout = engine\.mixedSceneRasterSegmentBindGroupLayout;[\s\S]*?createBindGroup\(\{[\s\S]*?layout,/,
  "raster-run rebuilds must consume the exact layout published by the shared blend gate",
);
assert.match(staticResourcesSource, /engine\.mixedScenePresentShaderModule \?\?=/);
assert.match(staticResourcesSource, /engine\.mixedScenePresentBindGroupLayout \?\?=/);
assert.match(
  staticResourcesSource,
  /const mixedScenePresentPipelinePromise = engine\.mixedScenePresentPipeline/,
);
assert.match(staticResourcesSource, /engine\.mixedSceneClearShaderModule \?\?=/);
assert.match(staticResourcesSource, /engine\.mixedSceneBackgroundBindGroupLayout \?\?=/);
assert.match(staticResourcesSource, /engine\.mixedSceneBackgroundBindGroup \?\?=/);
assert.match(staticResourcesSource, /engine\.mixedSceneRasterSegmentBindGroupLayout \?\?=/);
for (const resource of [
  "mixedSceneClearShaderModule",
  "mixedSceneBackgroundBindGroupLayout",
  "mixedSceneBackgroundBindGroup",
  "mixedSceneRasterSegmentBindGroupLayout",
]) {
  assert.match(
    presentationResourcesSource,
    new RegExp(`engine\\.${resource}`),
    `the raster-only tile compositor requires ${resource}`,
  );
}
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

const previousGpuShaderStage = globalThis.GPUShaderStage;
globalThis.GPUShaderStage = { FRAGMENT: 2 };
const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let ensureMixedScenePresentationResources;
try {
  ({ ensureMixedScenePresentationResources } = await moduleServer.ssrLoadModule(
    "/src/mixed-scene-presentation-resources.ts",
  ));
} finally {
  await moduleServer.close();
}

function presentationHarness(failFirstPipeline = false) {
  const calls = {
    shaderModules: 0,
    bindGroupLayouts: 0,
    bindGroups: 0,
    pipelines: 0,
  };
  let shouldFail = failFirstPipeline;
  const device = {
    createShaderModule(descriptor) {
      calls.shaderModules += 1;
      return {
        descriptor,
        getCompilationInfo: async () => ({ messages: [] }),
      };
    },
    createBindGroupLayout(descriptor) {
      calls.bindGroupLayouts += 1;
      return { descriptor };
    },
    createBindGroup(descriptor) {
      calls.bindGroups += 1;
      return { descriptor };
    },
    createPipelineLayout(descriptor) {
      return { descriptor };
    },
    async createRenderPipelineAsync(descriptor) {
      calls.pipelines += 1;
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Injected checker pipeline failure.");
      }
      return { descriptor };
    },
  };
  return {
    calls,
    engine: {
      device,
      canvasFormat: "bgra8unorm",
      displayUniformBuffer: {},
      mixedScenePresentShaderModule: null,
      mixedSceneClearShaderModule: null,
      mixedScenePresentBindGroupLayout: null,
      mixedSceneBackgroundBindGroupLayout: null,
      mixedSceneBackgroundBindGroup: null,
      mixedSceneRasterSegmentBindGroupLayout: null,
      mixedScenePresentPipeline: null,
    },
  };
}

try {
  const concurrent = presentationHarness();
  await Promise.all([
    ensureMixedScenePresentationResources(concurrent.engine),
    ensureMixedScenePresentationResources(concurrent.engine),
  ]);
  assert.deepEqual(concurrent.calls, {
    shaderModules: 2,
    bindGroupLayouts: 3,
    bindGroups: 1,
    pipelines: 1,
  });
  const published = [
    concurrent.engine.mixedScenePresentShaderModule,
    concurrent.engine.mixedSceneClearShaderModule,
    concurrent.engine.mixedScenePresentBindGroupLayout,
    concurrent.engine.mixedSceneBackgroundBindGroupLayout,
    concurrent.engine.mixedSceneBackgroundBindGroup,
    concurrent.engine.mixedSceneRasterSegmentBindGroupLayout,
    concurrent.engine.mixedScenePresentPipeline,
  ];
  assert(published.every(Boolean));
  await ensureMixedScenePresentationResources(concurrent.engine);
  assert.deepEqual(concurrent.calls, {
    shaderModules: 2,
    bindGroupLayouts: 3,
    bindGroups: 1,
    pipelines: 1,
  }, "a warm device must reuse the exact seven-resource set");

  const retry = presentationHarness(true);
  await assert.rejects(
    ensureMixedScenePresentationResources(retry.engine),
    /Injected checker pipeline failure/,
  );
  assert([
    retry.engine.mixedScenePresentShaderModule,
    retry.engine.mixedSceneClearShaderModule,
    retry.engine.mixedScenePresentBindGroupLayout,
    retry.engine.mixedSceneBackgroundBindGroupLayout,
    retry.engine.mixedSceneBackgroundBindGroup,
    retry.engine.mixedSceneRasterSegmentBindGroupLayout,
    retry.engine.mixedScenePresentPipeline,
  ].every((resource) => resource === null), "a failed gate must publish no partial set");
  await ensureMixedScenePresentationResources(retry.engine);
  assert.equal(retry.calls.pipelines, 2, "a failed first compilation must remain retryable");
} finally {
  if (previousGpuShaderStage === undefined) delete globalThis.GPUShaderStage;
  else globalThis.GPUShaderStage = previousGpuShaderStage;
}

console.log("Layer blend on-demand warm-up and asynchronous pipeline verification passed.");
