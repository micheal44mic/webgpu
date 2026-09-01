import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

globalThis.GPUShaderStage = Object.freeze({
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
});

function fakeProgramDevice(options = {}) {
  const counters = {
    bindGroupLayouts: 0,
    pipelineLayouts: 0,
    samplers: 0,
    shaderModules: 0,
    renderPipelines: 0,
    computePipelines: 0,
    textures: 0,
    buffers: 0,
  };
  let failRenderPipelines = options.failRenderPipelines ?? 0;
  let failComputePipelines = options.failComputePipelines ?? 0;
  const resource = (kind, descriptor) => Object.freeze({ kind, descriptor });
  const device = {
    createBindGroupLayout(descriptor) {
      counters.bindGroupLayouts += 1;
      return resource("bind-group-layout", descriptor);
    },
    createPipelineLayout(descriptor) {
      counters.pipelineLayouts += 1;
      return resource("pipeline-layout", descriptor);
    },
    createSampler(descriptor) {
      counters.samplers += 1;
      return resource("sampler", descriptor);
    },
    createShaderModule(descriptor) {
      counters.shaderModules += 1;
      return {
        ...resource("shader-module", descriptor),
        async getCompilationInfo() {
          return { messages: [] };
        },
      };
    },
    async createRenderPipelineAsync(descriptor) {
      counters.renderPipelines += 1;
      if (failRenderPipelines > 0) {
        failRenderPipelines -= 1;
        throw new Error("injected render-pipeline failure");
      }
      return resource("render-pipeline", descriptor);
    },
    async createComputePipelineAsync(descriptor) {
      counters.computePipelines += 1;
      if (failComputePipelines > 0) {
        failComputePipelines -= 1;
        throw new Error("injected compute-pipeline failure");
      }
      return resource("compute-pipeline", descriptor);
    },
    pushErrorScope() {},
    async popErrorScope() {
      return null;
    },
    createTexture() {
      counters.textures += 1;
      throw new Error("program-only warm-up created a texture");
    },
    createBuffer() {
      counters.buffers += 1;
      throw new Error("program-only warm-up created a buffer");
    },
  };
  return { device, counters };
}

const vite = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("..", import.meta.url)),
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
const { acquireRasterStrokeProgramResources, prewarmRasterStrokePrograms } =
  await vite.ssrLoadModule("/src/stroke-programs.ts");
const { prewarmRasterTransformProgramsForDevice } = await vite.ssrLoadModule(
  "/src/raster-transform-programs.ts",
);

const stroke = fakeProgramDevice();
const strokeOptions = {
  device: stroke.device,
  layerFormat: "rgba16float",
};
const [firstStrokePrograms] = await Promise.all([
  acquireRasterStrokeProgramResources(strokeOptions),
  prewarmRasterStrokePrograms(strokeOptions),
  prewarmRasterStrokePrograms(strokeOptions),
]);
assert.equal(
  stroke.counters.computePipelines,
  8,
  "concurrent Stroke warm-ups must dedupe",
);
assert.equal(stroke.counters.textures, 0);
assert.equal(stroke.counters.buffers, 0);
const strokeProgramsAfterFirstWarmup = stroke.counters.computePipelines;
await prewarmRasterStrokePrograms(strokeOptions);
assert.strictEqual(
  await acquireRasterStrokeProgramResources(strokeOptions),
  firstStrokePrograms,
  "renderer acquisition must receive the exact warmed pipeline/layout bundle",
);
assert.equal(
  stroke.counters.computePipelines,
  strokeProgramsAfterFirstWarmup,
  "the Stroke device/format program cache must remain resident",
);
await prewarmRasterStrokePrograms({
  device: stroke.device,
  layerFormat: "rgba8unorm",
});
assert.equal(
  stroke.counters.computePipelines,
  strokeProgramsAfterFirstWarmup + 8,
  "different Stroke target formats require distinct program bundles",
);
assert.equal(stroke.counters.textures, 0);
assert.equal(stroke.counters.buffers, 0);

const strokeRetry = fakeProgramDevice({ failComputePipelines: 1 });
await assert.rejects(
  prewarmRasterStrokePrograms({
    device: strokeRetry.device,
    layerFormat: "rgba16float",
  }),
  /Stroke pipeline creation failed validation/,
);
await prewarmRasterStrokePrograms({
  device: strokeRetry.device,
  layerFormat: "rgba16float",
});
assert.equal(strokeRetry.counters.textures, 0);
assert.equal(strokeRetry.counters.buffers, 0);

const homeWarmupSource = readFileSync(
  new URL("../src/home-editor-warmup.ts", import.meta.url),
  "utf8",
);
const strokeProgramSource = readFileSync(
  new URL("../src/stroke-programs.ts", import.meta.url),
  "utf8",
);
const strokeRendererSource = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(homeWarmupSource, /import\("\.\/stroke-programs"\)/);
assert.doesNotMatch(homeWarmupSource, /import\("\.\/stroke-renderer"\)/);
assert.doesNotMatch(
  strokeProgramSource,
  /effects-scratch-pool|gpu-allocation-transaction|merged-surface-shader|clipping-group-shader/,
  "the Home Stroke chunk must not pull document allocation or presentation modules",
);
assert.ok(
  Buffer.byteLength(strokeProgramSource) <
    Buffer.byteLength(strokeRendererSource),
  "the program-only module must stay smaller than the document renderer runtime",
);

const transform = fakeProgramDevice();
await Promise.all([
  prewarmRasterTransformProgramsForDevice(transform.device, "rgba16float"),
  prewarmRasterTransformProgramsForDevice(transform.device, "rgba16float"),
]);
assert.equal(
  transform.counters.renderPipelines,
  5,
  "Transform bundles must dedupe per device",
);
assert.equal(transform.counters.textures, 0);
assert.equal(transform.counters.buffers, 0);
const transformProgramsAfterFirstWarmup = transform.counters.renderPipelines;
await prewarmRasterTransformProgramsForDevice(transform.device, "rgba16float");
assert.equal(
  transform.counters.renderPipelines,
  transformProgramsAfterFirstWarmup,
  "the Transform device/format program cache must remain resident",
);
await prewarmRasterTransformProgramsForDevice(transform.device, "rgba8unorm");
assert.equal(
  transform.counters.renderPipelines,
  transformProgramsAfterFirstWarmup + 5,
  "different render-target formats require distinct Transform pipelines",
);

const transformRetry = fakeProgramDevice({ failRenderPipelines: 1 });
await assert.rejects(
  prewarmRasterTransformProgramsForDevice(
    transformRetry.device,
    "rgba16float",
    ["affine"],
  ),
  /injected render-pipeline failure/,
);
await prewarmRasterTransformProgramsForDevice(
  transformRetry.device,
  "rgba16float",
  ["affine"],
);
assert.equal(transformRetry.counters.textures, 0);
assert.equal(transformRetry.counters.buffers, 0);

console.log("Program-only Stroke and Transform warm-up verification passed.");
await vite.close();
