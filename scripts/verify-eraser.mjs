import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DESTINATION_OUT_BLEND_STATE,
  selectRasterStrokePipeline,
} from "../src/engine-raster-stroke-pipelines.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const engineTypes = read("src/engine-types.ts");
const operationSource = read("src/raster-stroke-operation.ts");
const capabilitiesSource = read("src/canvas-tool-capabilities.ts");
const pipelineSource = read("src/engine-raster-stroke-pipelines.ts");
const pipelineFactory = read("src/engine-raster-stroke-pipeline-factory.ts");
const engine = read("src/brush-engine.ts");
const historyTypes = read("src/engine-history-types.ts");
const historyRuntime = read("src/engine-history-runtime.ts");
const layerPipelines = read("src/engine-layer-recreation-runtime.ts");
const stampRuntime = read("src/engine-runtime-misc.ts");
const canvasInput = read("src/canvas-input-controller.ts");
const canvasTools = read("src/canvas-tool-controller.ts");
const quickControls = read("src/brush-quick-controls-controller.ts");
const main = read("src/main.ts");
const navigation = read("src/ui-shell/editor-navigation.html");
const toolsMenu = read("src/ui-shell/tools-menu.html");
const brushLibrary = read("src/ui-shell/brush-library-studio.html");
const effectsCss = read("src/styles/effects-and-overlays.css");
const projectCss = read("src/styles/project-home.css");

// Eraser is an operation over Paint geometry, not persisted brush/preset state.
assert.match(engineTypes, /export type BrushTool = "paint" \| "blend";/);
assert.doesNotMatch(engineTypes, /BrushTool[^;]*eraser/);
assert.match(operationSource, /export type RasterStrokeOperation = "paint" \| "erase";/);
assert.match(capabilitiesSource, /eraser:[\s\S]*?brushTool: "paint",[\s\S]*?rasterStrokeOperation: "erase"/);

assert.deepEqual(DESTINATION_OUT_BLEND_STATE, {
  color: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
});
assert.match(pipelineSource, /operation === "paint" && settings\.blendMode === "additive"/);
assert.match(pipelineSource, /eraserPipelineByPaintBase\.get\(paintBase\)/);

const pipeline = (name) => ({ name });
const normal = pipeline("normal");
const additive = pipeline("additive");
const shapeNormal = pipeline("shape-normal");
const shapeAdditive = pipeline("shape-additive");
const shapeOccupancyNormal = pipeline("shape-occupancy-normal");
const shapeOccupancyAdditive = pipeline("shape-occupancy-additive");
const grainNormal = pipeline("grain-normal");
const grainAdditive = pipeline("grain-additive");
const grainShapeNormal = pipeline("grain-shape-normal");
const grainShapeAdditive = pipeline("grain-shape-additive");
const grainShapeOccupancyNormal = pipeline("grain-shape-occupancy-normal");
const grainShapeOccupancyAdditive = pipeline("grain-shape-occupancy-additive");
const eraseNormal = pipeline("erase-normal");
const eraseShape = pipeline("erase-shape");
const eraseShapeOccupancy = pipeline("erase-shape-occupancy");
const eraseGrain = pipeline("erase-grain");
const eraseGrainShape = pipeline("erase-grain-shape");
const eraseGrainShapeOccupancy = pipeline("erase-grain-shape-occupancy");
const pipelines = {
  normalPipeline: normal,
  additivePipeline: additive,
  shapeNormalPipeline: shapeNormal,
  shapeAdditivePipeline: shapeAdditive,
  shapeOccupancyNormalPipeline: shapeOccupancyNormal,
  shapeOccupancyAdditivePipeline: shapeOccupancyAdditive,
  grainNormalPipeline: grainNormal,
  grainAdditivePipeline: grainAdditive,
  grainShapeNormalPipeline: grainShapeNormal,
  grainShapeAdditivePipeline: grainShapeAdditive,
  grainShapeOccupancyNormalPipeline: grainShapeOccupancyNormal,
  grainShapeOccupancyAdditivePipeline: grainShapeOccupancyAdditive,
  eraserPipelineByPaintBase: new Map([
    [normal, eraseNormal],
    [shapeNormal, eraseShape],
    [shapeOccupancyNormal, eraseShapeOccupancy],
    [grainNormal, eraseGrain],
    [grainShapeNormal, eraseGrainShape],
    [grainShapeOccupancyNormal, eraseGrainShapeOccupancy],
  ]),
};
assert.equal(selectRasterStrokePipeline(
  pipelines,
  { shape: "circle", blendMode: "additive" },
  { operation: "paint", grainActive: false, shapeOccupancyActive: false },
), additive);
assert.equal(selectRasterStrokePipeline(
  pipelines,
  { shape: "circle", blendMode: "additive" },
  { operation: "erase", grainActive: false, shapeOccupancyActive: false },
), eraseNormal, "Erase must ignore the authored additive Paint mode");
assert.equal(selectRasterStrokePipeline(
  pipelines,
  { shape: "shape", blendMode: "intense-blending" },
  { operation: "erase", grainActive: true, shapeOccupancyActive: true },
), eraseGrainShapeOccupancy);

