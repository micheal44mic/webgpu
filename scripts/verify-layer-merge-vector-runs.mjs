import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layerMergeRenderRunsModel = (items, vectorDraws = []) => {
  const runs = [];
  const vectorDrawsByKey = new Map(vectorDraws.map((entry) => [entry.key, entry]));
  let pendingVectors = [];
  const flushVectors = () => {
    if (pendingVectors.length === 0) return;
    runs.push({ kind: "vector-run", items: pendingVectors, opacity: 1 });
    pendingVectors = [];
  };
  for (const item of items) {
    if (item.kind === "text" || item.kind === "svg") {
      const entry = vectorDrawsByKey.get(item.key);
      if (entry?.visible && entry.opacity > 0 && entry.opacity < 1) {
        flushVectors();
        runs.push({ kind: "vector-run", items: [item], opacity: entry.opacity });
        continue;
      }
      pendingVectors.push(item);
      continue;
    }
    flushVectors();
    runs.push({ kind: item.kind, item });
  }
  flushVectors();
  return runs;
};

const raster = (id) => ({ key: `raster:${id}`, kind: "raster", rasterLayerId: id });
const text = (id) => ({ key: `text:${id}`, kind: "text", textNodeId: id });
const svg = (id) => ({ key: `svg:${id}`, kind: "svg", svgNodeId: id });
const image = (id) => ({ key: `image:${id}`, kind: "image", imageNodeId: id });

const items = [
  text(1),
  svg(2),
  text(3),
  svg(5),
  text(8),
  raster(4),
  svg(6),
  text(9),
  image(7),
];
const vectorDraws = [
  { key: "text:1", visible: true, opacity: 1, draws: [{}] },
  { key: "svg:2", visible: true, opacity: 1, draws: [{}] },
  { key: "text:3", visible: true, opacity: 0.42, draws: [{}, {}] },
  { key: "svg:5", visible: true, opacity: 0.31, draws: [] },
  { key: "text:8", visible: true, opacity: 1, draws: [{}] },
  { key: "svg:6", visible: false, opacity: 0.68, draws: [] },
  { key: "text:9", visible: true, opacity: 0.55, draws: [{}] },
];
const runs = layerMergeRenderRunsModel(items, vectorDraws);
assert.deepEqual(
  runs.map((run) => run.kind),
  [
    "vector-run",
    "vector-run",
    "vector-run",
    "vector-run",
    "raster",
    "vector-run",
    "vector-run",
    "image",
  ],
);
assert.deepEqual(
  runs.filter((run) => run.kind === "vector-run").map((run) => ({
    keys: run.items.map((item) => item.key),
    opacity: run.opacity,
  })),
  [
    { keys: ["text:1", "svg:2"], opacity: 1 },
    { keys: ["text:3"], opacity: 0.42 },
    { keys: ["svg:5"], opacity: 0.31 },
    { keys: ["text:8"], opacity: 1 },
    { keys: ["svg:6"], opacity: 1 },
    { keys: ["text:9"], opacity: 0.55 },
  ],
  "visible translucent nodes must isolate opaque neighbors, even with no draws",
);

const emptyBoundaryRuns = layerMergeRenderRunsModel(
  [text(10), text(11), svg(12)],
  [
    { key: "text:10", visible: true, opacity: 1, draws: [{}] },
    { key: "text:11", visible: true, opacity: 0.5, draws: [] },
    { key: "svg:12", visible: true, opacity: 1, draws: [{}] },
  ],
);
assert.deepEqual(
  emptyBoundaryRuns.map((run) => ({
    keys: run.items.map((item) => item.key),
    opacity: run.opacity,
  })),
  [
    { keys: ["text:10"], opacity: 1 },
    { keys: ["text:11"], opacity: 0.5 },
    { keys: ["svg:12"], opacity: 1 },
  ],
  "a visible empty translucent node must remain a no-op boundary between opaque runs",
);

const runtime = readFileSync(
  new URL("../src/engine-layer-merge-runtime.ts", import.meta.url),
  "utf8",
);
const core = readFileSync(new URL("../src/layer-merge-core.ts", import.meta.url), "utf8");
const controller = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);
const brushEngine = readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const gpuLab = readFileSync(
  new URL("../src/labs/gpu/layer-merge-gpu-test.ts", import.meta.url),
  "utf8",
);

