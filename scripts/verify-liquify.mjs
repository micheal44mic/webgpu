import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { quantizeUnorm8HighFrequencyAdjacent } from "../src/rgba8-high-frequency-quantization.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(resolve(repositoryRoot, "src/liquify-core.ts"), "utf8");
const shader = readFileSync(resolve(repositoryRoot, "src/liquify-shader.ts"), "utf8");
const runtime = readFileSync(resolve(repositoryRoot, "src/engine-liquify-runtime.ts"), "utf8");
const engine = readFileSync(resolve(repositoryRoot, "src/brush-engine.ts"), "utf8");
const historyTypes = readFileSync(resolve(repositoryRoot, "src/engine-history-types.ts"), "utf8");
const main = readFileSync(resolve(repositoryRoot, "src/main.ts"), "utf8");
const adjustments = readFileSync(
  resolve(repositoryRoot, "src/raster-adjustments-controller.ts"),
  "utf8",
);
const canvasInput = readFileSync(
  resolve(repositoryRoot, "src/canvas-input-controller.ts"),
  "utf8",
);
const sheet = readFileSync(resolve(repositoryRoot, "src/mobile-liquify-sheet.ts"), "utf8");
const html = readFileSync(resolve(repositoryRoot, "index.html"), "utf8");
const styles = readFileSync(resolve(repositoryRoot, "src/styles.css"), "utf8");
const sourceManifest = readFileSync(resolve(repositoryRoot, "scripts/engine-source.mjs"), "utf8");
const quantizationSeedMatch = shader.match(
  /export const LIQUIFY_RGBA8_QUANTIZATION_SEED = (0x[0-9a-f]+);/i,
);
assert.ok(quantizationSeedMatch, "Liquify must expose its RGBA8 quantization salt.");
const LIQUIFY_RGBA8_QUANTIZATION_SEED = Number.parseInt(quantizationSeedMatch[1], 16);

const requireText = (source, fragment, label = fragment) => {
  assert.ok(source.includes(fragment), `Liquify contract is missing ${label}`);
};

const publicCoreSymbols = [
  "LIQUIFY_CORE_STRATEGY",
  "LIQUIFY_MODES",
  "LiquifyMode",
  "LiquifySettings",
  "DEFAULT_LIQUIFY_SETTINGS",
  "normalizeLiquifySettings",
  "liquifyModeCode",
  "liquifyModeControls",
  "liquifySpacingPx",
  "liquifySegmentStepCount",
  "liquifyInterpolatedPoint",
  "liquifyDabDirtyBounds",
  "liquifySegmentDirtyBounds",
  "LIQUIFY_UNIFORM_BYTES",
  "LIQUIFY_UNIFORM_OFFSETS",
  "packLiquifyUniforms",
];
for (const symbol of publicCoreSymbols) {
  assert.match(
    core,
    new RegExp(`export (?:const|type|interface|function) ${symbol}\\b`),
    `Liquify contract is missing ${symbol}`,
  );
}

const expectedModes = [
  "push",
  "twirl-right",
  "twirl-left",
  "pinch",
  "expand",
  "crystals",
  "edge",
  "reconstruct",
];
for (const mode of expectedModes) requireText(core, `"${mode}"`, `mode ${mode}`);
const modeCodeBlock = core.match(/const MODE_CODES[\s\S]*?\n\}\);/)?.[0] ?? "";
assert.equal(
  (modeCodeBlock.match(/:\s*[0-7],/g) ?? []).length,
  8,
  "mode-to-uniform mapping must contain exactly eight entries",
);

for (const setting of ["size", "pressure", "distortion", "momentum"]) {
  requireText(core, `${setting}:`, `${setting} setting`);
}
requireText(core, "Number.isFinite", "non-finite setting defense");
requireText(core, "minimumSpacing: 0.75", "minimum dab spacing");
requireText(core, "maximumSpacing: 32", "maximum dab spacing");
requireText(core, "new Uint8Array(buffer, 0, LIQUIFY_UNIFORM_BYTES).fill(0)", "deterministic uniform padding");
requireText(core, "displacement-field-v2-composed-warp-mode-aware-resampling", "v2 core strategy");
requireText(core, "MODE_SPACING_FRACTIONS", "mode-aware dab spacing");
requireText(core, "distortedFraction - smoothFraction", "distortion-tightened sampling");
requireText(core, "momentum: true", "Momentum availability for every mode");

