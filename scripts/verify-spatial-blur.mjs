import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
  server: { middlewareMode: true },
});
let gaussian;
let spatial;
let interaction;
try {
  gaussian = await moduleServer.ssrLoadModule("/src/gaussian-blur-core.ts");
  spatial = await moduleServer.ssrLoadModule("/src/spatial-blur-core.ts");
  interaction = await moduleServer.ssrLoadModule("/src/spatial-blur-interaction-core.ts");
} finally {
  await moduleServer.close();
}
const {
  DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS,
  DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS,
  destructiveGaussianBlurBounds,
  destructiveGaussianBlurKernel,
} = gaussian;
const {
  SPATIAL_BLUR_DEFAULT_RADIUS,
  SPATIAL_BLUR_MAX_PIN_COUNT,
  SPATIAL_BLUR_MAX_RADIUS,
  SPATIAL_BLUR_RADIUS_QUANTIZATION,
  createInitialSpatialBlurPin,
  normalizeSpatialBlurPins,
  spatialBlurBounds,
  spatialBlurGaussianKernel,
  spatialBlurMaximumRadius,
  spatialBlurPinsEqual,
  spatialBlurRadiusAt,
  unionSpatialBlurRects,
} = spatial;
const {
  SPATIAL_BLUR_ADJUST_RATE,
  SPATIAL_BLUR_MODES,
  hitTestSpatialBlurPins,
  isSpatialBlurMode,
  spatialBlurAdjustedRadius,
  spatialBlurPinFillPercent,
  spatialBlurPointerMoved,
} = interaction;

assert.equal(SPATIAL_BLUR_DEFAULT_RADIUS, DESTRUCTIVE_GAUSSIAN_BLUR_DEFAULT_RADIUS);
assert.equal(SPATIAL_BLUR_MAX_RADIUS, DESTRUCTIVE_GAUSSIAN_BLUR_MAX_RADIUS);
assert.equal(spatialBlurGaussianKernel, destructiveGaussianBlurKernel);
for (const radius of [0, 0.25, 5, 50, 500]) {
  assert.deepEqual(
    spatialBlurGaussianKernel(radius),
    destructiveGaussianBlurKernel(radius),
    `the point field must use the shared kernel at radius ${radius}`,
  );
}

assert.deepEqual(createInitialSpatialBlurPin(2048, 1024), {
  x: 1024,
  y: 512,
  radius: SPATIAL_BLUR_DEFAULT_RADIUS,
});
const overfullPins = Array.from({ length: 40 }, (_, index) => ({
  x: index === 0 ? -50 : index * 100,
  y: index === 0 ? Number.POSITIVE_INFINITY : index * 100,
  radius: index === 0 ? 999 : index,
}));
const normalized = normalizeSpatialBlurPins(overfullPins, 512, 256);
assert.equal(normalized.length, SPATIAL_BLUR_MAX_PIN_COUNT);
assert.deepEqual(normalized[0], { x: 0, y: 128, radius: 500 });
assert.equal(Object.isFrozen(normalized), true);
assert.equal(Object.isFrozen(normalized[0]), true);
assert.equal(spatialBlurMaximumRadius(normalized), 500);
assert.equal(spatialBlurPinsEqual(normalized, normalized.map((pin) => ({ ...pin }))), true);

const uniformPin = [{ x: 50, y: 60, radius: 37.25 }];
for (const [x, y] of [[0, 0], [50, 60], [2048, 2048], [913, 117]]) {
  assert.equal(spatialBlurRadiusAt(uniformPin, x, y, 2048, 2048), 37.25);
}
assert.equal(spatialBlurRadiusAt([
  { x: 0, y: 100, radius: 0 },
  { x: 200, y: 100, radius: 100 },
], 100, 100, 200, 200), 50);
assert.equal(spatialBlurRadiusAt([
  { x: 40, y: 40, radius: 12 },
  { x: 40, y: 40, radius: 90 },
], 40, 40, 100, 100), 12, "coincident points resolve in stable order");

const content = { x: 20, y: 30, width: 100, height: 120 };
for (const radius of [0, 5, 50, 500]) {
  assert.deepEqual(
    spatialBlurBounds(content, radius, 2048, 2048),
    destructiveGaussianBlurBounds(content, radius, 2048, 2048),
  );
}
assert.deepEqual(
  unionSpatialBlurRects(
    { x: 10, y: 20, width: 30, height: 40 },
    { x: 0, y: 30, width: 80, height: 10 },
  ),
  { x: 0, y: 20, width: 80, height: 40 },
);

assert.deepEqual(SPATIAL_BLUR_MODES, ["add", "adjust", "remove"]);
assert.equal(isSpatialBlurMode("adjust"), true);
assert.equal(isSpatialBlurMode("move"), false);
assert.equal(SPATIAL_BLUR_ADJUST_RATE, 2);
assert.equal(spatialBlurAdjustedRadius(10, 100, 90), 30);
assert.equal(spatialBlurAdjustedRadius(10, 100, 500), 0);
assert.equal(spatialBlurAdjustedRadius(490, 100, 0), 500);
assert.equal(spatialBlurPinFillPercent(250), 50);
assert.equal(spatialBlurPointerMoved(0, 0, 8, 0), false);
assert.equal(spatialBlurPointerMoved(0, 0, 8.01, 0), true);
const screenPins = [
  { id: 1, x: 0, y: 0, radius: 5, clientX: 100, clientY: 100 },
  { id: 2, x: 0, y: 0, radius: 5, clientX: 110, clientY: 100 },
];
assert.equal(hitTestSpatialBlurPins(screenPins, 109, 100, "mouse"), 2);
assert.equal(hitTestSpatialBlurPins(screenPins, 139, 100, "touch"), 2);
assert.equal(hitTestSpatialBlurPins(screenPins, 141, 100, "touch"), null);

