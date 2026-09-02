import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DESTRUCTIVE_MOTION_BLUR_CORE_BUILD,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
  DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE,
  destructiveMotionBlurBounds,
  destructiveMotionBlurKernel,
  destructiveMotionBlurMaximumBounds,
  normalizeDestructiveMotionBlurAngle,
  normalizeDestructiveMotionBlurDistance,
  unionMotionBlurRects,
} from "../src/motion-blur-core.ts";
import { quantizeUnorm8HighFrequencyAdjacent } from "../src/rgba8-high-frequency-quantization.ts";

assert.equal(
  DESTRUCTIVE_MOTION_BLUR_CORE_BUILD,
  "destructive-motion-blur-core-v1-centered-power-of-two-exposures",
);
assert.equal(DESTRUCTIVE_MOTION_BLUR_MAX_DISTANCE, 500);
assert.equal(
  normalizeDestructiveMotionBlurDistance(Number.NaN),
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_DISTANCE,
);
assert.equal(normalizeDestructiveMotionBlurDistance(-10), 0);
assert.equal(normalizeDestructiveMotionBlurDistance(900), 500);
assert.equal(
  normalizeDestructiveMotionBlurAngle(Number.NaN),
  DESTRUCTIVE_MOTION_BLUR_DEFAULT_ANGLE,
);
assert.equal(normalizeDestructiveMotionBlurAngle(-900), -180);
assert.equal(normalizeDestructiveMotionBlurAngle(900), 180);

for (const [distance, samples, passes] of [
  [0, 1, 0],
  [1, 2, 1],
  [20, 32, 5],
  [100, 128, 7],
  [500, 512, 9],
]) {
  const kernel = destructiveMotionBlurKernel(distance, 0);
  assert.equal(kernel.sampleCount, samples);
  assert.equal(kernel.passCount, passes);
  assert.equal(kernel.shifts.length, passes);
  assert((kernel.sampleCount & (kernel.sampleCount - 1)) === 0);
  if (distance > 0) {
    assert(kernel.sampleSpacing <= 1);
    const totalPositiveShift = kernel.shifts.reduce((sum, shift) => sum + shift.x, 0);
    assert(Math.abs(totalPositiveShift - distance / 2) < 1e-9);
  }
}

const vertical = destructiveMotionBlurKernel(20, 90);
assert(Math.abs(vertical.directionX) < 1e-12);
assert(Math.abs(vertical.directionY + 1) < 1e-12);
assert.equal(vertical.supportX, 0);
assert(vertical.supportY >= 10);

const horizontal20 = destructiveMotionBlurKernel(20, 0);
assert.deepEqual(
  destructiveMotionBlurBounds(
    { x: 20, y: 30, width: 40, height: 50 },
    20,
    0,
    100,
    100,
  ),
  {
    x: 20 - horizontal20.supportX,
    y: 30,
    width: 40 + horizontal20.supportX * 2,
    height: 50,
  },
);
assert.deepEqual(
  destructiveMotionBlurBounds(
    { x: 90, y: 50, width: 10, height: 10 },
    20,
    90,
    100,
    60,
  ),
  {
    x: 90,
    y: 50 - vertical.supportY,
    width: 10,
    height: 10 + vertical.supportY,
  },
  "La scia verticale deve essere ritagliata dall'altezza indipendente del documento.",
);
const maximumBounds = destructiveMotionBlurMaximumBounds(
  { x: 300, y: 300, width: 100, height: 100 },
  1000,
  1000,
);
assert(maximumBounds);
assert(maximumBounds.x <= 41 && maximumBounds.y <= 41);
assert(maximumBounds.width >= 618 && maximumBounds.height >= 618);
assert.deepEqual(
  unionMotionBlurRects(
    { x: 4, y: 8, width: 10, height: 12 },
    { x: 1, y: 9, width: 8, height: 20 },
  ),
  { x: 1, y: 8, width: 13, height: 21 },
);

function clampDocumentIndex(value, size) {
  return Math.max(0, Math.min(size - 1, value));
}

function motionTexel(source, width, height, x, y) {
  return source[
    clampDocumentIndex(y, height) * width
      + clampDocumentIndex(x, width)
  ];
}

function motionSampleLinear(source, width, height, documentX, documentY) {
  const pixelX = documentX - 0.5;
  const pixelY = documentY - 0.5;
  const baseX = Math.floor(pixelX);
  const baseY = Math.floor(pixelY);
  const fractionX = pixelX - baseX;
  const fractionY = pixelY - baseY;
  const top = motionTexel(source, width, height, baseX, baseY) * (1 - fractionX)
    + motionTexel(source, width, height, baseX + 1, baseY) * fractionX;
  const bottom = motionTexel(source, width, height, baseX, baseY + 1) * (1 - fractionX)
    + motionTexel(source, width, height, baseX + 1, baseY + 1) * fractionX;
  return top * (1 - fractionY) + bottom * fractionY;
}

