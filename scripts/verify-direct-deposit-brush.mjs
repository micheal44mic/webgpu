import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let direct;
let generation;
let spatialQuantization;
let gaussianTip;
let paintDabProfile;
let CausalStrokeCurvePlanner;
let defaultBrushSettings;
try {
  direct = await server.ssrLoadModule("/src/direct-deposit-brush-core.ts");
  generation = await server.ssrLoadModule("/src/paint-stamp-generation-core.ts");
  spatialQuantization = await server.ssrLoadModule("/src/rgba8-spatial-quantization.ts");
  gaussianTip = await server.ssrLoadModule("/src/gaussian-brush-tip.ts");
  paintDabProfile = await server.ssrLoadModule("/src/paint-dab-profile.ts");
  ({ CausalStrokeCurvePlanner } = await server.ssrLoadModule("/src/stroke-curve-core.ts"));
  ({ defaultBrushSettings } = await server.ssrLoadModule("/src/engine-types.ts"));
} finally {
  await server.close();
}

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );
};

for (const [diameter, expected] of [
  [1, 50],
  [4, 42.5],
  [16, 23.3333333333],
  [28, 13.3333333333],
  [60, 10],
  [100, 9],
  [200, 6.6666666667],
  [500, 6.6666666667],
]) {
  close(direct.directDepositSpacingPercent(diameter), expected);
}

close(direct.directDepositBaseRadius(100, 0.25), 12.5);
assert.ok(
  direct.directDepositSpacingDistance(100, 0.25)
    < direct.directDepositSpacingDistance(100, 1),
  "Pressure-size spacing must contract with the effective diameter.",
);

const reference = direct.directDepositReferenceSettings(defaultBrushSettings);
assert.equal(reference.blendMode, "light-glaze");
assert.equal(reference.flow, 0.06);
assert.equal(reference.opacity, 1);
assert.equal(reference.count, 1);
assert.equal(reference.color, "#000000");
assert.equal(reference.shapeMaskFormat, "r16float");
assert.equal(reference.grainMode, "off");
assert.equal(reference.tipFalloff, "standard");

const authoredMainProfileSettings = {
  ...defaultBrushSettings,
  tool: "paint",
  shape: "shape",
  shapeAssetId: "pencil-shape",
  shapeAssetIds: ["pencil-shape", "legacy-shape"],
  shapeSequenceMode: "random",
  shapeInvert: true,
  shapeMaskFormat: "r8unorm",
  shapeRotation: "follow-stroke",
  shapeScatter: 0.37,
  grainMode: "moving",
  grainAssetId: "pencil-grain",
  grainScale: 2.25,
  grainMovement: 0.61,
  grainDepth: 0.72,
  grainBrightness: -0.18,
  grainContrast: 0.44,
  grainInvert: true,
  grainFiltering: "improved",
  grainBlendMode: "multiply",
  count: 7,
  spacingPercent: 13.75,
  startThickness: 0.64,
  endThickness: 1.31,
  stabilization: 0.46,
  positionJitterLateral: 0.28,
  positionJitterLinear: 0.73,
  blendMode: "intense-blending",
  hueJitterDegrees: 123,
  saturationJitter: 0.67,
  lightnessJitter: 0.38,
  darknessJitter: 0.49,
  jitterPerCopy: true,
};
const normalizedMainProfileSettings = paintDabProfile.normalizePaintDabProfileSettings(
  "encoded-srgb-rgba8",
  authoredMainProfileSettings,
);
for (const field of [
  "shape",
  "shapeAssetId",
  "shapeAssetIds",
  "shapeSequenceMode",
  "shapeInvert",
  "shapeRotation",
  "shapeScatter",
  "grainMode",
  "grainAssetId",
  "grainScale",
  "grainMovement",
  "grainDepth",
  "grainBrightness",
  "grainContrast",
  "grainInvert",
  "grainFiltering",
  "grainBlendMode",
  "count",
  "spacingPercent",
  "startThickness",
  "endThickness",
  "stabilization",
  "positionJitterLateral",
  "positionJitterLinear",
]) {
  assert.deepEqual(
    normalizedMainProfileSettings[field],
    authoredMainProfileSettings[field],
    `The encoded-sRGB RGBA8 profile must preserve authored ${field}.`,
  );
}
assert.equal(normalizedMainProfileSettings.blendMode, authoredMainProfileSettings.blendMode);
assert.equal(normalizedMainProfileSettings.shapeMaskFormat, "r16float");
assert.deepEqual(
  {
    hueJitterDegrees: normalizedMainProfileSettings.hueJitterDegrees,
    saturationJitter: normalizedMainProfileSettings.saturationJitter,
    lightnessJitter: normalizedMainProfileSettings.lightnessJitter,
    darknessJitter: normalizedMainProfileSettings.darknessJitter,
    jitterPerCopy: normalizedMainProfileSettings.jitterPerCopy,
  },
  {
    hueJitterDegrees: authoredMainProfileSettings.hueJitterDegrees,
    saturationJitter: authoredMainProfileSettings.saturationJitter,
    lightnessJitter: authoredMainProfileSettings.lightnessJitter,
    darknessJitter: authoredMainProfileSettings.darknessJitter,
    jitterPerCopy: authoredMainProfileSettings.jitterPerCopy,
  },
  "The encoded-sRGB RGBA8 profile must preserve authored color dynamics.",
);
for (const blendMode of ["light-glaze", "uniformed-glaze", "intense-blending"]) {
  const normalizedMode = paintDabProfile.normalizePaintDabProfileSettings(
    "encoded-srgb-rgba8",
    { ...authoredMainProfileSettings, blendMode },
  );
  assert.equal(
    normalizedMode.blendMode,
    blendMode,
    `The encoded-sRGB RGBA8 profile must preserve ${blendMode}.`,
  );
  assert.equal(normalizedMode.shapeMaskFormat, "r16float");
}

