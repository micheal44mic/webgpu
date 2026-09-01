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
import { planPaintDisplayMips } from "../src/noise-mip-smoothing-core.ts";

const read = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const engineSource = readEngineSource();
const appDiagnosticsControllerSource = read("src/app-diagnostics-controller.ts");
const engineTypesSource = read("src/engine-types.ts");
const mainSource = read("src/main.ts");
const canvasInputSource = read("src/canvas-input-controller.ts");
const humanLabSource = read("src/labs/human-stroke-lab.ts");
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

const inactiveRasterMip = (zoom, maximumMip = 12) => Math.min(
  maximumMip,
  Math.max(0, Math.floor(Math.log2(1 / Math.max(zoom, 1e-6)) + 1e-6)),
);

for (const zoom of [1, 0.6, 0.5, 0.25]) {
  assert.equal(
    inactiveRasterMip(zoom),
    planPaintDisplayMips(zoom, 13, false).legacyMipLevel,
    `active and inactive raster mip policy diverged at zoom ${zoom}`,
  );
}
assert.equal(
  Math.round(Math.log2(1 / 0.6)),
  1,
  "the regression fixture must distinguish the former nearest-mip rounding",
);
assert.equal(inactiveRasterMip(0.6), 0);

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

assert.match(engineSource, /const DISPLAY_UNIFORM_BYTES = 128;/,
  "rotazione, composizione e dimensioni runtime condividono la ABI display da 128 byte");
assert.match(engineSource, /displayUniformUpload\[2\] = this\.viewRotationCos/);
assert.match(engineSource, /displayUniformUpload\[3\] = this\.viewRotationSin/);
assert.match(engineSource, /displayUniformUpload\[4\] = this\.viewCenterX/);
assert.match(engineSource, /displayUniformUpload\[5\] = this\.viewCenterY/);
assert.match(engineSource, /displayUniformUpload\[24\] = backgroundRed/);
assert.match(engineSource, /displayUniformUpload\[27\] = this\.documentBackground\.visible \? 1 : 0/);
assert.match(engineSource, /displayUniformUpload\[28\] = this\.documentWidth/);
assert.match(engineSource, /displayUniformUpload\[29\] = this\.documentHeight/);
assert.match(shaderSource, /display\.backgroundColor\.rgb/);
assert.match(mixedSceneCompositorSource, /backgroundFragmentMain/);
assert.match(mixedSceneCompositorSource, /documentSize: vec2<f32>/);
assert.match(mixedSceneCompositorSource, /layerPosition < display\.documentSize/);
assert.doesNotMatch(mixedSceneCompositorSource, /\$\{DOCUMENT_(?:WIDTH|HEIGHT)\}/);
assert.match(engineSource, /VIEW_ROTATION_SNAP_ENTER_RADIANS = 3 \* Math\.PI \/ 180/);
assert.match(engineSource, /VIEW_ROTATION_SNAP_RELEASE_RADIANS = 7 \* Math\.PI \/ 180/);

