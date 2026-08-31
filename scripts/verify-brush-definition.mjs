import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const definitions = await import("../src/brush-definition.ts");
const catalog = await import("../src/brush-catalog.ts");
const builtins = await import("../src/brush-builtin-assets.ts");

const defaults = definitions.DEFAULT_BRUSH_DEFINITION_SETTINGS;
assert.equal(definitions.BRUSH_DEFINITION_VERSION, 1);
assert.equal("color" in defaults, false, "active color must not be persisted in a brush");
assert.equal("tool" in defaults, false, "active tool must not be persisted in a brush");
assert.equal(defaults.shapeMaskFormat, "r16float", "new brushes must default to native 16F masks");

const migrated = definitions.normalizeBrushDefinition({
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
assert.equal(migrated.settings.grainAssetId, "pencil-grain");
assert.equal(migrated.settings.blendBlur, 0);
assert.equal(
  migrated.settings.shapeMaskFormat,
  "r16float",
  "brush definitions saved before mask precision existed must migrate to native 16F",
);
assert.equal(Object.keys(migrated.settings).length, Object.keys(defaults).length);

const multiShapeDefinition = definitions.normalizeBrushDefinition({
  version: 1,
  settings: {
    ...defaults,
    shape: "shape",
    shapeAssetId: "custom-shape:a",
    shapeAssetIds: ["custom-shape:a", "custom-shape:b", "custom-shape:a"],
  },
  shapeAssetKey: "brush:shape:custom-shape:a",
  shapeAssetRefs: [
    { assetId: "custom-shape:a", storageKey: "brush:shape:custom-shape:a" },
    { assetId: "custom-shape:b", storageKey: "brush:shape:custom-shape:b" },
  ],
  grainAssetKey: null,
}, { strict: true });
assert.deepEqual(multiShapeDefinition.shapeAssetRefs, [
  { assetId: "custom-shape:a", storageKey: "brush:shape:custom-shape:a" },
  { assetId: "custom-shape:b", storageKey: "brush:shape:custom-shape:b" },
]);
assert.throws(
  () => definitions.normalizeBrushDefinition({
    ...multiShapeDefinition,
    shapeAssetRefs: [
      { assetId: "custom-shape:a", storageKey: "one" },
      { assetId: "custom-shape:a", storageKey: "two" },
    ],
  }, { strict: true }),
  /shapeAssetRefs/,
);

const { shapeMaskFormat: _legacyShapeMaskFormat, ...legacyStrictSettings } = defaults;
assert.equal(
  definitions.normalizeBrushDefinitionSettings(legacyStrictSettings, { strict: true })
    .shapeMaskFormat,
  "r16float",
  "strict portable ingress must upgrade version 1 brushes without mask precision",
);
assert.equal(
  definitions.normalizeBrushDefinitionSettings(
    { ...defaults, shapeMaskFormat: "r16float" },
    { strict: true },
  ).shapeMaskFormat,
  "r16float",
  "16-bit Float must survive strict definition normalization",
);
assert.throws(
  () => definitions.normalizeBrushDefinitionSettings(
    { ...defaults, shapeMaskFormat: "rgba16float" },
    { strict: true },
  ),
  /shapeMaskFormat/,
  "unknown mask formats must not enter durable brush definitions",
);

assert.throws(
  () => definitions.normalizeBrushDefinition({ version: 99, settings: defaults }),
  /version/,
);
assert.throws(
  () => definitions.normalizeBrushDefinitionSettings(
    { ...defaults, color: "#ffffff" },
    { strict: true },
  ),
  /color\/tool/,
);
assert.throws(
  () => definitions.normalizeBrushDefinitionSettings(
    { ...defaults, spacingPercent: 100 },
    { strict: true },
  ),
  /spacingPercent/,
);

const session = {
  ...defaults,
  tool: "blend",
  color: "#123456",
};
const applied = definitions.applyBrushDefinition(catalog.PENCIL_BRUSH_PRESET.definition, session);
assert.equal(applied.tool, "blend");
assert.equal(applied.color, "#123456");
assert.equal(applied.shapeAssetId, "pencil-shape");

assert.deepEqual(
  Object.keys(builtins.BUILTIN_BRUSH_ASSETS).sort(),
  ["legacy-shape", "pencil-grain", "pencil-shape"],
);
for (const descriptor of Object.values(builtins.BUILTIN_BRUSH_ASSETS)) {
  assert(descriptor.url instanceof URL);
  assert.equal(descriptor.url.protocol, "file:");
}

const root = new URL("../", import.meta.url);
const studioSource = readFileSync(new URL("src/mobile-brush-studio.ts", root), "utf8");
const engineAssetSource = readFileSync(new URL("src/engine-brush-assets.ts", root), "utf8");
const storageSource = readFileSync(new URL("src/brush-studio-storage.ts", root), "utf8");
const transferSource = readFileSync(new URL("src/brush-studio-transfer.ts", root), "utf8");
assert.match(studioSource, /builtinBrushAssetUrl\(assetId\)/);
assert.match(engineAssetSource, /builtinShapeAsset\(id\)/);
assert.match(storageSource, /normalizeBrushDefinition\(saved\)/);
assert.match(transferSource, /normalizeBrushDefinitionSettings\(value, \{ strict \}\)/);
assert.doesNotMatch(studioSource, /new URL\("\.\.\/(?:Shape|Shapepencil|Grainpencil)\.png"/);

console.log("Brush definition: versioning, migration, session state and asset ownership verified.");
