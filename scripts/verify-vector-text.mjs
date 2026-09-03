import assert from "node:assert/strict";
import fs from "node:fs";
import { area, difference, FillRule } from "clipper2-ts";
import { readEngineSource } from "./engine-source.mjs";

import {
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_MITER_LIMIT,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  normalizeVectorTextBlockShadowAngle,
  normalizeVectorTextBlockShadowOffset,
  normalizeVectorTextBlockShadowOpacity,
  normalizeVectorTextOutlineJoin,
  normalizeVectorTextOutlineWidth,
  normalizeVectorTextSingleShadowAngle,
  normalizeVectorTextSingleShadowBlur,
  normalizeVectorTextSingleShadowOffset,
  normalizeVectorTextSingleShadowOpacity,
  normalizeVectorTextInnerShadowAngle,
  normalizeVectorTextInnerShadowBlur,
  normalizeVectorTextInnerShadowOffset,
  normalizeVectorTextInnerShadowOpacity,
  vectorTextBlockShadowLocalReach,
  vectorTextBlockShadowLocalVector,
  vectorTextOutlineLocalReach,
  vectorTextSingleShadowLocalVector,
  vectorTextInnerShadowLocalVector,
} from "../src/mixed-scene-stack.ts";
import {
  VECTOR_TEXT_FONT_GEOMETRY_STRATEGY,
  VECTOR_TEXT_FONT_MANIFEST,
} from "../src/vector-text-font-geometry.ts";
import {
  cloneVectorSvgNode,
  cloneVectorSvgNodeWithSharedDocument,
} from "../src/scene-svg-model.ts";
import {
  vectorPathToQuadraticContours,
} from "../src/vector-text-curve-utils.ts";
import {
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS,
  VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS,
  buildOutsideVectorTextOutline,
  buildVectorTextBlockSet,
  buildVisibleVectorTextBlockSet,
  canonicalizeVectorTextPath,
  compileVectorTextEffect,
  triangulateCanonicalVectorTextSet,
} from "../src/vector-text-effect-geometry.ts";
import {
  VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
  VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM,
  vectorTextLodForSigma,
  vectorTextMaximumLod,
} from "../src/vector-text-lod.ts";
import {
  VECTOR_TEXT_SLUG_COMPILER_VERSION,
  buildVectorTextSlugData,
} from "../src/vector-text-slug.ts";
import {
  VectorPathIdentityPool,
  fingerprintVectorPath,
  vectorPathsEqualBitwise,
} from "../src/vector-path-identity.ts";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
  planVectorTextSingleShadowBlur,
  vectorTextSingleShadowBlurSupport,
} from "../src/vector-text-single-shadow.ts";
import {
  VECTOR_TEXT_GPU_BLUR_FORMAT,
  VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  VECTOR_TEXT_GPU_QUALITY_MAX_SCALE,
  VECTOR_TEXT_GPU_QUALITY_SCALE,
  VECTOR_TEXT_GPU_QUALITY_TILE_SIZE,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
  VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  VECTOR_TEXT_GPU_TARGET_FORMAT,
  VECTOR_TEXT_GPU_UNIFORM_BYTES,
  VECTOR_TEXT_GPU_UNIFORM_FLOATS,
} from "../src/vector-text-gpu-shader.ts";
import {
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
} from "../src/vector-text-slug-gpu-shader.ts";
import {
  VECTOR_TEXT_PRESENTATION_STRATEGY,
} from "../src/vector-text-shader.ts";
import {
  VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS,
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
  VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX,
  VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT,
  VECTOR_TEXT_WIDE_FALLBACK_MAX_ZOOM,
  VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
  VECTOR_TEXT_ZOOM_AB_START_ZOOM,
  VECTOR_TEXT_ZOOM_AB_STRATEGY,
  VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
  VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT,
  VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM,
  VECTOR_TEXT_ZOOM_C_START_ZOOM,
  VECTOR_TEXT_ZOOM_C_STRATEGY,
  VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER,
  VECTOR_TEXT_ZOOM_STRESS_SEED,
  VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
  VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
  vectorTextExactRecoveryIsCurrent,
  vectorTextCaptureCoversDocument,
  vectorTextFastPresentationMode,
  vectorTextWideFallbackView,
  vectorTextZoomCoverageSeed,
  vectorTextZoomStressSeed,
  vectorTextZoomStressStepFactor,
} from "../src/vector-text-adaptive-zoom.ts";
import {
  VECTOR_SVG_IMPORT_STRATEGY,
  VECTOR_SVG_MAXIMUM_COMMANDS,
  VECTOR_SVG_MAXIMUM_GRADIENT_STOPS,
  VECTOR_SVG_MAXIMUM_SOURCE_BYTES,
  VECTOR_SVG_STATIC_STROKE_TOLERANCE,
  expandVectorSvgStrokePaint,
} from "../src/vector-svg-import.ts";
import {
  VECTOR_TEXT_TRANSFORM_STRATEGY,
  buildVectorTextCurveGuide,
  defaultVectorTextDistortPoints,
  moveVectorTextDistortPoint,
  normalizeVectorTextCircleRadiusPercent,
  normalizeVectorTextDistortPoints,
  normalizeVectorTextTransformCurve,
  normalizeVectorTextTransformParameters,
  transformVectorTextPathAffine,
  vectorTextCircleAffine,
  vectorTextCirclePlacement,
  vectorTextDistortBounds,
  warpVectorTextPathAlongCurve,
  warpVectorTextPathFreeForm,
  warpVectorTextPointFreeForm,
} from "../src/vector-text-transform.ts";
import {
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  MIXED_SCENE_LINEAR_FORMAT,
} from "../src/mixed-scene-compositor-shader.ts";
import {
  VECTOR_TEXT_RUN_CACHE_GUARD_PX,
  VECTOR_TEXT_RUN_CACHE_BUCKET_PX,
  growVectorTextGpuCacheAxisCapacity,
  placeVectorTextGpuRunCache,
  vectorTextGpuRunCacheAllocationBounds,
  vectorTextGpuRunCacheContains,
} from "../src/vector-text-cache-roi.ts";
import {
  VectorTextEffectCompilerClient,
} from "../src/vector-text-effect-client.ts";
import {
  VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES,
  pruneVectorTextGpuResourceCache,
  vectorTextRunCacheMemoryBytes,
  vectorTextRunCacheMipLevelCount,
  vectorTextGpuResourceKey,
} from "../src/engine-vector-text-resources.ts";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const vectorPathIdentityPool = new VectorPathIdentityPool();

const engineSource = readEngineSource();
const controllerSource = read("src/mixed-scene-controller.ts");
const controllerContractSource = read("src/mixed-scene-controller-contract.ts");
const sceneImportBridgeSource = read("src/scene-import-bridge.ts");

