import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLOR_RANGE_SELECTION_STRATEGY,
  LASSO_SELECTION_STRATEGY,
  MAGIC_WAND_SELECTION_STRATEGY,
  PIXEL_SELECTION_MASK_STRATEGY,
  SELECTION_LASSO_SPAN_BUFFER_BYTES,
  SELECTION_LAYER_HEIGHT,
  SELECTION_LAYER_SIZE,
  SELECTION_LAYER_WIDTH,
  SELECTION_MAX_LASSO_POINTS,
  SELECTION_MAX_LASSO_SPANS,
  SELECTION_OVERLAY_STRATEGY,
  SELECTION_TILE_GRID_SIZE,
  SELECTION_TILE_HEIGHT,
  SELECTION_TILE_SIZE,
  SELECTION_TILE_WIDTH,
  buildLassoSpans,
  countSelectionTiles,
  currentSelectionDocumentMetrics,
  emptyPixelSelectionState,
  normalizeMagicWandTolerance,
  normalizeSelectionCombineMode,
  normalizeSelectionMethod,
  normalizeSelectionTolerance,
  selectionCombineModeCode,
  selectionColorsMatch,
  selectionHexToStraightSrgb,
} from "../src/selection-core.ts";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_TILE_HEIGHT,
  DOCUMENT_TILE_WIDTH,
  DOCUMENT_WIDTH,
  LAYER_SIZE,
} from "../src/engine-limits.ts";
import { colorMatchShaderHelpers } from "../src/color-match-core.ts";
import { selectionComputeShader as resolvedSelectionComputeShader } from "../src/selection-shaders.ts";
import { readEngineSource } from "./engine-source.mjs";

assert.equal(
  PIXEL_SELECTION_MASK_STRATEGY,
  "document-wide-gpu-r32-bitmask-replace-add-subtract-invert-live-color-v2",
);
assert.equal(
  MAGIC_WAND_SELECTION_STRATEGY,
  "fill-ccl-reused-4-connected-color-family-contrast-capped-v2",
);
assert.equal(
  COLOR_RANGE_SELECTION_STRATEGY,
  "global-straight-srgb-alpha-hue-family-range-v2",
);
assert.equal(LASSO_SELECTION_STRATEGY, "cpu-even-odd-pixel-center-spans-gpu-bitmask-v1");
assert.equal(SELECTION_OVERLAY_STRATEGY, "separate-transparent-webgpu-mask-overlay-v1");
assert.equal(SELECTION_LAYER_SIZE, LAYER_SIZE);
assert.equal(SELECTION_LAYER_WIDTH, DOCUMENT_WIDTH);
assert.equal(SELECTION_LAYER_HEIGHT, DOCUMENT_HEIGHT);
assert.equal(SELECTION_LAYER_SIZE, Math.max(SELECTION_LAYER_WIDTH, SELECTION_LAYER_HEIGHT));
const selectionMetrics = currentSelectionDocumentMetrics();
assert.equal(selectionMetrics.wordsPerRow, Math.ceil(SELECTION_LAYER_WIDTH / 32));
assert.equal(selectionMetrics.maskWords, selectionMetrics.wordsPerRow * SELECTION_LAYER_HEIGHT);
assert.equal(selectionMetrics.maskBytes, selectionMetrics.maskWords * 4);
assert.equal(SELECTION_TILE_GRID_SIZE, 16);
assert.equal(SELECTION_TILE_SIZE, 256);
assert.equal(SELECTION_TILE_WIDTH, DOCUMENT_TILE_WIDTH);
assert.equal(SELECTION_TILE_HEIGHT, DOCUMENT_TILE_HEIGHT);
assert.equal(SELECTION_TILE_SIZE, Math.max(SELECTION_TILE_WIDTH, SELECTION_TILE_HEIGHT));
assert.equal(selectionMetrics.maskBytes, 2 * 1024 * 1024);
assert.equal(SELECTION_LASSO_SPAN_BUFFER_BYTES, 1024 * 1024);
assert.equal(SELECTION_MAX_LASSO_POINTS, 8_192);
assert.equal(SELECTION_MAX_LASSO_SPANS, 65_536);
assert(selectionMetrics.residentBufferBytes >= 7 * 1024 * 1024);
assert(selectionMetrics.residentBufferBytes < 7.01 * 1024 * 1024);
const portraitSelectionMetrics = currentSelectionDocumentMetrics(1080, 1920);
assert.equal(portraitSelectionMetrics.wordsPerRow, 34);
assert.equal(portraitSelectionMetrics.maskWords, 34 * 1920);
assert.equal(portraitSelectionMetrics.tileWidth, 68);
assert.equal(portraitSelectionMetrics.tileHeight, 120);

