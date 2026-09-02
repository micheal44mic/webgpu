import assert from "node:assert/strict";
import {
  DEFAULT_LAYER_BLEND_MODE,
  LAYER_BLEND_MODE_CATEGORIES,
  LAYER_BLEND_MODE_CODES,
  LAYER_BLEND_MODE_LABELS,
  LAYER_BLEND_MODE_ORDER,
  LAYER_BLEND_MODE_STRATEGY,
  LAYER_BLEND_MODE_WGSL,
  LEGACY_LAYER_BLEND_MODE_MIGRATIONS,
  blendLayerPremultipliedEncodedSrgb,
  blendLayerPremultipliedLinear,
  blendLayerSrgb,
  dissolveLayerSourcePremultipliedLinear,
  isLayerBlendMode,
  layerBlendDissolveRandom,
  migrateLegacyLayerBlendMode,
  normalizeLayerBlendMode,
} from "../src/layer-blend-modes.ts";

const EXPECTED_ORDER = [
  "normal", "dissolve",
  "multiply", "darken", "color-burn", "linear-burn", "darker-color",
  "lighten", "screen", "color-dodge", "add", "lighter-color",
  "overlay", "soft-light", "hard-light", "vivid-light", "linear-light", "pin-light", "hard-mix",
  "difference", "exclusion", "subtract", "divide",
  "hue", "saturation", "color", "luminosity",
];

assert.equal(
  LAYER_BLEND_MODE_STRATEGY,
  "srgb-blends-dual-premultiplied-storage-w3c-alpha-document-anchored-dissolve-v3",
);
assert.equal(DEFAULT_LAYER_BLEND_MODE, "normal");
assert.deepEqual(LAYER_BLEND_MODE_ORDER, EXPECTED_ORDER);
assert.equal(new Set(LAYER_BLEND_MODE_ORDER).size, 27);
assert.deepEqual(
  LAYER_BLEND_MODE_CATEGORIES.flatMap((category) => category.modes),
  EXPECTED_ORDER,
);
const EXPECTED_CODES = {
  multiply: 0, darken: 1, dissolve: 2,
  "color-burn": 3, "linear-burn": 4, "darker-color": 5,
  normal: 6, lighten: 7, screen: 8, "color-dodge": 9,
  add: 10, "lighter-color": 11, overlay: 12, "soft-light": 13,
  "hard-light": 14, "vivid-light": 15, "linear-light": 16,
  "pin-light": 17, "hard-mix": 18, difference: 19, exclusion: 20,
  subtract: 21, divide: 22, hue: 23, saturation: 24, color: 25,
  luminosity: 26,
};
for (const mode of EXPECTED_ORDER) {
  assert.equal(LAYER_BLEND_MODE_CODES[mode], EXPECTED_CODES[mode], `${mode} code`);
  assert.ok(LAYER_BLEND_MODE_LABELS[mode]?.length > 0, `${mode} label`);
  assert.equal(isLayerBlendMode(mode), true);
}
assert.equal(isLayerBlendMode("dissolve"), true);
assert.equal(isLayerBlendMode("shade"), false);
assert.equal(normalizeLayerBlendMode("multiply"), "multiply");
assert.equal(normalizeLayerBlendMode("unknown"), "normal");
assert.equal(normalizeLayerBlendMode(null), "normal");
assert.equal(normalizeLayerBlendMode("shade"), "darken");
assert.deepEqual(LEGACY_LAYER_BLEND_MODE_MIGRATIONS, { shade: "darken" });
assert.equal(migrateLegacyLayerBlendMode("shade"), "darken");
assert.equal(migrateLegacyLayerBlendMode("dissolve"), "dissolve");
assert.equal(migrateLegacyLayerBlendMode("unknown"), null);

