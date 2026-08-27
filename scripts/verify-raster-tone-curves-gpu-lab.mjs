import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lab = readFileSync(
  new URL("../src/labs/gpu/raster-tone-curves-gpu-test.ts", import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
));

assert.match(lab, /export async function runRasterToneCurvesGpuTest/);
assert.match(lab, /const REQUIRED_DOCUMENT_SIZE = 512 as const/);
assert.match(lab, /const RGBA16F_BYTES_PER_PIXEL = 8/);
assert.match(lab, /import \{ decodeFloat16 \} from "\.\.\/\.\.\/float16"/);
assert.match(lab, /initialStats\.layerFormat === "rgba16float"/);
assert.match(lab, /initialStats\.layerCount === 1/);
assert.match(lab, /!initialStats\.layers\[0\]\?\.hasContent/);
assert.match(lab, /initialHistory\.actionCount === 0/);
assert.match(lab, /initialHistory\.cursor === 0/);
assert.match(lab, /initialHistory\.openEdit === null/);

assert.match(lab, /await engine\.addClippingMaskLayer\(\)/);
assert.match(lab, /clippingParentId === referenceLayerId/);
assert.match(lab, /selectedItem\?\.kind === "raster"/);
assert.match(lab, /readWholeLayer\(engine, 0\)/);
assert.match(lab, /readWholeLayer\(engine, 1\)/);
assert.match(lab, /alphaFixture\.translucent > 0/);
assert.match(lab, /index \+= RGBA16F_BYTES_PER_PIXEL/);
assert.match(lab, /view\.getUint16\(index, true\)/);

assert.equal(
  (lab.match(/engine\.beginRasterToneCurves\(TEST_CURVES\)/g) ?? []).length,
  6,
  "The lab must exercise clipping, imported raster, semantic rejection and explicit SVG rasterization.",
);
assert.match(lab, /await engine\.cancelRasterToneCurves\(\)/);
assert.match(lab, /await engine\.commitRasterToneCurves\(\)/);
assert.match(lab, /await engine\.undo\(\)/);
assert.match(lab, /await engine\.redo\(\)/);
assert.match(lab, /applyCommittedOneAction:[\s\S]{0,180}actionCount \+ 1/);
assert.match(lab, /historyAfterUndo\.cursor === historyAfterApply\.cursor - 1/);
assert.match(lab, /historyAfterRedo\.cursor === historyAfterApply\.cursor/);

assert.match(lab, /cancelRestoredSelectedExact: differingBytes\.cancelSelected === 0/);
assert.match(lab, /const cancelClosedEdit = engine\.getHistoryState\(\)\.openEdit === null/);
assert.match(lab, /applyMatchedPreviewExact: differingBytes\.applyVersusPreview === 0/);
assert.match(lab, /undoRestoredSelectedExact: differingBytes\.undoSelected === 0/);
assert.match(lab, /redoRestoredAppliedExact: differingBytes\.redoSelected === 0/);
assert.match(lab, /previewPreservedAlpha: differingBytes\.previewSelectedAlpha === 0/);
assert.match(lab, /applyPreservedAlpha: differingBytes\.applySelectedAlpha === 0/);
assert.match(lab, /previewLeftReferenceExact: differingBytes\.previewReference === 0/);
assert.match(lab, /applyLeftReferenceExact: differingBytes\.applyReference === 0/);
assert.match(lab, /undoLeftReferenceExact: differingBytes\.undoReference === 0/);
assert.match(lab, /redoLeftReferenceExact: differingBytes\.redoReference === 0/);
assert.match(lab, /clippingRelationPreserved/);
assert.match(lab, /clippedPresentationChangedLive/);
assert.match(lab, /upperPeerStayedExact/);
assert.match(lab, /basePreviewLeftChildAndUpperExact/);
assert.match(lab, /async function selectRasterLayer/);
assert.match(lab, /await engine\.setActiveMixedSceneItem\(item\.key\)/);
assert.match(lab, /await selectRasterLayer\(engine, 0\)/);
assert.match(lab, /engine\.importRasterImageFile\(await createImportedImageFixture\(\)\)/);
assert.match(lab, /engine\.duplicateSelectedLayer\(\)/);
assert.match(lab, /engine\.beginRasterLayerTransform\("affine"\)/);
assert.match(lab, /transformBeforeCurvesChangedPixels/);
assert.match(lab, /curvesDetachedOnlySelectedSource/);
assert.match(lab, /curvesUndoRestoredSourceAndPixels/);
assert.match(lab, /transformAfterCurvesStayedRasterized/);
assert.match(lab, /transformRedoRestoredTransformedPixels/);
assert.match(lab, /dispatchFileSelection\("vectorSvgFileInput", createSvgFixture\(\)\)/);
assert.match(lab, /blockedResult === null/);
assert.match(lab, /svgWasRejectedWithoutMutation/);
assert.match(lab, /__mixedSceneController/);
assert.match(lab, /rasterizeSelectedSvgLayer\(\)/);
assert.match(lab, /curvesChangedRasterizedSvgRgb/);
assert.match(lab, /curvesPreservedRasterizedSvgAlpha/);
assert.match(lab, /engine\.device\.pushErrorScope\("validation"\)/);
assert.match(lab, /gpuErrors\.length === 0/);

assert.match(registry, /\["raster-tone-curves", "GPU test curve raster · 512"\]/);
assert.match(registry, /case "raster-tone-curves"/);
assert.match(registry, /import\(\s*"\.\/gpu\/raster-tone-curves-gpu-test"\s*\)/);
assert.match(registry, /runRasterToneCurvesGpuTest\(engine\)/);
assert.match(registry, /DESTRUCTIVE_GPU_LAB_TIMEOUT_MS/);

assert.equal(
  packageJson.scripts["curves-gpu-lab:verify"],
  "node scripts/verify-raster-tone-curves-gpu-lab.mjs",
);
assert.match(packageJson.scripts["curves:verify"], /curves-gpu-lab:verify/);

console.log("Raster tone curves destructive GPU Lab verification passed.");