const directThroughProfileNormalizer = paintDabProfile.normalizePaintDabProfileSettings(
  "direct-deposit-pressure-size",
  authoredMainProfileSettings,
);
assert.deepEqual(
  directThroughProfileNormalizer,
  direct.enforceDirectDepositSettings(authoredMainProfileSettings),
  "The profile dispatcher must preserve the isolated direct-deposit contract exactly.",
);
assert.equal(paintDabProfile.usesOpticalDepthPaintDabProfile("default"), false);
assert.equal(
  paintDabProfile.usesOpticalDepthPaintDabProfile("direct-deposit-pressure-size"),
  true,
);
assert.equal(
  paintDabProfile.usesOpticalDepthPaintDabProfile("encoded-srgb-rgba8"),
  false,
);
assert.equal(paintDabProfile.usesDirectPressureSizePaintDabProfile("default"), false);
assert.equal(
  paintDabProfile.usesDirectPressureSizePaintDabProfile("direct-deposit-pressure-size"),
  true,
);
assert.equal(
  paintDabProfile.usesDirectPressureSizePaintDabProfile("encoded-srgb-rgba8"),
  false,
);
assert.equal(paintDabProfile.usesEncodedSrgbRgba8PaintDabProfile("default"), false);
assert.equal(
  paintDabProfile.usesEncodedSrgbRgba8PaintDabProfile("direct-deposit-pressure-size"),
  false,
);
assert.equal(
  paintDabProfile.usesEncodedSrgbRgba8PaintDabProfile("encoded-srgb-rgba8"),
  true,
);

close(gaussianTip.normalizedGaussianTipCoverage(0), 1, 1e-12);
close(gaussianTip.normalizedGaussianTipCoverage(1), 0, 1e-12);
assert.equal(gaussianTip.normalizedGaussianTipCoverage(1.01), 0);
let previousGaussianCoverage = 1;
for (let sample = 0; sample <= 4096; sample += 1) {
  const radiusSquared = sample / 4096;
  const coverage = gaussianTip.normalizedGaussianTipCoverage(radiusSquared);
  assert.ok(Number.isFinite(coverage));
  assert.ok(coverage >= 0 && coverage <= 1);
  assert.ok(
    coverage <= previousGaussianCoverage + 1e-12,
    "The normalized Gaussian tip must decrease monotonically toward its boundary.",
  );
  previousGaussianCoverage = coverage;
}
close(
  gaussianTip.normalizedGaussianTipCoverage(1 / 9),
  (Math.exp(-0.5) - Math.exp(-4.5)) / (1 - Math.exp(-4.5)),
  1e-12,
);

function simulateRgba8BlackOverWhite(deposit, repetitions) {
  let channel = 255;
  let lastChangingRepetition = 0;
  const levels = new Set([channel]);
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const next = Math.round(channel * (1 - deposit));
    if (next !== channel) lastChangingRepetition = repetition;
    channel = next;
    levels.add(channel);
  }
  return { channel, lastChangingRepetition, uniqueLevels: levels.size };
}

const strictRgba8 = simulateRgba8BlackOverWhite(0.06, 256);
assert.deepEqual(strictRgba8, {
  channel: 8,
  lastChangingRepetition: 54,
  uniqueLevels: 55,
});
assert.equal(
  Math.round(255 * (1 - 0.06) ** 256),
  0,
  "High-precision accumulation must retain the sub-LSB residue until RGBA8 output.",
);

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function roundTiesToEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

function quantizeUnorm8(value) {
  return roundTiesToEven(clampUnit(value) * 255);
}

