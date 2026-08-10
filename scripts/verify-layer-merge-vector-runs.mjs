import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layerMergeRenderRunsModel = (items) => {
  const runs = [];
  let pendingVectors = [];
  const flushVectors = () => {
    if (pendingVectors.length === 0) return;
    runs.push({ kind: "vector-run", items: pendingVectors });
    pendingVectors = [];
  };
  for (const item of items) {
    if (item.kind === "text" || item.kind === "svg") {
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

const runs = layerMergeRenderRunsModel([
  text(1),
  svg(2),
  raster(4),
  text(3),
  svg(5),
  image(7),
  text(8),
]);
assert.deepEqual(
  runs.map((run) => run.kind),
  ["vector-run", "raster", "vector-run", "image", "vector-run"],
);
assert.deepEqual(
  runs.filter((run) => run.kind === "vector-run").map((run) =>
    run.items.map((item) => item.key)),
  [["text:1", "svg:2"], ["text:3", "svg:5"], ["text:8"]],
  "only a raster/image boundary may split the MSAA vector run",
);

const runtime = readFileSync(
  new URL("../src/engine-layer-merge-runtime.ts", import.meta.url),
  "utf8",
);
const core = readFileSync(new URL("../src/layer-merge-core.ts", import.meta.url), "utf8");
assert.match(core, /export function layerMergeRenderRuns\(/);
assert.match(
  core,
  /if \(item\.kind === "text" \|\| item\.kind === "svg"\)[\s\S]*?pendingVectors\.push\(item\)[\s\S]*?flushVectors\(\)/,
);
assert.match(runtime, /for \(const run of layerMergeRenderRuns\(plan\.items\)\)/);
assert.match(
  runtime,
  /renderVectorRunInput\([\s\S]*?const draws:[\s\S]*?draws\.push\(\.\.\.itemDraws\)[\s\S]*?renderVectorDrawsToTexture\(/,
  "all visible nodes in one live vector run must share one transient MSAA resolve",
);
assert.doesNotMatch(
  runtime,
  /for \(const item of plan\.items\)[\s\S]*?renderVectorDrawsToTexture/,
  "merge must not resolve each semantic vector node independently",
);

console.log("layer merge vector run parity verified");
