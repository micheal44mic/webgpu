import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

globalThis.GPUShaderStage = { FRAGMENT: 2 };
globalThis.GPUTextureUsage = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
};
globalThis.GPUBufferUsage = { COPY_DST: 1, UNIFORM: 2 };

const vite = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("..", import.meta.url)),
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
const {
  prewarmLayerBlendTilePrograms,
} = await vite.ssrLoadModule("/src/layer-blend-tile-programs.ts");
const {
  LayerBlendTileCompositor,
} = await vite.ssrLoadModule("/src/layer-blend-tile-compositor.ts");

function createFakeDevice({ failFirstPipeline = false } = {}) {
  const counters = {
    bindGroups: 0,
    bindGroupLayouts: 0,
    buffers: 0,
    pipelineLayouts: 0,
    renderPipelines: 0,
    shaderModules: 0,
    textures: 0,
  };
  const bindGroupDescriptors = [];
  let pendingPipelineFailure = failFirstPipeline;
  const device = {
    counters,
    bindGroupDescriptors,
    limits: { minUniformBufferOffsetAlignment: 256 },
    queue: { writeBuffer() {} },
    createBindGroupLayout(descriptor) {
      counters.bindGroupLayouts += 1;
      return { descriptor, kind: "bind-group-layout" };
    },
    createPipelineLayout(descriptor) {
      counters.pipelineLayouts += 1;
      return { descriptor, kind: "pipeline-layout" };
    },
    createShaderModule(descriptor) {
      counters.shaderModules += 1;
      return {
        descriptor,
        async getCompilationInfo() {
          return { messages: [] };
        },
      };
    },
    async createRenderPipelineAsync(descriptor) {
      counters.renderPipelines += 1;
      if (pendingPipelineFailure) {
        pendingPipelineFailure = false;
        throw new Error("synthetic pipeline failure");
      }
      return { descriptor, kind: "render-pipeline" };
    },
    createTexture(descriptor) {
      counters.textures += 1;
      return {
        descriptor,
        destroyed: false,
        createView(viewDescriptor) {
          return { texture: this, descriptor: viewDescriptor };
        },
        destroy() {
          this.destroyed = true;
        },
      };
    },
    createBuffer(descriptor) {
      counters.buffers += 1;
      return {
        descriptor,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
    },
    createBindGroup(descriptor) {
      counters.bindGroups += 1;
      bindGroupDescriptors.push(descriptor);
      return { descriptor, kind: "bind-group" };
    },
    pushErrorScope() {},
    async popErrorScope() {
      return null;
    },
  };
  return device;
}

const sharedDevice = createFakeDevice();
const firstPromise = prewarmLayerBlendTilePrograms(sharedDevice, "rgba16float");
const concurrentPromise = prewarmLayerBlendTilePrograms(sharedDevice, "rgba16float");
assert.equal(
  concurrentPromise,
  firstPromise,
  "concurrent prewarm callers must receive the exact cached promise",
);
const sharedPrograms = await firstPromise;
assert.equal(
  await prewarmLayerBlendTilePrograms(sharedDevice, "rgba16float"),
  sharedPrograms,
  "settled prewarm callers must receive the exact cached program set",
);
assert.deepEqual(
  sharedDevice.counters,
  {
    bindGroups: 0,
    bindGroupLayouts: 6,
    buffers: 0,
    pipelineLayouts: 9,
    renderPipelines: 9,
    shaderModules: 7,
    textures: 0,
  },
  "program-only prewarm must never allocate instance bind groups, buffers or textures",
);

await prewarmLayerBlendTilePrograms(sharedDevice, "rgba8unorm");
assert.equal(sharedDevice.counters.renderPipelines, 18);
assert.equal(sharedDevice.counters.shaderModules, 14);
assert.equal(sharedDevice.counters.textures, 0);
assert.equal(sharedDevice.counters.buffers, 0);

const retryDevice = createFakeDevice({ failFirstPipeline: true });
const rejectedAttempt = prewarmLayerBlendTilePrograms(retryDevice, "rgba16float");
await assert.rejects(rejectedAttempt, /Layer blend pipeline creation failed/);
const retryAttempt = prewarmLayerBlendTilePrograms(retryDevice, "rgba16float");
assert.notEqual(retryAttempt, rejectedAttempt, "a rejected cache entry must be evicted");
await retryAttempt;
assert.equal(retryDevice.counters.renderPipelines, 18);
assert.equal(retryDevice.counters.textures, 0);
assert.equal(retryDevice.counters.buffers, 0);

const instanceDevice = createFakeDevice();
const instancePrograms = await prewarmLayerBlendTilePrograms(
  instanceDevice,
  "rgba16float",
);
const programCounters = { ...instanceDevice.counters };
const displayUniformBuffer = { kind: "display-uniform-buffer" };
const pyramidView = { kind: "pyramid-view" };
const sampler = { kind: "sampler" };
const engine = {
  device: instanceDevice,
  layerFormat: "rgba16float",
  displayUniformBuffer,
  activeLayerDisplayPyramid: { samplingView: pyramidView },
  sampler,
};
const compositor = await LayerBlendTileCompositor.create(engine);
assert.equal(instanceDevice.counters.renderPipelines, programCounters.renderPipelines);
assert.equal(instanceDevice.counters.shaderModules, programCounters.shaderModules);
assert.equal(instanceDevice.counters.bindGroupLayouts, programCounters.bindGroupLayouts);
assert.equal(instanceDevice.counters.pipelineLayouts, programCounters.pipelineLayouts);
assert.equal(instanceDevice.counters.textures, 7, "scratch allocation must remain instance-only");
assert.equal(instanceDevice.counters.buffers, 3, "uniform rings must remain instance-only");
assert.equal(instanceDevice.counters.bindGroups, 2);
assert.equal(
  instanceDevice.bindGroupDescriptors[0].layout,
  instancePrograms.backgroundLayout,
  "the background bind group must use the cached program layout",
);
assert.equal(
  instanceDevice.bindGroupDescriptors[1].layout,
  instancePrograms.pyramidLayout,
  "the pyramid bind group must use the cached program layout",
);
assert.equal(
  instanceDevice.bindGroupDescriptors[0].entries[0].resource.buffer,
  displayUniformBuffer,
);
assert.equal(instanceDevice.bindGroupDescriptors[1].entries[1].resource, pyramidView);
assert.equal(instanceDevice.bindGroupDescriptors[1].entries[2].resource, sampler);
compositor.destroy();
await vite.close();

console.log(
  "Layer-blend tile programs verified: device/format promise cache, retry, zero scratch during prewarm, and exact instance reuse.",
);
