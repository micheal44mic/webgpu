import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lab = readFileSync(
  new URL("../src/labs/gpu/raster-color-balance-gpu-test.ts", import.meta.url),
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

assert.match(lab, /export async function runRasterColorBalanceGpuTest/);
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

assert.match(lab, /rasterColorBalanceShader/);
assert.match(lab, /createShaderModule/);
assert.match(lab, /module\.getCompilationInfo\(\)/);
assert.match(lab, /createComputePipelineAsync/);
assert.match(lab, /entryPoint: "balanceRasterColor"/);
assert.match(lab, /engine\.device\.pushErrorScope\("validation"\)/);
assert.match(lab, /engine\.device\.pushErrorScope\("internal"\)/);
assert.match(lab, /engine\.device\.pushErrorScope\("out-of-memory"\)/);
assert.match(lab, /gpuErrors\.length === 0/);

assert.match(lab, /await engine\.addClippingMaskLayer\(\)/);
assert.match(lab, /clippingParentId === baseLayerId/);
assert.match(lab, /selected\?\.kind === "raster"/);
assert.match(lab, /countTranslucentPixels\(targetBefore\)/);
assert.match(lab, /view\.getUint16\(index, true\)/);
assert.equal(
  (lab.match(/engine\.beginRasterColorBalance\(/g) ?? []).length,
  2,
  "The lab must open one rapid-preview transaction and one isolated Apply transaction.",
);
assert.equal(
  (lab.match(/engine\.updateRasterColorBalance\(/g) ?? []).length,
  2,
  "The lab must issue two same-turn updates to verify latest-wins coalescing.",
);
assert.match(lab, /await waitForLatestPreview\(engine\)/);
assert.match(lab, /await engine\.cancelRasterColorBalance\(\)/);
assert.match(lab, /await engine\.commitRasterColorBalance\(\)/);
assert.match(lab, /await engine\.undo\(\)/);
assert.match(lab, /await engine\.redo\(\)/);

assert.match(lab, /previewChangedTargetRgb: differingBytes\.rapidTargetRgb > 0/);
assert.match(lab, /previewPreservedAlpha: differingBytes\.rapidTargetAlpha === 0/);
assert.match(lab, /rapidLatestWinsExact:/);
assert.match(lab, /rapidVersusIsolatedFinal === 0/);
assert.match(lab, /cancelRestoredTargetExact: differingBytes\.cancelTarget === 0/);
assert.match(lab, /cancelLeftHistoryExact:/);
assert.match(lab, /applyCommittedOneAction:/);
assert.match(lab, /actionCount === historyBeforeApply\.actionCount \+ 1/);
assert.match(lab, /applyMatchedPreviewExact: differingBytes\.applyVersusPreview === 0/);
assert.match(lab, /applyPreservedAlpha: differingBytes\.applyTargetAlpha === 0/);
assert.match(lab, /undoRestoredTargetExact: differingBytes\.undoTarget === 0/);
assert.match(lab, /redoRestoredAppliedExact: differingBytes\.redoTarget === 0/);
assert.match(lab, /baseStayedExact:/);
assert.match(lab, /clippingRelationPreserved/);
assert.match(lab, /clippedPresentationChangedLive/);
assert.match(lab, /clippedPresentationCancelExact/);
assert.match(lab, /clippedPresentationApplyMatchedPreview/);
assert.match(lab, /clippedPresentationUndoExact/);
assert.match(lab, /clippedPresentationRedoExact/);

assert.match(
  registry,
  /\["raster-color-balance", "GPU test bilanciamento colore · 512"\]/,
);
assert.match(registry, /case "raster-color-balance"/);
assert.match(registry, /import\(\s*"\.\/gpu\/raster-color-balance-gpu-test"\s*\)/);
assert.match(registry, /runRasterColorBalanceGpuTest\(engine\)/);
assert.match(registry, /DESTRUCTIVE_GPU_LAB_TIMEOUT_MS/);

assert.equal(
  packageJson.scripts["color-balance-gpu-lab:verify"],
  "node scripts/verify-raster-color-balance-gpu-lab.mjs",
);
assert.match(
  packageJson.scripts["color-balance:verify"],
  /color-balance-gpu-lab:verify/,
);

console.log("Raster Color Balance destructive GPU Lab contract verified.");
