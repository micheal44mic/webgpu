import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const section = (contents, startMarker, endMarker) => {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing section ${startMarker}`);
  return contents.slice(start, end);
};
const conditionalBlocks = (contents, condition) => {
  const marker = `if (${condition}) {`;
  const blocks = [];
  let cursor = 0;
  while (cursor < contents.length) {
    const start = contents.indexOf(marker, cursor);
    if (start < 0) break;
    const open = contents.indexOf("{", start + marker.length - 1);
    let depth = 0;
    let end = open;
    for (; end < contents.length; end += 1) {
      if (contents[end] === "{") depth += 1;
      if (contents[end] === "}") depth -= 1;
      if (depth === 0) break;
    }
    assert.ok(end < contents.length, `Unclosed conditional block ${marker}`);
    blocks.push(contents.slice(start, end + 1));
    cursor = end + 1;
  }
  return blocks;
};

const main = source("src/main.ts");
const engine = source("src/brush-engine.ts");
const projectRuntime = source("src/engine-project-runtime.ts");
const transformRuntime = source("src/engine-raster-transform-runtime.ts");
const engineRuntimeMisc = source("src/engine-runtime-misc.ts");
const activePaintResources = source("src/mixed-scene-active-paint-resources.ts");

const staticResourceCreation = section(
  engineRuntimeMisc,
  "export async function finishStaticResourceCreation(",
  "export async function ensureAdvancedCanvasPresentationPipelines(",
);
const optionalCreationBlocks = conditionalBlocks(staticResourceCreation, "createOptional");
assert.equal(optionalCreationBlocks.length, 1, "Optional resource creation must stay in one batch");
for (const optionalBlock of optionalCreationBlocks) {
  assert.doesNotMatch(
    optionalBlock,
    /engine\.device\.createRenderPipeline\(/,
    "Optional editor resources must never synchronously compile a render pipeline",
  );
  assert.match(
    optionalBlock,
    /createRenderPipelineAsync\(engine\.device,/,
    "Optional render pipelines must use asynchronous compilation",
  );
  assert.match(
    optionalBlock,
    /await Promise\.all\(/,
    "Optional render pipelines must publish through an asynchronous readiness batch",
  );
}
assert.doesNotMatch(
  activePaintResources,
  /engine\.device\.createRenderPipeline\(/,
  "Active-paint capabilities must not synchronously compile render pipelines",
);
assert.match(
  activePaintResources,
  /await Promise\.all\(/,
  "Active-paint pipeline families should resolve atomically in parallel",
);
const optionalPipelineBatch = section(
  staticResourceCreation,
  "    // These programs are independent and use asynchronous WebGPU compilation.",
  "    if (engine.deviceLostError)",
);
assert.match(
  optionalPipelineBatch,
  /\] = await Promise\.all\(\[/,
  "Optional presentation pipelines and active-paint families must share one readiness batch",
);
for (const pipelinePromise of [
  "vectorTextDisplayPipelinePromise",
  "mixedSceneRasterSegmentPipelinePromise",
  "mixedSceneRasterSegmentSourceAtopPipelinePromise",
  "mixedSceneTextSegmentPipelinePromise",
  "mixedSceneTextSegmentSourceAtopPipelinePromise",
  "mixedSceneShapePreviewPipelinePromise",
  "rasterImageMipmapPipelinePromise",
  "rasterImagePremultiplyPipelinePromise",
  "rasterImageMixedScenePipelinePromise",
  "mixedSceneClearPipelinePromise",
  "mixedScenePresentPipelinePromise",
  "mixedSceneBackgroundPipelinePromise",
  "mixedSceneClippingScratchCompositePipelinePromise",
  "layerBlendCompositorPipelinePromise",
  "layerBlendViewportDocumentMaskPipelinePromise",
]) {
  assert.match(
    optionalPipelineBatch,
    new RegExp(`\\n\\s*${pipelinePromise},`),
    `${pipelinePromise} must participate in the shared optional pipeline batch`,
  );
}
for (const activePipelineFamily of [
  "ensureMixedSceneActiveBasePipelines",
  "ensureMixedSceneActiveRasterStrokePipelines",
  "ensureMixedSceneActiveThicknessTailPipelines",
  "ensureMixedSceneActiveLightGlazePipelines",
]) {
  assert.match(
    optionalPipelineBatch,
    new RegExp(`${activePipelineFamily}\\(engine\\),`),
    `${activePipelineFamily} must participate in the shared optional pipeline batch`,
  );
}
assert.equal(
  [...staticResourceCreation.matchAll(/engine\.device\.createRenderPipeline\(/g)].length,
  2,
  "Only the two intentionally synchronous core render-pipeline sites may remain",
);

const toolSelection = section(
  main,
  "function selectCanvasToolWithMixedScene(tool: CanvasInputTool): boolean",
  "const inactiveTransformAction",
);
assert.match(
  toolSelection,
  /tool === "shapes"\s*\? "shape-preview"\s*:\s*"raster-transform"/,
  "Shapes and native raster transforms must request different preparation scopes",
);
assert.match(toolSelection, /initializeMixedSceneController\(initializationScope\)/);
assert.match(
  toolSelection,
  /initializationScope === "raster-transform"[\s\S]*?preparations\.push\(engine\.prewarmRasterTransformPrograms\(mode\)/,
  "Transform/Warp selection should register the small mode bundle without blocking the click",
);
assert.doesNotMatch(toolSelection, /await engine\.prewarmRasterTransformPrograms/);
assert.match(
  toolSelection,
  /canvasStartupOverlay\.runRuntimeOperation\([\s\S]*?Promise\.all\(preparations\)/,
  "cold tool preparation must stay inside the shared loading lifecycle",
);
assert.doesNotMatch(
  toolSelection,
  /ensureOptionalEditorResources/,
  "Selecting Transform/Warp must not request the compatibility mega-gate",
);

const controllerInitialization = section(
  main,
  "async function initializeMixedSceneController(",
  "void engine.initialize()",
);
assert.match(
  controllerInitialization,
  /scope === "controller-only"\s*\? Promise\.resolve\(\)/,
  "opening a lightweight editor panel must not compile GPU resources",
);
assert.match(
  controllerInitialization,
  /scope === "semantic-scene"[\s\S]*?engine\.ensureMixedSceneEditorResources\(\)/,
);
assert.match(
  controllerInitialization,
  /scope === "shape-preview"[\s\S]*?engine\.ensureShapePreviewEditorResources\(\)[\s\S]*?engine\.ensureVectorShapeEditorResources\(\)/,
  "Shapes must await preview and permanent vector resources before reporting readiness",
);
assert.match(
  controllerInitialization,
  /scope === "vector-shape"[\s\S]*?engine\.ensureVectorShapeEditorResources\(\)/,
  "plain SVG import must request only preview and indexed mesh fill",
);
assert.doesNotMatch(
  controllerInitialization,
  /ensureOptionalEditorResources/,
  "The controller shell must not implicitly compile every optional capability",
);

const toolSettingsOpening = section(
  main,
  "  openToolSettings: (kind, trigger) => {",
  "  runVectorCommand: (command) => {",
);
assert.match(
  toolSettingsOpening,
  /requestedKind === "text"\s*\? "controller-only"\s*:\s*"semantic-scene"/,
  "the base Text panel must load the controller shell without the optional GPU graph",
);
assert.match(
  toolSettingsOpening,
  /"Preparing Text"[\s\S]*?revealImmediately: true, waitForPaint: true/,
  "the first Text panel load must paint feedback before loading its controller chunk",
);
assert.match(
  toolSettingsOpening,
  /requestSequence === toolSettingsOpenRequestSequence/,
  "a stale panel request must not reopen after a newer tap",
);
const textPanelOpenIndex = toolSettingsOpening.indexOf(
  "mobileToolSettingsSheet?.open(requestedKind, trigger)",
);
const textWarmupScheduleIndex = toolSettingsOpening.indexOf(
  "scheduleTextCreationWarmupAfterPanelPaint(requestedController, requestIsCurrent)",
);
assert.ok(
  textPanelOpenIndex >= 0 && textWarmupScheduleIndex > textPanelOpenIndex,
  "Text resource warm-up must be scheduled only after the settings panel opens",
);

const textCreationWarmup = section(
  main,
  "function scheduleTextCreationWarmupAfterPanelPaint(",
  "async function initializeMixedSceneController(",
);
assert.match(
  textCreationWarmup,
  /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{/,
  "Text warm-up needs a paint checkpoint before it starts expensive work",
);
assert.match(
  textCreationWarmup,
  /mobileToolSettingsSheet\?\.isOpen !== true[\s\S]*?mobileToolSettingsSheet\.toolKind !== "text"/,
  "stale or closed Text panels must not start background warm-up",
);
assert.match(
  textCreationWarmup,
  /void controller\.prepareTextCreationResources\(\)\.catch\(\(error\) => \{/,
  "background Text warm-up failures must be handled without an unhandled rejection",
);
assert.match(
  textCreationWarmup,
  /recordOperation\([\s\S]*?"prepare-text-creation"[\s\S]*?statusElement\.textContent/,
  "background Text warm-up failures must reach diagnostics and visible status",
);

for (const method of [
  "ensureShapePreviewEditorResources",
  "ensureVectorShapeEditorResources",
  "ensureMixedSceneEditorResources",
  "ensureLayerBlendEditorResources",
  "ensureSpatialBlurEditorResources",
  "ensurePixelSelectionPaintResources",
]) {
  assert.match(engine, new RegExp(`async ${method}\\(\\): Promise<void>`));
}

const compatibilityGate = section(
  engine,
  "async ensureOptionalEditorResources(): Promise<void>",
  "async prewarmRasterToneCurvesResources(): Promise<void>",
);
for (const method of [
  "ensureMixedSceneEditorResources",
  "ensureLayerBlendEditorResources",
  "ensureSpatialBlurEditorResources",
  "ensurePixelSelectionPaintResources",
]) {
  assert.match(compatibilityGate, new RegExp(`await this\\.${method}\\(\\)`));
}

const selectedBrushWarmup = section(
  engine,
  "private async prewarmSelectedRasterBrushGpu(settings: BrushSettings): Promise<void>",
  "private rememberCompletedBrushGpuWarmup(key: string): void",
);
assert.match(
  selectedBrushWarmup,
  /"Selected brush warm-up tile commit target"[\s\S]*?GPUTextureUsage\.RENDER_ATTACHMENT/,
  "The render fallback needs a private tile target distinct from its sampled release texture",
);
assert.match(
  selectedBrushWarmup,
  /binding: 0, resource: layerScratchView/,
  "The release texture must remain the sampled tile-commit input",
);
assert.match(
  selectedBrushWarmup,
  /"Warm selected high-precision glaze tile release",\s*tileCommitScratchView/,
  "The tile-commit warm-up must render into its distinct target",
);
assert.doesNotMatch(
  selectedBrushWarmup,
  /"Warm selected high-precision glaze tile release",\s*layerScratchView/,
  "A warm-up pass must not sample and render to the release texture in one synchronization scope",
);

const selectedBrushLoading = section(
  main,
  "function ensureSelectedBrushColdStartWithLoading(): Promise<void>",
  "canvasToolController = new CanvasToolController",
);
assert.match(
  selectedBrushLoading,
  /currentBrushResourcesReady\(\)[\s\S]*?canvasStartupOverlay\.runRuntimeOperation\([\s\S]*?ensureCurrentBrushResources\(\)[\s\S]*?waitForIdle\(\)/,
  "a cold Brush variant must keep the shared loading overlay active through its GPU fence",
);
assert.match(
  main,
  /new BrushSettingsController\(\{[\s\S]*?setBrushSettings: \(next\) => \{[\s\S]*?requestSelectedBrushColdStartLoading\(\)/,
  "resource-affecting Brush setting changes must request the same cold-start loading lifecycle",
);
assert.match(
  main,
  /selectedBrushPreparationRequestSuppressed = true;[\s\S]*?restoreActiveBrush\(\{ prepareResources: false \}\)[\s\S]*?finally \{[\s\S]*?selectedBrushPreparationRequestSuppressed = false;/,
  "startup brush restore must preserve the one-shot deferred GPU preparation",
);
assert.match(
  main,
  /setBrushSettings: \(next\) => \{[\s\S]*?if \(!selectedBrushPreparationRequestSuppressed\) \{[\s\S]*?requestSelectedBrushColdStartLoading\(\)/,
  "ordinary Brush changes must still prepare resources while startup restore stays cold",
);
assert.match(
  main,
  /prepareSelectedBrushForInteraction: async \(\) => \{[\s\S]*?ensureSelectedBrushColdStartWithLoading\(\)/,
  "Paint, Eraser and Blend selection must share the coalesced cold-start preparation",
);

const projectRestoreCapabilityPlan = section(
  projectRuntime,
  "  const records = snapshot.layers.map(layerRecordFromProject);",
  "  engine.persistActiveLayerState();",
);
assert.match(
  projectRestoreCapabilityPlan,
  /const containsSemanticItems = snapshot\.mixedScene\.items\.some[\s\S]*?if \(containsSemanticItems\) \{\s*await engine\.ensureMixedSceneEditorResources\(\);\s*\}/,
  "Semantic project restore must prepare the mixed-scene presentation capability before publishing saved state",
);
assert.doesNotMatch(
  projectRuntime,
  /await engine\.ensureOptionalEditorResources\(\)/,
  "Project restore must not compile blur, blend and selection-paint capabilities",
);

const sharedTransformShell = section(
  transformRuntime,
  "async function createSharedResources(",
  "function affinePipelineDescriptor(",
);
assert.doesNotMatch(
  sharedTransformShell,
  /createShaderModule|createRenderPipeline(?:Async)?/,
  "The per-engine/format shell must not eagerly compile any Transform program",
);

const lazyProgramCreation = section(
  transformRuntime,
  "async function createProgramBundle(",
  "async function ensureProgramBundle(",
);
for (const bundle of ["affine", "deform", "mip"]) {
  assert.match(lazyProgramCreation, new RegExp(`bundle === "${bundle}"`));
}
assert.match(lazyProgramCreation, /rasterSelectionTranslateShader/);
assert.match(lazyProgramCreation, /createRenderPipelineAsync\(\s*shared\.device,/);
assert.doesNotMatch(
  lazyProgramCreation,
  /shared\.device\.createRenderPipeline\(/,
  "Ordinary first use must compile every requested bundle asynchronously",
);
assert.match(
  lazyProgramCreation,
  /bundle === "deform"[\s\S]*?await Promise\.all\(\[[\s\S]*?deformPipelineDescriptor[\s\S]*?clearPipelineDescriptor/,
  "Only the two related Warp pipelines may compile concurrently",
);

const bundleCache = section(
  transformRuntime,
  "async function ensureProgramBundle(",
  "function requireModeProgramBundle(",
);
assert.match(bundleCache, /shared\.programPromises\.get\(bundle\)/);
assert.match(bundleCache, /shared\.programPromises\.set\(bundle, promise\)/);
assert.match(
  bundleCache,
  /catch \(error\)[\s\S]*?shared\.programPromises\.delete\(bundle\)/,
  "Rejected bundle promises must be evicted so a later interaction can retry",
);
assert.match(
  lazyProgramCreation,
  /programCompilationQueue\(shared\.device\)\.run/,
  "Cold transform bundles must share the per-device compiler queue",
);

const requiredTransformPrograms = section(
  transformRuntime,
  "async function requireSharedResources(",
  "function destroySessionResources(",
);
assert.match(
  requiredTransformPrograms,
  /if \(selectionScope\) \{\s*await ensureProgramBundle\(shared, "selection"\);\s*return shared;/,
  "Pixel-selection movement must request only its translation bundle",
);
assert.match(
  requiredTransformPrograms,
  /requestedMode === "affine" \? "affine" : "deform"/,
  "Whole-layer sessions must request only the chosen mode bundle",
);
assert.match(requiredTransformPrograms, /await ensureProgramBundle\(shared, "mip"\)/);
assert.match(
  requiredTransformPrograms,
  /Keep capability compilation sequential/,
  "Independent allocation transactions must remain sequential on old drivers",
);
assert.match(
  requiredTransformPrograms,
  /export async function prewarmRasterTransformPrograms\([\s\S]*?await requireSharedResources\(engine, requestedMode, selectionScope\)/,
);

const modeTransition = section(
  transformRuntime,
  "function transitionRasterTransformMode(",
  "type RasterTransformUpdate",
);
assert.match(modeTransition, /requireModeProgramBundle\(/);
assert.doesNotMatch(
  transformRuntime,
  /\.createRenderPipeline\(/,
  "A cold Transform/Warp mode change must not compile synchronously on the UI path",
);

console.log("Advanced tool capability-specific warm-up verification passed.");
