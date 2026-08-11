import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_RASTER_NOISE_SETTINGS,
  DESTRUCTIVE_RASTER_NOISE_ALGORITHM_VERSION,
  DESTRUCTIVE_RASTER_NOISE_CORE_BUILD,
  DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT,
  RASTER_NOISE_CHANNEL_SALT_B,
  RASTER_NOISE_CHANNEL_SALT_G,
  RASTER_NOISE_CHANNEL_SALT_R,
  applyRasterNoiseToPremultipliedPixel,
  evaluateRasterNoise,
  normalizeRasterNoiseSettings,
  pcgHash32,
  rasterNoiseLatticeHash,
  rasterNoiseOctaveCount,
  rasterNoisePeriodPixels,
  rasterNoiseUniform01,
} from "../src/noise-core.ts";

assert.equal(
  DESTRUCTIVE_RASTER_NOISE_CORE_BUILD,
  "destructive-raster-noise-core-v1-gradient-fbm-domain-warp",
);
assert.equal(DESTRUCTIVE_RASTER_NOISE_ALGORITHM_VERSION, 1);
assert.equal(DESTRUCTIVE_RASTER_NOISE_MAX_AMOUNT_PERCENT, 300);
assert.deepEqual(normalizeRasterNoiseSettings(), DEFAULT_RASTER_NOISE_SETTINGS);
assert.equal(DEFAULT_RASTER_NOISE_SETTINGS.scalePercent, 0);
assert.equal(normalizeRasterNoiseSettings({ amountPercent: Number.NaN }).amountPercent, 0);
assert.equal(normalizeRasterNoiseSettings({ amountPercent: Number.POSITIVE_INFINITY }).amountPercent, 0);
assert.equal(normalizeRasterNoiseSettings({ amountPercent: -1 }).amountPercent, 0);
assert.equal(normalizeRasterNoiseSettings({ amountPercent: 100 }).amountPercent, 100);
assert.equal(normalizeRasterNoiseSettings({ amountPercent: 300 }).amountPercent, 300);
assert.equal(normalizeRasterNoiseSettings({ amountPercent: 301 }).amountPercent, 300);
assert.equal(normalizeRasterNoiseSettings({ scalePercent: -1 }).scalePercent, 0);
assert.equal(normalizeRasterNoiseSettings({ scalePercent: 101 }).scalePercent, 100);
assert.equal(normalizeRasterNoiseSettings({ octavesPercent: -1 }).octavesPercent, 0);
assert.equal(normalizeRasterNoiseSettings({ octavesPercent: 101 }).octavesPercent, 100);
assert.equal(normalizeRasterNoiseSettings({ turbulencePercent: -1 }).turbulencePercent, 0);
assert.equal(normalizeRasterNoiseSettings({ turbulencePercent: 101 }).turbulencePercent, 100);
assert.equal(normalizeRasterNoiseSettings({ style: "unknown" }).style, "clouds");
assert.equal(normalizeRasterNoiseSettings({ channels: "unknown" }).channels, "single");
assert.equal(rasterNoisePeriodPixels(0), 1);
assert.equal(rasterNoisePeriodPixels(50), 32);
assert.equal(rasterNoisePeriodPixels(100), 1024);
assert.equal(rasterNoiseOctaveCount(0), 1);
assert.equal(rasterNoiseOctaveCount(50), 4.5);
assert.equal(rasterNoiseOctaveCount(100), 8);

for (const fixture of [
  [0, 0, 0, 0, 0, 0x30be035e, 0.19039934873580933],
  [1, 2, 0x12345678, 0x9abcdef0, 0, 0x4da36d23, 0.303274929523468],
  [-1, 4096, 0xdeadbeef, 0x10203040, 0xa511e9b3, 0x055d8549, 0.020958244800567627],
  [2047, 2047, 1, 2, 0x63d83595, 0x8f338dcc, 0.5593803524971008],
]) {
  const [x, y, low, high, salt, expectedHash, expectedUniform] = fixture;
  const hash = rasterNoiseLatticeHash(x, y, low, high, salt);
  assert.equal(hash, expectedHash);
  assert.equal(rasterNoiseUniform01(hash), expectedUniform);
}

