import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DESTRUCTIVE_GAUSSIAN_BLUR_CORE_BUILD,
  DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  destructiveGaussianBlurBounds,
  destructiveGaussianBlurKernel,
  destructiveGaussianBlurSigma,
  normalizeDestructiveGaussianBlurRadius,
  unionGaussianBlurRects,
} from "../src/gaussian-blur-core.ts";

assert.equal(
  DESTRUCTIVE_GAUSSIAN_BLUR_CORE_BUILD,
  "destructive-gaussian-blur-core-v1-three-sigma-premultiplied-rgba16float",
);
assert.equal(DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS, 500);
const maximumFilterCacheBytes = (64 + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2) * 8;
const maximumParameterBytes = (
  16 + Math.ceil((DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS + 1) / 4) * 4
) * 4;
assert(maximumFilterCacheBytes <= 16 * 1024, "cache workgroup oltre il budget WebGPU");
assert(maximumParameterBytes <= 16 * 1024, "uniformi kernel oltre il budget WebGPU");
assert.equal(normalizeDestructiveGaussianBlurRadius(Number.NaN), DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS);
assert.equal(normalizeDestructiveGaussianBlurRadius(-12), 0);
assert.equal(normalizeDestructiveGaussianBlurRadius(999), DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS);
assert.equal(destructiveGaussianBlurSigma(12), 4);

for (const radius of [0, 1, 5, 17, DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS]) {
  const kernel = destructiveGaussianBlurKernel(radius);
  assert.equal(kernel.radius, radius);
  assert.equal(kernel.weights.length, radius + 1);
  assert(kernel.weights.every((weight) => Number.isFinite(weight) && weight >= 0));
  const symmetricTotal = kernel.weights[0]
    + kernel.weights.slice(1).reduce((sum, weight) => sum + weight * 2, 0);
  assert(Math.abs(symmetricTotal - 1) < 1e-6, `kernel ${radius}px non normalizzato`);
  for (let index = 1; index < kernel.weights.length; index += 1) {
    assert(kernel.weights[index] <= kernel.weights[index - 1]);
  }
}

function clampDocumentIndex(value, size) {
  return Math.max(0, Math.min(size - 1, value));
}