// L'API di rotazione vive nella classe, l'applicazione dell'angolo in
// `engine-runtime-misc`: la sezione deve coprirle entrambe.
const rotationApi = engineSource.slice(
  engineSource.indexOf("  beginViewRotationGesture(): void"),
  engineSource.indexOf("  beginStroke(sample: PointerSample): boolean"),
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
const singleRasterDisplayStart = shaderSource.indexOf(
  "export const singleRasterRgba16FloatDisplayShader",
);
const singleRasterDisplayEnd = shaderSource.indexOf(
  "export const displayShader",
  singleRasterDisplayStart,
);
assert.ok(
  singleRasterDisplayStart >= 0 && singleRasterDisplayEnd > singleRasterDisplayStart,
  "la presentazione specializzata del singolo raster deve restare isolabile",
);
const singleRasterDisplay = shaderSource.slice(
  singleRasterDisplayStart,
  singleRasterDisplayEnd,
);
assert.equal(
  (singleRasterDisplay.match(/@group\(0\) @binding\(/g) ?? []).length,
  4,
  "il percorso singolo deve dichiarare solo uniforms, mip 0, piramide e sampler",
);
for (const binding of [0, 1, 2, 5]) {
  assert.match(singleRasterDisplay, new RegExp(`@group\\(0\\) @binding\\(${binding}\\)`));
}
for (const binding of [3, 4, 6, 7]) {
  assert.doesNotMatch(
    singleRasterDisplay,
    new RegExp(`@group\\(0\\) @binding\\(${binding}\\)`),
    `il binding composito ${binding} non deve entrare nello shader specializzato`,
  );
}
assert.equal((singleRasterDisplay.match(/@vertex\s*fn vertexMain\(/g) ?? []).length, 1);
assert.equal((singleRasterDisplay.match(/@fragment\s*fn fragmentMain\(/g) ?? []).length, 1);
assert.match(
  singleRasterDisplay,
  /@binding\(1\) var rasterMipZero: texture_2d<f32>/,
  "mip 0 deve restare una sorgente lineare RGBA16F campionabile",
);
assert.match(
  singleRasterDisplay,
  /@binding\(2\) var rasterMipPyramid: texture_2d<f32>/,
  "la piramide deve restare una sorgente lineare RGBA16F campionabile",
);
assert.match(
  singleRasterDisplay,
  /sampleSingleRasterMipZero[\s\S]*textureLoad\([\s\S]*textureSampleLevel\(rasterMipZero/,
  "mip 0 deve conservare sia la vista pixel sia il filtraggio continuo",
);
assert.match(
  singleRasterDisplay,
  /logicalMip - 1\.0[\s\S]*let lowerMip = floor\(lod\)[\s\S]*let upperMip = ceil\(lod\)[\s\S]*return mix\(/,
  "mip 0 separato e piramide devono condividere la transizione LOD frazionaria",
);
assert.match(
  singleRasterDisplay,
  /display\.viewRotation\.x \* singleRasterDisplayOffset\.x[\s\S]*display\.viewCenter \+ rasterOffset/,
  "la variante minima deve conservare rotazione, centro e zoom del canvas",
);
assert.match(singleRasterDisplay, /sampleSingleRaster\(uv\) \* display\.rasterAlpha/);
assert.match(singleRasterDisplay, /checkerParity[\s\S]*display\.backgroundColor\.rgb/);
assert.match(
  singleRasterDisplay,
  /singleRasterSrgbToLinear\(backgroundSrgb\)[\s\S]*singleRasterLinearToSrgb\(compositedLinear\)/,
  "sfondo e raster premoltiplicato devono essere composti in lineare e presentati in sRGB",
);
assert.match(
  singleRasterDisplay,
  /@location\(0\) vec4<f32>/,
  "il formato canvas resta responsabilità del target della render pipeline",
);
assert.doesNotMatch(
  singleRasterDisplay,
  /activeClipping|composeActiveClipping|mergedBelow|mergedAbove|mergedSurface|sourceOver/,
  "lo shader specializzato non deve includere il grafo di clipping o superfici unite",
);
assert.match(
  engineSource,
  /singleRasterRgba16FloatDisplayShader/,
  "la presentazione raster minima deve essere collegata al runtime iniziale",
);
assert.match(
  engineSource,
  /Single raster RGBA16F display pipeline/,
  "la pipeline iniziale deve dichiarare esplicitamente il percorso raster RGBA16F minimo",
);
assert.equal((displayShaders.match(/struct DisplayUniforms/g) ?? []).length, 6,
  "le quattro varianti display e i due compositori mip devono condividere l'ABI");
assert.equal((displayShaders.match(/  mergedBelowOrigin: vec2<f32>,/g) ?? []).length, 6,
  "display e compositori mip devono ricevere l'origine del bbox inferiore");
assert.equal((displayShaders.match(/  mergedAboveOrigin: vec2<f32>,/g) ?? []).length, 6,
  "display e compositori mip devono ricevere l'origine del bbox superiore");
assert.equal((displayShaders.match(/  viewRotation: vec2<f32>,/g) ?? []).length, 7,
  "display, compositori mip e presentazione raster minima devono condividere la stessa ABI di rotazione");
assert.equal((displayShaders.match(/let displayOffset =/g) ?? []).length, 16,
  "entry point canonico, final-stack, source-only e raw-matte devono applicare la stessa trasformazione inversa");
assert.equal((displayShaders.match(/fn activeFragmentMain\(/g) ?? []).length, 4,
  "ogni variante display deve offrire la sorgente trasparente al compositore segmentato");
assert.equal((displayShaders.match(/fn activeSourceFragmentMain\(/g) ?? []).length, 4,
  "ogni variante display deve offrire una sorgente isolata per il fold avanzato");
assert.equal((displayShaders.match(/fn activeCutoutFragmentMain\(/g) ?? []).length, 2,
  "base e Stroke live devono offrire la matte autoriale non filtrata");
assert.doesNotMatch(displayShaders, /display\.layerSize/,
  "la dimensione layer deve essere ricavata senza allargare l'uniform");
assert.ok((displayShaders.match(/textureDimensions\(activeLayerBase, 0\)/g) ?? []).length >= 2);
assert.match(displayShaders, /textureDimensions\(layerTexture, 0\)/);
assert.match(displayShaders, /let layerSize = vec2<f32>\(documentSize\(\)\)/);

assert.match(canvasInputSource, /angle: Math\.atan2\(second\.clientY - first\.clientY/,
  "il gesto mobile deve misurare l'angolo delle due dita");
assert.match(canvasInputSource, /engine\.rotateViewBy\(rotationDelta, nextGesture\.centerX, nextGesture\.centerY\)/);
assert.match(canvasInputSource, /engine\.beginViewRotationGesture\(\)/);
assert.match(canvasInputSource, /engine\.endViewRotationGesture\(\)/);
assert.match(canvasInputSource, /rotateShortcutHeld/);
assert.match(canvasInputSource, /deltaRadians = \(event\.clientX - lastRotateClientX\) \* Math\.PI \/ 720/);
assert.match(humanLabSource, /HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 67/);
assert.match(mainSource, /viewRotationDegrees: Number\(engine\.getViewRotationDegrees\(\)\.toFixed\(3\)\)/,
  "ogni benchmark deve firmare l'angolo della vista");
assert.ok((canvasInputSource.match(/two-finger-pan-pinch-rotate-zero-magnet/g) ?? []).length >= 1);

for (const id of ["rotateViewLeft", "viewRotation", "rotateViewRight"]) {
  assert.doesNotMatch(
    htmlSource,
    new RegExp(`id="${id}"`),
    `il controllo desktop legacy #${id} non deve duplicare i gesti autorevoli`,
  );
}
assert.match(styleSource, /#gpuCanvas\.rotating/);
assert.doesNotMatch(styleSource, /desktop-rotation-control|#viewRotation/,
  "gli stili della rotazione desktop rimossa non devono restare orfani");
assert.equal(RASTER_PIXEL_VIEW_PERCENT_THRESHOLD, 581);
assert.equal(RASTER_PIXEL_VIEW_ZOOM_THRESHOLD, 5.81);
assert.equal(RASTER_PIXEL_VIEW_STRATEGY, "display-only-nearest-raster-at-581-percent-v1");
assert.equal(
  RASTER_SMOOTH_LAYER_COMPOSITE_STRATEGY,
  "lod0-edge-plus-live-glaze-final-stack-mips-compose-before-filter-v4",
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
assert.match(
  mixedSceneCompositorSource,
  /ordered-raster-vector-gpu-runs-rgba16f-roi-source-over-post-opacity-raster-floor-mip-parity-v7/,
);
const mixedRasterSegment = mixedSceneCompositorSource.slice(
  mixedSceneCompositorSource.indexOf("export const mixedSceneRasterSegmentShader"),
  mixedSceneCompositorSource.indexOf("export const mixedSceneTextSegmentShader"),
);
const mixedTextSegment = mixedSceneCompositorSource.slice(
  mixedSceneCompositorSource.indexOf("export const mixedSceneTextSegmentShader"),
  mixedSceneCompositorSource.indexOf("export const mixedSceneClearShader"),
);
assert.match(mixedRasterSegment, /rasterPixelViewEnabled\(effectiveResolutionScale\)/,
  "le run raster del compositore misto devono mostrare texel reali");
assert.match(
  mixedRasterSegment,
  /let continuousLod = clamp\([\s\S]*?let lod = floor\(continuousLod \+ 0\.000001\)/,
  "le run raster attive e inattive devono scegliere lo stesso livello mip intero",
);
assert.match(
  mergedSurfaceSource,
  /fn mergedSamplingLod[\s\S]*?return floor\(continuousLod \+ 0\.000001\)/,
  "le superfici raster unite devono usare la stessa soglia mip del livello attivo",
);
assert.doesNotMatch(mixedTextSegment, /rasterPixelViewEnabled/,
  "le run testo/SVG devono restare vettoriali");
assert.match(vectorTextShaderSource, /sampleViewportTexture[\s\S]*textureLoad\(source, pixel, 0\)/,
  "le superfici vettoriali screen-space devono restare analitiche e nitide");
assert.ok((shaderSource.match(/rasterPixelViewEnabled\(1\.0\)/g) ?? []).length >= 5,
  "base, tail e glaze devono condividere la vista pixel raster");
assert.equal((strokeRendererSource.match(/directStyledNearestSample\(layerPosition\)/g) ?? []).length, 3,
  "effetti raster, active-only e source-only devono usare lo stesso nearest");
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
const baseActiveSourceStart = baseDisplayShader.indexOf("fn activeSourceFragmentMain(");
const baseActiveSourceEnd = baseDisplayShader.indexOf(
  "fn activeCutoutFragmentMain(",
  baseActiveSourceStart,
);
assert.ok(
  baseActiveSourceStart >= 0 && baseActiveSourceEnd > baseActiveSourceStart,
  "entry point source-only raster base mancante",
);
const baseActiveSourceShader = baseDisplayShader.slice(
  baseActiveSourceStart,
  baseActiveSourceEnd,
);
assert.match(
  baseActiveSourceShader,
  /if \(lod < 0\.5 && rasterPixelViewEnabled\(1\.0\)\) \{\s*source = textureLoad\(\s*activeLayerBase,\s*rasterPixelViewTexel\(\s*uv,\s*vec2<i32>\(textureDimensions\(activeLayerBase, 0\)\)\s*\),\s*0\s*\);\s*\} else \{/,
  "la sorgente raster isolata deve caricare il texel base reale al LOD 0 nella vista pixel",
);
assert.doesNotMatch(
  baseActiveSourceShader,
  /composeActiveClippingGroupTexel|sampleActiveLayer\(/,
  "la vista pixel source-only non deve incorporare il gruppo di clipping",
);
const baseActiveCutoutStart = baseDisplayShader.indexOf("fn activeCutoutFragmentMain(");
assert.ok(baseActiveCutoutStart >= 0, "entry point raw-matte raster base mancante");
const baseActiveCutoutShader = baseDisplayShader.slice(baseActiveCutoutStart);
assert.match(
  baseActiveCutoutShader,
  /if \(rasterPixelViewEnabled\(1\.0\)\) \{\s*raw = textureLoad\(\s*activeLayerBase,\s*rasterPixelViewTexel\(\s*uv,\s*vec2<i32>\(textureDimensions\(activeLayerBase, 0\)\)\s*\),\s*0\s*\);\s*\} else \{/,
  "la raw matte raster base deve caricare il texel reale nella vista pixel",
);
assert.match(
  baseActiveCutoutShader,
  /let opacity = select\([\s\S]*display\.clippingParentOpacity[\s\S]*return raw \* opacity;/,
  "la raw matte deve conservare l'opacità autoriale del parent senza comporre il gruppo",
);
assert.doesNotMatch(
  baseActiveCutoutShader,
  /composeActiveClippingGroupTexel|sampleActiveLayer\(/,
  "la raw matte pixel-perfect non deve incorporare il gruppo di clipping",
);

const thicknessDisplayShaderStart = shaderSource.indexOf(
  "export const thicknessTailDisplayShader",
);
const thicknessDisplayShaderEnd = shaderSource.indexOf(
  "export const lightGlazeDisplayShader",
  thicknessDisplayShaderStart,
);
assert.ok(
  thicknessDisplayShaderStart >= 0 && thicknessDisplayShaderEnd > thicknessDisplayShaderStart,
  "shader display della coda dinamica mancante",
);
const thicknessDisplayShader = shaderSource.slice(
  thicknessDisplayShaderStart,
  thicknessDisplayShaderEnd,
);
const thicknessPermanentMipStart = thicknessDisplayShader.indexOf(
  "fn samplePermanentLogicalMip(",
);
const thicknessPermanentMipEnd = thicknessDisplayShader.indexOf(
  "fn samplePermanentLayer(",
  thicknessPermanentMipStart,
);
const thicknessPermanentMipShader = thicknessDisplayShader.slice(
  thicknessPermanentMipStart,
  thicknessPermanentMipEnd,
);
assert.match(
  thicknessPermanentMipShader,
  /if \(logicalMip < 0\.5\) \{[\s\S]*if \(rasterPixelViewEnabled\(1\.0\)\) \{[\s\S]*textureLoad\(\s*activeLayerBase,\s*rasterPixelViewTexel\(/,
  "la coda dinamica deve leggere il texel permanente reale al LOD 0",
);
const thicknessTailLayerStart = thicknessDisplayShader.indexOf("fn sampleTailLayer(");
const thicknessTailLayerEnd = thicknessDisplayShader.indexOf(
  "fn tailActiveTexel(",
  thicknessTailLayerStart,
);
const thicknessTailLayerShader = thicknessDisplayShader.slice(
  thicknessTailLayerStart,
  thicknessTailLayerEnd,
);
assert.match(
  thicknessTailLayerShader,
  /if \(rasterPixelViewEnabled\(1\.0\)\) \{[\s\S]*textureLoad\(\s*tailTexture,\s*rasterPixelViewTexel\(/,
  "la coda dinamica deve leggere il texel transiente reale nella vista pixel",
);
const thicknessActiveSourceStart = thicknessDisplayShader.indexOf(
  "fn activeSourceFragmentMain(",
);
assert.ok(thicknessActiveSourceStart >= 0, "source-only della coda dinamica mancante");
const thicknessActiveSourceShader = thicknessDisplayShader.slice(thicknessActiveSourceStart);
assert.match(
  thicknessActiveSourceShader,
  /return sampleTailDisplayActive\(layerPosition, layerUv\) \* display\.activeLayerAlpha;/,
  "la source-only della coda deve riusare il percorso active pixel-perfect",
);
assert.doesNotMatch(
  thicknessActiveSourceShader,
  /sampleTailDisplayClippingGroup|composeActiveClippingGroupTexel/,
  "la source-only della coda non deve incorporare il gruppo di clipping",
);

const lightGlazeDisplayShaderStart = thicknessDisplayShaderEnd;
const lightGlazeDisplayShaderEnd = shaderSource.indexOf(
  "export const lightGlazeCompositeMipShader",
  lightGlazeDisplayShaderStart,
);
assert.ok(
  lightGlazeDisplayShaderEnd > lightGlazeDisplayShaderStart,
  "shader display della velatura dinamica mancante",
);
const lightGlazeDisplayShader = shaderSource.slice(
  lightGlazeDisplayShaderStart,
  lightGlazeDisplayShaderEnd,
);
const lightGlazeNearestStart = lightGlazeDisplayShader.indexOf(
  "fn sampleCompositedLayerNearest(",
);
const lightGlazeNearestEnd = lightGlazeDisplayShader.indexOf(
  "fn sampleCompositedClippingGroupLinear(",
  lightGlazeNearestStart,
);
const lightGlazeNearestShader = lightGlazeDisplayShader.slice(
  lightGlazeNearestStart,
  lightGlazeNearestEnd,
);
assert.match(
  lightGlazeNearestShader,
  /return compositedLayerTexel\(rasterPixelViewTexel\(uv, dimensions\)\);/,
  "la velatura dinamica deve comporre il texel reale prima della presentazione",
);
const lightGlazeActiveSourceStart = lightGlazeDisplayShader.indexOf(
  "fn activeSourceFragmentMain(",
);
assert.ok(lightGlazeActiveSourceStart >= 0, "source-only della velatura dinamica mancante");
const lightGlazeActiveSourceShader = lightGlazeDisplayShader.slice(
  lightGlazeActiveSourceStart,
);
assert.match(
  lightGlazeActiveSourceShader,
  /if \(lod < 0\.5\) \{[\s\S]*sampleCompositedLayerNearest\(uv\)[\s\S]*rasterPixelViewEnabled\(1\.0\)/,
  "la source-only della velatura deve selezionare il composito nearest al LOD 0",
);
assert.doesNotMatch(
  lightGlazeActiveSourceShader,
  /sampleCompositedClippingGroupLinear|compositedClippingGroupTexel/,
  "la source-only della velatura non deve incorporare il gruppo di clipping",
);

const rasterStrokeDisplayShaderStart = strokeRendererSource.indexOf(
  "export function rasterStrokeDisplayShader(",
);
const rasterStrokeDisplayShaderEnd = strokeRendererSource.indexOf(
  "function thresholdMaskShader(",
  rasterStrokeDisplayShaderStart,
);
assert.ok(
  rasterStrokeDisplayShaderStart >= 0
    && rasterStrokeDisplayShaderEnd > rasterStrokeDisplayShaderStart,
  "shader display raster con stile mancante",
);
const rasterStrokeDisplayShader = strokeRendererSource.slice(
  rasterStrokeDisplayShaderStart,
  rasterStrokeDisplayShaderEnd,
);
const rasterStrokeActiveSourceStart = rasterStrokeDisplayShader.indexOf(
  "fn activeSourceFragmentMain(",
);
const rasterStrokeActiveSourceEnd = rasterStrokeDisplayShader.indexOf(
  "fn activeCutoutFragmentMain(",
  rasterStrokeActiveSourceStart,
);
const rasterStrokeActiveSourceShader = rasterStrokeDisplayShader.slice(
  rasterStrokeActiveSourceStart,
  rasterStrokeActiveSourceEnd,
);
assert.match(
  rasterStrokeActiveSourceShader,
  /if \(display\.selectedMipLevel < 0\.5\) \{[\s\S]*directStyledNearestSample\(layerPosition\)[\s\S]*rasterPixelViewEnabled\(1\.0\)/,
  "la source-only raster con stile deve selezionare il campione nearest al LOD 0",
);
assert.doesNotMatch(
  rasterStrokeActiveSourceShader,
  /directStyledGroupSample|styledGroupTexel/,
  "la source-only raster con stile non deve incorporare il gruppo di clipping",
);
const rasterStrokeCutoutShader = rasterStrokeDisplayShader.slice(
  rasterStrokeActiveSourceEnd,
);
assert.match(
  rasterStrokeCutoutShader,
  /let authored = sourceTexel\(vec2<i32>\(floor\(layerPosition\)\)\);/,
  "la raw matte raster con stile deve restare un textureLoad autoriale per texel",
);
assert.doesNotMatch(
  rasterStrokeCutoutShader,
  /textureSampleLevel|directStyledSample|composeStyledGroupSample/,
  "la raw matte raster con stile non deve filtrare né incorporare effetti o clipping",
);

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
  /let lodZeroSmooth = display\.selectedMipLevel < 0\.000001\s*&& !rasterPixelViewEnabled\(1\.0\);/,
  "la correzione legacy LOD 0 deve restare attiva sul livello intero di base",
);
assert.match(
  baseDisplayShader,
  /fn finalStackFragmentMain[\s\S]*if \(lod < 1\.0\)[\s\S]*paint = mix\(mipZero, mipOne, lod\)/,
  "la transizione Noise sotto il primo mip deve fondere lo stack finale già composto",
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
  /fn finalStackFragmentMain[\s\S]*sampleCompositedLayerStackLinear\(layerPosition\)[\s\S]*let mipOne = textureSampleLevel\(activeLayerPyramid[\s\S]*paint = mix\(mipZero, mipOne, lod\)[\s\S]*lowerMip - 1\.0/,
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

const viewChangeSignature = "  notifyViewChange(documentViewChanged = true): void";
const viewChangeStart = engineSource.indexOf(viewChangeSignature);
assert.ok(viewChangeStart >= 0, "API di notifica vista con semantica persistente mancante");
const viewChangeSection = engineSource.slice(
  viewChangeStart,
  engineSource.indexOf("  setVectorTextFastPresentationEnabled", viewChangeStart),
);
assert.match(
  viewChangeSection,
  /this\.viewPresentationRevision \+= 1;/,
  "anche una variazione solo di presentazione deve produrre una revisione presentabile",
);
assert.match(
  viewChangeSection,
  /this\.callbacks\.onViewChange\?\.\(\s*this\.getVectorTextViewState\(\),\s*documentViewChanged,\s*\);/,
  "la callback deve ricevere separatamente la persistenza della camera",
);
const resizeCanvasStart = engineSource.indexOf("  resizeCanvas(): void");
const resizeCanvasSection = engineSource.slice(
  resizeCanvasStart,
  engineSource.indexOf("  getVectorTextViewState(): VectorTextViewState", resizeCanvasStart),
);
assert.ok(resizeCanvasStart >= 0 && resizeCanvasSection.length > 0, "resize canvas non trovato");
assert.match(
  resizeCanvasSection,
  /this\.notifyViewChange\(false\);/,
  "il ridimensionamento della superficie deve aggiornare la presentazione senza sporcare la camera salvata",
);
assert.match(
  engineTypesSource,
  /onViewChange\?: \(\s*state: VectorTextViewState,\s*documentViewChanged: boolean,\s*\) => void;/,
  "il contratto callback deve rendere obbligatoria la distinzione persistente/presentazione",
);
assert.match(
  mainSource,
  /onViewChange\(_state, documentViewChanged\)[\s\S]*if \(documentViewChanged\) projectSessionController\?\.markDirty\("view state"\);/,
  "solo una camera persistente deve rendere sporca la sessione progetto",
);
const viewRetrySection = engineSource.slice(
  engineSource.indexOf("  private armViewPresentationRetry"),
  engineSource.indexOf("  renderFrame(timestamp", engineSource.indexOf(
    "  private armViewPresentationRetry",
  )),
);
assert.match(
  viewRetrySection,
  /revision <= this\.viewPresentationRetryArmedRevision[\s\S]*revision !== this\.viewPresentationRevision/,
  "il retry deve essere singolo e ignorare le revisioni superate",
);
assert.match(
  viewRetrySection,
  /queue\.onSubmittedWorkDone\(\)[\s\S]*this\.viewPresentationRetryRequestedRevision = revision;[\s\S]*this\.displayDirty = true;[\s\S]*this\.requestRender\(\)/,
  "la seconda presentazione deve partire solo dopo la conclusione GPU",
);
assert.doesNotMatch(
  viewRetrySection,
  /presentationCacheNeedsFullRebuild\s*=/,
  "il retry deve ricopiare la cache senza ricostruire Glass, livelli o mipmap",
);
assert.match(
  engineSource,
  /if \(timing\.presentationCacheFullRebuilds > 0\) \{\s*this\.armViewPresentationRetry\(viewPresentationRevision\);/,
  "solo il frame autorevole che ricostruisce la vista deve armare il present-only",
);
assert.match(
  appDiagnosticsControllerSource,
  /viewPresentationRevision:[\s\S]*viewPresentationRetryArmedRevision:[\s\S]*viewPresentationRetryRequestedRevision:/,
  "la diagnostica deve rendere osservabile il lifecycle della presentazione",
);

assert.equal(packageJson.scripts["view:verify"], "node scripts/verify-view-rotation.mjs");

console.log(
  "Vista verificata: soglia 581% invariata e active/below/above composti per texel prima della bilineare.",
);
