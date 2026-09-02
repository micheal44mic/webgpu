import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const server = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});

let core;
let history;
let cloneRuntime;
let highFrequencyQuantization;
try {
  core = await server.ssrLoadModule("/src/clone-gpu-core.ts");
  history = await server.ssrLoadModule("/src/engine-history-types.ts");
  cloneRuntime = await server.ssrLoadModule("/src/engine-clone-runtime.ts");
  highFrequencyQuantization = await server.ssrLoadModule(
    "/src/rgba8-high-frequency-quantization.ts",
  );
} finally {
  await server.close();
}

const {
  CLONE_SOURCE_INITIAL_ATLAS_LAYERS,
  CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES,
  CLONE_SOURCE_PAGE_TABLE_LENGTH,
  cloneConservativeStampBounds,
  cloneHistoryBytesPerRow,
  cloneHistorySourceOffset,
  cloneSourcePointForDestination,
  cloneSourceLayout,
  cloneSourceTileIndicesForRect,
  cloneSourceTileRect,
  createCloneSourceTransform,
  growCloneAtlasLayerCapacity,
} = core;
const { resolvePaintHistoryStampCount } = history;
const { cloneFormatBytesPerPixel, cloneSettingsForCurrentBrush } = cloneRuntime;
const { quantizeUnorm8HighFrequencyAdjacent } = highFrequencyQuantization;

const layout = cloneSourceLayout(2048, 2048);
assert.deepEqual(layout, {
  documentWidth: 2048,
  documentHeight: 2048,
  tileWidth: 128,
  tileHeight: 128,
  gridSize: 16,
});
assert.equal(CLONE_SOURCE_PAGE_TABLE_LENGTH, 256);
assert.deepEqual(cloneSourceTileRect(layout, 255), {
  index: 255,
  tileX: 15,
  tileY: 15,
  x: 1920,
  y: 1920,
  width: 128,
  height: 128,
});
const identityTransform = createCloneSourceTransform({
  sourceX: 0,
  sourceY: 0,
  destinationX: 0,
  destinationY: 0,
  angleDegrees: 0,
});
assert.deepEqual(
  cloneSourceTileIndicesForRect(
    layout,
    { x: 120, y: 120, width: 20, height: 20 },
    identityTransform,
  ),
  [0, 1, 16, 17],
  "bilinear halo must make all four neighboring pages resident",
);
assert.deepEqual(
  cloneSourceTileIndicesForRect(
    layout,
    { x: 0, y: 0, width: 20, height: 20 },
    createCloneSourceTransform({
      sourceX: -500,
      sourceY: 0,
      destinationX: 0,
      destinationY: 0,
      angleDegrees: 0,
    }),
  ),
  [],
  "sampling entirely outside the document is transparent and allocates no page",
);
const clockwiseQuarterTurn = createCloneSourceTransform({
  sourceX: 512,
  sourceY: 512,
  destinationX: 256,
  destinationY: 256,
  angleDegrees: 90,
});
assert.deepEqual(clockwiseQuarterTurn, {
  sourceX: 512,
  sourceY: 512,
  destinationX: 256,
  destinationY: 256,
  rotationCos: 0,
  rotationSin: -1,
  angleDegrees: 90,
});
assert.deepEqual(
  cloneSourcePointForDestination(clockwiseQuarterTurn, { x: 276, y: 256 }),
  { x: 512, y: 492 },
  "a clockwise output rotation must look up source pixels in the inverse direction",
);
assert.deepEqual(
  cloneSourceTileIndicesForRect(
    layout,
    { x: 256, y: 256, width: 100, height: 40 },
    clockwiseQuarterTurn,
  ),
  [51, 52, 67, 68],
  "rotated page planning must conservatively transform all four rectangle corners",
);
assert.throws(() => cloneSourceTileRect(layout, 256), /outside the document grid/);

const conservative = cloneConservativeStampBounds([
  {
    x: 100,
    y: 200,
    radius: 20,
    pressure: 1,
    seed: 1,
    directionX: 1,
    directionY: 0,
    historyActionId: 8,
  },
], {
  shape: "shape",
  shapeRotation: "follow-stroke",
  shapeScatter: 0,
  positionJitterLinear: 0.25,
  positionJitterLateral: 0.25,
});
assert.ok(conservative.x < 60 && conservative.y < 160);
assert.ok(conservative.x + conservative.width > 140);
assert.ok(conservative.y + conservative.height > 240);

