import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const stampUploadSource = readFileSync("src/engine-stamp-upload.ts", "utf8");
const brushShaderSource = readFileSync("src/shaders.ts", "utf8");
const blendRendererSource = readFileSync("src/blend-renderer.ts", "utf8");
const blendShaderSource = readFileSync("src/blend-shaders.ts", "utf8");

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let color;
let adaptive;
let uploads;
let defaults;
try {
  color = await server.ssrLoadModule("/src/brush-color.ts");
  adaptive = await server.ssrLoadModule("/src/adaptive-preview-runtime.ts");
  uploads = await server.ssrLoadModule("/src/engine-stamp-upload.ts");
  defaults = await server.ssrLoadModule("/src/engine-types.ts");
} finally {
  await server.close();
}

assert.deepEqual(color.parseBrushColorSrgb("#123456"), [0x12 / 255, 0x34 / 255, 0x56 / 255]);
assert.deepEqual(
  color.parseBrushColorSrgb("#123412341234"),
  [0x1234 / 65_535, 0x1234 / 65_535, 0x1234 / 65_535],
);
assert.equal(color.canonicalBrushColor16("#123456"), "#121234345656");
assert.equal(color.brushColorCssHex("#ff805b803580"), "#ff5b35");
assert.equal(
  color.canonicalBrushColorForFormat("#ff5b35", "r16float"),
  "#ffff5b5b3535",
);

const authored = "#800180018001";
const r16Settings = {
  ...defaults.defaultBrushSettings,
  color: authored,
  shapeMaskFormat: "r16float",
  hueJitterDegrees: 0,
  saturationJitter: 0,
  lightnessJitter: 0,
  darknessJitter: 0,
};
const r8Settings = { ...r16Settings, shapeMaskFormat: "r8unorm" };
const authoredChannel = 0x8001 / 65_535;
const diagnosticChannel = 0x80 / 255;
assert.deepEqual(color.brushColorSrgb(r16Settings), [authoredChannel, authoredChannel, authoredChannel]);
assert.deepEqual(
  color.brushColorSrgb(r8Settings),
  [diagnosticChannel, diagnosticChannel, diagnosticChannel],
);
assert.notEqual(authoredChannel, diagnosticChannel);
assert.notEqual(
  color.brushColorLinearRgb(r16Settings)[0],
  color.brushColorLinearRgb(r8Settings)[0],
  "Blend must receive the same precision-selected color as Paint.",
);

const r16Preview = adaptive.adaptivePreviewSrgb(0, r16Settings);
const r8Preview = adaptive.adaptivePreviewSrgb(0, r8Settings);
assert(Math.abs(r16Preview[0] - authoredChannel) < 1e-12);
assert(Math.abs(r8Preview[0] - diagnosticChannel) < 1e-12);
assert.notEqual(Math.round(r16Preview[0] * 255) / 255, r16Preview[0]);

const r16Upload = new ArrayBuffer(256);
const r8Upload = new ArrayBuffer(256);
uploads.populateBrushUniformUpload(r16Upload, r16Settings, 64, 64, 0, 0);
uploads.populateBrushUniformUpload(r8Upload, r8Settings, 64, 64, 0, 0);
const r16Floats = new Float32Array(r16Upload);
const r8Floats = new Float32Array(r8Upload);
assert(Math.abs(r16Floats[6] - authoredChannel) < 1e-7);
assert(Math.abs(r8Floats[6] - diagnosticChannel) < 1e-7);
assert.notEqual(r16Floats[6], r8Floats[6]);

assert.equal(defaults.defaultBrushSettings.shapeMaskFormat, "r16float");
assert.match(defaults.defaultBrushSettings.color, /^#[0-9a-f]{12}$/i);
assert.notEqual(
  color.canonicalBrushColor16(color.brushColorCssHex(defaults.defaultBrushSettings.color)),
  defaults.defaultBrushSettings.color,
  "The native default must contain channel values outside the 8-bit grid.",
);

assert.throws(() => color.parseBrushColorSrgb("#12345"), /Invalid brush HEX color/);

assert.match(
  stampUploadSource,
  /shapeMaskFormat === "r8unorm" \? 2 : 0/,
  "Paint must encode the 8-bit comparison without changing GPU formats.",
);
assert.match(brushShaderSource, /fn sourcePrecisionCoverage[\s\S]*?round\(continuous \* 255\.0\) \/ 255\.0/);
assert.match(
  blendRendererSource,
  /filtering\s*\|\s*\(settings\.shapeMaskFormat === "r8unorm" \? 4 : 0\)/,
  "Blend must carry the same precision comparison flag.",
);
assert.match(blendShaderSource, /fn sourcePrecisionCoverage[\s\S]*?DIAGNOSTIC_8_BIT_FLAG/);

console.log("Brush color 8-bit/16-bit A/B checks passed.");
