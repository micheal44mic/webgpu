import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readEngineSource } from "./engine-source.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const modulePath = path.join(projectRoot, "src", "brush-catalog.ts");
const presets = await import(pathToFileURL(modulePath).href);
const builtinAssets = await import(pathToFileURL(
  path.join(projectRoot, "src", "brush-builtin-assets.ts"),
).href);
const brushDefinition = await import(pathToFileURL(
  path.join(projectRoot, "src", "brush-definition.ts"),
).href);
const registryModulePath = path.join(projectRoot, "src", "brush-asset-registry.ts");
const { CustomBrushAssetRegistry } = await import(pathToFileURL(registryModulePath).href);

assert.equal(presets.BRUSH_CATALOG_VERSION, 1);
assert.equal(brushDefinition.BRUSH_DEFINITION_VERSION, 1);
assert.equal(Object.keys(builtinAssets.BUILTIN_BRUSH_ASSETS).length, 3);
assert.equal("legacy-grain" in builtinAssets.BUILTIN_BRUSH_ASSETS, false);
assert.equal(Object.keys(presets.BUILTIN_BRUSH_CATALOG).length, 1);

function pngDimensions(bytes) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "asset non PNG",
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

for (const asset of Object.values(builtinAssets.BUILTIN_BRUSH_ASSETS)) {
  const bytes = readFileSync(path.join(projectRoot, asset.sourceFile));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    asset.sourceSha256,
    `${asset.id}: source SHA-256`,
  );
  assert.deepEqual(pngDimensions(bytes), { width: asset.width, height: asset.height }, `${asset.id}: dimensioni`);
}

assert.equal(builtinAssets.BUILTIN_BRUSH_ASSETS["legacy-shape"].decode.invertLuminance, false);
assert.equal(builtinAssets.BUILTIN_BRUSH_ASSETS["pencil-shape"].decode.invertLuminance, true);

const pencil = presets.PENCIL_BRUSH_PRESET;
const pencilSettings = pencil.definition.settings;
assert.equal(pencil.id, "m1m4-pencil-v1");
assert.equal(pencil.categoryId, "pencil");
assert.equal(pencilSettings.shapeAssetId, "pencil-shape");
assert.equal(pencilSettings.shapeInvert, false);
assert.equal(pencilSettings.shapeRotation, "follow-stroke");
assert.equal(pencilSettings.grainAssetId, "pencil-grain");
assert.equal(pencilSettings.grainMovement, 0.99);
assert.equal(pencilSettings.shapeScatter, 0.51);
assert.equal(pencilSettings.count, 1);
assert.equal(pencilSettings.grainMode, "moving");
assert.equal(pencilSettings.grainScale, 0.43);
assert.equal(pencilSettings.blendMode, "intense-blending");
assert.equal(pencilSettings.flow, 1);
assert.equal(pencilSettings.spacingPercent, 2);
assert.equal(pencilSettings.positionJitterLinear, 0.1);
assert.equal(pencilSettings.positionJitterLateral, 0.1);
assert.equal(pencilSettings.startThickness, 1);
assert.equal(pencilSettings.endThickness, 0.6);
assert.equal(pencilSettings.size, 30);
assert.equal(pencilSettings.opacity, 1);
assert.equal("color" in pencilSettings, false);
assert.equal("tool" in pencilSettings, false);
assert.deepEqual(
  [
    pencilSettings.hueJitterDegrees,
    pencilSettings.saturationJitter,
    pencilSettings.lightnessJitter,
    pencilSettings.darknessJitter,
  ],
  [0, 0, 0, 0],
);

const current = {
  tool: "blend",
  color: "#123456",
  sentinel: "must-not-survive",
};
const resolved = presets.resolveBrushPresetSettings(pencil, current);
assert.equal(resolved.color, current.color, "il preset deve conservare il colore attivo");
assert.equal(resolved.tool, current.tool, "il preset deve conservare il tool attivo");
assert.equal(resolved.size, 30);
assert.equal(resolved.opacity, 1);
assert.equal(resolved.shapeAssetId, "pencil-shape");
assert.equal(resolved.shapeRotation, "follow-stroke");
assert.equal(resolved.grainAssetId, "pencil-grain");
assert.equal(resolved.grainMovement, 0.99);
assert.equal("sentinel" in resolved, true, "l'adapter deve sovrapporsi allo stato corrente");