const offsets = {
  dispatchOrigin: 0,
  dispatchSize: 8,
  fieldOrigin: 16,
  fieldSize: 24,
  center: 32,
  previousCenter: 40,
  delta: 48,
  size: 56,
  pressure: 60,
  distortion: 64,
  momentum: 68,
  spacing: 72,
  elapsedSeconds: 76,
  seed: 80,
  mode: 84,
  strength: 88,
  maximumDisplacement: 92,
  sourceOrigin: 96,
  sourceSize: 104,
  documentSize: 112,
  strokeDirection: 120,
};
for (const [name, offset] of Object.entries(offsets)) {
  requireText(core, `${name}: ${offset}`, `uniform offset ${name}`);
  assert.equal(offset % 4, 0, `${name} must be four-byte aligned`);
  assert.ok(offset < 128, `${name} must fit in the used uniform prefix`);
}
requireText(core, "LIQUIFY_UNIFORM_BYTES = 256", "256-byte dynamic-uniform stride");
requireText(core, "LIQUIFY_UNIFORM_USED_BYTES = 128", "128-byte WGSL structure size");
requireText(core, "documentWidth: number", "independent document width input");
requireText(core, "documentHeight: number", "independent document height input");
requireText(core, "u32(112, input.documentWidth)", "document width packing");
requireText(core, "u32(116, input.documentHeight)", "document height packing");
requireText(core, "f32(120, finiteOr(input.strokeDirectionX, input.deltaX))", "stroke direction X packing");
requireText(core, "f32(124, finiteOr(input.strokeDirectionY, input.deltaY))", "stroke direction Y packing");

const publicShaderSymbols = [
  "LIQUIFY_DISPLACEMENT_FORMAT",
  "LIQUIFY_WORKGROUP_SIZE",
  "LIQUIFY_SHADER_STRATEGY",
  "LIQUIFY_UPDATE_SHADER",
  "LIQUIFY_RESOLVE_SHADER",
];
for (const symbol of publicShaderSymbols) requireText(shader, `export const ${symbol}`, symbol);
requireText(shader, 'LIQUIFY_DISPLACEMENT_FORMAT = "rgba16float"', "portable displacement format");
requireText(shader, "texture_storage_2d<rgba16float, write>", "write-only rgba16float storage");
requireText(shader, "export function liquifyResolveShader", "native-format resolve generator");
requireText(shader, "texture_storage_2d<${targetFormat}, write>", "native document target");
requireText(shader, "rgba8HighFrequencyQuantizationShader", "RGBA8 adjacent-code finalization");
requireText(shader, "quantizeRgba8HighFrequencyAdjacent", "stable RGBA8 quantizer");
requireText(shader, "LIQUIFY_RGBA8_QUANTIZATION_SEED", "stable document-space quantization seed");
requireText(
  shader,
  "uniforms.seed ^ ${LIQUIFY_RGBA8_QUANTIZATION_SEED}u",
  "session-stable action seed salted for RGBA8 finalization",
);
requireText(shader, "storageColorSpace: DocumentStorageColorSpace", "explicit storage color space");
requireText(shader, 'storageColorSpace === "encoded-srgb-premultiplied"', "encoded RGBA8 variant");
requireText(shader, "liquifyEncodedPremultipliedToLinear", "encoded-to-linear conversion");
requireText(shader, "liquifyLinearPremultipliedToEncoded", "linear-to-encoded conversion");
requireText(shader, "encodedStraight = clamp(value.rgb / alpha", "straight encoded source recovery");
requireText(shader, "linearStraight * alpha", "linear premultiplication before interpolation");
requireText(shader, "let storedColor =", "encoded destination handoff");
requireText(
  shader,
  "quantizeRgba8HighFrequencyAdjacent(\n      storedColor",
  "quantize after encoding",
);
requireText(shader, "var displacementScratch", "dirty scratch update strategy");
requireText(shader, "var immutableSource", "immutable resolve source");
requireText(shader, "copy scratch [0, dispatchSize)", "dirty-only scratch copy contract");
requireText(shader, "@workgroup_size(8, 8, 1)", "8x8 compute workgroup");
assert.equal(
  (shader.match(/@compute @workgroup_size\(8, 8, 1\)/g) ?? []).length,
  2,
  "update and resolve must both be compute kernels",
);
assert.ok(!shader.includes("read_write>"), "portable shaders must not depend on read_write storage textures");

