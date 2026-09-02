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
import {
  quantizeUnorm8HighFrequencyAdjacent,
  rgba8HighFrequencyThresholdRank,
} from "../src/rgba8-high-frequency-quantization.ts";

assert.equal(
  DESTRUCTIVE_GAUSSIAN_BLUR_CORE_BUILD,
  "destructive-gaussian-blur-core-v2-three-sigma-format-neutral",
);
assert.equal(DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS, 500);
const maximumFilterCacheBytes = (64 + DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS * 2) * 8;
const maximumParameterBytes = (
  20 + Math.ceil((DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS + 1) / 4) * 4
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

function f32FlatConvolution(value, weights) {
  const source = Math.fround(value);
  let result = Math.fround(source * Math.fround(weights[0]));
  for (let offset = 1; offset < weights.length; offset += 1) {
    const term = Math.fround(source * Math.fround(weights[offset]));
    result = Math.fround(result + term);
    result = Math.fround(result + term);
  }
  return result;
}

function roundTripPackedUnorm16(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return Math.round(bounded * 65_535) / 65_535;
}

function srgbToLinearChannel(value) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbChannel(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

for (const radius of [1, 24, 100, DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS]) {
  const weights = destructiveGaussianBlurKernel(radius).weights;
  // Alpha is linear and every RGBA8 alpha code must remain byte-exact over a
  // flat field, even after both packed UNORM16 strip boundaries.
  for (let code = 0; code <= 255; code += 1) {
    const source = code / 255;
    const horizontal = roundTripPackedUnorm16(
      f32FlatConvolution(source, weights),
    );
    const vertical = f32FlatConvolution(horizontal, weights);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        assert.equal(
          quantizeUnorm8HighFrequencyAdjacent(vertical, x, y, 19),
          code,
          `campo piatto code ${code}, radius ${radius}, (${x}, ${y})`,
        );
      }
    }
  }

  // RGB follows the real encoded-sRGB -> linear -> packed UNORM16 -> encoded
  // path. The intermediate may move the continuous result by a tiny fraction
  // of one code, but the local mean must retain that value without a tonal
  // step or a non-adjacent output code.
  for (let code = 0; code <= 255; code += 1) {
    const sourceLinear = srgbToLinearChannel(code / 255);
    const horizontal = roundTripPackedUnorm16(
      f32FlatConvolution(sourceLinear, weights),
    );
    const vertical = roundTripPackedUnorm16(
      f32FlatConvolution(horizontal, weights),
    );
    const continuousCode = linearToSrgbChannel(vertical) * 255;
    const lower = Math.floor(continuousCode);
    const upper = Math.min(255, lower + 1);
    let outputTotal = 0;
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const output = quantizeUnorm8HighFrequencyAdjacent(
          continuousCode / 255,
          x,
          y,
          19,
        );
        assert(
          output === lower || output === upper,
          `RGB code ${code} must use adjacent output codes at radius ${radius}`,
        );
        outputTotal += output;
      }
    }
    const outputMean = outputTotal / 256;
    assert(
      Math.abs(outputMean - continuousCode) <= 1 / 256,
      `RGB code ${code} local mean drifted at radius ${radius}`,
    );
    assert(
      Math.abs(outputMean - code) <= 0.03,
      `RGB flat field code ${code} changed materially at radius ${radius}`,
    );
  }

  const packedImpulseMass = roundTripPackedUnorm16(weights[0])
    + weights.slice(1).reduce(
      (sum, weight) => sum + roundTripPackedUnorm16(weight) * 2,
      0,
    );
  assert(
    Math.abs(packedImpulseMass - 1) <= 0.0003,
    `la striscia UNORM16 deve conservare l'energia al raggio ${radius}`,
  );
}

for (const [blockX, blockY] of [[0, 0], [1, 0], [5, 7], [31, 19]]) {
  const ranks = new Set();
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      ranks.add(rgba8HighFrequencyThresholdRank(blockX * 16 + x, blockY * 16 + y, 19));
    }
  }
  assert.equal(ranks.size, 256, "ogni cella deve contenere tutte le soglie RGBA8");
}