function rgba8MipSummary(width, height) {
  let mipWidth = width;
  let mipHeight = height;
  let levels = 0;
  let pixels = 0;
  while (true) {
    levels += 1;
    pixels += mipWidth * mipHeight;
    if (mipWidth === 1 && mipHeight === 1) break;
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
  }
  return { levels, bytes: pixels * 4 };
}

const pencilGrainMip = rgba8MipSummary(800, 800);
assert.deepEqual(pencilGrainMip, { levels: 10, bytes: 3_413_260 });

const customRegistry = new CustomBrushAssetRegistry();
const decodedShape = {
  width: 2,
  height: 1,
  rgba: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 64]),
  name: "Persisted Shape",
  mimeType: "image/png",
};
const persistedShapeId = "custom-shape:persisted-v1";
assert.equal(customRegistry.registerShape(decodedShape, persistedShapeId), persistedShapeId);
decodedShape.rgba.fill(7);
const firstSnapshot = customRegistry.snapshot(persistedShapeId);
assert.deepEqual(
  [...firstSnapshot.rgba],
  [0, 0, 0, 255, 255, 255, 255, 64],
  "Il registro deve possedere una copia persistibile dei pixel decodificati.",
);
assert.equal(firstSnapshot.sourceBitDepth, 8);
assert.deepEqual(
  [...firstSnapshot.scalar16],
  [0, Math.round(Math.round(255) * (64 / 255)) * 257],
  "legacy RGBA Shape input must be converted once into authoritative scalar16 coverage",
);
firstSnapshot.rgba.fill(9);
firstSnapshot.scalar16.fill(9);
assert.deepEqual(
  [...customRegistry.snapshot(persistedShapeId).rgba],
  [0, 0, 0, 255, 255, 255, 255, 64],
  "L'API read-only non deve esporre il backing store autorevole.",
);
const nativeShapeSamples = Uint16Array.of(1, 32768, 65534);
const nativeShapeId = customRegistry.registerShape({
  width: 3,
  height: 1,
  scalar16: nativeShapeSamples,
  sourceBitDepth: 16,
  name: "Native Shape",
});
nativeShapeSamples.fill(0);
const nativeShapeSnapshot = customRegistry.snapshot(nativeShapeId);
assert.equal(nativeShapeSnapshot.sourceBitDepth, 16);
assert.deepEqual([...nativeShapeSnapshot.scalar16], [1, 32768, 65534]);
assert.deepEqual(
  [...nativeShapeSnapshot.rgba],
  [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255],
  "RGBA8 is a derived preview proxy for scalar16-native assets",
);
assert.throws(
  () => customRegistry.registerShape({ ...decodedShape, rgba: new Uint8Array(8) }, persistedShapeId),
  /immutable/,
);
const generatedGrainId = customRegistry.registerGrain({
  width: 1,
  height: 1,
  rgba: new Uint8Array([80, 90, 100, 255]),
});
assert.match(generatedGrainId, /^custom-grain:/);
assert.equal(customRegistry.has(generatedGrainId), true);
assert.equal(customRegistry.snapshot(generatedGrainId).kind, "grain");
assert.equal(customRegistry.remove(generatedGrainId), true);
assert.equal(customRegistry.has(generatedGrainId), false);
assert.equal(customRegistry.snapshot(generatedGrainId), null);
assert.throws(
  () => customRegistry.registerShape({ width: 1, height: 1, rgba: new Uint8Array(3) }),
  /expected 4 B/,
);

const engine = readEngineSource();
const definitionSource = readFileSync(
  path.join(projectRoot, "src", "brush-definition.ts"),
  "utf8",
);
const shaders = readFileSync(path.join(projectRoot, "src", "shaders.ts"), "utf8");
const main = readFileSync(path.join(projectRoot, "src", "main.ts"), "utf8");
const brushLibraryController = readFileSync(
  path.join(projectRoot, "src", "brush-library-controller.ts"),
  "utf8",
);
const libraryPreview = readFileSync(
  path.join(projectRoot, "src", "brush-library-preview.ts"),
  "utf8",
);
const strokePreviewRenderer = readFileSync(
  path.join(projectRoot, "src", "brush-stroke-preview-renderer.ts"),
  "utf8",
);
const html = readFileSync(path.join(projectRoot, "index.html"), "utf8");

assert(!engine.includes('"m1m4-pencil-v1"'),
  "Il motore non deve contenere logica legata all'id del preset Pencil.");