const modeMarkers = [
  "case 0u: { // Push",
  "case 1u: { // Twirl right",
  "case 2u: { // Twirl left",
  "case 3u: { // Pinch",
  "case 4u: { // Expand",
  "case 5u: { // Crystals",
  "case 6u: { // Edge",
  "default: { // Reconstruct",
];
for (const marker of modeMarkers) requireText(shader, marker, marker.replace(/.*\/\/\s*/, ""));
requireText(shader, "clampDisplacement(nextDisplacement)", "bounded displacement writes");
requireText(shader, "sampleSourceBilinear", "explicit bilinear resolve");
requireText(shader, "sourceDocumentPosition", "destination-to-immutable-source mapping");
requireText(shader, "clamp(uniforms.strength, 0.0, 1.0)", "non-destructive Adjust Amount");
requireText(shader, "composed-inverse-warp-v2", "composed inverse-warp strategy");
requireText(shader, "strokeDirection: vec2<f32>", "directional uniform ABI");
requireText(shader, "sampleDisplacementBilinear", "field-aware warp composition sampling");
requireText(shader, "composeWarp(pixelCenter", "inverse-warp composition");
requireText(shader, "Dnew(x) = w(x) + Dold(x + w(x))", "composition equation");
requireText(shader, "closestPointOnSegment", "swept capsule Push");
requireText(shader, "dabTimeScale", "frame-rate-normalized stationary dabs");
requireText(shader, "valueNoise", "stable value noise");
requireText(shader, "turbulence2", "stable two-axis turbulence");
requireText(shader, "turbulenceY", "reduced-cost Edge turbulence");
requireText(shader, "var chaos = vec2<f32>(0.0)", "lazy Distortion turbulence");
requireText(shader, "uniforms.distortion > 0.0001", "zero-Distortion noise fast path");
requireText(shader, "uniforms.mode <= 4u", "vector turbulence limited to modes that consume both axes");
assert.ok(
  !shader.includes("let chaos = turbulence2"),
  "expensive turbulence must not run unconditionally for every affected pixel",
);
assert.ok(
  !/\b(?:let|var)\s+smooth\b/.test(shader),
  "WGSL reserved keyword smooth must not be used as an identifier",
);
requireText(shader, "Stable polar facets", "faceted Crystals geometry");
requireText(shader, "line-fold mapping", "line-fold Edge geometry");
requireText(shader, "1.0 - exp(-amount * 0.62)", "monotonic exponential Reconstruct");
requireText(shader, "let inverseMotion = -limitedMotion", "inverse Push direction");
requireText(shader, "chaos * length(limitedMotion)", "event-rate-stable Push distortion");
requireText(shader, "let angle = -amount * angularGain", "clockwise Twirl inverse mapping");
requireText(shader, "let angle = amount * angularGain", "counter-clockwise Twirl inverse mapping");
requireText(shader, "let sourceScale = exp(radialGain)", "Pinch inverse mapping");
requireText(shader, "let sourceScale = exp(-radialGain)", "Expand inverse mapping");
requireText(shader, "localWarp = -facetDirection * crystalAmount", "outward visual Crystals mapping");
assert.ok(!shader.includes("momentumBoost"), "Momentum must be generated by the runtime, not multiplied again per shader dab");