const fixedTexelRanks = new Set(
  Array.from(
    { length: 256 },
    (_, seed) => rgba8HighFrequencyThresholdRank(137, 509, seed),
  ),
);
assert.equal(fixedTexelRanks.size, 256, "il seed deve visitare tutte le soglie in modo stabile");

let lag16Matches = 0;
let lag16Samples = 0;
for (let y = 0; y < 128; y += 1) {
  for (let x = 0; x < 112; x += 1) {
    const left = rgba8HighFrequencyThresholdRank(x, y, 19) < 128;
    const right = rgba8HighFrequencyThresholdRank(x + 16, y, 19) < 128;
    lag16Matches += Number(left === right);
    lag16Samples += 1;
  }
}
const lag16MatchRatio = lag16Matches / lag16Samples;
assert(
  lag16MatchRatio > 0.47 && lag16MatchRatio < 0.53,
  `la soglia non deve ripetere onde ogni 16 px: ${lag16MatchRatio}`,
);

for (const fractionalCode of [1, 17, 64, 127, 192, 255]) {
  let upperCodes = 0;
  const value = (73 + fractionalCode / 256) / 255;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const code = quantizeUnorm8HighFrequencyAdjacent(value, x, y, 91);
      assert(code === 73 || code === 74, "la quantizzazione deve usare codici adiacenti");
      upperCodes += Number(code === 74);
    }
  }
  assert.equal(upperCodes, fractionalCode, "la media locale deve conservare il sottocodice");
}

function quantizedMip(source, width, height) {
  const targetWidth = Math.ceil(width / 2);
  const targetHeight = Math.ceil(height / 2);
  const target = new Uint8Array(targetWidth * targetHeight);
  const seed = (
    Math.imul(width, 0x9e3779b9)
    ^ Math.imul(height, 0x85ebca6b)
    ^ 0x4d495031
  ) >>> 0;
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x * 2 + 1);
      const y0 = Math.min(height - 1, y * 2);
      const y1 = Math.min(height - 1, y * 2 + 1);
      const average = (
        source[y0 * width + x0]
        + source[y0 * width + x1]
        + source[y1 * width + x0]
        + source[y1 * width + x1]
      ) / (4 * 255);
      target[y * targetWidth + x] = quantizeUnorm8HighFrequencyAdjacent(
        average,
        x,
        y,
        seed,
      );
    }
  }
  return { pixels: target, width: targetWidth, height: targetHeight };
}

for (const initialSeed of [0, 19, 255]) {
  for (const fractionalCode of [1, 64, 127, 192, 255]) {
    const expectedCode = 73 + fractionalCode / 256;
    let width = 512;
    let height = 512;
    let pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        pixels[y * width + x] = quantizeUnorm8HighFrequencyAdjacent(
          expectedCode / 255,
          x,
          y,
          initialSeed,
        );
      }
    }
    for (let level = 1; level <= 4; level += 1) {
      ({ pixels, width, height } = quantizedMip(pixels, width, height));
      const mean = pixels.reduce((sum, code) => sum + code, 0) / pixels.length;
      const maximumMeanError = 1.5 / Math.sqrt(pixels.length);
      assert(
        Math.abs(mean - expectedCode) <= maximumMeanError,
        `mip ${level} biased the RGBA8 mean: ${mean} instead of ${expectedCode}`,
      );
    }
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
const rgba8Lab = readFileSync(
  new URL("../src/labs/rgba8-brush-lab.ts", import.meta.url),
  "utf8",
);
const rgba8Startup = readFileSync(
  new URL("../src/labs/rgba8-brush-startup.ts", import.meta.url),
  "utf8",
);