function srgbToLinearChannel(value) {
  const channel = clampUnit(value);
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbChannel(value) {
  const channel = clampUnit(value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

const encodedStorageRamp = Uint8Array.from(
  { length: 256 },
  (_, code) => quantizeUnorm8(code / 255),
);
assert.deepEqual(
  [...encodedStorageRamp],
  Array.from({ length: 256 }, (_, code) => code),
  "Encoded-sRGB RGBA8 storage must preserve every authored channel code.",
);
assert.equal(new Set(encodedStorageRamp).size, 256);

const linearStorageRoundTripRamp = Uint8Array.from(
  { length: 256 },
  (_, code) => {
    const storedLinearByte = quantizeUnorm8(srgbToLinearChannel(code / 255));
    return quantizeUnorm8(linearToSrgbChannel(storedLinearByte / 255));
  },
);
assert.equal(
  new Set(linearStorageRoundTripRamp).size,
  183,
  "The linear RGBA8 control must expose its reduced encoded-sRGB code set.",
);
assert.deepEqual(
  [...linearStorageRoundTripRamp.slice(0, 13)],
  [0, 0, 0, 0, 0, 0, 0, 13, 13, 13, 13, 13, 13],
  "The low-code control must remain discriminating.",
);

const opticalDepthPerDab = -Math.log1p(-0.06);
const transmittanceAfter256Dabs = Math.exp(-opticalDepthPerDab * 256);
for (let targetCode = 0; targetCode <= 255; targetCode += 1) {
  for (const startingCode of [0, 255]) {
    const resolved = targetCode
      + (startingCode - targetCode) * transmittanceAfter256Dabs;
    assert.equal(
      quantizeUnorm8(resolved / 255),
      targetCode,
      `Optical-depth resolve must converge to code ${targetCode} from ${startingCode}.`,
    );
  }
}

for (const actionId of [0, 1, 47, 255, 65_535]) {
  const ranks = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      ranks.push(spatialQuantization.rgba8SpatialThresholdRank(x, y, actionId));
    }
  }
  assert.deepEqual(
    [...ranks].sort((left, right) => left - right),
    Array.from({ length: 256 }, (_, rank) => rank),
    "Every document-space threshold tile must contain each stratum exactly once.",
  );
}

for (let fractionalCode = 0; fractionalCode < 256; fractionalCode += 1) {
  const scaled = 73 + fractionalCode / 256;
  const normalized = scaled / 255;
  const spatialCodes = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      spatialCodes.push(
        spatialQuantization.quantizeUnorm8SpatialAdjacent(normalized, x, y, 91),
      );
    }
  }
  assert.ok(spatialCodes.every((code) => code === 73 || code === 74));
  assert.equal(
    spatialCodes.filter((code) => code === 74).length,
    fractionalCode,
    "A 16x16 tile must preserve every 1/256 fractional-code step without bands.",
  );

  const actionCodes = Array.from(
    { length: 256 },
    (_, actionId) => spatialQuantization.quantizeUnorm8SpatialAdjacent(
      normalized,
      137,
      509,
      actionId,
    ),
  );
  assert.equal(
    actionCodes.filter((code) => code === 74).length,
    fractionalCode,
    "A fixed document texel must visit all strata over one complete action cycle.",
  );
}

for (let code = 0; code <= 255; code += 1) {
  for (const actionId of [0, 1, 127, 255]) {
    assert.equal(
      spatialQuantization.quantizeUnorm8SpatialAdjacent(
        code / 255,
        19,
        23,
        actionId,
      ),
      code,
      "Spatial quantization must preserve an exact encoded-sRGB code.",
    );
  }
}

for (const actionId of [0, 1, 63, 255]) {
  for (let index = 0; index < 512; index += 1) {
    const alpha = ((index % 255) + 0.375) / 255;
    const components = [alpha * 0.17, alpha * 0.53, alpha * 0.91];
    const quantizedAlpha = spatialQuantization.quantizeUnorm8SpatialAdjacent(
      alpha,
      index * 17,
      index * 31,
      actionId,
    );
    for (const component of components) {
      const quantizedComponent = spatialQuantization.quantizeUnorm8SpatialAdjacent(
        component,
        index * 17,
        index * 31,
        actionId,
      );
      assert.ok(
        quantizedComponent <= quantizedAlpha,
        "A shared RGBA threshold must preserve premultiplied RGB <= alpha.",
      );
    }
  }
}

for (let targetCode = 0; targetCode <= 255; targetCode += 1) {
  for (const startingCode of [0, 255]) {
    let storedCode = startingCode;
    for (let actionId = 1; actionId <= 256; actionId += 1) {
      const composited = targetCode + (storedCode - targetCode) * 0.94;
      storedCode = spatialQuantization.quantizeUnorm8SpatialAdjacent(
        composited / 255,
        19,
        23,
        actionId,
      );
    }
    assert.equal(
      storedCode,
      targetCode,
      `Spatial RGBA8 commits must reach code ${targetCode} from ${startingCode}.`,
    );
  }
}

function sampleStraightSegments(breakpoints) {
  const planner = new CausalStrokeCurvePlanner();
  planner.reset();
  const emitted = [];
  let remaining = direct.directDepositSpacingDistance(100, 1);
  for (let index = 1; index < breakpoints.length; index += 1) {
    const startX = breakpoints[index - 1];
    const endX = breakpoints[index];
    const start = {
      x: startX,
      y: 0,
      pressure: 1 - startX * 0.0075,
      timeMs: startX,
    };
    const end = {
      x: endX,
      y: 0,
      pressure: 1 - endX * 0.0075,
      timeMs: endX,
    };
    remaining = generation.resamplePaintCurveSegmentWithVariableSpacing(
      planner.plan(start.x, start.y, end.x, end.y),
      start,
      end,
      remaining,
      65_536,
      emitted,
      (output, point) => output.push(point),
      (point) => direct.directDepositSpacingDistance(100, point.pressure),
    );
  }
  return { emitted, remaining };
}

const whole = sampleStraightSegments([0, 100]);
const segmented = sampleStraightSegments([0, 7, 19, 37, 61, 82, 100]);
assert.equal(segmented.emitted.length, whole.emitted.length);
segmented.emitted.forEach((point, index) => {
  close(point.x, whole.emitted[index].x, 1e-7);
  close(point.pressure, whole.emitted[index].pressure, 1e-7);
});
close(segmented.remaining, whole.remaining, 1e-7);
close(whole.emitted[0].x, 9, 1e-7);

