import assert from "node:assert/strict";
import fs from "node:fs";
import { readEngineSource } from "./engine-source.mjs";
import {
  RASTER_PIXEL_VIEW_PERCENT_THRESHOLD,
  RASTER_PIXEL_VIEW_STRATEGY,
  RASTER_PIXEL_VIEW_ZOOM_THRESHOLD,
  RASTER_SMOOTH_LAYER_COMPOSITE_STRATEGY,
  rasterPixelViewEnabled,
} from "../src/raster-pixel-view.ts";

const read = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const engineSource = readEngineSource();
const mainSource = read("src/main.ts");
const shaderSource = read("src/shaders.ts");
const strokeRendererSource = read("src/stroke-renderer.ts");
const mergedSurfaceSource = read("src/merged-surface-shader.ts");
const mixedSceneCompositorSource = read("src/mixed-scene-compositor-shader.ts");
const vectorTextShaderSource = read("src/vector-text-shader.ts");
const pixelViewSource = read("src/raster-pixel-view.ts");
const htmlSource = read("index.html");
const styleSource = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const EPSILON = 1e-9;

function normalizeAngle(angle) {
  const turn = Math.PI * 2;
  let normalized = (angle + Math.PI) % turn;
  if (normalized < 0) {
    normalized += turn;
  }
  return normalized - Math.PI;
}

function layerToCanvas(point, view) {
  const deltaX = point.x - view.centerX;
  const deltaY = point.y - view.centerY;
  const cosine = Math.cos(view.rotation);
  const sine = Math.sin(view.rotation);
  return {
    x: view.width * 0.5 + (cosine * deltaX - sine * deltaY) * view.zoom,
    y: view.height * 0.5 + (sine * deltaX + cosine * deltaY) * view.zoom,
  };
}

function canvasToLayer(point, view) {
  const scaledX = (point.x - view.width * 0.5) / view.zoom;
  const scaledY = (point.y - view.height * 0.5) / view.zoom;
  const cosine = Math.cos(view.rotation);
  const sine = Math.sin(view.rotation);
  return {
    x: view.centerX + cosine * scaledX + sine * scaledY,
    y: view.centerY - sine * scaledX + cosine * scaledY,
  };
}

const views = [
  { width: 1280, height: 720, centerX: 2048, centerY: 2048, zoom: 0.4, rotation: 0 },
  { width: 1179, height: 2556, centerX: 1890.25, centerY: 2250.75, zoom: 0.73, rotation: 0.47 },
  { width: 2048, height: 1536, centerX: -120, centerY: 4980, zoom: 3.2, rotation: -2.14 },
];
const layerPoints = [
  { x: 0, y: 0 },
  { x: 2048.5, y: 2048.5 },
  { x: 4095, y: 31.25 },
  { x: -240.75, y: 4800.125 },
];

for (const view of views) {
  for (const point of layerPoints) {
    const roundTrip = canvasToLayer(layerToCanvas(point, view), view);
    assert.ok(Math.abs(roundTrip.x - point.x) < EPSILON, "round-trip X non stabile");
    assert.ok(Math.abs(roundTrip.y - point.y) < EPSILON, "round-trip Y non stabile");
  }
}

const zeroView = views[0];
const canvasPoint = { x: 913.25, y: 181.75 };
const oldMapping = {
  x: zeroView.centerX + (canvasPoint.x - zeroView.width * 0.5) / zeroView.zoom,
  y: zeroView.centerY + (canvasPoint.y - zeroView.height * 0.5) / zeroView.zoom,
};
assert.deepEqual(canvasToLayer(canvasPoint, zeroView), oldMapping,
  "la trasformazione a 0° deve coincidere esattamente con la formula precedente");

const originalView = {
  width: 1000,
  height: 700,
  centerX: 1600,
  centerY: 2300,
  zoom: 0.82,
  rotation: -0.38,
};
const anchorCanvas = { x: 741, y: 219 };
const anchorLayer = canvasToLayer(anchorCanvas, originalView);
const rotatedView = { ...originalView, rotation: 0.91 };
const rotatedOffset = canvasToLayer(anchorCanvas, { ...rotatedView, centerX: 0, centerY: 0 });
rotatedView.centerX = anchorLayer.x - rotatedOffset.x;
rotatedView.centerY = anchorLayer.y - rotatedOffset.y;
const preservedAnchor = canvasToLayer(anchorCanvas, rotatedView);
assert.ok(Math.abs(preservedAnchor.x - anchorLayer.x) < EPSILON, "ancora X spostata dalla rotazione");
assert.ok(Math.abs(preservedAnchor.y - anchorLayer.y) < EPSILON, "ancora Y spostata dalla rotazione");