assert.match(runtime, /format:\s*engine\.layerFormat/);
assert.match(runtime, /array<vec4<f32>/);
assert.match(runtime, /array<vec2<u32>/);
assert.match(runtime, /pack2x16float/);
assert.match(runtime, /unpack2x16float/);
assert.match(runtime, /pack2x16unorm/);
assert.match(runtime, /unpack2x16unorm/);
assert.match(runtime, /rg32uint/);
assert.match(runtime, /maxComputeWorkgroupStorageSize/);
assert.match(runtime, /texture_2d<f32>/);
assert.match(runtime, /rgba8 \? "rg32uint" : "rgba16float"/);
assert.match(runtime, /texture_2d<\$\{rgba8 \? "u32" : "f32"\}>/);
assert.match(runtime, /outputFormat === "rgba8unorm" \? "float" : "unfilterable-float"/);
assert.match(runtime, /rgba8HighFrequencyQuantizationShader/);
assert.match(runtime, /quantizeRgba8HighFrequencyAdjacent/);
assert.match(runtime, /parameters\.quantizationAndReserved\.x/);
assert.match(runtime, /parameters\.quantizationAndReserved\.y/);
assert.match(runtime, /quantizationSeed:\s*engine\.nextHistoryActionId >>> 0/);
assert.match(runtime, /format:\s*engine\.layerFormat === "rgba8unorm" \? "rg32uint"/);
assert.match(runtime, /gaussianEncodedPremultipliedToLinear/);
assert.match(runtime, /gaussianLinearPremultipliedToEncoded/);
assert.match(runtime, /finalizeRgba8Shader/);
assert.match(runtime, /format:\s*outputFormat === "rgba8unorm" \? "rg32uint" : outputFormat/);
assert.match(runtime, /storageTexture:\s*\{ access: "write-only", format: "rgba8unorm" \}/);
assert.match(runtime, /finalize\.dispatchWorkgroups/);
assert.match(runtime, /immutable source/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /session\.previewFault/);
assert.match(runtime, /transparent-content-clamp-document-edge/);
assert.match(runtime, /clampedDocumentPosition\s*=\s*clamp\(/);
assert.doesNotMatch(runtime, /DOCUMENT_(?:WIDTH|HEIGHT)|DOCUMENT_EXTENT|engine-limits/);
assert.match(runtime, /let packedDocumentExtent = parameters\.kernelAndIntermediate\.w/);
assert.match(runtime, /packedDocumentExtent & 0xffffu/);
assert.match(runtime, /packedDocumentExtent >> 16u/);
assert.match(runtime, /\(documentHeight << 16\) \| documentWidth/);
assert.match(
  runtime,
  /destructiveGaussianBlurBounds\([\s\S]{0,180}engine\.documentWidth,\s*engine\.documentHeight,/,
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
assert.match(commit, /rgba8unorm-linear-rgba16unorm-packed-two-pass-f32-high-frequency-output/);
assert.match(commit, /rgba16float-f32-accumulation/);
assert.match(history, /interface RasterFilterHistoryAction/);
assert.match(history, /rgba8unorm-linear-rgba16unorm-packed-two-pass-f32-high-frequency-output/);
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
  main,
  /isAdjustmentSupported:\s*\(\)\s*=>\s*true/,
  "all validated RGBA8 raster adjustments must remain available in the main editor",
);
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

assert.match(rgba8Startup, /layerFormat:\s*"rgba8unorm"/);
assert.match(rgba8Startup, /presentationFormat:\s*"rgba8unorm"/);
assert.match(rgba8Lab, /data-blur-radius/);
assert.match(rgba8Lab, /beginRasterGaussianBlur/);
assert.match(rgba8Lab, /updateRasterGaussianBlur/);
assert.match(rgba8Lab, /commitRasterGaussianBlur/);
assert.match(rgba8Lab, /cancelRasterGaussianBlur/);
assert.match(rgba8Lab, /RGBA16 UNORM/);
assert.doesNotMatch(rgba8Lab, /striscia intermedia RGBA16F/);

console.log("Format-aware Gaussian Blur document-edge verification passed.");
