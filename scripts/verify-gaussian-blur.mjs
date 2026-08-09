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
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mobileSheet = readFileSync(
  new URL("../src/mobile-gaussian-blur-sheet.ts", import.meta.url),
  "utf8",
);

assert.match(runtime, /format:\s*"rgba16float"/);
assert.match(runtime, /array<vec4<f32>/);
assert.match(runtime, /texture_2d<f32>/);
assert.match(runtime, /texture_storage_2d<rgba16float, write>/);
assert.doesNotMatch(runtime, /rgba8|unorm8|pack4x8|unpack4x8/i);
assert.match(runtime, /immutable source/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /session\.previewFault/);

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
assert.match(commit, /precision:\s*"rgba16float-f32-accumulation"/);
assert.match(history, /interface RasterFilterHistoryAction/);
assert.match(engine, /activeRasterGaussianBlurSession/);

assert.match(html, /id="mobileGaussianBlurOpen"/);
assert.match(html, /id="desktopGaussianBlurOpen"/);
assert.match(html, /id="mobileGaussianBlurSheet"/);
assert.match(html, /id="desktopGaussianBlurParameters"/);
assert.doesNotMatch(html, /id="rasterGaussianBlurDialog"/);
const mobileTile = html.slice(
  html.indexOf('id="mobileGaussianBlurOpen"'),
  html.indexOf("</button>", html.indexOf('id="mobileGaussianBlurOpen"')),
);
assert.doesNotMatch(mobileTile, /\bdisabled\b/);
assert.match(main, /engine\.beginRasterGaussianBlur/);
assert.match(main, /engine\.commitRasterGaussianBlur/);
assert.match(main, /engine\.cancelRasterGaussianBlur/);
assert.match(main, /historyState\.openEdit === "gaussian-blur"/);
assert.match(main, /resetRasterGaussianBlurControls/);
assert.match(main, /DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS/);
assert.match(main, /openRasterGaussianBlurWorkbench\("desktop"/);
assert.match(main, /openRasterGaussianBlurWorkbench\("mobile"/);
assert.match(mobileSheet, /resolveMobileBottomSheetDrag/);
assert.match(mobileSheet, /onRequestCancel/);
assert.match(mobileSheet, /MOBILE_GAUSSIAN_BLUR_PEEK_VIEWPORT_RATIO = 0\.26/);
assert.match(html, /mobile-stroke-sheet-content mobile-gaussian-blur-shell/);
assert.match(html, /id="mobileGaussianBlurHeader" class="mobile-stroke-header"/);
assert.match(html, /class="mobile-stroke-title">Gaussian Blur/);
assert.match(html, /class="mobile-stroke-width-control" for="mobileGaussianBlurRadius"/);
assert.match(html, /id="mobileGaussianBlurCancel" type="button">Cancel/);
assert.match(html, /id="mobileGaussianBlurApply" class="is-primary" type="button">Apply/);
assert.doesNotMatch(html, /mobile-gaussian-blur-live/);

console.log("Destructive 16-bit Gaussian Blur verification passed.");