function applyMagnet(state, deltaDegrees) {
  const enter = 3 * Math.PI / 180;
  const release = 7 * Math.PI / 180;
  state.raw = normalizeAngle(state.raw + deltaDegrees * Math.PI / 180);
  const distance = Math.abs(state.raw);
  if (state.snapped && distance > release) {
    state.snapped = false;
  } else if (!state.snapped && distance <= enter) {
    state.snapped = true;
  }
  state.display = state.snapped ? 0 : state.raw;
}

const magnet = { raw: 0, display: 0, snapped: true };
applyMagnet(magnet, 2);
assert.equal(magnet.display, 0, "2° deve restare agganciato a zero");
applyMagnet(magnet, 4);
assert.equal(magnet.display, 0, "l'isteresi deve trattenere lo zero fino alla soglia di rilascio");
applyMagnet(magnet, 2);
assert.ok(Math.abs(magnet.display - 8 * Math.PI / 180) < EPSILON,
  "oltre 7° il magnete deve rilasciare la rotazione continua");
applyMagnet(magnet, -4);
assert.notEqual(magnet.display, 0, "il magnete non deve riagganciare fuori dalla soglia di ingresso");
applyMagnet(magnet, -2);
assert.equal(magnet.display, 0, "entro 3° il magnete deve tornare a zero esatto");

assert.match(engineSource, /const DISPLAY_UNIFORM_BYTES = 96;/,
  "rotazione, origin merged e gruppo di ritaglio condividono la ABI display da 96 byte");
assert.match(engineSource, /displayUniformUpload\[2\] = this\.viewRotationCos/);
assert.match(engineSource, /displayUniformUpload\[3\] = this\.viewRotationSin/);
assert.match(engineSource, /displayUniformUpload\[4\] = this\.viewCenterX/);
assert.match(engineSource, /displayUniformUpload\[5\] = this\.viewCenterY/);
assert.match(engineSource, /VIEW_ROTATION_SNAP_ENTER_RADIANS = 3 \* Math\.PI \/ 180/);
assert.match(engineSource, /VIEW_ROTATION_SNAP_RELEASE_RADIANS = 7 \* Math\.PI \/ 180/);

// L'API di rotazione vive nella classe, l'applicazione dell'angolo in
// `engine-runtime-misc`: la sezione deve coprirle entrambe.
const rotationApi = engineSource.slice(
  engineSource.indexOf("  beginViewRotationGesture(): void"),
  engineSource.indexOf("  beginStroke(sample: PointerSample): void"),
);
const applyRotationStart = engineSource.indexOf("export function applyViewRotation(");
const rotationMethods = rotationApi
  + engineSource.slice(applyRotationStart, applyRotationStart + 3_000);
assert.ok(rotationMethods.length > 0, "API di rotazione vista non trovata");
assert.doesNotMatch(rotationMethods, /createTexture|createBuffer/,
  "la rotazione non deve allocare texture o buffer");
assert.match(rotationMethods, /presentationCacheNeedsFullRebuild = true/,
  "ogni cambio angolo deve invalidare la cache screen-space");
