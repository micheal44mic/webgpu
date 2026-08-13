import assert from "node:assert/strict";

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  },
};

const storage = await import("../src/brush-studio-storage.ts");
const catalogContract = await import("../src/brush-catalog.ts");
const libraryKey = "m1m4.brush-studio.library-state.v1";

values.set(libraryKey, JSON.stringify({ version: 1, activeBrushId: "current" }));
assert.deepEqual(
  storage.loadBrushStudioLibraryState(),
  { version: 2, activeBrushId: "current", customBrushes: [] },
  "the former two-slot state must migrate without losing the active brush",
);

const firstId = catalogContract.createBrushStudioCustomBrushId("first / brush");
const secondId = catalogContract.createBrushStudioCustomBrushId("second-brush");
assert.equal(firstId, "custom-brush:first-brush");
assert.equal(catalogContract.isBrushStudioCustomBrushId(firstId), true);
assert.equal(catalogContract.isBrushStudioCustomBrushId("current"), false);

const catalog = [
  { id: firstId, name: "  Soft   Cloud  ", createdAt: 10, updatedAt: 11 },
  { id: secondId, name: "Texture", createdAt: 20, updatedAt: 21 },
];
storage.saveBrushStudioLibraryState(secondId, catalog);
assert.deepEqual(
  storage.loadBrushStudioLibraryState(),
  {
    version: 2,
    activeBrushId: secondId,
    customBrushes: [
      { id: firstId, name: "Soft Cloud", createdAt: 10, updatedAt: 11 },
      { id: secondId, name: "Texture", createdAt: 20, updatedAt: 21 },
    ],
  },
  "custom card order, names and active identity must survive a cold reload",
);

assert.equal(catalogContract.nextBrushStudioCustomBrushName([]), "New Brush");
assert.equal(
  catalogContract.nextBrushStudioCustomBrushName([
    { name: "New Brush" },
    { name: "new brush 2" },
  ]),
  "New Brush 3",
);
assert.equal(
  catalogContract.uniqueBrushStudioCustomBrushName("Soft Cloud", [{ name: "soft cloud" }]),
  "Soft Cloud 2",
  "an imported brush must keep its name without overwriting an existing card",
);
assert.equal(
  catalogContract.uniqueBrushStudioCustomBrushName(
    "A".repeat(48),
    [{ name: "A".repeat(48) }],
  ).length,
  48,
  "an imported duplicate suffix must remain inside the catalog name limit",
);

const defaults = {
  tool: "blend",
  color: "#000000",
  hardness: 0.25,
  shape: "shape",
  shapeAssetId: "custom-shape:busy",
  shapeInvert: true,
  shapeRotation: "follow-stroke",
  shapeScatter: 0.8,
  grainMode: "moving",
  grainAssetId: "custom-grain:busy",
  grainScale: 3,
  grainMovement: 0.9,
  grainDepth: 0.4,
  grainBrightness: 0.2,
  grainContrast: 0.7,
  grainInvert: true,
  grainFiltering: "classic",
  grainBlendMode: "multiply",
  size: 200,
  spacingPercent: 25,
  stabilization: 0.7,
  startThickness: 0.2,
  endThickness: 0.4,
  count: 12,
  flow: 0.1,
  opacity: 0.3,
  blendIntensity: 0.2,
  blendMode: "intense-blending",
  blendStretch: 0.8,
  blendPaint: 0.9,
  blendBlur: 0.7,
  jitterMaster: 1,
  hueJitterDegrees: 30,
  saturationJitter: 0.5,
  lightnessJitter: 0.6,
  darknessJitter: 0.7,
  jitterPerCopy: true,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
};
const base = catalogContract.createBrushStudioBaseSettings(defaults, "#ff8844");
assert.deepEqual(
  {
    tool: base.tool,
    color: base.color,
    shape: base.shape,
    shapeAssetId: base.shapeAssetId,
    shapeInvert: base.shapeInvert,
    shapeRotation: base.shapeRotation,
    shapeScatter: base.shapeScatter,
    grainMode: base.grainMode,
    grainAssetId: base.grainAssetId,
    size: base.size,
    spacingPercent: base.spacingPercent,
    stabilization: base.stabilization,
    startThickness: base.startThickness,
    endThickness: base.endThickness,
    count: base.count,
    flow: base.flow,
    opacity: base.opacity,
    hardness: base.hardness,
    blendMode: base.blendMode,
    hueJitterDegrees: base.hueJitterDegrees,
    saturationJitter: base.saturationJitter,
    lightnessJitter: base.lightnessJitter,
    darknessJitter: base.darknessJitter,
    jitterPerCopy: base.jitterPerCopy,
    positionJitterLateral: base.positionJitterLateral,
    positionJitterLinear: base.positionJitterLinear,
  },
  {
    tool: "paint",
    color: "#ff8844",
    shape: "circle",
    shapeAssetId: "legacy-shape",
    shapeInvert: false,
    shapeRotation: "fixed",
    shapeScatter: 0,
    grainMode: "off",
    grainAssetId: "pencil-grain",
    size: 50,
    spacingPercent: 3,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendMode: "light-glaze",
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  },
  "a + draft must start from a neutral brush and preserve only the current color",
);
assert.notEqual(base, defaults, "a + draft must own a fresh settings object");

storage.saveBrushStudioSavedBrush(firstId, {
  version: 1,
  settings: {
    shape: "shape",
    shapeAssetId: "custom-shape:cloud",
    grainMode: "moving",
    grainAssetId: "custom-grain:paper",
  },
  shapeAssetKey: `${firstId}:shape:custom-shape:cloud`,
  grainAssetKey: `${firstId}:grain:custom-grain:paper`,
});
const restoredDefinition = storage.loadBrushStudioSavedBrush(firstId);
assert.equal(restoredDefinition?.version, 1);
assert.equal(restoredDefinition?.settings.shape, "shape");
assert.equal(restoredDefinition?.settings.shapeAssetId, "custom-shape:cloud");
assert.equal(restoredDefinition?.settings.grainMode, "moving");
assert.equal(restoredDefinition?.settings.grainAssetId, "custom-grain:paper");
assert.equal(restoredDefinition?.shapeAssetKey, `${firstId}:shape:custom-shape:cloud`);
assert.equal(restoredDefinition?.grainAssetKey, `${firstId}:grain:custom-grain:paper`);
assert.equal("color" in restoredDefinition.settings, false);
assert.equal("tool" in restoredDefinition.settings, false);
assert.equal(
  typeof restoredDefinition.settings.blendBlur,
  "number",
  "old partial definitions must migrate through the single normalized ABI",
);
storage.saveBrushStudioSavedBrush(firstId, {
  version: 1,
  settings: {
    shape: "circle",
    shapeAssetId: "legacy-shape",
    grainMode: "moving",
    grainAssetId: "legacy-grain",
  },
  shapeAssetKey: null,
  grainAssetKey: null,
});
assert.equal(
  storage.loadBrushStudioSavedBrush(firstId)?.settings.grainAssetId,
  "pencil-grain",
  "saved brushes must migrate the removed Cotton Fleece source",
);
storage.deleteBrushStudioSavedBrush(firstId);
assert.equal(
  storage.loadBrushStudioSavedBrush(firstId),
  null,
  "a failed first save must be able to remove its orphan settings record",
);

console.log("Brush catalog verification passed.");