const clamp = (value) => Math.min(1, Math.max(0, value));
const close = (actual, expected, epsilon = 2e-12, label = "") => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${label}: ${actual} != ${expected} (epsilon ${epsilon})`,
  );
};
const closeArray = (actual, expected, epsilon = 2e-12, label = "") => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index], epsilon, `${label}[${index}]`));
};

// Independent scalar/vector oracle following the published W3C equations.
const lum = (color) => 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];
const total = (color) => color[0] + color[1] + color[2];
const sat = (color) => Math.max(...color) - Math.min(...color);
const oracleClip = (input) => {
  const lightness = lum(input);
  const minimum = Math.min(...input);
  const maximum = Math.max(...input);
  let color = [...input];
  if (minimum < 0) {
    color = lightness > minimum
      ? color.map((channel) => lightness + (channel - lightness) * lightness / (lightness - minimum))
      : [0, 0, 0];
  }
  if (maximum > 1) {
    color = maximum > lightness
      ? color.map((channel) => lightness + (channel - lightness) * (1 - lightness) / (maximum - lightness))
      : [1, 1, 1];
  }
  return color.map(clamp);
};
const oracleSetLum = (color, target) => {
  const delta = target - lum(color);
  return oracleClip(color.map((channel) => channel + delta));
};
const oracleSetSat = (color, target) => {
  const minimum = Math.min(...color);
  const maximum = Math.max(...color);
  if (maximum <= minimum) return [0, 0, 0];
  return color.map((channel) => (channel - minimum) * clamp(target) / (maximum - minimum));
};
const burn = (base, blend) => base >= 1 ? 1 : blend <= 0 ? 0 : 1 - Math.min(1, (1 - base) / blend);
const dodge = (base, blend) => base <= 0 ? 0 : blend >= 1 ? 1 : Math.min(1, base / (1 - blend));
const soft = (base, blend) => {
  if (blend <= 0.5) return base - (1 - 2 * blend) * base * (1 - base);
  const curve = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(base);
  return base + (2 * blend - 1) * (curve - base);
};
const vivid = (base, blend) => blend <= 0.5 ? burn(base, 2 * blend) : dodge(base, 2 * blend - 1);
const channels = (backdrop, source, operation) => backdrop.map((base, index) => operation(base, source[index]));
const oracleBlend = (backdrop, source, mode) => {
  switch (mode) {
    case "dissolve": return source;
    case "multiply": return channels(backdrop, source, (base, blend) => base * blend);
    case "darken": return channels(backdrop, source, Math.min);
    case "color-burn": return channels(backdrop, source, burn);
    case "linear-burn": return channels(backdrop, source, (base, blend) => Math.max(0, base + blend - 1));
    case "darker-color": return total(source) < total(backdrop) ? source : backdrop;
    case "normal": return source;
    case "lighten": return channels(backdrop, source, Math.max);
    case "screen": return channels(backdrop, source, (base, blend) => base + blend - base * blend);
    case "color-dodge": return channels(backdrop, source, dodge);
    case "add": return channels(backdrop, source, (base, blend) => Math.min(1, base + blend));
    case "lighter-color": return total(source) > total(backdrop) ? source : backdrop;
    case "overlay": return channels(backdrop, source, (base, blend) =>
      base <= 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend));
    case "soft-light": return channels(backdrop, source, soft);
    case "hard-light": return channels(backdrop, source, (base, blend) =>
      blend <= 0.5 ? 2 * base * blend : 1 - 2 * (1 - base) * (1 - blend));
    case "vivid-light": return channels(backdrop, source, vivid);
    case "linear-light": return channels(backdrop, source, (base, blend) => clamp(base + 2 * blend - 1));
    case "pin-light": return channels(backdrop, source, (base, blend) =>
      blend <= 0.5 ? Math.min(base, 2 * blend) : Math.max(base, 2 * blend - 1));
    case "hard-mix": return channels(backdrop, source, (base, blend) => vivid(base, blend) < 0.5 ? 0 : 1);
    case "difference": return channels(backdrop, source, (base, blend) => Math.abs(base - blend));
    case "exclusion": return channels(backdrop, source, (base, blend) => base + blend - 2 * base * blend);
    case "subtract": return channels(backdrop, source, (base, blend) => Math.max(0, base - blend));
    case "divide": return channels(backdrop, source, (base, blend) => blend <= 0 ? 1 : Math.min(1, base / blend));
    case "hue": return oracleSetLum(oracleSetSat(source, sat(backdrop)), lum(backdrop));
    case "saturation": return oracleSetLum(oracleSetSat(backdrop, sat(source)), lum(backdrop));
    case "color": return oracleSetLum(source, lum(backdrop));
    case "luminosity": return oracleSetLum(backdrop, lum(source));
    default: throw new Error(`Unhandled oracle mode ${mode}`);
  }
};

const srgbToLinear = (value) => {
  const channel = clamp(value);
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (value) => {
  const channel = clamp(value);
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
};
const sanitizePremultiplied = (rgba) => {
  const alpha = clamp(rgba[3]);
  return [
    Math.min(alpha, Math.max(0, rgba[0])),
    Math.min(alpha, Math.max(0, rgba[1])),
    Math.min(alpha, Math.max(0, rgba[2])),
    alpha,
  ];
};
const oracleDissolveRandom = ([xInput, yInput]) => {
  const x = Math.floor(xInput) | 0;
  const y = Math.floor(yInput) | 0;
  let state = (
    Math.imul(x, 0x9e37_79b9)
    ^ Math.imul(y, 0x85eb_ca6b)
    ^ 0xc2b2_ae35
  ) >>> 0;
  state = Math.imul((state ^ (state >>> 16)) >>> 0, 0x7feb_352d) >>> 0;
  state = Math.imul((state ^ (state >>> 15)) >>> 0, 0x846c_a68b) >>> 0;
  state = (state ^ (state >>> 16)) >>> 0;
  return (state >>> 8) / 0x01_00_00_00;
};
const oracleComposite = (backdropInput, sourceInput, mode, documentPixel = [0, 0]) => {
  const backdrop = sanitizePremultiplied(backdropInput);
  let source = sanitizePremultiplied(sourceInput);
  if (mode === "dissolve") {
    const alpha = source[3];
    source = alpha > 0 && oracleDissolveRandom(documentPixel) < alpha
      ? [source[0] / alpha, source[1] / alpha, source[2] / alpha, 1]
      : [0, 0, 0, 0];
  }
  const backdropAlpha = backdrop[3];
  const sourceAlpha = source[3];
  const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (mode === "normal" || mode === "dissolve") {
    return [
      source[0] + backdrop[0] * (1 - sourceAlpha),
      source[1] + backdrop[1] * (1 - sourceAlpha),
      source[2] + backdrop[2] * (1 - sourceAlpha),
      outputAlpha,
    ];
  }
  const unpremultiply = (rgba) => rgba[3] > 0
    ? rgba.slice(0, 3).map((channel) => channel / rgba[3])
    : [0, 0, 0];
  const blendedLinear = oracleBlend(
    unpremultiply(backdrop).map(linearToSrgb),
    unpremultiply(source).map(linearToSrgb),
    mode,
  ).map(srgbToLinear);
  const overlap = backdropAlpha * sourceAlpha;
  return [
    ...[0, 1, 2].map((channel) =>
      backdrop[channel] * (1 - sourceAlpha)
        + source[channel] * (1 - backdropAlpha)
        + overlap * blendedLinear[channel]),
    outputAlpha,
  ];
};

const oracleCompositeEncoded = (
  backdropInput,
  sourceInput,
  mode,
  documentPixel = [0, 0],
) => {
  const backdrop = sanitizePremultiplied(backdropInput);
  let source = sanitizePremultiplied(sourceInput);
  if (mode === "dissolve") {
    const alpha = source[3];
    source = alpha > 0 && oracleDissolveRandom(documentPixel) < alpha
      ? [source[0] / alpha, source[1] / alpha, source[2] / alpha, 1]
      : [0, 0, 0, 0];
  }
  const backdropAlpha = backdrop[3];
  const sourceAlpha = source[3];
  const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (mode === "normal" || mode === "dissolve") {
    return [
      source[0] + backdrop[0] * (1 - sourceAlpha),
      source[1] + backdrop[1] * (1 - sourceAlpha),
      source[2] + backdrop[2] * (1 - sourceAlpha),
      outputAlpha,
    ];
  }
  const backdropStraight = backdropAlpha > 0
    ? backdrop.slice(0, 3).map((channel) => channel / backdropAlpha)
    : [0, 0, 0];
  const sourceStraight = sourceAlpha > 0
    ? source.slice(0, 3).map((channel) => channel / sourceAlpha)
    : [0, 0, 0];
  const blended = oracleBlend(backdropStraight, sourceStraight, mode);
  return [
    ...[0, 1, 2].map((channel) =>
      backdrop[channel] * (1 - sourceAlpha)
        + source[channel] * (1 - backdropAlpha)
        + backdropAlpha * sourceAlpha * blended[channel]),
    outputAlpha,
  ];
};

const rgbFixtures = [
  [[0.12, 0.48, 0.91], [0.83, 0.27, 0.04]],
  [[0, 0.25, 1], [1, 0.5, 0]],
  [[0.8, 0.2, 0.45], [0.2, 0.8, 0.55]],
  [[0.03, 0.04, 0.05], [0.95, 0.7, 0.1]],
];
for (const mode of EXPECTED_ORDER) {
  for (const [backdrop, source] of rgbFixtures) {
    closeArray(blendLayerSrgb(backdrop, source, mode), oracleBlend(backdrop, source, mode), 2e-12, mode);
  }
}

// Saturated blue has lower weighted luminosity than this gray but a greater
// RGB total. This fixture prevents Darker/Lighter Color from silently using
// the HSL helper intended only for the non-separable component modes.
const compositeBackdrop = [0.2, 0.2, 0.2];
const compositeSource = [0, 0, 1];
assert.deepEqual(
  blendLayerSrgb(compositeBackdrop, compositeSource, "darker-color"),
  compositeBackdrop,
);
assert.deepEqual(
  blendLayerSrgb(compositeBackdrop, compositeSource, "lighter-color"),
  compositeSource,
);
assert.match(LAYER_BLEND_MODE_WGSL, /fn layerBlendChannelTotal/);

const rgbaFixtures = [
  [[0.12, 0.36, 0.63, 0.7], [0.48, 0.09, 0.03, 0.6]],
  [[0, 0, 0, 0], [0.3, 0.2, 0.1, 0.5]],
  [[0.7, 0.4, 0.2, 1], [0.08, 0.32, 0.16, 0.4]],
  [[0.1, 0.2, 0.05, 0.25], [0, 0, 0, 0]],
];
for (const mode of EXPECTED_ORDER) {
  for (const [backdrop, source] of rgbaFixtures) {
    const actual = blendLayerPremultipliedLinear(backdrop, source, mode);
    const expected = oracleComposite(backdrop, source, mode);
    closeArray(actual, expected, 3e-12, `${mode} composite`);
    const expectedAlpha = expected[3];
    close(actual[3], expectedAlpha, 2e-12, `${mode} alpha`);
    assert.ok(actual.slice(0, 3).every((channel) => channel >= 0 && channel <= actual[3] + 1e-12));

    const actualEncoded = blendLayerPremultipliedEncodedSrgb(backdrop, source, mode);
    const expectedEncoded = oracleCompositeEncoded(backdrop, source, mode);
    closeArray(actualEncoded, expectedEncoded, 3e-12, `${mode} encoded composite`);
    assert.ok(
      actualEncoded.slice(0, 3).every(
        (channel) => channel >= 0 && channel <= actualEncoded[3] + 1e-12,
      ),
    );
  }
}

// Dissolve treats effective alpha as a probability, not as gray coverage.
// The hash must be deterministic in document space and statistically uniform.
for (const pixel of [[0, 0], [17, 29], [-3, 41], [4095, 4095]]) {
  close(
    layerBlendDissolveRandom(pixel),
    oracleDissolveRandom(pixel),
    0,
    `dissolve hash ${pixel.join(",")}`,
  );
}
let acceptedPixel = null;
let rejectedPixel = null;
let acceptedCount = 0;
const dissolveAlpha = 0.4;
for (let y = 0; y < 128; y += 1) {
  for (let x = 0; x < 128; x += 1) {
    if (oracleDissolveRandom([x, y]) < dissolveAlpha) {
      acceptedCount += 1;
      acceptedPixel ??= [x, y];
    } else {
      rejectedPixel ??= [x, y];
    }
  }
}
const acceptedRatio = acceptedCount / (128 * 128);
assert.ok(Math.abs(acceptedRatio - dissolveAlpha) < 0.015, acceptedRatio);
assert.ok(acceptedPixel && rejectedPixel);
const probabilisticSource = [0.08, 0.16, 0.24, 0.4];
closeArray(
  dissolveLayerSourcePremultipliedLinear(probabilisticSource, acceptedPixel),
  [0.2, 0.4, 0.6, 1],
  2e-15,
  "accepted dissolve source",
);
assert.deepEqual(
  dissolveLayerSourcePremultipliedLinear(probabilisticSource, rejectedPixel),
  [0, 0, 0, 0],
);
const dissolveBackdrop = [0.3, 0.2, 0.1, 0.8];
closeArray(
  blendLayerPremultipliedLinear(
    dissolveBackdrop,
    probabilisticSource,
    "dissolve",
    acceptedPixel,
  ),
  [0.2, 0.4, 0.6, 1],
  2e-15,
  "accepted dissolve pixel",
);
closeArray(
  blendLayerPremultipliedLinear(
    dissolveBackdrop,
    probabilisticSource,
    "dissolve",
    rejectedPixel,
  ),
  dissolveBackdrop,
  2e-15,
  "rejected dissolve pixel",
);
assert.deepEqual(
  dissolveLayerSourcePremultipliedLinear([0, 0, 0, 0], acceptedPixel),
  [0, 0, 0, 0],
);
assert.deepEqual(
  dissolveLayerSourcePremultipliedLinear([0.2, 0.4, 0.6, 1], rejectedPixel),
  [0.2, 0.4, 0.6, 1],
);

// The requested Normal fast path is exact linear premultiplied source-over.
closeArray(
  blendLayerPremultipliedLinear([0.1, 0.2, 0.3, 0.5], [0.2, 0.1, 0.05, 0.25]),
  [0.275, 0.25, 0.275, 0.625],
  1e-15,
  "normal source-over",
);
// A non-Normal blend must be evaluated in encoded sRGB, not directly in linear.
const encodedMultiply = blendLayerPremultipliedLinear([0.18, 0.18, 0.18, 1], [0.5, 0.5, 0.5, 1], "multiply")[0];
assert.ok(Math.abs(encodedMultiply - 0.09) > 0.001, encodedMultiply);

const wgslConstants = {
  normal: "NORMAL", dissolve: "DISSOLVE", multiply: "MULTIPLY", darken: "DARKEN",
  "color-burn": "COLOR_BURN", "linear-burn": "LINEAR_BURN", "darker-color": "DARKER_COLOR",
  lighten: "LIGHTEN", screen: "SCREEN", "color-dodge": "COLOR_DODGE",
  add: "LINEAR_DODGE_ADD", "lighter-color": "LIGHTER_COLOR", overlay: "OVERLAY",
  "soft-light": "SOFT_LIGHT", "hard-light": "HARD_LIGHT", "vivid-light": "VIVID_LIGHT",
  "linear-light": "LINEAR_LIGHT", "pin-light": "PIN_LIGHT", "hard-mix": "HARD_MIX",
  difference: "DIFFERENCE", exclusion: "EXCLUSION", subtract: "SUBTRACT", divide: "DIVIDE",
  hue: "HUE", saturation: "SATURATION", color: "COLOR", luminosity: "LUMINOSITY",
};
for (const mode of EXPECTED_ORDER) {
  assert.match(
    LAYER_BLEND_MODE_WGSL,
    new RegExp(`const LAYER_BLEND_${wgslConstants[mode]}: u32 = ${LAYER_BLEND_MODE_CODES[mode]}u;`),
  );
}
const compositor = LAYER_BLEND_MODE_WGSL.slice(
  LAYER_BLEND_MODE_WGSL.indexOf("fn layerBlendPremultipliedLinearSourceOver"),
);
assert.ok(compositor.indexOf("if (mode == LAYER_BLEND_NORMAL)") < compositor.indexOf("layerBlendLinearToSrgb("));
assert.match(compositor, /sourcePremultiplied \+ backdropPremultiplied \* \(1\.0 - sourceAlpha\)/);
assert.match(compositor, /sourcePremultiplied \* \(1\.0 - backdropAlpha\)/);
assert.match(compositor, /blendedLinear \* \(backdropAlpha \* sourceAlpha\)/);
assert.match(LAYER_BLEND_MODE_WGSL, /fn layerBlendDissolveRandom\(documentPixel: vec2<i32>\)/);
assert.match(LAYER_BLEND_MODE_WGSL, /fn layerBlendDissolveSource\(/);
assert.match(compositor, /mode == LAYER_BLEND_DISSOLVE/);
assert.match(compositor, /layerBlendDissolveSource\([\s\S]*?documentPixel/);
assert.match(
  LAYER_BLEND_MODE_WGSL,
  /fn layerBlendPremultipliedEncodedSrgbSourceOver\([\s\S]*?let blendedSrgb = layerBlendSrgb\([\s\S]*?blendedSrgb \* \(backdropAlpha \* sourceAlpha\)/,
);

console.log("Layer blend modes verification passed for 27 ordered modes.");
