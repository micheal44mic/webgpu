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

const deterministicPixels = (seed) => Uint8Array.from(
  { length: 240 * 56 * 4 },
  (_, index) => Math.floor(core.brushLibraryPreviewRandom(seed, index) * 256),
);
const pixelsA = deterministicPixels(0x1234abcd);
const pixelsB = deterministicPixels(0x1234abcd);
assert.deepEqual(pixelsA, pixelsB, "fixed integer seed must repeat every preview byte");
assert.equal(
  core.hashBrushLibraryPreviewPixels(pixelsA),
  core.hashBrushLibraryPreviewPixels(pixelsB),
  "repeated pixel buffers must have the same hash",
);

assert.doesNotMatch(coreSource, /Math\.random|Date\.now|performance\.now/);
assert.match(rendererSource, /BRUSH_LIBRARY_PREVIEW_MAX_CARDS = 2/);
assert.match(rendererSource, /BRUSH_LIBRARY_PREVIEW_MAX_ASSETS = 4/);
assert.match(rendererSource, /BRUSH_LIBRARY_PREVIEW_MAX_STEADY_BYTES/);
assert.match(rendererSource, /cached\.fingerprint === fingerprint/);
assert.match(rendererSource, /canvas\.dataset\.previewPixelHash = pixelHash/);
assert.match(rendererSource, /loadBrushStudioAsset\(storedKey\)/);
assert.doesNotMatch(
  rendererSource,
  /queue\.submit|copyTextureToBuffer|mapAsync|onSubmittedWorkDone|setBrushSettings/,
  "library previews must remain isolated from GPU and authoritative settings",
);
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
  /Promise\.all\(previewBrushIds\.map\(\(brushId\)[\s\S]*?mobileBrushLibraryCanvasForBrush\(brushId\)[\s\S]*?mobileBrushLibrarySettingsForBrush\(brushId, currentSettings\)/,
  "the reordered cards must reuse their existing canvases and settings records",
);

console.log(`Brush Library preview verification passed (${fingerprintA}).`);
