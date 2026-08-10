import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const coreSource = readFileSync(new URL("src/brush-library-preview-core.ts", root), "utf8");
const rendererSource = readFileSync(new URL("src/brush-library-preview.ts", root), "utf8");
const mainSource = readFileSync(new URL("src/main.ts", root), "utf8");

const core = await import(new URL("src/brush-library-preview-core.ts", root));

const settings = {
  tool: "paint",
  shape: "shape",
  shapeAssetId: "pencil-shape",
  shapeInvert: false,
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

const fingerprintA = core.brushLibraryPreviewFingerprint("m1m4-pencil-v1", settings);
const fingerprintB = core.brushLibraryPreviewFingerprint(
  "m1m4-pencil-v1",
  structuredClone(settings),
);
assert.equal(fingerprintA, fingerprintB, "same brush/settings must repeat its fingerprint");
assert.equal(
  core.brushLibraryPreviewFingerprint("m1m4-pencil-v1", { ...settings, color: "#00ff00" }),
  fingerprintA,
  "neutral library preview must not invalidate for artist color",
);
assert.notEqual(
  core.brushLibraryPreviewFingerprint("m1m4-pencil-v1", { ...settings, size: 31 }),
  fingerprintA,
  "a visual setting must invalidate the preview",
);
assert.notEqual(
  core.brushLibraryPreviewFingerprint("m1m4-pencil-v1", {
    ...settings,
    grainAssetId: "legacy-grain",
  }),
  fingerprintA,
  "asset identity must invalidate the preview",
);
for (const [field, value] of [
  ["blendMode", "uniformed-glaze"],
  ["grainDepth", 0.5],
  ["grainFiltering", "classic"],
  ["stabilization", 0.4],
  ["hueJitterDegrees", 12],
  ["positionJitterLateral", 0.2],
]) {
  assert.notEqual(
    core.brushLibraryPreviewFingerprint("m1m4-pencil-v1", {
      ...settings,
      [field]: value,
    }),
    fingerprintA,
    `authoritative visual setting ${field} must invalidate the preview`,
  );
}

assert.doesNotMatch(coreSource, /Math\.random|Date\.now|performance\.now/);
assert.match(coreSource, /BRUSH_LIBRARY_PREVIEW_RENDERER_VERSION = "authoritative-webgpu-v1"/);
assert.doesNotMatch(coreSource, /fixed-path-canvas2d/);
assert.match(rendererSource, /BRUSH_LIBRARY_PREVIEW_MAX_CARDS = 10/);
assert.match(rendererSource, /BRUSH_LIBRARY_PREVIEW_MAX_ASSETS = 0/);
assert.match(rendererSource, /BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES/);
assert.match(rendererSource, /cached\.fingerprint === fingerprint/);
assert.match(rendererSource, /hasCompletePreview\(/);
assert.match(rendererSource, /canvas\.dataset\.previewPixelHash = pixelHash/);
assert.match(rendererSource, /private readonly renderer: AuthoritativeBrushStrokePreviewRenderer/);
assert.match(rendererSource, /await this\.renderer\.render\(canvas, settings, \{/);
assert.match(rendererSource, /this\.renderer\.cacheIdentity/);
assert.match(rendererSource, /color: BRUSH_LIBRARY_PREVIEW_NEUTRAL_COLOR/);
assert.match(rendererSource, /computePixelHash: true/);
assert.doesNotMatch(
  rendererSource,
  /getContext\(|drawImage\(|getImageData\(|putImageData\(|drawFixedStroke|loadBrushStudioAsset|createImageBitmap|setBrushSettings/,
  "library cards must delegate rendering instead of owning Canvas2D brush math or settings",
);
assert.match(rendererSource, /canvas\.dataset\.previewRenderer = "authoritative-webgpu"/);
assert.doesNotMatch(
  mainSource.slice(mainSource.indexOf("onStats(stats)"), mainSource.indexOf("onHistoryChange")),
  /markMobileBrushLibraryPreviewDirty/,
  "stats/frame updates must not invalidate the library cache",
);
assert.match(
  mainSource,
  /function mobileCurrentBrushFallback[\s\S]*?\.\.\.defaultBrushSettings/,
  "the mutable legacy slot must not inherit Pencil as its fallback",
);
assert.match(
  mainSource,
  /function mobileBrushLibraryVisibleBrushIds\(\)[\s\S]*?const visible = \[activeMobileBrushLibraryBrushId\][\s\S]*?brushId !== activeMobileBrushLibraryBrushId[\s\S]*?visible\.push\(brushId\)/,
  "the active brush must be the first preview in every category without duplication",
);
assert.match(
  mainSource,
  /mobileBrushLibraryBrushes\.getBoundingClientRect\(\)[\s\S]*?bounds\.bottom >= viewport\.top[\s\S]*?bounds\.top <= viewport\.bottom/,
  "cold-open must hydrate only cards in or near the scroll viewport",
);
assert.match(
  mainSource,
  /mobileBrushLibraryBrushes\.addEventListener\("scroll"[\s\S]*?markMobileBrushLibraryPreviewDirty\(\)/,
  "newly visible cards must render after scrolling stops",
);
assert.match(
  mainSource,
  /for \(const brushId of previewBrushIds\)[\s\S]*?await mobileBrushLibrarySettingsForBrush\([\s\S]*?await mobileBrushLibraryPreviewRenderer\.render\([\s\S]*?releasePreviewAssets\(brushId, settings\)/,
  "cards must hydrate serially and release nonactive custom assets after rendering",
);
assert.match(
  mainSource,
  /await mobileBrushLibrarySettingsForBrush\([\s\S]*?!mobileBrushLibraryOpen[\s\S]*?revision !== mobileBrushLibraryPreviewRevision[\s\S]*?return/,
  "closing or changing category must cancel late preview work",
);
assert.match(
  mainSource,
  /settingsSnapshot\(brushId, fallbackSettings\)[\s\S]*?hasCompletePreview\([\s\S]*?return snapshot/,
  "completed card bitmaps must not rehydrate full-resolution assets",
);

console.log(`Brush Library preview verification passed (${fingerprintA}).`);
