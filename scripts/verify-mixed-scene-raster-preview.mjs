import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { MixedSceneStack } from "../src/mixed-scene-stack.ts";
import {
  MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES,
  mixedSceneRasterPreviewInverseAffine,
  mixedSceneRasterPreviewTransformedBounds,
  mixedSceneRasterSegmentUniformValues,
  normalizeMixedSceneRasterTransformPreview,
} from "../src/mixed-scene-raster-transform-preview.ts";
import {
  activeRasterCompositeSamplingPadding,
  intersectMixedSceneCompositeRects,
  mixedSceneDocumentRectToPresentationRect,
} from "../src/mixed-scene-composite-roi.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const runtimeSource = read("src/engine-mixed-scene-raster-preview-runtime.ts");
const layerRuntimeSource = read("src/engine-layer-runtime.ts");
const vectorRuntimeSource = read("src/engine-vector-text-runtime.ts");
const compositorSource = read("src/mixed-scene-compositor-shader.ts");
const engineSource = read("src/brush-engine.ts");
const resourceSetupSource = read("src/engine-runtime-misc.ts");
const shapeResourceSource = read("src/mixed-scene-shape-resources.ts");

const transform = normalizeMixedSceneRasterTransformPreview({
  key: "raster:7",
  pivotX: 120,
  pivotY: 80,
  translationX: 35,
  translationY: -12,
  scaleX: 1.7,
  scaleY: 0.65,
  rotation: Math.PI / 5,
});
assert.equal(transform.rasterLayerId, 7);
const inverse = mixedSceneRasterPreviewInverseAffine(transform);
const source = { x: 166, y: 43 };
const dx = source.x - transform.pivotX;
const dy = source.y - transform.pivotY;
const cosine = Math.cos(transform.rotation);
const sine = Math.sin(transform.rotation);
const destination = {
  x: transform.pivotX + transform.translationX
    + cosine * transform.scaleX * dx
    - sine * transform.scaleY * dy,
  y: transform.pivotY + transform.translationY
    + sine * transform.scaleX * dx
    + cosine * transform.scaleY * dy,
};
assert.ok(Math.abs(inverse[0] * destination.x + inverse[1] * destination.y + inverse[2] - source.x) < 1e-9);
assert.ok(Math.abs(inverse[3] * destination.x + inverse[4] * destination.y + inverse[5] - source.y) < 1e-9);

const uniform = mixedSceneRasterSegmentUniformValues({
  bounds: { x: 64, y: 32, width: 128, height: 96 },
  resolutionScale: 1,
}, 0.75, transform);
assert.equal(uniform.byteLength, MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES);
assert.equal(uniform.length, 12);
assert.deepEqual([...uniform.slice(0, 4)], [64, 32, 1, 0.75]);
assert.ok(Math.abs(uniform[7] - 1 / Math.abs(transform.scaleY)) < 1e-6);
assert.throws(
  () => normalizeMixedSceneRasterTransformPreview({ ...transform, scaleY: 0 }),
  /invertible/,
);

const transformedBounds = mixedSceneRasterPreviewTransformedBounds(
  { x: 10, y: 20, width: 30, height: 10 },
  {
    pivotX: 0,
    pivotY: 0,
    translationX: 5,
    translationY: -3,
    scaleX: 2,
    scaleY: 1,
    rotation: Math.PI / 2,
  },
);
assert.ok(Math.abs(transformedBounds.x + 25) < 1e-9);
assert.ok(Math.abs(transformedBounds.y - 17) < 1e-9);
assert.ok(Math.abs(transformedBounds.width - 10) < 1e-9);
assert.ok(Math.abs(transformedBounds.height - 60) < 1e-9);

const projectedBounds = mixedSceneDocumentRectToPresentationRect(
  {
    canvasWidth: 200,
    canvasHeight: 100,
    centerX: 50,
    centerY: 50,
    zoom: 2,
    rotationCos: 1,
    rotationSin: 0,
  },
  { x: 40, y: 45, width: 20, height: 10 },
);
assert.deepEqual(projectedBounds, { x: 79, y: 39, width: 42, height: 22 });
assert.deepEqual(
  intersectMixedSceneCompositeRects(projectedBounds, {
    x: 90,
    y: 0,
    width: 20,
    height: 100,
  }),
  { x: 90, y: 39, width: 20, height: 22 },
);
assert.equal(activeRasterCompositeSamplingPadding(0.25, 0, 12), 8);
assert.equal(activeRasterCompositeSamplingPadding(1, 0, 12), 2);

