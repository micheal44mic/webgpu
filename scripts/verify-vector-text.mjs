import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  VECTOR_TEXT_OUTLINE_MITER_LIMIT,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  normalizeVectorTextBlockShadowAngle,
  normalizeVectorTextBlockShadowOffset,
  normalizeVectorTextBlockShadowOpacity,
  normalizeVectorTextOutlineJoin,
  normalizeVectorTextOutlineWidth,
  normalizeVectorTextSingleShadowAngle,
  normalizeVectorTextSingleShadowBlur,
  normalizeVectorTextSingleShadowOffset,
  normalizeVectorTextSingleShadowOpacity,
  vectorTextBlockShadowLocalReach,
  vectorTextBlockShadowLocalVector,
  vectorTextOutlineCanvasLineWidth,
  vectorTextOutlineLocalReach,
  vectorTextSingleShadowLocalVector,
} from "../src/mixed-scene-stack.ts";
import {
  buildShadow3dPath,
  shadow3dBounds,
} from "../src/vector-shadow-3d.js";
import {
  VECTOR_TEXT_BLOCK_SHADOW_VECTOR_STRATEGY,
  VECTOR_TEXT_FONT_GEOMETRY_STRATEGY,
  VECTOR_TEXT_FONT_MANIFEST,
} from "../src/vector-text-font-geometry.ts";
import {
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  VECTOR_TEXT_SINGLE_SHADOW_CACHE_MAX_BYTES,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS,
  VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
  planVectorTextSingleShadowBlur,
  vectorTextSingleShadowBlurSupport,
} from "../src/vector-text-single-shadow.ts";
import {
  MIXED_MERGED_SURFACE_ALIGNMENT,
  MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP,
  MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
  MIXED_MERGED_SURFACE_TRANSPARENT_GUARD,
  alignedMergedSurfaceBounds,
  intersectMergedSurfaceRects,
  mergedSurfaceLocalRect,
  mergedSurfaceMemoryBytes,
  mergedSurfaceMipLevelCount,
  mergedSurfacePhysicalRect,
  unionMergedSurfaceRects,
} from "../src/merged-surface-bounds.ts";

import {
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  MIXED_SCENE_LINEAR_FORMAT,
} from "../src/mixed-scene-compositor-shader.ts";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const engineSource = read("src/brush-engine.ts");
const mainSource = read("src/main.ts");
const controllerSource = read("src/mixed-vector-text-controller.ts");
const vectorShadowSource = read("src/vector-shadow-3d.js");
const fontGeometrySource = read("src/vector-text-font-geometry.ts");
const singleShadowSource = read("src/vector-text-single-shadow.ts");
const sceneSource = read("src/mixed-scene-stack.ts");
const shaderSource = read("src/vector-text-shader.ts");
const mergedSurfaceShaderSource = read("src/merged-surface-shader.ts");
const mixedCompositorSource = read("src/mixed-scene-compositor-shader.ts");
const effectShaderSource = read("src/shaders.ts");
const strokeRendererSource = read("src/stroke-renderer.ts");
const htmlSource = read("index.html");
const styleSource = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const layerSize = 4096;
const viewport = {
  width: 1420,
  height: 860,
  centerX: 2048,
  centerY: 2048,
  zoom: 0.197,
  rotation: 0.37,
};
const object = {
  x: 2110,
  y: 1960,
  scale: 1.42,
  rotation: -0.18,
};

function localToLayer(point) {
  const x = point.x * object.scale;
  const y = point.y * object.scale;
  const cosine = Math.cos(object.rotation);
  const sine = Math.sin(object.rotation);
  return {
    x: object.x + cosine * x - sine * y,
    y: object.y + sine * x + cosine * y,
  };
}

function layerToCanvas(point) {
  const deltaX = point.x - viewport.centerX;
  const deltaY = point.y - viewport.centerY;
  const cosine = Math.cos(viewport.rotation);
  const sine = Math.sin(viewport.rotation);
  return {
    x: viewport.width * 0.5 + (cosine * deltaX - sine * deltaY) * viewport.zoom,
    y: viewport.height * 0.5 + (sine * deltaX + cosine * deltaY) * viewport.zoom,
  };
}