assert.match(core, /export function layerMergeRenderRuns\(/);
assert.match(
  core,
  /advanced-vector-post-composite-opacity-single-atomic-v3/,
  "the strategy must advertise post-composite vector opacity",
);
assert.match(
  core,
  /readonly visible: boolean;[\s\S]*?readonly opacity: number;[\s\S]*?readonly draws: readonly VectorTextGpuDraw\[\];/,
);
assert.match(
  core,
  /entry\?\.visible && entry\.opacity > 0 && entry\.opacity < 1[\s\S]*?runs\.push\(\{ kind: "vector-run", items: \[item\], opacity: entry\.opacity \}\)/,
  "every participating translucent node must force an isolated run",
);
assert.match(
  core,
  /runs\.push\(\{ kind: "vector-run", items: pendingVectors, opacity: 1 \}\)/,
  "adjacent opaque nodes must retain the shared MSAA fast path",
);

const mergeController = controller.slice(
  controller.indexOf("  async mergeSceneItems("),
  controller.indexOf("  private async rasterizeSelectedText("),
);
assert.match(
  controller,
  /function vectorNodeWithUnitOpacity<[\s\S]*?return node\.opacity === 1 \? node : \{ \.\.\.node, opacity: 1 \};/,
  "the draw-preparation clone must force unit opacity",
);
assert.match(
  mergeController,
  /const node = item\.textNode;[\s\S]*?const drawNode = vectorNodeWithUnitOpacity\(node\);[\s\S]*?this\.appendGpuDrawsForNode\([\s\S]*?drawNode,[\s\S]*?this\.geometryForNode\(drawNode\)/,
  "text merge draws must be prepared from the unit-opacity node",
);
assert.match(
  mergeController,
  /const node = item\.svgNode;[\s\S]*?const drawNode = vectorNodeWithUnitOpacity\(node\);[\s\S]*?this\.appendGpuDrawsForSvgNode\([\s\S]*?drawNode,/,
  "SVG merge draws must be prepared from the unit-opacity node",
);
assert.match(
  mergeController,
  /vectorDraws\.push\(\{ key: item\.key, visible, opacity, draws \}\)/,
  "authored visibility and opacity must travel separately from the draw program",
);

assert.match(
  runtime,
  /for \(const run of layerMergeRenderRuns\(plan\.items, request\.vectorDraws\)\)/,
);
assert.match(
  runtime,
  /new Map\(request\.vectorDraws\.map\(\(entry\) => \[entry\.key, entry\]\)\)/,
  "the runtime must retain post-composite metadata alongside each draw program",
);
assert.match(
  runtime,
  /entry\.visible !== node\.visible[\s\S]*?Vector visibility changed while preparing merge input/,
  "merge must reject stale visibility metadata",
);
assert.match(
  runtime,
  /entry\.opacity !== node\.opacity[\s\S]*?Vector opacity changed while preparing merge input/,
  "merge must reject stale or malformed post-composite opacity",
);

const vectorRunRuntime = runtime.slice(
  runtime.indexOf("async function renderVectorRunInput("),
  runtime.indexOf("async function renderSingleRasterUnitPreservingParent("),
);
assert.match(
  vectorRunRuntime,
  /vectorSurface\.samplingView,\s*vectorSurface\.bounds,\s*1,\s*vectorSurface\.textureWidth,\s*vectorSurface\.textureHeight,\s*opacity,\s*rendered\.bounds/,
  "source scale must remain one and opacity must occupy the fold opacity slot",
);
assert.match(
  vectorRunRuntime,
  /if \(entry\.draws\.length === 0\) continue;[\s\S]*?if \(draws\.length === 0\) return null;/,
  "an empty isolated run must remain a no-op boundary without allocating a target",
);
assert.match(
  vectorRunRuntime,
  /renderVectorDrawsToTexture\([\s\S]*?foldViewIntoMergedSurface\(/,
  "the unit-opacity program must resolve before its single opacity fold",
);
assert.match(
  vectorRunRuntime,
  /allocateMergedSurface\(\s*engine,\s*engine\.layerFormat,[\s\S]*?finally \{\s*engine\.destroyMergedSurface\(vectorSurface\);/,
  "isolated vector surfaces must use the authoritative format and be released sequentially",
);
assert.match(brushEngine, /layerFormat: LayerFormat = "rgba16float";/);

assert.match(gpuLab, /setVectorTextNodeOpacity\(textNode\.id, hideVectors \? 0 : 0\.63\)/);
assert.match(gpuLab, /setVectorSvgNodeOpacity\(svgNode\.id, hideVectors \? 0 : 0\.58\)/);
assert.match(
  gpuLab,
  /exactPresentation: mergeDiff\.maxDelta <= 4/,
  "the GPU regression must compare translucent vector presentation before and after merge",
);

console.log("layer merge vector run parity verified");
