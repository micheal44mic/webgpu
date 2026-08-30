import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mainSource = source("src/main.ts");
const engineSource = source("src/brush-engine.ts");
const controllerSource = source("src/mixed-scene-controller.ts");
const resourceSource = source("src/mixed-scene-shape-resources.ts");
const vectorRuntimeSource = source("src/engine-vector-text-runtime.ts");
const staticResourceSource = source("src/engine-runtime-misc.ts");
const layerRuntimeSource = source("src/engine-layer-runtime.ts");

assert.match(
  mainSource,
  /tool === "shapes"\s*\? "shape-preview"\s*:\s*"raster-transform"/,
  "Shapes must not request the full semantic-scene scope",
);
assert.match(
  mainSource,
  /kind === "image" \? "raster-import" : "vector-shape"/,
  "plain SVG import must use the indexed-mesh capability",
);
assert.match(
  mainSource,
  /Promise\.all\(\[initialization, resourcePreparation\]\)/,
  "controller code loading and GPU capability preparation should overlap",
);

const previewMethod = engineSource.match(
  /async prepareShapePreviewPresentation\(\): Promise<void> \{[\s\S]*?\n  \}/,
)?.[0] ?? "";
assert.match(previewMethod, /await this\.ensureShapePreviewEditorResources\(\)/);
assert.doesNotMatch(
  previewMethod,
  /ensureMixedSceneEditorResources|ensureOptionalEditorResources|finishStaticResourceCreation/,
);

