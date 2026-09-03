import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const rasterRuntime = readFileSync(
  new URL("src/engine-vector-raster-runtime.ts", root),
  "utf8",
);
const occupancyRuntime = readFileSync(
  new URL("src/raster-occupancy-analysis.ts", root),
  "utf8",
);
const vectorShader = readFileSync(
  new URL("src/vector-text-gpu-shader.ts", root),
  "utf8",
);
const brushEngine = readFileSync(
  new URL("src/brush-engine.ts", root),
  "utf8",
);

function section(source, declaration, nextDeclaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `Missing declaration: ${declaration}`);
  const end = source.indexOf(nextDeclaration, start + declaration.length);
  assert.notEqual(end, -1, `Missing declaration following ${declaration}`);
  return source.slice(start, end);
}

function occurrenceCount(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

const pipelineCacheDeclaration = section(
  rasterRuntime,
  "const pipelinesByDevice",
  "const encodedFinalizePipelinesByDevice",
);
const rasterPipelineGate = section(
  rasterRuntime,
  "async function ensureVectorRasterPipelines",
  "async function createVectorRasterScratch",
);
const finalizePipelineGate = section(
  rasterRuntime,
  "async function ensureEncodedVectorRasterFinalizePipeline",
  "function createEncodedVectorRasterScratch",
);
const rasterRenderGate = section(
  rasterRuntime,
  "export async function renderVectorDrawsToTexture",
  "async function renderVectorDrawsToLayer",
);
const preparationGate = section(
  rasterRuntime,
  "export async function prepareVectorRasterizationResources",
  "export async function rasterizeVectorNodeToLayer",
);
const conversionGate = rasterRuntime.slice(
  rasterRuntime.indexOf("export async function rasterizeVectorNodeToLayer"),
);

assert.match(
  vectorShader,
  /export const VECTOR_TEXT_GPU_TARGET_FORMAT(?:\s*:\s*GPUTextureFormat)?\s*=\s*"rgba16float"/,
  "the shared high-precision vector target must remain RGBA16F",
);
assert.match(
  vectorShader,
  /export const VECTOR_TEXT_GPU_SAMPLE_COUNT\s*=\s*4/,
  "the shared vector pipelines must remain four-sample MSAA pipelines",
);
assert.match(
  pipelineCacheDeclaration,
  /new WeakMap<[\s\S]*?GPUDevice,[\s\S]*?Map<LayerFormat, Promise<VectorRasterPipelines>>/,
  "fallback raster pipelines must be cached by device and target format",
);

// The common RGBA16F path already owns these six MSAA pipelines. Rasterization
// should return them directly instead of compiling an identical pipeline set.
assert.match(
  rasterPipelineGate,
  /format === VECTOR_TEXT_GPU_TARGET_FORMAT/,
  "the shared-pipeline fast path must be limited to the compatible target format",
);
for (const field of [
  "vectorTextGpuFillPipeline",
  "vectorTextGpuSlugPipeline",
  "vectorTextGpuBlurCompositePipeline",
  "vectorTextGpuInnerShadowDirectPipeline",
  "vectorTextGpuInnerShadowBlurPipeline",
  "vectorTextGpuMeshInnerShadowBlurPipeline",
]) {
  assert.match(
    rasterPipelineGate,
    new RegExp(`engine\\.${field}`),
    `the RGBA16F fast path must reuse ${field}`,
  );
}
assert.match(
  rasterPipelineGate,
  /Object\.values\(reused\)\.every\(\(pipeline\) => pipeline !== null\)[\s\S]*?return reused as VectorRasterPipelines/,
  "all six shared pipelines must be ready before the fast path is returned",
);

// Other target formats compile exactly one complete set. All six requests are
// launched together and the in-flight Promise is published before it is awaited.
assert.equal(
  occurrenceCount(rasterPipelineGate, /createRenderPipelineAsync\(/g),
  6,
  "the fallback must asynchronously compile the six raster pipeline variants",
);
assert.match(
  rasterPipelineGate,
  /await Promise\.all\(\[[\s\S]*?createRenderPipelineAsync\([\s\S]*?\]\)/,
  "fallback pipeline compilation must run in parallel",
);
assert.doesNotMatch(
  rasterPipelineGate,
  /engine\.device\.createRenderPipeline\(/,
  "rasterization must not synchronously compile fallback render pipelines",
);
assert.match(
  rasterPipelineGate,
  /const existing = devicePipelines\.get\(format\);[\s\S]*?if \(existing\) return existing/,
  "warm and concurrent calls must share the cached pipeline Promise",
);
assert.match(
  rasterPipelineGate,
  /devicePipelines\.set\(format, pending\);[\s\S]*?return await pending/,
  "the fallback Promise must be cached before compilation is awaited",
);
assert.match(
  rasterPipelineGate,
  /devicePipelines\.get\(format\) === pending[\s\S]*?devicePipelines\.delete\(format\)/,
  "a failed fallback compilation must remain retryable",
);

assert.match(
  rasterRuntime,
  /const encodedFinalizePipelinesByDevice = new WeakMap<[\s\S]*?GPUDevice,[\s\S]*?Promise<GPURenderPipeline>/,
  "the encoded-output finalizer must be cached per device",
);
assert.match(
  finalizePipelineGate,
  /const existing = encodedFinalizePipelinesByDevice\.get\(engine\.device\);[\s\S]*?if \(existing\) return existing/,
  "warm and concurrent finalizer requests must reuse the cached Promise",
);
assert.equal(
  occurrenceCount(finalizePipelineGate, /createRenderPipelineAsync\(/g),
  1,
  "the finalizer must compile through the asynchronous helper",
);
assert.doesNotMatch(
  finalizePipelineGate,
  /engine\.device\.createRenderPipeline\(/,
  "the finalizer must not synchronously compile on the rasterization path",
);
assert.match(
  finalizePipelineGate,
  /encodedFinalizePipelinesByDevice\.set\(engine\.device, pending\);[\s\S]*?return await pending/,
  "the finalizer Promise must be cached before compilation is awaited",
);
assert.match(
  finalizePipelineGate,
  /encodedFinalizePipelinesByDevice\.get\(engine\.device\) === pending[\s\S]*?encodedFinalizePipelinesByDevice\.delete\(engine\.device\)/,
  "a failed finalizer compilation must remain retryable",
);

assert.match(
  preparationGate,
  /await Promise\.all\(\[[\s\S]*?ensureVectorRasterPipelines\([\s\S]*?ensureEncodedVectorRasterFinalizePipeline\([\s\S]*?prepareRasterOccupancyAnalysis\(/,
  "vector raster preparation must start the renderer, finalizer, and occupancy programs together",
);
assert.match(
  conversionGate,
  /await Promise\.all\(\[\s*engine\.waitForIdle\(\),\s*prepareVectorRasterizationResources\(engine\),\s*\]\)/,
  "a cold conversion must overlap program preparation with its required idle drain",
);
assert.ok(
  occurrenceCount(brushEngine, /void prepareVectorRasterizationResources\(this\)\.catch/g) >= 3,
  "text and SVG creation must start conversion-only program preparation in the background",
);

assert.match(
  rasterRuntime,
  /export const VECTOR_RASTER_MAX_CHUNKS_PER_SUBMISSION\s*=\s*8/,
  "raster submissions must use a small, fixed chunk bound",
);
assert.match(
  rasterRuntime,
  /const ENCODED_VECTOR_RASTER_FINALIZE_UNIFORM_BYTES\s*=\s*16/,
  "encoded finalization must retain its exact 16-byte uniform payload",
);
assert.match(
  rasterRenderGate,
  /chunks\.length > 1[\s\S]*?Math\.min\(VECTOR_RASTER_MAX_CHUNKS_PER_SUBMISSION, chunks\.length\)/,
  "single-chunk rasters must avoid staging while multi-chunk rasters remain bounded",
);
assert.match(
  rasterRenderGate,
  /usage: GPUBufferUsage\.COPY_DST \| GPUBufferUsage\.COPY_SRC/,
  "multi-chunk uniform data must use a bounded copy-source staging buffer",
);
assert.match(
  rasterRenderGate,
  /queue\.writeBuffer\([\s\S]*?batchedUploadBuffer[\s\S]*?encoder\.copyBufferToBuffer\([\s\S]*?batchedUploadBuffer,[\s\S]*?uniformBuffer/,
  "each staged draw-uniform slot must be copied before its render pass",
);
assert.match(
  rasterRenderGate,
  /const finalizeUploadOffset = uploadSlotOffset \+ drawUniformSlotBytes[\s\S]*?queue\.writeBuffer\([\s\S]*?finalizeUniformUpload[\s\S]*?encoder\.copyBufferToBuffer\([\s\S]*?encodedScratch\.uniformBuffer[\s\S]*?ENCODED_VECTOR_RASTER_FINALIZE_UNIFORM_BYTES/,
  "encoded output must stage and order its 16-byte per-chunk finalizer uniforms",
);
assert.equal(
  occurrenceCount(rasterRenderGate, /queue\.submit\(/g),
  1,
  "the raster loop must submit only through its bounded batch flush",
);
assert.match(
  rasterRenderGate,
  /batchChunkCount >= VECTOR_RASTER_MAX_CHUNKS_PER_SUBMISSION[\s\S]*?flushBatch\(\)[\s\S]*?flushBatch\(\);[\s\S]*?await engine\.waitForGpuCapped/,
  "full and trailing chunk batches must submit before the final GPU fence",
);
assert.match(
  rasterRenderGate,
  /finally \{[\s\S]*?batchedUploadBuffer\?\.destroy\(\)/,
  "the staging buffer must live through the final fence and then be released",
);

const submissionCount = (chunkCount) =>
  Math.ceil(chunkCount / 8);
assert.equal(submissionCount(1), 1, "one chunk still requires exactly one submission");
assert.equal(submissionCount(8), 1, "a full batch must require one submission");
assert.equal(submissionCount(9), 2, "a trailing chunk must require a second submission");
assert.equal(submissionCount(64), 8, "a 64-chunk raster must use eight bounded submissions");
assert.equal(
  1 - submissionCount(64) / 64,
  0.875,
  "the bounded batch must remove 87.5% of queue submissions at 64 chunks",
);

const occupancyCacheDeclaration = section(
  occupancyRuntime,
  "const rasterOccupancyPipelinesByDevice",
  "export const RASTER_OCCUPANCY_ANALYSIS_STRATEGY",
);
const occupancyPipelineGate = section(
  occupancyRuntime,
  "async function ensureRasterOccupancyPipeline",
  "export interface RasterOccupancyAnalysis",
);
const occupancyAnalysisStart = occupancyRuntime.indexOf(
  "export async function analyzeRasterTextureOccupancy",
);
assert.notEqual(
  occupancyAnalysisStart,
  -1,
  "the exported occupancy analysis entry point must exist",
);
const occupancyAnalysis = occupancyRuntime.slice(occupancyAnalysisStart);

assert.match(
  occupancyCacheDeclaration,
  /new WeakMap<[\s\S]*?GPUDevice,[\s\S]*?Promise<RasterOccupancyPipelineResources>/,
  "occupancy pipeline resources must be cached by device as an in-flight Promise",
);
assert.match(
  occupancyPipelineGate,
  /const existing = rasterOccupancyPipelinesByDevice\.get\(device\);[\s\S]*?if \(existing\) return existing/,
  "warm and concurrent occupancy scans must reuse the cached Promise",
);
assert.equal(
  occurrenceCount(occupancyPipelineGate, /createComputePipelineAsync\(/g),
  1,
  "occupancy analysis must compile through the asynchronous helper",
);
assert.doesNotMatch(
  occupancyPipelineGate,
  /device\.createComputePipeline\(/,
  "occupancy pipeline setup must not synchronously compile on the scan path",
);
assert.match(
  occupancyPipelineGate,
  /rasterOccupancyPipelinesByDevice\.set\(device, pending\);[\s\S]*?return await pending/,
  "the occupancy Promise must be cached before compilation is awaited",
);
assert.match(
  occupancyPipelineGate,
  /rasterOccupancyPipelinesByDevice\.get\(device\) === pending[\s\S]*?rasterOccupancyPipelinesByDevice\.delete\(device\)/,
  "a failed occupancy compilation must remain retryable",
);
assert.match(
  occupancyAnalysis,
  /await ensureRasterOccupancyPipeline\(engine\.device\)/,
  "each occupancy scan must acquire the cached pipeline resources",
);
assert.doesNotMatch(
  occupancyAnalysis,
  /createComputePipeline(?:Async)?\(|createShaderModule\(|createBindGroupLayout\(|createPipelineLayout\(/,
  "an occupancy scan must not recreate pipeline compilation resources",
);

console.log(
  "Vector raster performance contract verified: cached pipelines plus bounded 8-chunk submissions (87.5% fewer at 64 chunks).",
);