function motionAlphaReference(source, width, height, distance, angle) {
  let current = Float64Array.from(source);
  for (const shift of destructiveMotionBlurKernel(distance, angle).shifts) {
    const next = new Float64Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const documentX = x + 0.5;
        const documentY = y + 0.5;
        next[y * width + x] = (
          motionSampleLinear(
            current,
            width,
            height,
            documentX - shift.x,
            documentY - shift.y,
          )
          + motionSampleLinear(
            current,
            width,
            height,
            documentX + shift.x,
            documentY + shift.y,
          )
        ) * 0.5;
      }
    }
    current = next;
  }
  return current;
}

const solidAlpha = new Float64Array(9 * 9).fill(1);
const solidMotion = motionAlphaReference(solidAlpha, 9, 9, 8, 37);
assert(
  [...solidMotion].every((alpha) => Math.abs(alpha - 1) < 1e-12),
  "Motion Blur non deve scolorire un canvas uniforme ai bordi",
);

const isolatedAlpha = new Float64Array(17 * 17);
isolatedAlpha[8 * 17 + 8] = 1;
const isolatedMotion = motionAlphaReference(isolatedAlpha, 17, 17, 4, 0);
assert(isolatedMotion[8 * 17 + 7] > 0, "la scia deve uscire dal contenuto sorgente");
assert(isolatedMotion[8 * 17 + 9] > 0, "la scia centrata deve essere simmetrica");

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function roundTripPackedUnorm16(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 65535) / 65535;
}

// The packed working path must retain every persistent 8-bit gray code through
// an encoded-sRGB -> linear -> packed UNORM16 -> encoded-sRGB round trip. A
// final adjacent-code decision may choose only the two closest 8-bit values.
for (let code = 0; code <= 255; code += 1) {
  const encoded = code / 255;
  const working = roundTripPackedUnorm16(srgbToLinear(encoded));
  const output = linearToSrgb(working);
  const quantized = quantizeUnorm8HighFrequencyAdjacent(
    output,
    307 + code,
    811,
    0x4d4f544e,
    0,
  );
  const scaled = output * 255;
  assert(
    quantized === Math.floor(scaled) || quantized === Math.ceil(scaled),
    "La finalizzazione Motion Blur RGBA8 deve scegliere solo codici adiacenti.",
  );
  assert(
    Math.abs(quantized - code) <= 1,
    "Il round trip lineare packed non deve saltare livelli persistenti RGBA8.",
  );
}

const darkRamp = Array.from({ length: 1024 }, (_, index) => {
  const encoded = (index / 1023) * (48 / 255);
  const working = roundTripPackedUnorm16(srgbToLinear(encoded));
  return quantizeUnorm8HighFrequencyAdjacent(
    linearToSrgb(working),
    1300 + index,
    97,
    0x4d4f544e,
    0,
  );
});
assert(
  new Set(darkRamp).size >= 48,
  "La rampa scura deve utilizzare praticamente tutti i livelli RGBA8 disponibili.",
);
assert.deepEqual(
  darkRamp,
  Array.from({ length: 1024 }, (_, index) => {
    const encoded = (index / 1023) * (48 / 255);
    return quantizeUnorm8HighFrequencyAdjacent(
      linearToSrgb(roundTripPackedUnorm16(srgbToLinear(encoded))),
      1300 + index,
      97,
      0x4d4f544e,
      0,
    );
  }),
  "La fase di quantizzazione deve essere stabile al replay.",
);