// Hidden semantic nodes are omitted by MixedSceneStack when it names a
// compositor run. The live controller must omit them from the texture key too;
// otherwise hiding one text/SVG makes every still-visible vector in that run
// disappear because the compositor cannot find the differently named texture.
const liveRunGroupingStart = controllerSource.indexOf("      const appendVectorToRun = (");
const liveRunGroupingEnd = controllerSource.indexOf(
  "      const nextRunKeys = ",
  liveRunGroupingStart,
);
assert.notEqual(liveRunGroupingStart, -1);
assert.notEqual(liveRunGroupingEnd, -1);
const liveRunGroupingSource = controllerSource.slice(
  liveRunGroupingStart,
  liveRunGroupingEnd,
);
assert.match(
  liveRunGroupingSource,
  /if \(!node\.visible \|\| node\.opacity <= 0\)[\s\S]*?return;[\s\S]*?pendingNodes\.push\(node\)/,
);
assert.match(
  liveRunGroupingSource,
  /item\.kind === "text"\) appendVectorToRun\(item\.textNode\)[\s\S]*?item\.kind === "svg"\) appendVectorToRun\(item\.svgNode\)/,
);
assert.doesNotMatch(
  liveRunGroupingSource,
  /pendingNodes\.push\(item\.(?:textNode|svgNode)\)/,
);
assert.match(
  liveRunGroupingSource,
  /if \(node\.opacity < 1\) \{\s*flushVectorRun\(\);[\s\S]*?placement: `text-run:\$\{vectorNodeKey\(node\)\}`,[\s\S]*?nodes: \[node\],[\s\S]*?opacity: node\.opacity,[\s\S]*?return;\s*\}\s*pendingNodes\.push\(node\)/,
  "a translucent vector must own a compositor run carrying its layer opacity",
);
assert.match(
  controllerSource,
  /placement: `text-run:\$\{nodes\.map\(vectorNodeKey\)\.join\(","\)\}`,[\s\S]*?nodes,[\s\S]*?opacity: 1/,
  "fully opaque adjacent vectors must retain the shared-run fast path",
);
const liveRunRenderStart = controllerSource.indexOf(
  "      for (const group of groups) {",
  liveRunGroupingEnd,
);
const liveRunRenderEnd = controllerSource.indexOf(
  "    this.atomicEffectPendingNodes = atomicEffectPendingNodes;",
  liveRunRenderStart,
);
assert.notEqual(liveRunRenderStart, -1);
assert.notEqual(liveRunRenderEnd, -1);
const liveRunRenderSource = controllerSource.slice(liveRunRenderStart, liveRunRenderEnd);
assert.match(
  controllerSource,
  /function vectorNodeWithUnitOpacity<[\s\S]*?return node\.opacity === 1 \? node : \{ \.\.\.node, opacity: 1 \};/,
  "the internal vector draw program must have an explicit unit-opacity form",
);
assert.match(
  liveRunRenderSource,
  /const drawNode = group\.opacity < 1\s*\? vectorNodeWithUnitOpacity\(node\)\s*:\s*node;/,
);
assert.match(
  liveRunRenderSource,
  /appendGpuDrawsForNode\(\s*candidateDraws,\s*drawNode,/,
);
assert.match(
  liveRunRenderSource,
  /appendGpuDrawsForSvgNode\(\s*candidateDraws,\s*drawNode,/,
);
assert.match(
  liveRunRenderSource,
  /updateVectorTextGpuPresentation\(\s*group\.placement,\s*draws,\s*group\.opacity,\s*\)/,
  "node opacity must be applied once after all fills, outlines, and shadows composite",
);
const textRasterProgramStart = controllerSource.indexOf(
  "  private async rasterizeSelectedText(",
);
const textRasterProgramEnd = controllerSource.indexOf(
  "  private async rasterizeSelectedSvg(",
  textRasterProgramStart,
);
const svgRasterProgramEnd = controllerSource.indexOf(
  "  private defaultDistortPointsForNode(",
  textRasterProgramEnd,
);
assert.match(
  controllerSource.slice(textRasterProgramStart, textRasterProgramEnd),
  /const rasterNode = cloneVectorTextNode\(current\);\s*rasterNode\.opacity = 1;[\s\S]*?appendGpuDrawsForNode\(\s*draws,\s*rasterNode,/,
  "text rasterization must also composite the internal program at unit node opacity",
);
assert.match(
  controllerSource.slice(textRasterProgramEnd, svgRasterProgramEnd),
  /const rasterNode = cloneVectorSvgNode\(current\);\s*rasterNode\.opacity = 1;[\s\S]*?appendGpuDrawsForSvgNode\(\s*draws,\s*rasterNode,/,
  "SVG rasterization must also composite the internal program at unit node opacity",
);
const interactionOverlaySource = read("src/scene-interaction-overlay.ts");
const mobileToolSettingsSource = read("src/mobile-tool-settings-sheet.ts");
const clientSource = read("src/vector-text-effect-client.ts");
const workerSource = read("src/vector-text-effect-worker.ts");
const workerProtocolSource = read("src/vector-text-effect-worker-protocol.ts");
const geometrySource = read("src/vector-text-effect-geometry.ts");
const curveSource = read("src/vector-text-curve-utils.ts");
const slugSource = read("src/vector-text-slug.ts");
const slugShaderSource = read("src/vector-text-slug-gpu-shader.ts");
const gpuShaderSource = read("src/vector-text-gpu-shader.ts");
const innerShadowShaderSource = read("src/vector-text-inner-shadow-gpu-shader.ts");
const gpuResourcesSource = read("src/vector-text-gpu-resources.ts");
const singleShadowSource = read("src/vector-text-single-shadow.ts");
const fontGeometrySource = read("src/vector-text-font-geometry.ts");
const transformSource = read("src/vector-text-transform.ts");
const adaptiveSource = read("src/vector-text-adaptive-zoom.ts");
const mixedCompositorSource = read("src/mixed-scene-compositor-shader.ts");
const engineClassSource = read("src/brush-engine.ts");
const engineRuntimeMiscSource = read("src/engine-runtime-misc.ts");
const vectorTextRuntimeSource = read("src/engine-vector-text-runtime.ts");
const vectorTextResourcesSource = read("src/engine-vector-text-resources.ts");
const svgSource = read("src/vector-svg-import.ts");
const svgGradientStrokeFixture = read("scripts/fixtures/svg-gradient-stroke.svg");
const vectorRasterSource = read("src/engine-vector-raster-runtime.ts");
const mainSource = read("src/main.ts");
const editorToolsSource = read("src/editor-tools-controller.ts");
const canvasInputSource = read("src/canvas-input-controller.ts");
const editorLabsSource = read("src/labs/editor-labs.ts");
const labsStartupSource = read("src/labs/startup.ts");
const vectorZoomLabSource = read("src/labs/vector/vector-zoom-labs.ts");
const sitesBuildSource = read("scripts/prepare-sites-build.mjs");
const vectorZoomMigrationSource = read(".openai/drizzle/0005_vector_zoom_runs.sql");
const htmlSource = read("index.html");
const packageJson = JSON.parse(read("package.json"));

const roiRequest = { x: 321, y: 197, width: 600, height: 200 };
const roiAllocation = vectorTextGpuRunCacheAllocationBounds(
  roiRequest,
  1920,
  1080,
);
assert.equal(roiAllocation.x % VECTOR_TEXT_RUN_CACHE_BUCKET_PX, 0);
assert.equal(roiAllocation.y % VECTOR_TEXT_RUN_CACHE_BUCKET_PX, 0);
assert.ok(vectorTextGpuRunCacheContains(roiAllocation, roiRequest));
assert.ok(
  roiAllocation.x <= roiRequest.x - VECTOR_TEXT_RUN_CACHE_GUARD_PX
    && roiAllocation.y <= roiRequest.y - VECTOR_TEXT_RUN_CACHE_GUARD_PX
    && roiAllocation.x + roiAllocation.width
      >= roiRequest.x + roiRequest.width + VECTOR_TEXT_RUN_CACHE_GUARD_PX
    && roiAllocation.y + roiAllocation.height
      >= roiRequest.y + roiRequest.height + VECTOR_TEXT_RUN_CACHE_GUARD_PX,
  "una ROI interna deve conservare il guard completo sui quattro lati",
);
assert.ok(
  roiAllocation.width * roiAllocation.height < 1920 * 1080 * 0.15,
  "una run piccola deve usare molto meno di un viewport intero",
);
assert.deepEqual(
  vectorTextGpuRunCacheAllocationBounds(roiRequest, 1920, 1080, false),
  { x: 0, y: 0, width: 1920, height: 1080 },
  "il flag A/B deve ripristinare la capacity viewport senza cambiare renderer",
);
const movedRoiRequest = { x: 910, y: 510, width: 600, height: 200 };
const movedRoiAllocation = placeVectorTextGpuRunCache(
  movedRoiRequest,
  roiAllocation.width,
  roiAllocation.height,
  1920,
  1080,
);
assert.equal(movedRoiAllocation.width, roiAllocation.width);
assert.equal(movedRoiAllocation.height, roiAllocation.height);
assert.ok(vectorTextGpuRunCacheContains(movedRoiAllocation, movedRoiRequest));
const edgeRoi = vectorTextGpuRunCacheAllocationBounds(
  { x: 0, y: 0, width: 17, height: 13 },
  1920,
  1080,
);
assert.equal(edgeRoi.x, 0);
assert.equal(edgeRoi.y, 0);
assert.ok(vectorTextGpuRunCacheContains(edgeRoi, { x: 0, y: 0, width: 17, height: 13 }));

// Run caches retain rgba16float mip chains so large camera reprojections are
// filtered before they reach the display target. NPOT witnesses make the
// accounting contract exact rather than an approximate 4/3 multiplier.
assert.equal(vectorTextRunCacheMipLevelCount(1, 1), 1);
assert.equal(vectorTextRunCacheMipLevelCount(2, 1), 2);
assert.equal(vectorTextRunCacheMipLevelCount(3, 5), 3);
assert.equal(vectorTextRunCacheMipLevelCount(512, 128), 10);
assert.equal(
  vectorTextRunCacheMemoryBytes(3, 5),
  (3 * 5 + 1 * 2 + 1) * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
  "la memoria NPOT deve sommare ogni mip fisico rgba16float",
);
assert.equal(
  vectorTextRunCacheMemoryBytes(2, 2),
  (2 * 2 + 1) * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL,
);
assert.match(
  vectorTextResourcesSource,
  /interface VectorTextRunTextureResources[\s\S]*?mipLevelCount: number;[\s\S]*?fallbackMipLevelCount: number;/,
  "la pubblicazione primaria e fallback deve conservare i rispettivi conteggi mip",
);
assert.match(
  vectorTextResourcesSource,
  /interface VectorTextGpuPendingRun[\s\S]*?targetMipLevelCount: number;/,
  "un redraw pendente deve dichiarare quanti mip rigenerare sul proprio target",
);
assert.match(
  vectorTextResourcesSource,
  /interface VectorTextRunTextureResources[\s\S]*?mipZeroView: GPUTextureView;/,
  "il render attachment preciso deve restare separato dalla view che espone tutti i mip",
);
assert.match(
  vectorTextResourcesSource,
  /interface VectorTextRunTextureResources[\s\S]*?primaryEncodedSrgb: boolean;\s*fallbackEncodedSrgb: boolean;/,
  "le catture primaria e fallback devono dichiarare separatamente il proprio dominio colore",
);

const vectorTextFlushStart = vectorTextRuntimeSource.indexOf(
  "export function flushVectorTextGpuPresentations(",
);
const vectorTextFlushEnd = vectorTextRuntimeSource.indexOf(
  "function mixedSceneSegmentContributesToDeepFloor(",
  vectorTextFlushStart,
);
assert.ok(vectorTextFlushStart >= 0 && vectorTextFlushEnd > vectorTextFlushStart);
const vectorTextFlushSource = vectorTextRuntimeSource.slice(
  vectorTextFlushStart,
  vectorTextFlushEnd,
);
assert.match(
  vectorTextFlushSource,
  /run\.resources\.primaryEncodedSrgb = vectorTextRunUsesEncodedSrgb\(engine\);\s*writeVectorTextRunCacheUniforms\(engine, run\.resources\);/,
  "il redraw primario deve pubblicare insieme pixel e tag del dominio colore",
);
const completedRunPublicationStart = vectorTextFlushSource.indexOf(
  "const completedRuns = engine.vectorTextGpuPendingRuns.slice();",
);
const completedRunPublicationEnd = vectorTextFlushSource.indexOf(
  "engine.displayDirty = true;",
  completedRunPublicationStart,
);
assert.ok(
  completedRunPublicationStart >= 0
    && completedRunPublicationEnd > completedRunPublicationStart,
);
const completedRunPublicationSource = vectorTextFlushSource.slice(
  completedRunPublicationStart,
  completedRunPublicationEnd,
);
const completedRunRefinement = completedRunPublicationSource.indexOf(
  "refineVectorTextGpuRunCoverage(engine, run, qualityDrawPipelines);",
);
const completedRunSubmit = completedRunPublicationSource.indexOf(
  "engine.device.queue.submit([encoder.finish()]);",
);
const completedRunSubmittedFlag = completedRunPublicationSource.indexOf(
  "gpuWorkSubmitted = true;",
);
const completedRunInitialized = completedRunPublicationSource.indexOf(
  "run.resources.initialized = true;",
);
const completedRunTag = completedRunPublicationSource.indexOf(
  "run.resources.primaryEncodedSrgb = vectorTextRunUsesEncodedSrgb(engine);",
);
const completedRunRemoval = completedRunPublicationSource.indexOf(
  "engine.vectorTextGpuPendingRuns.splice(0, completedRuns.length);",
);
assert.ok(
  completedRunSubmit >= 0
    && completedRunSubmittedFlag > completedRunSubmit
    && completedRunRefinement > completedRunSubmittedFlag
    && completedRunInitialized > completedRunRefinement
    && completedRunTag > completedRunInitialized
    && completedRunRemoval > completedRunTag,
  "cache primaria, tag e rimozione pending devono essere pubblicati solo dopo tutte le tile",
);
assert.doesNotMatch(
  completedRunPublicationSource.slice(0, completedRunRemoval),
  /vectorTextGpuPendingRuns\.(?:length\s*=\s*0|splice\()/,
  "un errore durante la refinement deve lasciare intatta la coda riprovabile",
);
assert.match(
  completedRunPublicationSource,
  /previousPrimaryStates\.set\(run\.resources, \{\s*lastBounds: run\.resources\.lastBounds,\s*initialized: run\.resources\.initialized,\s*encodedSrgb: run\.resources\.primaryEncodedSrgb,\s*\}\);/,
  "la pubblicazione deve conservare l'intero stato primario visibile",
);
assert.match(
  completedRunPublicationSource,
  /let gpuWorkSubmitted = false;[\s\S]*?queue\.submit\(\[encoder\.finish\(\)\]\);\s*gpuWorkSubmitted = true;/,
  "il rollback deve distinguere gli errori prima e dopo l'accettazione del lavoro GPU",
);
assert.match(
  completedRunPublicationSource,
  /catch \(error\) \{[\s\S]*?if \(gpuWorkSubmitted\) \{[\s\S]*?resources\.lastBounds = null;\s*resources\.initialized = false;\s*resources\.primaryEncodedSrgb = false;\s*\} else \{\s*resources\.lastBounds = previous\.lastBounds;\s*resources\.initialized = previous\.initialized;\s*resources\.primaryEncodedSrgb = previous\.encodedSrgb;\s*\}[\s\S]*?writeVectorTextRunCacheUniforms\(engine, resources\);[\s\S]*?cache\.needsBuild = needsBuild;[\s\S]*?throw error;/,
  "dopo una submit la texture incerta deve essere invalidata; prima della submit lo stato puo' essere ripristinato",
);
assert.match(
  completedRunPublicationSource,
  /for \(const build of blurBuilds\) \{\s*build\.cache\.needsBuild = false;\s*\}/,
  "anche una cache blur diventa valida soltanto dopo il completamento della refinement",
);
const targetCopyReference = vectorTextFlushSource.indexOf("texture: run.targetTexture");
const targetCopyStart = vectorTextFlushSource.lastIndexOf(
  "encoder.copyTextureToTexture(",
  targetCopyReference,
);
const targetMipGeneration = vectorTextFlushSource.indexOf(
  "encodeVectorTextRunCacheMipChain(",
  targetCopyReference,
);
assert.ok(targetCopyReference >= 0 && targetCopyStart >= 0);
assert.ok(
  targetMipGeneration > targetCopyStart,
  "ogni redraw deve rigenerare la mip chain dopo aver copiato il nuovo mip zero",
);
assert.match(
  vectorTextFlushSource.slice(targetMipGeneration, targetMipGeneration + 500),
  /run\.targetMipLevelCount/,
  "il redraw deve limitare la generazione ai mip allocati dal target",
);

// Switching the diagnostic coverage policy is an atomic cache-domain change:
// pending work is completed, the old fallback generation is removed, the new
// policy becomes visible, and only then is the mixed scene republished.
const qualitySetterStart = engineClassSource.indexOf(
  "  setVectorRasterQualityMode(mode: VectorRasterQualityMode): void {",
);
const qualitySetterEnd = engineClassSource.indexOf(
  "  getVectorTextFastPresentationMode()",
  qualitySetterStart,
);
assert.ok(qualitySetterStart >= 0 && qualitySetterEnd > qualitySetterStart);
const qualitySetterSource = engineClassSource.slice(qualitySetterStart, qualitySetterEnd);
const qualitySetterFlush = qualitySetterSource.indexOf(
  "flushVectorTextGpuPresentations(this);",
);
const qualitySetterClearFallback = qualitySetterSource.indexOf(
  "clearVectorTextFallbackPresentation(this);",
);
const qualitySetterModeAssignment = qualitySetterSource.indexOf(
  "this.vectorRasterQualityMode = mode;",
);
const qualitySetterPublish = qualitySetterSource.indexOf("publishMixedScene(this);");
assert.ok(
  qualitySetterFlush >= 0
    && qualitySetterClearFallback > qualitySetterFlush
    && qualitySetterModeAssignment > qualitySetterClearFallback
    && qualitySetterPublish > qualitySetterModeAssignment,
  "la transizione di qualita' deve rispettare flush, clear fallback, cambio dominio e publish",
);

assert.equal(VECTOR_TEXT_GPU_QUALITY_TILE_SIZE, 256);
assert.equal(VECTOR_TEXT_GPU_QUALITY_SCALE, 4);
assert.equal(VECTOR_TEXT_GPU_QUALITY_MAX_SCALE, 32);
const coverageRefinementStart = vectorTextRuntimeSource.indexOf(
  "function refineVectorTextGpuRunCoverage(",
);
const coverageRefinementEnd = vectorTextRuntimeSource.indexOf(
  "export function initializeVectorMeshFillGpuRenderer(",
  coverageRefinementStart,
);
assert.ok(
  coverageRefinementStart >= 0 && coverageRefinementEnd > coverageRefinementStart,
);
const coverageRefinementSource = vectorTextRuntimeSource.slice(
  coverageRefinementStart,
  coverageRefinementEnd,
);
assert.match(
  coverageRefinementSource,
  /const qualityScale = largestRunAxis <= 128\s*\? VECTOR_TEXT_GPU_QUALITY_MAX_SCALE\s*:\s*largestRunAxis <= 256\s*\? VECTOR_TEXT_GPU_QUALITY_MAX_SCALE \/ 2\s*:\s*VECTOR_TEXT_GPU_QUALITY_SCALE;/,
  "la copertura deve aumentare adattivamente per le run piccole senza ingrandire lo scratch",
);
assert.match(
  coverageRefinementSource,
  /const scratchDimension =\s*VECTOR_TEXT_GPU_QUALITY_TILE_SIZE \* VECTOR_TEXT_GPU_QUALITY_SCALE;/,
);
assert.match(coverageRefinementSource, /const tileSize = scratchDimension \/ qualityScale;/);
assert.match(
  coverageRefinementSource,
  /for \(let level = 0; level < reductionCount; level \+= 1\)[\s\S]*?setPipeline\(downsamplePipeline\)[\s\S]*?downsampleBindGroups\[level\]/,
  "ogni tile ad alta risoluzione deve essere ridotta con passaggi exact-area GPU",
);
assert.match(
  coverageRefinementSource,
  /texture: qualityTexture,\s*mipLevel: reductionCount,[\s\S]*?texture: run\.targetTexture/,
  "il livello nativo della tile deve essere copiato nella cache della run",
);
assert.doesNotMatch(coverageRefinementSource, /getImageData|putImageData|mapAsync/);

const qualityFillPipelineStart = vectorTextRuntimeSource.indexOf(
  'label: "Vector text indexed fill 4x coverage source-over pipeline"',
);
const qualityFillPipelineEnd = vectorTextRuntimeSource.indexOf(
  'label: "Vector text cropped run transparent clear pipeline"',
  qualityFillPipelineStart,
);
assert.ok(
  qualityFillPipelineStart >= 0 && qualityFillPipelineEnd > qualityFillPipelineStart,
);
const qualityFillPipelineSource = vectorTextRuntimeSource.slice(
  qualityFillPipelineStart,
  qualityFillPipelineEnd,
);
assert.match(qualityFillPipelineSource, /blend: vectorTextSourceOverBlend\(\)/);
assert.doesNotMatch(
  qualityFillPipelineSource,
  /multisample:/,
  "la tile sovracampionata deve usare una pipeline single-sample deterministica",
);
assert.match(
  vectorTextFlushSource,
  /if \(qualityDrawPipelines\)[\s\S]*?vectorTextGpuRunUsesCoverageTiles\(engine, run\)[\s\S]*?refineVectorTextGpuRunCoverage\(engine, run, qualityDrawPipelines\)/,
  "il flush deve applicare la pipeline adattiva soltanto alle run idonee",
);

const fallbackPublicationStart = vectorTextRuntimeSource.indexOf(
  "interface VectorTextFallbackPublicationCandidate {",
);
const fallbackPublicationEnd = vectorTextRuntimeSource.indexOf(
  "export function rebuildVectorTextGpuFallbackPresentation(",
  fallbackPublicationStart,
);
assert.ok(
  fallbackPublicationStart >= 0 && fallbackPublicationEnd > fallbackPublicationStart,
);
const fallbackPublicationSource = vectorTextRuntimeSource.slice(
  fallbackPublicationStart,
  fallbackPublicationEnd,
);
assert.match(fallbackPublicationSource, /readonly encodedSrgb: boolean;/);
assert.match(
  fallbackPublicationSource,
  /previousStates\.set\(resources, \{[\s\S]*?encodedSrgb: resources\.fallbackEncodedSrgb,/,
  "la transazione fallback deve conservare il tag precedente nel journal di rollback",
);
assert.match(
  fallbackPublicationSource,
  /resources\.fallbackEncodedSrgb = candidate\.encodedSrgb;[\s\S]*?writeVectorTextRunCacheUniforms\(engine, resources\);/,
  "la pubblicazione fallback deve aggiornare tag e uniforme nella stessa transazione",
);
assert.match(
  fallbackPublicationSource,
  /catch \(error\) \{[\s\S]*?resources\.fallbackEncodedSrgb = previous\.encodedSrgb;[\s\S]*?writeVectorTextRunCacheUniforms\(engine, resources\);/,
  "un errore di pubblicazione deve ripristinare anche il dominio fallback",
);
assert.match(
  vectorTextRuntimeSource,
  /resources\.fallbackEncodedSrgb = false;[\s\S]{0,160}?writeVectorTextRunCacheUniforms\(engine, resources, resources\.textureBounds, null\);/,
  "rimuovere una fallback deve azzerarne subito il tag pubblicato",
);
const simpleClippingDecisionStart = vectorTextRuntimeSource.indexOf(
  "const heterogeneousClippingProgramIsSimple = (",
);
const simpleClippingDecisionEnd = vectorTextRuntimeSource.indexOf(
  "const encodeSimpleHeterogeneousClippingProgram = (",
  simpleClippingDecisionStart,
);
assert.ok(
  simpleClippingDecisionStart >= 0
    && simpleClippingDecisionEnd > simpleClippingDecisionStart,
);
const simpleClippingDecisionSource = vectorTextRuntimeSource.slice(
  simpleClippingDecisionStart,
  simpleClippingDecisionEnd,
);
assert.match(
  simpleClippingDecisionSource,
  /candidate\.kind === "text-run"[\s\S]*?documentStorageColorSpace[\s\S]*?=== "encoded-srgb-premultiplied"[\s\S]*?primaryEncodedSrgb[\s\S]*?fallbackEncodedSrgb/,
  "una cache vettoriale encoded-sRGB deve essere riconosciuta prima del fast-path di clipping",
);
assert.match(
  simpleClippingDecisionSource,
  /return !requiresEncodedTextFold[\s\S]*?!resources\?\.documentCutoutMaskSurface/,
  "il clipping con cache vettoriale encoded-sRGB deve usare il compositor storage-aware",
);
const mipEncoderStart = vectorTextRuntimeSource.indexOf(
  "function encodeVectorTextRunCacheMipChain(",
);
const mipEncoderEnd = vectorTextRuntimeSource.indexOf(
  "export function initializeVectorMeshFillGpuRenderer(",
  mipEncoderStart,
);
assert.ok(mipEncoderStart >= 0 && mipEncoderEnd > mipEncoderStart);
const mipEncoderWindow = vectorTextRuntimeSource.slice(mipEncoderStart, mipEncoderEnd);
assert.match(mipEncoderWindow, /for \(let mipLevel = 1;/);
assert.match(
  mipEncoderWindow,
  /encoder\.begin(?:Render|Compute)Pass\(/,
  "i livelli ridotti devono essere generati nella command encoder GPU",
);
assert.match(
  mipEncoderWindow,
  /baseMipLevel: mipLevel - 1,\s*mipLevelCount: 1/,
);
assert.match(
  mipEncoderWindow,
  /baseMipLevel: mipLevel,\s*mipLevelCount: 1/,
);
assert.doesNotMatch(mipEncoderWindow, /getImageData|putImageData|mapAsync/);

const fallbackRebuildStart = vectorTextRuntimeSource.indexOf(
  "export function rebuildVectorTextGpuFallbackPresentation(",
);
const fallbackCaptureStart = vectorTextRuntimeSource.indexOf(
  "export function captureVectorTextFallbackPresentation(",
  fallbackRebuildStart,
);
const fallbackCaptureEnd = vectorTextRuntimeSource.indexOf(
  "export async function probeVectorTextFallbackAlpha(",
  fallbackCaptureStart,
);
assert.ok(
  fallbackRebuildStart >= 0
    && fallbackCaptureStart > fallbackRebuildStart
    && fallbackCaptureEnd > fallbackCaptureStart,
);
const fallbackRebuildSource = vectorTextRuntimeSource.slice(
  fallbackRebuildStart,
  fallbackCaptureStart,
);
const fallbackCaptureSource = vectorTextRuntimeSource.slice(
  fallbackCaptureStart,
  fallbackCaptureEnd,
);
assert.match(
  fallbackRebuildSource,
  /encodedSrgb: vectorTextRunUsesEncodedSrgb\(engine\),/,
  "una fallback ricostruita deve essere marcata con il dominio effettivamente renderizzato",
);
assert.match(
  fallbackCaptureSource,
  /encodedSrgb: resources\.primaryEncodedSrgb,/,
  "una fallback copiata deve ereditare il dominio della cattura primaria",
);
assert.match(
  fallbackRebuildSource,
  /vectorTextRunCacheMipLevelCount\(\s*fallbackBounds\.width,\s*fallbackBounds\.height,?\s*\)/,
);
assert.match(
  fallbackRebuildSource,
  /label: `Vector text \$\{key\} automatic wide fallback ROI `[\s\S]{0,500}?mipLevelCount,/,
  "la fallback ricostruita deve allocare l'intera mip chain",
);
assert.match(
  fallbackRebuildSource,
  /const mipZeroView = texture\.createView\([\s\S]{0,180}?baseMipLevel: 0,[\s\S]{0,80}?mipLevelCount: 1/,
);
assert.match(fallbackRebuildSource, /targetView: mipZeroView/);
assert.match(fallbackRebuildSource, /targetMipLevelCount: mipLevelCount/);
assert.match(
  fallbackRebuildSource,
  /vectorTextRunCacheMemoryBytes\(\s*candidate\.bounds!\.width,\s*candidate\.bounds!\.height,?\s*\)/,
  "la telemetria della fallback ricostruita deve includere tutti i mip",
);

assert.match(
  fallbackCaptureSource,
  /vectorTextRunCacheMipLevelCount\(\s*fallbackBounds\.width,\s*fallbackBounds\.height,?\s*\)/,
);
assert.match(
  fallbackCaptureSource,
  /label: `Vector text \$\{key\} wide fallback ROI `[\s\S]{0,500}?mipLevelCount,/,
  "la fallback copiata deve allocare l'intera mip chain",
);
const fallbackCopyIndex = fallbackCaptureSource.indexOf("encoder.copyTextureToTexture(");
const fallbackMipIndex = fallbackCaptureSource.indexOf(
  "encodeVectorTextRunCacheMipChain(",
  fallbackCopyIndex,
);
assert.ok(
  fallbackCopyIndex >= 0 && fallbackMipIndex > fallbackCopyIndex,
  "la cattura fallback deve rigenerare i mip dopo la copia del mip zero",
);
assert.match(
  fallbackCaptureSource,
  /vectorTextRunCacheMemoryBytes\(\s*candidate\.bounds!?\.width,\s*candidate\.bounds!?\.height,?\s*\)/,
  "la telemetria della fallback copiata deve includere tutti i mip",
);

const ensureRunTextureStart = vectorTextRuntimeSource.indexOf(
  "export function ensureVectorTextPresentationTexture(",
);
const ensureRunTextureEnd = vectorTextRuntimeSource.indexOf(
  "export async function mutateMixedScenePresentation<",
  ensureRunTextureStart,
);
assert.ok(ensureRunTextureStart >= 0 && ensureRunTextureEnd > ensureRunTextureStart);
const ensureRunTextureSource = vectorTextRuntimeSource.slice(
  ensureRunTextureStart,
  ensureRunTextureEnd,
);
assert.match(
  ensureRunTextureSource,
  /vectorTextRunCacheMipLevelCount\(\s*textureBounds\.width,\s*textureBounds\.height,?\s*\)/,
);
assert.match(
  ensureRunTextureSource,
  /label: `Vector text \$\{key\} ROI cache \$\{textureBounds\.width\}×\$\{textureBounds\.height\}`[\s\S]{0,500}?mipLevelCount,/,
  "la cache ROI primaria deve allocare l'intera mip chain",
);
assert.match(
  ensureRunTextureSource,
  /baseMipLevel: 0,[\s\S]{0,100}?mipLevelCount: 1/,
  "il redraw preciso deve indirizzare soltanto il mip zero",
);
assert.match(
  engineSource,
  /targetView: resources\.mipZeroView,\s*targetMipLevelCount: resources\.mipLevelCount/,
  "la run primaria pendente deve usare la view mip-zero e dichiarare l'intera chain",
);

const textSegmentShaderStart = mixedCompositorSource.indexOf(
  "export const mixedSceneTextSegmentShader",
);
const textSegmentShaderEnd = mixedCompositorSource.indexOf(
  "export const mixedSceneShapePreviewShader",
  textSegmentShaderStart,
);
assert.ok(textSegmentShaderStart >= 0 && textSegmentShaderEnd > textSegmentShaderStart);
const textSegmentShaderSource = mixedCompositorSource.slice(
  textSegmentShaderStart,
  textSegmentShaderEnd,
);
const fastLodHelperStart = textSegmentShaderSource.indexOf(
  "fn vectorTextFastPresentationLod(",
);
const fastLodHelperEnd = textSegmentShaderSource.indexOf(
  "@fragment",
  fastLodHelperStart,
);
assert.ok(fastLodHelperStart >= 0 && fastLodHelperEnd > fastLodHelperStart);
const fastLodHelperSource = textSegmentShaderSource.slice(
  fastLodHelperStart,
  fastLodHelperEnd,
);
assert.match(
  fastLodHelperSource,
  /let minification = max\(captureZoom \/ max\(currentZoom, [^)]+\), 1\.0\);/,
);
assert.match(
  fastLodHelperSource,
  /let requestedLod = floor\(log2\(minification\)\);/,
);
assert.match(
  fastLodHelperSource,
  /let maximumLod = f32\(max\(mipLevelCount, 1u\) - 1u\);/,
);
assert.match(
  fastLodHelperSource,
  /return clamp\(requestedLod, 0\.0, maximumLod\);/,
);

const preciseBranchStart = textSegmentShaderSource.indexOf(
  "if (capture.fastMode < 0.5)",
);
const preciseBranchEnd = textSegmentShaderSource.indexOf(
  "// Every fast mode",
  preciseBranchStart,
);
assert.ok(preciseBranchStart >= 0 && preciseBranchEnd > preciseBranchStart);
const preciseBranchSource = textSegmentShaderSource.slice(
  preciseBranchStart,
  preciseBranchEnd,
);
assert.match(
  preciseBranchSource,
  /textureLoad\(sourceTexture, pixel, 0\)/,
  "il percorso preciso screen-space deve continuare a leggere il mip zero 1:1",
);
assert.match(
  preciseBranchSource,
  /vectorCacheSample\([\s\S]*primaryEncoded,[\s\S]*requestedEncoded[\s\S]*\) \* opacity;/,
  "il percorso preciso deve rispettare il dominio colore dichiarato dal cache",
);
assert.doesNotMatch(preciseBranchSource, /textureSampleLevel/);

const primaryFastStart = textSegmentShaderSource.indexOf("let sourcePixel =");
const primaryFastEnd = textSegmentShaderSource.indexOf(
  "if (capture.fastMode < 2.5)",
  primaryFastStart,
);
assert.ok(primaryFastStart >= 0 && primaryFastEnd > primaryFastStart);
const primaryFastSource = textSegmentShaderSource.slice(primaryFastStart, primaryFastEnd);
assert.match(
  primaryFastSource,
  /vectorTextFastPresentationLod\(\s*capture\.zoom,\s*display\.zoom,\s*textureNumLevels\(sourceTexture\),?\s*\)/,
  "la riproiezione primaria deve scegliere un mip dalla scala relativa della camera",
);
assert.match(primaryFastSource, /textureSampleLevel\(/);
assert.doesNotMatch(
  primaryFastSource,
  /sourcePixel\s*\/\s*sourceDimensions,\s*0\.0/,
  "il fast path primario non deve forzare il mip zero",
);

const fallbackFastStart = textSegmentShaderSource.indexOf("let fallbackPixel =");
const fallbackFastEnd = textSegmentShaderSource.indexOf(
  "if (!insideSource)",
  fallbackFastStart,
);
assert.ok(fallbackFastStart >= 0 && fallbackFastEnd > fallbackFastStart);
const fallbackFastSource = textSegmentShaderSource.slice(
  fallbackFastStart,
  fallbackFastEnd,
);
assert.match(
  fallbackFastSource,
  /vectorTextFastPresentationLod\(\s*fallbackCapture\.zoom,\s*display\.zoom,\s*textureNumLevels\(fallbackTexture\),?\s*\)/,
  "la riproiezione fallback deve scegliere il proprio mip dalla scala relativa",
);
assert.match(fallbackFastSource, /textureSampleLevel\(/);
assert.doesNotMatch(
  fallbackFastSource,
  /fallbackPixel\s*\/\s*fallbackDimensions,\s*0\.0/,
  "il fast path fallback non deve forzare il mip zero",
);

// Encoded-premultiplied vector color is composited numerically against the
// current linear scene through an explicit backdrop texture. The shader owns
// source-over, so the render target must not apply fixed-function blending too.
assert.match(
  textSegmentShaderSource,
  /@group\(0\) @binding\(7\) var vectorBackdropTexture: texture_2d<f32>;/,
);
assert.match(
  textSegmentShaderSource,
  /fn encodedCompositeFragmentMain\([\s\S]*?textureLoad\(vectorBackdropTexture, pixel, 0\)[\s\S]*?vectorTextSegmentSource\(fragmentPosition, true\)[\s\S]*?encodedSource\s*\+ encodedBackdrop \* \(1\.0 - clamp\(encodedSource\.a, 0\.0, 1\.0\)\)[\s\S]*?vectorEncodedPremultipliedToLinear\(encodedResult\)/,
  "il compositore encoded deve eseguire source-over una sola volta nel dominio dichiarato",
);
const encodedCompositeLayoutStart = engineRuntimeMiscSource.indexOf(
  "engine.mixedSceneTextEncodedCompositeBindGroupLayout ??=",
);
const encodedCompositeLayoutEnd = engineRuntimeMiscSource.indexOf(
  "engine.mixedSceneShapePreviewBindGroupLayout ??=",
  encodedCompositeLayoutStart,
);
assert.ok(
  encodedCompositeLayoutStart >= 0
    && encodedCompositeLayoutEnd > encodedCompositeLayoutStart,
);
const encodedCompositeLayoutSource = engineRuntimeMiscSource.slice(
  encodedCompositeLayoutStart,
  encodedCompositeLayoutEnd,
);
assert.match(
  encodedCompositeLayoutSource,
  /binding: 7, visibility: GPUShaderStage\.FRAGMENT, texture: \{ sampleType: "unfilterable-float" \}/,
  "il backdrop lineare deve essere letto direttamente, senza sampler implicito",
);
const encodedCompositePipelineStart = engineRuntimeMiscSource.indexOf(
  "const mixedSceneTextEncodedCompositePipelinePromise =",
);
const encodedCompositePipelineEnd = engineRuntimeMiscSource.indexOf(
  "const mixedSceneShapePreviewPipelinePromise =",
  encodedCompositePipelineStart,
);
assert.ok(
  encodedCompositePipelineStart >= 0
    && encodedCompositePipelineEnd > encodedCompositePipelineStart,
);
const encodedCompositePipelineSource = engineRuntimeMiscSource.slice(
  encodedCompositePipelineStart,
  encodedCompositePipelineEnd,
);
assert.match(encodedCompositePipelineSource, /entryPoint: "encodedCompositeFragmentMain"/);
assert.match(
  encodedCompositePipelineSource,
  /targets: \[\{ format: MIXED_SCENE_LINEAR_FORMAT \}\]/,
);
assert.doesNotMatch(
  encodedCompositePipelineSource,
  /targets:[\s\S]*?blend:/,
  "il compositore con backdrop non deve duplicare source-over nel fixed blend",
);

const compactEncodedCompositeStart = vectorTextRuntimeSource.indexOf(
  'const usesCompactEncodedVectorComposite = segment.kind === "text-run"',
);
const compactEncodedCompositeEnd = vectorTextRuntimeSource.indexOf(
  "const needsBackdropComposition =",
  compactEncodedCompositeStart,
);
assert.ok(
  compactEncodedCompositeStart >= 0
    && compactEncodedCompositeEnd > compactEncodedCompositeStart,
);
const compactEncodedCompositeSource = vectorTextRuntimeSource.slice(
  compactEncodedCompositeStart,
  compactEncodedCompositeEnd,
);
assert.match(
  compactEncodedCompositeSource,
  /const backdropTexture = currentIsCanonical\s*\? engine\.mixedSceneLinearTexture\s*:\s*engine\.mixedSceneBlendScratchTexture;/,
  "il compositore encoded deve accettare sia il target canonico sia lo scratch ordinato",
);
assert.match(
  compactEncodedCompositeSource,
  /const backdropView = currentIsCanonical\s*\? engine\.mixedSceneLinearView\s*:\s*engine\.mixedSceneBlendScratchView;/,
);
assert.match(compactEncodedCompositeSource, /\{ binding: 7, resource: backdropView \}/);
assert.match(
  compactEncodedCompositeSource,
  /texture: scratchTexture,[\s\S]*?texture: backdropTexture,/,
  "il risultato esplicito deve tornare nello stesso ping-pong che forniva il backdrop",
);

const encodedScratchReleaseStart = vectorTextRuntimeSource.indexOf(
  "function releaseMixedSceneTextEncodedCompositeScratch(",
);
const encodedScratchReleaseEnd = vectorTextRuntimeSource.indexOf(
  "export function encodeMixedSceneSegmentedPresentation(",
  encodedScratchReleaseStart,
);
assert.ok(
  encodedScratchReleaseStart >= 0 && encodedScratchReleaseEnd > encodedScratchReleaseStart,
);
const encodedScratchReleaseSource = vectorTextRuntimeSource.slice(
  encodedScratchReleaseStart,
  encodedScratchReleaseEnd,
);
assert.match(
  encodedScratchReleaseSource,
  /mixedSceneTextEncodedCompositeScratchTexture\?\.destroy\(\);/,
);
assert.match(
  encodedScratchReleaseSource,
  /mixedSceneTextEncodedCompositeScratchTexture = null;[\s\S]*?mixedSceneTextEncodedCompositeScratchView = null;[\s\S]*?mixedSceneTextEncodedCompositeScratchWidth = 0;[\s\S]*?mixedSceneTextEncodedCompositeScratchHeight = 0;/,
  "il rilascio del backdrop scratch deve azzerare texture, view e dimensioni",
);
const vectorScratchReleaseStart = vectorTextRuntimeSource.indexOf(
  "export function releaseVectorTextGpuScratch(",
);
const vectorScratchReleaseEnd = vectorTextRuntimeSource.indexOf(
  "export function mixedSceneItemIsVisible(",
  vectorScratchReleaseStart,
);
assert.ok(vectorScratchReleaseStart >= 0 && vectorScratchReleaseEnd > vectorScratchReleaseStart);
const vectorScratchReleaseSource = vectorTextRuntimeSource.slice(
  vectorScratchReleaseStart,
  vectorScratchReleaseEnd,
);
assert.match(vectorScratchReleaseSource, /vectorTextGpuQualityTexture\?\.destroy\(\);/);
assert.match(
  vectorScratchReleaseSource,
  /vectorTextGpuQualityTexture = null;\s*engine\.vectorTextGpuQualityMipViews = \[\];\s*engine\.vectorTextGpuQualityDownsampleBindGroups = \[\];/,
  "il rilascio vettoriale deve eliminare tutte le view e bind group della tile adattiva",
);
assert.match(
  vectorScratchReleaseSource,
  /releaseMixedSceneTextEncodedCompositeScratch\(engine\);/,
  "il lifecycle vettoriale deve includere anche lo scratch del compositore encoded",
);
const rightBottomRequest = { x: 1903, y: 1061, width: 17, height: 19 };
const rightBottomRoi = vectorTextGpuRunCacheAllocationBounds(
  rightBottomRequest,
  1920,
  1080,
);
assert.equal(rightBottomRoi.x + rightBottomRoi.width, 1920);
assert.equal(rightBottomRoi.y + rightBottomRoi.height, 1080);
assert.ok(vectorTextGpuRunCacheContains(rightBottomRoi, rightBottomRequest));

const tinyCanvasRoi = vectorTextGpuRunCacheAllocationBounds(
  { x: 7, y: 5, width: 1, height: 1 },
  17,
  13,
);
assert.deepEqual(
  tinyCanvasRoi,
  { x: 0, y: 0, width: 17, height: 13 },
  "un canvas piu piccolo del bucket deve restare una allocation valida",
);

for (const request of [
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 1919, y: 0, width: 1, height: 1 },
  { x: 0, y: 1079, width: 1, height: 1 },
  { x: 1919, y: 1079, width: 1, height: 1 },
  { x: 640, y: 360, width: 640, height: 360 },
]) {
  const allocation = vectorTextGpuRunCacheAllocationBounds(request, 1920, 1080);
  assert.ok(vectorTextGpuRunCacheContains(allocation, request));
  assert.ok(allocation.x >= 0 && allocation.y >= 0);
  assert.ok(allocation.x + allocation.width <= 1920);
  assert.ok(allocation.y + allocation.height <= 1080);
}

const clippedOffscreenWitnesses = [
  { x: 0, y: 540, width: 1, height: 1 },
  { x: 1919, y: 540, width: 1, height: 1 },
  { x: 960, y: 0, width: 1, height: 1 },
  { x: 960, y: 1079, width: 1, height: 1 },
];
for (const request of clippedOffscreenWitnesses) {
  const allocation = vectorTextGpuRunCacheAllocationBounds(request, 1920, 1080);
  assert.ok(
    vectorTextGpuRunCacheContains(allocation, request),
    "un draw offscreen ridotto al pixel sentinella deve restare contenuto",
  );
}

assert.equal(
  growVectorTextGpuCacheAxisCapacity(128, 100, 1920),
  128,
  "una capacity sufficiente non deve restringersi durante il movimento",
);
assert.equal(
  growVectorTextGpuCacheAxisCapacity(64, 65, 1920),
  128,
  "la crescita deve essere bucketizzata senza moltiplicare l'altro asse",
);
assert.equal(
  growVectorTextGpuCacheAxisCapacity(1536, 1800, 1920),
  1920,
  "la crescita geometrica deve essere limitata alla dimensione massima",
);
assert.throws(
  () => growVectorTextGpuCacheAxisCapacity(64, 1921, 1920),
  RangeError,
  "una richiesta oltre il limite deve fallire esplicitamente",
);

function polygonPath(rings, fillRule = 0) {
  const verbs = [];
  const coords = [];
  const contourOffsets = [];
  for (const ring of rings) {
    assert.ok(ring.length >= 3);
    contourOffsets.push(verbs.length);
    verbs.push(0);
    coords.push(ring[0][0], ring[0][1]);
    for (let index = 1; index < ring.length; index += 1) {
      verbs.push(1);
      coords.push(ring[index][0], ring[index][1]);
    }
    verbs.push(4);
  }
  return {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule,
  };
}

function reverseRing(ring) {
  return [...ring].reverse();
}

function assertCanonical(set, label) {
  for (const group of set.groups) {
    assert.ok(area(group.outer) > 0, `${label}: outer non positivo`);
    for (const hole of group.holes) {
      assert.ok(area(hole) < 0, `${label}: hole non negativo`);
    }
  }
  for (const ring of set.paths) {
    assert.ok(ring.length >= 3, `${label}: ring corto`);
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      assert.notDeepEqual(current, next, `${label}: punti consecutivi duplicati`);
      assert.ok(Number.isSafeInteger(current.x), `${label}: x non safe integer`);
      assert.ok(Number.isSafeInteger(current.y), `${label}: y non safe integer`);
    }
  }
}

function canonicalArea(set, integerScale) {
  return set.paths.reduce((total, ring) => total + area(ring), 0)
    / (integerScale * integerScale);
}

function meshTriangleArea(mesh) {
  let total = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const ia = mesh.indices[index] * 2;
    const ib = mesh.indices[index + 1] * 2;
    const ic = mesh.indices[index + 2] * 2;
    assert.ok(ic + 1 < mesh.vertices.length, "indice Earcut fuori range");
    const ax = mesh.vertices[ia];
    const ay = mesh.vertices[ia + 1];
    const bx = mesh.vertices[ib];
    const by = mesh.vertices[ib + 1];
    const cx = mesh.vertices[ic];
    const cy = mesh.vertices[ic + 1];
    const twice = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    assert.ok(Math.abs(twice) > 1e-10, "triangolo Earcut degenere");
    total += Math.abs(twice) * 0.5;
  }
  return total;
}

function assertTriangulation(set, lod, label) {
  const mesh = triangulateCanonicalVectorTextSet(
    set,
    lod.integerScale,
    `verify:${label}`,
    lod.bucket,
  );
  assert.equal(mesh.indices.length % 3, 0);
  const expected = canonicalArea(set, lod.integerScale);
  const actual = meshTriangleArea(mesh);
  const tolerance = Math.max(1e-5, Math.abs(expected) * 2e-6);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: area mesh ${actual} != area canonica ${expected}`,
  );
  return mesh;
}

function canonicalKey(set) {
  return JSON.stringify(set.groups.map((group) => ({
    outer: group.outer.map(({ x, y }) => [x, y]),
    holes: group.holes.map((ring) => ring.map(({ x, y }) => [x, y])),
  })));
}

function absoluteMeshBounds(mesh) {
  return {
    left: mesh.left + mesh.originX,
    top: mesh.top + mesh.originY,
    right: mesh.right + mesh.originX,
    bottom: mesh.bottom + mesh.originY,
  };
}

// Coordinate view/node: gli effetti non devono alterare il modello semantico.
const viewport = {
  width: 1420,
  height: 860,
  centerX: 2048,
  centerY: 2048,
  zoom: 0.197,
  rotation: 0.37,
};
const object = { x: 2110, y: 1960, scale: 1.42, rotation: -0.18 };
function localToLayer(point) {
  const x = point.x * object.scale;
  const y = point.y * object.scale;
  const cosine = Math.cos(object.rotation);
  const sine = Math.sin(object.rotation);
  return {
    x: object.x + cosine * x - sine * y,
    y: object.y + sine * x + cosine * y,
  };
}
function layerToCanvas(point) {
  const dx = point.x - viewport.centerX;
  const dy = point.y - viewport.centerY;
  const cosine = Math.cos(viewport.rotation);
  const sine = Math.sin(viewport.rotation);
  return {
    x: viewport.width * 0.5 + (cosine * dx - sine * dy) * viewport.zoom,
    y: viewport.height * 0.5 + (sine * dx + cosine * dy) * viewport.zoom,
  };
}
function canvasToLayer(point) {
  const x = (point.x - viewport.width * 0.5) / viewport.zoom;
  const y = (point.y - viewport.height * 0.5) / viewport.zoom;
  const cosine = Math.cos(viewport.rotation);
  const sine = Math.sin(viewport.rotation);
  return {
    x: viewport.centerX + cosine * x + sine * y,
    y: viewport.centerY - sine * x + cosine * y,
  };
}
for (const point of [
  { x: -900, y: -280 },
  { x: 900, y: -280 },
  { x: 900, y: 280 },
  { x: -900, y: 280 },
  { x: 0, y: 0 },
]) {
  const layer = localToLayer(point);
  const roundTrip = canvasToLayer(layerToCanvas(layer));
  assert.ok(Math.abs(roundTrip.x - layer.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - layer.y) < 1e-9);
}

// Strategie: nessun fallback bitmap, source Slug, effetti Clipper/Worker.
assert.equal(
  VECTOR_TEXT_PRESENTATION_STRATEGY,
  "semantic-vector-gpu-runs-slug-clipper-msaa4-rgba16f-roi-v7",
);
assert.equal(
  VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY,
  "gesture-window2-dual-gpu-auto-fallback-exact-settle-v7",
);
assert.equal(VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS, 140);
assert.equal(VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX, 0.5);
assert.equal(VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT, 2);
assert.equal(VECTOR_TEXT_WIDE_FALLBACK_MAX_ZOOM, 0.2);
assert.equal(
  VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
  "ten-semantic-text-seeded-arch-drop-block-inner-center-zoom64-v1",
);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_SEED, 0x5a17c0de);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT, 10);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM, 64);
assert.equal(
  VECTOR_TEXT_ZOOM_AB_STRATEGY,
  "ten-semantic-text-pan180-refresh-during-vs-release-v1",
);
assert.equal(VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT, 30);
assert.equal(VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT, 180);
assert.equal(VECTOR_TEXT_ZOOM_AB_START_ZOOM, 64);
assert.equal(
  VECTOR_TEXT_ZOOM_C_STRATEGY,
  "ten-semantic-text-dual-gpu-fallback-auto-post-raster-window2-roi-aware-zoom8-to-0.3-v7",
);
assert.equal(VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT, 30);
assert.equal(VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT, 120);
assert.equal(VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS, 650);
assert.equal(VECTOR_TEXT_ZOOM_C_START_ZOOM, 8);
assert.equal(VECTOR_TEXT_ZOOM_C_TARGET_ZOOM, 0.3);
assert.equal(VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM, 0.2);
assert.equal(VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER.length, 10);
assert.deepEqual(
  Object.fromEntries(
    ["arch", "drop-shadow", "block-shadow", "inner-shadow"].map((profile) => [
      profile,
      VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER.filter((candidate) => candidate === profile).length,
    ]),
  ),
  { arch: 3, "drop-shadow": 3, "block-shadow": 2, "inner-shadow": 2 },
);
const stressSeedsA = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomStressSeed(index, 4096),
);
const stressSeedsB = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomStressSeed(index, 4096),
);
assert.deepEqual(stressSeedsA, stressSeedsB, "la fixture deve essere byte-deterministica");
assert.equal(stressSeedsA.filter(({ seed }) => seed.transformType === "arch").length, 3);
assert.equal(stressSeedsA.filter(({ seed }) => seed.singleShadowEnabled).length, 3);
assert.equal(stressSeedsA.filter(({ seed }) => seed.blockShadowEnabled).length, 2);
assert.equal(stressSeedsA.filter(({ seed }) => seed.innerShadowEnabled).length, 2);
assert.throws(() => vectorTextZoomStressSeed(10, 4096), /out of range/);
const portraitStressSeed = vectorTextZoomStressSeed(0, 1080, 1920).seed;
assert.ok(Math.abs(portraitStressSeed.x - 540) < 0.04);
assert.ok(Math.abs(portraitStressSeed.y - 960) < 0.04);
const coverageSeeds = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomCoverageSeed(index, 4096, {
    canvasWidth: 390,
    canvasHeight: 844,
    targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  }),
);
assert.equal(new Set(coverageSeeds.map(({ seed }) => `${seed.x}:${seed.y}`)).size, 10);
assert.ok(coverageSeeds.every(({ seed }) => (
  Math.abs(seed.x - 2048) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM < 390 * 0.5
  && Math.abs(seed.y - 2048) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM < 844 * 0.5
)));
assert.deepEqual(
  coverageSeeds.map(({ profile }) => profile),
  [...VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER],
  "C deve cambiare soltanto la distribuzione, non il mix deterministico degli effetti",
);
const portraitCoverageSeeds = Array.from(
  { length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT },
  (_, index) => vectorTextZoomCoverageSeed(index, 1080, 1920, {
    canvasWidth: 390,
    canvasHeight: 844,
    targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  }),
);
assert.ok(portraitCoverageSeeds.every(({ seed }) => (
  seed.x >= 0 && seed.x <= 1080 && seed.y >= 0 && seed.y <= 1920
)));
assert.equal(portraitCoverageSeeds[0].seed.x, 540);
assert.equal(portraitCoverageSeeds[0].seed.y, 960);
let plannedZoom = 0.2;
let plannedZoomSteps = 0;
while (plannedZoom < VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM && plannedZoomSteps < 64) {
  plannedZoom *= vectorTextZoomStressStepFactor(plannedZoom);
  plannedZoomSteps += 1;
}
assert.ok(Math.abs(plannedZoom - 64) < 1e-9);
assert.ok(plannedZoomSteps > 1 && plannedZoomSteps < 64);
const capturedView = {
  canvasWidth: 390,
  canvasHeight: 844,
  cssWidth: 390,
  cssHeight: 844,
  centerX: 2048,
  centerY: 2048,
  zoom: 1,
  rotationRadians: 0,
  rotationCos: 1,
  rotationSin: 0,
};
assert.equal(vectorTextFastPresentationMode(capturedView, capturedView), "reproject");
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, zoom: 64 }),
  "reproject",
  "lo zoom-in fino a 64× resta interamente coperto dalla capture",
);
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, zoom: 0.5 }),
  "reproject-clipped",
  "lo zoom-out deve seguire la camera e richiedere il refresh delle zone scoperte",
);
const wideCapture = { ...capturedView, zoom: VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM };
assert.equal(
  vectorTextFastPresentationMode(
    { ...capturedView, zoom: VECTOR_TEXT_ZOOM_C_START_ZOOM },
    {
      ...capturedView,
      centerX: capturedView.centerX + 180,
      centerY: capturedView.centerY + 50,
      zoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
    },
    wideCapture,
  ),
  "reproject-fallback",
  "C deve coprire lo zoom-out con la seconda capture senza dichiararlo clipped",
);
const mobilePhysicalView = {
  ...capturedView,
  canvasWidth: 828,
  canvasHeight: 1500,
  cssWidth: 414,
  cssHeight: 750,
  centerX: 1024,
  centerY: 1024,
};
const automaticWideCapture = vectorTextWideFallbackView(mobilePhysicalView, 2048);
assert.equal(automaticWideCapture.zoom, VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM);
assert.equal(vectorTextCaptureCoversDocument(automaticWideCapture, 2048), true);
assert.equal(
  vectorTextFastPresentationMode(
    { ...mobilePhysicalView, zoom: VECTOR_TEXT_ZOOM_C_START_ZOOM },
    {
      ...mobilePhysicalView,
      centerX: 1400,
      centerY: 700,
      zoom: 0.02,
    },
    automaticWideCapture,
    2048,
  ),
  "reproject-fallback",
  "la fallback production copre i pixel documento anche a zoom-out estremo",
);
assert.equal(
  vectorTextCaptureCoversDocument({ ...automaticWideCapture, zoom: 0.5 }, 2048),
  false,
  "una cache larga che non contiene l'intero documento non deve essere pubblicabile",
);
const rectangularViewport = {
  ...capturedView,
  canvasWidth: 300,
  canvasHeight: 100,
  cssWidth: 300,
  cssHeight: 100,
  centerX: 12,
  centerY: 34,
};
const portraitWideCapture = vectorTextWideFallbackView(
  rectangularViewport,
  1080,
  1920,
);
assert.equal(portraitWideCapture.centerX, 540);
assert.equal(portraitWideCapture.centerY, 960);
assert.equal(
  portraitWideCapture.zoom,
  Math.min(300 / 1080, 100 / 1920) * 0.94,
);
assert.equal(vectorTextCaptureCoversDocument(portraitWideCapture, 1080, 1920), true);
assert.equal(
  vectorTextCaptureCoversDocument(portraitWideCapture, 1080, 3000),
  false,
  "la copertura deve verificare l'altezza reale, non il solo asse massimo",
);
assert.equal(
  vectorTextFastPresentationMode(
    { ...rectangularViewport, zoom: 8 },
    { ...rectangularViewport, zoom: 0.02 },
    portraitWideCapture,
    1080,
    1920,
  ),
  "reproject-fallback",
);

function simulateFastPresentationWindow(capacity, frameCount) {
  const completions = [];
  let inFlight = 0;
  let peakInFlight = 0;
  let submissionCount = 0;
  let coalescedCount = 0;
  for (let tick = 0; tick < frameCount; tick += 1) {
    for (let index = completions.length - 1; index >= 0; index -= 1) {
      if (completions[index] <= tick) {
        completions.splice(index, 1);
        inFlight -= 1;
      }
    }
    if (inFlight >= capacity) {
      coalescedCount += 1;
      continue;
    }
    submissionCount += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const callbackDelayTicks = submissionCount % 2 === 1 ? 1 : 2;
    completions.push(tick + callbackDelayTicks);
  }
  return { submissionCount, coalescedCount, peakInFlight };
}

const singleSlotTrace = simulateFastPresentationWindow(1, 40);
assert.equal(singleSlotTrace.submissionCount, 27);
assert.equal(singleSlotTrace.coalescedCount, 13);
const twoSlotTrace = simulateFastPresentationWindow(
  VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT,
  40,
);
assert.equal(twoSlotTrace.submissionCount, 40);
assert.equal(twoSlotTrace.coalescedCount, 0);
assert.equal(twoSlotTrace.peakInFlight, 2);

const schedulerState = {
  inFlight: 0,
  latest: null,
  submitted: [],
  peak: 0,
};
const requestSchedulerRevision = (revision) => {
  if (schedulerState.inFlight >= VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT) {
    schedulerState.latest = revision;
    return;
  }
  schedulerState.submitted.push(revision);
  schedulerState.inFlight += 1;
  schedulerState.peak = Math.max(schedulerState.peak, schedulerState.inFlight);
};
const completeSchedulerRevision = () => {
  schedulerState.inFlight -= 1;
  if (schedulerState.latest !== null) {
    const latest = schedulerState.latest;
    schedulerState.latest = null;
    requestSchedulerRevision(latest);
  }
};
requestSchedulerRevision(1);
requestSchedulerRevision(2);
for (let revision = 3; revision <= 20; revision += 1) {
  requestSchedulerRevision(revision);
}
completeSchedulerRevision();
completeSchedulerRevision();
completeSchedulerRevision();
assert.deepEqual(schedulerState.submitted, [1, 2, 20]);
assert.equal(schedulerState.peak, 2);
assert.equal(schedulerState.inFlight, 0);
assert.equal(schedulerState.latest, null);
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, centerX: 2500 }),
  "reproject-clipped",
  "un pan oltre la capture deve restare agganciato e usare il refresh esatto bounded",
);
assert.equal(
  vectorTextFastPresentationMode(capturedView, { ...capturedView, canvasWidth: 430 }),
  "reproject-clipped",
  "un resize non è coperto dalla cache viewport precedente",
);
const capturedZoom64View = { ...capturedView, zoom: VECTOR_TEXT_ZOOM_AB_START_ZOOM };
assert.equal(
  vectorTextFastPresentationMode(capturedZoom64View, {
    ...capturedZoom64View,
    centerX: capturedZoom64View.centerX + 1 / VECTOR_TEXT_ZOOM_AB_START_ZOOM,
  }),
  "reproject-clipped",
  "un pan di un pixel a 64× deve esercitare il ramo clipped del test A/B",
);
assert.equal(vectorTextExactRecoveryIsCurrent(100, 100, false), true);
assert.equal(vectorTextExactRecoveryIsCurrent(99, 100, false), false);
assert.equal(vectorTextExactRecoveryIsCurrent(100, 100, true), false);
let runnableRecoveries = 0;
for (let revision = 1; revision <= 100; revision += 1) {
  if (vectorTextExactRecoveryIsCurrent(revision, 100, false)) runnableRecoveries += 1;
}
assert.equal(
  runnableRecoveries,
  1,
  "una raffica di 100 campioni conserva una sola recovery, quella latest",
);
assert.equal(
  VECTOR_TEXT_OUTLINE_STRATEGY,
  "webgpu-clipper64-worker-outside-offset-aa-overlap1px-same-color-fused-round-bevel-miter4-v6",
);
assert.equal(
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  "webgpu-clipper64-worker-visible-swept-union-separate-clipped-overlap2px-mesh-v8",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  "webgpu-zero-blur-or-r16float-separable-adaptive-tent-v4",
);
assert.equal(
  VECTOR_TEXT_INNER_SHADOW_STRATEGY,
  "webgpu-analytic-fill-clip-zero-blur-or-r16float-adaptive-tent-v3",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  "webgpu-r16float-mask-separable-adaptive-tent-roi-cache-v4",
);
assert.equal(
  VECTOR_TEXT_GPU_GEOMETRY_STRATEGY,
  "clipper64-nonzero-wasm-worker-native-round-bevel-exact-miter-aa-overlap-same-color-union-visible-block-separate-clipped-overlap2px-earcut-v11",
);
assert.equal(VECTOR_TEXT_GEOMETRY_COMPILER_VERSION, "clipper64-nonzero-lod-wasm-worker-v11");
assert.equal(
  VECTOR_TEXT_SLUG_GPU_RENDER_STRATEGY,
  "webgpu-slug-source-clipper-effect-mesh-msaa4-stable-lines-absolute-f32-scale-v5",
);
assert.equal(
  VECTOR_TEXT_SLUG_COMPILER_VERSION,
  "three-text-slug-0.6.5-whole-node-compact-bands-inclusive-v2",
);
assert.equal(
  VECTOR_TEXT_GPU_RENDER_STRATEGY,
  "webgpu-indexed-vector-tagged-rgba16float-msaa4-adaptive-tiled-coverage-svg-gradients-v5",
);
assert.equal(VECTOR_TEXT_GPU_UNIFORM_FLOATS, 60);
assert.equal(VECTOR_TEXT_GPU_UNIFORM_BYTES, 240);
assert.equal(VECTOR_TEXT_GPU_TARGET_FORMAT, "rgba16float");
assert.equal(VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL, 8);
assert.equal(VECTOR_TEXT_GPU_SAMPLE_COUNT, 4);
assert.equal(VECTOR_TEXT_GPU_BLUR_FORMAT, "r16float");
assert.equal(VECTOR_TEXT_GPU_BLUR_BYTES_PER_PIXEL, 2);
assert.equal(MIXED_SCENE_LINEAR_FORMAT, "rgba16float");
assert.equal(
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  "ordered-raster-vector-gpu-runs-rgba16f-tagged-premultiplied-roi-mip-srgb-aware-source-over-v10",
);
assert.equal(
  VECTOR_TEXT_FONT_GEOMETRY_STRATEGY,
  "local-opentype-outline-transform-v4-distort",
);
assert.equal(
  VECTOR_TEXT_TRANSFORM_STRATEGY,
  "centered-arch-wave-distort-six-vertex-four-handle-cubic-distance-warp-circle-rigid-glyph-v3",
);
assert.equal(packageJson.dependencies["clipper2-ts"], "2.0.1-18");
assert.equal(packageJson.dependencies.earcut, "^3.0.2");
assert.ok(!fs.existsSync(new URL("../src/vector-path-gpu-geometry.ts", import.meta.url)));

// Normalizzazione UI e convenzione +Y verso il basso.
assert.equal(VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM, 100);
assert.equal(VECTOR_TEXT_OUTLINE_MITER_LIMIT, 4);
assert.equal(normalizeVectorTextOutlineWidth(-5), 0);
assert.equal(normalizeVectorTextOutlineWidth(999), 100);
assert.equal(normalizeVectorTextOutlineJoin("invalid"), "round");
assert.equal(vectorTextOutlineLocalReach(25, "round"), 25);
assert.equal(vectorTextOutlineLocalReach(25, "bevel"), 25);
assert.equal(vectorTextOutlineLocalReach(25, "miter"), 100);
assert.equal(normalizeVectorTextBlockShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextBlockShadowOpacity(2), 1);
assert.equal(normalizeVectorTextBlockShadowOffset(-1), 0);
assert.equal(normalizeVectorTextBlockShadowOffset(200), 100);
assert.equal(normalizeVectorTextBlockShadowAngle(-999), -180);
assert.equal(normalizeVectorTextBlockShadowAngle(999), 180);
assert.equal(vectorTextBlockShadowLocalReach(360, 23), 23);
const blockVector = vectorTextBlockShadowLocalVector(360, 23, -104);
assert.ok(Math.abs(blockVector.x + 5.564204) < 1e-6);
assert.ok(Math.abs(blockVector.y - 22.316802) < 1e-6);
assert.equal(normalizeVectorTextSingleShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextSingleShadowOpacity(2), 1);
assert.equal(normalizeVectorTextSingleShadowOffset(-1), 0);
assert.equal(normalizeVectorTextSingleShadowOffset(999), 100);
assert.equal(normalizeVectorTextSingleShadowAngle(-999), -180);
assert.equal(normalizeVectorTextSingleShadowAngle(999), 180);
assert.equal(normalizeVectorTextSingleShadowBlur(-1), 0);
assert.equal(normalizeVectorTextSingleShadowBlur(999), 300);
const sharpShadow = vectorTextSingleShadowLocalVector(54, -180);
assert.ok(Math.abs(sharpShadow.x + 54) < 1e-9);
assert.equal(normalizeVectorTextInnerShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextInnerShadowOpacity(2), 1);
assert.equal(normalizeVectorTextInnerShadowOffset(-1), 0);
assert.equal(normalizeVectorTextInnerShadowOffset(999), 100);
assert.equal(normalizeVectorTextInnerShadowAngle(-999), -180);
assert.equal(normalizeVectorTextInnerShadowAngle(999), 180);
assert.equal(normalizeVectorTextInnerShadowBlur(-1), 0);
assert.equal(normalizeVectorTextInnerShadowBlur(999), 300);
const innerShadowVector = vectorTextInnerShadowLocalVector(12, -135);
assert.ok(Math.abs(innerShadowVector.x + 8.485281) < 1e-6);
assert.ok(Math.abs(innerShadowVector.y - 8.485281) < 1e-6);
assert.ok(Math.abs(sharpShadow.y) < 1e-9);

// Transformations: preserve the calibrated preset contracts.
assert.equal(normalizeVectorTextTransformCurve(-999), -100);
assert.equal(normalizeVectorTextTransformCurve(999), 100);
assert.equal(normalizeVectorTextCircleRadiusPercent(1), 16);
assert.equal(normalizeVectorTextCircleRadiusPercent(999), 200);
assert.deepEqual(normalizeVectorTextTransformParameters(undefined), {
  type: "none",
  curve: 80,
  circleRadiusPercent: 50,
  circleInverted: false,
  distortPoints: null,
});
const distortSourceBounds = { left: 0, top: 0, right: 1000, bottom: 400 };
const defaultDistort = defaultVectorTextDistortPoints(distortSourceBounds);
assert.equal(defaultDistort.length, 10);
assert.deepEqual(defaultDistort[0], { x: 0, y: 0 });
assert.deepEqual(defaultDistort[1], { x: 500, y: 0 });
assert.deepEqual(defaultDistort[2], { x: 1000, y: 0 });
assert.deepEqual(defaultDistort[3], { x: 1000, y: 400 });
assert.deepEqual(defaultDistort[4], { x: 500, y: 400 });
assert.deepEqual(defaultDistort[5], { x: 0, y: 400 });
assert.equal(normalizeVectorTextDistortPoints(defaultDistort)?.length, 10);
assert.equal(normalizeVectorTextDistortPoints(defaultDistort.slice(0, 9)), null);
assert.equal(normalizeVectorTextTransformParameters({ type: "distort" }).type, "distort");
for (const point of [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
  { x: 1000, y: 0 },
  { x: 0, y: 400 },
  { x: 500, y: 400 },
  { x: 1000, y: 400 },
  { x: 250, y: 200 },
  { x: 750, y: 200 },
]) {
  const mapped = warpVectorTextPointFreeForm(
    point,
    distortSourceBounds,
    defaultDistort,
  );
  assert.ok(Math.abs(mapped.x - point.x) < 1e-8);
  assert.ok(Math.abs(mapped.y - point.y) < 1e-8);
}
assert.deepEqual(vectorTextDistortBounds(defaultDistort), distortSourceBounds);

const raisedTopMiddle = moveVectorTextDistortPoint(
  defaultDistort,
  1,
  { x: 500, y: -120 },
);
assert.deepEqual(raisedTopMiddle[1], { x: 500, y: -120 });
assert.deepEqual(raisedTopMiddle[6], { x: 250, y: -120 });
assert.deepEqual(raisedTopMiddle[7], { x: 750, y: -120 });
assert.deepEqual(defaultDistort[1], { x: 500, y: 0 });

const bentTopHandle = moveVectorTextDistortPoint(
  defaultDistort,
  6,
  { x: 400, y: 100 },
);
const movedHandleVector = {
  x: bentTopHandle[6].x - bentTopHandle[1].x,
  y: bentTopHandle[6].y - bentTopHandle[1].y,
};
const mirroredHandleVector = {
  x: bentTopHandle[7].x - bentTopHandle[1].x,
  y: bentTopHandle[7].y - bentTopHandle[1].y,
};
assert.ok(Math.abs(
  movedHandleVector.x * mirroredHandleVector.y
    - movedHandleVector.y * mirroredHandleVector.x,
) < 1e-8);
assert.ok(
  movedHandleVector.x * mirroredHandleVector.x
    + movedHandleVector.y * mirroredHandleVector.y < 0,
);
assert.ok(Math.abs(Math.hypot(
  mirroredHandleVector.x,
  mirroredHandleVector.y,
) - 250) < 1e-8, "la maniglia opposta conserva la propria lunghezza");

const shortTextCenter = warpVectorTextPointFreeForm(
  { x: 100, y: 50 },
  { left: 0, top: 0, right: 200, bottom: 100 },
  raisedTopMiddle,
);
const longTextCenter = warpVectorTextPointFreeForm(
  { x: 700, y: 250 },
  { left: 0, top: 0, right: 1400, bottom: 500 },
  raisedTopMiddle,
);
assert.ok(Math.abs(shortTextCenter.x - longTextCenter.x) < 1e-8);
assert.ok(Math.abs(shortTextCenter.y - longTextCenter.y) < 1e-8);

const distortControlPath = {
  verbs: new Uint8Array([0, 3, 4]),
  coords: new Float64Array([0, 0, 250, 100, 750, 300, 1000, 400]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const distortedControlPath = warpVectorTextPathFreeForm(
  distortControlPath,
  distortSourceBounds,
  raisedTopMiddle,
);
assert.deepEqual([...distortedControlPath.verbs], [...distortControlPath.verbs]);
assert.deepEqual(
  [...distortedControlPath.contourOffsets],
  [...distortControlPath.contourOffsets],
);
assert.equal(distortedControlPath.coords.length, distortControlPath.coords.length);
assert.ok(
  [...distortedControlPath.coords].some(
    (value, index) => Math.abs(value - distortControlPath.coords[index]) > 1e-6,
  ),
);

// Regressione Distort + blur: abbassare e decentrare il punto inferiore
// produce uno Slug con origine non nulla. La ROI della mask dovra' quindi
// essere convertita in coordinate Slug, mentre la ROI di compositing resta
// nelle coordinate locali assolute del nodo.
const loweredBottomMiddle = moveVectorTextDistortPoint(
  defaultDistort,
  4,
  { x: 620, y: 680 },
);
assert.deepEqual(loweredBottomMiddle[4], { x: 620, y: 680 });
assert.deepEqual(loweredBottomMiddle[8], { x: 370, y: 680 });
assert.deepEqual(loweredBottomMiddle[9], { x: 870, y: 680 });
const distortBlurPath = {
  verbs: new Uint8Array([0, 3, 3, 3, 4]),
  coords: new Float64Array([
    100, 100,
    300, 20, 700, 20, 900, 100,
    900, 340, 650, 400, 500, 400,
    350, 400, 100, 340, 100, 100,
  ]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const loweredDistortBlurPath = warpVectorTextPathFreeForm(
  distortBlurPath,
  distortSourceBounds,
  loweredBottomMiddle,
);
const loweredDistortBlurSlug = buildVectorTextSlugData(
  loweredDistortBlurPath,
  vectorPathIdentityPool.intern(loweredDistortBlurPath),
);
const loweredDistortBlurAbsoluteBounds = {
  left: loweredDistortBlurSlug.left + loweredDistortBlurSlug.originX,
  top: loweredDistortBlurSlug.top + loweredDistortBlurSlug.originY,
  right: loweredDistortBlurSlug.right + loweredDistortBlurSlug.originX,
  bottom: loweredDistortBlurSlug.bottom + loweredDistortBlurSlug.originY,
};
const loweredDistortBlurPlan = planVectorTextSingleShadowBlur(
  loweredDistortBlurAbsoluteBounds,
  20,
  1,
);
assert.ok(
  Math.abs(loweredDistortBlurSlug.originX) > 1
    && loweredDistortBlurSlug.originY > 1,
  "la fixture deve esercitare la doppia origine su entrambi gli assi",
);
assert.ok(
  loweredDistortBlurPlan.bounds[3] + loweredDistortBlurSlug.originY
    > loweredDistortBlurPlan.bounds[3],
  "i bounds assoluti usati come bounds Slug oltrepasserebbero la ROI inferiore",
);
for (let index = 0; index < loweredDistortBlurPlan.bounds.length; index += 1) {
  const origin = index % 2 === 0
    ? loweredDistortBlurSlug.originX
    : loweredDistortBlurSlug.originY;
  const sourceBound = loweredDistortBlurPlan.bounds[index] - origin;
  assert.ok(
    Math.abs(sourceBound + origin - loweredDistortBlurPlan.bounds[index]) < 1e-8,
    "la ROI source relativa deve ricostruire esattamente la ROI assoluta",
  );
}

const archGuide = buildVectorTextCurveGuide("arch", 1000, 400, 80);
const archStart = archGuide.pointAtDistance(0);
const archMiddle = archGuide.pointAtDistance(500);
assert.ok(archMiddle.y < archStart.y, "Arch positivo deve sollevare il centro");
const centeredArchOffset = (archGuide.length - 1000) * 0.5;
const centeredArchLeft = archGuide.pointAtDistance(centeredArchOffset);
const centeredArchMiddle = archGuide.pointAtDistance(centeredArchOffset + 500);
const centeredArchRight = archGuide.pointAtDistance(centeredArchOffset + 1000);
assert.ok(
  Math.abs(centeredArchLeft.x + centeredArchRight.x) < 1e-7,
  "Arch centrato deve avere estremi X speculari",
);
assert.ok(
  Math.abs(centeredArchLeft.y - centeredArchRight.y) < 1e-7,
  "Arch centrato deve avere estremi alla stessa altezza",
);
assert.ok(
  Math.abs(centeredArchMiddle.x) < 1e-7,
  "Il centro del testo deve cadere sull'apice dell'Arch",
);
for (const curve of [-100, -47, 0, 47, 100]) {
  const symmetricGuide = buildVectorTextCurveGuide("arch", 1000, 400, curve);
  const symmetricOffset = (symmetricGuide.length - 1000) * 0.5;
  const leftPoint = symmetricGuide.pointAtDistance(symmetricOffset);
  const middlePoint = symmetricGuide.pointAtDistance(symmetricOffset + 500);
  const rightPoint = symmetricGuide.pointAtDistance(symmetricOffset + 1000);
  assert.ok(Math.abs(leftPoint.x + rightPoint.x) < 1e-7);
  assert.ok(Math.abs(leftPoint.y - rightPoint.y) < 1e-7);
  assert.ok(Math.abs(middlePoint.x) < 1e-7);
}
const invertedArchGuide = buildVectorTextCurveGuide("arch", 1000, 400, -80);
assert.ok(
  invertedArchGuide.pointAtDistance(500).y
    > invertedArchGuide.pointAtDistance(0).y,
  "Arch negativo deve invertire la curva",
);
const waveGuide = buildVectorTextCurveGuide("wave", 1000, 400, 80);
assert.notEqual(
  Math.round(waveGuide.pointAtDistance(0).y),
  Math.round(waveGuide.pointAtDistance(900).y),
);
const controlPath = {
  verbs: new Uint8Array([0, 3, 4]),
  coords: new Float64Array([0, 10, 250, 20, 750, 30, 1000, 40]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const warpedControlPath = warpVectorTextPathAlongCurve(
  controlPath,
  archGuide,
  0,
);
assert.deepEqual([...warpedControlPath.verbs], [...controlPath.verbs]);
assert.deepEqual(
  [...warpedControlPath.contourOffsets],
  [...controlPath.contourOffsets],
);
assert.equal(warpedControlPath.coords.length, controlPath.coords.length);
for (let index = 0; index < controlPath.coords.length; index += 2) {
  const guidePoint = archGuide.pointAtDistance(controlPath.coords[index]);
  assert.ok(Math.abs(warpedControlPath.coords[index] - guidePoint.x) < 1e-8);
  assert.ok(
    Math.abs(
      warpedControlPath.coords[index + 1]
        - (guidePoint.y + controlPath.coords[index + 1]),
    ) < 1e-8,
  );
}
const centeredControlPath = warpVectorTextPathAlongCurve(
  {
    verbs: new Uint8Array([0, 1, 1]),
    coords: new Float64Array([0, 0, 500, 0, 1000, 0]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  },
  archGuide,
  0,
  0,
  centeredArchOffset,
);
assert.ok(
  Math.abs(centeredControlPath.coords[0] + centeredControlPath.coords[4]) < 1e-7,
  "Il warp centrato deve conservare la simmetria X",
);
assert.ok(
  Math.abs(centeredControlPath.coords[1] - centeredControlPath.coords[5]) < 1e-7,
  "Il warp centrato deve conservare la simmetria Y",
);
const circleStart = vectorTextCirclePlacement(0, 0, 100, false);
assert.ok(Math.abs(circleStart.targetX) < 1e-9);
assert.ok(Math.abs(circleStart.targetY + 100) < 1e-9);
assert.ok(Math.abs(circleStart.rotation) < 1e-9);
const circleQuarter = vectorTextCirclePlacement(Math.PI * 50, 0, 100, false);
assert.ok(Math.abs(circleQuarter.targetX - 100) < 1e-9);
assert.ok(Math.abs(circleQuarter.targetY) < 1e-9);
assert.ok(Math.abs(circleQuarter.rotation - Math.PI / 2) < 1e-9);
const invertedCircleStart = vectorTextCirclePlacement(0, 0, 100, true);
assert.ok(Math.abs(invertedCircleStart.targetX) < 1e-9);
assert.ok(Math.abs(invertedCircleStart.targetY - 100) < 1e-9);
assert.ok(Math.abs(invertedCircleStart.rotation) < 1e-9);
const circlePivotPath = {
  verbs: new Uint8Array([0]),
  coords: new Float64Array([50, -20]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const circlePivotPlacement = vectorTextCirclePlacement(50, 0, 100, false);
const mappedCirclePivot = transformVectorTextPathAffine(
  circlePivotPath,
  vectorTextCircleAffine(50, -20, 0, 100, false),
);
assert.ok(
  Math.abs(mappedCirclePivot.coords[0] - circlePivotPlacement.targetX) < 1e-9,
);
assert.ok(
  Math.abs(mappedCirclePivot.coords[1] - circlePivotPlacement.targetY) < 1e-9,
);
assert.match(transformSource, /arch:[\s\S]*x: 0\.5, y: 0\.65/);
assert.match(transformSource, /wave:[\s\S]*x: 0\.8, y: 0\.5/);
assert.match(transformSource, /verbs: path\.verbs\.slice\(\)/);
assert.doesNotMatch(transformSource, /flatten|polygon/i);
assert.match(fontGeometrySource, /font\.getPaths\(/);
assert.match(controllerSource, /node\.transformType/);
assert.match(controllerSource, /includeFill: fuseOutlineAndFill/);
assert.match(controllerSource, /if \(!sourceFillCoveredByOutline\)/);
assert.match(clientSource, /include-fill/);
assert.match(controllerSource, /rotation: 0,/);
assert.doesNotMatch(controllerSource, /rotation: index === 0/);

// LOD: errore in pixel monotono e bound sotto 0,1 px fino a 64×.
assert.equal(VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM, 64);
const lodSamples = [0.02, 0.197, 1, 8, 32, 64].map(vectorTextLodForSigma);
for (let index = 1; index < lodSamples.length; index += 1) {
  assert.ok(lodSamples[index].bucket >= lodSamples[index - 1].bucket);
  assert.ok(lodSamples[index].integerScale >= lodSamples[index - 1].integerScale);
}
const maxLod = vectorTextMaximumLod();
assert.equal(maxLod.bucketScale, 64);
assert.ok(maxLod.cubicToQuadraticTolerance * 64 <= 0.015625 + 1e-12);
assert.ok(maxLod.polygonFlattenTolerance * 64 <= 0.03125 + 1e-12);
assert.ok(maxLod.roundArcSagittaTolerance * 64 <= 0.03125 + 1e-12);
assert.ok(Math.SQRT2 * 0.5 / maxLod.integerScale * 64 < 0.006);

// Topologia Clipper NonZero: holes, overlap, auto-intersezioni e degenerazioni.
const lod = vectorTextLodForSigma(1);
const outer = [[0, 0], [120, 0], [120, 100], [0, 100]];
const inner = [[30, 30], [90, 30], [90, 70], [30, 70]];
const sourceRectangle = polygonPath([outer]);
const rectangleSet = canonicalizeVectorTextPath(sourceRectangle, lod);
assertCanonical(rectangleSet, "rectangle");
assert.equal(rectangleSet.groups.length, 1);
assert.equal(rectangleSet.groups[0].holes.length, 0);
assertTriangulation(rectangleSet, lod, "rectangle");

const sameNested = canonicalizeVectorTextPath(polygonPath([outer, inner]), lod);
assertCanonical(sameNested, "same-oriented nested");
assert.equal(sameNested.groups.length, 1);
assert.equal(sameNested.groups[0].holes.length, 0);

const oppositeNested = canonicalizeVectorTextPath(
  polygonPath([outer, reverseRing(inner)]),
  lod,
);
assertCanonical(oppositeNested, "opposite nested");
assert.equal(oppositeNested.groups.length, 1);
assert.equal(oppositeNested.groups[0].holes.length, 1);
assertTriangulation(oppositeNested, lod, "opposite nested");

const island = [[45, 40], [75, 40], [75, 60], [45, 60]];
const threeLevels = canonicalizeVectorTextPath(
  polygonPath([outer, reverseRing(inner), island]),
  lod,
);
assertCanonical(threeLevels, "three levels");
assert.equal(threeLevels.groups.length, 2);
assertTriangulation(threeLevels, lod, "three levels");

const overlapA = [[0, 0], [80, 0], [80, 80], [0, 80]];
const overlapB = [[50, 20], [130, 20], [130, 100], [50, 100]];
const overlapping = canonicalizeVectorTextPath(polygonPath([overlapA, overlapB]), lod);
const overlappingPermuted = canonicalizeVectorTextPath(
  polygonPath([overlapB, overlapA]),
  lod,
);
assertCanonical(overlapping, "overlap");
assert.equal(canonicalKey(overlapping), canonicalKey(overlappingPermuted));
assertTriangulation(overlapping, lod, "overlap");

const bowTie = canonicalizeVectorTextPath(
  polygonPath([[[0, 0], [100, 100], [0, 100], [100, 0]]]),
  lod,
);
assertCanonical(bowTie, "bow-tie");
assert.ok(bowTie.groups.length > 0, "bow-tie non deve essere scartato per area netta zero");
assertTriangulation(bowTie, lod, "bow-tie");

const duplicateAndZeroLength = canonicalizeVectorTextPath(
  polygonPath([[[0, 0], [100, 0], [100, 0], [100, 0.000001], [100, 80], [0, 80]]]),
  lod,
);
assertCanonical(duplicateAndZeroLength, "duplicate/near-collinear");
assert.ok(duplicateAndZeroLength.groups.length > 0);

const explicitZeroLengthCurves = vectorPathToQuadraticContours({
  verbs: new Uint8Array([0, 2, 3, 1, 1, 1, 4]),
  coords: new Float64Array([
    0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
    80, 0,
    80, 60,
    0, 60,
  ]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
}, lod.cubicToQuadraticTolerance);
assert.equal(explicitZeroLengthCurves.length, 1);
assert.equal(explicitZeroLengthCurves[0].curves.length, 4);
for (const curve of explicitZeroLengthCurves[0].curves) {
  assert.ok(
    curve.p0.x !== curve.p2.x || curve.p0.y !== curve.p2.y,
    "le curve completamente degeneri devono essere rimosse",
  );
}

const tangentContours = canonicalizeVectorTextPath(
  polygonPath([
    [[0, 0], [50, 0], [50, 50], [0, 50]],
    [[50, 50], [100, 50], [100, 100], [50, 100]],
  ]),
  lod,
);
assertCanonical(tangentContours, "tangent contours");
assertTriangulation(tangentContours, lod, "tangent contours");

// Outline: zero è un vero no-op; round/bevel e miter producono regioni canoniche.
// La mesh runtime sovrappone 1 px sotto il fill analitico senza cambiare il bordo esterno.
assert.equal(VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS, 1);
assert.equal(VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS, 2);
assert.equal(
  compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 0, join: "round" },
    "width-zero",
  ),
  null,
);
const sourceFillMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  { kind: "source-fill" },
  "source-fill",
);
assert.ok(sourceFillMesh);
assert.deepEqual(absoluteMeshBounds(sourceFillMesh), {
  left: 0,
  top: 0,
  right: 120,
  bottom: 100,
});
for (const join of ["round", "bevel", "miter"]) {
  const outlineSet = buildOutsideVectorTextOutline(
    rectangleSet,
    10 * lod.integerScale,
    join,
    Math.max(1, Math.round(lod.roundArcSagittaTolerance * lod.integerScale)),
  );
  assert.ok(outlineSet);
  assertCanonical(outlineSet, `outline-${join}`);
  assert.ok(canonicalArea(outlineSet, lod.integerScale) > 0);
  const outlineMesh = assertTriangulation(outlineSet, lod, `outline-${join}`);
  const seamSafeOutlineSet = buildOutsideVectorTextOutline(
    rectangleSet,
    10 * lod.integerScale,
    join,
    Math.max(1, Math.round(lod.roundArcSagittaTolerance * lod.integerScale)),
    VECTOR_TEXT_OUTLINE_INNER_OVERLAP_PIXELS * lod.integerScale,
  );
  assert.ok(seamSafeOutlineSet);
  assertCanonical(seamSafeOutlineSet, `outline-seam-safe-${join}`);
  assert.ok(
    canonicalArea(seamSafeOutlineSet, lod.integerScale)
      > canonicalArea(outlineSet, lod.integerScale),
    "l'overlap interno deve chiudere la fessura AA",
  );
  const bounds = absoluteMeshBounds(outlineMesh);
  assert.ok(bounds.left <= -9.99);
  assert.ok(bounds.right >= 129.99);
  const compiled = compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 10, join },
    `compiled-${join}`,
  );
  assert.ok(compiled);
  assert.equal(compiled.lodBucket, lod.bucket);
  assert.ok(
    meshTriangleArea(compiled) > meshTriangleArea(outlineMesh),
    "la mesh compilata deve includere l'overlap nascosto sotto il fill",
  );
  const fused = compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "source-outline", width: 10, join, includeFill: true },
    `fused-${join}`,
  );
  assert.ok(fused);
  assert.ok(
    meshTriangleArea(fused) > meshTriangleArea(compiled),
    "fill e outline dello stesso colore devono diventare una sola unione",
  );
  assert.deepEqual(absoluteMeshBounds(fused), absoluteMeshBounds(compiled));
}

// Block Shadow: F, F+v e le side wall appartengono a una sola unione.
assert.equal(buildVectorTextBlockSet(rectangleSet, 0, 0), rectangleSet);
const vectorX = 23 * lod.integerScale;
const vectorY = 17 * lod.integerScale;
const blockSet = buildVectorTextBlockSet(rectangleSet, vectorX, vectorY);
assertCanonical(blockSet, "block shadow");
assert.ok(canonicalArea(blockSet, lod.integerScale) >= canonicalArea(rectangleSet, lod.integerScale));
assert.ok(blockSet.left <= rectangleSet.left);
assert.ok(blockSet.top <= rectangleSet.top);
assert.ok(blockSet.right >= rectangleSet.right + vectorX);
assert.ok(blockSet.bottom >= rectangleSet.bottom + vectorY);
assertTriangulation(blockSet, lod, "block shadow");
const visibleBlockWithoutOverlap = buildVisibleVectorTextBlockSet(
  rectangleSet,
  vectorX,
  vectorY,
);
const blockInnerOverlap = Math.max(
  1,
  Math.round(
    VECTOR_TEXT_BLOCK_INNER_OVERLAP_PIXELS
      / lod.bucketScale
      * lod.integerScale,
  ),
);
const visibleBlockSet = buildVisibleVectorTextBlockSet(
  rectangleSet,
  vectorX,
  vectorY,
  blockInnerOverlap,
);
assertCanonical(visibleBlockSet, "visible block shadow overlap");
assertTriangulation(visibleBlockSet, lod, "visible block shadow overlap");
assert.ok(
  canonicalArea(visibleBlockSet, lod.integerScale)
    > canonicalArea(visibleBlockWithoutOverlap, lod.integerScale),
  "le pareti devono sovrapporsi al fill nella sola zona nascosta",
);
assert.ok(
  canonicalArea(visibleBlockSet, lod.integerScale)
    < canonicalArea(blockSet, lod.integerScale),
  "la faccia sorgente nascosta non deve restare nel fill della Block Shadow",
);
assert.deepEqual(
  {
    left: visibleBlockSet.left,
    top: visibleBlockSet.top,
    right: visibleBlockSet.right,
    bottom: visibleBlockSet.bottom,
  },
  {
    left: visibleBlockWithoutOverlap.left,
    top: visibleBlockWithoutOverlap.top,
    right: visibleBlockWithoutOverlap.right,
    bottom: visibleBlockWithoutOverlap.bottom,
  },
  "l'overlap nascosto non deve cambiare la bbox della mesh visibile",
);
assert.deepEqual(
  {
    left: visibleBlockSet.left,
    top: visibleBlockSet.top,
    right: visibleBlockSet.right,
    bottom: visibleBlockSet.bottom,
  },
  {
    left: blockSet.left,
    top: blockSet.top,
    right: blockSet.right,
    bottom: blockSet.bottom,
  },
  "rimuovere la faccia sorgente non deve cambiare la bbox dell'effetto",
);
const blockMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  { kind: "block", vectorX: 23, vectorY: 17 },
  "block",
);
assert.ok(blockMesh);
assert.equal(
  compileVectorTextEffect(
    sourceRectangle,
    lod,
    { kind: "block", vectorX: 0, vectorY: 0 },
    "block-zero",
  ),
  null,
  "offset zero non deve generare una faccia nascosta",
);
assert.ok(
  Math.abs(
    meshTriangleArea(blockMesh)
      - canonicalArea(visibleBlockSet, lod.integerScale),
  ) <= 1e-5,
  "la mesh Block Shadow deve usare faccia traslata e pareti esposte",
);
const blockBounds = absoluteMeshBounds(blockMesh);
assert.ok(blockBounds.right >= 142.99);
assert.ok(blockBounds.bottom >= 116.99);
const longSeventyDegreeVector = vectorTextBlockShadowLocalVector(0, 100, 70);
for (const [directionX, directionY] of [
  [23, 0],
  [-23, 0],
  [0, 17],
  [0, -17],
  [23, 17],
  [-23, 17],
  [23, -17],
  [-23, -17],
  [longSeventyDegreeVector.x, longSeventyDegreeVector.y],
]) {
  const quantizedX = Math.round(directionX * lod.integerScale);
  const quantizedY = Math.round(directionY * lod.integerScale);
  const fullDirectionBlock = buildVectorTextBlockSet(
    oppositeNested,
    quantizedX,
    quantizedY,
  );
  const visibleDirectionBlock = buildVisibleVectorTextBlockSet(
    oppositeNested,
    quantizedX,
    quantizedY,
  );
  const overlappedDirectionBlock = buildVisibleVectorTextBlockSet(
    oppositeNested,
    quantizedX,
    quantizedY,
    blockInnerOverlap,
  );
  assertCanonical(overlappedDirectionBlock, `block overlap ${directionX},${directionY}`);
  assertTriangulation(
    overlappedDirectionBlock,
    lod,
    `block overlap ${directionX},${directionY}`,
  );
  assert.equal(
    difference(visibleDirectionBlock.paths, overlappedDirectionBlock.paths, FillRule.NonZero).length,
    0,
    `l'overlap sottrae triangoli visibili per ${directionX},${directionY}`,
  );
  assert.equal(
    difference(overlappedDirectionBlock.paths, fullDirectionBlock.paths, FillRule.NonZero).length,
    0,
    `l'overlap esce dallo sweep completo per ${directionX},${directionY}`,
  );

  assert.ok(
    canonicalArea(overlappedDirectionBlock, lod.integerScale)
      >= canonicalArea(visibleDirectionBlock, lod.integerScale),
    `overlap nascosto mancante per ${directionX},${directionY}`,
  );
  assert.ok(
    canonicalArea(overlappedDirectionBlock, lod.integerScale)
      < canonicalArea(fullDirectionBlock, lod.integerScale),
    `la faccia sorgente è rientrata per ${directionX},${directionY}`,
  );
  assert.deepEqual(
    {
      left: overlappedDirectionBlock.left,
      top: overlappedDirectionBlock.top,
      right: overlappedDirectionBlock.right,
      bottom: overlappedDirectionBlock.bottom,
    },
    {
      left: visibleDirectionBlock.left,
      top: visibleDirectionBlock.top,
      right: visibleDirectionBlock.right,
      bottom: visibleDirectionBlock.bottom,
    },
    `l'overlap cambia bbox per ${directionX},${directionY}`,
  );
}
const blockOutlineMesh = compileVectorTextEffect(
  sourceRectangle,
  lod,
  {
    kind: "block-outline",
    vectorX: 23,
    vectorY: 17,
    width: 8,
    join: "miter",
  },
  "block-outline",
);
assert.ok(blockOutlineMesh);
assert.ok(meshTriangleArea(blockOutlineMesh) > 0);

// Slug: un'intera shape, texture compatte/allineate e winding analitico.
const slugPath = polygonPath([outer, reverseRing(inner)]);
const slugGeometryIdentity = vectorPathIdentityPool.intern(slugPath);
const slug = buildVectorTextSlugData(slugPath, slugGeometryIdentity);
assert.equal(
  slug.revision,
  `${VECTOR_TEXT_SLUG_COMPILER_VERSION}:${slugGeometryIdentity}`,
);
const clonedSlugPath = {
  verbs: slugPath.verbs.slice(),
  coords: slugPath.coords.slice(),
  contourOffsets: slugPath.contourOffsets.slice(),
  fillRule: slugPath.fillRule,
};
assert.equal(vectorPathsEqualBitwise(slugPath, clonedSlugPath), true);
assert.equal(
  vectorPathIdentityPool.intern(clonedSlugPath),
  slugGeometryIdentity,
);
assert.equal(fingerprintVectorPath(slugPath).length, 32);
let unchangedFingerprintCalls = 0;
const objectIdentityPool = new VectorPathIdentityPool((path) => {
  unchangedFingerprintCalls += 1;
  return fingerprintVectorPath(path);
});
const objectIdentity = objectIdentityPool.intern(slugPath);
for (let index = 0; index < 64; index += 1) {
  assert.equal(objectIdentityPool.intern(slugPath), objectIdentity);
}
assert.equal(
  unchangedFingerprintCalls,
  1,
  "an unchanged published path must use the constant-time object fast path",
);
const forcedCollisionPool = new VectorPathIdentityPool(() => "forced");
const forcedOriginalIdentity = forcedCollisionPool.intern(slugPath);
assert.equal(
  forcedCollisionPool.intern(clonedSlugPath),
  forcedOriginalIdentity,
);
const changedCoordinatePath = {
  ...clonedSlugPath,
  coords: clonedSlugPath.coords.slice(),
};
changedCoordinatePath.coords[0] += 0.000001;
const changedCoordinateIdentity = forcedCollisionPool.intern(changedCoordinatePath);
assert.notEqual(changedCoordinateIdentity, forcedOriginalIdentity);
assert.match(changedCoordinateIdentity, /:entry-1$/);
const changedContourPath = {
  ...clonedSlugPath,
  contourOffsets: new Uint32Array([
    clonedSlugPath.contourOffsets[0] + 1,
  ]),
};
assert.notEqual(
  forcedCollisionPool.intern(changedContourPath),
  forcedOriginalIdentity,
);
const changedVerbPath = {
  ...clonedSlugPath,
  verbs: clonedSlugPath.verbs.slice(),
};
changedVerbPath.verbs[0] ^= 1;
assert.notEqual(
  forcedCollisionPool.intern(changedVerbPath),
  forcedOriginalIdentity,
);
const changedFillRulePath = { ...clonedSlugPath, fillRule: 1 };
assert.notEqual(
  forcedCollisionPool.intern(changedFillRulePath),
  forcedOriginalIdentity,
);
const mutablePath = {
  ...clonedSlugPath,
  coords: clonedSlugPath.coords.slice(),
};
const mutablePathIdentity = forcedCollisionPool.intern(mutablePath);
mutablePath.coords[0] += 0.25;
forcedCollisionPool.invalidate(mutablePath);
assert.notEqual(
  forcedCollisionPool.intern(mutablePath),
  mutablePathIdentity,
  "an invalidated in-place coordinate mutation must receive a new identity",
);
mutablePath.coords[0] -= 0.25;
forcedCollisionPool.invalidate(mutablePath);
assert.equal(
  forcedCollisionPool.intern(mutablePath),
  mutablePathIdentity,
  "restoring the exact bytes must recover the retained identity",
);

const boundedIdentityPool = new VectorPathIdentityPool(
  () => "bounded",
  2,
  Number.MAX_SAFE_INTEGER,
);
const boundedFirstPath = {
  ...clonedSlugPath,
  coords: clonedSlugPath.coords.slice(),
};
const boundedSecondPath = {
  ...clonedSlugPath,
  coords: clonedSlugPath.coords.slice(),
};
boundedSecondPath.coords[0] += 1;
const boundedThirdPath = {
  ...clonedSlugPath,
  coords: clonedSlugPath.coords.slice(),
};
boundedThirdPath.coords[0] += 2;
const boundedFirstIdentity = boundedIdentityPool.intern(boundedFirstPath);
const boundedSecondIdentity = boundedIdentityPool.intern(boundedSecondPath);
assert.equal(boundedIdentityPool.intern(boundedFirstPath), boundedFirstIdentity);
boundedIdentityPool.intern(boundedThirdPath);
assert.equal(boundedIdentityPool.retainedEntryCount(), 2);
assert.equal(
  boundedIdentityPool.intern(boundedSecondPath),
  boundedSecondIdentity,
  "an existing path object must keep its identity after snapshot eviction",
);
assert.equal(boundedIdentityPool.retainedEntryCount(), 2);
const boundedSecondClone = {
  ...boundedSecondPath,
  coords: boundedSecondPath.coords.slice(),
};
assert.notEqual(
  boundedIdentityPool.intern(boundedSecondClone),
  boundedSecondIdentity,
  "a new clone must not reuse an evicted, unverifiable identity",
);
assert.equal(boundedIdentityPool.retainedEntryCount(), 2);

const retainedPathBytes = clonedSlugPath.verbs.byteLength
  + clonedSlugPath.coords.byteLength
  + clonedSlugPath.contourOffsets.byteLength;
const byteBoundedIdentityPool = new VectorPathIdentityPool(
  () => "byte-bounded",
  8,
  retainedPathBytes,
);
byteBoundedIdentityPool.intern(boundedFirstPath);
byteBoundedIdentityPool.intern(boundedSecondPath);
assert.equal(byteBoundedIdentityPool.retainedEntryCount(), 1);
assert.ok(byteBoundedIdentityPool.retainedByteLength() <= retainedPathBytes);
const oversizedIdentityPool = new VectorPathIdentityPool(
  () => "oversized",
  8,
  retainedPathBytes - 1,
);
const oversizedIdentity = oversizedIdentityPool.intern(boundedFirstPath);
assert.equal(oversizedIdentityPool.intern(boundedFirstPath), oversizedIdentity);
assert.equal(oversizedIdentityPool.retainedEntryCount(), 0);
assert.equal(oversizedIdentityPool.retainedByteLength(), 0);

const manyPaintPaths = Array.from({ length: 300 }, (_, index) => ({
  ...clonedSlugPath,
  coords: (() => {
    const coords = clonedSlugPath.coords.slice();
    coords[0] += index;
    return coords;
  })(),
}));
const manyPaintDocument = {
  viewBox: null,
  bounds: { left: 0, top: 0, right: 1, bottom: 1 },
  paints: manyPaintPaths.map((path, index) => ({
    id: index,
    color: "#000000",
    opacity: 1,
    fillRule: 0,
    path,
    revision: `paint-${index}`,
  })),
  silhouettePath: manyPaintPaths[0],
};
const manyPaintNode = {
  id: 1,
  kind: "svg",
  document: manyPaintDocument,
  paintColors: [],
  scale: 1,
  scaleX: 1,
  scaleY: 1,
};
const manyPaintIdentityPool = new VectorPathIdentityPool(
  fingerprintVectorPath,
  256,
  Number.MAX_SAFE_INTEGER,
);
const firstManyPaintIdentities = manyPaintPaths.map(
  (path) => manyPaintIdentityPool.intern(path),
);
const runtimeNodeClone = cloneVectorSvgNodeWithSharedDocument(manyPaintNode);
assert.equal(runtimeNodeClone.document, manyPaintDocument);
assert.deepEqual(
  runtimeNodeClone.document.paints.map((paint) => (
    manyPaintIdentityPool.intern(paint.path)
  )),
  firstManyPaintIdentities,
  "trusted runtime snapshots must preserve more identities than the snapshot cache",
);
assert.equal(manyPaintIdentityPool.retainedEntryCount(), 256);
const defensiveNodeClone = cloneVectorSvgNode(manyPaintNode);
assert.notEqual(defensiveNodeClone.document, manyPaintDocument);
assert.notEqual(
  defensiveNodeClone.document.paints[0].path,
  manyPaintDocument.paints[0].path,
);
forcedCollisionPool.clear();
assert.notEqual(
  forcedCollisionPool.intern(slugPath),
  forcedOriginalIdentity,
);
assert.equal(slug.curveCount, 8);
for (const texture of [slug.curveTexture, slug.bandTexture]) {
  assert.ok(texture.width >= 16);
  assert.equal(texture.width & (texture.width - 1), 0);
  assert.equal((texture.width * 16) % 256, 0);
  assert.ok(texture.height >= 1 && texture.height <= 8192);
}
assert.ok(slug.horizontalBandCount >= 16 && slug.horizontalBandCount <= 255);
assert.ok(slug.verticalBandCount >= 16 && slug.verticalBandCount <= 255);
assert.ok(slug.maximumHorizontalCandidates <= 64);
assert.ok(slug.maximumVerticalCandidates <= 64);
assert.throws(
  () => {
    const evenOddPath = { ...slugPath, fillRule: 1 };
    return buildVectorTextSlugData(
      evenOddPath,
      vectorPathIdentityPool.intern(evenOddPath),
    );
  },
  /EvenOdd/,
);
assert.match(slugSource, /const sourceCurves = contours\.flatMap/);
assert.match(slugSource, /Math\.ceil\(\(minimum - boundsMinimum\)[\s\S]*- 1/);
assert.match(slugShaderSource, /length\(vec2<f32>\([\s\S]*dpdx/);
assert.match(slugShaderSource, /let alpha = coverage \* slug\.color\.a/);
assert.match(
  slugShaderSource,
  /slugPresentationPremultipliedColor\(slug\.color\.rgb, alpha\)/,
);
assert.match(slugShaderSource, /slug\.viewCenterAndZoom\.w > 0\.5/);
assert.match(slugShaderSource, /abs\(a\.y\) <= linearScale \/ 1048576\.0/);
assert.equal(
  slugShaderSource.match(/sourceCoordinateScale: f32/g)?.length,
  2,
);
assert.match(
  slugShaderSource,
  /max\(abs\(source12\.y\), max\(abs\(source12\.w\), abs\(source3\.y\)\)\)/,
);
assert.match(
  slugShaderSource,
  /max\(abs\(source12\.x\), max\(abs\(source12\.z\), abs\(source3\.x\)\)\)/,
);
const f32LineStart = Math.fround(300.00003);
const f32LineMiddle = Math.fround(300.01503);
const f32LineEnd = Math.fround(300.03003);
const f32LineSecondDifference = Math.abs(
  f32LineStart - f32LineMiddle * 2 + f32LineEnd,
);
const f32LineSpanScale = Math.max(
  1,
  Math.abs(f32LineStart - f32LineMiddle),
  Math.abs(f32LineMiddle - f32LineEnd),
  Math.abs(f32LineStart - f32LineEnd),
);
const f32LineAbsoluteScale = Math.max(
  1,
  Math.abs(f32LineStart),
  Math.abs(f32LineMiddle),
  Math.abs(f32LineEnd),
);
assert.ok(f32LineSecondDifference > f32LineSpanScale / 1048576);
assert.ok(f32LineSecondDifference <= f32LineAbsoluteScale / 1048576);
assert.doesNotMatch(slugSource, /perGlyph|glyphQuads|one quad per glyph/i);
assert.match(curveSource, /throw new Error\([\s\S]*depth/i);

// Blur singolo: mask R16F, tent separabile, ROI e kernel bounded.
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM, 300);
assert.equal(vectorTextSingleShadowBlurSupport(0), 0);
assert.equal(vectorTextSingleShadowBlurSupport(6), 19);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS, 4 * 1024 * 1024);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS, 24);
const blurPlan = planVectorTextSingleShadowBlur(
  { left: 0, top: 0, right: 100, bottom: 40 },
  6,
  1,
);
assert.deepEqual([...blurPlan.bounds], [-19, -19, 119, 59]);
assert.equal(blurPlan.width, 138);
assert.equal(blurPlan.height, 78);
assert.equal(blurPlan.sigmaPixels, 6);
assert.equal(blurPlan.radius, 18);
const cappedBlurPlan = planVectorTextSingleShadowBlur(
  { left: 0, top: 0, right: 100, bottom: 40 },
  6,
  10,
);
assert.ok(Math.abs(cappedBlurPlan.sigmaPixels - 8) < 1e-9);
assert.equal(cappedBlurPlan.radius, 24);
assert.ok(cappedBlurPlan.width * cappedBlurPlan.height <= VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS);
const blurSourceUniformStart = engineSource.indexOf(
  "export function writeVectorTextGpuBlurSourceUniform(",
);
const blurSourceUniformEnd = engineSource.indexOf(
  "\nexport function ",
  blurSourceUniformStart + 1,
);
assert.ok(
  blurSourceUniformStart >= 0 && blurSourceUniformEnd > blurSourceUniformStart,
  "uniform source della mask blur GPU non trovato",
);
const blurSourceUniformSource = engineSource.slice(
  blurSourceUniformStart,
  blurSourceUniformEnd,
);
assert.match(
  blurSourceUniformSource,
  /const sourceBounds = usesMesh\s*\?\s*draw\.blurBounds\s*:\s*\[\s*draw\.blurBounds\[0\] - draw\.slug\.originX,\s*draw\.blurBounds\[1\] - draw\.slug\.originY,\s*draw\.blurBounds\[2\] - draw\.slug\.originX,\s*draw\.blurBounds\[3\] - draw\.slug\.originY,/,
  "outer/inner Slug devono usare la ROI relativa, le mesh la ROI assoluta",
);
assert.match(
  engineSource,
  /function vectorTextGpuDrawUsesBlur\([\s\S]*draw\.mode === "slug-blur"[\s\S]*draw\.mode === "slug-inner-shadow-blur"[\s\S]*draw\.mode === "mesh-blur"[\s\S]*draw\.mode === "mesh-inner-shadow-blur"/,
  "la conversione source deve coprire outer/inner blur sia Slug sia mesh",
);
assert.match(
  blurSourceUniformSource,
  /upload\[base \+ 4\] = \(draw\.blurBounds\[0\] \+ draw\.blurBounds\[2\]\) \* 0\.5;\s*upload\[base \+ 5\] = \(draw\.blurBounds\[1\] \+ draw\.blurBounds\[3\]\) \* 0\.5;/,
  "il centro della texture blur deve restare nella ROI assoluta",
);
assert.match(
  blurSourceUniformSource,
  /upload\[base \+ 24\] = sourceBounds\[0\];\s*upload\[base \+ 25\] = sourceBounds\[1\];\s*upload\[base \+ 26\] = sourceBounds\[2\];\s*upload\[base \+ 27\] = sourceBounds\[3\];/,
  "solo i bounds letti dallo shader source devono diventare origin-relative",
);
const drawUniformStart = engineSource.indexOf(
  "export function writeVectorTextGpuDrawUniform(",
);
const drawUniformEnd = engineSource.indexOf(
  "\ntype MixedSceneBlendScratchCandidate",
  drawUniformStart,
);
assert.ok(
  drawUniformStart >= 0 && drawUniformEnd > drawUniformStart,
  "uniform del compositing testo GPU non trovato",
);
const drawUniformSource = engineSource.slice(drawUniformStart, drawUniformEnd);
assert.match(
  drawUniformSource,
  /const shapeBounds = vectorTextGpuDrawUsesBlur\(draw\)\s*\? draw\.blurBounds\s*:/,
  "il compositing del blur deve conservare la ROI assoluta",
);
const flushPresentationsStart = engineSource.indexOf(
  "export function flushVectorTextGpuPresentations(",
);
const flushPresentationsEnd = engineSource.indexOf(
  "\nfunction mixedSceneSegmentContributesToDeepFloor(",
  flushPresentationsStart,
);
assert.ok(
  flushPresentationsStart >= 0 && flushPresentationsEnd > flushPresentationsStart,
  "batch presentation GPU non trovato",
);
const flushPresentationsSource = engineSource.slice(
  flushPresentationsStart,
  flushPresentationsEnd,
);
assert.match(
  flushPresentationsSource,
  /writeVectorTextGpuDrawUniform\(engine,[\s\S]{0,180}run\.bounds,[\s\S]{0,80}run\.bounds\.width,[\s\S]{0,80}run\.bounds\.height/,
  "ogni run deve proiettare le primitive nelle dimensioni della propria ROI",
);
assert.match(
  flushPresentationsSource,
  /pass\.setViewport\(0, 0, run\.bounds\.width, run\.bounds\.height, 0, 1\);\s*pass\.setScissorRect\(0, 0, run\.bounds\.width, run\.bounds\.height\);/,
  "viewport e scissor della run devono coincidere con la targetSize scritta negli uniform",
);
assert.doesNotMatch(singleShadowSource, /Canvas|createElement|getContext|filter\s*=/);
assert.match(gpuShaderSource, /sourceTexture: texture_2d<f32>/);
assert.match(gpuShaderSource, /horizontalMain/);
assert.match(gpuShaderSource, /verticalMain/);
assert.match(gpuShaderSource, /linearSampler: sampler/);
assert.match(gpuShaderSource, /textureDimensions\(sourceTexture\)/);
assert.match(gpuShaderSource, /firstOffset \* firstWeight \+ secondOffset \* secondWeight/);
assert.match(gpuShaderSource, /for \(var first = 1u; first < 24u; first \+= 2u\)/);
assert.match(gpuShaderSource, /edgeWeight\.x \* edgeWeight\.y/);
const vectorTentShaderSource = gpuShaderSource.slice(
  gpuShaderSource.indexOf("export const vectorTextGpuTentBlurShader"),
  gpuShaderSource.indexOf("export const vectorTextGpuBlurCompositeShader"),
);
assert.doesNotMatch(vectorTentShaderSource, /textureLoad\(/);
assert.doesNotMatch(vectorTentShaderSource, /exp\(/);
const blurFilterLayoutStart = engineSource.indexOf(
  "const blurFilterBindGroupLayout =",
);
const blurFilterLayoutEnd = engineSource.indexOf(
  "const blurCompositeBindGroupLayout =",
  blurFilterLayoutStart,
);
assert.ok(
  blurFilterLayoutStart >= 0 && blurFilterLayoutEnd > blurFilterLayoutStart,
  "layout del filtro tent GPU non trovato",
);
const blurFilterLayoutSource = engineSource.slice(
  blurFilterLayoutStart,
  blurFilterLayoutEnd,
);
assert.match(
  blurFilterLayoutSource,
  /binding: 2,[\s\S]{0,100}sampler: \{ type: "filtering" \}/,
);
const blurAToBStart = engineSource.indexOf(
  "engine.vectorTextGpuBlurFilterBindGroupAToB =",
);
const blurBToAStart = engineSource.indexOf(
  "engine.vectorTextGpuBlurFilterBindGroupBToA =",
  blurAToBStart,
);
const blurScratchAssignmentStart = engineSource.indexOf(
  "engine.vectorTextGpuBlurScratchATexture =",
  blurBToAStart,
);
assert.ok(
  blurAToBStart >= 0
    && blurBToAStart > blurAToBStart
    && blurScratchAssignmentStart > blurBToAStart,
  "bind group del filtro tent GPU non trovati",
);
assert.match(
  engineSource.slice(blurAToBStart, blurBToAStart),
  /\{ binding: 2, resource: sampler \}/,
);
assert.match(
  engineSource.slice(blurBToAStart, blurScratchAssignmentStart),
  /\{ binding: 2, resource: sampler \}/,
);
assert.match(engineSource, /draw\.blurSigmaPixels \* 3/);
assert.match(gpuShaderSource, /textureSample\(blurredMask, blurredSampler, input\.uv\)\.r/);
assert.match(innerShadowShaderSource, /innerShadowDirectFragmentMain/);
assert.match(innerShadowShaderSource, /innerShadowBlurFragmentMain/);
assert.match(
  innerShadowShaderSource,
  /fillCoverage \* \(1\.0 - shiftedFillCoverage\)/,
);
assert.match(
  innerShadowShaderSource,
  /fillCoverage \* \(1\.0 - clamp\(shiftedBlurredFill/,
);
assert.match(innerShadowShaderSource, /slug\.effectSampleOffset\.xy/);
assert.match(innerShadowShaderSource, /textureSampleLevel\(/);
assert.doesNotMatch(innerShadowShaderSource, /Canvas|createElement|getContext/);

const appendDrawsStart = controllerSource.indexOf("  private appendGpuDrawsForNode(");
const appendDrawsEnd = controllerSource.indexOf(
  "  private blockShadowPathLogicalMiB(",
  appendDrawsStart,
);
const appendDrawsSource = controllerSource.slice(appendDrawsStart, appendDrawsEnd);
assert.ok(appendDrawsStart >= 0 && appendDrawsEnd > appendDrawsStart);
assert.ok(
  appendDrawsSource.indexOf("this.slugInnerShadowDraw")
    > appendDrawsSource.lastIndexOf("draws.push(this.slugDraw("),
  "l’ombra interna deve essere composta dopo il riempimento",
);
const runBoundsStart = engineSource.indexOf("  private vectorTextGpuRunBounds(");
const runBoundsEnd = engineSource.indexOf(
  "  private vectorTextGpuClearBounds(",
  runBoundsStart,
);
const runBoundsSource = engineSource.slice(runBoundsStart, runBoundsEnd);
assert.doesNotMatch(runBoundsSource, /slug-inner-shadow/);
assert.match(engineSource, /Vector text inner shadow direct Slug MSAA4/);
assert.match(engineSource, /Vector text inner shadow blurred Slug clip MSAA4/);

// Controller/Worker: sempre GPU, scambio atomico, coda coalescente e bbox semantica.
assert.match(controllerSource, /updateVectorTextGpuPresentation\(/);
assert.doesNotMatch(controllerSource, /updateVectorTextPresentation\(/);
assert.equal((controllerSource.match(/getContext\("2d"/g) ?? []).length, 1);
assert.match(controllerSource, /this\.interactionCanvas\.getContext\("2d"/);
assert.match(controllerSource, /this\.presentationCanvas\.width = 1/);
assert.match(controllerSource, /this\.presentationCanvas\.hidden = true/);
assert.match(controllerContractSource, /root: ParentNode;[\s\S]*?browser: Window;/);
assert.match(controllerSource, /root\.querySelector<HTMLElement>\(`/);
assert.doesNotMatch(controllerSource, /document\.getElementById|\bwindow\./);
assert.match(
  mainSource,
  /new MixedSceneController\(engine, \{[\s\S]*?root: appElement,[\s\S]*?browser: window,/,
  "il controller vettoriale deve ricevere root e runtime browser dal bootstrap",
);
const controllerInitializeStart = controllerSource.indexOf("  async initialize(): Promise<void> {");
const controllerInitializeEnd = controllerSource.indexOf(
  "\n  syncScene(",
  controllerInitializeStart,
);
assert.ok(
  controllerInitializeStart >= 0 && controllerInitializeEnd > controllerInitializeStart,
);
const controllerInitializeSource = controllerSource.slice(
  controllerInitializeStart,
  controllerInitializeEnd,
);
assert.doesNotMatch(
  controllerInitializeSource,
  /await this\.prepareFontGeometry|fontGeometry\.preload/,
  "controller startup must remain interactive while restored text fonts load through scene sync",
);
assert.match(controllerInitializeSource, /this\.syncScene\(initialSnapshot\)/);
assert.doesNotMatch(
  controllerInitializeSource,
  /addVectorTextNode|defaultSeed/,
  "l'avvio non deve creare automaticamente un livello testo",
);
const createTextSource = controllerSource.slice(
  controllerSource.indexOf("  createText(color?: string): void"),
  controllerSource.indexOf("  deleteSelectedText(): void"),
);
const createTextResourcePreparationIndex = createTextSource.indexOf(
  "await this.prepareTextCreationResources(seed.fontFamily)",
);
const createTextHostMutationIndex = createTextSource.indexOf(
  "await this.host.addVectorTextNode(",
);
assert.ok(
  createTextResourcePreparationIndex >= 0
    && createTextHostMutationIndex > createTextResourcePreparationIndex,
  "the first text command must prepare its shared font/GPU gate before creating a text node",
);
assert.match(
  createTextSource,
  /revealImmediately: true, waitForPaint: true/,
  "cold text creation must paint loading feedback before font and GPU preparation",
);
const textCreationPreparationSource = controllerSource.slice(
  controllerSource.indexOf("  prepareTextCreationResources("),
  controllerSource.indexOf("  deleteSelectedText(): void"),
);
assert.match(
  textCreationPreparationSource,
  /const existing = this\.textCreationResourcePreparations\.get\(fontFamily\);\s*if \(existing\) return existing;/,
  "panel warm-up and an immediate Add Text command must join one preparation promise",
);
assert.match(
  textCreationPreparationSource,
  /Promise\.all\(\[[\s\S]*?this\.prepareFontGeometry\(\[fontFamily\]\)[\s\S]*?this\.host\.ensureMixedSceneEditorResources\(\)/,
  "the selected font and mixed-scene GPU programs must prepare concurrently",
);
assert.match(
  textCreationPreparationSource,
  /void preparation\.catch\(\(\) => \{[\s\S]*?this\.textCreationResourcePreparations\.delete\(fontFamily\)/,
  "a failed cold preparation must be observed and remain retryable",
);
assert.match(
  controllerContractSource,
  /ensureMixedSceneEditorResources\(\): Promise<void>/,
  "the mixed-scene host must expose its deduplicated resource gate to Text creation",
);
const syncSceneSource = controllerSource.slice(
  controllerSource.indexOf("  syncScene(snapshot: MixedSceneSnapshot): void"),
  controllerSource.indexOf("  scheduleViewSync(): void"),
);
assert.match(
  syncSceneSource,
  /!this\.fontGeometry\.hasFamilies\(snapshotTextFontFamilies\(snapshot\)\)[\s\S]{0,120}this\.deferTextSceneSync\(\);\s*return;/,
  "a newly restored text scene must wait only for the font families it actually uses",
);
assert.match(controllerSource, /private deferTextSceneSync\(\): void/);
assert.match(
  controllerSource,
  /private runtimeSceneSnapshot\(\): MixedSceneSnapshot \| null \{[\s\S]{0,160}getMixedSceneRuntimeSnapshot\?\.\(\)[\s\S]{0,80}getMixedSceneSnapshot\(\)/,
);
assert.match(
  controllerContractSource,
  /getMixedSceneRuntimeSnapshot\?\(\): MixedSceneSnapshot \| null/,
);
assert.match(
  engineSource,
  /getMixedSceneRuntimeSnapshot\(\): MixedSceneSnapshot \| null \{\s*return this\.createMixedSceneSnapshot\(true\);/,
);
assert.match(
  engineSource,
  /const runtimeObserver = engine\.callbacks\.onMixedSceneRuntimeChange;[\s\S]{0,240}engine\.getMixedSceneRuntimeSnapshot\(\)[\s\S]{0,260}runtimeObserver\(runtimeSnapshot\)/,
  "the trusted runtime observer must receive the immutable shared snapshot",
);
assert.match(
  engineSource,
  /const publicObserver = engine\.callbacks\.onMixedSceneChange;[\s\S]{0,240}engine\.getMixedSceneSnapshot\(\)[\s\S]{0,260}publicObserver\(defensiveSnapshot\)/,
  "the public observer must receive a defensive snapshot",
);
assert.match(mainSource, /onMixedSceneRuntimeChange\(snapshot\) \{/);
assert.doesNotMatch(mainSource, /onMixedSceneChange\(snapshot\) \{/);
assert.match(controllerSource, /const latestSnapshot = this\.runtimeSceneSnapshot\(\)/);
assert.match(controllerSource, /this\.documentGeneration !== generation/);
assert.match(fontGeometrySource, /private readonly loadPromises = new Map<string, Promise<void>>\(\)/);
assert.match(fontGeometrySource, /get isPreloaded\(\): boolean/);
assert.match(
  fontGeometrySource,
  /async ensureFamily\(family: string\): Promise<void> \{[\s\S]*const existing = this\.loadPromises\.get\(family\);[\s\S]*if \(existing\) return existing;/,
  "font loading must be deduplicated per family across concurrent text commands",
);
assert.match(fontGeometrySource, /import\("opentype\.js"\)/);
assert.doesNotMatch(fontGeometrySource, /^import opentype from "opentype\.js";/m);
assert.match(fontGeometrySource, /if \(this\.records\.has\(entry\.family\)\) return;/);
assert.match(
  mobileToolSettingsSource,
  /private bindVectorHistoryControl\(control: HTMLElement\)/,
);
assert.match(
  mobileToolSettingsSource,
  /control\.type === "range"[\s\S]*pointerup[\s\S]*pointercancel[\s\S]*keyup[\s\S]*blur/,
);
assert.match(controllerSource, /beginSelectedVectorPropertyEdit\(\): boolean/);
assert.match(controllerSource, /commitSelectedVectorPropertyEdit\(\): boolean/);
assert.doesNotMatch(mobileToolSettingsSource, /sourceControl|dispatchMirrored|dispatchEvent/);
assert.match(
  controllerSource,
  /this\.host\.beginVectorHistoryEdit\("transform"\)/,
);
assert.match(
  controllerSource,
  /private async applyTransformSession\(\)[\s\S]*this\.host\.commitVectorHistoryEdit\(\)/,
);
assert.match(
  controllerSource,
  /private async cancelTransformSession\(\)[\s\S]*this\.host\.cancelVectorHistoryEdit\(\)/,
);
assert.doesNotMatch(
  controllerSource.slice(
    controllerSource.indexOf("  private finishPointer(event: PointerEvent): void {"),
  ),
  /this\.host\.commitVectorHistoryEdit\(\)/,
  "pointerup non deve creare una voce Undo prima di Applica",
);
assert.match(engineSource, /beginVectorHistoryEdit\(scope: "property" \| "transform" = "property"\): boolean/);
assert.match(engineSource, /commitVectorHistoryEdit\(\): boolean/);
assert.match(engineSource, /async cancelVectorHistoryEdit\(\): Promise<boolean>/);
assert.match(engineSource, /kind: "vector"[\s\S]*delta: MixedSceneVectorHistoryDelta/);
// Non un'asserzione di ordine sulla concatenazione (che codificherebbe solo la
// posizione dei moduli): due presenze distinte, con il ripristino vincolato a
// stare dentro la funzione che applica lo stato vettoriale.
assert.match(engineSource, /action\.kind === "vector"/);
const applyVectorStart = engineSource.indexOf("export async function applyVectorHistoryState(");
const applyVectorEnd = engineSource.indexOf("\nexport ", applyVectorStart + 1);
assert.ok(
  applyVectorStart >= 0 && applyVectorEnd > applyVectorStart,
  "applyVectorHistoryState non delimitabile",
);
assert.match(
  engineSource.slice(applyVectorStart, applyVectorEnd),
  /restoreVectorHistoryState\(/,
  "l'applicazione dello stato vettoriale deve ripristinare la scena",
);
assert.match(controllerSource, /scheduleViewSync\(\): void \{[\s\S]*this\.enterFastZoomMode\(\)/);
assert.match(
  controllerSource,
  /!this\.hasVectorPresentationNodes\(\) \|\| !this\.adaptiveZoomEnabled[\s\S]{0,300}this\.exitFastAfterScheduledRender = true/,
);
assert.match(controllerSource, /beginViewGesture\(\): void/);
assert.match(controllerSource, /endViewGesture\(\): void/);
assert.match(controllerSource, /requestExactRecovery\(revision: number\): void/);
assert.match(controllerSource, /requestUnsafeExactRefresh\(revision: number\): void/);
assert.match(controllerSource, /this\.unsafeExactRefreshInFlight[\s\S]*zoomUnsafeExactCoalescedCount/);
assert.match(controllerSource, /waitForVectorTextPresentationCompletion\(\)\.then/);
assert.match(
  controllerContractSource,
  /export type VectorTextClippedRefreshPolicy = "during-gesture" \| "on-release"/,
);
assert.match(
  controllerSource,
  /private readonly clippedRefreshPolicy: VectorTextClippedRefreshPolicy/,
  "la variante A/B deve essere immutabile per l'intera vita del controller",
);
assert.match(
  controllerSource,
  /if \(this\.clippedRefreshPolicy === "during-gesture"\) \{\s*this\.requestUnsafeExactRefresh/,
);
assert.doesNotMatch(controllerSource, /setExactRefreshDuringViewGestureEnabled/);
assert.match(
  controllerSource,
  /waitForVectorTextPresentationCompletion\(\)\.then\(\(\) => \{[\s\S]{0,180}this\.zoomUnsafeExactRefreshCompletedCount \+= 1/,
  "un refresh iniziato non basta: il report deve sapere se è stato completato prima del rilascio",
);
assert.match(controllerSource, /zoomUnsafeExactRefreshInFlight: this\.unsafeExactRefreshInFlight/);
assert.match(
  controllerSource,
  /zoomUnsafeExactRefreshRequestPending: this\.unsafeExactRefreshRequest !== null/,
);
assert.match(controllerSource, /vectorTextExactRecoveryIsCurrent\(/);
assert.match(controllerSource, /setAdaptiveZoomEnabled\(enabled: boolean\): void/);
assert.match(
  controllerSource,
  /if \(!enabled && this\.zoomRenderMode === "fast"\)[\s\S]{0,700}this\.viewGestureActive = false[\s\S]{0,700}this\.exitFastAfterScheduledRender = true/,
  "disabilitare il fast path durante un gesto deve forzare un redraw preciso senza attendere pointer-up",
);
assert.match(vectorZoomLabSource, /effectRefinementRenderDelta = Math\.max\([\s\S]{0,150}exactRenderDeltaDuringRecovery - 1/);
assert.doesNotMatch(
  vectorZoomLabSource,
  /exactRecoveryLatestOnly:[\s\S]{0,300}exactRenderDeltaDuringRecovery === 1/,
  "gli swap atomici LOD degli effetti possono raffinare la singola recovery senza creare altre recovery zoom",
);
assert.match(editorLabsSource, /this\.#report\.textContent = serialize\(report\)/);
assert.match(labsStartupSource, /search\.get\("lab"\) === "vector-zoom-release" \? "on-release" : "during-gesture"/);
assert.match(vectorZoomLabSource, /refreshMode === "during" \? "A" : "B"/);
assert.match(vectorZoomLabSource, /engine\.panByClientDelta\(1, 0\)/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT/);
assert.match(vectorZoomLabSource, /__vectorZoomAbReport/);
assert.match(vectorZoomLabSource, /unsafeExactRefreshCompletedDelta > 0/);
assert.match(
  vectorZoomLabSource,
  /unsafeExactRefreshStartedDelta === 0[\s\S]{0,220}exactRenderDeltaDuringGesture === 0/,
);
assert.ok(
  (canvasInputSource.match(/getVectorController\(\)\?\.beginViewGesture\(\)/g) ?? []).length >= 2,
  "pinch e pan/rotate devono armare il fast mode prima del primo movimento",
);
assert.ok(
  (canvasInputSource.match(/getVectorController\(\)\?\.endViewGesture\(\)/g) ?? []).length >= 2,
  "pointer-up deve richiedere il recovery preciso senza attendere il debounce",
);
assert.doesNotMatch(controllerSource, /zoomModeIndicator|updateAdaptiveZoomIndicator|Zoom vettori · GPU/);
assert.match(adaptiveSource, /gesture-window2-dual-gpu-auto-fallback-exact-settle-v7/);
assert.match(adaptiveSource, /for \(const \[x, y\] of \[/);
assert.match(engineSource, /vectorTextFastPresentationInFlightCount/);
assert.match(engineSource, /VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT/);
assert.match(engineSource, /vectorTextFastPresentationLatestRequested/);
assert.match(engineSource, /vectorTextFastPresentationCoalescedRequestCount \+= 1/);
assert.match(engineSource, /vectorTextFastRequestedRevision \+= 1/);
assert.match(engineSource, /vectorTextFastSubmittedRevision = Math\.max/);
assert.match(engineSource, /vectorTextFastCompletedRevision = Math\.max/);
assert.match(engineSource, /waitForVectorTextFastPresentationRevision/);
assert.match(
  engineSource,
  /vectorTextFastPresentationInFlightCount[\s\S]{0,120}>= VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT[\s\S]{0,120}vectorTextFastPresentationLatestRequested = true/,
  "solo il terzo frame fast deve entrare nel singolo slot latest-only",
);
assert.match(
  engineSource,
  /if \(this\.vectorTextFastPresentationEnabled\) \{\s*this\.trackVectorTextFastPresentationSubmission\(\)/,
  "anche un submit autoritativo concorrente deve consumare e ackare la camera più recente",
);
assert.match(engineSource, /device\.queue\.onSubmittedWorkDone\(\)\.then/);
assert.match(
  engineSource,
  /function writeCaptureViewUniform[\s\S]*if \(changed\) \{[\s\S]*queue\.writeBuffer/,
);
assert.doesNotMatch(
  mixedCompositorSource,
  /if \(capture\.fastMode > 1\.5\)/,
  "nessun fast mode deve bypassare la camera con un frame screen-space",
);
assert.match(mixedCompositorSource, /@group\(0\) @binding\(5\) var fallbackTexture/);
assert.match(mixedCompositorSource, /@group\(0\) @binding\(6\) var<uniform> cache/);
assert.equal(
  VECTOR_TEXT_RUN_CACHE_UNIFORM_BYTES,
  32,
  "origini e opacita' post-composite devono rispettare l'allineamento uniforme WGSL",
);
assert.match(
  mixedCompositorSource,
  /struct TextCacheUniforms \{\s*primaryOrigin: vec2<f32>,\s*fallbackOrigin: vec2<f32>,\s*opacityAndPadding: vec4<f32>,\s*\};/,
);
assert.match(
  engineSource,
  /const nextValues = \[\s*primaryBounds\.x,\s*primaryBounds\.y,\s*fallbackBounds\?\.x \?\? 0,\s*fallbackBounds\?\.y \?\? 0,\s*resources\.opacity,\s*resources\.primaryEncodedSrgb \? 1 : 0,\s*resources\.fallbackEncodedSrgb \? 1 : 0,\s*0,\s*\] as const;/,
  "l'upload CPU deve avere lo stesso layout del blocco uniforme WGSL",
);
assert.match(
  engineSource,
  /if \(existingRun\) setVectorTextRunOpacity\(engine, existingRun, opacity\);/,
  "cambiare opacita' senza cambiare run deve aggiornare l'uniforme esistente",
);
assert.equal(
  (mixedCompositorSource.match(/\* opacity;/g) ?? []).length,
  5,
  "opacita' deve essere applicata a ogni uscita precisa, fast e fallback",
);
assert.match(mixedCompositorSource, /sourceCapturePixel - cache\.primaryOrigin/);
assert.match(mixedCompositorSource, /fallbackCapturePixel - cache\.fallbackOrigin/);
assert.match(
  mixedCompositorSource,
  /capture\.canvasSize\.x - sourceCapturePixel\.x/,
  "la dissolvenza fast deve restare ancorata al canvas, non al bordo ROI",
);
assert.match(
  mixedCompositorSource,
  /return mix\(\s*fallbackColor,\s*sourceColor,\s*smoothstep/,
);
assert.match(engineSource, /captureVectorTextFallbackPresentation/);
assert.match(engineSource, /rebuildVectorTextGpuFallbackPresentation/);
assert.match(engineSource, /vectorTextFallbackPresentationComplete/);
assert.match(engineSource, /probeVectorTextFallbackAlpha/);
assert.match(engineSource, /probeVectorTextFastCompositeAlpha/);
assert.match(engineSource, /const texture = engine\.mixedSceneLinearTexture/);
assert.match(engineSource, /x \* bytesPerPixel \+ 6/);
assert.match(engineSource, /GPUTextureUsage\.COPY_SRC/);
assert.match(
  engineSource,
  /vectorTextFallbackCaptureView = null;\s*writeVectorTextFallbackCaptureUniforms\(engine\);\s*writeVectorTextCaptureUniforms\(engine\)/,
  "invalidare la fallback deve riclassificare subito il fast mode prima del frame successivo",
);
assert.match(controllerSource, /zoomFallbackReprojectionCount/);
assert.match(controllerContractSource, /readonly documentWidth: number;/);
assert.match(controllerContractSource, /readonly documentHeight: number;/);
assert.match(
  controllerSource,
  /vectorTextWideFallbackView\(\s*view,\s*this\.host\.documentWidth,\s*this\.host\.documentHeight,\s*\)/,
);
assert.match(
  controllerSource,
  /canvasWidth: this\.host\.documentWidth,[\s\S]{0,180}canvasHeight: this\.host\.documentHeight/,
);
assert.match(
  vectorRasterSource,
  /canvasWidth: engine\.documentWidth,[\s\S]{0,180}canvasHeight: engine\.documentHeight/,
);
assert.match(controllerSource, /fallbackPresentationDirty/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_START_ZOOM/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_TARGET_ZOOM/);
assert.match(vectorZoomLabSource, /__vectorZoomCoverageReport/);
assert.match(vectorZoomLabSource, /fallbackProbeAlphaPixelCounts/);
assert.match(vectorZoomLabSource, /fastCompositeProbeAlphaPixelCounts/);
assert.match(vectorZoomLabSource, /finalFastFrameAcknowledged/);
assert.match(vectorZoomLabSource, /initialRasterWasEmpty/);
assert.equal(
  (vectorZoomLabSource.match(
    /vectorTextRoiCacheEnabled: engine\.vectorTextRoiCacheEnabled/g,
  ) ?? []).length,
  3,
  "ogni report zoom deve identificare esplicitamente il ramo ROI/viewport",
);
assert.match(
  vectorZoomLabSource,
  /run-cache:\$\{engine\.vectorTextRoiCacheEnabled \? "roi" : "viewport"\}/,
);
const coverageFunctionStart = vectorZoomLabSource.indexOf("async function runVectorZoomCoverage");
const coverageFunctionEnd = vectorZoomLabSource.indexOf("async function runVectorZoomAb", coverageFunctionStart);
assert.ok(coverageFunctionStart >= 0 && coverageFunctionEnd > coverageFunctionStart);
const coverageFunctionSource = vectorZoomLabSource.slice(coverageFunctionStart, coverageFunctionEnd);
assert.match(
  coverageFunctionSource,
  /canvas\.width \* canvas\.height \* VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL/,
  "il baseline deve usare gli 8 byte reali della texture rgba16float",
);
assert.match(
  coverageFunctionSource,
  /engine\.vectorTextRoiCacheEnabled[\s\S]{0,180}fallbackGpuMemoryMiB < fallbackFullViewportGpuMemoryMiB[\s\S]{0,180}Math\.abs\(fallbackGpuMemoryMiB - fallbackFullViewportGpuMemoryMiB\) < 1e-6/,
  "C deve accettare una ROI positiva e minore del baseline, oppure il viewport completo con flag OFF",
);
assert.doesNotMatch(coverageFunctionSource, /canvas\.width \* canvas\.height \* 4/);
const rasterLifecycleIndex = coverageFunctionSource.indexOf('engine.addLayer("C raster lifecycle")');
const beginCoverageGestureIndex = coverageFunctionSource.indexOf("controller.beginViewGesture()");
assert.ok(rasterLifecycleIndex >= 0 && beginCoverageGestureIndex > rasterLifecycleIndex);
assert.doesNotMatch(
  coverageFunctionSource.slice(rasterLifecycleIndex, beginCoverageGestureIndex),
  /captureVectorTextFallbackPresentation/,
  "C deve provare il rebuild production dopo addLayer senza autoripararsi manualmente",
);
assert.match(coverageFunctionSource, /automaticFallbackRebuildDelta/);
assert.match(coverageFunctionSource, /rasterLifecycleRebuiltFallback/);
assert.match(vectorZoomLabSource, /const duringTrace = controller\.getDiagnostics\(\)/);
assert.match(
  vectorZoomLabSource,
  /fastPresentationSubmitDelta =\s*duringTrace\.zoomFastPresentationSubmissionCount/,
  "il drain di verifica non deve migliorare retroattivamente la metrica dei 650 ms",
);
assert.match(vectorZoomLabSource, /fastSubmittedRevisionLagMaximum <= 2/);
assert.match(vectorZoomLabSource, /fastPresentationMaximumInFlight >= 1/);
assert.match(vectorZoomLabSource, /fastPresentationMaximumInFlight <= 2/);
assert.match(vectorZoomLabSource, /fastPresentationCoalescedDelta <= Math\.ceil\(sampleCount \* 0\.1\)/);
assert.match(vectorZoomLabSource, /finalFastAckDurationMs <= 250/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS/);
assert.match(vectorZoomLabSource, /\/api\/vector-zoom-runs/);
assert.match(vectorZoomLabSource, /runCode: report\.runCode/);
assert.match(editorLabsSource, /import\("\.\/vector\/vector-zoom-labs"\)/);
assert.doesNotMatch(mainSource, /__vectorZoom(?:Ab|Coverage|Stress)Report|\/api\/vector-zoom-runs/);
assert.match(sitesBuildSource, /handleVectorZoomRuns/);
assert.match(sitesBuildSource, /\/api\/vector-zoom-runs/);
assert.match(sitesBuildSource, /report\.passed !== VECTOR_ZOOM_CHECK_NAMES\.every/);
assert.match(sitesBuildSource, /typeof report\.vectorTextRoiCacheEnabled !== "boolean"/);
assert.match(
  sitesBuildSource,
  /report\.vectorTextRoiCacheEnabled[\s\S]{0,220}report\.fallbackGpuMemoryMiB < report\.fallbackFullViewportGpuMemoryMiB[\s\S]{0,220}Math\.abs/,
  "il validatore remoto deve conservare la stessa semantica A/B del lab",
);
assert.doesNotMatch(
  sitesBuildSource,
  /report\.fallbackTextureCount !== 1|report\.exactRecoveryDelta !== 1/,
  "il backend deve salvare anche i report C falliti, non soltanto gli esiti verdi",
);
assert.match(vectorZoomMigrationSource, /CREATE TABLE IF NOT EXISTS vector_zoom_runs/);
assert.equal(
  (
    mixedCompositorSource.match(
      /textureLoad\(sourceTexture, pixel, 0\)/g,
    ) ?? []
  ).length,
  1,
  "il campionamento screen-space diretto deve esistere soltanto nel modo preciso",
);
assert.match(controllerSource, /if \(node\.outlineWidth > 0\) \{[\s\S]*kind: "source-outline"/);
assert.match(controllerSource, /if \(node\.blockShadowOutlineWidth > 0\) \{[\s\S]*kind: "block-outline"/);
assert.equal(
  (controllerSource.match(/Math\.hypot\(vector\.x, vector\.y\) > Number\.EPSILON/g) ?? []).length,
  2,
  "testo e SVG devono saltare la faccia Block Shadow completamente nascosta a offset zero",
);
assert.doesNotMatch(
  controllerSource,
  /Math\.hypot\(vector\.x, vector\.y\) <= Number\.EPSILON/,
);
assert.match(controllerSource, /node\.singleShadowBlur > 0[\s\S]*this\.slugBlurDraw/);
assert.match(controllerSource, /else \{[\s\S]*this\.slugDraw\(/);
assert.doesNotMatch(fontGeometrySource, /Path2D|canvasPath|buildShadow3dPath/);
assert.match(clientSource, /MAXIMUM_IN_FLIGHT_EFFECT_JOBS = 4/);
assert.match(clientSource, /private readonly queuedBySlot = new Map/);
assert.match(clientSource, /this\.queuedBySlot\.set\(slotKey, queued\)/);
assert.match(
  clientSource,
  /pendingByRequest\.size < MAXIMUM_IN_FLIGHT_EFFECT_JOBS/,
);
assert.match(clientSource, /inFlightSlots\.has\(slotKey\)/);
assert.match(clientSource, /desiredKeyBySlot\.values\(\)[\s\S]*desiredKey === response\.cacheKey/);
assert.match(clientSource, /requiresExactEffectLod[\s\S]*effect\.kind === "block"[\s\S]*effect\.kind === "block-outline"/);
assert.match(clientSource, /currentAlreadySuitable[\s\S]*current\.lodBucket === lod\.bucket[\s\S]*current\.lodBucket >= lod\.bucket/);
assert.match(clientSource, /if \(!currentAlreadySuitable\) \{[\s\S]*this\.requestEffect/);
assert.match(clientSource, /\|\| exactLod[\s\S]*ready\.lodBucket >= current\.lodBucket/);
assert.match(clientSource, /matchesRequestedIdentity: current\?\.effectIdentity === identity/);
assert.match(clientSource, /matchesRequestedLod: currentAlreadySuitable/);
assert.match(controllerSource, /!requireRequestedLod \|\| result\.matchesRequestedLod/);
assert.match(clientSource, /private readonly pinnedSlots = new Set<string>\(\)/);
assert.match(clientSource, /!liveSlots\.has\(slot\) && !this\.pinnedSlots\.has\(slot\)/);
assert.match(
  clientSource,
  /resetForDocument\(\): void \{[\s\S]*pinnedSlots\.clear\(\)[\s\S]*pathIdentities\.clear\(\)/,
);
assert.match(controllerSource, /slotNamespace = pinForRasterization \? "svg-raster" : "svg"/);
assert.match(controllerSource, /this\.effectCompiler\.pinSlot\(slotKey\)/);
assert.match(controllerSource, /finally \{[\s\S]*releasePinnedSlot\(slot\)/);
assert.match(clientSource, /const geometryIdentity = this\.geometryIdentity\(path\)/);
assert.doesNotMatch(
  clientSource,
  /meshForSlot\([\s\S]{0,180}sourceRevision/,
);
assert.doesNotMatch(controllerSource, /node\.document\.silhouetteRevision/);
assert.doesNotMatch(controllerSource, /paint\.revision/);
assert.match(clientSource, /MAXIMUM_READY_EFFECT_CACHE_ENTRIES = 48/);
assert.match(
  engineSource,
  /vectorGpuResourceSharingEnabled\s*=\s*options\.vectorGpuResourceSharingEnabled !== false/,
);
assert.match(
  mainSource,
  /pageSearchParams\.get\("vectorGpuResourceSharing"\) !== "0"/,
);
const sharedMeshRevision = { revision: "mesh-revision" };
const sharedSlugRevision = { revision: "slug-revision" };
assert.equal(vectorTextGpuResourceKey({
  mode: "mesh-direct",
  meshKey: "node-a",
  mesh: sharedMeshRevision,
}, false), "node-a");
assert.equal(vectorTextGpuResourceKey({
  mode: "mesh-direct",
  meshKey: "node-a",
  mesh: sharedMeshRevision,
}, true), "mesh:mesh-revision");
assert.equal(vectorTextGpuResourceKey({
  mode: "mesh-direct",
  meshKey: "node-b",
  mesh: sharedMeshRevision,
}, true), "mesh:mesh-revision");
assert.equal(vectorTextGpuResourceKey({
  mode: "slug-direct",
  meshKey: "node-c",
  slug: sharedSlugRevision,
}, true), "slug:slug-revision");
const sharedResourceKey = vectorTextGpuResourceKey({
  mode: "mesh-direct",
  meshKey: "node-a",
  mesh: sharedMeshRevision,
}, true);
const sharedResource = {
  kind: "mesh",
  revision: sharedMeshRevision.revision,
};
const sharedResourceCache = new Map([[sharedResourceKey, sharedResource]]);
let sharedResourceDestroyCount = 0;
pruneVectorTextGpuResourceCache(
  sharedResourceCache,
  new Set([sharedResourceKey]),
  (resource) => {
    assert.equal(resource, sharedResource);
    sharedResourceDestroyCount += 1;
  },
);
assert.equal(sharedResourceCache.size, 1);
assert.equal(sharedResourceDestroyCount, 0);
pruneVectorTextGpuResourceCache(
  sharedResourceCache,
  new Set(),
  () => {
    sharedResourceDestroyCount += 1;
  },
);
assert.equal(sharedResourceCache.size, 0);
assert.equal(sharedResourceDestroyCount, 1);
pruneVectorTextGpuResourceCache(
  sharedResourceCache,
  new Set(),
  () => {
    sharedResourceDestroyCount += 1;
  },
);
assert.equal(sharedResourceDestroyCount, 1);
assert.match(
  clientSource,
  /private requiredReadyKeys[\s\S]*displayedBySlot\.values\(\)[\s\S]*desiredKeyBySlot\.values\(\)/,
);
assert.match(
  clientSource,
  /private pruneReadyCache[\s\S]*!requiredKeys\.has\(key\)[\s\S]*readyByKey\.delete\(key\)/,
);
const activeReadyCacheClient = new VectorTextEffectCompilerClient(() => {});
for (let index = 0; index < 64; index += 1) {
  const key = `active-ready-${index}`;
  activeReadyCacheClient.desiredKeyBySlot.set(`slot-${index}`, key);
  activeReadyCacheClient.readyByKey.set(key, {
    slotKey: `slot-${index}`,
    cacheKey: key,
    effectIdentity: `identity-${index}`,
    geometryIdentity: `identity-${index}`,
    lodBucket: 0,
    mesh: null,
  });
}
activeReadyCacheClient.pruneReadyCache();
assert.equal(activeReadyCacheClient.readyByKey.size, 64);
for (let index = 0; index < 64; index += 1) {
  assert.equal(activeReadyCacheClient.readyByKey.has(`active-ready-${index}`), true);
}
for (let index = 48; index < 64; index += 1) {
  activeReadyCacheClient.desiredKeyBySlot.delete(`slot-${index}`);
}
activeReadyCacheClient.pruneReadyCache();
assert.equal(activeReadyCacheClient.readyByKey.size, 48);

const lodReadyCacheClient = new VectorTextEffectCompilerClient(() => {});
for (let index = 0; index < 5; index += 1) {
  const key = `lod-ready-${index}`;
  lodReadyCacheClient.readyByKey.set(key, {
    slotKey: `lod-slot-${index}`,
    cacheKey: key,
    effectIdentity: "shared-identity",
    geometryIdentity: "shared-identity",
    lodBucket: index,
    mesh: null,
  });
}
lodReadyCacheClient.desiredKeyBySlot.set("desired-slot", "lod-ready-4");
lodReadyCacheClient.displayedBySlot.set("displayed-slot", {
  ...lodReadyCacheClient.readyByKey.get("lod-ready-0"),
  slotKey: "displayed-slot",
});
lodReadyCacheClient.pruneReadyLods("shared-identity", 0);
assert.equal(lodReadyCacheClient.readyByKey.size, 3);
assert.equal(lodReadyCacheClient.readyByKey.has("lod-ready-0"), true);
assert.equal(lodReadyCacheClient.readyByKey.has("lod-ready-4"), true);

// Worker path ownership: a newly registered path must become pending or queued
// before bounded pruning can consider it for release. The fake worker processes
// registration state in message order and drains the production latest-only
// queue through a small in-flight window.
class VectorEffectQueueTestWorker {
  static instances = [];

  constructor() {
    this.messages = [];
    this.registeredRevisions = new Set();
    this.pendingBuilds = [];
    this.missingBuildRevisions = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    VectorEffectQueueTestWorker.instances.push(this);
  }

  postMessage(message) {
    assert.equal(this.terminated, false, "a terminated worker must not receive messages");
    this.messages.push(message);
    if (message.type === "register-path") {
      this.registeredRevisions.add(message.revision);
      return;
    }
    if (message.type === "release-path") {
      this.registeredRevisions.delete(message.revision);
      return;
    }
    const pathIsRegistered = this.registeredRevisions.has(message.revision);
    if (!pathIsRegistered) {
      this.missingBuildRevisions.push(message.revision);
    }
    this.pendingBuilds.push({ message, pathIsRegistered });
  }

  respondToNextBuild() {
    const pending = this.pendingBuilds.shift();
    assert.ok(pending, "the bounded worker queue must expose its next build");
    assert.ok(this.onmessage, "the client must install the worker response handler");
    this.onmessage({
      data: pending.pathIsRegistered
        ? {
          type: "effect-ready",
          requestId: pending.message.requestId,
          cacheKey: pending.message.cacheKey,
          mesh: null,
        }
        : {
          type: "effect-failed",
          requestId: pending.message.requestId,
          cacheKey: pending.message.cacheKey,
          message: `Path ${pending.message.revision} was released before its build.`,
        },
    });
  }

  terminate() {
    this.terminated = true;
    this.registeredRevisions.clear();
    this.pendingBuilds.length = 0;
  }
}

const queueTestWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const queueTestWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  writable: true,
  value: VectorEffectQueueTestWorker,
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  },
});
try {
  const queuedPathCount = 129;
  const queueClient = new VectorTextEffectCompilerClient(() => {});
  for (let index = 0; index < queuedPathCount; index += 1) {
    const coords = sourceRectangle.coords.slice();
    coords[0] += index / 1024;
    queueClient.meshForSlot(
      `queue-slot-${index}`,
      {
        ...sourceRectangle,
        coords,
        verbs: sourceRectangle.verbs.slice(),
        contourOffsets: sourceRectangle.contourOffsets.slice(),
      },
      lod,
      { kind: "source-fill" },
      true,
    );
  }
  const queueWorker = VectorEffectQueueTestWorker.instances.at(-1);
  assert.ok(queueWorker);
  assert.equal(
    queueWorker.registeredRevisions.size,
    queuedPathCount,
    "all protected queued paths must remain registered before the first build completes",
  );
  for (let completed = 0; completed < queuedPathCount; completed += 1) {
    assert.equal(
      queueWorker.pendingBuilds.length,
      Math.min(4, queuedPathCount - completed),
      "the compiler client must keep its bounded worker window full",
    );
    queueWorker.respondToNextBuild();
  }
  assert.deepEqual(queueWorker.missingBuildRevisions, []);
  assert.equal(
    queueWorker.messages.filter((message) => message.type === "register-path").length,
    queuedPathCount,
  );
  assert.equal(
    queueWorker.messages.filter((message) => message.type === "build-effect").length,
    queuedPathCount,
  );
  assert.equal(queueClient.diagnostics().pendingJobs, 0);
  assert.equal(queueClient.diagnostics().failedJobs, 0);
  assert.equal(queueClient.diagnostics().readyJobs, queuedPathCount);
  queueClient.resetForDocument();
  assert.equal(queueWorker.terminated, true);

  const latestClient = new VectorTextEffectCompilerClient(() => {});
  latestClient.meshForSlot(
    "latest-slot",
    sourceRectangle,
    lod,
    { kind: "source-fill" },
    true,
  );
  latestClient.meshForSlot(
    "latest-slot",
    sourceRectangle,
    lod,
    { kind: "block", vectorX: 2, vectorY: 0 },
    true,
  );
  latestClient.meshForSlot(
    "latest-slot",
    sourceRectangle,
    lod,
    { kind: "block", vectorX: 4, vectorY: 0 },
    true,
  );
  const latestWorker = VectorEffectQueueTestWorker.instances.at(-1);
  assert.ok(latestWorker);
  assert.equal(
    latestWorker.pendingBuilds.length,
    1,
    "one slot must never occupy more than one in-flight position",
  );
  assert.equal(latestClient.diagnostics().pendingJobs, 2);
  latestWorker.respondToNextBuild();
  assert.equal(
    latestClient.readyByKey.size,
    0,
    "a completed build that is no longer desired must not enter the ready cache",
  );
  assert.equal(latestWorker.pendingBuilds.length, 1);
  assert.equal(latestWorker.pendingBuilds[0].message.effect.kind, "block");
  assert.equal(latestWorker.pendingBuilds[0].message.effect.vectorX, 4);
  assert.equal(
    latestWorker.messages.filter((message) => (
      message.type === "build-effect"
      && message.effect.kind === "block"
      && message.effect.vectorX === 2
    )).length,
    0,
    "an intermediate queued update must be replaced before reaching the worker",
  );
  latestWorker.respondToNextBuild();
  assert.equal(latestClient.diagnostics().pendingJobs, 0);
  assert.equal(latestClient.diagnostics().readyJobs, 1);
  latestClient.resetForDocument();
  assert.equal(latestWorker.terminated, true);

  const resetClient = new VectorTextEffectCompilerClient(() => {});
  for (let index = 0; index < 2; index += 1) {
    const coords = sourceRectangle.coords.slice();
    coords[0] += 10 + index;
    resetClient.meshForSlot(
      `reset-slot-${index}`,
      {
        ...sourceRectangle,
        coords,
        verbs: sourceRectangle.verbs.slice(),
        contourOffsets: sourceRectangle.contourOffsets.slice(),
      },
      lod,
      { kind: "source-fill" },
      true,
    );
  }
  const resetWorker = VectorEffectQueueTestWorker.instances.at(-1);
  assert.ok(resetWorker);
  assert.notEqual(resetWorker, queueWorker);
  assert.equal(resetClient.diagnostics().registeredPaths, 2);
  assert.equal(resetClient.diagnostics().pendingJobs, 2);
  const revisionBeforeReset = resetClient.resourceRevisionValue();
  const resetWaiter = resetClient.waitForResourceReady(revisionBeforeReset, 1_000);
  resetClient.resetForDocument();
  const revisionAfterReset = await resetWaiter;
  assert.ok(revisionAfterReset > revisionBeforeReset);
  assert.equal(resetWorker.terminated, true);
  assert.equal(resetWorker.onmessage, null);
  assert.equal(resetWorker.onerror, null);
  assert.equal(resetWorker.registeredRevisions.size, 0);
  assert.equal(resetClient.worker, null);
  assert.equal(resetClient.resourceWaiters.size, 0);
  assert.deepEqual(resetClient.diagnostics(), {
    registeredPaths: 0,
    registeredPathBytes: 0,
    pendingJobs: 0,
    readyJobs: 0,
    displayedSlots: 0,
    failedJobs: 0,
    lastError: null,
    backend: "wasm",
    lastComputeMs: 0,
    wasmMemoryBytes: 0,
  });
} finally {
  if (queueTestWorkerDescriptor) {
    Object.defineProperty(globalThis, "Worker", queueTestWorkerDescriptor);
  } else {
    delete globalThis.Worker;
  }
  if (queueTestWindowDescriptor) {
    Object.defineProperty(globalThis, "window", queueTestWindowDescriptor);
  } else {
    delete globalThis.window;
  }
}
assert.match(clientSource, /MAXIMUM_REGISTERED_PATHS = 128/);
assert.match(clientSource, /protectedRevisions/);
assert.match(clientSource, /type: "release-path"/);
assert.match(workerProtocolSource, /ReleaseVectorTextPathMessage/);
assert.match(workerSource, /message\.type === "release-path"[\s\S]*paths\.delete/);
assert.match(controllerSource, /displayedDrawsByNodeKey/);
assert.match(controllerSource, /if \(allEffectsReady\) \{[\s\S]*else if \(displayedDraws\)/);
assert.match(controllerSource, /retargetDisplayedDraws\(displayedDraws, node\)/);
assert.match(controllerSource, /dataset\.atomicEffectPendingNodes/);
assert.match(workerSource, /postMessage\([\s\S]*mesh\.vertices\.buffer[\s\S]*mesh\.indices\.buffer/);
assert.match(geometrySource, /const MITER_LIMIT = 4/);
assert.match(geometrySource, /Il contratto richiede bevel, non square/);
assert.match(geometrySource, /exactCrossSign\(vectorX, vectorY, edgeX, edgeY\) <= 0/);
assert.match(geometrySource, /canonicalSetFromPaths\(pieces\)/);
assert.match(geometrySource, /ClipType\.Difference/);
assert.match(geometrySource, /ClipType\.Intersection/);
assert.match(geometrySource, /overlapPieces/);
assert.match(geometrySource, /triangulationDeviation > 1e-8/);
assert.match(geometrySource, /if \(quantized\.length >= 3\)/);

const textCornersStart = interactionOverlaySource.indexOf("export function sceneOverlayCorners(");
const textCornersEnd = interactionOverlaySource.indexOf(
  "export function sceneOverlayRotationHandle(",
  textCornersStart,
);
assert.ok(textCornersStart >= 0 && textCornersEnd > textCornersStart);
const textCornersSource = interactionOverlaySource.slice(textCornersStart, textCornersEnd);
assert.doesNotMatch(textCornersSource, /blockShadow|singleShadow|outlineWidth|blur/);
assert.match(
  controllerSource,
  /effectLodForNode[\s\S]*Math\.max\(Math\.abs\(sceneScaleX\(node\)\), Math\.abs\(sceneScaleY\(node\)\)\)[\s\S]*Math\.abs\(view\.zoom\)/,
);
assert.match(controllerSource, /!this\.host\.isPaintStrokeActive\(\)/);

// WebGPU resources: MSAA4 senza vecchio stencil, premultiplied source-over e destroy esplicito.
assert.doesNotMatch(engineSource, /vectorTextGpuDepthStencil|VECTOR_TEXT_GPU_DEPTH_STENCIL_FORMAT/);
assert.doesNotMatch(engineSource, /Vector text outline stencil union/);
assert.match(engineSource, /VECTOR_TEXT_GPU_SAMPLE_COUNT \+ 1/);
assert.match(engineSource, /srcFactor: "one"[\s\S]*dstFactor: "one-minus-src-alpha"/);
assert.match(engineSource, /Vector text analytic Slug mask for GPU blur/);
assert.match(engineSource, /Vector effects GPU tent horizontal/);
assert.match(engineSource, /Vector effects GPU tent vertical/);
assert.match(gpuResourcesSource, /resources\.curveTexture\.destroy\(\)[\s\S]*resources\.bandTexture\.destroy\(\)/);
assert.match(gpuResourcesSource, /resources\.vertexBuffer\.destroy\(\)[\s\S]*resources\.indexBuffer\.destroy\(\)/);
assert.match(engineSource, /resources\.texture\.destroy\(\)[\s\S]*vectorTextGpuBlurCaches\.delete/);
assert.match(engineSource, /if \(activeBlurCacheCount === 0\) \{[\s\S]*releaseVectorTextGpuBlurScratch/);
assert.doesNotMatch(controllerSource, /document\.createElement\("canvas"\)/);
assert.doesNotMatch(controllerSource, /strokeText\(|fillText\(|canvasPath/);

// SVG: parser semantico sicuro, palette modificabile e gli stessi effetti mesh GPU.
assert.equal(VECTOR_SVG_IMPORT_STRATEGY, "sanitized-semantic-svg-gradients-retained-strokes-worker-lod-mesh-webgpu-v2");
assert.equal(VECTOR_SVG_MAXIMUM_SOURCE_BYTES, 5 * 1024 * 1024);
assert.equal(VECTOR_SVG_MAXIMUM_COMMANDS, 500_000);
assert.equal(VECTOR_SVG_MAXIMUM_GRADIENT_STOPS, 4);
assert.equal(VECTOR_SVG_STATIC_STROKE_TOLERANCE, 0.025);
const straightStrokeSource = {
  verbs: new Uint8Array([0, 1]),
  coords: new Float64Array([0, 0, 40, 0]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const roundDashedStroke = {
  sourcePath: straightStrokeSource,
  transform: [1, 0, 0, 1, 0, 0],
  width: 0.87,
  linecap: "round",
  linejoin: "round",
  miterLimit: 4,
  dashArray: [3.48, 1.74, 0, 0],
  dashOffset: 0,
};
const coarseExpandedStroke = expandVectorSvgStrokePaint(
  [roundDashedStroke],
  { centerlineTolerance: 0.05, roundArcSagittaTolerance: 0.05 },
);
const preciseExpandedStroke = expandVectorSvgStrokePaint(
  [roundDashedStroke],
  { centerlineTolerance: 0.0005, roundArcSagittaTolerance: 0.0005 },
);
assert.ok(preciseExpandedStroke.verbs.length > coarseExpandedStroke.verbs.length * 3);
assert.ok(
  preciseExpandedStroke.contourOffsets.length > Math.ceil(40 / 5.22),
  "zero-length visible dashes must remain explicit point contours",
);
const firstExpandedContourPoints = [];
let expandedCoordinateOffset = 0;
for (const verb of preciseExpandedStroke.verbs) {
  if (verb === 0 || verb === 1) {
    firstExpandedContourPoints.push({
      x: preciseExpandedStroke.coords[expandedCoordinateOffset],
      y: preciseExpandedStroke.coords[expandedCoordinateOffset + 1],
    });
    expandedCoordinateOffset += 2;
  } else if (verb === 2) {
    expandedCoordinateOffset += 4;
  } else if (verb === 3) {
    expandedCoordinateOffset += 6;
  } else if (verb === 4) {
    break;
  }
}
const strokeRadius = roundDashedStroke.width * 0.5;
let maximumRoundCapSagitta = 0;
for (let index = 0; index < firstExpandedContourPoints.length; index += 1) {
  const first = firstExpandedContourPoints[index];
  const second = firstExpandedContourPoints[
    (index + 1) % firstExpandedContourPoints.length
  ];
  for (const centerX of [0, 3.48]) {
    const onCap = centerX === 0
      ? first.x <= 1e-6 && second.x <= 1e-6
      : first.x >= centerX - 1e-6 && second.x >= centerX - 1e-6;
    if (!onCap) continue;
    const firstRadius = Math.hypot(first.x - centerX, first.y);
    const secondRadius = Math.hypot(second.x - centerX, second.y);
    if (
      Math.abs(firstRadius - strokeRadius) >= 0.001
      || Math.abs(secondRadius - strokeRadius) >= 0.001
    ) continue;
    const chord = Math.hypot(first.x - second.x, first.y - second.y);
    const sagitta = strokeRadius - Math.sqrt(Math.max(
      0,
      strokeRadius ** 2 - chord ** 2 * 0.25,
    ));
    maximumRoundCapSagitta = Math.max(maximumRoundCapSagitta, sagitta);
  }
}
assert.ok(maximumRoundCapSagitta > 0);
assert.ok(maximumRoundCapSagitta <= 0.00055);
const transformedRoundStroke = expandVectorSvgStrokePaint([{
  ...roundDashedStroke,
  sourcePath: {
    verbs: new Uint8Array([0, 1]),
    coords: new Float64Array([0, 0, 0.01, 0]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  },
  transform: [1000, 0, 0, 1000, 0, 0],
  width: 0.001,
  dashArray: [],
}], {
  centerlineTolerance: 0.0005,
  roundArcSagittaTolerance: 0.0005,
});
assert.ok(
  transformedRoundStroke.verbs.length > 60,
  "transformed round strokes must retain subpixel arc precision",
);
const diagonalSquareDots = expandVectorSvgStrokePaint([{
  ...roundDashedStroke,
  sourcePath: {
    verbs: new Uint8Array([0, 1]),
    coords: new Float64Array([0, 0, 10, 10]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  },
  width: 2,
  linecap: "square",
  dashArray: [0, 4],
}], {
  centerlineTolerance: 0.01,
  roundArcSagittaTolerance: 0.01,
});
assert.ok(diagonalSquareDots.contourOffsets.length >= 1);
assert.ok(Math.abs(diagonalSquareDots.coords[0]) < 1e-9);
assert.ok(Math.abs(diagonalSquareDots.coords[1] + Math.SQRT2) < 1e-9);
const collinearOvershootStroke = expandVectorSvgStrokePaint([{
  ...roundDashedStroke,
  sourcePath: {
    verbs: new Uint8Array([0, 3]),
    coords: new Float64Array([0, 0, 40, 0, -30, 0, 10, 0]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  },
  width: 1,
  linecap: "butt",
  dashArray: [],
}], {
  centerlineTolerance: 0.01,
  roundArcSagittaTolerance: 0.01,
});
const overshootXs = [];
for (let index = 0; index < collinearOvershootStroke.coords.length; index += 2) {
  overshootXs.push(collinearOvershootStroke.coords[index]);
}
assert.ok(Math.min(...overshootXs) < -2);
assert.ok(Math.max(...overshootXs) > 12);
assert.match(svgSource, /const SAFE_ELEMENTS = new Set/);
assert.match(svgSource, /"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"/);
assert.match(svgSource, /Unsupported or unsafe SVG element/);
assert.match(svgSource, /SVG event handler is not allowed/);
assert.match(svgSource, /local href references between SVG gradients/);
assert.match(svgSource, /hasOnlyLocalPaintUrls/);
assert.match(svgSource, /parseGradientDefinitions/);
assert.match(svgSource, /expandedStrokePath/);
assert.match(controllerSource, /svgPaintPathForLod/);
assert.match(controllerSource, /expandVectorSvgStrokePaint/);
assert.match(controllerSource, /SVG_STROKE_PATH_LODS_PER_PAINT = 3/);
assert.match(controllerSource, /svgStrokeSemanticKey/);
assert.match(controllerSource, /svgStrokePathsBySemantic/);
assert.match(controllerSource, /svgStrokeSemanticKeysByPaint/);
assert.match(controllerSource, /svgStrokeFailedLodsByPaint/);
assert.doesNotMatch(controllerSource, /svgStrokePathsByDocument/);
assert.match(controllerSource, /SVG_STROKE_PATH_CACHE_MAXIMUM_BYTES = 32 \* 1024 \* 1024/);
assert.match(controllerSource, /rememberSvgStrokeLodFailure/);
assert.match(controllerSource, /svgStrokeLodCacheLogicalMiB/);
assert.match(svgSource, /strokeInflationPrecision/);
assert.match(svgSource, /sourcePath: clonePath\(localPath\)/);
assert.match(svgSource, /strokePercentageReference/);
assert.match(svgSource, /normalized\.endsWith\("%"\)\) return fallback/);
assert.match(svgGradientStrokeFixture, /<linearGradient id="base-colors"/);
assert.match(svgGradientStrokeFixture, /<radialGradient id="glow"/);
assert.match(svgGradientStrokeFixture, /href="#base-colors"/);
assert.match(svgGradientStrokeFixture, /stroke-dasharray="36 14"/);
assert.match(svgGradientStrokeFixture, /<line x1="455" y1="285" x2="455" y2="285"/);
assert.match(gpuShaderSource, /gradientMeta: vec4<u32>/);
assert.match(gpuShaderSource, /fn linearGradientParameter/);
assert.match(gpuShaderSource, /fn radialGradientParameter/);
assert.match(gpuShaderSource, /fn unpackGradientStop/);
assert.match(engineSource, /unsigned\[base \+ 32\] = gradient\.kind === "linear" \? 1 : 2/);
assert.match(controllerSource, /svgGradientGpuData\(paint\.gradient\)/);
assert.doesNotMatch(svgSource, /innerHTML|insertAdjacentHTML|eval\(/);
assert.match(controllerSource, /parseVectorSvg\(source, sourceName\)/);
assert.match(controllerSource, /async importSvgFile\(file: File\)/);
assert.match(controllerSource, /async importRasterImageFile\(file: File\)/);
assert.match(sceneImportBridgeSource, /const file = input\.files\?\.\[0\]/);
assert.match(sceneImportBridgeSource, /svgInput\.addEventListener\("change"/);
assert.match(sceneImportBridgeSource, /imageInput\.addEventListener\("change"/);
assert.doesNotMatch(controllerSource, /svgFileInput\.addEventListener\("change"/);
assert.doesNotMatch(controllerSource, /imageFileInput\.addEventListener\("change"/);
assert.match(controllerSource, /kind: "source-fill"/);
assert.match(controllerSource, /this\.svgBlurDraw/);
assert.match(controllerSource, /kind === "outer"[\s\S]*mode: "mesh-blur"[\s\S]*mode: "mesh-inner-shadow-blur"/);
assert.match(gpuShaderSource, /fn blurMaskVertexMain/);
assert.match(gpuShaderSource, /fn meshInnerShadowFragmentMain/);
assert.match(gpuShaderSource, /fn stableRasterCanvasPosition/);
assert.equal(
  (gpuShaderSource.match(/stableRasterCanvasPosition\(canvasPosition\)/g) ?? []).length,
  2,
  "mesh fill and mesh inner-shadow paths share the document-stable subpixel grid",
);

// Rasterizzazione vettoriale autorevole: SVG mesh e testo Slug mantengono i
// calcoli/MSAA in RGBA16F lineare; i documenti encoded RGBA8 eseguono una sola
// conversione finale con quantizzazione ancorata alle coordinate documento.
assert.match(
  vectorRasterSource,
  /semantic-vector-slug-mesh-webgpu-linear-msaa4-encoded-rgba8-finalize-tile-paired-chunks-history-seed-v5/,
);
assert.match(vectorRasterSource, /VECTOR_RASTER_FORMAT = "rgba16float"/);
assert.match(
  vectorRasterSource,
  /function vectorRasterChunkDimensions\(\): \{ width: number; height: number \}[\s\S]*?width: LAYER_STORAGE_TILE_WIDTH \* 2,[\s\S]*?height: LAYER_STORAGE_TILE_HEIGHT \* 2/,
);
assert.match(
  vectorRasterSource,
  /\{ width: chunkWidth, height: chunkHeight \} = vectorRasterChunkDimensions\(\)/,
);
assert.doesNotMatch(vectorRasterSource, /const VECTOR_RASTER_CHUNK_SIZE/);
assert.match(
  vectorRasterSource,
  /WeakMap<[\s\S]{0,120}Map<LayerFormat, Promise<VectorRasterPipelines>>/,
  "le pipeline raster vettoriali devono essere separate per formato documento",
);
assert.match(vectorRasterSource, /targets: \[\{ format, blend \}\]/);
assert.match(vectorRasterSource, /const format = destination\.format/);
assert.match(vectorRasterSource, /destination\.format !== engine\.layerFormat/);
assert.match(
  vectorRasterSource,
  /createVectorRasterScratch\(engine, renderFormat, chunkWidth, chunkHeight\)/,
);
assert.match(vectorRasterSource, /format,\s*usage: GPUTextureUsage\.RENDER_ATTACHMENT/);
assert.match(vectorRasterSource, /sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT/);
assert.match(vectorRasterSource, /entryPoint: "fragmentMain"/);
assert.match(vectorRasterSource, /slugInnerShadowDirect/);
assert.match(vectorRasterSource, /slugInnerShadowBlur/);
assert.match(vectorRasterSource, /meshInnerShadowBlur/);
assert.match(vectorRasterSource, /createLayerColdStorageCandidate\(/);
assert.match(vectorRasterSource, /encodeLayerColdHydration\(/);
assert.match(vectorRasterSource, /analyzeRasterTextureOccupancy\(/);
assert.match(vectorRasterSource, /record\.storageTileMask\.set\(occupancy\.tileMask\)/);
assert.doesNotMatch(vectorRasterSource, /markLayerStorageRect\(record\.storageTileMask/);
assert.match(vectorRasterSource, /replaceVectorWithRaster\(/);
assert.match(vectorRasterSource, /replaceRasterWithVector\(/);
assert.match(
  vectorRasterSource,
  /function synchronizeRasterClippingProjection\([\s\S]*?scene\.rasterClippingProjection\(/,
  "la conversione vettore/raster deve conservare la relazione di clipping",
);
assert.ok(
  (vectorRasterSource.match(/synchronizeRasterClippingProjection\(engine\);/g) ?? []).length >= 7,
  "conversione, Undo/Redo e rollback devono riallineare tutti la proiezione raster",
);
assert.match(vectorRasterSource, /action\.seed\.format !== engine\.layerFormat/);
assert.match(vectorRasterSource, /allocateLayerGpuResources\([\s\S]{0,100}action\.seed\.format/);
assert.match(vectorRasterSource, /runGpuAllocationTransaction\(/);
assert.match(vectorRasterSource, /No RGBA8 fallback is allowed/);
assert.match(
  vectorRasterSource,
  /documentStorageColorSpace === "encoded-srgb-premultiplied"/,
);
assert.match(vectorRasterSource, /const renderFormat: LayerFormat = storedEncodedSrgb \? "rgba16float" : format/);
assert.match(vectorRasterSource, /rgba8SpatialQuantizationShader/);
assert.match(
  vectorRasterSource,
  /usage: GPUTextureUsage\.RENDER_ATTACHMENT[\s\S]{0,120}GPUTextureUsage\.TEXTURE_BINDING/,
  "the linear MSAA resolve must be sampleable by the encoded RGBA8 finalizer",
);
assert.match(vectorRasterSource, /linearPremultipliedToEncoded\(textureLoad\(linearTexture/);
assert.match(vectorRasterSource, /quantizeRgba8SpatialAdjacent\(/);
assert.match(vectorRasterSource, /encodedScratch\?\.texture \?\? resolvedTexture/);
assert.doesNotMatch(
  vectorRasterSource,
  /CanvasRenderingContext2D|copyExternalImageToTexture|drawImage\(/,
  "la rasterizzazione non deve introdurre un fallback bitmap/Canvas2D",
);
assert.match(
  controllerSource,
  /async rasterizeSelectedSvg\(\s*propagateError = false,\s*\)/,
);
assert.match(controllerSource, /await this\.host\.rasterizeVectorSvgNode\(svgId, draws\)/);
assert.match(
  controllerSource,
  /async rasterizeSelectedText\(\s*propagateError = false,\s*\)/,
);
assert.match(
  controllerSource,
  /async rasterizeSelectedTextLayer\(\)[\s\S]{0,700}return this\.rasterizeSelectedText\(true\)/,
  "batch callers need an awaited text rasterization boundary with propagated failures",
);
assert.match(controllerSource, /await this\.host\.rasterizeVectorTextNode\(textId, draws\)/);
assert.match(controllerSource, /vectorRasterFormatLabel\(result\.format\)/);
assert.match(
  controllerSource,
  /function vectorRasterFormatLabel\(format: LayerFormat\): string \{[\s\S]*?format === "rgba16float" \? "linear RGBA16F" : "RGBA8 sRGB";/,
  "RGBA8 rasterization status must describe the encoded-sRGB document format.",
);
assert.doesNotMatch(
  controllerSource,
  /"linear RGBA8"/,
  "RGBA8 rasterization must not be reported as linear storage.",
);
assert.doesNotMatch(controllerSource, /rasterizzato in RGBA8/);
assert.match(controllerSource, /slotNamespace = pinForRasterization \? "text-raster" : "text"/);
assert.match(controllerSource, /!requireRequestedLod \|\| result\.matchesRequestedLod/);
assert.match(controllerSource, /resourceRevisionValue\(\)/);
assert.match(controllerSource, /private sceneOperationRenderDeferred = false/);
assert.match(
  controllerSource,
  /private renderNow\([\s\S]{0,220}\): boolean \{[\s\S]*this\.sceneOperationBusy[\s\S]*this\.sceneOperationRenderDeferred = true/,
);
assert.match(
  controllerSource,
  /if \(this\.sceneOperationRenderDeferred\) \{[\s\S]*this\.scheduleRender\(\)/,
);
assert.match(
  controllerSource,
  /runWithLoading\(label,[\s\S]*?sceneOperationBusy = false;[\s\S]*?sceneOperationRenderDeferred = false;[\s\S]*?this\.renderNow\(\);[\s\S]*?await this\.host\.waitForIdle\(\)/,
  "a semantic mutation must submit its deferred visible frame before the loading overlay reaches the GPU fence",
);
assert.match(clientSource, /waitForResourceReady\(/);
assert.match(clientSource, /private worker: Worker \| null = null/);
assert.match(
  clientSource,
  /private ensureWorker\(\): Worker \{[\s\S]{0,220}const worker = new Worker\(/,
  "the vector effect worker must start only when text geometry first requests it",
);
assert.match(clientSource, /this\.ensureWorker\(\)\.postMessage\(message/);
assert.match(
  clientSource,
  /private readonly onResourceReady: \(\) => void;[\s\S]*constructor\(onResourceReady: \(\) => void\) \{[\s\S]*this\.onResourceReady = onResourceReady/,
);
assert.doesNotMatch(
  clientSource,
  /private readonly worker = new Worker/,
  "constructing the reusable mixed-scene controller must not start the text worker",
);
assert.match(engineSource, /kind: "vector-rasterize"/);
assert.match(engineSource, /seedFormat: converted\.history\.seed\.format/);
assert.match(engineSource, /destroyVectorRasterHistorySeed\(/);
assert.match(engineSource, /this\.vectorTextGpuPendingRuns\.length = 0/);
assert.match(engineSource, /this\.vectorTextGpuPendingRuns\.splice\(index, 1\)/);
assert.match(vectorRasterSource, /activateLayer\([^;]*"structural-history"\)/);
assert.match(
  engineSource,
  /caller === "history-replay" \|\| caller === "structural-history"/,
);
const redoVectorStart = vectorRasterSource.indexOf("async function redoVectorRasterization(");
const redoVectorBody = vectorRasterSource.slice(redoVectorStart, redoVectorStart + 4_500);
const redoVectorTry = redoVectorBody.indexOf("try {");
const redoVectorHydration = redoVectorBody.indexOf("gpu = await hydrateHistorySeed");
assert.ok(
  redoVectorStart >= 0 && redoVectorTry >= 0 && redoVectorHydration > redoVectorTry,
  "l'OOM di reidratazione Redo deve attraversare il rollback strutturale",
);
assert.match(
  redoVectorBody,
  /discardVectorRasterCandidateAndRestoreOriginalActive\([\s\S]{0,180}action\.layerId,[\s\S]{0,80}gpu/,
  "il rollback Redo deve ritirare anche una candidata fallita prima dell'attach",
);

// Harness WebGPU reale: su una pagina dev nuova crea entrambe le sorgenti,
// legge i byte nel formato documento, attraversa Undo/Redo e richiede identità Uint8Array.
assert.match(controllerSource, /async runVectorRasterHistoryGpuTest\(\)/);
assert.match(controllerSource, /await runProbe\("text"\), await runProbe\("svg"\)/);
assert.match(controllerSource, /parseVectorSvg\([\s\S]{0,500}regression-vector-raster\.svg/);
assert.match(controllerSource, /rawBeforeUndo = await this\.host\.readLayerPixels/);
assert.match(controllerSource, /undoReturned = await this\.host\.undo\(\)/);
assert.match(controllerSource, /redoReturned = await this\.host\.redo\(\)/);
assert.match(controllerSource, /uint8ArraysEqual\(before, after\)/);
assert.match(controllerSource, /uint8ArraysEqual\(rawBeforeUndo, rawAfterRedo\)/);
assert.match(controllerSource, /probe\.format === probe\.seedFormat/);
assert.match(
  controllerSource,
  /probe\.rawBytesPerPixel === \(probe\.format === "rgba16float" \? 8 : 4\)/,
);
assert.match(controllerSource, /probe\.nonZeroAlphaPixels > 0/);

assert.match(htmlSource, /id="mobileSvgStyleRasterize"/);
assert.match(htmlSource, /id="mobileTextRasterize"/);
assert.match(htmlSource, /id="vectorTextRasterStatus"/);

// UI e font locali.
assert.equal(VECTOR_TEXT_FONT_MANIFEST.length, 3);
const fontLogicalBytes = VECTOR_TEXT_FONT_MANIFEST.reduce(
  (total, entry) => total + fs.statSync(entry.fileUrl).size,
  0,
);
assert.equal(fontLogicalBytes, 392_528);
for (const id of [
  "vectorSvgFileInput",
  "vectorSvgImportStatus",
  "rasterImageFileInput",
  "rasterImageImportStatus",
  "mobileSvgStyleRasterize",
  "mobileTextRasterize",
  "vectorTextRasterStatus",
  "mobileTextValue",
  "mobileTextFontFamily",
  "mobileTextFontSize",
  "mobileTextColor",
  "mobileTextWarpNone",
  "mobileTextWarpDistort",
  "mobileTextWarpArch",
  "mobileTextWarpCircle",
  "mobileTextWarpWave",
  "mobileTextOutlineWidth",
  "mobileTextOutlineColor",
  "mobileTextOutlineJoin",
  "mobileTextBlockShadowEnabled",
  "mobileTextDropShadowEnabled",
  "mobileTextInnerShadowEnabled",
  "vectorTextStatus",
  "vectorTextPresentationCanvas",
  "vectorTextInteractionCanvas",
]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `elemento #${id} mancante`);
}
assert.doesNotMatch(htmlSource, /id="vectorTextSingleShadowOutlineWidth"/);
assert.doesNotMatch(htmlSource, /id="vectorTextPrototypeSection"/);
assert.doesNotMatch(mainSource, /vectorTextEditorEnabled/);
assert.match(
  mainSource,
  /mixedSceneEnabled:\s*resolveMixedSceneEnabled\(editorExtensionEngineOptions, true\)/,
);
assert.doesNotMatch(mainSource, /deferred-mixed-scene/);
assert.match(
  mainSource,
  /function toolSettingsRequireMixedScene\(kind: EditorToolSettingsKind\)[\s\S]{0,160}kind\.startsWith\("text"\)/,
);
assert.match(
  mainSource,
  /toolSettingsRequireMixedScene\(requestedKind\)[\s\S]{0,1200}initializeMixedSceneController\(scope\)[\s\S]{0,1200}mobileToolSettingsSheet\?\.open\(requestedKind, trigger\)/,
  "Text must initialize the lightweight mixed-scene controller only after the user requests it",
);
assert.match(
  editorToolsSource,
  /kind === "text-warp" && !state\.textSelected[\s\S]{0,160}vectorEffectEditor && !state\.textSelected && !state\.svgSelected[\s\S]{0,120}svgEditor && !state\.svgSelected/,
  "vector settings must remain selectable by content instead of GPU warm-up state",
);
assert.doesNotMatch(mainSource, /pageSearchParams\.get\("vectorTextTest"\)/);
assert.doesNotMatch(mainSource, /innerShadowTest/);
assert.doesNotMatch(htmlSource, /id="vectorTextZoomMode"/);
assert.match(mainSource, /__mixedSceneController = mixedSceneController/);
assert.doesNotMatch(mainSource, /vectorTextPrototype|MixedVectorText/);
assert.equal(packageJson.scripts["vector-text:verify"], "node scripts/verify-vector-text.mjs");

console.log(
  "Vector text verified: Distort/Arch/Circle/Wave, analytic slug, Clipper64/Worker, fused seamless outline, 0 no-op, "
  + "canonical Block Shadow, sanitized semantic SVG with GPU palette/effects, GPU R16F adaptive tent blur, byte-exact native-format text/SVG rasterization, atomic node swaps, latest-only queue, and no bitmap fallback.",
);

// --- Rollback: ownership candidata ritirata prima della reidratazione ----------
// Un fault compositing tardivo lascia il candidato hot e i cache transienti
// ancora vivi. Provare prima ad attivare l'originale ricrea il picco che ha
// causato il fault. Il rollback deve congelare, staccare e distruggere il
// candidato, quindi riattivare l'originale usando il suo indice ricalcolato.
{
  const vectorRaster = fs.readFileSync(
    new URL("../src/engine-vector-raster-runtime.ts", import.meta.url),
    "utf8",
  );
  const helper = vectorRaster.slice(
    vectorRaster.indexOf("async function discardVectorRasterCandidateAndRestoreOriginalActive("),
    vectorRaster.indexOf("export async function rasterizeVectorNodeToLayer("),
  );
  const freeze = helper.indexOf("engine.layerPresentationFrozen = true;");
  const selectOriginal = helper.indexOf("engine.layerStack.setActiveIndex(originalIndexBeforeDetach);");
  const detach = helper.indexOf("engine.layerStack.remove(candidateIndex);");
  const unregister = helper.indexOf("engine.layerGpu.delete(candidateLayerId)");
  const destroy = helper.indexOf("destroyLayerGpuResources(engine, registeredGpu)");
  const reactivate = helper.indexOf("await engine.activateLayer(originalIndex, caller);");
  assert.ok(
    freeze >= 0
      && selectOriginal > freeze
      && detach > selectOriginal
      && unregister > detach
      && destroy > unregister
      && reactivate > destroy,
    "freeze/stacco/destroy devono precedere la riattivazione dell'originale",
  );
  assert.doesNotMatch(
    helper,
    /activateLayer\([\s\S]{0,80}candidateIndex/,
    "un indice candidato rimosso non deve raggiungere commitActiveLayerResidency",
  );
  const freezeHelper = helper.slice(
    helper.indexOf("async function freezeVectorRasterPresentationForRollback("),
  );
  assert.match(
    freezeHelper,
    /try \{[\s\S]{0,500}await engine\.waitForIdle\(\);[\s\S]{0,120}\} finally \{[\s\S]{0,500}engine\.layerPresentationFrozen = true;/,
    "anche un drain fallito deve congelare la presentazione in fail-closed",
  );

  const conversion = vectorRaster.slice(
    vectorRaster.indexOf("export async function rasterizeVectorNodeToLayer("),
    vectorRaster.indexOf("export async function rollbackUnpublishedVectorRasterization("),
  );
  const conversionActivation = conversion.indexOf(
    'await engine.activateLayer(previousIndexAfterInsertion, "layer-switch");',
  );
  const conversionSeed = conversion.indexOf("seed = await createLayerColdStorageCandidate(");
  assert.ok(
    conversionActivation >= 0 && conversionSeed > conversionActivation,
    "il seed Undo va catturato dopo il picco transitorio dell'activation",
  );
  assert.ok(
    conversion.indexOf("await freezeVectorRasterPresentationForRollback(engine);") >= 0
      && conversion.indexOf("await freezeVectorRasterPresentationForRollback(engine);")
        < conversion.indexOf("scene.restoreState(originalSceneState);"),
    "un fault post-activation deve drenare il frame valido prima di mutare la scena",
  );
  assert.ok(
    conversion.indexOf("destroyLayerColdStorage(seed);")
      < conversion.indexOf("await discardVectorRasterCandidateAndRestoreOriginalActive("),
    "il seed fallito va liberato prima di reidratare l'originale",
  );

  const unpublished = vectorRaster.slice(
    vectorRaster.indexOf("export async function rollbackUnpublishedVectorRasterization("),
    vectorRaster.indexOf("async function switchActiveForStructuralHistory("),
  );
  assert.ok(
    unpublished.indexOf("await freezeVectorRasterPresentationForRollback(engine);") >= 0
      && unpublished.indexOf("await freezeVectorRasterPresentationForRollback(engine);")
        < unpublished.indexOf("scene.replaceRasterWithVector(action.layerId, action.vectorState);"),
    "un commit History rifiutato deve drenare il frame candidato prima del rollback",
  );
  assert.ok(
    unpublished.indexOf("destroyLayerColdStorage(action.seed);")
      < unpublished.indexOf("await discardVectorRasterCandidateAndRestoreOriginalActive("),
    "un commit History rifiutato deve ritirare il seed prima del rebuild",
  );
  const wrapper = engineSource.slice(
    engineSource.indexOf("  private async rasterizeVectorNode("),
    engineSource.indexOf("  async rasterizeVectorTextNode("),
  );
  assert.match(wrapper, /await rollbackUnpublishedVectorRasterization\(this, action\)/);
  assert.match(
    wrapper,
    /const combined = new Error\([\s\S]{0,300}latchDocumentStateInconsistent\([\s\S]{0,180}combined/,
    "il diagnostico fatale deve conservare errore iniziale e causa del rollback",
  );
}

console.log("Vector rasterize candidate-first rollback verified.");

// --- Race freeze + invalidazione derivata ------------------------------------
// Il completamento asincrono del preview vettoriale puo' accodare un RAF dopo
// prepareActiveLayerForSwitch(). Il drain strutturale puo' coalescere soltanto
// quel ridisegno derivato; qualunque mutazione raster reale resta fail-closed.
{
  const discardStart = engineSource.indexOf(
    "  private discardFrozenDerivedPresentationWork(): boolean {",
  );
  const idleStart = engineSource.indexOf("  async waitForIdle(", discardStart);
  const idleEnd = engineSource.indexOf("\n  resetStrokeRandomSeed()", idleStart);
  assert.ok(
    discardStart >= 0 && idleStart > discardStart && idleEnd > idleStart,
    "drain freeze-aware non delimitabile",
  );
  const discard = engineSource.slice(discardStart, idleStart);
  const idle = engineSource.slice(idleStart, idleEnd);
  for (const authoritativeWork of [
    "pendingStamps.length > 0",
    "pendingBlendBatches.length > 0",
    "clearRequested",
    "lightGlazeSession?.commitRequested",
    "lightGlazeSession?.endRequested",
    "thicknessTailPreviewEligible()",
    "thicknessTailPresentationNeedsRefresh()",
  ]) {
    assert.ok(
      discard.includes(authoritativeWork),
      `il drain congelato non protegge ${authoritativeWork}`,
    );
  }
  assert.match(
    discard,
    /cancelAnimationFrame\(this\.frameRequest\);[\s\S]*this\.frameRequest = null;[\s\S]*this\.displayDirty = false;[\s\S]*this\.presentationCacheNeedsFullRebuild = true;/,
    "il solo frame derivato va coalesciuto nella ricostruzione finale",
  );
  assert.match(
    idle,
    /options\.allowFrozenDerivedPresentation === true[\s\S]*discardFrozenDerivedPresentationWork\(\)[\s\S]*continue;[\s\S]*Presentation is frozen with pending render work/,
    "l'opt-in deve precedere senza sostituire il fail-closed standard",
  );
  const retargetStart = engineSource.indexOf(
    "export async function retargetEffectsWorkingSetInternal(",
  );
  const retargetEnd = engineSource.indexOf(
    "export async function benchmarkEffectsWorkingSet(",
    retargetStart,
  );
  const retarget = engineSource.slice(retargetStart, retargetEnd);
  assert.match(
    retarget,
    /retargetEffectsWorkingSetInternal[\s\S]*allowFrozenDerivedPresentation: caller !== "public"/,
    "il retarget strutturale deve drenare le invalidazioni tardive e quello pubblico no",
  );
  const rebuildStart = engineSource.indexOf("  async rebuildMergedLayerSurfaces(");
  const rebuildEnd = engineSource.indexOf(
    "\n  recordVectorHistoryAction(",
    rebuildStart,
  );
  const rebuild = engineSource.slice(rebuildStart, rebuildEnd);
  assert.match(
    rebuild,
    /rebuildMergedLayerSurfaces\([\s\S]{0,900}layerPresentationFrozen[\s\S]{0,200}caller !== "public"[\s\S]{0,200}waitForIdle\(\{ allowFrozenDerivedPresentation: true \}\)/,
    "anche il gate del compositing deve ricontrollare la race dopo il retarget GPU",
  );
}

console.log("Vector rasterize frozen derived-frame drain verified.");

// --- Nessun frame fra mutazione della scena e ricostruzione -------------------
// `mutateMixedScenePresentation` e' il percorso di **ogni** aggiunta, rimozione
// e modifica vettoriale (testo, SVG, immagine). Muta la scena a presentazione
// viva e la ricostruisce subito dopo: i segmenti di composizione restano stale
// in mezzo, e citano per id livelli e nodi che il frame risolve con lookup che
// lanciano. Oggi regge solo perche' fra le due cose non c'e' nessun `await`,
// quindi il controllo non torna mai al loop di rendering. Basta inserirne uno
// e si riapre esattamente il bug "Livello N assente dallo stack" — con la
// differenza che colpirebbe tutti i vettori, non il solo layer-add.
{
  const vectorText = fs.readFileSync(
    new URL("../src/engine-vector-text-runtime.ts", import.meta.url),
    "utf8",
  );
  const corpo = vectorText.slice(
    vectorText.indexOf("export async function mutateMixedScenePresentation<Result>"),
  );
  const mutazione = corpo.indexOf("const result = mutate(scene);");
  const ricostruzione = corpo.indexOf("await engine.rebuildMergedLayerSurfaces(");
  assert.ok(
    mutazione >= 0 && ricostruzione > mutazione,
    "mutazione o ricostruzione della scena mista non individuate",
  );
  const inMezzo = corpo.slice(mutazione, ricostruzione);
  assert.ok(
    !/\bawait\b/.test(inMezzo),
    "nessun await fra la mutazione della scena e la ricostruzione dei segmenti: "
      + "cederebbe il controllo al loop di rendering con i segmenti stale",
  );
}

console.log("Mixed scene mutation atomicity verified.");

// --- Undo rasterizzazione: identita' stabile e preview testo -----------------
// La posizione del vettore nella scena non dice quale raster fosse attivo: con
// tre raster l'adiacente puo' essere diverso da quello su cui si stava
// dipingendo. L'azione deve conservare l'ID e ripristinare anche l'esclusione
// del testo appena tornato selezionato.
{
  const vectorRaster = fs.readFileSync(
    new URL("../src/engine-vector-raster-runtime.ts", import.meta.url),
    "utf8",
  );
  const historyTypes = fs.readFileSync(
    new URL("../src/engine-history-types.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    historyTypes,
    /interface VectorRasterizeHistoryAction[\s\S]*activeRasterLayerIdBefore: number;/,
    "l'azione deve ricordare il raster attivo prima della conversione",
  );
  assert.match(
    vectorRaster,
    /vectorState,[\s\S]{0,120}activeRasterLayerIdBefore: originalActiveId,/,
    "la conversione deve registrare l'identita' attiva osservata",
  );
  const undo = vectorRaster.slice(
    vectorRaster.indexOf("async function undoVectorRasterization("),
    vectorRaster.indexOf("async function redoVectorRasterization("),
  );
  assert.match(
    undo,
    /const fallbackIndex = engine\.layerStack\.indexOfId\(action\.activeRasterLayerIdBefore\);/,
    "Undo deve cercare il raster originario per ID, non scegliere un adiacente",
  );
  assert.doesNotMatch(
    undo,
    /activeTargetIndex > 0[\s\S]*activeTargetIndex - 1/,
    "la geometria dello stack non e' uno snapshot dello stato attivo",
  );
  assert.match(
    undo,
    /const restoredSelection = scene\.selected;[\s\S]*restoredSelection\.kind === "text"[\s\S]*restoredSelection\.textNodeId/,
    "il testo ripristinato e selezionato deve tornare escluso dalla preview statica",
  );

  // Modello del caso non adiacente riprodotto: il testo sta fra raster 1 e 2,
  // ma prima della conversione era attivo il raster 3.
  const stackDuringRasterization = [1, 4, 2, 3];
  const targetIndex = stackDuringRasterization.indexOf(4);
  const adjacentFallback = stackDuringRasterization[targetIndex - 1];
  const stableFallback = stackDuringRasterization.findIndex((id) => id === 3);
  assert.equal(adjacentFallback, 1, "il modello deve distinguere davvero le due scelte");
  assert.equal(stackDuringRasterization[stableFallback], 3);
}

console.log("Vector rasterize exact active/preview restoration verified.");

// --- Independent semantic axes: GPU ABI and conservative bounds ------------
{
  const runtime = fs.readFileSync(
    new URL("../src/engine-vector-text-runtime.ts", import.meta.url),
    "utf8",
  );
  const meshShader = fs.readFileSync(
    new URL("../src/vector-text-gpu-shader.ts", import.meta.url),
    "utf8",
  );
  const slugShader = fs.readFileSync(
    new URL("../src/vector-text-slug-gpu-shader.ts", import.meta.url),
    "utf8",
  );
  const geometry = fs.readFileSync(
    new URL("../src/engine-geometry.ts", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /upload\[base \+ 12\] = draw\.scaleX \?\? draw\.scale;/);
  assert.match(runtime, /upload\[base \+ 15\] = draw\.scaleY \?\? draw\.scale;/);
  assert.match(runtime, /writeVectorTextGpuBlurSourceUniform[\s\S]*?upload\[base \+ 15\] = 1;/);
  assert.match(meshShader, /scaleAndLocalOffset\.xw/);
  assert.match(slugShader, /scaleAndLocalOffset\.xw/);
  assert.match(geometry, /const scaleX = draw\.scaleX \?\? draw\.scale;/);
  assert.match(geometry, /const scaleY = draw\.scaleY \?\? draw\.scale;/);
  assert.match(geometry, /localOffsetX\) \* scaleX/);
  assert.match(geometry, /localOffsetY\) \* scaleY/);
}

console.log("Semantic independent-axis rendering verified.");
