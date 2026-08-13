import assert from "node:assert/strict";
import { readEngineSource } from "../../engine-source.mjs";
import { readRepositorySource } from "../source-contract.mjs";

const engineSource = readEngineSource();
const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const gpuResourcesSource = readRepositorySource("src/vector-text-gpu-resources.ts");

// WebGPU resources: MSAA4 senza vecchio stencil, premultiplied source-over e destroy esplicito.
assert.doesNotMatch(engineSource, /vectorTextGpuDepthStencil|VECTOR_TEXT_GPU_DEPTH_STENCIL_FORMAT/);
assert.doesNotMatch(engineSource, /Vector text outline stencil union/);
assert.match(engineSource, /VECTOR_TEXT_GPU_SAMPLE_COUNT \+ 1/);
assert.match(engineSource, /srcFactor: "one"[\s\S]*dstFactor: "one-minus-src-alpha"/);
assert.match(engineSource, /Vector text analytic Slug mask for GPU blur/);
assert.match(engineSource, /Vector text GPU Gaussian horizontal/);
assert.match(engineSource, /Vector text GPU Gaussian vertical/);
assert.match(gpuResourcesSource, /resources\.curveTexture\.destroy\(\)[\s\S]*resources\.bandTexture\.destroy\(\)/);
assert.match(gpuResourcesSource, /resources\.vertexBuffer\.destroy\(\)[\s\S]*resources\.indexBuffer\.destroy\(\)/);
assert.match(engineSource, /resources\.texture\.destroy\(\)[\s\S]*vectorTextGpuBlurCaches\.delete/);
assert.match(engineSource, /if \(activeBlurCacheCount === 0\) \{[\s\S]*releaseVectorTextGpuBlurScratch/);
assert.doesNotMatch(controllerSource, /document\.createElement\("canvas"\)/);
assert.doesNotMatch(controllerSource, /strokeText\(|fillText\(|canvasPath/);