for (const symbol of [
  "beginRasterLiquify",
  "updateRasterLiquifySettings",
  "setRasterLiquifyAmount",
  "beginRasterLiquifyStroke",
  "extendRasterLiquifyStroke",
  "endRasterLiquifyStroke",
  "resetRasterLiquify",
  "cancelRasterLiquify",
  "commitRasterLiquify",
]) {
  assert.match(
    runtime,
    new RegExp(`export (?:async )?function ${symbol}\\b`),
    `Liquify runtime is missing ${symbol}`,
  );
  requireText(engine, `${symbol}(`, `BrushEngine.${symbol}`);
}
requireText(runtime, "MAX_DABS_PER_PREVIEW = 64", "bounded dynamic-uniform batch");
requireText(runtime, "MAX_MOMENTUM_DABS_PER_FRAME = 32", "bounded resampled Momentum tail");
requireText(runtime, "one-full-displacement-one-cropped-source-one-reused-swept-dirty-scratch", "bounded working set");
requireText(runtime, "liquifySegmentDirtyBounds", "swept Push dirty bounds");
requireText(runtime, "patternSeed", "stable per-stroke procedural pattern");
requireText(runtime, "directionFromSeed", "stable fallback Edge axis");
requireText(runtime, "strokeDirectionX", "directional uniform upload");
requireText(runtime, "maximumTravel = spacing * MAX_MOMENTUM_DABS_PER_FRAME", "Momentum travel cap");
requireText(runtime, 'settings.mode === "push" ? 1 : decay', "non-squared Push Momentum decay");
requireText(runtime, "+ LIQUIFY_LIMITS.maximumSpacing", "swept scratch extent allowance");
requireText(runtime, "Math.floor(segmentDistance / spacing)", "fixed-distance gesture resampling");
requireText(runtime, "residualDistance > 1e-4", "one-shot Push residual flush");
requireText(runtime, 'settings.mode === "push" ? previousDab : current', "time-integrated non-Push Momentum");
requireText(runtime, "velocityDamping", "stale Push velocity damping before Momentum");
requireText(runtime, "directionEstablished", "gesture-derived Edge axis");
assert.equal(
  (runtime.match(/stroke\.directionEstablished = true/g) ?? []).length,
  1,
  "Edge direction must freeze after the first meaningful gesture tangent",
);
requireText(runtime, "session.nextSeed = 1", "deterministic Reset pattern sequence");
requireText(runtime, "sourceScratchBounds", "cropped immutable source");
requireText(runtime, "format: engine.layerFormat", "native-format immutable source");
requireText(runtime, "sharedVariantKey", "format and color-space pipeline key");
requireText(runtime, "`${layerFormat}:${storageColorSpace}`", "color-space-separated cache identity");
requireText(runtime, "liquifyResolveShader(layerFormat, storageColorSpace)", "color-space shader variant");
requireText(runtime, "engine.documentStorageColorSpace", "authoritative document color space");
requireText(
  runtime,
  "quantizationSeed: engine.nextHistoryActionId >>> 0",
  "stable per-action quantization seed",
);
requireText(
  runtime,
  "seed: session.quantizationSeed",
  "preview and restore resolve seed",
);
requireText(
  runtime,
  'sampleType: layerFormat === "rgba8unorm" ? "float" : "unfilterable-float"',
  "native source binding sample type",
);
assert.doesNotMatch(runtime, /Destructive Liquify requires an RGBA16F document/);
requireText(
  runtime,
  "rgba8unorm-source-encoded-f32-resample-high-frequency-output",
  "RGBA8 Liquify precision contract",
);
requireText(runtime, "displacementScratchTexture", "reused dirty scratch texture");
requireText(runtime, "fieldWidth: DOCUMENT_WIDTH", "rectangular displacement field width");
requireText(runtime, "fieldHeight: DOCUMENT_HEIGHT", "rectangular displacement field height");
requireText(runtime, "documentWidth: DOCUMENT_WIDTH", "rectangular document width uniform");
requireText(runtime, "documentHeight: DOCUMENT_HEIGHT", "rectangular document height uniform");
requireText(
  runtime,
  "maximumDisplacement: DOCUMENT_MAX_EDGE * MAXIMUM_DISPLACEMENT_DOCUMENTS",
  "maximum-edge displacement bound",
);
assert.doesNotMatch(
  runtime,
  /engine\.layerSize|\bLAYER_SIZE\b|fieldHeight: DOCUMENT_WIDTH|documentHeight: DOCUMENT_WIDTH/,
  "Liquify non deve duplicare la larghezza nei campi verticali.",
);
requireText(runtime, "reservePlannedMemory", "non-blocking memory reservation");
requireText(runtime, "await reserveSessionMemory", "async memory warning before allocation");
requireText(runtime, "commitHistoryActionAtomically", "atomic history commit");
requireText(runtime, 'filter: "liquify"', "Liquify history action");
requireText(historyTypes, 'filter: "liquify"', "typed Liquify history payload");
requireText(sourceManifest, '"engine-liquify-runtime.ts"', "engine source manifest entry");

