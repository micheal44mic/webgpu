import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lab = readFileSync(
  new URL("../src/labs/gpu/raster-gradient-map-gpu-test.ts", import.meta.url),
  "utf8",
);
const runtime = readFileSync(
  new URL("../src/engine-raster-gradient-map-runtime.ts", import.meta.url),
  "utf8",
);
const shader = readFileSync(
  new URL("../src/raster-gradient-map-shaders.ts", import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);

assert.match(lab, /export async function runRasterGradientMapGpuTest/);
assert.match(lab, /const REQUIRED_DOCUMENT_SIZE = 512 as const/);
assert.match(lab, /const RGBA16F_BYTES_PER_PIXEL = 8/);
assert.match(lab, /import \{ decodeFloat16 \} from "\.\.\/\.\.\/float16"/);
assert.match(lab, /initialStats\.layerFormat === "rgba16float"/);
assert.match(lab, /initialStats\.layerCount === 1/);
assert.match(lab, /!initialStats\.layers\[0\]\?\.hasContent/);
assert.match(lab, /initialHistory\.actionCount === 0/);
assert.match(lab, /initialHistory\.cursor === 0/);
assert.match(lab, /initialHistory\.openEdit === null/);
assert.match(lab, /initialScene\.items\[0\]\?\.kind === "raster"/);

assert.match(lab, /rasterGradientMapShader/);
assert.match(lab, /createShaderModule/);
assert.match(lab, /module\.getCompilationInfo\(\)/);
assert.match(lab, /createComputePipelineAsync/);
assert.match(lab, /entryPoint: "mapRasterGradient"/);
assert.match(lab, /engine\.device\.pushErrorScope\("validation"\)/);
assert.match(lab, /engine\.device\.pushErrorScope\("internal"\)/);
assert.match(lab, /engine\.device\.pushErrorScope\("out-of-memory"\)/);
assert.match(lab, /gpuErrors\.length === 0/);
assert.match(lab, /async function ensureMixedSceneCompositorReady/);
assert.match(lab, /await engine\.ensureOptionalEditorResources\(\)/);
assert.match(lab, /engine\.mixedSceneRasterSegmentBindGroupLayout/);
assert.match(lab, /engine\.mixedSceneTextSegmentBindGroupLayout/);
assert.match(lab, /engine\.mixedScenePresentBindGroupLayout/);
assert.match(lab, /engine\.mixedSceneBackgroundBindGroupLayout/);
assert.match(lab, /await ensureMixedSceneCompositorReady\(engine\)/);

assert.match(lab, /await engine\.addClippingMaskLayer\(\)/);
assert.match(lab, /clippingParentId === clippingBaseLayerId/);
assert.match(lab, /selected\?\.kind === "raster"/);
assert.match(lab, /countTranslucentPixels\(targetBefore\)/);
assert.match(lab, /view\.getUint16\(index, true\)/);
assert.equal(
  (lab.match(/engine\.beginRasterGradientMap\(/g) ?? []).length,
  5,
  "The lab must also open real selected-vector mapping transactions through its helper.",
);
assert.equal(
  (lab.match(/engine\.updateRasterGradientMap\(/g) ?? []).length,
  5,
  "The lab must read all interpolation paths and issue two latest-wins updates.",
);
assert.match(lab, /await waitForLatestPreview\(engine\)/);
assert.match(lab, /const encodedPixels = await readWholeLayer/);
assert.match(lab, /interpolation: "linear-light"/);
assert.match(lab, /const linearPixels = await readWholeLayer/);
assert.match(lab, /interpolation: "perceptual"/);
assert.match(lab, /const perceptualPixels = await readWholeLayer/);
assert.match(lab, /reverse: true/);
assert.match(lab, /const reversedPixels = await readWholeLayer/);
assert.match(lab, /allRgba16fComponentsFinite/);
assert.match(lab, /Number\.isFinite\(decodeFloat16\(view\.getUint16\(index, true\)\)\)/);
assert.match(lab, /interpolationOutputsFinite:/);
assert.match(lab, /interpolationModesDistinct:/);
assert.match(lab, /encodedVersusLinear > 0/);
assert.match(lab, /encodedVersusPerceptual > 0/);
assert.match(lab, /linearVersusPerceptual > 0/);
assert.match(lab, /reverseOutputDistinct: differingBytes\.perceptualVersusReverse > 0/);
assert.match(lab, /interpolationProbeCancelExact:/);
assert.match(lab, /interpolationProbeLeftHistoryExact:/);
assert.match(lab, /await engine\.cancelRasterGradientMap\(\)/);
assert.equal(
  (lab.match(/await engine\.commitRasterGradientMap\(\)/g) ?? []).length,
  3,
  "The lab must commit clipping, imported-source and selected-vector transactions.",
);
assert.equal(
  (lab.match(/applyGradientToActiveRaster\(/g) ?? []).length,
  3,
  "The selected SVG and text must each use the real Gradient Map helper.",
);
assert.match(lab, /await engine\.undo\(\)/);
assert.match(lab, /await engine\.redo\(\)/);

assert.match(lab, /previewChangedTargetRgb: differingBytes\.rapidTargetRgb > 0/);
assert.match(lab, /previewPreservedAlpha: differingBytes\.rapidTargetAlpha === 0/);
assert.match(lab, /previewPreservedBounds: boundsEqual/);
assert.match(lab, /rapidLatestWinsExact:/);
assert.match(lab, /rapidVersusIsolatedFinal === 0/);
assert.match(lab, /cancelRestoredTargetExact: differingBytes\.cancelTarget === 0/);
assert.match(lab, /cancelLeftHistoryExact:/);
assert.match(lab, /applyCommittedOneAction:/);
assert.match(lab, /actionCount === historyBeforeApply\.actionCount \+ 1/);
assert.match(lab, /applyMatchedPreviewExact: differingBytes\.applyVersusPreview === 0/);
assert.match(lab, /applyPreservedAlpha: differingBytes\.applyTargetAlpha === 0/);
assert.match(lab, /applyPreservedBounds:/);
assert.match(lab, /undoRestoredTargetExact: differingBytes\.undoTarget === 0/);
assert.match(lab, /redoRestoredAppliedExact: differingBytes\.redoTarget === 0/);
assert.match(lab, /baseStayedExact:/);
assert.match(lab, /clippingRelationPreserved/);
assert.match(lab, /clippedPresentationChangedLive/);
assert.match(lab, /clippedPresentationCancelExact/);
assert.match(lab, /clippedPresentationApplyMatchedPreview/);
assert.match(lab, /clippedPresentationUndoExact/);
assert.match(lab, /clippedPresentationRedoExact/);

assert.match(lab, /engine\.importRasterImageFile\(await createImportedImageFixture\(\)\)/);
assert.match(lab, /engine\.duplicateSelectedLayer\(\)/);
assert.match(lab, /cloneRasterLayerSource/);
assert.match(lab, /rasterLayerSourcesEqual/);
assert.match(lab, /importedOriginalKeptSource/);
assert.match(lab, /importedDuplicateInheritedSource/);
assert.match(lab, /importedPreviewPreservedAlpha/);
assert.match(lab, /importedPreviewPreservedBounds/);
assert.match(lab, /importedApplyCommittedOneAction/);
assert.match(lab, /importedApplyDetachedOnlySelectedSource/);
assert.match(lab, /importedApplyLeftOriginalExact/);
assert.match(lab, /importedUndoRestoredSourceAndPixels/);
assert.match(lab, /importedRedoDetachedSourceAndPixels/);

assert.match(lab, /dispatchFileSelection\(\s*"vectorSvgFileInput"/);
assert.match(lab, /__mixedSceneController/);
assert.match(lab, /controller\.rasterizeSelectedSvgLayer\(\)/);
assert.match(lab, /controller\.createText\("#d82f72"\)/);
assert.match(lab, /controller\.rasterizeSelectedTextLayer\(\)/);
assert.match(lab, /await engine\.setSceneLayerClipping\(targetKey, true\)/);
assert.match(lab, /await engine\.setSceneLayerClipping\(textKey, true\)/);
assert.match(lab, /svgActiveStats\.layers\[svgActiveStats\.activeLayerIndex\]\?\.id/);
assert.match(lab, /textActiveStats\.layers\[textActiveStats\.activeLayerIndex\]\?\.id/);
assert.match(lab, /svgSelectedOnlyRasterization:/);
assert.match(lab, /svgOtherVectorStayedExact:/);
assert.match(lab, /svgClippingPreserved: svgAfterMap\?\.clippingParentKey === baseKey/);
assert.match(lab, /svgRasterizeAndMapHistorySeparated:/);
assert.match(lab, /svgGradientPreservedAlphaAndBounds:/);
assert.match(lab, /textSelectedOnlyRasterization:/);
assert.match(lab, /textOtherLayersStayedExact:/);
assert.match(lab, /textClippingPreserved: textAfterMap\?\.clippingParentKey === baseKey/);
assert.match(lab, /textRasterizeAndMapHistorySeparated:/);
assert.match(lab, /textGradientPreservedAlphaAndBounds:/);
assert.match(lab, /historyAfterSvgRasterize\.actionCount === historyBeforeSvgRasterize\.actionCount \+ 1/);
assert.match(lab, /svgMap\.historyAfter\.actionCount === svgMap\.historyBefore\.actionCount \+ 1/);
assert.match(lab, /historyAfterTextRasterize\.actionCount === historyBeforeTextRasterize\.actionCount \+ 1/);
assert.match(lab, /textMap\.historyAfter\.actionCount === textMap\.historyBefore\.actionCount \+ 1/);

assert.match(runtime, /storageTexture: \{ access: "write-only", format: profile\.layerFormat \}/);
assert.match(runtime, /requestedSerial: number/);
assert.match(runtime, /encodedSerial: number/);
assert.match(runtime, /filter: "gradient-map"/);
assert.match(runtime, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(shader, /fn mapRasterGradient/);
assert.match(shader, /texture_storage_2d<\$\{profile\.layerFormat\}, write>/);
assert.match(shader, /rasterAdjustmentStraightEncodedToStored/);
assert.match(shader, /rasterAdjustmentFinalizeStored/);

assert.match(
  registry,
  /case "raster-gradient-map": \{[\s\S]{0,180}await this\.#host\.ensureMixedSceneController\(\)[\s\S]{0,180}import\(\s*"\.\/gpu\/raster-gradient-map-gpu-test"\s*\)/,
);
assert.match(registry, /runRasterGradientMapGpuTest\(engine\)/);

console.log("Raster Gradient Map destructive GPU Lab contract verified.");