assert.equal(normalizeSelectionTolerance(-1), 0);
assert.equal(normalizeSelectionTolerance(0), 0);
assert.equal(normalizeSelectionTolerance(32), 32 / 255);
assert.equal(normalizeSelectionTolerance(255), 1);
assert.equal(normalizeSelectionTolerance(300), 1);
assert.equal(normalizeMagicWandTolerance(32), 32 / 255);
assert.equal(normalizeMagicWandTolerance(255), 0.25);
assert.throws(() => normalizeSelectionTolerance(Number.NaN));
assert.throws(() => normalizeSelectionTolerance(Number.POSITIVE_INFINITY));
assert.deepEqual(selectionHexToStraightSrgb("#000000"), [0, 0, 0, 1]);
assert.deepEqual(selectionHexToStraightSrgb("ff8040"), [1, 128 / 255, 64 / 255, 1]);
assert.throws(() => selectionHexToStraightSrgb("#fff"));
assert.equal(
  selectionColorsMatch([0, 0, 0, 1], [0, 1, 0, 1], 255),
  false,
  "maximum Color Range must not include neutral black with green",
);
assert.equal(selectionColorsMatch([0, 0, 0, 1], [0, 0.2, 0, 1], 255), false);
assert.equal(selectionColorsMatch([0, 0.2, 0, 1], [0, 1, 0, 1], 255), true);
assert.equal(selectionColorsMatch([1, 0, 0, 1], [0, 1, 0, 1], 255), false);
assert.equal(selectionColorsMatch([0, 0, 0, 1], [1, 1, 1, 1], 255), false);
assert.equal(selectionColorsMatch([0, 1, 0, 0], [0, 1, 0, 1], 255), false);
assert.equal(selectionColorsMatch([0, 1, 0, 0.01], [0, 1, 0, 1], 0), true);
assert.equal(selectionColorsMatch([8 / 255, 1, 0, 1], [0, 1, 0, 1], 0), false);
assert.equal(selectionColorsMatch([0, 1, 0, 1], [0, 1, 0, 1], 0), true);
assert.equal(normalizeSelectionMethod("magic-wand"), "magic-wand");
assert.equal(normalizeSelectionMethod("lasso"), "lasso");
assert.equal(normalizeSelectionMethod("color-range"), "color-range");
assert.throws(() => normalizeSelectionMethod("rectangle"));
assert.equal(normalizeSelectionCombineMode("replace"), "replace");
assert.equal(normalizeSelectionCombineMode("add"), "add");
assert.equal(normalizeSelectionCombineMode("subtract"), "subtract");
assert.throws(() => normalizeSelectionCombineMode("intersect"));
assert.deepEqual(
  ["replace", "add", "subtract"].map(selectionCombineModeCode),
  [0, 1, 2],
);
assert.equal(countSelectionTiles(Uint32Array.from([0, 1, 0x80000001])), 3);
assert.deepEqual(emptyPixelSelectionState(7), {
  selectedPixels: 0,
  activeTiles: 0,
  bounds: null,
  revision: 7,
});

function unpackSpans(raster) {
  const result = [];
  for (let index = 0; index < raster.packedSpans.length; index += 4) {
    const [y, startX, endX] = raster.packedSpans.slice(index, index + 3);
    for (let x = startX; x < endX; x += 1) result.push(`${x},${y}`);
  }
  return result.sort();
}