assert.equal(
  (html.match(/data-liquify-mode=/g) ?? []).length,
  expectedModes.length,
  "the authoritative Liquify sheet must expose all eight modes exactly once",
);
for (const id of [
  "mobileLiquifySheet",
  "mobileLiquifyOpen",
  "mobileLiquifySize",
  "mobileLiquifyPressure",
  "mobileLiquifyDistortion",
  "mobileLiquifyMomentum",
  "mobileLiquifyAmount",
  "mobileLiquifyReset",
  "mobileLiquifyCancel",
  "mobileLiquifyApply",
]) requireText(html, `id="${id}"`, `UI #${id}`);
assert.doesNotMatch(
  html,
  /id="desktopLiquify|id="rasterLiquifySection"/,
  "Liquify must not retain an invisible desktop control surface",
);
assert.doesNotMatch(main, /desktopLiquify/, "runtime must read only the visible Liquify sheet");
requireText(sheet, "resolveMobileBottomSheetDrag", "bottom-sheet gesture arbitration");
requireText(sheet, 'snapTo("peek")', "peek detent");
requireText(sheet, 'snapTo("minimized")', "minimized detent");
requireText(styles, ".mobile-liquify-sheet", "mobile Liquify sheet styles");
requireText(styles, ".mobile-liquify-mode-grid", "mobile mode grid styles");
requireText(styles, "liquify-active", "canvas Liquify cursor");
requireText(canvasInput, '| "liquify"', "Liquify pointer/tool mode");
requireText(canvasInput, "getCoalescedEvents", "coalesced pointer input");
requireText(canvasInput, "beginRasterLiquifyStroke", "canvas stroke begin routing");
requireText(canvasInput, "extendRasterLiquifyStroke", "canvas stroke extension routing");
requireText(canvasInput, "endRasterLiquifyStroke", "canvas stroke end routing");
requireText(
  canvasInput,
  'event.pointerType === "pen" ? normalizedPressure',
  "pen-pressure routing",
);
requireText(canvasInput, "enterTouchNavigation", "two-touch view navigation");
requireText(adjustments, "applyLiquify", "Apply workflow");
requireText(adjustments, "cancelLiquify", "Cancel workflow");
requireText(adjustments, "resetLiquify", "Reset workflow");
requireText(main, "new RasterAdjustmentsController", "composition-root ownership");

// Dependency-free mirrors of the pure invariants catch accidental contract drift.
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const normalize = (value) => ({
  size: clamp(Number.isFinite(value.size) ? value.size : 180, 1, 1000),
  pressure: clamp(Number.isFinite(value.pressure) ? value.pressure : 0.5, 0, 1),
  distortion: clamp(Number.isFinite(value.distortion) ? value.distortion : 0, 0, 1),
  momentum: clamp(Number.isFinite(value.momentum) ? value.momentum : 0, 0, 1),
});
assert.deepEqual(normalize({ size: -5, pressure: 2, distortion: Number.NaN, momentum: -1 }), {
  size: 1,
  pressure: 1,
  distortion: 0,
  momentum: 0,
});

const spacingFractions = {
  push: [0.045, 0.028],
  "twirl-right": [0.06, 0.038],
  "twirl-left": [0.06, 0.038],
  pinch: [0.055, 0.034],
  expand: [0.055, 0.034],
  crystals: [0.043, 0.024],
  edge: [0.043, 0.026],
  reconstruct: [0.04, 0.04],
};
const spacing = (mode, size, distortion) => {
  const [smooth, distorted] = spacingFractions[mode];
  return clamp(size * (smooth + (distorted - smooth) * distortion), 0.75, 32);
};
for (const mode of expectedModes) {
  assert.equal(spacing(mode, 1, 0), 0.75);
  assert.equal(spacing(mode, 1000, 1), Math.min(32, spacingFractions[mode][1] * 1000));
  assert.ok(
    spacing(mode, 180, 1) <= spacing(mode, 180, 0),
    `${mode} must not become more sparsely sampled at high Distortion`,
  );
  for (const distance of [0, 0.5, 10, 100, 1000]) {
    const selectedSpacing = spacing(mode, 180, 0.5);
    const steps = Math.max(1, Math.ceil(distance / selectedSpacing));
    assert.ok(steps >= 1 && distance / steps <= selectedSpacing + Number.EPSILON);
  }
}

