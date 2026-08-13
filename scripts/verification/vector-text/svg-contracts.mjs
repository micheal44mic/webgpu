import assert from "node:assert/strict";
import {
  VECTOR_SVG_IMPORT_STRATEGY,
  VECTOR_SVG_MAXIMUM_COMMANDS,
  VECTOR_SVG_MAXIMUM_GRADIENT_STOPS,
  VECTOR_SVG_MAXIMUM_SOURCE_BYTES,
} from "../../../src/vector-svg-import.ts";
import { readEngineSource } from "../../engine-source.mjs";
import { readRepositorySource } from "../source-contract.mjs";

const engineSource = readEngineSource();
const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const renderPlannerSource = readRepositorySource("src/mixed-scene-render-planner.ts");
const gpuShaderSource = readRepositorySource("src/vector-text-gpu-shader.ts");
const svgSource = readRepositorySource("src/vector-svg-import.ts");
const svgGradientStrokeFixture = readRepositorySource("scripts/fixtures/svg-gradient-stroke.svg");

// SVG: parser semantico sicuro, palette modificabile e gli stessi effetti mesh GPU.
assert.equal(VECTOR_SVG_IMPORT_STRATEGY, "sanitized-semantic-svg-gradients-retained-strokes-worker-lod-mesh-webgpu-v2");
assert.equal(VECTOR_SVG_MAXIMUM_SOURCE_BYTES, 5 * 1024 * 1024);
assert.equal(VECTOR_SVG_MAXIMUM_COMMANDS, 500_000);
assert.equal(VECTOR_SVG_MAXIMUM_GRADIENT_STOPS, 4);
assert.match(svgSource, /const SAFE_ELEMENTS = new Set/);
assert.match(svgSource, /"path", "rect", "circle", "ellipse", "line", "polyline", "polygon"/);
assert.match(svgSource, /Elemento SVG non supportato o non sicuro/);
assert.match(svgSource, /Handler evento SVG non consentito/);
assert.match(svgSource, /riferimenti href locali fra gradienti SVG/);
assert.match(svgSource, /hasOnlyLocalPaintUrls/);
assert.match(svgSource, /parseGradientDefinitions/);
assert.match(svgSource, /expandedStrokePath/);
assert.match(svgSource, /sourcePath: clonePath\(localPath\)/);
assert.match(svgSource, /strokePercentageReference/);
assert.match(svgSource, /normalized\.endsWith\("%"\)\) return fallback/);
assert.match(svgGradientStrokeFixture, /<linearGradient id="base-colors"/);
assert.match(svgGradientStrokeFixture, /<radialGradient id="glow"/);
assert.match(svgGradientStrokeFixture, /href="#base-colors"/);
assert.match(svgGradientStrokeFixture, /stroke-dasharray="36 14"/);
assert.match(svgGradientStrokeFixture, /<line x1="455" y1="285" x2="455" y2="285"/);
assert.match(gpuShaderSource, /gradientMeta: vec4<u32>/);
assert.match(gpuShaderSource, /fn linearGradientParameter/);
assert.match(gpuShaderSource, /fn radialGradientParameter/);
assert.match(gpuShaderSource, /fn unpackGradientStop/);
assert.match(engineSource, /unsigned\[base \+ 32\] = gradient\.kind === "linear" \? 1 : 2/);
assert.match(controllerSource, /svgGradientGpuData\(paint\.gradient\)/);
assert.doesNotMatch(svgSource, /innerHTML|insertAdjacentHTML|eval\(/);
assert.match(controllerSource, /parseVectorSvg\(source, sourceName\)/);
assert.match(controllerSource, /this\.svgFileInput\.files\?\.\[0\]/);
assert.match(controllerSource, /kind: "source-fill"/);
assert.match(controllerSource, /planMixedSceneSvgBlurDraw/);
assert.match(renderPlannerSource, /kind === "outer"[\s\S]*mode: "mesh-blur"[\s\S]*mode: "mesh-inner-shadow-blur"/);
assert.match(gpuShaderSource, /fn blurMaskVertexMain/);
assert.match(gpuShaderSource, /fn meshInnerShadowFragmentMain/);