const rectangle = [
  { x: 1, y: 1 },
  { x: 4, y: 1 },
  { x: 4, y: 4 },
  { x: 1, y: 4 },
];
const rectangleRaster = buildLassoSpans(rectangle, 8);
assert.equal(rectangleRaster.pointCount, 4);
assert.equal(rectangleRaster.spanCount, 3);
assert.deepEqual(rectangleRaster.bounds, { x: 1, y: 1, width: 3, height: 3 });
assert.deepEqual(unpackSpans(rectangleRaster), [
  "1,1", "1,2", "1,3",
  "2,1", "2,2", "2,3",
  "3,1", "3,2", "3,3",
].sort());
assert.deepEqual(
  unpackSpans(buildLassoSpans([...rectangle].reverse(), 8)),
  unpackSpans(rectangleRaster),
  "L'orientamento del lazo non deve cambiare la regola even-odd.",
);
assert.deepEqual(
  unpackSpans(buildLassoSpans([
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ], 4)),
  ["0,0", "0,1", "1,0", "1,1"],
  "Gli span devono essere ritagliati ai limiti del layer.",
);
assert.deepEqual(
  unpackSpans(buildLassoSpans([
    { x: -2, y: -2 },
    { x: 6, y: -2 },
    { x: 6, y: 4 },
    { x: -2, y: 4 },
  ], 4, 2)),
  ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1", "3,0", "3,1"],
  "Il ritaglio del lazo deve rispettare larghezza 4 e altezza 2 indipendenti.",
);
assert.equal(buildLassoSpans([{ x: 1, y: 1 }, { x: 2, y: 2 }], 8).spanCount, 0);
assert.throws(() => buildLassoSpans([{ x: Number.NaN, y: 0 }], 8));
assert.throws(() => buildLassoSpans(rectangle, 0));
assert.throws(() => buildLassoSpans(
  Array.from({ length: SELECTION_MAX_LASSO_POINTS + 1 }, (_, index) => ({
    x: index,
    y: index,
  })),
  8,
));

