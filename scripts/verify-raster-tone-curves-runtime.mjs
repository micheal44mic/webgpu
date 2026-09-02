import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(
  new URL("../src/engine-raster-tone-curves-runtime.ts", import.meta.url),
  "utf8",
);
const shaders = readFileSync(
  new URL("../src/raster-tone-curves-shaders.ts", import.meta.url),
  "utf8",
);
const engine = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

assert.match(runtime, /destructive-raster-tone-curves-webgpu-v2-dual-storage-adjacent-code/);
assert.match(runtime, /type RasterToneCurvesEngineHost = BrushEngine &/);
assert.match(runtime, /activeRasterToneCurvesSession: ActiveRasterToneCurvesSession \| null/);
assert.match(runtime, /new WeakMap<[\s\S]{0,100}GPUDevice/);
assert.match(runtime, /export async function prewarmRasterToneCurvesRuntime/);
assert.match(runtime, /adjustmentPipeline: GPUComputePipeline/);
assert.match(runtime, /histogramPipeline: GPUComputePipeline/);
assert.match(runtime, /assertShaderCompiled\(adjustmentModule/);
assert.match(runtime, /assertShaderCompiled\(histogramModule/);
assert.doesNotMatch(
  shaders,
  /if\s*\([^)]*\)\s*(?!\{)[^\s/][^\n;]*;/,
  "WGSL conditionals must use block statements so pipeline prewarm cannot fail at runtime.",
);

assert.match(runtime, /format: engine\.layerFormat/);
assert.match(runtime, /format: profile\.layerFormat/);
assert.match(
  runtime,
  /GPUTextureUsage\.COPY_SRC[\s\S]{0,100}GPUTextureUsage\.COPY_DST[\s\S]{0,100}GPUTextureUsage\.TEXTURE_BINDING/,
);
assert.match(runtime, /const RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE = 16/);
assert.match(runtime, /binding: 3[\s\S]{0,160}type: "uniform"/);
assert.match(
  runtime,
  /label: "Raster tone curves output origin"[\s\S]{0,180}GPUBufferUsage\.UNIFORM \| GPUBufferUsage\.COPY_DST/,
);
assert.match(runtime, /\{ binding: 1, resource: authoritativeView \}/);
assert.match(
  runtime,
  /const quantizationSeed = engine\.nextHistoryActionId >>> 0/,
);
assert.doesNotMatch(runtime, /targetTexture|targetView/);
assert.match(runtime, /size: RASTER_TONE_CURVE_LUT_BYTE_SIZE/);
assert.match(runtime, /createPackedRasterToneCurveLut\(curves\)/);
assert.match(runtime, /DESTRUCTIVE_RASTER_TONE_CURVES_RGBA8_PRECISION/);
assert.match(runtime, /rasterAdjustmentBytesPerPixel\(engine\.layerFormat\)/);

assert.equal(
  (runtime.match(/histogramPass\.dispatchWorkgroups\(/g) ?? []).length,
  1,
  "The histogram must have one opening dispatch site.",
);
assert.equal(
  (runtime.match(/histogramReadback\.mapAsync\(GPUMapMode\.READ\)/g) ?? []).length,
  1,
  "The histogram must have one opening readback site.",
);
assert.match(runtime, /createEmptyRasterToneHistogram\(\)/);
assert.match(runtime, /histogram: session\.histogram\.slice\(\)/);
assert.match(runtime, /allocated\.histogramBuffer\.destroy\(\)/);
assert.match(runtime, /allocated\.histogramReadback\.destroy\(\)/);

assert.match(runtime, /requestedSerial: number/);
assert.match(runtime, /encodedSerial: number/);
assert.match(runtime, /const serial = session\.requestedSerial/);
assert.match(runtime, /const curves = copyCurves\(session\.curves\)/);
assert.match(runtime, /session\.encodedSerial !== session\.requestedSerial/);
assert.match(runtime, /schedulePreview\(engine, session\)/);
assert.match(runtime, /await flushPreview\(engine, session\)/);
assert.match(
  runtime,
  /function requireActiveToneCurvesLayer\([\s\S]{0,260}record\.id !== session\.layerId/,
  "Every live Curves transaction must remain bound to its opening raster.",
);
assert.match(
  runtime,
  /Tone Curves preview interrupted/,
  "Asynchronous preview faults must use the controller's Curves status channel.",
);

const preview = runtime.slice(
  runtime.indexOf("function encodeRequestedPreview("),
  runtime.indexOf("function startPreviewSubmission("),
);
assert.match(preview, /isRasterToneCurveSetIdentity\(curves\)/);
assert.match(preview, /texture: session\.sourceTexture/);
assert.match(preview, /texture: engine\.layerTexture/);
assert.match(preview, /pass\.setBindGroup\(0, session\.adjustmentBindGroup\)/);
assert.match(preview, /requireActiveToneCurvesLayer\(engine, session\)/);
assert.doesNotMatch(preview, /copyTextureToTexture\([\s\S]{0,240}session\.adjustmentBindGroup/);
assert.match(preview, /session\.encodedSerial = serial/);

const restore = runtime.slice(
  runtime.indexOf("async function restoreOriginalPixels("),
  runtime.indexOf("interface AllocatedToneCurvesSession"),
);
assert(
  restore.indexOf("await session.previewInFlight")
    < restore.indexOf("encoder.copyTextureToTexture"),
  "Cancel must wait for an already-owned preview before the final restore copy.",
);
assert.match(restore, /texture: session\.sourceTexture/);
assert.match(restore, /texture: engine\.layerTexture/);
assert.match(restore, /requireActiveToneCurvesLayer\(engine, session\)/);
assert.match(
  restore,
  /setAuthoritativeMetadata\(engine, session, bounds, session\.sourceTileMask\)/,
);

const begin = runtime.slice(
  runtime.indexOf("export async function beginRasterToneCurves("),
  runtime.indexOf("export function updateRasterToneCurves("),
);
assert.match(begin, /selected\?\.kind !== "raster"/);
assert.match(begin, /selected\.rasterLayerId !== record\.id/);
assert.match(begin, /pixelSelectionState\.selectedPixels > 0/);
assert.match(begin, /record\.contentBounds/);
assert.doesNotMatch(begin, /requires an RGBA16F document/);
assert.match(begin, /record\.storageTileMask\.slice\(\)/);

const commit = runtime.slice(runtime.indexOf("export async function commitRasterToneCurves("));
assert.match(
  commit,
  /isRasterToneCurveSetIdentity\(session\.curves\)[\s\S]{0,100}cancelRasterToneCurves\(engine\)/,
);
assert.match(commit, /const action: RasterFilterHistoryAction/);
assert.match(commit, /kind: "raster-filter"/);
assert.match(commit, /filter: "curves"/);
assert.match(commit, /lutSize: RASTER_TONE_CURVE_LUT_SIZE/);
assert.match(commit, /alphaMode: DESTRUCTIVE_RASTER_TONE_CURVES_ALPHA_MODE/);
assert.match(commit, /boundsMode: DESTRUCTIVE_RASTER_TONE_CURVES_BOUNDS_MODE/);
assert.match(commit, /baseBounds: \{ \.\.\.session\.sourceBounds \}/);
assert.match(commit, /baseTileMask: session\.sourceTileMask\.slice\(\)/);
assert.match(commit, /const record = requireActiveToneCurvesLayer\(engine, session\)/);
assert.match(commit, /commitHistoryActionAtomically\(engine, action\)/);
assert.doesNotMatch(commit, /as unknown|as never/);

assert.match(runtime, /export function abandonRasterToneCurvesSession/);
assert.match(runtime, /session\.sourceTexture\.destroy\(\)/);
assert.match(runtime, /session\.lutBuffer\.destroy\(\)/);
assert.match(runtime, /session\.parameterBuffer\.destroy\(\)/);
assert.match(
  runtime,
  /memoryBytes:[\s\S]{0,220}rasterAdjustmentBytesPerPixel\(engine\.layerFormat\)[\s\S]{0,180}RASTER_TONE_CURVES_PARAMETER_BYTE_SIZE/,
);
assert.doesNotMatch(
  runtime,
  /sourceBounds\.width \* sourceBounds\.height[\s\S]{0,80}rasterAdjustmentBytesPerPixel\(engine\.layerFormat\) \* 2/,
  "The transaction must retain one immutable crop, not a redundant output crop.",
);
assert.match(runtime, /latchDocumentStateInconsistent/);
assert.match(runtime, /destroyLayerColdStorage\(seed\)/);

assert.match(engine, /rasterToneCurvesPrewarmPromise: Promise<void> \| null = null/);
const optionalResources = engine.slice(
  engine.indexOf("async ensureOptionalEditorResources(): Promise<void>"),
  engine.indexOf("async prewarmRasterToneCurvesResources(): Promise<void>"),
);
assert.doesNotMatch(optionalResources, /RasterToneCurves|rasterToneCurves/);
const curvesPrewarm = engine.slice(
  engine.indexOf("async prewarmRasterToneCurvesResources(): Promise<void>"),
  engine.indexOf("One authoritative layer is exactly one document-sized mip-0 texture"),
);
assert.match(
  curvesPrewarm,
  /await prewarmRasterToneCurvesRuntime\([\s\S]{0,180}this\.layerFormat[\s\S]{0,100}this\.documentStorageColorSpace/,
);
assert.match(curvesPrewarm, /this\.rasterToneCurvesPrewarmPromise = initialization/);
assert.doesNotMatch(main, /deferred-raster-tone-curves|prewarmRasterToneCurvesResources\(\)/);
assert.match(
  runtime,
  /export async function beginRasterToneCurves[\s\S]{0,7000}const shared = await requireSharedResources\(engine\.device, \{[\s\S]{0,180}documentStorageColorSpace/,
  "opening Curves must compile its shared resources on demand",
);

console.log("Raster tone curves transactional runtime verification passed.");
