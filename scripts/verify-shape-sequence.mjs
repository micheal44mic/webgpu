import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const definitions = await import("../src/brush-definition.ts");
const preview = await import("../src/brush-library-preview-core.ts");
const memory = await import("../src/engine-memory-model.ts");
const sequenceCore = await import("../src/brush-shape-sequence-core.ts");

assert.equal(sequenceCore.MAX_BRUSH_SHAPE_SEQUENCE_LENGTH, 4);
assert.deepEqual(
  Array.from(
    { length: 8 },
    (_value, ordinal) => sequenceCore.shapeLayerForStamp("ordered", ordinal, 0xffffffff, 4),
  ),
  [0, 1, 2, 3, 0, 1, 2, 3],
  "ordered mode must cycle by stable base-stamp ordinal",
);
const randomSeeds = [0, 1, 2, 3, 0x12345678, 0xffffffff, 0x9e3779b1, 0xa511e9b3];
const randomLayers = randomSeeds.map((seed, ordinal) => (
  sequenceCore.shapeLayerForStamp("random", ordinal, seed, 4)
));
assert.deepEqual(
  randomLayers,
  [1, 0, 2, 3, 3, 0, 0, 0],
  "random mode must retain its fixed deterministic seed mapping",
);
assert.deepEqual(
  randomSeeds.map((seed, ordinal) => (
    sequenceCore.shapeLayerForStamp("random", ordinal, seed, 4)
  )),
  randomLayers,
  "random mode must be reproducible for the same seed stream",
);
assert.equal(sequenceCore.shapeLayerForStamp("random", 17, 0x12345678, 1), 0);

const {
  shapeSequenceMode: _legacyShapeSequenceMode,
  ...legacyDefaults
} = definitions.DEFAULT_BRUSH_DEFINITION_SETTINGS;
const legacy = definitions.normalizeBrushDefinitionSettings({
  ...legacyDefaults,
  shapeAssetId: "pencil-shape",
  shapeAssetIds: undefined,
}, { strict: true });
assert.deepEqual(legacy.shapeAssetIds, ["pencil-shape"]);
assert.equal(legacy.shapeSequenceMode, "ordered");
const randomDefinition = definitions.normalizeBrushDefinitionSettings({
  ...definitions.DEFAULT_BRUSH_DEFINITION_SETTINGS,
  shapeSequenceMode: "random",
}, { strict: true });
assert.equal(randomDefinition.shapeSequenceMode, "random");
assert.throws(
  () => definitions.normalizeBrushDefinitionSettings({
    ...definitions.DEFAULT_BRUSH_DEFINITION_SETTINGS,
    shapeSequenceMode: "shuffle",
  }, { strict: true }),
  /shapeSequenceMode/,
);
assert.throws(
  () => definitions.normalizeBrushDefinitionSettings({
    ...definitions.DEFAULT_BRUSH_DEFINITION_SETTINGS,
    shapeAssetIds: [
      "legacy-shape",
      "legacy-shape",
      "legacy-shape",
      "legacy-shape",
      "legacy-shape",
    ],
  }, { strict: true }),
  /shapeAssetIds/,
);

const scalarSettings = {
  ...definitions.DEFAULT_BRUSH_DEFINITION_SETTINGS,
  tool: "paint",
  color: "#ff805b803580",
  shape: "shape",
  shapeAssetId: "legacy-shape",
  shapeAssetIds: undefined,
};
const singletonSettings = { ...scalarSettings, shapeAssetIds: ["legacy-shape"] };
const orderedSettings = {
  ...scalarSettings,
  shapeAssetIds: ["legacy-shape", "pencil-shape"],
};
const reversedSettings = {
  ...scalarSettings,
  shapeAssetIds: ["pencil-shape", "legacy-shape"],
};
const randomSettings = {
  ...orderedSettings,
  shapeSequenceMode: "random",
};
assert.equal(
  preview.brushLibraryPreviewFingerprint("fixture", scalarSettings),
  preview.brushLibraryPreviewFingerprint("fixture", singletonSettings),
  "legacy scalar and explicit singleton previews must share one cache identity",
);
assert.notEqual(
  preview.brushLibraryPreviewFingerprint("fixture", orderedSettings),
  preview.brushLibraryPreviewFingerprint("fixture", reversedSettings),
  "preview cache identity must include Shape order",
);
assert.notEqual(
  preview.brushLibraryPreviewFingerprint("fixture", orderedSettings),
  preview.brushLibraryPreviewFingerprint("fixture", randomSettings),
  "preview cache identity must include Shape sequence mode",
);

const oneLayerMiB = memory.shapeTextureMemoryMiB("r16float", 1);
const fourLayerMiB = memory.shapeTextureMemoryMiB("r16float", 4);
assert.equal(oneLayerMiB, 11_184_810 / (1024 * 1024));
assert.equal(fourLayerMiB, 44_739_240 / (1024 * 1024));