const encodedActiveStart = vectorRuntimeSource.indexOf(
  "const usesCompactEncodedActiveComposite",
);
const encodedRasterStart = vectorRuntimeSource.indexOf(
  "const usesCompactEncodedRasterComposite",
);
const encodedVectorStart = vectorRuntimeSource.indexOf(
  "const usesCompactEncodedVectorComposite",
);
const encodedActiveSource = vectorRuntimeSource.slice(encodedActiveStart, encodedRasterStart);
const encodedRasterSource = vectorRuntimeSource.slice(encodedRasterStart, encodedVectorStart);
assert.match(encodedActiveSource, /activeCompositeRect[\s\S]*?setScissorRect/);
assert.match(encodedActiveSource, /width: activeCompositeRect\.width/);
assert.match(encodedRasterSource, /mixedSceneRasterPreviewTransformedBounds/);
assert.match(encodedRasterSource, /rasterCompositeRect[\s\S]*?setScissorRect/);
assert.match(encodedRasterSource, /width: rasterCompositeRect\.width/);

const stack = new MixedSceneStack([1, 2, 3]);
stack.setClippingEnabled("raster:2", true);
assert.deepEqual(
  stack.compositionSegments(1, [1, 2], null, [2]).map((segment) => segment.key),
  [
    "active-raster:1",
    "raster-run:2@scene-clipping-source",
    "raster-run:3",
  ],
  "isolating one clipping child must preserve the active base in its exact slot",
);
assert.deepEqual(
  stack.compositionSegments(1, [1, 2], null, [1]).map((segment) => segment.key),
  [
    "raster-run:1@scene-clipping-source",
    "raster-run:2@scene-clipping-source",
    "raster-run:3",
  ],
  "isolating the active base must publish it as an immutable raster segment",
);
assert.deepEqual(
  stack.compositionSegments(1, [1, 2], null, [2, 3]).map((segment) => segment.key),
  [
    "active-raster:1",
    "raster-run:2@scene-clipping-source",
    "raster-run:3",
  ],
  "non-adjacent selected rasters must remain separate and ordered",
);