assert.match(rotationMethods, /anchorBefore = clientToLayer\(engine,/,
  "la rotazione deve conservare il punto sotto il gesto");

const dirtyRectTransform = engineSource.slice(
  engineSource.indexOf("export function layerDirtyRectToPresentationRect("),
  engineSource.indexOf("export function encodeMergedSurfacePyramid("),
);
assert.equal((dirtyRectTransform.match(/layerToCanvasPixels\(engine,/g) ?? []).length, 4,
  "lo scissor ruotato deve includere tutti e quattro gli angoli");
// Ancorate alla dichiarazione: una riga di import soddisfarebbe il solo nome.
assert.match(engineSource, /export function canvasOffsetToLayerOffset\(engine: BrushEngine/);
assert.match(engineSource, /export function layerOffsetToCanvasOffset\(engine: BrushEngine/);
assert.match(engineSource, /rotation: rotation \+ this\.viewRotation/,
  "la tip preview Shape deve ruotare insieme alla vista");

const displayShaders = `${shaderSource}\n${strokeRendererSource}`;
assert.equal((displayShaders.match(/struct DisplayUniforms/g) ?? []).length, 6,
  "le quattro varianti display e i due compositori mip devono condividere l'ABI");
assert.equal((displayShaders.match(/  mergedBelowOrigin: vec2<f32>,/g) ?? []).length, 6,
  "display e compositori mip devono ricevere l'origine del bbox inferiore");
assert.equal((displayShaders.match(/  mergedAboveOrigin: vec2<f32>,/g) ?? []).length, 6,
  "display e compositori mip devono ricevere l'origine del bbox superiore");
assert.equal((displayShaders.match(/  viewRotation: vec2<f32>,/g) ?? []).length, 6,
  "display e compositori mip devono condividere la stessa ABI di rotazione");
assert.equal((displayShaders.match(/let displayOffset =/g) ?? []).length, 9,
  "entry point canonico, final-stack e active-only devono applicare la stessa trasformazione inversa");
assert.equal((displayShaders.match(/fn activeFragmentMain\(/g) ?? []).length, 4,
  "ogni variante display deve offrire la sorgente trasparente al compositore segmentato");
assert.doesNotMatch(displayShaders, /display\.layerSize/,
  "la dimensione layer deve essere ricavata senza allargare l'uniform");
assert.ok((displayShaders.match(/textureDimensions\(activeLayerBase, 0\)/g) ?? []).length >= 2);
assert.match(displayShaders, /textureDimensions\(layerTexture, 0\)/);
assert.match(displayShaders, /let layerSize = vec2<f32>\(DOCUMENT_SIZE\)/);

assert.match(mainSource, /angle: Math\.atan2\(second\.clientY - first\.clientY/,
  "il gesto mobile deve misurare l'angolo delle due dita");
assert.match(mainSource, /engine\.rotateViewBy\(rotationDelta, nextGesture\.centerX, nextGesture\.centerY\)/);
assert.match(mainSource, /engine\.beginViewRotationGesture\(\)/);
assert.match(mainSource, /engine\.endViewRotationGesture\(\)/);
assert.match(mainSource, /rotateShortcutHeld/);
assert.match(mainSource, /deltaRadians = \(event\.clientX - lastRotateClientX\) \* Math\.PI \/ 720/);
assert.equal((mainSource.match(/performanceTelemetryRevision: 62/g) ?? []).length, 2);
assert.match(mainSource, /viewRotationDegrees: Number\(engine\.getViewRotationDegrees\(\)\.toFixed\(3\)\)/,
  "ogni benchmark deve firmare l'angolo della vista");
assert.equal((mainSource.match(/two-finger-pan-pinch-rotate-zero-magnet/g) ?? []).length, 2);

for (const id of ["rotateViewLeft", "viewRotation", "rotateViewRight"]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `controllo desktop #${id} mancante`);
}
assert.match(htmlSource, /due dita spostano, fanno zoom e ruotano/);
assert.match(styleSource, /#gpuCanvas\.rotating/);
assert.match(styleSource, /\.desktop-rotation-control\s*\{\s*display: none;/s,
  "i controlli desktop non devono affollare la barra mobile");
assert.equal(RASTER_PIXEL_VIEW_PERCENT_THRESHOLD, 581);
assert.equal(RASTER_PIXEL_VIEW_ZOOM_THRESHOLD, 5.81);
assert.equal(RASTER_PIXEL_VIEW_STRATEGY, "display-only-nearest-raster-at-581-percent-v1");
assert.equal(
  RASTER_SMOOTH_LAYER_COMPOSITE_STRATEGY,
  "lod0-edge-plus-final-stack-mips-compose-before-filter-v3",
);
assert.equal(rasterPixelViewEnabled(5.809999), false,
  "sotto il 581% il raster deve restare nella vista morbida fedele");
assert.equal(rasterPixelViewEnabled(5.81), true,
  "al 581% esatto deve iniziare la vista pixel raster");
assert.equal(rasterPixelViewEnabled(5.55), false,
  "il 555% deve conservare il comportamento morbido richiesto dall'utente");
assert.equal(rasterPixelViewEnabled(6.45), true,
  "il 645% deve mostrare i texel nearest come prima");
assert.equal(rasterPixelViewEnabled(Number.NaN), false);
assert.match(pixelViewSource, /display\.zoom >= RASTER_PIXEL_VIEW_ZOOM_THRESHOLD/);
assert.match(pixelViewSource, /resolutionScale <= 1\.0001/,
  "le catture vettoriali supersampled non devono essere pixelate");
assert.match(pixelViewSource, /vec2<i32>\(floor\(uv \* vec2<f32>\(dimensions\)\)\)/,
  "nearest deve selezionare un texel reale senza interpolazione");
assert.doesNotMatch(htmlSource, /id="viewZoomPercent"/);
assert.doesNotMatch(styleSource, /\.view-zoom-percent/);
assert.doesNotMatch(mainSource, /updateViewZoomControl|viewZoomPercentOutput/);

assert.equal((mergedSurfaceSource.match(/rasterPixelViewEnabled\(resolutionScale\)/g) ?? []).length, 2,
  "entrambe le superfici raster unite devono usare nearest sopra soglia");
assert.match(mixedSceneCompositorSource, /ordered-raster-vector-gpu-runs-rgba16f-viewport-source-over-raster-nearest-at-581pct-v4/);
const mixedRasterSegment = mixedSceneCompositorSource.slice(
  mixedSceneCompositorSource.indexOf("export const mixedSceneRasterSegmentShader"),
  mixedSceneCompositorSource.indexOf("export const mixedSceneTextSegmentShader"),
);
const mixedTextSegment = mixedSceneCompositorSource.slice(
  mixedSceneCompositorSource.indexOf("export const mixedSceneTextSegmentShader"),
  mixedSceneCompositorSource.indexOf("export const mixedSceneClearShader"),
);
assert.match(mixedRasterSegment, /rasterPixelViewEnabled\(resolutionScale\)/,
  "le run raster del compositore misto devono mostrare texel reali");
assert.doesNotMatch(mixedTextSegment, /rasterPixelViewEnabled/,
  "le run testo/SVG devono restare vettoriali");
assert.match(vectorTextShaderSource, /sampleViewportTexture[\s\S]*textureLoad\(source, pixel, 0\)/,
  "le superfici vettoriali screen-space devono restare analitiche e nitide");
assert.ok((shaderSource.match(/rasterPixelViewEnabled\(1\.0\)/g) ?? []).length >= 5,
  "base, tail e glaze devono condividere la vista pixel raster");
assert.equal((strokeRendererSource.match(/directStyledNearestSample\(layerPosition\)/g) ?? []).length, 2,
  "effetti raster e active-only devono usare lo stesso nearest");
assert.match(strokeRendererSource, /display-nearest-raster-at-581pct/);
assert.doesNotMatch(pixelViewSource, /createTexture|createBuffer|writeTexture|copyTexture/,
  "la modalità pixel deve essere solo display e non allocare o mutare risorse");

// A coincident yellow fill over a black Reference must be composed at each
// document texel before the smooth-view interpolation. Filtering the two alpha
// edges independently produces the exact dark fringe observed in the capture.
const displayShaderStart = shaderSource.indexOf("export const displayShader");
const displayShaderEnd = shaderSource.indexOf(
  "export const thicknessTailDisplayShader",
  displayShaderStart,
);
assert.ok(displayShaderStart >= 0 && displayShaderEnd > displayShaderStart);
const baseDisplayShader = shaderSource.slice(displayShaderStart, displayShaderEnd);
assert.match(
  baseDisplayShader,
  /if \(jointFilteringCandidate\) \{[\s\S]*belowPaint = sampleMergedBelow\(layerPosition\)[\s\S]*abovePaint = sampleMergedAbove\(layerPosition\)[\s\S]*stackAlphaGradient = fwidth/,
  "active, below e above devono essere campionati nel candidato uniforme prima delle derivate",
);
assert.match(baseDisplayShader, /fn sampleCompositedLayerStackLinear\(/);
assert.match(
  baseDisplayShader,
  /compositedLayerStackTexel\(lower\)[\s\S]*compositedLayerStackTexel\(lower \+ vec2<i32>\(1, 1\)\)[\s\S]*return mix\(/,
  "i quattro texel devono essere composti prima della bilineare finale",
);
assert.match(
  baseDisplayShader,
  /let lodZeroSmooth = display\.selectedMipLevel < 0\.5\s*&& !rasterPixelViewEnabled\(1\.0\);/,
  "la correzione LOD 0 deve coprire anche lo zoom sotto il 100% prima del primo mip",
);
assert.match(
  baseDisplayShader,
  /stackAlphaGradient = fwidth\(activePaint\.a\)\s*\+ fwidth\(belowPaint\.a\)\s*\+ fwidth\(abovePaint\.a\);/,
  "il gradiente alpha deve includere active, below e above",
);
assert.match(
  baseDisplayShader,
  /multipleSurfaces[\s\S]*stackAlphaGradient > 0\.00001/,
  "il percorso costoso richiede più superfici e un gradiente alpha",
);
const stackAlphaDerivativeIndex = baseDisplayShader.indexOf(
  "stackAlphaGradient = fwidth(activePaint.a)",
);
const nonUniformInsideLayerIndex = baseDisplayShader.indexOf(
  "let insideLayer = all(layerPosition >= vec2<f32>(0.0))",
);
assert.ok(
  stackAlphaDerivativeIndex >= 0
    && nonUniformInsideLayerIndex > stackAlphaDerivativeIndex,
  "tutti i fwidth devono precedere il ramo insideLayer non uniforme",
);
const deferredFastSamplingIndex = baseDisplayShader.indexOf(
  "if (!jointFilteringCandidate)",
);
assert.ok(
  deferredFastSamplingIndex > nonUniformInsideLayerIndex,
  "fuori dal candidato edge-only i sample devono restare dopo il reject del documento",
);
assert.match(
  baseDisplayShader,
  /var paint = composeLayerStackSamples[\s\S]*if \(needsJointLayerFiltering\(stackAlphaGradient\)\)[\s\S]*paint = sampleCompositedLayerStackLinear\(layerPosition\)/,
  "interni e trasparenti devono conservare il percorso veloce esistente",
);
assert.doesNotMatch(
  baseDisplayShader,
  /select\([\s\S]{0,200}sampleCompositedLayerStackLinear/,
  "WGSL select valuterebbe anche il ramo costoso su ogni pixel",
);

const stackMipShaderStart = shaderSource.indexOf("export const paintStackCompositeMipShader");
assert.ok(stackMipShaderStart >= 0, "shader final-stack mip 1 mancante");
const stackMipShader = shaderSource.slice(stackMipShaderStart);
assert.match(
  stackMipShader,
  /fn compositedDocumentTexel[\s\S]*loadMergedBelow\(pixel\)[\s\S]*composeActiveClippingGroupTexel\([\s\S]*textureLoad\(activeLayerBase, pixel, 0\)[\s\S]*loadMergedAbove\(pixel\)/,
  "mip 1 deve comporre below, gruppo active e above per ogni texel documento",
);
assert.match(
  stackMipShader,
  /let p00 = compositedDocumentTexel\(sourceOrigin\)[\s\S]*let p11 = compositedDocumentTexel\(sourceOrigin \+ vec2<i32>\(1, 1\)\)[\s\S]*return \(p00 \+ p10 \+ p01 \+ p11\) \* 0\.25/,
  "mip 1 deve mediare quattro risultati finali premoltiplicati",
);
assert.match(baseDisplayShader, /fn finalStackFragmentMain\(/);
assert.match(
  baseDisplayShader,
  /fn finalStackFragmentMain[\s\S]*textureSampleLevel\([\s\S]*activeLayerPyramid[\s\S]*max\(display\.selectedMipLevel - 1\.0, 0\.0\)/,
  "il display final-stack deve campionare la piramide già composta senza un secondo source-over",
);
assert.match(
  engineSource,
  /content === "final-raster-stack" && mipLevel === 1[\s\S]*setPipeline\(this\.paintStackCompositeMipPipeline\)[\s\S]*mipLevel - 1/,
  "solo mip 1 usa il compositore; i livelli successivi riusano il downsample 2x2",
);
assert.match(
  engineSource,
  /if \(!useFinalRasterStackMip && !tileBlendOwnsPyramid\) \{\s*encodeMergedDisplayPyramids/,
  "il path final-stack non deve costruire mip merged che non campiona",
);

const srgbToLinear = (value) => {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};
const linearToSrgbByte = (value) => Math.round(255 * (
  value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.max(0, Math.min(1, value)) ** (1 / 2.4) - 0.055
));
const mixColor = (outside, inside, coverage) => outside.map(
  (value, index) => value * (1 - coverage) + inside[index] * coverage,
);
const sourceOver = (source, destination) => source.map(
  (value, index) => value + destination[index] * (1 - source[3]),
);
const yellow = [srgbToLinear(238), 1, 0, 1];
const black = [0, 0, 0, 1];
const white = [1, 1, 1, 1];
const transparent = [0, 0, 0, 0];
const half = 0.5;
const independentlyFiltered = sourceOver(
  mixColor(transparent, yellow, half),
  mixColor(white, black, half),
);
const jointlyFiltered = mixColor(
  sourceOver(transparent, white),
  sourceOver(yellow, black),
  half,
);
const oldFringeRgb = independentlyFiltered.slice(0, 3).map(linearToSrgbByte);
const correctedRgb = jointlyFiltered.slice(0, 3).map(linearToSrgbByte);
assert.deepEqual(oldFringeRgb, [215, 225, 137]);
assert.deepEqual(correctedRgb, [247, 255, 188]);
assert(correctedRgb[0] > oldFringeRgb[0] && correctedRgb[1] === 255,
  "la transizione corretta non deve scendere sotto entrambi i colori finali");

assert.equal(packageJson.scripts["view:verify"], "node scripts/verify-view-rotation.mjs");

console.log(
  "Vista verificata: soglia 581% invariata e active/below/above composti per texel prima della bilineare.",
);
