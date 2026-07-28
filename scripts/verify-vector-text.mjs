import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VECTOR_TEXT_OUTLINE_MITER_LIMIT,
  VECTOR_TEXT_OUTLINE_STRATEGY,
  VECTOR_TEXT_OUTLINE_WIDTH_MAXIMUM,
  normalizeVectorTextOutlineJoin,
  normalizeVectorTextOutlineWidth,
  vectorTextOutlineCanvasLineWidth,
  vectorTextOutlineLocalReach,
} from "../src/mixed-scene-stack.ts";
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

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const engineSource = read("src/brush-engine.ts");
const mainSource = read("src/main.ts");
const controllerSource = read("src/mixed-vector-text-controller.ts");
const sceneSource = read("src/mixed-scene-stack.ts");
const shaderSource = read("src/vector-text-shader.ts");
const mergedSurfaceShaderSource = read("src/merged-surface-shader.ts");
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
const dualViewportMiB = viewportMiB * 2;
const fullLayerMiB = layerSize * layerSize * 4 / (1024 * 1024);
assert.ok(viewportMiB < 5);
assert.ok(dualViewportMiB < 10);
assert.equal(fullLayerMiB, 64);
assert.ok(dualViewportMiB < fullLayerMiB / 6,
  "anche entrambe le cache testo devono restare molto sotto un layer 4096²");

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
  MIXED_MERGED_SURFACE_STORAGE_STRATEGY,
  "mixed-raster-bbox-document-mips-vector-viewport-v3",
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
assert.match(engineSource, /if \(this\.vectorTextPrototypeEnabled\)/);
assert.match(engineSource, /private vectorTextBelowTexture: GPUTexture \| null = null/);
assert.match(engineSource, /private vectorTextAboveTexture: GPUTexture \| null = null/);
assert.match(engineSource, /format: "rgba8unorm-srgb"/);
assert.match(engineSource, /copyExternalImageToTexture\(/);
assert.match(engineSource, /premultipliedAlpha: true/);
assert.match(engineSource, /vectorTextTextureCount \* this\.vectorTextTextureWidth/);
assert.match(engineSource, /clearVectorTextPresentation\(placement\?: VectorTextPlacement\)/);
assert.match(engineSource, /binding: 6, resource: belowView \?\? this\.transparentLayerView/);
assert.match(engineSource, /binding: 7, resource: aboveView \?\? this\.transparentLayerView/);
assert.match(engineSource, /entryPoint: "fragmentMain"/);
assert.doesNotMatch(engineSource, /VectorTextPatch|vectorTextPatch|adaptiveMergedSurfaceBounds/);
assert.doesNotMatch(engineSource, /scheduleMixedMergedViewRefresh|refreshMixedMergedSurfacesForView/);
assert.match(engineSource, /alignedMergedSurfaceBounds\(contentBounds, LAYER_SIZE\)/);
assert.match(engineSource, /resolutionScale: 1/);
assert.match(engineSource,
  /items\.filter\([\s\S]*item is Extract<MixedSceneItem, \{ kind: "raster" \}>/,
  "le cache documento devono contenere solo raster");
assert.match(engineSource, /addRasterAboveSelection\(record\.id\)/);
assert.match(sceneSource, /this\.orderedItems\.splice\(selectedIndex \+ 1, 0, item\)/,
  "il nuovo raster deve nascere immediatamente sopra l'elemento selezionato");
assert.match(engineSource, /canPaintSelectedSceneItem\(\)/);

assert.match(shaderSource, /@binding\(6\) var vectorTextBelowTexture/);
assert.match(shaderSource, /@binding\(7\) var vectorTextAboveTexture/);
assert.match(shaderSource,
  /paint = sourceOver\(vectorBelow, paint\);\s*paint = sourceOver\(activePaint[\s\S]*paint = sourceOver\(vectorAbove, paint\);/,
  "l'ordine deve essere raster sotto → testo sotto → raster attivo → testo sopra");
assert.doesNotMatch(shaderSource, /fragmentBelowActive|fragmentAboveActive/);
assert.match(shaderSource,
  /semantic-text-dual-viewport-rgba8-srgb-cache-all-display-paths-v3/);
assert.match(strokeRendererSource, /@group\(0\) @binding\(1\) var vectorTextBelowTexture/);
assert.match(strokeRendererSource, /@group\(0\) @binding\(2\) var vectorTextAboveTexture/);
assert.match(strokeRendererSource,
  /sampleViewportTexture\(vectorTextBelowTexture[\s\S]*activePaint[\s\S]*sampleViewportTexture\(vectorTextAboveTexture/,
  "Traccia/Ombre/Smusso devono conservare il testo sotto e sopra il raster attivo");
assert.equal((effectShaderSource.match(/@group\(0\) @binding\(8\) var vectorTextBelowTexture/g) ?? []).length, 2);
assert.equal((effectShaderSource.match(/@group\(0\) @binding\(9\) var vectorTextAboveTexture/g) ?? []).length, 2);
assert.equal((effectShaderSource.match(/sampleViewportTexture\(vectorTextBelowTexture/g) ?? []).length, 2);
assert.equal((effectShaderSource.match(/sampleViewportTexture\(vectorTextAboveTexture/g) ?? []).length, 2);
assert.match(engineSource, /rebuildVectorTextDependentDisplayBindGroups\(\)/);
assert.match(engineSource, /binding: 8, resource: belowView/);
assert.match(engineSource, /binding: 9, resource: aboveView/);
assert.match(engineSource,
  /session\.hasContent[\s\S]*this\.lightGlazeDisplayPipeline[\s\S]*this\.vectorTextDisplayPipeline/,
  "anche i frame Light Glaze senza contenuto devono usare il compositore testo");
assert.match(mergedSurfaceShaderSource,
  /resolutionScale = max\(display\.hasMergedBelow, 1\.0\)/);
assert.match(mergedSurfaceShaderSource,
  /resolutionScale = max\(display\.hasMergedAbove, 1\.0\)/);
assert.doesNotMatch(mergedSurfaceShaderSource, /resolutionScale = 4\.0/);

assert.match(controllerSource, /requestAnimationFrame\(/);
assert.match(controllerSource, /const groups: readonly/);
assert.match(controllerSource, /placement: "below-active"/);
assert.match(controllerSource, /placement: "above-active"/);
assert.match(controllerSource, /snapshot\.items\.slice\(0, activeRasterIndex\)/);
assert.match(controllerSource, /snapshot\.items\.slice\(activeRasterIndex \+ 1\)/);
assert.match(controllerSource, /\.filter\(\(item\) => item\.kind === "text"\)/);
assert.match(controllerSource, /this\.host\.clearVectorTextPresentation\(group\.placement\)/);
assert.match(controllerSource, /this\.host\.updateVectorTextPresentation\(/);
assert.match(controllerSource, /context\.setTransform\(a, b, c, d, e, f\)/);
assert.match(controllerSource, /context\.lineJoin = node\.outlineJoin/);
assert.match(controllerSource, /context\.miterLimit = VECTOR_TEXT_OUTLINE_MITER_LIMIT/);
assert.match(controllerSource,
  /if \(node\.outlineWidth > 0\) \{[\s\S]*context\.strokeText\([\s\S]*context\.fillText\(/);
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
assert.match(styleSource, /#vectorTextInteractionCanvas\.is-editing/);
assert.match(styleSource, /#vectorTextInteractionCanvas\[hidden\]\s*\{\s*display: none;/s);
assert.equal(packageJson.scripts["vector-text:verify"], "node scripts/verify-vector-text.mjs");
assert.equal(packageJson.scripts["mixed-scene:verify"], "node scripts/verify-mixed-scene-stack.mjs");

console.log(
  "Testo semantico verificato: stesso renderer selezionato/statico, cache dual viewport, "
  + "raster documento separati, stack effetti coerente e inserimento subito sopra; "
  + `${dualViewportMiB.toFixed(2)} MiB massimi nel viewport di prova contro 64 MiB full-canvas.`,
);