assert.match(runtimeSource, /nextSignature === state\.preparedSignature[\s\S]*?writePreparedPreviewUniforms/);
assert.match(runtimeSource, /while \(state\.preparedSignature !== state\.requestedSignature\)[\s\S]*?rebuildMergedLayerSurfaces/);
const hotUpdateStart = runtimeSource.indexOf("export function updateMixedSceneRasterTransformPreview");
const hotUpdateEnd = runtimeSource.indexOf("/** IDs used", hotUpdateStart);
const hotUpdateSource = runtimeSource.slice(hotUpdateStart, hotUpdateEnd);
assert.match(hotUpdateSource, /writePreparedPreviewUniforms/);
assert.doesNotMatch(hotUpdateSource, /rebuildMergedLayerSurfaces|await /);
assert.match(runtimeSource, /documentCutoutBaseUniformBuffer[\s\S]*?documentCutoutMaskUniformBuffer/);
const pyramidStart = layerRuntimeSource.indexOf("export function encodeMergedDisplayPyramids");
const pyramidEnd = layerRuntimeSource.indexOf("export async function freezeActiveLayerToCold", pyramidStart);
const pyramidSource = layerRuntimeSource.slice(pyramidStart, pyramidEnd);
assert.match(
  pyramidSource,
  /const previewLayerIds = mixedSceneRasterTransformPreviewCompositionLayerIds\(engine\)/,
);
assert.match(
  pyramidSource,
  /previewLayerIds\.has\(segment\.rasterLayerId\)/,
  "only surfaces owned by the live raster preview should be prewarmed",
);
assert.match(
  pyramidSource,
  /previewActive[\s\S]*?surface\.mipViews\.length - 1/,
  "the first preview frame must make every later minification sample valid",
);
assert.match(
  layerRuntimeSource,
  /function mixedSceneRasterSegmentSurfaces[\s\S]*?segment\.surface[\s\S]*?segment\.cutoutSurface[\s\S]*?segment\.documentCutoutBaseSurface[\s\S]*?segment\.documentCutoutMaskSurface/,
  "every transformed color or clipping surface must own valid sampled mips",
);
assert.match(
  pyramidSource,
  /for \(const \[surface, requiredLevel\] of targets\)[\s\S]*?encodeMergedSurfacePyramid/,
  "deduplicated mip work must be encoded before the frame compositor consumes it",
);
assert.doesNotMatch(
  pyramidSource,
  /await |waitForGpu|onSubmittedWorkDone/,
  "mip prewarm must stay in the frame command encoder without a CPU/GPU stall",
);
const prewarmStart = layerRuntimeSource.indexOf(
  "export async function prewarmMixedSceneRasterTransformPreviewPyramids",
);
const prewarmEnd = layerRuntimeSource.indexOf(
  "export function encodeMergedDisplayPyramids",
  prewarmStart,
);
const prewarmSource = layerRuntimeSource.slice(prewarmStart, prewarmEnd);
assert.match(prewarmSource, /new Set<MergedSurfaceResources>\(\)/);
assert.match(prewarmSource, /mixedSceneRasterSegmentSurfaces\(segment\)/);
assert.match(prewarmSource, /surface\.mipViews\.length - 1/);
assert.match(prewarmSource, /device\.queue\.submit[\s\S]*?await engine\.waitForGpuCapped/);
const previewResourceGateStart = engineSource.indexOf(
  "private async ensureMixedSceneRasterTransformPreviewResources",
);
const previewSetterStart = engineSource.indexOf(
  "async setMixedSceneRasterTransformPreview",
  previewResourceGateStart,
);
const previewSetterEnd = engineSource.indexOf(
  "async clearMixedSceneRasterTransformPreview",
  previewSetterStart,
);
assert.ok(previewResourceGateStart >= 0 && previewSetterStart > previewResourceGateStart);
const previewResourceGate = engineSource.slice(previewResourceGateStart, previewSetterStart);
const previewSetter = engineSource.slice(previewSetterStart, previewSetterEnd);
assert.match(
  previewResourceGate,
  /needsSegmentedClipping[\s\S]*?clippingGroupKeys\(transform\.key\)/,
  "the preflight must inspect prospective clipping groups before preview publication",
);
assert.match(
  previewResourceGate,
  /needsFullCompositor[\s\S]*?ensureMixedSceneEditorResources[\s\S]*?ensureMixedSceneShapePreviewResources/,
  "advanced or clipped previews need the full graph while plain raster previews reuse the compact source-over graph",
);
assert.match(
  previewResourceGate,
  /prewarmMixedSceneRasterTransformPreviewLinearResources\([\s\S]*?needsAdvancedBlend,[\s\S]*?needsSegmentedClipping/,
  "the prospective ordered viewport must exist before preview state is mutated",
);
const gateIndex = previewSetter.indexOf("ensureMixedSceneRasterTransformPreviewResources");
const mutationIndex = previewSetter.indexOf("setMixedSceneRasterTransformPreviewRuntime");
const pyramidIndex = previewSetter.indexOf("prewarmMixedSceneRasterTransformPreviewPyramids");
assert.ok(
  gateIndex >= 0 && gateIndex < mutationIndex && mutationIndex < pyramidIndex,
  "group Transform must gate GPU resources before publishing preview state and then prewarm sampling",
);
assert.match(
  shapeResourceSource,
  /export async function ensureMixedSceneShapePreviewResources[\s\S]*?Mixed scene raster segment source-over pipeline[\s\S]*?Mixed scene active base layer source-over pipeline/,
  "the reused compact gate must own the segment and active source-over pipelines",
);
assert.match(
  vectorRuntimeSource,
  /prewarmMixedSceneRasterTransformPreviewLinearResources[\s\S]*?prewarmMixedSceneLinearTextureForLayerBlend[\s\S]*?await prewarmMixedSceneClippingScratch\([\s\S]*?needsSegmentedClipping/,
  "linear and prospective clipping targets must be validated without relying on published preview IDs",
);
assert.match(
  vectorRuntimeSource,
  /export async function prewarmMixedSceneClippingScratch[\s\S]*?runGpuAllocationTransaction\([\s\S]*?publishMixedSceneClippingScratchCandidate/,
  "prospective clipping scratch must publish only after WebGPU validation and out-of-memory scopes succeed",
);
assert.match(compositorSource, /sourceLayerPosition[\s\S]*?inverseRowX[\s\S]*?inverseRowY/);
assert.match(resourceSetupSource, /minBindingSize: MIXED_SCENE_RASTER_SEGMENT_UNIFORM_BYTES/);
assert.match(engineSource, /compositionSegments\([\s\S]*?mixedSceneRasterTransformPreviewCompositionLayerIds/);

const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
try {
  const previewRuntime = await vite.ssrLoadModule(
    "/src/engine-mixed-scene-raster-preview-runtime.ts",
  );
  const layerRuntime = await vite.ssrLoadModule("/src/engine-layer-runtime.ts");
  const vectorRuntime = await vite.ssrLoadModule("/src/engine-vector-text-runtime.ts");
  const previousGpuTextureUsage = globalThis.GPUTextureUsage;
  globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
  try {
    const prospectiveClippingEngine = {
      deviceLostError: null,
      layerStack: { layers: [] },
      displayUniformBuffer: {},
      mixedScenePresentBindGroupLayout: {},
      mixedSceneLinearTexture: {},
      mixedSceneLinearView: {},
      mixedSceneLinearWidth: 64,
      mixedSceneLinearHeight: 64,
      mixedSceneClippingScratchTexture: null,
      mixedSceneClippingScratchView: null,
      mixedSceneClippingScratchBindGroup: null,
      mixedSceneClippingScratchWidth: 0,
      mixedSceneClippingScratchHeight: 0,
      mixedSceneClippingScratchCompositePipeline: {},
      presentationCacheNeedsFullRebuild: false,
      device: {
        pushErrorScope() {},
        async popErrorScope() {
          return null;
        },
        createTexture() {
          return {
            createView() {
              return { kind: "prospective clipping view" };
            },
            destroy() {},
          };
        },
        createBindGroup() {
          return { kind: "prospective clipping bind group" };
        },
      },
    };
    await vectorRuntime.prewarmMixedSceneRasterTransformPreviewLinearResources(
      prospectiveClippingEngine,
      64,
      64,
      false,
      true,
    );
    assert.ok(
      prospectiveClippingEngine.mixedSceneClippingScratchTexture,
      "prospective clipping must allocate scratch before preview IDs are published",
    );
    assert.equal(prospectiveClippingEngine.presentationCacheNeedsFullRebuild, true);
  } finally {
    if (previousGpuTextureUsage === undefined) delete globalThis.GPUTextureUsage;
    else globalThis.GPUTextureUsage = previousGpuTextureUsage;
  }
  const events = [];
  const makeSurface = (name, levels) => ({
    name,
    bounds: { x: 0, y: 0, width: 64, height: 64 },
    resolutionScale: 1,
    mipViews: Array.from({ length: levels }, (_, index) => `${name}:view:${index}`),
    mipDownsampleBindGroups: Array.from(
      { length: levels - 1 },
      (_, index) => `${name}:bind:${index}`,
    ),
    validThroughLevel: 0,
  });
  const primary = makeSurface("primary", 6);
  const sharedAuxiliary = makeSurface("sharedAuxiliary", 5);
  const mask = makeSurface("mask", 4);
  const unselected = makeSurface("unselected", 7);
  const unowned = makeSurface("unowned", 6);
  const makeEncoder = () => ({
    beginRenderPass: ({ label }) => {
      events.push(`begin:${label}`);
      return {
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {
          events.push(`end:${label}`);
        },
      };
    },
    finish() {
      events.push("finish");
      return {};
    },
  });
  const selectedSegment = {
    rasterLayerId: 1,
    surface: primary,
    cutoutSurface: sharedAuxiliary,
    documentCutoutBaseSurface: sharedAuxiliary,
    documentCutoutMaskSurface: mask,
    documentCutoutBaseUniformBuffer: {},
    documentCutoutMaskUniformBuffer: {},
    uniformBuffer: {},
    opacity: 1,
  };
  const engine = {
    mixedSceneStack: { itemByKey: () => ({ kind: "raster" }) },
    mixedSceneRasterSegments: [
      selectedSegment,
      {
        ...selectedSegment,
        rasterLayerId: 2,
        surface: unselected,
        cutoutSurface: null,
        documentCutoutBaseSurface: null,
        documentCutoutMaskSurface: null,
        documentCutoutBaseUniformBuffer: null,
        documentCutoutMaskUniformBuffer: null,
      },
      {
        ...selectedSegment,
        rasterLayerId: null,
        surface: unowned,
        cutoutSurface: null,
        documentCutoutBaseSurface: null,
        documentCutoutMaskSurface: null,
        documentCutoutBaseUniformBuffer: null,
        documentCutoutMaskUniformBuffer: null,
      },
    ],
    mergedBelow: null,
    mergedAbove: null,
    zoom: 1,
    paintMipDownsamplePipeline: {},
    device: {
      createCommandEncoder() {
        events.push("create");
        return makeEncoder();
      },
      queue: {
        writeBuffer() {
          events.push("write");
        },
        submit() {
          events.push("submit");
        },
      },
    },
    async waitForIdle() {},
    async rebuildMergedLayerSurfaces() {},
    getVectorTextViewState() {
      return {};
    },
    async waitForGpuCapped() {
      events.push("wait");
    },
    requestRender() {
      events.push("request");
    },
  };
  const previewTransform = (scaleX, scaleY = scaleX) => ({
    key: "raster:1",
    pivotX: 32,
    pivotY: 32,
    translationX: 0,
    translationY: 0,
    scaleX,
    scaleY,
    rotation: 0,
  });

  await previewRuntime.setMixedSceneRasterTransformPreview(
    engine,
    [previewTransform(1)],
  );
  const prewarmEventStart = events.length;
  const passes = await layerRuntime.prewarmMixedSceneRasterTransformPreviewPyramids(engine);
  assert.equal(passes, 12);
  assert.deepEqual(
    [primary.validThroughLevel, sharedAuxiliary.validThroughLevel, mask.validThroughLevel],
    [5, 4, 3],
  );
  assert.equal(unselected.validThroughLevel, 0);
  assert.equal(unowned.validThroughLevel, 0);
  assert.equal(
    events.slice(prewarmEventStart).filter((event) => event === "submit").length,
    1,
  );
  const readyIndex = events.lastIndexOf("wait");
  engine.mixedSceneRasterSegments = [selectedSegment];

  for (const [scaleX, scaleY, zoom] of [
    [0.05, 0.05, 1],
    [0.05, 1, 1],
    [1, 0.05, 1],
    [0.05, 0.05, 0.02],
  ]) {
    engine.zoom = zoom;
    previewRuntime.updateMixedSceneRasterTransformPreview(
      engine,
      [previewTransform(scaleX, scaleY)],
    );
    assert.ok(readyIndex < events.lastIndexOf("write"));
    assert.equal(
      layerRuntime.encodeMergedDisplayPyramids(engine, makeEncoder(), 0),
      0,
      `live ${scaleX}x${scaleY} at zoom ${zoom} must not build a mip`,
    );
  }

  engine.zoom = 1;
  primary.validThroughLevel = 0;
  sharedAuxiliary.validThroughLevel = 0;
  mask.validThroughLevel = 0;
  const fallbackEventStart = events.length;
  assert.equal(
    layerRuntime.encodeMergedDisplayPyramids(engine, makeEncoder(), 0),
    12,
  );
  events.push("sample");
  const fallbackEvents = events.slice(fallbackEventStart);
  assert.ok(fallbackEvents.lastIndexOf("end:Build merged surface mip 3") >= 0);
  assert.ok(
    fallbackEvents.lastIndexOf("end:Build merged surface mip 3")
      < fallbackEvents.indexOf("sample"),
  );

  await previewRuntime.clearMixedSceneRasterTransformPreview(engine);
  primary.validThroughLevel = 0;
  sharedAuxiliary.validThroughLevel = 0;
  mask.validThroughLevel = 0;
  assert.equal(
    layerRuntime.encodeMergedDisplayPyramids(engine, makeEncoder(), 0),
    0,
  );
} finally {
  await vite.close();
}

console.log("Mixed-scene raster transform preview verification passed.");
