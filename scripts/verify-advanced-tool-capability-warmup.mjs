import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const section = (contents, startMarker, endMarker) => {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing section ${startMarker}`);
  return contents.slice(start, end);
};

const main = source("src/main.ts");
const engine = source("src/brush-engine.ts");
const projectRuntime = source("src/engine-project-runtime.ts");
const transformRuntime = source("src/engine-raster-transform-runtime.ts");

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
  /prepareSelectedBrushForInteraction: async \(\) => \{[\s\S]*?ensureSelectedBrushColdStartWithLoading\(\)/,
  "Paint, Eraser and Blend selection must share the coalesced cold-start preparation",
);

assert.match(
  projectRuntime,
  /snapshot\.mixedScene\.items\.some[\s\S]{0,160}await engine\.ensureMixedSceneEditorResources\(\)/,
  "Semantic project restore needs only the mixed-scene presentation capability",
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
