import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const generationSource = read("src/paint-stamp-generation-core.ts");
const previewSource = read("src/brush-stroke-preview-renderer.ts");
const previewShaderSource = read("src/brush-stroke-preview-shader.ts");
const engineSource = read("src/brush-engine.ts");
const runtimeSource = read("src/engine-runtime-misc.ts");
const stampUploadSource = read("src/engine-stamp-upload.ts");
const studioSource = read("src/mobile-brush-studio.ts");
const librarySource = read("src/brush-library-preview.ts");
const libraryControllerSource = read("src/brush-library-controller.ts");
const libraryCoreSource = read("src/brush-library-preview-core.ts");
const mainSource = read("src/main.ts");

const generation = await import(new URL("src/paint-stamp-generation-core.ts", root));
const { CausalStrokeCurvePlanner } = await import(
  new URL("src/stroke-curve-core.ts", root)
);
const libraryCore = await import(new URL("src/brush-library-preview-core.ts", root));

function sourceSection(source, startMarker, endMarker, label, maximumBytes = 20_000) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: marcatore iniziale assente`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: marcatore finale assente`);
  assert.ok(end > start, `${label}: marcatori invertiti`);
  assert.ok(
    end - start <= maximumBytes,
    `${label}: sezione di ${end - start} byte oltre il limite ${maximumBytes}`,
  );
  return source.slice(start, end);
}

// The extracted generator is a pure, deterministic primitive. This small
// behavioral fixture locks seed assignment, spacing carry and interpolation
// independently from both consumers.
assert.deepEqual(
  [1, 2, 3].map(generation.nextPaintStampSeed),
  [992382978, 2575243985, 2142733472],
);
const planner = new CausalStrokeCurvePlanner();
planner.reset();
const startPoint = { x: 0, y: 0, pressure: 0.5, timeMs: 0 };
const endPoint = { x: 10, y: 0, pressure: 1, timeMs: 100 };
const emitted = [];
const carry = generation.resamplePaintCurveSegment(
  planner.plan(startPoint.x, startPoint.y, endPoint.x, endPoint.y),
  startPoint,
  endPoint,
  2,
  0,
  100,
  emitted,
  (output, point, directionX, directionY) => {
    output.push({ point, directionX, directionY });
  },
);
assert.equal(carry, 0);
assert.deepEqual(
  emitted.map(({ point }) => point),
  [
    { x: 2, y: 0, pressure: 0.6, timeMs: 20 },
    { x: 4, y: 0, pressure: 0.7, timeMs: 40 },
    { x: 6, y: 0, pressure: 0.8, timeMs: 60 },
    { x: 8, y: 0, pressure: 0.9, timeMs: 80 },
    { x: 10, y: 0, pressure: 1, timeMs: 100 },
  ],
);
assert.ok(emitted.every(({ directionX, directionY }) => directionX === 1 && directionY === 0));
assert.doesNotMatch(
  generationSource,
  /BrushEngine|GPU(?:Device|Texture|Buffer|Queue)|document\.|window\.|navigator\./,
  "il core stamp condiviso deve restare puro e utilizzabile senza DOM/WebGPU",
);