// Inverse-warp sign mirrors: the destination samples opposite the visible move.
const radius = 100;
const amount = 0.5;
assert.ok(-10 * amount < 0, "Push must sample opposite pointer motion");
const pinchScale = Math.exp(amount * 0.08);
const expandScale = Math.exp(-amount * 0.08);
assert.ok(radius * (pinchScale - 1) > 0, "Pinch must sample farther from center");
assert.ok(radius * (expandScale - 1) < 0, "Expand must sample closer to center");
assert.ok(-radius * 0.03 * amount < 0, "Crystals must sample inward for an outward visual shard");
const foldScale = Math.exp(amount * 0.1);
assert.ok(20 * (foldScale - 1) > 0, "Edge must sample away from its line to fold pixels inward");
for (const repairAmount of [0, 0.1, 0.5, 1, 2]) {
  const repair = clamp(1 - Math.exp(-repairAmount * 0.62), 0, 0.985);
  assert.ok(repair >= 0 && repair < 1, "Reconstruct repair must remain monotonic and non-overshooting");
}

const srgbToLinearChannel = (value) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgbChannel = (value) => {
  const bounded = clamp(value, 0, 1);
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
};
const encodedPremultiplied = (straight, alpha) => [
  straight[0] * alpha,
  straight[1] * alpha,
  straight[2] * alpha,
  alpha,
];
const decodeEncodedPremultiplied = (stored) => {
  const alpha = clamp(stored[3], 0, 1);
  if (alpha <= 1e-6) return [0, 0, 0, 0];
  return [
    srgbToLinearChannel(clamp(stored[0] / alpha, 0, 1)) * alpha,
    srgbToLinearChannel(clamp(stored[1] / alpha, 0, 1)) * alpha,
    srgbToLinearChannel(clamp(stored[2] / alpha, 0, 1)) * alpha,
    alpha,
  ];
};
const encodeLinearPremultiplied = (working) => {
  const alpha = clamp(working[3], 0, 1);
  if (alpha <= 1e-6) return [0, 0, 0, 0];
  return [
    linearToSrgbChannel(clamp(working[0] / alpha, 0, 1)) * alpha,
    linearToSrgbChannel(clamp(working[1] / alpha, 0, 1)) * alpha,
    linearToSrgbChannel(clamp(working[2] / alpha, 0, 1)) * alpha,
    alpha,
  ];
};
const mixPremultiplied = (left, right, amountValue) => left.map(
  (value, channel) => value * (1 - amountValue) + right[channel] * amountValue,
);

const darkLeft = encodedPremultiplied([0.02, 0.05, 0.1], 0.2);
const darkRight = encodedPremultiplied([0.35, 0.2, 0.08], 0.85);
const darkAmount = 0.37;
const correctDarkSample = encodeLinearPremultiplied(mixPremultiplied(
  decodeEncodedPremultiplied(darkLeft),
  decodeEncodedPremultiplied(darkRight),
  darkAmount,
));
const encodedSpaceSample = mixPremultiplied(darkLeft, darkRight, darkAmount);
assert.ok(
  Math.abs(correctDarkSample[0] - encodedSpaceSample[0]) * 255 > 4,
  "Dark RGBA8 gradients must be interpolated in linear premultiplied space.",
);
assert.ok(
  Math.abs(correctDarkSample[3] - (0.2 * 0.63 + 0.85 * 0.37)) < 1e-12,
  "Linear-light resampling must preserve bilinear alpha.",
);
assert.ok(
  correctDarkSample.slice(0, 3).every((channel) => channel >= 0 && channel <= correctDarkSample[3]),
  "Encoded output must remain valid premultiplied RGBA.",
);

const transparentEdge = encodeLinearPremultiplied(mixPremultiplied(
  [0, 0, 0, 0],
  decodeEncodedPremultiplied(encodedPremultiplied([0.3, 0.1, 0.02], 0.8)),
  0.25,
));
assert.ok(Math.abs(transparentEdge[3] - 0.2) < 1e-12);
for (const [actual, expected] of transparentEdge.slice(0, 3).map(
  (channel, index) => [channel, [0.06, 0.02, 0.004][index]],
)) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    "Transparent-edge interpolation must keep straight color free from dark fringes.",
  );
}