const engineSource = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const layerRuntimeSource = readFileSync(new URL("src/engine-layer-runtime.ts", root), "utf8");
const runtimeSource = readFileSync(new URL("src/engine-runtime-misc.ts", root), "utf8");
const glazeRuntimeSource = readFileSync(new URL("src/engine-glaze-runtime.ts", root), "utf8");
const memoryModelSource = readFileSync(new URL("src/engine-memory-model.ts", root), "utf8");
const reportsSource = readFileSync(new URL("src/engine-reports.ts", root), "utf8");
const engineTypesSource = readFileSync(new URL("src/engine-types.ts", root), "utf8");
const labSource = readFileSync(new URL("src/labs/rgba8-brush-startup.ts", root), "utf8");
const labControllerSource = readFileSync(new URL("src/labs/rgba8-brush-lab.ts", root), "utf8");
const editorLabsStartupSource = readFileSync(new URL("src/labs/startup.ts", root), "utf8");
const editorLabsSource = readFileSync(new URL("src/labs/editor-labs.ts", root), "utf8");
const humanStrokeLabSource = readFileSync(
  new URL("src/labs/human-stroke-lab.ts", root),
  "utf8",
);
const probeSource = readFileSync(new URL("src/rgba8-accumulation-probe.ts", root), "utf8");
const spatialQuantizationSource = readFileSync(
  new URL("src/rgba8-spatial-quantization.ts", root),
  "utf8",
);
const gaussianTipSource = readFileSync(new URL("src/gaussian-brush-tip.ts", root), "utf8");
const stampUploadSource = readFileSync(new URL("src/engine-stamp-upload.ts", root), "utf8");
const shaderSource = readFileSync(new URL("src/shaders.ts", root), "utf8");
const previewRendererSource = readFileSync(
  new URL("src/brush-stroke-preview-renderer.ts", root),
  "utf8",
);
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const inPlaceShaderSource = readFileSync(
  new URL("src/light-glaze-in-place-commit-shader.ts", root),
  "utf8",
);
assert.match(engineSource, /resamplePaintCurveSegmentWithVariableSpacing\(/);
assert.match(
  engineSource,
  /deferFinalCanonicalPresentation[\s\S]*?displayCompositingColorSpace !== "stored-encoded-srgb"/,
);
assert.match(runtimeSource, /directDepositBaseRadius\(generationSettings\.size, pressure\)/);
assert.match(labSource, /layerFormat: "rgba8unorm"/);
assert.match(labSource, /presentationFormat: "rgba8unorm"/);
assert.match(labSource, /displayCompositingColorSpace: "stored-encoded-srgb"/);
assert.match(
  editorLabsStartupSource,
  /search\.get\("pixelProfile"\) === "encoded-rgba8"/,
);
assert.match(
  editorLabsStartupSource,
  /encodedRgba8Profile[\s\S]*?layerFormat: "rgba8unorm"[\s\S]*?presentationFormat: "rgba8unorm"[\s\S]*?paintDabProfile: "encoded-srgb-rgba8"[\s\S]*?displayCompositingColorSpace: "stored-encoded-srgb"/,
);
assert.match(
  editorLabsStartupSource,
  /const fixedBrushWorkload = search\.get\("fixedWork"\) === "1";/,
  "The fixed-workload switch must remain an explicit URL opt-in.",
);
assert.match(
  editorLabsStartupSource,
  /\.\.\.\(fixedBrushWorkload \? \{ adaptiveSpacingMaxExtraPercentPoints: 0 \} : \{\}\)/,
  "Fixed-workload captures must disable only adaptive spacing escalation.",
);
assert.doesNotMatch(
  editorLabsStartupSource,
  /fixedBrushWorkload[\s\S]{0,240}\bspacingPercent\s*:/,
  "Fixed-workload captures must not replace the authored brush spacing.",
);
assert.match(editorLabsSource, /search\.get\("colorDynamics"\) === "off"/);
assert.match(
  editorLabsSource,
  /colorDynamicsOff[\s\S]*?hueJitterDegrees: 0[\s\S]*?saturationJitter: 0[\s\S]*?lightnessJitter: 0[\s\S]*?darknessJitter: 0/,
);
assert.match(editorLabsSource, /search\.get\("captureOutput"\) === "1"/);
assert.match(editorLabsSource, /captureOutputWitness: captureOutput/);
assert.match(
  humanStrokeLabSource,
  /const effectiveSettings = this\.#engine\.getSettings\(\)/,
);
assert.match(humanStrokeLabSource, /settings: effectiveSettings/);
assert.match(humanStrokeLabSource, /presentationFormat: this\.#engine\.presentationFormat/);
assert.match(humanStrokeLabSource, /paintDabProfile: this\.#engine\.paintDabProfile/);
assert.match(
  humanStrokeLabSource,
  /displayCompositingColorSpace: this\.#engine\.displayCompositingColorSpace/,
);
assert.match(
  humanStrokeLabSource,
  /documentStorageColorSpace: this\.#engine\.documentStorageColorSpace/,
);
assert.match(labControllerSource, /registerCustomShapeAsset\(/);
assert.match(labControllerSource, /shapeMaskFormat: "r16float"/);
assert.match(labControllerSource, /data-tip-profile/);
assert.match(labControllerSource, /value="gaussian"/);
assert.match(labControllerSource, /value="custom-shape"/);
assert.match(labControllerSource, /tipFalloff: "gaussian"/);
assert.match(labControllerSource, /tipProfile,/);
assert.match(probeSource, /format: "rgba8unorm"/);
assert.match(probeSource, /copyTextureToBuffer\(/);
assert.match(probeSource, /spatialOutputBlackOverWhite/);
assert.match(spatialQuantizationSource, /fn rgba8SpatialThresholdRank\(/);
assert.match(spatialQuantizationSource, /fn quantizeRgba8SpatialAdjacent\(/);
assert.match(spatialQuantizationSource, /\(seed \* 159u \+ 47u\) & 255u/);
assert.match(spatialQuantizationSource, /documentCoordinate\.x/);
assert.match(spatialQuantizationSource, /documentCoordinate\.y/);
assert.match(gaussianTipSource, /GAUSSIAN_TIP_EDGE_EXPONENT = 4\.5/);
assert.match(gaussianTipSource, /fn normalizedGaussianTipCoverage\(radiusSquared: f32\)/);
assert.match(stampUploadSource, /settings\.tipFalloff === "gaussian" \? 4 : 0/);
for (const [mode, code] of [
  ["optical-depth-encoded-srgb", 3],
  ["encoded-srgb-light-no-build-up", 4],
  ["linear-stroke-over-encoded-srgb", 5],
  ["encoded-srgb-stroke-over-encoded-srgb", 6],
]) {
  assert.match(
    stampUploadSource,
    new RegExp(`accumulationMode === "${mode}"[\\s\\S]{0,80}\\? ${code}`),
    `${mode} must keep its stable uniform ABI code ${code}.`,
  );
}
assert.equal(
  (shaderSource.match(/\$\{gaussianBrushTipShader\}/g) ?? []).length,
  2,
  "Plain and grain brush programs must share the same analytic Gaussian function.",
);
assert.equal(
  (shaderSource.match(/brush\.options\.z & GAUSSIAN_TIP_FLAG/g) ?? []).length,
  2,
  "Plain and grain round tips must select the Gaussian through the same uniform flag.",
);
assert.match(spatialQuantizationSource, /\(f32\(rank\) \+ 0\.5\) \/ 256\.0/);
assert.match(
  spatialQuantizationSource,
  /fract\(scaled\) > vec4<f32>\(threshold\)/,
  "The spatial resolver may only choose the lower or upper adjacent RGBA8 code.",
);
assert.equal(
  (shaderSource.match(/\$\{rgba8SpatialQuantizationShader\}/g) ?? []).length,
  3,
  "Live display, live mip seed, and fallback commit must share one WGSL quantizer.",
);
assert.equal(
  (inPlaceShaderSource.match(/\$\{rgba8SpatialQuantizationShader\}/g) ?? []).length,
  1,
  "The in-place commit must share the live WGSL quantizer.",
);
assert.ok(
  (shaderSource.match(/quantizeRgba8SpatialAdjacent\(/g) ?? []).length >= 3,
  "Live display, live mip seed, and fallback commit must all quantize mode 3.",
);
assert.match(
  shaderSource,
  /fn compositedLayerTexel[\s\S]*?vec2<u32>\(position\)/,
  "Live presentation must derive its threshold from document texels, not screen pixels.",
);
assert.match(
  shaderSource,
  /fn compositedSource[\s\S]*?vec2<u32>\(sourcePosition\)/,
  "The live mip seed must quantize the same document texels as mip 0 and commit.",
);
for (const source of [shaderSource, inPlaceShaderSource, probeSource, labControllerSource]) {
  assert.doesNotMatch(source, /stratifiedTemporalQuantize|temporal-stratified-no-spatial-noise/);
}
assert.ok(
  (shaderSource.match(/display\.compositingColorSpace > 1\.5/g) ?? []).length >= 2,
  "Live and canonical presentation must both bypass a second sRGB transfer.",
);

assert.match(
  previewRendererSource,
  /const preciseDeposit = light\s*&& usesOpticalDepthPaintDabProfile\(this\.engine\.paintDabProfile\)/,
  "Brush previews must select the same optical-depth profile capability as the canvas.",
);
const previewLightTint = previewRendererSource.match(
  /if \(light && stamps\.length > 0\) \{([\s\S]*?)\n    \}\n    const glazeUpload/,
)?.[1] ?? "";
assert.match(
  previewLightTint,
  /adaptivePreviewSrgb\(\s*previewHash32\(stamps\[0\]\.seed\),\s*settings,\s*\)/,
  "Light previews must derive their deterministic gesture tint through Color Dynamics.",
);
const encodedPreviewTintBranch = previewLightTint.match(
  /if \(preciseDeposit \|\| encodedLight\) \{([\s\S]*?)\}\s*else \{/,
)?.[1] ?? "";
assert.match(
  encodedPreviewTintBranch,
  /tintLinear = \[red, green, blue\]/,
  "Encoded Light previews must pass the deterministic encoded-sRGB tint directly.",
);
assert.doesNotMatch(
  encodedPreviewTintBranch,
  /srgbChannelToLinear/,
  "Encoded preview tint must not receive an extra linear-light conversion.",
);
assert.match(
  previewRendererSource,
  /populateStrokeGlazeUniformUpload\([\s\S]*?preciseDeposit\s*\? "optical-depth-encoded-srgb"/,
  "Brush previews must resolve optical accumulation through mode 3.",
);
for (const mode of [
  "encoded-srgb-light-no-build-up",
  "linear-stroke-over-encoded-srgb",
  "encoded-srgb-stroke-over-encoded-srgb",
]) {
  assert.match(
    previewRendererSource,
    new RegExp(`\\? "${mode}"`),
    `Stored encoded-sRGB preview resolve is missing ${mode}.`,
  );
}
assert.match(
  previewRendererSource,
  /spatialEncodedResolve \? stamps\[0\]\?\.seed \?\? PREVIEW_SEED_SEQUENCE : 0/,
  "Every encoded RGBA8 preview resolve must receive a stable spatial quantization seed.",
);
assert.match(
  previewRendererSource,
  /const readbackBytesPerPixel = this\.engine\.canvasFormat === "rgba8unorm"\s*\? RGBA8_UNORM_BYTES_PER_PIXEL\s*:\s*RGBA16_FLOAT_BYTES_PER_PIXEL/,
  "Preview readback must derive bytes per pixel from the presentation format.",
);
assert.match(
  previewRendererSource,
  /hashPreviewPixels\([\s\S]*?readbackBytesPerRow,\s*readbackBytesPerPixel,/,
  "Preview hashing must consume exactly the format-aware bytes in each row.",
);

assert.match(
  mainSource,
  /const effectivePaintDabProfile:[\s\S]*?effectiveLayerFormat === "rgba8unorm"[\s\S]*?effectiveDisplayCompositingColorSpace === "stored-encoded-srgb"[\s\S]*?\? "encoded-srgb-rgba8"/,
  "The main editor must select the encoded paint profile only for stored encoded-sRGB RGBA8.",
);
assert.match(
  mainSource,
  /const preloadedLinearDocument =[\s\S]*?preloadedDocumentForPixelProfile\?\.colorSpace === "linear-premultiplied";[\s\S]*?const effectiveDisplayCompositingColorSpace =[\s\S]*?: preloadedLinearDocument[\s\S]*?\? "linear-light"[\s\S]*?: "stored-encoded-srgb"/,
  "A preloaded linear document must retain linear compositing instead of receiving the encoded RGBA8 storage contract.",
);
assert.match(
  mainSource,
  /paintDabProfile: effectivePaintDabProfile/,
  "The resolved main profile must reach the brush engine options.",
);
assert.match(
  mainSource,
  /supportedRenderingModes:[\s\S]*?"light-glaze"[\s\S]*?"uniformed-glaze"[\s\S]*?"intense-blending"/,
  "The main RGBA8 brush UI must expose all three certified rendering modes.",
);
assert.match(
  mainSource,
  /colorDynamicsPerCopyRenderingModes:[\s\S]*?"uniformed-glaze"[\s\S]*?"intense-blending"/,
  "Per-copy color dynamics must remain limited to the color-carrying accumulators.",
);
assert.match(
  mainSource,
  /adaptiveSpacingMaxExtraPercentPoints:\s*editorExtensionEngineOptions\.adaptiveSpacingMaxExtraPercentPoints/,
  "The editor extension must forward the deterministic adaptive-spacing cap.",
);
assert.match(
  engineTypesSource,
  /adaptiveSpacingMaxExtraPercentPoints\?: number;/,
  "BrushEngine options must expose the deterministic adaptive-spacing cap.",
);
const adaptiveSpacingInitialization = engineSource.match(
  /const adaptiveSpacingMaximumOverride = options\.adaptiveSpacingMaxExtraPercentPoints;([\s\S]*?)this\.adaptivePreviewVisibleCanvasRequestedDesynchronized/,
)?.[1] ?? "";
assert.match(adaptiveSpacingInitialization, /!Number\.isFinite\(adaptiveSpacingMaximumOverride\)/);
assert.match(adaptiveSpacingInitialization, /adaptiveSpacingMaximumOverride < 0/);
assert.match(adaptiveSpacingInitialization, /adaptiveSpacingMaximumOverride > 20/);
assert.match(
  adaptiveSpacingInitialization,
  /this\.adaptiveSpacingMaxExtraPercentPoints = adaptiveSpacingMaximumOverride\s*\?\? adaptiveSpacingMaxExtraPercentPointsForPlatform\(\)/,
  "A supplied zero cap must survive initialization instead of falling back to the platform policy.",
);
assert.match(
  engineSource,
  /adaptiveSpacingInitialPercent: renderSettings\.spacingPercent,\s*adaptiveSpacingPercent: renderSettings\.spacingPercent,/,
  "Both adaptive-spacing baselines must start from the authored brush spacing.",
);
const adaptiveSpacingEscalation = engineSource.match(
  /private increaseAdaptiveSpacing\([\s\S]*?\n  startAdaptivePreviewProbe\(/,
)?.[0] ?? "";
assert.match(
  adaptiveSpacingEscalation,
  /const maximumSpacingPercent =\s*stroke\.adaptiveSpacingInitialPercent \+ this\.adaptiveSpacingMaxExtraPercentPoints/,
  "Adaptive spacing must be capped relative to the authored stroke spacing.",
);
assert.match(
  adaptiveSpacingEscalation,
  /const nextSpacingPercent = Math\.min\([\s\S]*?if \(nextSpacingPercent <= stroke\.adaptiveSpacingPercent\) \{\s*return;\s*\}[\s\S]*?stroke\.adaptiveSpacingPercent = nextSpacingPercent/,
  "A zero fixed-work cap must return before mutating stroke spacing or telemetry.",
);
const mainCanvasToolAllowlist = mainSource.match(
  /const canvasToolSupportedByDocumentProfile = \(tool: CanvasInputTool\): boolean =>([\s\S]*?);/,
)?.[1] ?? "";
for (const tool of ["paint", "erase", "blend", "clone", "fill", "pan", "shapes", "selection", "transform", "warp", "perspective", "liquify"]) {
  assert.match(
    mainCanvasToolAllowlist,
    new RegExp(`tool === "${tool}"`),
    `The stored encoded-sRGB RGBA8 tool allowlist must include ${tool}.`,
  );
}
const lightAccumulatorPipelineFactory = layerRuntimeSource.match(
  /const preciseDepositProfile = usesOpticalDepthPaintDabProfile[\s\S]*?const lightNoBuildUpPipelinePromise/,
)?.[0] ?? "";
assert.match(
  lightAccumulatorPipelineFactory,
  /entryPoint: preciseDepositProfile[\s\S]*?\? opticalDepthEntryPoint\(fragmentEntryPoint\)[\s\S]*?: fragmentEntryPoint/,
  "Only the direct profile may substitute optical-depth brush entry points.",
);
assert.match(
  lightAccumulatorPipelineFactory,
  /operation: preciseDepositProfile \? "add" : "max"/,
  "Main Light must preserve MAX-per-gesture coverage while direct deposit keeps ADD.",
);
assert.match(
  layerRuntimeSource,
  /const createRgba16FloatGlazePipeline[\s\S]*?format: "rgba16float"/,
  "Uniformed and Intense must retain an RGBA16F transient stroke accumulator.",
);
assert.match(
  engineSource,
  /const accumulatorFormat: GPUTextureFormat = glaze[\s\S]*?"r16float"[\s\S]*?: "rgba16float"[\s\S]*?: this\.layerFormat/,
  "Warm-up must use R16F for Light and RGBA16F for Uniformed/Intense even on RGBA8 layers.",
);
const mainGlazeSubmission = engineSource.match(
  /private submitLightGlazeImmediate\([\s\S]*?\n  private /,
)?.[0] ?? "";
assert.match(
  mainGlazeSubmission,
  /const encodedRgba8 = usesEncodedSrgbRgba8PaintDabProfile\(this\.paintDabProfile\)/,
  "The stroke submit path must identify the main encoded profile explicitly.",
);
assert.match(
  mainGlazeSubmission,
  /adaptivePreviewSrgb\(previewHash32\(firstSeed\), settings\)[\s\S]*?session\.tintLinear = encodedRgba8[\s\S]*?\? \[red, green, blue\][\s\S]*?: \[[\s\S]*?srgbChannelToLinear/,
  "Main encoded Light must retain one seeded encoded tint without another sRGB transfer.",
);
for (const mode of [
  "encoded-srgb-light-no-build-up",
  "linear-stroke-over-encoded-srgb",
  "encoded-srgb-stroke-over-encoded-srgb",
]) {
  assert.match(
    mainGlazeSubmission,
    new RegExp(`\\? "${mode}"`),
    `The canvas stroke submit path is missing ${mode}.`,
  );
}
assert.match(
  mainGlazeSubmission,
  /session\.tintLinear,[\s\S]*?session\.historyActionId/,
  "Main encoded resolves must derive stable quantization from the persisted gesture identity.",
);

const exactCommitAllocation = glazeRuntimeSource.match(
  /const requiresExactCommit = storageMode === "rgba16float-stroke"([\s\S]*?)return \{/,
)?.[0] ?? "";
assert.match(
  exactCommitAllocation,
  /\|\| usesOpticalDepthPaintDabProfile\(engine\.paintDabProfile\)/,
  "Optical-depth R16F accumulation must still request an exact layer-format commit target.",
);
assert.match(
  exactCommitAllocation,
  /\|\| usesEncodedSrgbRgba8PaintDabProfile\(engine\.paintDabProfile\)/,
  "Every main encoded-RGBA8 glaze mode must request an exact layer-format commit target.",
);
assert.match(
  exactCommitAllocation,
  /engine\.lightGlazeInPlaceCommitPipeline[\s\S]*?&& !usesOpticalDepthPaintDabProfile\(engine\.paintDabProfile\)[\s\S]*?&& !usesEncodedSrgbRgba8PaintDabProfile\(engine\.paintDabProfile\)/,
  "Neither encoded profile may select the slow read-write compute commit.",
);
assert.match(
  exactCommitAllocation,
  /commitTileTexture = engine\.device\.createTexture\([\s\S]*?format: engine\.layerFormat,[\s\S]*?GPUTextureUsage\.RENDER_ATTACHMENT \| GPUTextureUsage\.COPY_SRC/,
  "The exact fallback must render directly into one layer-format copy-source tile.",
);
const exactCommitResourceMatch = glazeRuntimeSource.match(
  /export function lightGlazeResourcesMatch\([\s\S]*?\n\}/,
)?.[0] ?? "";
assert.match(
  exactCommitResourceMatch,
  /const exactTileCommitRequired = usesOpticalDepthPaintDabProfile\([\s\S]*?usesEncodedSrgbRgba8PaintDabProfile\([\s\S]*?\(storageMode === "r16float-coverage" && !exactTileCommitRequired\)/,
  "An encoded R16F resource set without an exact commit implementation must not be reusable.",
);

const permanentCommitSource = engineSource.match(
  /private encodeLightGlazePermanentCommit\([\s\S]*?\n  private submitLightGlazeImmediate\(/,
)?.[0] ?? "";
assert.match(
  permanentCommitSource,
  /const preciseDeposit = usesOpticalDepthPaintDabProfile\(this\.paintDabProfile\)[\s\S]*?blendMode === "light-glaze" \|\| blendMode === "m1-glaze"/,
  "The exact commit router must recognize optical Light/M1 strokes.",
);
assert.match(
  permanentCommitSource,
  /const encodedRgba8 = usesEncodedSrgbRgba8PaintDabProfile\(this\.paintDabProfile\)[\s\S]*?!preciseDeposit[\s\S]*?&& !encodedRgba8/,
  "All main encoded Light, Uniformed and Intense strokes must use exact tile commit.",
);
for (const requirement of [
  "LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES",
  "tileIndex >= LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT",
  "tileIndex * LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES",
  "tilePass.setViewport(0, 0, tileWidth, tileHeight, 0, 1)",
  "tilePass.setScissorRect(0, 0, tileWidth, tileHeight)",
  "encoder.copyTextureToTexture(",
]) {
  assert.ok(
    permanentCommitSource.includes(requirement),
    `Exact render-tile commit is missing: ${requirement}`,
  );
}
assert.match(
  permanentCommitSource,
  /\{ texture: this\.lightGlazeCommitTileTexture \}[\s\S]*?\{ texture: this\.layerTexture, origin: \{ x: tileX, y: tileY, z: 0 \} \}[\s\S]*?\{ width: tileWidth, height: tileHeight, depthOrArrayLayers: 1 \}/,
  "Each resolved tile must be copied one-to-one into the matching document rectangle.",
);

const commitTileShaderSource = shaderSource.match(
  /export const lightGlazeCommitTileShader[\s\S]*?export const lightGlazeCompositeShader/,
)?.[0] ?? "";
const displayGlazeShaderSource = shaderSource.match(
  /export const lightGlazeDisplayShader[\s\S]*?export const lightGlazeCompositeMipShader/,
)?.[0] ?? "";
const compositeMipGlazeShaderSource = shaderSource.match(
  /export const lightGlazeCompositeMipShader[\s\S]*?export const lightGlazeCommitTileShader/,
)?.[0] ?? "";
for (const [label, source] of [
  ["render-tile", commitTileShaderSource],
  ["read-write compute", inPlaceShaderSource],
]) {
  assert.match(
    source,
    /1\.0 - exp2\(-max\(accumulatedStroke\.r, 0\.0\)\)/,
    `${label} commit must resolve the same optical-depth coverage.`,
  );
  assert.match(
    source,
    /let compositedEncoded = strokePaint \+ permanentPaint \* \(1\.0 - strokePaint\.a\);/,
    `${label} commit must use the same encoded-sRGB source-over equation.`,
  );
  assert.match(
    source,
    /quantizeRgba8SpatialAdjacent\([\s\S]*?coordinate,[\s\S]*?lightGlaze\.ditherSeed/,
    `${label} commit must use the shared document-space adjacent-code resolver.`,
  );
}
for (const [label, source] of [
  ["live display", displayGlazeShaderSource],
  ["live mip seed", compositeMipGlazeShaderSource],
  ["render-tile commit", commitTileShaderSource],
]) {
  assert.match(
    source,
    /accumulationMode == 4u[\s\S]*?storedLightCoverage\(accumulatedStroke\.r\)/,
    `${label} must resolve main Light from MAX coverage, not optical depth.`,
  );
  assert.match(
    source,
    /accumulationMode == 5u[\s\S]*?linearPremultipliedToEncodedSrgb\(accumulatedStroke\)/,
    `${label} must encode the linear Uniformed accumulator exactly once.`,
  );
  assert.match(
    source,
    /accumulationMode == 3u[\s\S]*?accumulationMode == 4u[\s\S]*?accumulationMode == 5u[\s\S]*?accumulationMode == 6u[\s\S]*?strokePaint \+ permanentPaint \* \(1\.0 - strokePaint\.a\)[\s\S]*?quantizeRgba8SpatialAdjacent/,
    `${label} must source-over and adjacent-code quantize every encoded resolve mode.`,
  );
}
const fixedFunctionGlazeShaderSource = shaderSource.match(
  /export const lightGlazeCompositeShader[\s\S]*?export const layerCompositeShader/,
)?.[0] ?? "";
for (const mode of [2, 3, 4, 5, 6]) {
  assert.match(
    fixedFunctionGlazeShaderSource,
    new RegExp(`accumulationMode == ${mode}u`),
    `Encoded resolve mode ${mode} must be rejected by fixed-function destination blending.`,
  );
}
assert.match(
  commitTileShaderSource,
  /if \(strokePaint\.a <= 0\.0\) \{\s*return permanentPaint;\s*\}/,
  "Empty tile pixels must preserve the permanent RGBA8 texel exactly.",
);
assert.match(
  commitTileShaderSource,
  /let sourcePosition = vec2<i32>\(commitTile\.sourceOrigin\) \+ vec2<i32>\(fragmentPosition\.xy\);[\s\S]*?vec2<u32>\(sourcePosition\)/,
  "The fallback must seed quantization with canonical document coordinates.",
);
assert.match(
  engineSource,
  /const inPlaceCommit = glaze[\s\S]*?&& !usesOpticalDepthPaintDabProfile\(this\.paintDabProfile\)[\s\S]*?&& !usesEncodedSrgbRgba8PaintDabProfile\(this\.paintDabProfile\)[\s\S]*?const tileCommitScratchTexture = glaze && !inPlaceCommit/,
  "Warm-up must compile the same render-tile branch used by both encoded profiles.",
);
assert.match(
  memoryModelSource,
  /includeCommitTile = storageMode === "rgba16float-stroke"[\s\S]*?const commitTileMiB = includeCommitTile/,
  "Memory accounting must retain the legacy default while allowing optical R16F to include its tile.",
);
assert.match(
  engineSource,
  /lightGlazeAdditionalMemoryMiB\([\s\S]*?Boolean\(candidate\.commitTileTexture\)/,
  "Allocation peak accounting must follow the exact resource set, not only accumulator mode.",
);
assert.match(
  reportsSource,
  /engine\.lightGlazeCommitTileTexture[\s\S]*?\? "render-copy-scratch-tile"[\s\S]*?Boolean\(engine\.lightGlazeCommitTileTexture\)/,
  "Runtime reports must expose both the tile strategy and its actual memory cost.",
);

console.log("Direct-deposit RGBA8 brush checks passed.");