// Both live Paint branches must consume the extracted resampler, while seed
// assignment must be shared by live emitStamp and the representative preview.
assert.equal(
  (engineSource.match(/resamplePaintCurveSegment\(/g) ?? []).length,
  2,
  "appendPoint e appendStabilizedMaturePoint devono usare entrambi il resampler condiviso",
);
assert.match(runtimeSource, /nextPaintStampSeed\(engine\.seedSequence\+\+\)/);
const projectedStroke = sourceSection(
  previewSource,
  "function generateProjectedPreviewStroke(",
  "export class AuthoritativeBrushStrokePreviewRenderer",
  "generatore tratto rappresentativo",
  16_000,
);
for (const requirement of [
  "nextPaintStampSeed(seedSequence++)",
  "resamplePaintCurveSegment(",
  "CausalStrokeCurvePlanner",
  "startThicknessFactor(",
  "endThicknessRadius(",
]) {
  assert.ok(projectedStroke.includes(requirement), `preview senza primitive autorevole: ${requirement}`);
}
assert.match(previewSource, /new CausalFadedStrokeStabilizer\(/);
assert.match(previewSource, /PREVIEW_MAX_PHYSICAL_COPIES = 24_576/);
assert.match(
  projectedStroke,
  /maximumBaseStampCount[\s\S]*?PREVIEW_MAX_PHYSICAL_COPIES[\s\S]*?settings\.count/,
);

// Uniform packing and the actual engine pipelines are shared as well; only the
// final linear->sRGB presentation shader is preview-specific.
for (const helper of [
  "populateBrushUniformUpload(",
  "populateGrainUniformUpload(",
  "populateStrokeGlazeUniformUpload(",
  "packStampsIntoUpload(",
]) {
  assert.ok(
    stampUploadSource.includes(`export function ${helper}`),
    `definizione helper upload condiviso assente: ${helper}`,
  );
  assert.ok(previewSource.includes(helper), `preview senza helper upload condiviso: ${helper}`);
  assert.ok(
    engineSource.includes(helper) || runtimeSource.includes(helper),
    `runtime senza helper upload condiviso: ${helper}`,
  );
}
for (const pipeline of [
  "lightNoBuildUpPipeline",
  "uniformedGlazePipeline",
  "intenseBlendingPipeline",
  "normalPipeline",
  "additivePipeline",
]) {
  assert.ok(previewSource.includes(`this.engine.${pipeline}`), `pipeline runtime non riusata: ${pipeline}`);
}
assert.match(previewShaderSource, /linearPremultipliedToEncodedSrgb/);
assert.doesNotMatch(previewShaderSource, /grain|spacing|jitter|shapeScatter|stamp/i);
assert.doesNotMatch(
  previewSource,
  /\.setBrushSettings\(|beginStrokeAtLayer\(|extendStrokeAtLayer\(|\.endStroke\(|resetDocument\(/,
  "la preview non deve mutare il documento per ottenere i pixel",
);

// Main owns one renderer instance and injects that exact instance into both
// consumers. This is the architectural guard against future Studio/Library
// forks even if either controller is reorganized.
assert.match(
  mainSource,
  /const authoritativeBrushStrokePreviewRenderer\s*=\s*\n?\s*new AuthoritativeBrushStrokePreviewRenderer\(engine\)/,
);
assert.match(
  mainSource,
  /new MobileBrushLibraryPreviewRenderer\(\s*authoritativeBrushStrokePreviewRenderer,?\s*\)/,
);
assert.match(
  mainSource,
  /new MobileBrushStudioController\(\{[\s\S]*?previewRenderer: authoritativeBrushStrokePreviewRenderer,/,
);

const studioRender = sourceSection(
  studioSource,
  "private async renderPreview(): Promise<void>",
  "private async commit(): Promise<void>",
  "render preview Brush Studio",
);
assert.match(studioRender, /await this\.options\.previewRenderer\.render\(this\.previewCanvas, settings\)/);
assert.doesNotMatch(
  studioRender,
  /getContext\(|drawImage\(|putImageData\(|globalCompositeOperation|stampCount|spacingPixels|applyPreviewGrain|renderBrushTipPreview|\.noise\(/,
  "Brush Studio non deve ricostruire stamp o grain in Canvas2D",
);
assert.match(studioSource, /this\.options\.previewRenderer\.invalidate\(this\.previewCanvas\)/);
assert.match(
  libraryControllerSource,
  /for \(const card of this\.elements\.cards\)[\s\S]*?querySelector<HTMLCanvasElement>\("\.mobile-brush-card-preview"\)[\s\S]*?this\.strokePreviewRenderer\.invalidate\(preview\)/,
  "closing the library must invalidate every built-in and dynamic card canvas",
);

assert.match(librarySource, /private readonly renderer: AuthoritativeBrushStrokePreviewRenderer/);
assert.match(librarySource, /await this\.renderer\.render\(canvas, settings, \{/);
assert.match(librarySource, /this\.renderer\.cacheIdentity/);
assert.match(previewSource, /get cacheIdentity\(\): string[\s\S]*?this\.engine\.layerFormat/);
assert.match(previewSource, /this\.engine\.shapeLoadingPromise === null/);
assert.match(previewSource, /this\.engine\.grainLoadingPromise === null/);
assert.match(previewSource, /const shapeMaskFormat = shapeMaskFormatForSettings\(settings\)/);
assert.match(previewSource, /this\.engine\.shapeDesiredFormat === shapeMaskFormat/);
assert.match(previewSource, /this\.engine\.shapeLoadedFormat === shapeMaskFormat/);
assert.match(
  previewSource,
  /createShapeMaskResources\([\s\S]*?shapeAssetId,[\s\S]*?shapeInvert,[\s\S]*?shapeMaskFormat,/,
  "la preview deve acquisire una shape con la stessa precisione del tratto autorevole",
);
assert.match(librarySource, /color: BRUSH_LIBRARY_PREVIEW_NEUTRAL_COLOR/);
assert.match(librarySource, /computePixelHash: true/);
assert.doesNotMatch(
  librarySource,
  /getContext\(|drawImage\(|putImageData\(|getImageData\(|drawFixedStroke|loadBrushStudioAsset|createImageBitmap|brushLibraryPreviewRandom/,
  "la Library deve limitarsi a cache e delega al renderer autorevole",
);
assert.doesNotMatch(librarySource, /setBrushSettings|beginStroke|endStroke|queue\.submit/);

// Cache identity covers every setting that can affect authoritative Paint.
// Artist color remains intentionally absent because cards force neutral ivory;
// Blend-only and inert ABI fields remain absent because the preview forces Paint.
const pencil = {
  tool: "paint",
  shape: "shape",
  shapeAssetId: "pencil-shape",
  shapeInvert: false,
  shapeMaskFormat: "r8unorm",
  shapeRotation: "follow-stroke",
  shapeScatter: 0.51,
  grainMode: "moving",
  grainAssetId: "pencil-grain",
  grainScale: 0.43,
  grainMovement: 0.99,
  grainDepth: 1,
  grainBrightness: 0,
  grainContrast: 0,
  grainInvert: false,
  grainFiltering: "improved",
  grainBlendMode: "multiply",
  color: "#ff5b35",
  size: 30,
  spacingPercent: 2,
  stabilization: 0,
  startThickness: 1,
  endThickness: 0.6,
  count: 1,
  flow: 1,
  opacity: 1,
  hardness: 1,
  blendIntensity: 1,
  blendMode: "intense-blending",
  blendStretch: 0.18,
  blendPaint: 0.14,
  blendBlur: 0,
  jitterMaster: 1,
  hueJitterDegrees: 0,
  saturationJitter: 0,
  lightnessJitter: 0,
  darknessJitter: 0,
  jitterPerCopy: false,
  positionJitterLateral: 0.1,
  positionJitterLinear: 0.1,
};
const fingerprint = (settings) =>
  libraryCore.brushLibraryPreviewFingerprint("m1m4-pencil-v1", settings);
const baselineFingerprint = fingerprint(pencil);
for (const [field, value] of [
  ["shape", "circle"],
  ["shapeAssetId", "legacy-shape"],
  ["shapeInvert", true],
  ["shapeMaskFormat", "r16float"],
  ["shapeRotation", "fixed"],
  ["shapeScatter", 0.2],
  ["grainMode", "texturized"],
  ["grainAssetId", "custom-grain:alternate"],
  ["grainScale", 0.8],
  ["grainMovement", 0.4],
  ["grainDepth", 0.5],
  ["grainBrightness", 0.2],
  ["grainContrast", 0.2],
  ["grainInvert", true],
  ["grainFiltering", "classic"],
  ["size", 31],
  ["spacingPercent", 3],
  ["stabilization", 0.3],
  ["startThickness", 0.8],
  ["endThickness", 0.8],
  ["count", 2],
  ["flow", 0.8],
  ["opacity", 0.8],
  ["hardness", 0.8],
  ["blendMode", "uniformed-glaze"],
  ["hueJitterDegrees", 8],
  ["saturationJitter", 0.1],
  ["lightnessJitter", 0.1],
  ["darknessJitter", 0.1],
  ["jitterPerCopy", true],
  ["positionJitterLateral", 0.2],
  ["positionJitterLinear", 0.2],
]) {
  assert.notEqual(
    fingerprint({ ...pencil, [field]: value }),
    baselineFingerprint,
    `il fingerprint non invalida il campo visivo ${field}`,
  );
}
for (const [field, value] of [
  ["color", "#00ff00"],
  ["tool", "blend"],
  ["blendIntensity", 0.2],
  ["blendStretch", 0.8],
  ["blendPaint", 0.8],
  ["blendBlur", 0.8],
  ["jitterMaster", 0.2],
]) {
  assert.equal(
    fingerprint({ ...pencil, [field]: value }),
    baselineFingerprint,
    `il campo non visivo ${field} invalida inutilmente la cache Paint neutra`,
  );
}
const depthFingerprints = [0, 0.5, 1].map((grainDepth) =>
  fingerprint({ ...pencil, grainDepth }));
assert.equal(new Set(depthFingerprints).size, 3, "Grain Depth deve produrre tre identità distinte");
const modeFingerprints = ["light-glaze", "uniformed-glaze", "intense-blending"].map(
  (blendMode) => fingerprint({ ...pencil, blendMode }),
);
assert.equal(new Set(modeFingerprints).size, 3, "i tre rendering devono invalidare separatamente");

assert.match(libraryCoreSource, /BRUSH_LIBRARY_PREVIEW_RENDERER_VERSION = "authoritative-webgpu-v1"/);
assert.doesNotMatch(libraryCoreSource, /fixed-path-canvas2d/);
assert.doesNotMatch(previewSource, /m1m4-pencil-v1|Shapepencil\.png|Grainpencil\.png/);

console.log(
  `Brush preview architectural parity passed (${baselineFingerprint}; ${emitted.length} fixture stamps).`,
);
