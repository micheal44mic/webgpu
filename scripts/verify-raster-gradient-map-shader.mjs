import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let core;
let shaders;
try {
  core = await server.ssrLoadModule("/src/raster-gradient-map-core.ts");
  shaders = await server.ssrLoadModule("/src/raster-gradient-map-shaders.ts");
} finally {
  await server.close();
}

const { RASTER_GRADIENT_MAP_LUT_SIZE } = core;
const { rasterGradientMapDispatchSize, rasterGradientMapShader } = shaders;

assert.deepEqual(rasterGradientMapDispatchSize(2048, 2048), { x: 256, y: 256 });
assert.deepEqual(rasterGradientMapDispatchSize(17, 9), { x: 3, y: 2 });
assert.deepEqual(rasterGradientMapDispatchSize(Number.NaN, -2), { x: 0, y: 0 });

assert.match(rasterGradientMapShader, /texture_storage_2d<rgba16float, write>/);
assert.match(
  rasterGradientMapShader,
  new RegExp(`array<vec4<f32>, ${RASTER_GRADIENT_MAP_LUT_SIZE}>`),
);
assert.match(rasterGradientMapShader, /@binding\(3\) var<storage, read> gradientLut/);
assert.match(rasterGradientMapShader, /source\.rgb \/ alpha/);
assert.match(rasterGradientMapShader, /dot\(encoded, LUMINANCE_WEIGHTS\)/);
assert.match(rasterGradientMapShader, /parameters\.options\.x != 0u/);
assert.match(rasterGradientMapShader, /ditherOffset\(outputPixel\)/);
assert.match(rasterGradientMapShader, /gradientLut\.colors\[leftIndex\]\.rgb/);
assert.match(rasterGradientMapShader, /gradientLut\.colors\[rightIndex\]\.rgb/);
assert.match(rasterGradientMapShader, /vec4<f32>\(mappedLinear \* alpha, alpha\)/);
assert.match(
  rasterGradientMapShader,
  /outputOrigin:\s*vec2<u32>[\s\S]*_originPadding:\s*vec2<u32>[\s\S]*options:\s*vec4<u32>/,
  "the uniform ABI must remain two 16-byte rows",
);
assert.doesNotMatch(rasterGradientMapShader, /textureSample|sampler/);
assert.doesNotMatch(rasterGradientMapShader, /histogram|atomic/);

console.log("Raster Gradient Map RGBA16F compute-shader and LUT ABI verified.");