const brushEngine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const engine = readEngineSource();
const runtime = readFileSync(new URL("../src/engine-selection-runtime.ts", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/selection-renderer.ts", import.meta.url), "utf8");
const shader = readFileSync(new URL("../src/selection-shaders.ts", import.meta.url), "utf8");
const clipShader = readFileSync(new URL("../src/selection-clip-shaders.ts", import.meta.url), "utf8");
const originalBrushShaders = readFileSync(new URL("../src/shaders.ts", import.meta.url), "utf8");
const fillRenderer = readFileSync(new URL("../src/fill-renderer.ts", import.meta.url), "utf8");
const fillShader = readFileSync(new URL("../src/fill-shaders.ts", import.meta.url), "utf8");
const fillRuntime = readFileSync(new URL("../src/engine-fill-runtime.ts", import.meta.url), "utf8");
const layerRuntime = readFileSync(new URL("../src/engine-layer-runtime.ts", import.meta.url), "utf8");
const resourceSetup = readFileSync(new URL("../src/engine-resource-setup.ts", import.meta.url), "utf8");
const reports = readFileSync(new URL("../src/engine-reports.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const canvasTool = readFileSync(
  new URL("../src/canvas-tool-controller.ts", import.meta.url),
  "utf8",
);
const canvasInput = readFileSync(
  new URL("../src/canvas-input-controller.ts", import.meta.url),
  "utf8",
);
const labOperations = readFileSync(
  new URL("../src/labs/engine-lab-operations.ts", import.meta.url),
  "utf8",
);
const humanLab = readFileSync(
  new URL("../src/labs/human-stroke-lab.ts", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

for (const entryPoint of [
  "selectGlobalColor",
  "rasterizeLassoSpans",
  "combineExternalMask",
  "invertSelection",
  "translateExternalMask",
  "summarizeSelection",
]) {
  assert(shader.includes(`fn ${entryPoint}`), `entry point WGSL mancante: ${entryPoint}`);
}
assert(shader.includes("textureLoad(sourceLayer"));
assert(colorMatchShaderHelpers.includes("fn globalStraightSrgbColorsMatch("));
assert(
  !/\btarget\s*:/.test(colorMatchShaderHelpers),
  "WGSL reserves `target`; using it as a parameter makes both Fill and Selection fail prewarm.",
);
assert(shader.includes("${colorMatchShaderHelpers}"));
assert(resolvedSelectionComputeShader.includes("fn globalStraightSrgbColorsMatch("));
assert(!resolvedSelectionComputeShader.includes("${colorMatchShaderHelpers}"));
assert(shader.includes("let matches = globalStraightSrgbColorsMatch("));
assert(!shader.includes("let delta = abs(source - uniforms.targetColor)"));
assert(shader.includes("atomicOr(&selectionMask[wordIndex], candidate)"));
assert(shader.includes("atomicAnd(&selectionMask[wordIndex], ~candidate)"));
assert(shader.includes("~externalMask[wordIndex] & validMask"));
assert(shader.includes("fn selectedInScreenPixel(screen: vec2<f32>) -> bool"));
assert(shader.includes("screenToLayerFloat(screen + vec2<f32>(-0.5, -0.5))"));
assert(shader.includes("selectionMetadata"));
assert(shader.includes("selectionOffset: vec2<f32>"));
assert(shader.includes("overlay.viewCenter + layerOffset - overlay.selectionOffset"));
assert(shader.includes("activeTileFound"));
assert(shader.includes("anySelectedInLayerBounds(minimum, maximum)"));
assert(shader.includes("return vec4<f32>(vec3<f32>(0.16, 0.48, 1.0) * alpha, alpha)"));
assert(shader.includes("fn wordsPerRow() -> u32"));
assert(shader.includes("return (uniforms.size.x + 31u) / 32u;"));
assert(shader.includes("fn tileExtent() -> vec2<u32>"));
assert(shader.includes("let tileSize = tileExtent();"));
assert(!shader.includes("const LAYER_EXTENT"));
assert.doesNotMatch(shader, /\bSELECTION_LAYER_SIZE\b|\bSELECTION_TILE_SIZE\b/);

assert(renderer.includes("this.colorPreviewBaseMask"));
assert(renderer.includes("this.colorPreviewActive ? this.colorPreviewBaseMask : this.frontMask"));
assert(renderer.includes("encoder.clearBuffer(this.backMask)"));
assert(renderer.includes("this.publishBackMask()"));
assert(renderer.includes("async invertSelection()"));
assert(renderer.includes("async translateSelection("));
assert(renderer.includes('alphaMode: "premultiplied"'));
assert(renderer.includes("this.overlayContext.getCurrentTexture().createView()"));
assert(renderer.includes("this.metadataReadback.mapAsync"));
assert(renderer.includes("{ buffer: this.metadataBuffer, size: SELECTION_METADATA_BYTES }"));
const externalStart = renderer.indexOf("  async combineExternalMask(");
const externalEnd = renderer.indexOf("  clearSelection(): void", externalStart);
assert(externalStart >= 0 && externalEnd > externalStart, "Sezione combineExternalMask disallineata.");
const externalSection = renderer.slice(externalStart, externalEnd);
assert(externalSection.includes("this.prepareBackMask(encoder, combineMode)"));
assert(externalSection.includes("this.combinePipeline"));

assert(clipShader.includes('"separate-fragment-storage-mask-pipelines-history-snapshot-v1"'));
assert(clipShader.includes("@group(1) @binding(0) var<storage, read> pixelSelectionMask"));
assert(clipShader.includes('"  if (!pixelSelectionContains(input.position)) { discard; }\\n"'));
for (const functionName of [
  "circleCoverage",
  "shapeCoverage",
  "occupiedShapeCoverage",
  "circleGrainCoverage",
  "shapeGrainCoverage",
  "occupiedShapeGrainCoverage",
]) {
  const functionStart = originalBrushShaders.indexOf(`fn ${functionName}(`);
  const functionEnd = originalBrushShaders.indexOf("\n}", functionStart);
  const section = originalBrushShaders.slice(functionStart, functionEnd);
  const returnCoverage = section.indexOf("return coverage;");
  const lastDerivativeOrSample = Math.max(
    section.lastIndexOf("fwidth(", returnCoverage),
    section.lastIndexOf("dpdx(", returnCoverage),
    section.lastIndexOf("dpdy(", returnCoverage),
    section.lastIndexOf("textureSample", returnCoverage),
  );
  assert(functionStart >= 0 && functionEnd > functionStart, `${functionName}: sezione WGSL mancante.`);
  assert(returnCoverage > lastDerivativeOrSample, `${functionName}: derivate/campionamento dopo il return.`);
}
assert(clipShader.includes("floor(fragmentPosition.xy + brush.renderTargetOrigin)"));
assert(clipShader.includes("result.lastIndexOf(returnMarker, functionEnd)"));
assert(resourceSetup.includes("selectionMaskBindGroupLayout"));
assert(layerRuntime.includes("const selectionPipelineByBase = new Map"));
assert(layerRuntime.includes("selectionPipelineByBase.set(variant.base, selectedPipeline)"));
assert(layerRuntime.includes("fragmentModule: engine.selectionBrushShaderModule"));
assert(layerRuntime.includes("fragmentModule: engine.selectionTexturizedGrainShaderModule"));

assert(runtime.includes("export function clipPaintDirtyRectToPixelSelection("));
assert(runtime.includes("const snapshot = replayBatch?.selectionMask ?? null"));
assert(runtime.includes("if (replayBatch && !snapshot) return { ...dirtyRect }"));
assert(runtime.includes("const tileMask = snapshot?.tileMask ?? engine.pixelSelectionTileMask"));
assert(runtime.includes("export function bindPaintPipelineWithPixelSelection("));
assert.match(
  runtime,
  /if \(!historySnapshot && !usesLiveSelection\) \{\s*pass\.setPipeline\(basePipeline\);\s*return;/,
  "Senza selezione Paint deve usare direttamente la pipeline autorevole precedente.",
);
assert(runtime.includes("engine.selectionPipelineByBase.get(basePipeline)"));
assert(runtime.includes("historySnapshot?.gpuSlice.buffer ?? engine.selectionRenderer?.maskBuffer"));
assert(runtime.includes("engine.selectionHistoryMasksByRevision.get(revision)"));
assert(runtime.includes("engine.selectionHistoryMasksByRevision.set(revision, snapshot)"));
assert(runtime.includes("Math.floor(left / SELECTION_TILE_WIDTH)"));
assert(runtime.includes("Math.floor(top / SELECTION_TILE_HEIGHT)"));
assert(runtime.includes("tileX * SELECTION_TILE_WIDTH"));
assert(runtime.includes("tileY * SELECTION_TILE_HEIGHT"));
assert.doesNotMatch(runtime, /engine\.layerSize|\bSELECTION_TILE_SIZE\b|\bSELECTION_LAYER_SIZE\b/);
assert(renderer.includes("unsigned[0] = this.metrics.layerWidth"));
assert(renderer.includes("unsigned[1] = this.metrics.layerHeight"));
assert(renderer.includes("async reconfigureDocument("));
assert(renderer.includes("currentSelectionDocumentMetrics(width, height)"));
assert(renderer.includes("this.metrics = nextMetrics"));
assert(renderer.includes("previousFrontMask.destroy()"));
assert.doesNotMatch(renderer, /\bSELECTION_LAYER_SIZE\b|\bSELECTION_TILE_SIZE\b/);

assert(fillRenderer.includes("getAnalyzedSelectionMaskBuffer(): GPUBuffer"));
assert(runtime.includes("normalizeMagicWandTolerance(tolerance)"));
assert(fillShader.includes("${colorMatchShaderHelpers}"));
assert(fillShader.includes("export const fillSelectionIntersectionShader"));
assert(fillShader.includes("fillMask[global.x] = fillMask[global.x] & selectionMask[global.x]"));
assert(fillRenderer.includes("if (!selectionMask) {"));
assert(fillRenderer.includes("this.selectionIntersectionPipeline"));
assert(fillRenderer.includes("The fill area does not intersect the active Pixel Selection."));
assert(fillRuntime.includes("engine.selectionRenderer?.maskBuffer ?? null"));
assert.match(fillRuntime, /linearColor,\s+session\.selectionMask,/);
assert(runtime.includes("fillRenderer.getAnalyzedSelectionMaskBuffer()"));
assert(runtime.includes("fillRenderer.setSourceSamplingView(engine.layerSamplingView)"));
assert(runtime.includes("renderer.setSourceSamplingView(engine.layerSamplingView)"));
assert(!runtime.includes("resolveFillSource"));
assert.match(
  runtime,
  /buildLassoSpans\(\s*layerPoints,\s*engine\.documentWidth,\s*engine\.documentHeight,?\s*\)/,
);
assert(runtime.includes("selectionBusy = true"));
assert(runtime.includes("SELECTION_RENDERER_IDLE_RELEASE_MS = 1_500"));
assert(runtime.includes("engine.selectionRenderer?.destroy()"));
assert(runtime.includes("engine.device.queue.onSubmittedWorkDone()"));
assert(renderer.includes("const selectionGpuPrograms = new WeakMap<"));
assert(renderer.includes("Map<GPUTextureFormat, Promise<SelectionGpuProgram>>"));
assert(renderer.includes("const cached = programsByFormat.get(overlayFormat)"));
assert(renderer.includes("const program = await getSelectionGpuProgram(this.device, this.overlayFormat)"));
assert.equal(
  renderer.match(/createShaderModule\(/g)?.length,
  2,
  "Selection shader modules must be created only by the device-session program cache.",
);
assert.equal(
  renderer.match(/createComputePipelineAsync\(/g)?.length,
  2,
  "Selection base and optional compute pipelines must be created only by the device-session caches.",
);
const selectionBaseProgramSource = renderer.slice(
  renderer.indexOf("async function createSelectionGpuProgram("),
  renderer.indexOf("function getSelectionOptionalComputePipeline("),
);
assert(selectionBaseProgramSource.includes('"combineExternalMask"'));
assert(selectionBaseProgramSource.includes('"summarizeSelection"'));
for (const deferredEntryPoint of [
  "selectGlobalColor",
  "rasterizeLassoSpans",
  "invertSelection",
  "translateExternalMask",
]) {
  assert(
    !selectionBaseProgramSource.includes(`"${deferredEntryPoint}"`),
    `${deferredEntryPoint} must remain outside the Magic Wand base program.`,
  );
}
assert(renderer.includes("optionalComputePipelines.get(entryPoint)"));
assert(renderer.includes("optionalComputePipelines.set(entryPoint, pending)"));
const selectionDestroyStart = renderer.indexOf("  destroy(): void");
const selectionDestroyEnd = renderer.indexOf("  private createComputeBindGroup", selectionDestroyStart);
assert(selectionDestroyStart >= 0 && selectionDestroyEnd > selectionDestroyStart);
const selectionDestroySection = renderer.slice(selectionDestroyStart, selectionDestroyEnd);
assert(selectionDestroySection.includes("this.frontMask.destroy()"));
assert(selectionDestroySection.includes("this.metadataReadback.destroy()"));
assert.doesNotMatch(
  selectionDestroySection,
  /selectionGpuPrograms|Pipeline\s*=\s*null|Module\s*=\s*null/,
  "Idle cleanup must release document buffers without evicting the session program.",
);
assert(runtime.includes("engine.selectionOverlayFrameRequest = requestAnimationFrame"));
assert(runtime.includes("reportSelectionPresentationError"));
assert(runtime.includes("notifyPixelSelectionChange(engine, state)"));
assert(runtime.includes("function notifySelectionStatusBestEffort("));
assert.equal(
  runtime.match(/notifySelectionStatusBestEffort\(engine,/g)?.length,
  4,
  "Ogni notifica di successo post-commit deve restare best-effort.",
);
assert(!runtime.includes('engine.callbacks.onStatus?.(selectionStatus(state, totalMs), "ok")'));
assert(engine.includes("selectionRendererMiB"));
assert(engine.includes("capturePaintSelectionHistoryMask(this, historyActionId)"));
assert(
  engine.indexOf("capturePaintSelectionHistoryMask(this, historyActionId)")
    < engine.indexOf("this.history.reserveActionId()", engine.indexOf("capturePaintSelectionHistoryMask")),
  "La mask Paint deve essere archiviata prima che l'azione possa sottomettere pixel.",
);
assert.equal(
  brushEngine.match(/bindPaintPipelineWithPixelSelection\(this, /g)?.length,
  4,
  "Tutti e quattro i renderer Paint devono scegliere la variante selezionata.",
);
assert.equal(
  brushEngine.match(/clipPaintDirtyRectToPixelSelection\(/g)?.length,
  4,
  "Glaze, Paint ordinario e i percorsi iniziale/rebuild della preview Quick Line devono restringere dirty rect e scissor.",
);
assert.doesNotMatch(
  brushEngine,
  /const incrementalPreview[\s\S]{0,160}pixelSelectionState/,
  "La selezione pixel non deve disattivare l'append incrementale della gomma.",
);
assert.match(
  brushEngine,
  /if \(this\.pixelSelectionState\.selectedPixels > 0\) \{\s+this\.adaptivePreviewCandidates\.length = 0/,
);
assert(brushEngine.includes("Blend does not modify a pixel selection"));
assert(brushEngine.includes("Clear affects the entire layer. Deselect first"));
assert(labOperations.includes("Deseleziona i pixel prima del benchmark Paint canonico."));
assert(humanLab.includes("Deseleziona i pixel prima di riprodurre il tratto canonico."));

const hotPathStart = brushEngine.indexOf("  submitImmediate(");
const hotPathEnd = brushEngine.indexOf("  private packThicknessTailStamps(");
assert(hotPathStart >= 0, "Marcatore iniziale del percorso caldo Paint mancante.");
assert(hotPathEnd > hotPathStart, "Sezione del percorso caldo Paint disallineata.");
const hotPath = brushEngine.slice(hotPathStart, hotPathEnd);
assert(hotPath.length > 1_000 && hotPath.length < 250_000);
assert(!hotPath.includes("selectionRenderer"));
assert(!hotPath.includes("pixelSelectionState"));
assert(!hotPath.includes("selectionMask"));

assert(canvasTool.includes('this.activeCanvasTool === "selection"'));
assert(canvasInput.includes('pointerMode === "selection-lasso"'));
assert(canvasInput.includes("engine.selectConnectedAtClientPoint("));
assert(main.includes("engine.selectPixelsByColor("));
assert(canvasInput.includes("engine.selectPixelsByClientLasso("));
assert(canvasTool.includes("private configurationRevision = 0"));
assert(canvasTool.includes("configurationRevision !== this.configurationRevision"));
assert(canvasTool.includes('this.configure("selection", false, true)'));
assert(canvasInput.includes('canvas.addEventListener("keydown", handleCanvasKeydown'));
assert(canvasInput.includes("selectionKeyboardLassoActive"));
assert(canvasInput.includes('event.key === "ArrowLeft"'));
assert(canvasInput.includes('event.code === "Space"'));
assert(html.includes('data-mobile-tool-sheet="selection"'));
for (const id of [
  "mobileSelectionMethod",
  "mobileSelectionTolerance",
  "mobileSelectionColor",
  "mobileSelectionReplace",
  "mobileSelectionAdd",
  "mobileSelectionSubtract",
  "mobileSelectionInvert",
  "mobileSelectionClear",
  "rasterSelectionOverlayCanvas",
  "rasterSelectionGestureCanvas",
  "gpuMemorySelection",
]) {
  assert(html.includes(`id="${id}"`), `controllo HTML mancante: ${id}`);
}
assert(styles.includes("#rasterSelectionOverlayCanvas"));
assert(styles.includes('.mobile-tool-segmented button[aria-pressed="true"]'));
assert(html.includes('id="gpuCanvas" tabindex="-1"'));
assert(canvasTool.includes("canvasKeyboardEnabled ? 0 : -1"));
assert(main.includes("canvasToolSettingsController.selectionSnapshot()"));
assert(main.includes("requestColorRangePreview()"));
assert(main.includes("engine.invertPixelSelection()"));
assert(!main.includes('rangeValue("selectionTolerance")'));
assert(canvasTool.includes('canvas.removeAttribute("aria-keyshortcuts")'));

console.log("Pixel selection contract verification passed.");