const runtime = readFileSync(
  new URL("../src/engine-motion-blur-runtime.ts", import.meta.url),
  "utf8",
);
const engine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const history = readFileSync(
  new URL("../src/engine-history-types.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const adjustments = readFileSync(
  new URL("../src/raster-adjustments-controller.ts", import.meta.url),
  "utf8",
);
const canvasInput = readFileSync(
  new URL("../src/canvas-input-controller.ts", import.meta.url),
  "utf8",
);

assert.match(runtime, /format:\s*"rgba16float"/);
assert.match(runtime, /format:\s*engine\.layerFormat/);
assert.match(runtime, /format:\s*engine\.layerFormat === "rgba8unorm" \? "rg32uint" : "rgba16float"/);
assert.match(runtime, /texture_2d<f32>/);
assert.match(runtime, /texture_2d<u32>/);
assert.match(runtime, /return \([\s\S]*\) \* 0\.5;/);
assert.match(runtime, /sampleInputLinear/);
assert.match(runtime, /immutable source/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /session\.previewFault/);
assert.match(runtime, /transparent-content-clamp-document-edge/);
assert.match(runtime, /clampedDocumentPixel\s*=\s*clamp\(/);
assert.match(runtime, /import \{ DOCUMENT_HEIGHT, DOCUMENT_WIDTH \} from "\.\/engine-limits"/);
assert.match(
  runtime,
  /function writePassParameters\([\s\S]{0,260}documentWidth: number,\s*documentHeight: number,/,
);
assert.match(runtime, /parameterUploadI32\[word \+ 10\]\s*=\s*documentWidth/);
assert.match(runtime, /parameterUploadI32\[word \+ 11\]\s*=\s*documentHeight/);
assert.match(runtime, /\}, DOCUMENT_WIDTH, DOCUMENT_HEIGHT\);/);
assert.match(
  runtime,
  /destructiveMotionBlurBounds\([\s\S]{0,180}DOCUMENT_WIDTH,\s*DOCUMENT_HEIGHT,/,
  "Motion Blur deve ritagliare la scia sui due assi reali.",
);
assert.doesNotMatch(
  runtime,
  /engine\.layerSize|\bLAYER_SIZE\b|word \+ 11\]\s*=\s*documentWidth/,
  "Motion Blur non deve duplicare la larghezza come altezza.",
);
assert.doesNotMatch(runtime, /requires an RGBA16F document/);
assert.match(runtime, /pack2x16unorm/);
assert.match(runtime, /unpack2x16unorm/);
assert.match(runtime, /motionEncodedPremultipliedToLinear/);
assert.match(runtime, /motionLinearPremultipliedToEncoded/);
assert.match(runtime, /quantizeRgba8HighFrequencyAdjacent/);
assert.match(runtime, /documentPixel,\s*parameters\.quantizationAndReserved\.x/);
assert.match(runtime, /quantizationSeed:\s*engine\.nextHistoryActionId >>> 0/);
assert.match(runtime, /engine\.documentStorageColorSpace === "encoded-srgb-premultiplied"/);
assert.match(runtime, /secondaryTexture/);
assert.match(runtime, /MOTION_BLUR_RGBA8_SOURCE_WGSL/);
assert.match(runtime, /MOTION_BLUR_RGBA8_WORKING_WGSL/);
assert.match(runtime, /MOTION_BLUR_RGBA8_FINALIZE_WGSL/);
assert.match(runtime, /GPUTextureUsage\.STORAGE_BINDING \| GPUTextureUsage\.TEXTURE_BINDING/);

const rgba8Encode = runtime.slice(
  runtime.indexOf('if (session.shared.outputFormat === "rgba8unorm")'),
  runtime.indexOf('  } else {', runtime.indexOf('if (session.shared.outputFormat === "rgba8unorm")')),
);
assert.match(rgba8Encode, /beginComputePass/);
assert.match(rgba8Encode, /rgba8SourcePipeline/);
assert.match(rgba8Encode, /rgba8WorkingPipeline/);
assert.match(rgba8Encode, /rgba8FinalizePipeline/);
assert.match(
  rgba8Encode,
  /for \(let pass = 0; pass < kernel\.passCount; pass \+= 1\)[\s\S]*Motion Blur RGBA8 high-frequency finalization/,
  "Tutti i pass packed devono precedere l'unica scrittura RGBA8 finale.",
);
assert.doesNotMatch(
  rgba8Encode.slice(0, rgba8Encode.indexOf("Motion Blur RGBA8 high-frequency finalization")),
  /engine\.layerView/,
  "Il documento RGBA8 non deve essere una superficie ping-pong tra i pass.",
);

const restore = runtime.slice(
  runtime.indexOf("async function restoreOriginalPixels("),
  runtime.indexOf("export async function beginRasterMotionBlur("),
);
assert.match(restore, /copyTextureToTexture/);
assert.match(restore, /session\.sourceTexture/);
assert.doesNotMatch(restore, /flushPreview/);

const commit = runtime.slice(runtime.indexOf("export async function commitRasterMotionBlur("));
assert.match(commit, /kind:\s*"raster-filter"/);
assert.match(commit, /filter:\s*"motion-blur"/);
assert.match(commit, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(commit, /createLayerColdStorageCandidate\([\s\S]{0,260}"history"/);
assert.match(commit, /DESTRUCTIVE_MOTION_BLUR_RGBA8_PRECISION/);
assert.match(commit, /"rgba16float-f32-accumulation"/);
assert.match(history, /filter:\s*"motion-blur"/);
assert.match(
  history,
  /rgba8unorm-linear-rgba16unorm-packed-logarithmic-f32-high-frequency-output/,
);
assert.match(history, /transparent-content-clamp-document-edge/);
assert.match(engine, /activeRasterMotionBlurSession/);
assert.match(engine, /beginRasterMotionBlur/);
assert.match(adjustments, /engine\.beginRasterMotionBlur/);
assert.match(adjustments, /engine\.updateRasterMotionBlur/);
assert.match(adjustments, /engine\.commitRasterMotionBlur/);
assert.match(adjustments, /engine\.cancelRasterMotionBlur/);
assert.match(adjustments, /history\.openEdit === "motion-blur"/);
assert.match(
  adjustments,
  /isDestructivePreviewNavigationActive\([\s\S]*?history\.openEdit === "motion-blur"/,
);
assert.match(main, /rasterAdjustmentsController\?\.isDestructivePreviewNavigationActive/);
assert.match(canvasInput, /destructivePreviewTouchNavigationRequested/);

console.log("Destructive dual-storage Motion Blur verification passed.");