function gaussianAlphaReference(source, width, height, radius) {
  const kernel = destructiveGaussianBlurKernel(radius);
  const horizontal = new Float64Array(width * height);
  const result = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = source[y * width + x] * kernel.weights[0];
      for (let offset = 1; offset <= kernel.radius; offset += 1) {
        const weight = kernel.weights[offset];
        value += source[y * width + clampDocumentIndex(x - offset, width)] * weight;
        value += source[y * width + clampDocumentIndex(x + offset, width)] * weight;
      }
      horizontal[y * width + x] = value;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = horizontal[y * width + x] * kernel.weights[0];
      for (let offset = 1; offset <= kernel.radius; offset += 1) {
        const weight = kernel.weights[offset];
        value += horizontal[clampDocumentIndex(y - offset, height) * width + x] * weight;
        value += horizontal[clampDocumentIndex(y + offset, height) * width + x] * weight;
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

const solidAlpha = new Float64Array(7 * 7).fill(1);
const solidBlurred = gaussianAlphaReference(solidAlpha, 7, 7, 2);
assert(
  [...solidBlurred].every((alpha) => Math.abs(alpha - 1) < 1e-12),
  "un canvas uniforme deve restare opaco fino ad angoli e bordi",
);

const isolatedAlpha = new Float64Array(9 * 9);
isolatedAlpha[4 * 9 + 4] = 1;
const isolatedBlurred = gaussianAlphaReference(isolatedAlpha, 9, 9, 2);
assert(isolatedBlurred[4 * 9 + 3] > 0, "il blur deve espandersi fuori dal contenuto");
assert(isolatedBlurred[4 * 9 + 2] > 0, "il supporto esterno deve raggiungere il raggio");
assert.equal(isolatedBlurred[4 * 9 + 1], 0, "fuori dal supporto resta trasparente");

assert.deepEqual(
  destructiveGaussianBlurBounds(
    { x: 20, y: 30, width: 40, height: 50 },
    5,
    100,
    100,
  ),
  { x: 15, y: 25, width: 50, height: 60 },
);
assert.deepEqual(
  destructiveGaussianBlurBounds(
    { x: 1, y: 2, width: 10, height: 12 },
    5,
    20,
    20,
  ),
  { x: 0, y: 0, width: 16, height: 19 },
);
assert.deepEqual(
  destructiveGaussianBlurBounds(
    { x: 90, y: 50, width: 10, height: 10 },
    5,
    100,
    60,
  ),
  { x: 85, y: 45, width: 15, height: 15 },
  "Il bordo inferiore di un documento rettangolare deve usare l'altezza, non la larghezza.",
);
assert.deepEqual(
  unionGaussianBlurRects(
    { x: 4, y: 8, width: 10, height: 12 },
    { x: 1, y: 9, width: 8, height: 20 },
  ),
  { x: 1, y: 8, width: 13, height: 21 },
);

const runtime = readFileSync(new URL("../src/engine-gaussian-blur-runtime.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const history = readFileSync(new URL("../src/engine-history-types.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const adjustments = readFileSync(
  new URL("../src/raster-adjustments-controller.ts", import.meta.url),
  "utf8",
);
const canvasInput = readFileSync(
  new URL("../src/canvas-input-controller.ts", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mobileSheet = readFileSync(
  new URL("../src/mobile-gaussian-blur-sheet.ts", import.meta.url),
  "utf8",
);

assert.match(runtime, /format:\s*"rgba16float"/);
assert.match(runtime, /array<vec4<f32>/);
assert.match(runtime, /array<vec2<u32>/);
assert.match(runtime, /pack2x16float/);
assert.match(runtime, /unpack2x16float/);
assert.match(runtime, /maxComputeWorkgroupStorageSize/);
assert.match(runtime, /texture_2d<f32>/);
assert.match(runtime, /texture_storage_2d<rgba16float, write>/);
assert.doesNotMatch(runtime, /rgba8|unorm8|pack4x8|unpack4x8/i);
assert.match(runtime, /immutable source/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /session\.previewFault/);
assert.match(runtime, /transparent-content-clamp-document-edge/);
assert.match(runtime, /clampedDocumentPosition\s*=\s*clamp\(/);
assert.match(runtime, /import \{ DOCUMENT_HEIGHT, DOCUMENT_WIDTH \} from "\.\/engine-limits"/);
assert.match(
  runtime,
  /const DOCUMENT_EXTENT = vec2<i32>\(\$\{DOCUMENT_WIDTH\}, \$\{DOCUMENT_HEIGHT\}\);/,
);
assert.match(runtime, /parameterUploadU32\[word \+ 15\]\s*=\s*0/);
assert.match(
  runtime,
  /destructiveGaussianBlurBounds\([\s\S]{0,180}DOCUMENT_WIDTH,\s*DOCUMENT_HEIGHT,/,
  "Gaussian Blur deve ritagliare il supporto con entrambi gli assi documento.",
);
assert.doesNotMatch(
  runtime,
  /engine\.layerSize|\bLAYER_SIZE\b|parameterUploadU32\[word \+ 15\]\s*=\s*documentSize/,
  "Gaussian Blur non deve ricostruire un canvas quadrato da un unico lato.",
);

const restore = runtime.slice(
  runtime.indexOf("async function restoreOriginalPixels("),
  runtime.indexOf("export async function beginRasterGaussianBlur("),
);
assert.match(restore, /copyTextureToTexture/);
assert.match(restore, /session\.sourceTexture/);
assert.doesNotMatch(restore, /flushPreview/,
  "Annulla non deve dipendere dal percorso di preview che può essere guasto");

const commit = runtime.slice(
  runtime.indexOf("export async function commitRasterGaussianBlur("),
);
assert.match(commit, /kind:\s*"raster-filter"/);
assert.match(commit, /filter:\s*"gaussian-blur"/);
assert.match(commit, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(commit, /createLayerColdStorageCandidate\([\s\S]{0,260}"history"/);
assert.match(commit, /precision:\s*"rgba16float-f32-accumulation"/);
assert.match(history, /interface RasterFilterHistoryAction/);
assert.match(history, /transparent-content-clamp-document-edge/);
assert.match(engine, /activeRasterGaussianBlurSession/);

assert.match(html, /id="mobileGaussianBlurOpen"/);
assert.match(html, /id="mobileGaussianBlurSheet"/);
assert.doesNotMatch(html, /id="desktopGaussianBlur|id="rasterGaussianBlurSection"/);
assert.doesNotMatch(html, /id="rasterGaussianBlurDialog"/);
const mobileTile = html.slice(
  html.indexOf('id="mobileGaussianBlurOpen"'),
  html.indexOf("</button>", html.indexOf('id="mobileGaussianBlurOpen"')),
);
assert.doesNotMatch(mobileTile, /\bdisabled\b/);
assert.match(adjustments, /engine\.beginRasterGaussianBlur/);
assert.match(adjustments, /engine\.commitRasterGaussianBlur/);
assert.match(adjustments, /engine\.cancelRasterGaussianBlur/);
assert.match(adjustments, /history\.openEdit === "gaussian-blur"/);
assert.match(main, /function canvasViewOperationLocked\(\)/);
assert.match(main, /rasterAdjustmentsController\?\.allowsCanvasViewOperation/);
assert.match(
  adjustments,
  /isDestructivePreviewNavigationActive\([\s\S]*?history\.openEdit === "gaussian-blur"/,
);
assert.match(canvasInput, /destructivePreviewTouchNavigationRequested/);
assert.match(canvasInput, /enterTouchNavigation\(\)/);
assert.match(canvasInput, /options\.viewOperationLocked\(\) \|\| activePointerId !== null/);
assert.match(canvasInput, /nextGesture\.contactCount >= 2 && previousGesture\.contactCount >= 2/);
assert.match(adjustments, /resetGaussianBlurControls/);
assert.match(adjustments, /DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS/);
assert.match(adjustments, /openGaussianBlur\(gaussianBlur\.openButton\)/);
assert.doesNotMatch(main, /desktopGaussianBlur/);
assert.match(mobileSheet, /resolveMobileBottomSheetDrag/);
assert.match(mobileSheet, /onRequestCancel/);
assert.match(mobileSheet, /MOBILE_GAUSSIAN_BLUR_PEEK_VIEWPORT_RATIO = 0\.26/);
assert.match(html, /mobile-stroke-sheet-content mobile-gaussian-blur-shell/);
assert.match(html, /id="mobileGaussianBlurHeader" class="mobile-stroke-header"/);
assert.match(html, /class="mobile-stroke-title">Gaussian Blur/);
assert.match(html, /class="mobile-stroke-width-control" for="mobileGaussianBlurRadius"/);
assert.match(html, /id="mobileGaussianBlurRadius"[\s\S]{0,160}max="500"/);
assert.match(html, /id="mobileGaussianBlurStatus"[\s\S]{0,120}class="visually-hidden"/);
assert.match(html, /id="mobileGaussianBlurCancel" type="button">Cancel/);
assert.match(html, /id="mobileGaussianBlurApply" class="is-primary" type="button">Apply/);
assert.doesNotMatch(html, /mobile-gaussian-blur-live/);
assert.doesNotMatch(html, /Live · 16-bit|Anteprima live RGBA16F/);
assert.doesNotMatch(main, /accumulo f32 su raster RGBA16F|Anteprima live \$\{preview\.radius/);

console.log("Destructive 16-bit Gaussian Blur document-edge verification passed.");