const root = new URL("../", import.meta.url);
const runtimeSource = readFileSync(new URL("src/engine-spatial-blur-runtime.ts", root), "utf8");
const controllerSource = readFileSync(new URL("src/spatial-blur-controller.ts", root), "utf8");
const adjustmentsSource = readFileSync(
  new URL("src/raster-adjustments-controller.ts", root),
  "utf8",
);
const engineSource = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const historySource = readFileSync(new URL("src/engine-history-types.ts", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");
const htmlSource = readFileSync(new URL("index.html", root), "utf8");
const stylesSource = readFileSync(new URL("src/styles.css", root), "utf8");

assert.match(runtimeSource, /spatialBlurGaussianKernel\(/);
assert.match(runtimeSource, /table\[offset \* WEIGHT_RADIUS_COUNT \+ radiusIndex\]/);
assert.match(runtimeSource, /texture_storage_2d<r32uint, write>/);
assert.match(runtimeSource, /texture_storage_2d<rgba16float, write>/);
assert.match(runtimeSource, /atomicMax\(&groupSupport, supportRadius\(radiusIndex\)\)/);
assert.match(runtimeSource, /if \(pins\.length > 1\)/,
  "one point must bypass the radius-field pass because its field is uniform");
assert.match(runtimeSource, /requestedSerial/);
assert.match(runtimeSource, /encodedSerial/);
assert.match(runtimeSource, /previewInFlight/);
assert.doesNotMatch(runtimeSource, /\bmip(?:map|maps|level|levels)?\b/i);
assert.doesNotMatch(runtimeSource, /\bpyramid\b/i);
assert.equal((runtimeSource.match(/commitHistoryActionAtomically\(engine, action\)/g) ?? []).length, 1);
assert.match(historySource, /filter: "spatial-blur"/);
assert.match(historySource, /kernelStrategy: "shared-gaussian-kernel-v1"/);
assert.match(engineSource, /warmRasterSpatialBlurPipelines\(this\)/);
assert.match(engineSource, /activeRasterSpatialBlurSession/);

assert.match(controllerSource, /requestAnimationFrame/);
assert.match(controllerSource, /cancelSpatialBlurPointerGestureForNavigation|cancelPointerGestureForNavigation/);
assert.match(controllerSource, /mode === "add"[\s\S]*?"move" : "pending-add"/);
assert.match(adjustmentsSource, /createInitialSpatialBlurPin/);
assert.match(adjustmentsSource, /commitRasterSpatialBlur/);
const toolsStart = htmlSource.indexOf('id="mobileToolsSheet"');
const toolsEnd = htmlSource.indexOf("</aside>", toolsStart);
const toolsSource = htmlSource.slice(toolsStart, toolsEnd);
const filtersStart = htmlSource.indexOf('id="editorFiltersPanel"');
const filtersEnd = htmlSource.indexOf("</aside>", filtersStart);
const filtersSource = htmlSource.slice(filtersStart, filtersEnd);
assert.match(
  toolsSource,
  /id="mobileMotionBlurOpen"[\s\S]*?id="mobileSpatialBlurOpen"[\s\S]*?Point Blur/,
  "Point Blur must be adjacent to Motion Blur in Tools → Adjustments",
);
assert.match(toolsSource, /data-lucide="point-blur"/);
assert.doesNotMatch(filtersSource, /Point Blur|spatial-blur/);
assert.match(mainSource, /PointBlur: pointBlurIcon/);
assert.match(adjustmentsSource, /spatialBlur\.openButton\.addEventListener/);
assert.match(adjustmentsSource, /beginSpatialBlur[\s\S]*?configureCanvasTool\("pan", false\)/);
assert.match(adjustmentsSource, /closeSpatialBlur[\s\S]*?configureCanvasTool\("pan", false\)/);
assert.match(htmlSource, /id="spatialBlurTopBar"/);
assert.match(htmlSource, /data-spatial-blur-mode="add"[\s\S]*?>ADD<\/button>/);
assert.match(htmlSource, /data-spatial-blur-mode="adjust"[\s\S]*?>ADJUST<\/button>/);
assert.match(htmlSource, /data-spatial-blur-mode="remove"[\s\S]*?>REMOVE<\/button>/);
assert.match(stylesSource, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(stylesSource, /width: 48px;[\s\S]*?height: 48px;/);
assert.match(
  stylesSource,
  /#gpuCanvas\.spatial-blur-active ~ \.gpu-memory-monitor[\s\S]*?visibility: hidden;/,
);
assert.match(
  stylesSource,
  /#gpuCanvas\.spatial-blur-active ~ #brushOutlineCanvas\s*\{[\s\S]*?display: none;/,
  "Point Blur must suppress the brush preview on every viewport",
);

const warmupStartedAt = performance.now();
let kernelChecksum = 0;
for (
  let radiusIndex = 0;
  radiusIndex <= SPATIAL_BLUR_MAX_RADIUS * SPATIAL_BLUR_RADIUS_QUANTIZATION;
  radiusIndex += 1
) {
  const kernel = spatialBlurGaussianKernel(radiusIndex / SPATIAL_BLUR_RADIUS_QUANTIZATION);
  kernelChecksum += kernel.weights[0] + kernel.weights.at(-1);
}
const warmupMs = performance.now() - warmupStartedAt;
assert.equal(Number.isFinite(kernelChecksum), true);
assert.ok(warmupMs < 5_000, `shared weight generation took ${warmupMs.toFixed(1)} ms`);

console.log(
  `Point Blur verified: shared Gaussian kernel, pin field, gestures, one-step history, `
    + `responsive UI and uniform-point fast path. Weight generation ${warmupMs.toFixed(1)} ms.`,
);