function canvasToLayer(point) {
  const scaledX = (point.x - viewport.width * 0.5) / viewport.zoom;
  const scaledY = (point.y - viewport.height * 0.5) / viewport.zoom;
  const cosine = Math.cos(viewport.rotation);
  const sine = Math.sin(viewport.rotation);
  return {
    x: viewport.centerX + cosine * scaledX + sine * scaledY,
    y: viewport.centerY - sine * scaledX + cosine * scaledY,
  };
}

for (const local of [
  { x: -900, y: -280 },
  { x: 900, y: -280 },
  { x: 900, y: 280 },
  { x: -900, y: 280 },
  { x: 0, y: 0 },
]) {
  const layer = localToLayer(local);
  const roundTrip = canvasToLayer(layerToCanvas(layer));
  assert.ok(Math.abs(roundTrip.x - layer.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - layer.y) < 1e-9);
}

const viewportMiB = viewport.width * viewport.height * 4 / (1024 * 1024);
const commonSegmentedViewportMiB = viewportMiB * 3;
const fullLayerMiB = layerSize * layerSize * 4 / (1024 * 1024);
assert.ok(viewportMiB < 5);
assert.equal(fullLayerMiB, 64);
assert.ok(
  commonSegmentedViewportMiB < fullLayerMiB / 4,
  "una cache testo RGBA8 più il compositore RGBA16F devono restare sotto 16 MiB",
);
assert.equal(MIXED_SCENE_LINEAR_FORMAT, "rgba16float");
assert.equal(
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  "ordered-raster-text-runs-rgba16f-viewport-source-over-v1",
);
assert.equal(
  VECTOR_TEXT_OUTLINE_STRATEGY,
  "canvas2d-glyph-stroke-semantic-viewport-zero-document-cache-v2",
);
assert.equal(VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM, 100);
assert.equal(VECTOR_TEXT_OUTLINE_MITER_LIMIT, 4);
assert.equal(normalizeVectorTextOutlineWidth(-5), 0);
assert.equal(normalizeVectorTextOutlineWidth(999), 100);
assert.equal(normalizeVectorTextOutlineJoin("invalid"), "round");
assert.equal(vectorTextOutlineCanvasLineWidth(25), 50);
assert.equal(vectorTextOutlineLocalReach(25, "round"), 25);
assert.equal(vectorTextOutlineLocalReach(25, "bevel"), 25);
assert.equal(vectorTextOutlineLocalReach(25, "miter"), 100);
assert.equal(
  VECTOR_TEXT_BLOCK_SHADOW_STRATEGY,
  "paint-webgpu-m1-shadow3d-v2-single-extruded-vector-silhouette",
);
assert.equal(VECTOR_TEXT_BLOCK_SHADOW_VECTOR_STRATEGY, VECTOR_TEXT_BLOCK_SHADOW_STRATEGY);
assert.equal(VECTOR_TEXT_FONT_GEOMETRY_STRATEGY, "local-opentype-outline-canvas-path-v1");
assert.equal(normalizeVectorTextBlockShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextBlockShadowOpacity(2), 1);
assert.equal(normalizeVectorTextBlockShadowOffset(-1), 0);
assert.equal(normalizeVectorTextBlockShadowOffset(200), 100);
assert.equal(normalizeVectorTextBlockShadowAngle(-999), -180);
assert.equal(normalizeVectorTextBlockShadowAngle(999), 180);
assert.equal(vectorTextBlockShadowLocalReach(360, 23), 23);
const kittlReferenceVector = vectorTextBlockShadowLocalVector(360, 23, -104);
assert.ok(Math.abs(kittlReferenceVector.x - -5.564204) < 1e-6);
assert.ok(Math.abs(kittlReferenceVector.y - 22.316802) < 1e-6);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_STRATEGY,
  "paint-webgpu-m1-shadow3d-v2-single-offset-mask-with-blur",
);
assert.equal(
  VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY,
  "paint-webgpu-m1-single-shadow-plan-roi-canvas2d-native-gaussian-v1",
);
assert.equal(normalizeVectorTextSingleShadowOpacity(-1), 0);
assert.equal(normalizeVectorTextSingleShadowOpacity(2), 1);
assert.equal(normalizeVectorTextSingleShadowOffset(-1), 0);
assert.equal(normalizeVectorTextSingleShadowOffset(999), 100);
assert.equal(normalizeVectorTextSingleShadowAngle(-999), -180);
assert.equal(normalizeVectorTextSingleShadowAngle(999), 180);
assert.equal(normalizeVectorTextSingleShadowBlur(-1), 0);
assert.equal(normalizeVectorTextSingleShadowBlur(999), 300);
const kittlSingleShadowVector = vectorTextSingleShadowLocalVector(54, -180);
assert.ok(Math.abs(kittlSingleShadowVector.x + 54) < 1e-9);
assert.ok(Math.abs(kittlSingleShadowVector.y) < 1e-9);
assert.equal(vectorTextSingleShadowBlurSupport(0), 0);
assert.equal(vectorTextSingleShadowBlurSupport(6), 19);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_CACHE_MAX_BYTES, 32 * 1024 * 1024);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS, 4 * 1024 * 1024);
assert.equal(VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS, 24);
const singleShadowPlan = planVectorTextSingleShadowBlur(
  { left: 0, top: 0, right: 100, bottom: 40 },
  6,
  1,
);
assert.deepEqual([...singleShadowPlan.bounds], [-19, -19, 119, 59]);
assert.equal(singleShadowPlan.width, 138);
assert.equal(singleShadowPlan.height, 78);
assert.equal(singleShadowPlan.sigmaPixels, 6);
assert.equal(singleShadowPlan.radius, 18);
const cappedSingleShadowPlan = planVectorTextSingleShadowBlur(
  { left: 0, top: 0, right: 100, bottom: 40 },
  6,
  10,
);
assert.ok(Math.abs(cappedSingleShadowPlan.sigmaPixels - 8) < 1e-9);
assert.equal(cappedSingleShadowPlan.radius, 24);
assert.ok(
  cappedSingleShadowPlan.width * cappedSingleShadowPlan.height
    <= VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
);
assert.equal(
  createHash("sha256").update(vectorShadowSource).digest("hex"),
  "9a2676d7b510daa9a01a95e7191409afa2a48aa58198179a52071d63ee5f4fd0",
  "il core della silhouette deve restare identico a paint-webgpu-m1",
);
const rectanglePath = {
  verbs: new Uint8Array([0, 1, 1, 1, 4]),
  coords: new Float64Array([0, 0, 100, 0, 100, 40, 0, 40]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
const extrudedRectangle = buildShadow3dPath(rectanglePath, {
  enabled: true,
  mode: "3d",
  offset: 20,
  angle: 0,
  outlineWidth: 0,
});
assert.ok(extrudedRectangle.verbs.length > rectanglePath.verbs.length);
assert.ok([...extrudedRectangle.coords].includes(120));
assert.deepEqual(
  [...shadow3dBounds([0, 0, 100, 40], {
    enabled: true,
    mode: "3d",
    offset: 20,
    angle: 0,
    outlineWidth: 0,
  })],
  [0, 0, 120, 40],
);
assert.equal(VECTOR_TEXT_FONT_MANIFEST.length, 3);
const fontLogicalBytes = VECTOR_TEXT_FONT_MANIFEST.reduce(
  (total, entry) => total + fs.statSync(entry.fileUrl).size,
  0,
);
assert.equal(fontLogicalBytes, 392_528);

assert.equal(
  MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
  "mixed-raster-run-bbox-document-mips-segmented-vector-viewport-v4",
);
assert.equal(MIXED_MERGED_SURFACE_ALIGNMENT, 64);
assert.equal(MIXED_MERGED_SURFACE_TRANSPARENT_GUARD, 64);
assert.equal(MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP, 5);
const mixedContentBounds = unionMergedSurfaceRects([
  { x: 1900, y: 1800, width: 500, height: 300 },
  { x: 2050, y: 2050, width: 300, height: 200 },
], layerSize);
assert.deepEqual(mixedContentBounds, { x: 1900, y: 1800, width: 500, height: 450 });
const croppedMergedBounds = alignedMergedSurfaceBounds(mixedContentBounds, layerSize);
assert.deepEqual(croppedMergedBounds, { x: 1792, y: 1728, width: 704, height: 640 });
assert.equal(croppedMergedBounds.x % MIXED_MERGED_SURFACE_ALIGNMENT, 0);
assert.equal(croppedMergedBounds.y % MIXED_MERGED_SURFACE_ALIGNMENT, 0);
assert.ok(mergedSurfaceMipLevelCount(croppedMergedBounds) > MIXED_MERGED_SURFACE_MAX_DISPLAY_MIP);
assert.deepEqual(
  mergedSurfaceLocalRect(mixedContentBounds, croppedMergedBounds),
  { x: 108, y: 72, width: 500, height: 450 },
);
assert.deepEqual(
  mergedSurfacePhysicalRect(
    { x: 1900, y: 1900, width: 100, height: 50 },
    croppedMergedBounds,
    1,
  ),
  { x: 108, y: 172, width: 100, height: 50 },
);
assert.ok(intersectMergedSurfaceRects(mixedContentBounds, croppedMergedBounds, layerSize));
const croppedMergedMemory = mergedSurfaceMemoryBytes(croppedMergedBounds, 4);
const fullMergedMemory = mergedSurfaceMemoryBytes(
  { width: layerSize, height: layerSize },
  4,
);
assert.equal(fullMergedMemory.mip0Bytes / (1024 * 1024), 64);
assert.ok(croppedMergedMemory.totalBytes < fullMergedMemory.totalBytes / 30);

assert.match(mainSource, /pageSearchParams\.get\("vectorTextTest"\) === "1"/);
assert.match(mainSource, /new MixedVectorTextController\(engine\)/);
assert.match(mainSource, /if \(!responseHasJsonContent\(response\)\) \{[\s\S]*return null;/,
  "il dev server HTML fallback non deve apparire come errore JSON");
assert.match(engineSource, /if \(this\.vectorTextPrototypeEnabled\)/);
assert.match(engineSource, /private readonly vectorTextRunTextures = new Map/);
assert.match(engineSource, /private mixedSceneLinearTexture: GPUTexture \| null = null/);
assert.match(engineSource, /format: "rgba8unorm-srgb"/);
assert.match(engineSource, /format: MIXED_SCENE_LINEAR_FORMAT/);
assert.match(engineSource, /copyExternalImageToTexture\(/);
assert.match(engineSource, /premultipliedAlpha: true/);
assert.match(engineSource, /this\.vectorTextRunTextures\.size/);
assert.match(engineSource, /this\.mixedSceneLinearWidth \* this\.mixedSceneLinearHeight \* 8/);
assert.match(engineSource, /clearVectorTextPresentation\(placement\?: VectorTextPlacement\)/);
assert.match(engineSource, /this\.mixedSceneStack\.compositionSegments\(/);
assert.match(engineSource, /for \(const segment of this\.mixedSceneCompositionSegments\)/);
assert.match(engineSource, /candidate\.key === segment\.key/);
assert.match(engineSource, /this\.vectorTextRunTextures\.get\(segment\.key\)/);
assert.match(engineSource, /srcFactor: "one"[\s\S]*dstFactor: "one-minus-src-alpha"/);
assert.equal(
  (engineSource.match(/this\.encodeMixedSceneSegmentedPresentation\(/g) ?? []).length,
  3,
  "live Light Glaze, commit e display normale devono usare lo stesso ordine segmentato",
);
assert.equal(
  (engineSource.match(/entryPoint: "activeFragmentMain"/g) ?? []).length,
  4,
  "base, Traccia/effetti, tail e Light Glaze richiedono una sorgente attiva trasparente",
);
assert.match(engineSource, /kind: "raster-stroke", sourceMode: "light-glaze"/);
assert.match(engineSource, /kind: "raster-stroke", sourceMode: "permanent"/);
assert.match(engineSource, /sourceMode: thicknessTailFrame \? "thickness-tail" : "permanent"/);
assert.match(engineSource, /if \(!requiresFullRebuild\) \{[\s\S]*scenePass\.setPipeline\(clearPipeline\)/);
assert.doesNotMatch(engineSource, /VectorTextPatch|vectorTextPatch|adaptiveMergedSurfaceBounds/);
assert.doesNotMatch(engineSource, /scheduleMixedMergedViewRefresh|refreshMixedMergedSurfacesForView/);
assert.match(engineSource, /alignedMergedSurfaceBounds\(contentBounds, LAYER_SIZE\)/);
assert.match(engineSource,
  /items\.filter\([\s\S]*item is Extract<MixedSceneItem, \{ kind: "raster" \}>/,
  "le cache documento devono contenere solo raster");
assert.match(engineSource, /addRasterAboveSelection\(record\.id\)/);
assert.match(sceneSource, /this\.orderedItems\.splice\(selectedIndex \+ 1, 0, item\)/,
  "il nuovo raster deve nascere immediatamente sopra l'elemento selezionato");
assert.match(sceneSource, /compositionSegments\(activeRasterLayerId: number\)/);
assert.match(sceneSource, /key: `raster-run:\$\{items\.map/);
assert.match(sceneSource, /key: `text-run:\$\{items\.map/);
assert.match(engineSource, /canPaintSelectedSceneItem\(\)/);

assert.match(shaderSource,
  /semantic-text-run-viewport-rgba8-srgb-segmented-rgba16f-scene-v4/);
assert.match(mixedCompositorSource,
  /ordered-raster-text-runs-rgba16f-viewport-source-over-v1/);
assert.match(mixedCompositorSource, /MIXED_SCENE_LINEAR_FORMAT = "rgba16float"/);
assert.match(mixedCompositorSource, /textureSampleLevel\(sourceTexture, sourceSampler, uv, lod\)/);
assert.match(mixedCompositorSource, /return textureLoad\(sourceTexture, pixel, 0\)/);
assert.match(mixedCompositorSource, /let paint = textureLoad\(sceneTexture, pixel, 0\)/);
assert.match(mixedCompositorSource, /linearToSrgb\(compositedLinear\)/);
assert.equal((effectShaderSource.match(/fn activeFragmentMain\(/g) ?? []).length, 3);
assert.equal((strokeRendererSource.match(/fn activeFragmentMain\(/g) ?? []).length, 1);
assert.match(mergedSurfaceShaderSource,
  /resolutionScale = max\(display\.hasMergedBelow, 1\.0\)/);
assert.match(mergedSurfaceShaderSource,
  /resolutionScale = max\(display\.hasMergedAbove, 1\.0\)/);
assert.doesNotMatch(mergedSurfaceShaderSource, /resolutionScale = 4\.0/);

assert.match(controllerSource, /requestAnimationFrame\(/);
assert.match(controllerSource, /placement: `text-run:\$\{nodes\.map/);
assert.match(controllerSource, /for \(const item of snapshot\.items\)/);
assert.match(controllerSource, /if \(item\.kind === "text"\)[\s\S]*flushTextRun\(\)/,
  "ogni confine raster deve chiudere il run testo corrente");
assert.match(controllerSource, /this\.renderedTextRunKeys/);
assert.match(controllerSource, /this\.host\.clearVectorTextPresentation\(previousKey\)/);
assert.match(controllerSource, /this\.host\.clearVectorTextPresentation\(group\.placement\)/);
assert.match(controllerSource, /this\.host\.updateVectorTextPresentation\(/);
assert.match(controllerSource, /view\.canvasWidth \* view\.canvasHeight \* 8/);
assert.match(controllerSource, /context\.setTransform\(a, b, c, d, e, f\)/);
assert.match(controllerSource, /context\.lineJoin = node\.outlineJoin/);
assert.match(controllerSource, /context\.miterLimit = VECTOR_TEXT_OUTLINE_MITER_LIMIT/);
assert.match(controllerSource,
  /if \(node\.outlineWidth > 0\) \{[\s\S]*context\.stroke\(geometry\.outline\.canvasPath\)[\s\S]*context\.fill\(geometry\.outline\.canvasPath\)/);
assert.doesNotMatch(controllerSource, /document\.createElement\("canvas"\)/);
assert.match(controllerSource, /private drawBlockShadow\(/);
assert.match(controllerSource,
  /buildVectorTextBlockShadowGeometry\([\s\S]*node\.blockShadowOffset[\s\S]*node\.blockShadowAngle/,
  "l'ombra deve usare la singola silhouette vettoriale estrusa");
assert.match(controllerSource,
  /if \(node\.blockShadowOutlineWidth > 0\) \{[\s\S]*target\.lineWidth = node\.blockShadowOutlineWidth;[\s\S]*target\.stroke\(blockShadow\.canvasPath\)/,
  "Outline Width deve essere diretto e zero non deve produrre stroke",
);
assert.doesNotMatch(controllerSource, /pixelSteps|remainingSamples|blockShadowCanvas/);
assert.doesNotMatch(controllerSource, /strokeText\(|fillText\(/);
assert.match(controllerSource, /private drawSingleShadow\(/);
assert.match(controllerSource,
  /if \(node\.singleShadowBlur > 0\) \{[\s\S]*this\.singleShadowBlurRenderer\.draw/,
  "Blur > 0 deve usare una sola mask ROI cacheata",
);
assert.match(controllerSource,
  /this\.singleShadowBlurRenderer\.invalidateNode\(node\.id\);[\s\S]*target\.translate\(vector\.x, vector\.y\);[\s\S]*target\.fill\(geometry\.outline\.canvasPath\)/,
  "Blur 0 deve ricadere sulla singola sagoma vettoriale netta",
);
assert.doesNotMatch(controllerSource,
  /singleShadow[\s\S]{0,300}stroke\(/,
  "Ombra singola mantiene Outline Width a zero e non esegue stroke",
);
assert.match(singleShadowSource, /planVectorTextSingleShadowBlur\(/);
assert.match(singleShadowSource, /blur \* 3 \+ 1/);
assert.match(singleShadowSource, /VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS/);
assert.match(singleShadowSource, /private readonly keyByNodeId = new Map/);
assert.match(singleShadowSource, /private scratchCanvas: HTMLCanvasElement \| null/);
assert.match(singleShadowSource, /context\.filter = `blur\(\$\{plan\.sigmaPixels\}px\)`/);
assert.match(singleShadowSource, /this\.cacheBytes <= this\.maxCacheBytes/);
assert.match(controllerSource,
  /if \(!item\.textNode\.blockShadowEnabled\) \{[\s\S]*geometry\.blockShadowKey = null;[\s\S]*geometry\.blockShadow = null;/,
  "disattivare l'effetto deve rilasciare il PathData estruso");
assert.match(controllerSource,
  /!item\.textNode\.singleShadowEnabled \|\| item\.textNode\.singleShadowBlur <= 0[\s\S]*singleShadowBlurRenderer\.invalidateNode/,
  "OFF e Blur 0 devono rilasciare la mask raster dell'ombra singola");
assert.match(fontGeometrySource, /buildShadow3dPath\(/);
assert.match(fontGeometrySource, /angle: -\(Number\.isFinite\(angleDegrees\)/);
assert.match(fontGeometrySource, /new Path2D\(\)/);
const textCornersStart = controllerSource.indexOf("private textCorners(");
const textCornersEnd = controllerSource.indexOf("private rotationHandle(", textCornersStart);
assert.ok(textCornersStart >= 0 && textCornersEnd > textCornersStart);
const textCornersSource = controllerSource.slice(textCornersStart, textCornersEnd);
assert.doesNotMatch(
  textCornersSource,
  /blockShadow|singleShadow|outlineWidth/,
  "gli effetti non devono cambiare bbox e maniglie del testo sorgente",
);
assert.match(controllerSource,
  /scheduleViewSync\(\): void \{[\s\S]*items\.some\(\(item\) => item\.kind === "text"\)/,
  "zoom e pan devono ridisegnare il testo anche quando è selezionato un raster");
assert.doesNotMatch(controllerSource, /documentPatch|renderDocumentPatch|measureDocumentPatch/);
assert.doesNotMatch(controllerSource, /VectorTextPatch|resolutionScale/);
assert.match(controllerSource, /this\.interactionCanvas\.hidden = !textSelected/);
assert.match(controllerSource,
  /interactionStillTargetsSelection[\s\S]*snapshot\.selectedKey === `text:\$\{interaction\.startModel\.id\}`/);
assert.doesNotMatch(controllerSource,
  /this\.snapshot = snapshot;\s*this\.activeInteraction = null;/);
assert.match(controllerSource,
  /interaction\.startModel\.scale \* distance \/ interaction\.startDistance/);
assert.doesNotMatch(controllerSource, /createTexture|GPUTexture/);
assert.doesNotMatch(htmlSource, /gpuMemoryVectorTextPatch/);
assert.match(htmlSource, /id="gpuMemoryVectorText"/);
for (const id of [
  "vectorTextPrototypeSection",
  "vectorTextValue",
  "vectorTextFontFamily",
  "vectorTextFontSize",
  "vectorTextColor",
  "vectorTextOutlineWidth",
  "vectorTextOutlineWidthOut",
  "vectorTextOutlineColor",
  "vectorTextOutlineJoin",
  "vectorTextBlockShadowEnabled",
  "vectorTextBlockShadowParameters",
  "vectorTextBlockShadowColor",
  "vectorTextBlockShadowOpacity",
  "vectorTextBlockShadowOpacityOut",
  "vectorTextBlockShadowOffset",
  "vectorTextBlockShadowOffsetOut",
  "vectorTextBlockShadowAngle",
  "vectorTextBlockShadowAngleOut",
  "vectorTextBlockShadowOutlineWidth",
  "vectorTextBlockShadowOutlineWidthOut",
  "vectorTextSingleShadowEnabled",
  "vectorTextSingleShadowParameters",
  "vectorTextSingleShadowColor",
  "vectorTextSingleShadowOpacity",
  "vectorTextSingleShadowOpacityOut",
  "vectorTextSingleShadowOffset",
  "vectorTextSingleShadowOffsetOut",
  "vectorTextSingleShadowAngle",
  "vectorTextSingleShadowAngleOut",
  "vectorTextSingleShadowBlur",
  "vectorTextSingleShadowBlurOut",
  "vectorTextSingleShadowOutlineWidth",
  "vectorTextSingleShadowOutlineWidthOut",
  "addVectorText",
  "deleteVectorText",
  "moveVectorTextDown",
  "moveVectorTextUp",
  "vectorTextReset",
  "vectorTextStatus",
  "vectorTextPresentationCanvas",
  "vectorTextInteractionCanvas",
  "gpuMemoryVectorText",
  "gpuMemoryVectorTextRow",
]) {
  assert.match(htmlSource, new RegExp(`id="${id}"`), `elemento #${id} mancante`);
}
assert.match(htmlSource,
  /id="vectorTextSingleShadowOutlineWidth"[\s\S]*?value="0"[\s\S]*?disabled/,
  "Outline Width dell'ombra singola deve restare visibilmente bloccato a zero",
);
assert.match(styleSource, /#vectorTextInteractionCanvas\.is-editing/);
assert.match(styleSource, /#vectorTextInteractionCanvas\[hidden\]\s*\{\s*display: none;/s);
assert.equal(packageJson.scripts["vector-text:verify"], "node scripts/verify-vector-text.mjs");
assert.equal(packageJson.scripts["mixed-scene:verify"], "node scripts/verify-mixed-scene-stack.mjs");
assert.equal(packageJson.dependencies["opentype.js"], "^1.3.4");

console.log(
  "Testo semantico verificato: ordine documento invariabile al raster attivo, "
  + "cache per run, compositore lineare, effetti coerenti e inserimento subito sopra; "
  + `${commonSegmentedViewportMiB.toFixed(2)} MiB nel caso comune contro 64 MiB full-canvas.`,
);