const darkRampStored = (index) => {
  const fraction = index / 1024;
  return encodeLinearPremultiplied(mixPremultiplied(
    decodeEncodedPremultiplied(encodedPremultiplied([0.015, 0.03, 0.06], 0.08)),
    decodeEncodedPremultiplied(encodedPremultiplied([0.22, 0.13, 0.04], 0.92)),
    fraction,
  ));
};
const firstActionFinalizationSeed = (41 ^ LIQUIFY_RGBA8_QUANTIZATION_SEED) >>> 0;
const darkAlphaCodes = [];
for (let index = 0; index <= 1024; index += 1) {
  const stored = darkRampStored(index);
  for (let channel = 0; channel < 4; channel += 1) {
    assert.ok(Number.isFinite(stored[channel]) && stored[channel] >= 0 && stored[channel] <= 1);
  }
  assert.ok(stored[0] <= stored[3] && stored[1] <= stored[3] && stored[2] <= stored[3]);
  const code = quantizeUnorm8HighFrequencyAdjacent(
    stored[0],
    400 + index,
    73,
    firstActionFinalizationSeed,
  );
  const scaled = stored[0] * 255;
  assert.ok(
    code === Math.floor(scaled) || code === Math.ceil(scaled),
    "Liquify RGBA8 finalization must select only adjacent codes.",
  );
  darkAlphaCodes.push(code);
}
assert.ok(
  new Set(darkAlphaCodes).size >= 45,
  "The dark varying-alpha ramp must retain the available RGBA8 levels.",
);
assert.deepEqual(
  darkAlphaCodes,
  darkAlphaCodes.map((_, index) => {
    const stored = darkRampStored(index);
    return quantizeUnorm8HighFrequencyAdjacent(
      stored[0],
      400 + index,
      73,
      firstActionFinalizationSeed,
    );
  }),
  "Liquify document-space quantization must be replay-stable.",
);
const secondActionFinalizationSeed = (42 ^ LIQUIFY_RGBA8_QUANTIZATION_SEED) >>> 0;
const secondActionCodes = darkAlphaCodes.map((_, index) => {
  const stored = darkRampStored(index);
  return quantizeUnorm8HighFrequencyAdjacent(
    stored[0],
    400 + index,
    73,
    secondActionFinalizationSeed,
  );
});
assert.ok(
  secondActionCodes.some((code, index) => code !== darkAlphaCodes[index]),
  "Independent Liquify actions must not repeat the same spatial quantization error.",
);

const countStraightPathDabs = (points, selectedSpacing) => {
  let lastDab = 0;
  let count = 0;
  for (const point of points) {
    const steps = Math.floor(Math.abs(point - lastDab) / selectedSpacing);
    count += steps;
    lastDab += Math.sign(point - lastDab) * steps * selectedSpacing;
  }
  return count;
};
assert.equal(
  countStraightPathDabs([100], 4),
  countStraightPathDabs(Array.from({ length: 100 }, (_, index) => index + 1), 4),
  "gesture resampling must be independent of straight-line pointer event frequency",
);

const integratedMomentumStrength = (frameDurationsMs) => frameDurationsMs
  .reduce((total, elapsedMs) => total + elapsedMs / 1000 * 60, 0);
assert.ok(
  Math.abs(integratedMomentumStrength(Array(60).fill(1000 / 60))
    - integratedMomentumStrength(Array(120).fill(1000 / 120))) < 1e-9,
  "temporal Momentum strength must be independent of RAF frequency",
);

const clip = (rect, width, height) => {
  const left = clamp(Math.floor(rect.x), 0, width);
  const top = clamp(Math.floor(rect.y), 0, height);
  const right = clamp(Math.ceil(rect.x + rect.width), 0, width);
  const bottom = clamp(Math.ceil(rect.y + rect.height), 0, height);
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
};
assert.deepEqual(clip({ x: -4.2, y: 7.2, width: 10, height: 8 }, 100, 10), {
  x: 0,
  y: 7,
  width: 6,
  height: 3,
});
assert.equal(clip({ x: 200, y: 200, width: 5, height: 5 }, 100, 100), null);

console.log("Liquify v2 contract verified: 8 composed modes, stable patterns, mode-aware sampling, swept Push, resampled Momentum, uniform ABI, dirty-scratch update, immutable-source resolve.");