assert.match(pipelineFactory, /export const RASTER_STROKE_GEOMETRY_KEYS = \[/);
assert.equal(
  (pipelineFactory.match(/^\s+"(?:circle|shape|shape-occupancy|grain-circle|grain-shape|grain-shape-occupancy)",$/gm) ?? []).length,
  6,
  "the factory must require all six raster geometries",
);
assert.match(layerPipelines, /const rasterStrokeGeometries:[\s\S]*?key: "circle"[\s\S]*?key: "grain-shape-occupancy"/);
assert.match(layerPipelines, /createRasterStrokePipelineFamilies\([\s\S]*?rasterStrokeGeometries/);
assert.match(layerPipelines, /const eraserPipelineByPaintBase = eraserPipelineMap\(rasterStrokePipelineFamilies\)/);
assert.match(
  layerPipelines,
  /const eraserSelectionVariants:[\s\S]*?rasterStrokePipelineFamilies\.values\(\)[\s\S]*?base: family\.eraser,[\s\S]*?selectionFragmentModule[\s\S]*?DESTINATION_OUT_BLEND_STATE/,
  "the same complete geometry catalog must create all selection-clipped Eraser variants",
);

assert.match(engine, /beginStroke\([\s\S]{0,180}?operation: RasterStrokeOperation = "paint"/);
assert.match(engine, /this\.activeStroke = \{[\s\S]{0,100}?tool,[\s\S]{0,60}?operation,/);
assert.match(engine, /operation === "paint"[\s\S]{0,100}?usesStrokeGlazeRenderer/);
assert.match(engine, /thicknessTailHoldback: operation === "paint"/);
assert.match(stampRuntime, /const stamp: Stamp = \{\s*operation: stroke\.operation,/);
assert.match(engine, /batch\.some\(\(stamp\) => stamp\.operation !== operation\)/);
assert.match(historyTypes, /interface PaintHistoryRenderBatch[\s\S]*?operation: RasterStrokeOperation;/);
assert.match(engine, /const historyBatch = \{\s*kind: "paint",\s*operation,/);
assert.match(engine, /replayBatch\?\.operation \?\? stamps\[0\]\?\.operation/);
assert.match(engine, /selectRasterStrokePipeline\(this, settings, \{/);
assert.match(
  historyRuntime,
  /normalizeRasterStrokeOperation\(batch\.operation\) === "paint"[\s\S]{0,100}?usesStrokeGlazeRenderer/,
);

assert.match(canvasInput, /engine\.beginStroke\(paintSample, rasterStrokeOperation\)/);
assert.match(canvasInput, /engine\.beginStroke\(hold\.initialSample, hold\.operation\)/);
assert.match(canvasTools, /const capabilities = canvasToolCapabilities\(tool\)/);
assert.match(canvasTools, /eraserButton\.setAttribute\("aria-pressed", String\(tool === "eraser"\)\)/);
assert.match(quickControls, /canvasToolCapabilities\([\s\S]*?\)\.quickControls/);
assert.match(main, /const mobileEraserButton = element<HTMLButtonElement>\("mobileEraser"\)/);
assert.match(main, /mobileEraserButton\.disabled = locked/);
assert.match(navigation, /id="mobileEraser"[\s\S]{0,180}?aria-label="Seleziona Gomma"/);
assert.doesNotMatch(
  navigation.match(/id="mobileEraser"[\s\S]{0,450}?<\/button>/)?.[0] ?? "",
  /disabled/,
);
assert.match(toolsMenu, /data-mobile-canvas-tool="eraser"[\s\S]{0,150}?aria-label="Select Eraser"/);

// The same slice removes only artifacts proven unreachable by the UI audit.
assert.doesNotMatch(brushLibrary, /spray-paint|Spray Paint|spray-can/);
assert.doesNotMatch(effectsCss, /vector-zoom-ab-summary|gaussian-blur-dialog|gaussian-blur-open-button/);
assert.doesNotMatch(projectCss, /button\.danger/);

console.log("Eraser: UI, gesture, destination-out pipelines, selection and History replay verified.");