const stampUpload = readFileSync(new URL("src/engine-stamp-upload.ts", root), "utf8");
const limits = readFileSync(new URL("src/engine-limits.ts", root), "utf8");
const shaders = readFileSync(new URL("src/shaders.ts", root), "utf8");
const blendShaders = readFileSync(new URL("src/blend-shaders.ts", root), "utf8");
const resources = readFileSync(new URL("src/engine-resource-setup.ts", root), "utf8");
const runtime = readFileSync(new URL("src/engine-runtime-misc.ts", root), "utf8");
const brushEngine = readFileSync(new URL("src/brush-engine.ts", root), "utf8");
const strokePreview = readFileSync(new URL("src/brush-stroke-preview-renderer.ts", root), "utf8");
const labs = readFileSync(new URL("src/labs/human-stroke-lab.ts", root), "utf8");
const labEntry = readFileSync(new URL("src/labs/editor-labs.ts", root), "utf8");
const labOperations = readFileSync(new URL("src/labs/engine-lab-operations.ts", root), "utf8");

assert.match(limits, /STAMP_STRIDE_BYTES = 32/);
assert.match(stampUpload, /uploadU32\[base \+ 5\][\s\S]*?stamp\.shapeLayer/);
assert.match(runtime, /shapeAssetSequenceLengthForSettings\(generationSettings\)/);
assert.match(
  runtime,
  /shapeLayer:\s*shapeLayerForStamp\(\s*generationSettings\.shapeSequenceMode,\s*stampOrdinal,\s*seed,\s*shapeLayerCount,/,
  "the authoritative stroke path must select Shape layers through the shared mode helper",
);
assert.match(
  brushEngine,
  /const stampOrdinal = Math\.max\(0, seedSequence - stroke\.seedSequenceBeforeStroke\);[\s\S]*?stamp\.shapeLayer = shapeLayerForStamp\(\s*settings\.shapeSequenceMode,\s*stampOrdinal,\s*seed,\s*shapeLayerCount,/,
  "the stabilization tail preview must use the same Shape sequence helper",
);
assert.match(
  strokePreview,
  /shapeLayer:\s*shapeLayerForStamp\(\s*settings\.shapeSequenceMode,\s*stampOrdinal,\s*seed,\s*shapeAssetIdsForSettings\(settings\)\.length,/,
  "the brush library preview must use the same Shape sequence helper",
);
assert.match(shaders, /shapeMaskTexture: texture_2d_array<f32>/);
assert.match(shaders, /@interpolate\(flat\) shapeLayer: u32/);
assert.match(shaders, /textureSample\(shapeMaskTexture, shapeMaskSampler, uv, i32\(input\.shapeLayer\)\)/);
assert.match(blendShaders, /shapeTexture: texture_2d_array<f32>/);
assert.match(blendShaders, /i32\(blend\.slots\.w\)/);
assert.match(resources, /depthOrArrayLayers: sources\.length/);
assert.match(resources, /dimension: "2d-array"/);
assert.match(resources, /occupancyWords\[index\] \|= sourceWords\[index\]/);
assert.match(labs, /runShapeSequenceComparison\(\)/);
assert.match(labs, /HUMAN_SHAPE_SEQUENCE_SUITE_REVISION = 2/);
assert.match(labs, /canonical-human-stroke-r16f-count-one-shape-sequence-v2/);
assert.match(labs, /count: 1/);
assert.match(labs, /four-layer-control/);
assert.match(labs, /four-layer-sequence/);
assert.match(labs, /four-layer-random/);
assert.match(labs, /shapeSequenceMode: testCase\.shapeSequenceMode/);
assert.match(labs, /captureOutputWitness: true/);
assert.match(labs, /singleWitness\.pixelHash !== controlWitness\.pixelHash/);
assert.match(labs, /controlWitness\.pixelHash === orderedWitness\.pixelHash/);
assert.match(labs, /controlWitness\.pixelHash === randomWitness\.pixelHash/);
assert.match(labs, /orderedWitness\.pixelHash === randomWitness\.pixelHash/);
assert.match(labs, /witness\.nonTransparentPixels === 0/);
assert.match(labEntry, /report\.allRunsSaved !== false/);
assert.match(
  labOperations,
  /shapeLayer:\s*shapeLayerForStamp\(\s*settings\.shapeSequenceMode,\s*index,\s*seed,\s*shapeLayerCount,/,
  "synthetic benchmark stamps must honor the selected Shape sequence mode",
);
assert.match(labEntry, /"human-shape-sequence"/);
assert.match(labEntry, /Confronto Shape ordinata\/casuale · Count 1/);

console.log("Ordered/random Shape sequence ABI, memory, preview and human-stroke comparison verified.");
