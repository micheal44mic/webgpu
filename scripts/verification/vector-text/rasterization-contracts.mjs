import assert from "node:assert/strict";
import { VECTOR_TEXT_GPU_SAMPLE_COUNT } from "../../../src/vector-text-gpu-shader.ts";
import { readEngineSource } from "../../engine-source.mjs";
import {
  boundedSourceSection,
  readRepositorySource,
} from "../source-contract.mjs";

const engineSource = readEngineSource();
const vectorRasterSource = readRepositorySource("src/engine-vector-raster-runtime.ts");
const vectorRasterResolveSource = readRepositorySource("src/vector-raster-resolve-shader.ts");
const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const historyProbeSource = readRepositorySource("src/mixed-scene-history-probe.ts");
const clientSource = readRepositorySource("src/vector-text-effect-client.ts");
const htmlSource = readRepositorySource("index.html");

// Rasterizzazione vettoriale autorevole: SVG mesh e testo Slug usano target
// RGBA16F lineare, MSAA 4x, blocchi allineati ai tile e seed tiled Undo/Redo.
assert.match(
  vectorRasterSource,
  /semantic-vector-slug-mesh-webgpu-explicit-perceptual-msaa4-resolve-512-tile-chunks-history-seed-v4/,
);
assert.match(vectorRasterSource, /VECTOR_RASTER_FORMAT = "rgba16float"/);
assert.match(vectorRasterSource, /VECTOR_RASTER_CHUNK_SIZE = LAYER_STORAGE_TILE_SIZE \* 2/);
assert.match(
  vectorRasterSource,
  /WeakMap<[\s\S]{0,120}Map<LayerFormat, Promise<VectorRasterPipelines>>/,
  "le pipeline raster vettoriali devono essere separate per formato documento",
);
assert.match(vectorRasterSource, /targets: \[\{ format, blend \}\]/);
assert.match(vectorRasterSource, /const format = destination\.format/);
assert.match(vectorRasterSource, /destination\.format !== engine\.layerFormat/);
assert.match(vectorRasterSource, /createVectorRasterScratch\(engine, format\)/);
assert.match(vectorRasterSource, /format,\s*usage: GPUTextureUsage\.RENDER_ATTACHMENT/);
assert.match(vectorRasterSource, /sampleCount: VECTOR_TEXT_GPU_SAMPLE_COUNT/);
assert.match(
  vectorRasterSource,
  /GPUTextureUsage\.RENDER_ATTACHMENT \| GPUTextureUsage\.TEXTURE_BINDING/,
);
assert.doesNotMatch(vectorRasterSource, /resolveTarget:/);
assert.match(vectorRasterSource, /storeOp: "store"/);
assert.match(vectorRasterSource, /resolvePass\.setPipeline\(pipelines\.resolve\)/);
assert.match(
  vectorRasterResolveSource,
  /explicit-msaa4-perceptual-srgb-color-linear-coverage-v1/,
);
assert.match(vectorRasterResolveSource, /texture_multisampled_2d<f32>/);
assert.equal(
  (vectorRasterResolveSource.match(/textureLoad\(sourceTexture, coordinate, [0-3]\)/g) ?? []).length,
  VECTOR_TEXT_GPU_SAMPLE_COUNT,
);
assert.match(vectorRasterResolveSource, /perceptualReduceFour\(/);
assert.match(
  vectorRasterSource,
  /sampleType: "unfilterable-float",[\s\S]{0,100}multisampled: true/,
);
assert.match(vectorRasterSource, /entryPoint: "fragmentMain"/);
assert.match(vectorRasterSource, /slugInnerShadowDirect/);
assert.match(vectorRasterSource, /slugInnerShadowBlur/);
assert.match(vectorRasterSource, /meshInnerShadowBlur/);
assert.match(vectorRasterSource, /createLayerColdStorageCandidate\(/);
assert.match(vectorRasterSource, /encodeLayerColdHydration\(/);
assert.match(vectorRasterSource, /markLayerStorageRect\(/);
assert.match(vectorRasterSource, /replaceVectorWithRaster\(/);
assert.match(vectorRasterSource, /replaceRasterWithVector\(/);
assert.match(vectorRasterSource, /action\.seed\.format !== engine\.layerFormat/);
assert.match(vectorRasterSource, /allocateLayerGpuResources\([\s\S]{0,100}action\.seed\.format/);
assert.match(vectorRasterSource, /runGpuAllocationTransaction\(/);
assert.match(vectorRasterSource, /Nessun fallback RGBA8 è consentito/);
assert.doesNotMatch(vectorRasterSource, /format:\s*"rgba8unorm"/);
assert.doesNotMatch(
  vectorRasterSource,
  /CanvasRenderingContext2D|copyExternalImageToTexture|drawImage\(/,
  "la rasterizzazione non deve introdurre un fallback bitmap/Canvas2D",
);
assert.match(controllerSource, /async rasterizeSelectedSvg\(\)/);
assert.match(controllerSource, /await this\.host\.rasterizeVectorSvgNode\(svgId, draws\)/);
assert.match(controllerSource, /async rasterizeSelectedText\(\)/);
assert.match(controllerSource, /await this\.host\.rasterizeVectorTextNode\(textId, draws\)/);
assert.match(controllerSource, /vectorRasterFormatLabel\(result\.format\)/);
assert.doesNotMatch(controllerSource, /rasterizzato in RGBA8/);
assert.match(controllerSource, /slotNamespace = pinForRasterization \? "text-raster" : "text"/);
assert.match(controllerSource, /!requireRequestedLod \|\| result\.matchesRequestedLod/);
assert.match(controllerSource, /resourceRevisionValue\(\)/);
assert.match(controllerSource, /private sceneOperationRenderDeferred = false/);
assert.match(
  controllerSource,
  /private renderNow\([\s\S]{0,220}\): boolean \{[\s\S]*this\.sceneOperationBusy[\s\S]*this\.sceneOperationRenderDeferred = true/,
);
assert.match(
  controllerSource,
  /if \(this\.sceneOperationRenderDeferred\) \{[\s\S]*this\.scheduleRender\(\)/,
);
assert.match(clientSource, /waitForResourceReady\(/);
assert.match(engineSource, /kind: "vector-rasterize"/);
assert.match(engineSource, /seedFormat: converted\.history\.seed\.format/);
assert.match(engineSource, /destroyVectorRasterHistorySeed\(/);
assert.match(engineSource, /this\.vectorTextGpuPendingRuns\.length = 0/);
assert.match(engineSource, /this\.vectorTextGpuPendingRuns\.splice\(index, 1\)/);
assert.match(vectorRasterSource, /activateLayer\([^;]*"structural-history"\)/);
assert.match(
  engineSource,
  /caller === "history-replay" \|\| caller === "structural-history"/,
);
const redoVectorBody = boundedSourceSection(vectorRasterSource, {
  label: "redo rasterizzazione vettoriale",
  startMarker: "async function redoVectorRasterization(",
  endMarker: "export async function applyVectorRasterizeHistory(",
});
const redoVectorStart = vectorRasterSource.indexOf("async function redoVectorRasterization(");
const redoVectorTry = redoVectorBody.indexOf("try {");
const redoVectorHydration = redoVectorBody.indexOf("gpu = await hydrateHistorySeed");
assert.ok(
  redoVectorStart >= 0 && redoVectorTry >= 0 && redoVectorHydration > redoVectorTry,
  "l'OOM di reidratazione Redo deve attraversare il rollback strutturale",
);
assert.match(
  redoVectorBody,
  /discardVectorRasterCandidateAndRestoreOriginalActive\([\s\S]{0,180}action\.layerId,[\s\S]{0,80}gpu/,
  "il rollback Redo deve ritirare anche una candidata fallita prima dell'attach",
);

// Harness WebGPU reale: su una pagina dev nuova crea entrambe le sorgenti,
// legge i byte RGBA16F, attraversa Undo/Redo e richiede identità Uint8Array.
assert.match(controllerSource, /async runVectorRasterHistoryGpuTest\(\)/);
assert.match(controllerSource, /runMixedSceneVectorRasterHistoryProbe\(\{/);
assert.match(historyProbeSource, /await runProbe\("text"\), await runProbe\("svg"\)/);
assert.match(historyProbeSource, /parseVectorSvg\([\s\S]{0,500}regression-rgba16f\.svg/);
assert.match(historyProbeSource, /rawBeforeUndo = await host\.readLayerPixels/);
assert.match(historyProbeSource, /undoReturned = await host\.undo\(\)/);
assert.match(historyProbeSource, /redoReturned = await host\.redo\(\)/);
assert.match(historyProbeSource, /uint8ArraysEqual\(before, after\)/);
assert.match(historyProbeSource, /uint8ArraysEqual\(rawBeforeUndo, rawAfterRedo\)/);
assert.match(historyProbeSource, /probe\.seedFormat === "rgba16float"/);
assert.match(historyProbeSource, /probe\.rawBytesPerPixel === 8/);
assert.match(historyProbeSource, /probe\.nonZeroAlphaPixels > 0/);

assert.match(htmlSource, /id="mobileSvgStyleRasterize"/);
assert.match(htmlSource, /id="mobileTextRasterize"/);
assert.match(htmlSource, /id="vectorTextRasterStatus"/);