const sampleCount = 1_048_576;
let sum = 0;
let sumSquared = 0;
let sumR = 0;
let sumG = 0;
let sumB = 0;
let sumRR = 0;
let sumGG = 0;
let sumBB = 0;
let sumRG = 0;
let sumRB = 0;
let sumGB = 0;
for (let index = 0; index < sampleCount; index += 1) {
  const x = index & 1023;
  const y = index >>> 10;
  const hash = rasterNoiseLatticeHash(x, y, 0x12345678, 0x9abcdef0, 0x51ed270b);
  const value = rasterNoiseUniform01(hash);
  sum += value;
  sumSquared += value * value;
  const red = rasterNoiseUniform01(pcgHash32(hash ^ RASTER_NOISE_CHANNEL_SALT_R));
  const green = rasterNoiseUniform01(pcgHash32(hash ^ RASTER_NOISE_CHANNEL_SALT_G));
  const blue = rasterNoiseUniform01(pcgHash32(hash ^ RASTER_NOISE_CHANNEL_SALT_B));
  sumR += red;
  sumG += green;
  sumB += blue;
  sumRR += red * red;
  sumGG += green * green;
  sumBB += blue * blue;
  sumRG += red * green;
  sumRB += red * blue;
  sumGB += green * blue;
}
const mean = sum / sampleCount;
const variance = sumSquared / sampleCount - mean * mean;
assert(Math.abs(mean - 0.5) < 0.0015, `Hash mean ${mean}`);
assert(Math.abs(variance - 1 / 12) < 0.0005, `Hash variance ${variance}`);
function correlation(sumX, sumY, sumXX, sumYY, sumXY) {
  const covariance = sumXY - sumX * sumY / sampleCount;
  const varianceX = sumXX - sumX * sumX / sampleCount;
  const varianceY = sumYY - sumY * sumY / sampleCount;
  return covariance / Math.sqrt(varianceX * varianceY);
}
assert(Math.abs(correlation(sumR, sumG, sumRR, sumGG, sumRG)) < 0.005);
assert(Math.abs(correlation(sumR, sumB, sumRR, sumBB, sumRB)) < 0.005);
assert(Math.abs(correlation(sumG, sumB, sumGG, sumBB, sumGB)) < 0.005);

const seed = { low: 0x12345678, high: 0x9abcdef0 };
for (const style of ["clouds", "billows", "ridges"]) {
  for (const turbulencePercent of [0, 100]) {
    const single = evaluateRasterNoise(37.5, 91.5, {
      ...DEFAULT_RASTER_NOISE_SETTINGS,
      amountPercent: 100,
      style,
      channels: "single",
      turbulencePercent,
    }, seed);
    assert.equal(single.r, single.g);
    assert.equal(single.g, single.b);
    assert(single.r >= 0 && single.r <= 1);
    const multi = evaluateRasterNoise(37.5, 91.5, {
      ...DEFAULT_RASTER_NOISE_SETTINGS,
      amountPercent: 100,
      style,
      channels: "multi",
      turbulencePercent,
    }, seed);
    assert([multi.r, multi.g, multi.b].every(Number.isFinite));
    assert([multi.r, multi.g, multi.b].every((value) => value >= 0 && value <= 1));
    assert.notDeepEqual(multi, single);
  }
}

const source = { r: 0.2, g: 0.1, b: -0.25, a: 0.5 };
const field = { r: 0, g: 0.5, b: 1 };
assert.deepEqual(
  applyRasterNoiseToPremultipliedPixel(source, field, { amountPercent: 0 }),
  source,
);
assert.deepEqual(
  applyRasterNoiseToPremultipliedPixel(
    { r: 8, g: -2, b: 1, a: 0 },
    field,
    { amountPercent: 300 },
  ),
  { r: 8, g: -2, b: 1, a: 0 },
);
assert.deepEqual(
  applyRasterNoiseToPremultipliedPixel(source, field, {
    amountPercent: 100,
    additive: false,
  }),
  { r: 0, g: 0.25, b: 0.5, a: 0.5 },
);
assert.deepEqual(
  applyRasterNoiseToPremultipliedPixel(source, field, {
    amountPercent: 100,
    additive: true,
  }),
  { r: -0.04999999999999999, g: 0.1, b: 0, a: 0.5 },
);

