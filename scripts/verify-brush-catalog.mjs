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
const libraryKey = "m1m4.brush-studio.library-state.v1";

values.set(libraryKey, JSON.stringify({ version: 1, activeBrushId: "current" }));
assert.deepEqual(
  storage.loadBrushStudioLibraryState(),
  { version: 2, activeBrushId: "current", customBrushes: [] },
  "the former two-slot state must migrate without losing the active brush",
);

const firstId = storage.createBrushStudioCustomBrushId("first / brush");
const secondId = storage.createBrushStudioCustomBrushId("second-brush");
assert.equal(firstId, "custom-brush:first-brush");
assert.equal(storage.isBrushStudioCustomBrushId(firstId), true);
assert.equal(storage.isBrushStudioCustomBrushId("current"), false);

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

assert.equal(storage.nextBrushStudioCustomBrushName([]), "New Brush");
assert.equal(
  storage.nextBrushStudioCustomBrushName([
    { name: "New Brush" },
    { name: "new brush 2" },
  ]),
  "New Brush 3",
);

const defaults = {
  tool: "blend",
  color: "#000000",
  hardness: 0.25,
  shape: "circle",
  shapeAssetId: "legacy-shape",
  grainMode: "off",
  grainAssetId: "legacy-grain",
};
const base = storage.createBrushStudioBaseSettings(defaults, "#ff8844");
assert.deepEqual(
  base,
  {
    ...defaults,
    tool: "paint",
    color: "#ff8844",
    hardness: 1,
  },
  "a + draft must start from defaults and preserve only the current color",
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
assert.deepEqual(
  storage.loadBrushStudioSavedBrush(firstId),
  {
    version: 1,
    settings: {
      shape: "shape",
      shapeAssetId: "custom-shape:cloud",
      grainMode: "moving",
      grainAssetId: "custom-grain:paper",
    },
    shapeAssetKey: `${firstId}:shape:custom-shape:cloud`,
    grainAssetKey: `${firstId}:grain:custom-grain:paper`,
  },
  "Shape and Grain identities must remain attached to their custom brush",
);
storage.deleteBrushStudioSavedBrush(firstId);
assert.equal(
  storage.loadBrushStudioSavedBrush(firstId),
  null,
  "a failed first save must be able to remove its orphan settings record",
);

console.log("Brush catalog verification passed.");