assert.equal(cloneHistoryBytesPerRow(128, 8), 1024);
assert.equal(cloneHistoryBytesPerRow(129, 4), 768);
assert.equal(cloneHistorySourceOffset(32), 256);
assert.equal(cloneHistorySourceOffset(256), 256);
assert.equal(CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES, 256);
assert.equal(growCloneAtlasLayerCapacity(4, 5), 8);
assert.equal(growCloneAtlasLayerCapacity(128, 256), 256);
assert.equal(CLONE_SOURCE_INITIAL_ATLAS_LAYERS, 4);
assert.equal(cloneFormatBytesPerPixel("rgba8unorm"), 4);
assert.equal(cloneFormatBytesPerPixel("rgba16float"), 8);

const settings = cloneSettingsForCurrentBrush({
  tool: "blend",
  blendMode: "additive",
  size: 72,
  opacity: 0.45,
  flow: 0.61,
  endThickness: 1,
});
assert.equal(settings.tool, "paint");
assert.equal(settings.blendMode, "normal");
assert.equal(settings.size, 72);
assert.equal(settings.opacity, 0.45);
assert.equal(settings.flow, 0.61);
assert.equal(settings.endThickness, 1,
  "Clone's neutral default thickness must remain covered by its mandatory deferred preview");

const stampBytes = 32;
const sourceByteOffset = cloneHistorySourceOffset(stampBytes);
const bytesPerRow = cloneHistoryBytesPerRow(layout.tileWidth, 8);
const tileStrideBytes = bytesPerRow * layout.tileHeight;
const cloneSource = {
  offsetX: -100,
  offsetY: 20,
  sourceX: 100,
  sourceY: 220,
  destinationX: 200,
  destinationY: 200,
  rotationCos: 0,
  rotationSin: -1,
  angleDegrees: 90,
  tileIndices: [0, 1],
  stampBytes,
  sourceByteOffset,
  bytesPerRow,
  rowsPerImage: layout.tileHeight,
  tileStrideBytes,
  tileWidth: layout.tileWidth,
  tileHeight: layout.tileHeight,
  documentWidth: layout.documentWidth,
  documentHeight: layout.documentHeight,
};
const logicalBytes = sourceByteOffset + tileStrideBytes * cloneSource.tileIndices.length;
assert.equal(resolvePaintHistoryStampCount([], {
  stampCount: 1,
  gpuSlice: { logicalBytes },
  cloneSource,
}), 1);
assert.throws(() => resolvePaintHistoryStampCount([], {
  stampCount: 1,
  gpuSlice: { logicalBytes: logicalBytes - 1 },
  cloneSource,
}), /GPU Paint payload/);
const transparentCloneSource = { ...cloneSource, tileIndices: [] };
assert.equal(resolvePaintHistoryStampCount([], {
  stampCount: 1,
  gpuSlice: { logicalBytes: sourceByteOffset },
  cloneSource: transparentCloneSource,
}), 1, "an implicitly transparent Clone source must remain replayable");
assert.throws(() => resolvePaintHistoryStampCount([], {
  stampCount: 1,
  gpuSlice: { logicalBytes },
  cloneSource: { ...cloneSource, rotationCos: 4 },
}), /Invalid Clone history source layout/);

const runtimeSource = read("src/engine-clone-runtime.ts");
const previewRuntimeSource = read("src/engine-clone-preview-runtime.ts");
const shaderSource = read("src/clone-shaders.ts");
const engineSource = read("src/brush-engine.ts");
const inputSource = read("src/canvas-input-controller.ts");
const historySource = read("src/engine-history-types.ts");
const mainSource = read("src/main.ts");

assert.match(runtimeSource, /engine\.layerStack\.layers\.slice/);
assert.doesNotMatch(runtimeSource, /mixedSceneStack|VectorSvg|VectorText/,
  "Clone source discovery must remain raster-only");
assert.match(runtimeSource, /!activeRecord[\s\S]{0,160}activeRecord\.opacity <= 0/);
assert.match(runtimeSource, /foldRasterRecordIntoMergedSurface/);
assert.match(runtimeSource, /foldClippingGroupIntoMergedSurface/);
assert.match(runtimeSource, /"clone-source"/);
assert.match(
  runtimeSource,
  /record\.visible && record\.opacity > 0 && recordHasCloneContent\(engine, record\)/,
  "the frozen source must exclude hidden, zero-opacity and empty raster layers",
);
assert.match(runtimeSource, /prepareCloneSourceSnapshot/);
assert.match(runtimeSource, /submitRequestedCloneTiles/);
assert.match(runtimeSource, /resolvedTiles/,
  "transparent source pages need an explicit resolved state");
