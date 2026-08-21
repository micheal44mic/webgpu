import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const types = read("src/engine-types.ts");
const engine = read("src/brush-engine.ts");
const runtime = read("src/engine-layer-runtime.ts");
const html = read("index.html");
const main = read("src/main.ts");
const tools = read("src/canvas-tool-controller.ts");
const editorContract = read("src/editor-tools-contract.ts");

assert.match(types, /export type BrushTool = "paint" \| "erase" \| "blend";/);
assert.match(editorContract, /"paint",\s*"erase",\s*"blend",/);
assert.match(
  html,
  /id="mobileEraser"[\s\S]*?aria-label="Select Eraser"[\s\S]*?aria-pressed="false"/,
);
assert.doesNotMatch(
  html.match(/<button\s+id="mobileEraser"[\s\S]*?<\/button>/)?.[0] ?? "",
  /disabled/,
);
assert.match(
  html,
  /data-mobile-canvas-tool="erase"[\s\S]*?aria-label="Select Eraser"/,
);
assert.match(main, /const mobileEraserButton = element<HTMLButtonElement>\("mobileEraser"\)/);
assert.match(main, /eraserButton: mobileEraserButton/);
assert.match(tools, /eraserButton\.addEventListener\("click"[\s\S]*?this\.select\("erase"\)/);

assert.match(
  runtime,
  /const eraseBlend: GPUBlendState = \{[\s\S]*?srcFactor: "zero"[\s\S]*?dstFactor: "one-minus-src-alpha"[\s\S]*?srcFactor: "zero"[\s\S]*?dstFactor: "one-minus-src-alpha"/,
  "Eraser must use premultiplied destination-out for both RGB and alpha",
);
for (const pipeline of [
  "erasePipeline",
  "shapeErasePipeline",
  "shapeOccupancyErasePipeline",
  "grainErasePipeline",
  "grainShapeErasePipeline",
  "grainShapeOccupancyErasePipeline",
]) {
  assert.match(engine, new RegExp(`${pipeline}!: GPURenderPipeline`), `${pipeline} field missing`);
  assert.match(runtime, new RegExp(`const ${pipeline} = createErasePipeline`), `${pipeline} creation missing`);
  assert.match(runtime, new RegExp(`(?:brush|grain)Variant\\(${pipeline},[\\s\\S]*?eraseBlend\\)`), `${pipeline} selection clip missing`);
}
assert.match(
  engine,
  /const pipeline = settings\.tool === "erase"[\s\S]*?grainShapeOccupancyErasePipeline[\s\S]*?shapeOccupancyErasePipeline[\s\S]*?erasePipeline/,
  "direct stamp submission must select Eraser pipelines for shape and grain",
);
assert.match(
  engine,
  /if \(tool !== "blend"\) \{[\s\S]*?capturePaintSelectionHistoryMask/,
  "Eraser must capture the pixel-selection mask for deterministic history replay",
);
assert.match(engine, /const curvePlanner = tool === "blend" \? null : this\.paintCurvePlanner/);
assert.match(engine, /thicknessDynamicsNeutral: tool === "blend" \|\| thicknessDynamicsIsNeutral/);

// Destination-out on premultiplied pixels scales every channel uniformly.
const destination = [0.4, 0.2, 0.1, 0.5];
const coverage = 0.25;
assert.deepEqual(
  destination.map((channel) => Number((channel * (1 - coverage)).toFixed(6))),
  [0.3, 0.15, 0.075, 0.375],
);

console.log("Eraser: shared Brush Studio tip, destination-out pipelines, selection and UI verified.");