const runtime = readFileSync(new URL("../src/engine-noise-runtime.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const history = readFileSync(new URL("../src/engine-history-types.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../src/mobile-noise-sheet.ts", import.meta.url), "utf8");
const metadataEffects = readFileSync(
  new URL("../src/mobile-raster-effects-sheet.ts", import.meta.url),
  "utf8",
);

assert.match(runtime, /const WORKGROUP_WIDTH = 8;/);
assert.match(runtime, /const WORKGROUP_HEIGHT = 8;/);
assert.match(
  runtime,
  /@compute @workgroup_size\(\$\{WORKGROUP_WIDTH\}, \$\{WORKGROUP_HEIGHT\}\)/,
);
assert.match(runtime, /texture_storage_2d<rgba16float, write>/);
assert.match(runtime, /parameterBuffer[\s\S]{0,160}size: PARAMETER_BYTES/);
assert.match(runtime, /memoryBytes:[\s\S]{0,160}BYTES_PER_RGBA16F_PIXEL[\s\S]{0,80}PARAMETER_BYTES/);
assert.match(runtime, /previewInFlight/);
assert.match(runtime, /session\.previewFault/);
assert.match(runtime, /globalThis\.crypto\.getRandomValues/);
assert.match(runtime, /export function abandonRasterNoiseSession/);
assert.match(engine, /device\.lost[\s\S]{0,220}abandonRasterNoiseSession\(this\)/);
assert.match(runtime, /source\.rgb \+ source\.a \* amount/);
assert.match(runtime, /clamp\(resultRgb, vec3<f32>\(-HALF_MAX\)/);
assert.doesNotMatch(runtime, /rgba32float|r32float|rgba8|unorm8|pack4x8|unpack4x8/i);
assert.doesNotMatch(runtime, /intermediateTexture|outputTexture/);

const preview = runtime.slice(
  runtime.indexOf("function encodeRequestedPreview("),
  runtime.indexOf("function startPreviewSubmission("),
);
assert(preview.indexOf("copyTextureToTexture") < preview.indexOf("beginComputePass"));
const restore = runtime.slice(
  runtime.indexOf("async function restoreOriginalPixels("),
  runtime.indexOf("export async function beginRasterNoise("),
);
assert.match(restore, /copyTextureToTexture/);
assert.match(restore, /session\.sourceTexture/);
assert.doesNotMatch(restore, /flushPreview/);
const commit = runtime.slice(runtime.indexOf("export async function commitRasterNoise("));
assert.match(commit, /filter: "noise"/);
assert.match(commit, /commitHistoryActionAtomically\(engine, action\)/);
assert.match(commit, /createLayerColdStorageCandidate\([\s\S]{0,280}"history"/);
assert.match(commit, /session\.settings\.amountPercent === 0/);
assert.match(history, /filter: "noise"/);
assert.match(history, /precision: "rgba16float-storage-f32-procedural"/);
assert.match(engine, /activeRasterNoiseSession/);
assert.match(engine, /beginRasterNoise/);
assert.match(engine, /GPUTextureUsage\.STORAGE_BINDING[\s\S]{0,120}GPUTextureUsage\.RENDER_ATTACHMENT/);
assert.match(main, /engine\.beginRasterNoise/);
assert.match(main, /engine\.updateRasterNoise/);
assert.match(main, /engine\.commitRasterNoise/);
assert.match(main, /engine\.cancelRasterNoise/);
assert.match(main, /historyState\.openEdit === "noise"/);
assert.match(main, /rasterNoiseSessionOpen[\s\S]{0,120}historyState\.openEdit === "noise"/);

for (const id of [
  "mobileNoiseOpen",
  "mobileNoiseSheet",
  "mobileNoiseHandle",
  "mobileNoiseHeader",
  "mobileNoiseControlsRegion",
  "mobileNoiseScroll",
  "mobileNoiseAmount",
  "mobileNoiseAmountOut",
  "mobileNoiseStyle",
  "mobileNoiseScale",
  "mobileNoiseScaleOut",
  "mobileNoiseOctaves",
  "mobileNoiseOctavesOut",
  "mobileNoiseTurbulence",
  "mobileNoiseTurbulenceOut",
  "mobileNoiseChannels",
  "mobileNoiseAdditive",
  "mobileNoiseStatus",
  "mobileNoiseCancel",
  "mobileNoiseApply",
  "rasterNoiseSection",
  "desktopNoiseOpen",
  "desktopNoiseParameters",
  "desktopNoiseAmount",
  "desktopNoiseAmountOut",
  "desktopNoiseStyle",
  "desktopNoiseScale",
  "desktopNoiseScaleOut",
  "desktopNoiseOctaves",
  "desktopNoiseOctavesOut",
  "desktopNoiseTurbulence",
  "desktopNoiseTurbulenceOut",
  "desktopNoiseChannels",
  "desktopNoiseAdditive",
  "desktopNoiseStatus",
  "desktopNoiseCancel",
  "desktopNoiseApply",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Manca #${id}.`);
}
for (const prefix of ["mobile", "desktop"]) {
  assert.match(
    html,
    new RegExp(`id="${prefix}NoiseAmount"[\\s\\S]{0,180}min="0"[\\s\\S]{0,80}max="300"`),
  );
}
assert.match(html, /Extended above 100%/);
for (const prefix of ["mobile", "desktop"]) {
  assert.match(
    html,
    new RegExp(`id="${prefix}NoiseScaleOut"[^>]*>0% · 1 px<`),
  );
  assert.match(
    html,
    new RegExp(`id="${prefix}NoiseScale"[^>]*value="0"`),
  );
}
assert.match(sheet, /export class MobileNoiseSheetController/);
assert.match(sheet, /MOBILE_NOISE_MIN_PEEK_PX = 176/);
assert.match(sheet, /MOBILE_NOISE_MAX_PEEK_PX = 240/);
assert.match(sheet, /MOBILE_NOISE_PEEK_VIEWPORT_RATIO = 0\.26/);
assert.match(sheet, /--mobile-noise-visible-height/);
assert.doesNotMatch(sheet, /from "\.\/engine/);
assert.match(styles, /\.mobile-noise-shell[\s\S]{0,260}--mobile-noise-visible-height/);
assert.match(styles, /\.mobile-noise-scroll[\s\S]{0,220}flex: 1 1 auto/);
assert.match(styles, /\.mobile-noise-scroll[\s\S]{0,320}overflow-y: auto/);
assert.match(styles, /\.mobile-noise-scroll[\s\S]{0,420}touch-action: pan-y/);
assert.doesNotMatch(metadataEffects, /MobileRasterEffectKind[\s\S]{0,140}"noise"/);

console.log("Destructive RGBA16F Noise verification passed.");