for (const required of [
  "ensureMixedScenePresentationResources",
  "Mixed scene partial transparent clear pipeline",
  "Mixed scene document background pipeline",
  "Mixed scene raster segment source-over pipeline",
  "Mixed scene active base layer source-over pipeline",
  "Mixed scene live shape preview source-over pipeline",
  "Mixed scene text segment source-over pipeline",
  "initializeVectorMeshFillGpuRenderer",
]) {
  assert.match(resourceSource, new RegExp(required));
}
assert.doesNotMatch(
  resourceSource,
  /\.createRenderPipeline\(/,
  "the cold shape path must never synchronously compile a render pipeline",
);
for (const deferredFamily of [
  "Gaussian",
  "InnerShadow",
  "rasterImage",
  "layerBlendCompositor",
  "mixedSceneActiveRasterStroke",
  "mixedSceneActiveThicknessTail",
  "mixedSceneActiveLightGlaze",
]) {
  assert.doesNotMatch(
    resourceSource,
    new RegExp(deferredFamily),
    `${deferredFamily} must remain outside the cold shape capability`,
  );
}
assert.match(resourceSource, /shapePreviewCreationPromises = new WeakMap/);
assert.match(resourceSource, /vectorShapeCreationPromises = new WeakMap/);
assert.match(resourceSource, /shapePreviewCreationPromises\.delete\(engine\)/);
assert.match(resourceSource, /vectorShapeCreationPromises\.delete\(engine\)/);

assert.match(
  vectorRuntimeSource,
  /export function initializeVectorMeshFillGpuRenderer\(engine: BrushEngine\): Promise<void>/,
);
const meshStart = vectorRuntimeSource.indexOf(
  "export function initializeVectorMeshFillGpuRenderer(engine: BrushEngine): Promise<void>",
);
const meshEnd = vectorRuntimeSource.indexOf(
  "export function initializeVectorTextGpuRenderer(engine: BrushEngine): Promise<void>",
  meshStart,
);
assert.ok(meshStart >= 0 && meshEnd > meshStart);
const meshBody = vectorRuntimeSource.slice(meshStart, meshEnd);
assert.match(meshBody, /createRenderPipelineAsync/);
assert.doesNotMatch(meshBody, /\.createRenderPipeline\(/);
assert.match(meshBody, /vectorTextGpuFillPipeline/);
assert.match(meshBody, /vectorTextGpuClearPipeline/);
assert.doesNotMatch(meshBody, /Slug|Gaussian|InnerShadow/);

assert.match(
  vectorRuntimeSource,
  /requiresRasterPipeline[\s\S]*?requiresTextPipeline[\s\S]*?requiresImagePipeline[\s\S]*?requiresShapePreviewPipeline/,
  "the segmented compositor must require only pipelines represented by its plan",
);
assert.match(
  staticResourceSource,
  /if \(createOptional\) \{\s*await ensureMixedSceneVectorShapeResources\(engine\)/,
  "the compatibility graph must reuse the shape subsets before adding advanced resources",
);
assert.match(
  staticResourceSource,
  /vectorTextGpuBlurFilterUniformBuffer \?\?=[\s\S]*?vectorTextGpuBlurSampler \?\?=/,
  "the full upgrade must preserve advanced vector allocations already published",
);
assert.match(
  engineSource,
  /async addVectorTextNode\([\s\S]*?await this\.ensureMixedSceneEditorResources\(\);[\s\S]*?mutateMixedScenePresentation/,
  "text insertion must upgrade a prior shape-only capability before publication",
);
assert.match(
  engineSource,
  /seed\.singleShadowEnabled === true[\s\S]*?seed\.singleShadowBlur \?\? 12/,
  "an omitted enabled outer-shadow blur must use the scene model's advanced default",
);
assert.match(
  engineSource,
  /vectorSvgUsesAdvancedGpuEffects\(\{ \.\.\.current, \.\.\.update \}\)[\s\S]*?!this\.optionalEditorResourcesReady[\s\S]*?Advanced vector effect resources must be prepared/,
  "advanced SVG effects must not be published through a shape-only capability",
);
assert.match(
  layerRuntimeSource,
  /candidateNeedsViewportBlend[\s\S]*?await engine\.ensureMixedSceneEditorResources\(\)/,
  "ordered layer blend must upgrade a prior shape-only capability before publication",
);
assert.match(
  mainSource,
  /mixedSceneInitializationPromise = initialization;[\s\S]*?void initialization\.catch\([\s\S]*?mixedSceneInitializationPromise === initialization/,
  "only controller initialization failure may invalidate the shared controller promise",
);

const appendSvgDraws = controllerSource.match(
  /private appendGpuDrawsForSvgNode\([\s\S]*?\n  private slugDraw\(/,
)?.[0] ?? "";
assert.match(
  appendSvgDraws,
  /const needsSilhouetteMesh = \([\s\S]*?if \(needsSilhouetteMesh\) \{[\s\S]*?"silhouette-fill"/,
  "plain SVG fills must not enqueue an unused silhouette mesh job",
);

const previousGpuShaderStage = globalThis.GPUShaderStage;
const previousGpuBufferUsage = globalThis.GPUBufferUsage;
globalThis.GPUShaderStage = { FRAGMENT: 2, VERTEX: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2 };

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let ensureMixedSceneShapePreviewResources;
let ensureMixedSceneVectorShapeResources;
try {
  ({
    ensureMixedSceneShapePreviewResources,
    ensureMixedSceneVectorShapeResources,
  } = await moduleServer.ssrLoadModule("/src/mixed-scene-shape-resources.ts"));
} finally {
  await moduleServer.close();
}

function previewHarness({ nativeAsync = true, rejectLabelOnce = null } = {}) {
  const calls = {
    shaderModules: 0,
    bindGroupLayouts: 0,
    bindGroups: 0,
    buffers: 0,
    pipelines: 0,
    destroyedBuffers: 0,
    pipelineLabels: [],
  };
  let rejectionPending = rejectLabelOnce !== null;
  const createPipeline = (descriptor) => {
    calls.pipelines += 1;
    calls.pipelineLabels.push(descriptor.label);
    if (rejectionPending && descriptor.label.includes(rejectLabelOnce)) {
      rejectionPending = false;
      throw new Error(`Synthetic pipeline failure: ${descriptor.label}`);
    }
    return { descriptor };
  };
  const device = {
    createShaderModule(descriptor) {
      calls.shaderModules += 1;
      return { descriptor, getCompilationInfo: async () => ({ messages: [] }) };
    },
    createBindGroupLayout(descriptor) {
      calls.bindGroupLayouts += 1;
      return { descriptor };
    },
    createBindGroup(descriptor) {
      calls.bindGroups += 1;
      return { descriptor };
    },
    createBuffer(descriptor) {
      calls.buffers += 1;
      return {
        descriptor,
        destroy() {
          calls.destroyedBuffers += 1;
        },
      };
    },
    createPipelineLayout(descriptor) {
      return { descriptor };
    },
    createRenderPipeline(descriptor) {
      return createPipeline(descriptor);
    },
  };
  if (nativeAsync) {
    device.createRenderPipelineAsync = async (descriptor) => createPipeline(descriptor);
  }
  return {
    calls,
    engine: {
      device,
      deviceLostError: null,
      canvasFormat: "bgra8unorm",
      displayUniformBuffer: {},
      displayBindGroupLayout: {},
      displayShaderModule: {},
      mixedSceneShapePreviewUniformUpload: new Float32Array(12),
      mixedScenePresentShaderModule: null,
      mixedSceneClearShaderModule: null,
      mixedScenePresentBindGroupLayout: null,
      mixedSceneBackgroundBindGroupLayout: null,
      mixedSceneBackgroundBindGroup: null,
      mixedSceneRasterSegmentBindGroupLayout: null,
      mixedScenePresentPipeline: null,
      mixedSceneRasterSegmentShaderModule: null,
      mixedSceneShapePreviewShaderModule: null,
      mixedSceneShapePreviewBindGroupLayout: null,
      mixedSceneShapePreviewUniformBuffer: null,
      mixedSceneShapePreviewBindGroup: null,
      mixedSceneClearPipeline: null,
      mixedSceneBackgroundPipeline: null,
      mixedSceneRasterSegmentPipeline: null,
      mixedSceneActiveDisplayPipeline: null,
      mixedSceneShapePreviewPipeline: null,
      mixedSceneTextSegmentShaderModule: null,
      mixedSceneTextSegmentBindGroupLayout: null,
      mixedSceneTextSegmentPipeline: null,
      vectorTextGpuShaderModule: null,
      vectorTextGpuUniformBindGroupLayout: null,
      vectorTextGpuUniformBuffer: null,
      vectorTextGpuUniformBindGroup: null,
      vectorTextGpuFillPipeline: null,
      vectorTextGpuClearPipeline: null,
    },
  };
}

try {
  const concurrent = previewHarness();
  await Promise.all([
    ensureMixedSceneShapePreviewResources(concurrent.engine),
    ensureMixedSceneShapePreviewResources(concurrent.engine),
  ]);
  assert.equal(concurrent.calls.shaderModules, 4);
  assert.equal(concurrent.calls.bindGroupLayouts, 4);
  assert.equal(concurrent.calls.bindGroups, 2);
  assert.equal(concurrent.calls.buffers, 1);
  assert.equal(concurrent.calls.pipelines, 6);
  assert.equal(concurrent.calls.destroyedBuffers, 0);
  await ensureMixedSceneShapePreviewResources(concurrent.engine);
  assert.equal(concurrent.calls.pipelines, 6, "a warm preview must not compile again");

  await Promise.all([
    ensureMixedSceneVectorShapeResources(concurrent.engine),
    ensureMixedSceneVectorShapeResources(concurrent.engine),
  ]);
  assert.equal(concurrent.calls.shaderModules, 6, "mesh fill adds exactly two shader modules");
  assert.equal(concurrent.calls.bindGroupLayouts, 6, "mesh fill adds exactly two layouts");
  assert.equal(concurrent.calls.bindGroups, 3, "mesh fill adds one dynamic uniform group");
  assert.equal(concurrent.calls.buffers, 2, "mesh fill adds one dynamic uniform buffer");
  assert.equal(concurrent.calls.pipelines, 9, "mesh fill adds exactly three pipelines");
  assert.doesNotMatch(
    concurrent.calls.pipelineLabels.join("\n"),
    /Slug|Gaussian|blur|inner shadow|inner-shadow/i,
    "plain vector shapes must leave advanced vector effects cold",
  );
  await ensureMixedSceneVectorShapeResources(concurrent.engine);
  assert.equal(concurrent.calls.pipelines, 9, "a warm vector-shape gate must not compile again");

  const retry = previewHarness({ rejectLabelOnce: "live shape preview" });
  await assert.rejects(
    ensureMixedSceneShapePreviewResources(retry.engine),
    /Synthetic pipeline failure/,
  );
  assert.equal(retry.calls.destroyedBuffers, 1, "a failed preview must release its buffer");
  await ensureMixedSceneShapePreviewResources(retry.engine);
  assert.equal(retry.calls.buffers, 2, "a failed preview must be retryable from a clean buffer");

  const fallback = previewHarness({ nativeAsync: false });
  await ensureMixedSceneVectorShapeResources(fallback.engine);
  assert.equal(
    fallback.calls.pipelines,
    9,
    "older WebGPU implementations must compile the same minimal graph synchronously",
  );
} finally {
  if (previousGpuShaderStage === undefined) delete globalThis.GPUShaderStage;
  else globalThis.GPUShaderStage = previousGpuShaderStage;
  if (previousGpuBufferUsage === undefined) delete globalThis.GPUBufferUsage;
  else globalThis.GPUBufferUsage = previousGpuBufferUsage;
}

console.log("Vector shape cold-start capability verification passed.");