assert(engine.includes("shapeAssetId: BrushShapeAssetId")
  && engine.includes("shapeInvert: boolean")
  && engine.includes("shapeRotation: BrushShapeRotation")
  && engine.includes("grainAssetId: BrushGrainAssetId")
  && engine.includes("grainMovement: number"),
  "Le nuove capacità devono appartenere al contratto BrushSettings generale.");
assert(definitionSource.includes('shapeAssetId: "legacy-shape"')
  && definitionSource.includes("shapeInvert: false")
  && definitionSource.includes('shapeMaskFormat: "r16float"')
  && definitionSource.includes('shapeRotation: "fixed"')
  && definitionSource.includes('grainAssetId: "pencil-grain"')
  && definitionSource.includes("grainMovement: 0"),
  "I default built-in non usano gli asset Pencil attesi.");
assert(engine.includes("grainMovement: clamp(next.grainMovement ?? this.settings.grainMovement, 0, 1)")
  && engine.includes('settings.shapeRotation === "follow-stroke" ? 1 : 0'),
  "Movement e Follow Stroke non sono parametri runtime generici normalizzati.");

const shapeLoaderStart = engine.indexOf("export async function createShapeMaskResources(");
const shapeLoaderEnd = engine.indexOf("export function destroyShapeMaskResources", shapeLoaderStart);
assert(shapeLoaderStart >= 0 && shapeLoaderEnd > shapeLoaderStart, "Loader Shape non trovato.");
const shapeLoader = engine.slice(shapeLoaderStart, shapeLoaderEnd);
assert(shapeLoader.indexOf("authoredInvert !== shapeInvert") >= 0
  && shapeLoader.indexOf("authoredInvert !== shapeInvert")
    < shapeLoader.indexOf("buildShapeOccupancyMaps"),
  "Shape Invert deve essere risolto prima di mip, occupancy e preview.");
assert(engine.includes("ensureReplayBrushAssets(batch.settings)")
  && engine.includes("shapeAssetIdForSettings(settings)")
  && engine.includes("shapeInvertForSettings(settings)")
  && engine.includes("grainAssetIdForSettings(settings)"),
  "Undo/Redo non ripristina gli asset registrati da ogni brush batch.");
assert(engine.includes("shapeDesiredInvert")
  && engine.includes("shapeLoadingInvert")
  && engine.includes("shapeLoadedInvert")
  && engine.includes("shapeDesiredFormat")
  && engine.includes("shapeLoadingFormat")
  && engine.includes("shapeLoadedFormat")
  && engine.includes("runGpuAllocationTransaction")
  && engine.includes("createShapeMaskResources(this, assetId, invert, format)"),
  "Il retarget Shape asset+invert+format non conserva latest-only e transazione GPU.");
assert(engine.includes('hardness: tool === "blend"')
  && engine.includes(': 1,')
  && definitionSource.includes("hardness: 1"),
  "Hardness deve essere normalizzata al 100% per Paint e Gomma.");

assert(shaders.includes("let followAngle = select(0.0, atan2(direction.y, direction.x)")
  && shaders.includes("@location(2) localBrushPixels: vec2<f32>")
  && shaders.includes("input.localBrushPixels * grain.inversePeriod + vec2<f32>(0.5)")
  && shaders.includes("return mix(movingUv, fixedUv, movement)")
  && !shaders.includes("if (movement <= 0.00001)"),
  "Shader generici Follow Stroke/Moving scalato mancanti.");
assert(brushLibraryController.includes("resolveBrushPresetSettings(PENCIL_BRUSH_PRESET")
  && main.includes("new BrushLibraryController({")
  && libraryPreview.includes("AuthoritativeBrushStrokePreviewRenderer")
  && libraryPreview.includes("await this.renderer.render(canvas, settings")
  && strokePreviewRenderer.includes("createShapeMaskResources(")
  && strokePreviewRenderer.includes("createGrainTextureResources("),
  "Selezione o preview autorevole Pencil non collegate alla libreria mobile.");
assert(!strokePreviewRenderer.includes('"m1m4-pencil-v1"')
  && !strokePreviewRenderer.includes("Shapepencil.png")
  && !strokePreviewRenderer.includes("Grainpencil.png"),
  "Il renderer preview deve restare generico e risolvere Pencil dal registry autorevole.");
assert(html.includes('data-mobile-brush-id="m1m4-pencil-v1"')
  && html.includes('data-mobile-brush-category-card="pencil"'),
  "Card Pencil mobile non registrata.");

console.log("Brush preset contract, asset registry e Pencil preset verificati.");