const interactiveTilePump = runtimeSource.slice(
  runtimeSource.indexOf("function submitRequestedCloneTiles"),
  runtimeSource.indexOf("export function requestCloneSourceForRect"),
);
assert.doesNotMatch(
  interactiveTilePump,
  /waitForGpuCapped|onSubmittedWorkDone|\bawait\b/,
  "the interactive source-page pump must never wait for global GPU completion",
);
assert.doesNotMatch(runtimeSource, /mapAsync|getImageData|putImageData/,
  "source pixels must never be read by the CPU");
assert.match(previewRuntimeSource, /GPUTextureUsage\.RENDER_ATTACHMENT/);
assert.match(previewRuntimeSource, /CLONE_PREVIEW_MAX_BACKING_PIXELS = 256/);
assert.match(previewRuntimeSource, /renderCloneSamplePreview/);
assert.match(previewRuntimeSource, /clonePreviewTextureSource/);
assert.match(previewRuntimeSource, /shapeControls: vec4<f32>/);
assert.match(
  previewRuntimeSource,
  /textureSample\(\s*shapeTexture,\s*shapeSampler,\s*shapeUv,\s*i32\(preview\.shapeControls\.x\)/,
  "the first-sample preview must sample the deterministically selected Shape layer",
);
assert.match(
  previewRuntimeSource,
  /shapeLayerForStamp\(\s*engine\.settings\.shapeSequenceMode,\s*0,\s*nextPaintStampSeed\(engine\.seedSequence\),\s*shapeAssetSequenceLengthForSettings\(engine\.settings\)/,
  "the first-sample preview must predict the next authoritative Paint/Clone Shape selection",
);
assert.doesNotMatch(previewRuntimeSource, /mapAsync|getImageData|putImageData|beginCloneStroke/,
  "the first-sample preview must remain GPU-only and outside stroke History");
assert.match(shaderSource, /texture_2d_array<f32>/);
assert.match(shaderSource, /sourceAndDestination: vec4<f32>/);
assert.match(shaderSource, /rotationAndDocument: vec4<f32>/);
assert.match(shaderSource, /rotationCos \* destinationDelta\.x - rotationSin \* destinationDelta\.y/);
assert.match(shaderSource, /cloneSourcePageTable/);
assert.match(shaderSource, /cloneSourceTexel\(base \+ vec2<i32>\(1, 1\)\)/,
  "manual bilinear sampling must cross virtual-page seams");
assert.match(shaderSource, /let sampled = sampleCloneSource\(documentPosition\)/);
assert.match(shaderSource, /\$\{rgba8HighFrequencyQuantizationShader\}/);
assert.match(shaderSource, /storageAndSeed: vec4<u32>/);
assert.match(
  shaderSource,
  /quantizeRgba8HighFrequencyAdjacent\([\s\S]*?encodedContribution,[\s\S]*?destinationCoordinate,[\s\S]*?cloneSource\.storageAndSeed\.y/,
  "encoded RGBA8 Clone output must use replay-stable document-space adjacent codes",
);
assert.match(
  shaderSource,
  /fn boundedEncodedPremultiplied[\s\S]*?min\([\s\S]*?vec3<f32>\(alpha\)/,
  "encoded Clone samples must retain the RGB <= alpha premultiplication invariant",
);
assert.match(
  runtimeSource,
  /uniformU32\[12\] = engine\.layerFormat === "rgba8unorm"[\s\S]*?engine\.documentStorageColorSpace === "encoded-srgb-premultiplied"/,
  "the encoded Clone shader path must be selected only by the authoritative document contract",
);
assert.match(runtimeSource, /uniformU32\[13\] = quantizationSeed >>> 0/);
assert.match(
  runtimeSource,
  /`Clone action \$\{actionId\}`,[\s\S]{0,80}?actionId,/,
  "a live Clone action must seed adjacent-code quantization from its history identity",
);
assert.match(
  runtimeSource,
  /`Clone replay action \$\{replayBatch\.actionId\}`,[\s\S]{0,100}?replayBatch\.actionId,/,
  "Clone replay must reconstruct the same adjacent-code field",
);
assert.match(
  previewRuntimeSource,
  /if \(preview\.shapeControls\.y > 0\.5\)[\s\S]*?return boundedEncodedPremultiplied\(sampled\);[\s\S]*?return linearPremultipliedToEncodedSrgb\(sampled\);/,
  "the RGBA8 first-sample preview must not apply the sRGB transfer twice",
);
assert.match(
  previewRuntimeSource,
  /upload\[13\] = engine\.layerFormat === "rgba8unorm"[\s\S]*?engine\.documentStorageColorSpace === "encoded-srgb-premultiplied"/,
);
assert.match(engineSource, /beginCloneStroke\([\s\S]*?beginStrokeAtLayer\(point, true, configuration\)/);
assert.match(engineSource, /await ensureCloneSourceForStamps/);
assert.match(engineSource, /prepareCloneTool\([\s\S]*?warmCloneSamplePreview[\s\S]*?prepareCloneSourceSnapshot/);
const clonePreparationGate = engineSource.slice(
  engineSource.indexOf("async prepareCloneTool("),
  engineSource.indexOf("renderCloneToolPreview("),
);
assert.match(
  clonePreparationGate,
  /ensureThicknessTailPresentationPipeline\(this\)/,
  "Clone's first deferred frame must compile its display pipeline even at endThickness=1",
);
const clonePendingGate = engineSource.slice(
  engineSource.indexOf("isCloneReadinessPending("),
  engineSource.indexOf("beginCloneStroke("),
);
assert.match(clonePendingGate, /!this\.thicknessTailPresentationPipelineReady/,
  "Clone readiness must remain pending until deferred presentation is resident");
const cloneBeginGate = engineSource.slice(
  engineSource.indexOf("beginCloneStroke("),
  engineSource.indexOf("extendCloneStroke("),
);
assert.match(cloneBeginGate, /!this\.thicknessTailPresentationPipelineReady/,
  "Clone must reject a first stroke before deferred presentation is resident");
assert.match(
  engineSource,
  /if \(!presentationPipeline\) \{[\s\S]*?deferred stroke presentation pipeline is not ready/,
  "rendering must diagnose a missing pipeline before passing it to WebGPU",
);
assert.match(engineSource, /cloneHistorySource: null|cloneSource,/);
assert.match(engineSource, /clonePlan \? CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES : undefined/);
assert.match(historySource, /cloneSource: CloneHistorySourcePayload \| null/);
assert.match(inputSource, /pointerMode === "clone"/);
assert.match(inputSource, /engine\.extendCloneStroke/);
assert.match(inputSource, /engine\.endCloneStroke/);
assert.match(inputSource, /angleDegrees: action\.sample\.angleDegrees/);
assert.doesNotMatch(
  inputSource.slice(
    inputSource.indexOf("if (cloneInput)"),
    inputSource.indexOf("const holdPaintIntent"),
  ),
  /PaintRecording|StraightLine/,
  "Clone must not enter Paint recording or line recognition",
);
assert.match(mainSource, /new CloneToolController/);
assert.match(mainSource, /getCloneController: \(\) => cloneToolController/);
assert.match(mainSource, /prepareActiveCloneSource/);
assert.match(mainSource, /prepareCloneSource: \(sampleMode\) => prepareActiveCloneSource\(sampleMode\)/,
  "the central input owner must be able to restore a consumed or canceled Clone source");
const canceledCloneCalls = [...inputSource.matchAll(/engine\.cancelCloneStroke\(\);/g)];
assert.ok(canceledCloneCalls.length >= 3);
for (const call of canceledCloneCalls) {
  assert.match(
    inputSource.slice(call.index, call.index + 220),
    /prepareCloneSourceAfterCanceledStroke/,
    "every canceled Clone stroke must immediately restart source preparation",
  );
}
const cloneInputRoute = inputSource.slice(
  inputSource.indexOf("if (cloneInput)"),
  inputSource.indexOf("if (shapeInput"),
);
assert.match(cloneInputRoute, /cloneController\?\.setSourcePreparing\(true\)/,
  "a consumed Clone snapshot must close the next-stroke gate immediately");
const cloneHistoryRefresh = mainSource.slice(
  mainSource.indexOf("onHistoryChange(state)"),
  mainSource.indexOf("onViewChange("),
);
assert.match(cloneHistoryRefresh, /prepareActiveCloneSource/,
  "a committed Clone stroke must rebuild its consumed source after History publishes");
const cloneViewCallback = mainSource.slice(
  mainSource.indexOf("onViewChange()"),
  mainSource.indexOf("onPixelSelectionChange()"),
);
assert.doesNotMatch(cloneViewCallback, /prepareActiveCloneSource/,
  "pan, zoom and rotation must not rebuild an immutable Clone raster source");
assert.match(
  mainSource,
  /function updateHistoryControls\(\): void \{[\s\S]*?cloneToolController\?\.notifyInteractionState\(\)/,
  "Clone controls must resync after the canvas releases its active pointer",
);
assert.match(
  mainSource,
  /onControlsLockChange: \(locked\) => \{[\s\S]*?cloneToolController\?\.notifyInteractionState\(\)/,
  "Clone controls must resync when a History lock is released",
);

const initialAtlasBytes = layout.tileWidth * layout.tileHeight * 8
  * CLONE_SOURCE_INITIAL_ATLAS_LAYERS;
const maximumAtlasBytes = layout.tileWidth * layout.tileHeight * 8
  * CLONE_SOURCE_PAGE_TABLE_LENGTH;
assert.equal(initialAtlasBytes / 1024 / 1024, 0.5);
assert.equal(maximumAtlasBytes / 1024 / 1024, 32);
const initialRgba8AtlasBytes = layout.tileWidth * layout.tileHeight * 4
  * CLONE_SOURCE_INITIAL_ATLAS_LAYERS;
const maximumRgba8AtlasBytes = layout.tileWidth * layout.tileHeight * 4
  * CLONE_SOURCE_PAGE_TABLE_LENGTH;
assert.equal(initialRgba8AtlasBytes / 1024 / 1024, 0.25);
assert.equal(maximumRgba8AtlasBytes / 1024 / 1024, 16);

const clampUnit = (value) => Math.max(0, Math.min(1, value));
const linearToSrgbChannel = (value) => {
  const bounded = clampUnit(value);
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
};
const darkEncodedCode = 16;
const darkEncoded = darkEncodedCode / 255;
assert.equal(
  Math.round(darkEncoded * 255),
  darkEncodedCode,
  "the encoded preview branch must preserve a dark stored code",
);
assert.ok(
  Math.round(linearToSrgbChannel(darkEncoded) * 255) >= 70,
  "the former double transfer must remain a discriminating preview failure",
);

const sourcePremultiplied = [0.071, 0.193, 0.411, 0.537];
const deposit = 0.137;
const contribution = sourcePremultiplied.map((channel) => channel * deposit);
const codeSums = [0, 0, 0, 0];
for (let y = 0; y < 16; y += 1) {
  for (let x = 0; x < 16; x += 1) {
    const codes = contribution.map((channel) => (
      quantizeUnorm8HighFrequencyAdjacent(channel, x, y, 93)
    ));
    for (let channel = 0; channel < 3; channel += 1) {
      assert.ok(codes[channel] <= codes[3], "Clone quantization must preserve RGB <= alpha");
    }
    codes.forEach((code, channel) => { codeSums[channel] += code; });
  }
}
codeSums.forEach((sum, channel) => {
  const meanCode = sum / 256;
  const idealCode = contribution[channel] * 255;
  assert.ok(
    Math.abs(meanCode - idealCode) <= 1 / 256 + 1e-12,
    `Clone adjacent-code mean ${meanCode} must preserve ${idealCode}`,
  );
});
for (const code of [0, 1, 7, 16, 64, 127, 254, 255]) {
  for (const seed of [0, 1, 93, 0xffff]) {
    assert.equal(
      quantizeUnorm8HighFrequencyAdjacent(code / 255, 317, 911, seed),
      code,
      "Clone quantization must preserve every exact stored source code",
    );
  }
}

const benchmarkStartedAt = performance.now();
let requestedPages = 0;
const benchmarkTransform = createCloneSourceTransform({
  sourceX: -140,
  sourceY: 75,
  destinationX: 0,
  destinationY: 0,
  angleDegrees: 37,
});
for (let index = 0; index < 100_000; index += 1) {
  const x = index % 2000;
  const y = index * 37 % 2000;
  requestedPages += cloneSourceTileIndicesForRect(
    layout,
    { x, y, width: 96, height: 96 },
    benchmarkTransform,
  ).length;
}
const benchmarkMs = performance.now() - benchmarkStartedAt;
assert.ok(requestedPages > 0);
assert.ok(benchmarkMs < 2_000, `virtual-page planning took ${benchmarkMs.toFixed(1)} ms`);

console.log(
  `Clone verified: encoded RGBA8 preview/write parity, adjacent-code replay, rotated frozen `
    + `raster source, fence-free live pages, immutable GPU replay, bounded 0.25–16 MiB `
    + `RGBA8 atlas and page planning in ${benchmarkMs.toFixed(1)} ms.`,
);
