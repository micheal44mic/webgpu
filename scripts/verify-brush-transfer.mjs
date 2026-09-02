import assert from "node:assert/strict";

const transfer = await import("../src/brush-studio-transfer.ts");
const storage = await import("../src/brush-studio-storage.ts");
const catalog = await import("../src/brush-catalog.ts");
const pngMask = await import("../src/png-mask.ts");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const magic = encoder.encode(transfer.BRUSH_STUDIO_TRANSFER_MAGIC);
const fixedHeaderBytes = magic.byteLength + 4;
const onePixelPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));
const threeToneMaskPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAAAAAA+i0toAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC",
  "base64",
));
const native16MaskPng = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAAAAABuG5crAAAAD0lEQVR4nGNgYGBkbGAAAAEOAIPpuZi8AAAAAElFTkSuQmCC",
  "base64",
));

const decodedThreeToneMask = await pngMask.decodeGrayscalePng8(
  threeToneMaskPng.slice().buffer,
);
assert.deepEqual(
  decodedThreeToneMask,
  {
    width: 3,
    height: 1,
    pixels: Uint8Array.of(0, 128, 255),
  },
  "the portable regression fixture must contain exact 0/128/255 mask samples",
);
const decodedNative16Mask = await pngMask.decodeGrayscalePng(native16MaskPng.slice().buffer);
assert.equal(decodedNative16Mask.sourceBitDepth, 16);
assert.deepEqual([...decodedNative16Mask.pixels], [0, 257, 32768]);

function persistedSettings(overrides = {}) {
  const settings = {
    shape: "circle",
    tipFalloff: "standard",
    shapeAssetId: "legacy-shape",
    shapeAssetIds: ["legacy-shape"],
    shapeSequenceMode: "ordered",
    shapeInvert: false,
    shapeMaskFormat: "r8unorm",
    shapeRotation: "fixed",
    shapeScatter: 0,
    grainMode: "off",
    grainAssetId: "pencil-grain",
    grainScale: 1.4,
    grainMovement: 0,
    grainDepth: 1,
    grainBrightness: 0,
    grainContrast: 0,
    grainInvert: false,
    grainFiltering: "improved",
    grainBlendMode: "multiply",
    count: 1,
    flow: 1,
    size: 50,
    spacingPercent: 3,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "light-glaze",
    blendStretch: 0.18,
    blendPaint: 0.14,
    blendBlur: 0,
    jitterMaster: 1,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
    ...overrides,
  };
  if ("shapeAssetId" in overrides && !("shapeAssetIds" in overrides)) {
    settings.shapeAssetIds = [overrides.shapeAssetId];
  }
  return settings;
}

function storedAsset(kind, name, bytes = onePixelPng, key = `fixture:${kind}`) {
  return {
    key,
    kind,
    name,
    mimeType: "image/png",
    blob: new Blob([bytes], { type: "image/png" }),
    updatedAt: 1,
  };
}

async function unpackTransfer(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(bytes.slice(0, magic.byteLength), magic, "portable magic mismatch");
  const manifestBytes = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(magic.byteLength, true);
  const manifestEnd = fixedHeaderBytes + manifestBytes;
  const manifest = JSON.parse(decoder.decode(bytes.slice(fixedHeaderBytes, manifestEnd)));
  let offset = manifestEnd;
  const shapeManifests = manifest.version === 1
    ? (manifest.assets.shape ? [manifest.assets.shape] : [])
    : manifest.assets.shapes;
  const shapePayloads = shapeManifests.map(
    (shapeManifest) => bytes.slice(offset, offset += shapeManifest.bytes),
  );
  const grainBytes = manifest.assets.grain
    ? bytes.slice(offset, offset += manifest.assets.grain.bytes)
    : null;
  assert.equal(offset, bytes.byteLength, "portable payload layout mismatch");
  return {
    manifest,
    shapeBytes: shapePayloads[0] ?? null,
    shapePayloads,
    grainBytes,
  };
}

function packTransfer(manifest, shapeBytes, grainBytes) {
  const shapePayloads = Array.isArray(shapeBytes)
    ? shapeBytes
    : (shapeBytes ? [shapeBytes] : []);
  const encodedManifest = encoder.encode(JSON.stringify(manifest));
  const header = new Uint8Array(fixedHeaderBytes);
  header.set(magic, 0);
  new DataView(header.buffer).setUint32(magic.byteLength, encodedManifest.byteLength, true);
  return new Blob([
    header,
    encodedManifest,
    ...shapePayloads,
    ...(grainBytes ? [grainBytes] : []),
  ], { type: transfer.BRUSH_STUDIO_TRANSFER_MIME_TYPE });
}

const plainBlob = await transfer.createBrushStudioTransferBlob({
  name: "  Base   Brush  ",
  savedBrush: {
    version: 1,
    settings: persistedSettings(),
    shapeAssetKey: null,
    grainAssetKey: null,
  },
  shapeAsset: null,
  grainAsset: null,
});
const plain = await transfer.parseBrushStudioTransferBlob(plainBlob);
assert.equal(plain.name, "Base Brush");
assert.deepEqual(plain.settings, persistedSettings());
assert.deepEqual(plain.shapeAssets, []);
assert.equal(plain.shapeAsset, null);
assert.equal(plain.grainAsset, null);
const plainParts = await unpackTransfer(plainBlob);
assert.equal(plainParts.manifest.version, 2);
assert.deepEqual(plainParts.manifest.assets.shapes, []);

const maximumSpacingBlob = await transfer.createBrushStudioTransferBlob({
  name: "Maximum Spacing",
  savedBrush: {
    version: 1,
    settings: persistedSettings({ spacingPercent: 99 }),
    shapeAssetKey: null,
    grainAssetKey: null,
  },
  shapeAsset: null,
  grainAsset: null,
});
const maximumSpacing = await transfer.parseBrushStudioTransferBlob(maximumSpacingBlob);
assert.equal(maximumSpacing.settings.spacingPercent, 99);

const legacyPlainParts = await unpackTransfer(plainBlob);
legacyPlainParts.manifest.version = 1;
legacyPlainParts.manifest.assets = {
  shape: null,
  grain: legacyPlainParts.manifest.assets.grain,
};
delete legacyPlainParts.manifest.settings.blendBlur;
delete legacyPlainParts.manifest.settings.tipFalloff;
delete legacyPlainParts.manifest.settings.shapeMaskFormat;
delete legacyPlainParts.manifest.settings.shapeAssetIds;
delete legacyPlainParts.manifest.settings.shapeSequenceMode;
legacyPlainParts.manifest.settings.grainAssetId = "legacy-grain";
const legacyPlain = await transfer.parseBrushStudioTransferBlob(packTransfer(
  legacyPlainParts.manifest,
  null,
  null,
));
assert.equal(
  legacyPlain.settings.blendBlur,
  0,
  "version 1 brushes authored before Blend Blur must import with the inert default",
);
assert.equal(
  legacyPlain.settings.grainAssetId,
  "pencil-grain",
  "brushes referencing the removed Cotton Fleece source must migrate to Pencil Grain",
);
assert.equal(
  legacyPlain.settings.shapeMaskFormat,
  "r16float",
  "legacy brushes without a precision field must migrate to the native R16F path",
);

const customSettings = persistedSettings({
  shape: "shape",
  shapeAssetId: "custom-shape:roundtrip",
  shapeMaskFormat: "r16float",
  grainMode: "off",
  grainAssetId: "custom-grain:roundtrip",
});
const shapeAsset = storedAsset("shape", "cloud shape.png", threeToneMaskPng);
const grainAsset = storedAsset("grain", "paper grain.png", threeToneMaskPng);
const customBlob = await transfer.createBrushStudioTransferBlob({
  name: "Cloud Paper",
  savedBrush: {
    version: 1,
    settings: customSettings,
    shapeAssetKey: shapeAsset.key,
    grainAssetKey: grainAsset.key,
  },
  shapeAsset,
  grainAsset,
});
const custom = await transfer.parseBrushStudioTransferBlob(customBlob);
assert.equal(custom.name, "Cloud Paper");
assert.deepEqual(custom.settings, customSettings);
assert.equal(
  custom.settings.shapeMaskFormat,
  "r16float",
  "16-bit Float precision must survive a portable brush round trip",
);
assert.equal(custom.shapeAsset?.name, "cloud shape.png");
assert.equal(custom.shapeAssets.length, 1);
assert.equal(custom.shapeAssets[0].assetId, "custom-shape:roundtrip");
assert.equal(custom.grainAsset?.name, "paper grain.png");
assert.deepEqual(
  new Uint8Array(await custom.shapeAsset.blob.arrayBuffer()),
  threeToneMaskPng,
  "Shape mask samples 0/128/255 must survive a portable round trip byte-exactly",
);
assert.deepEqual(
  new Uint8Array(await custom.grainAsset.blob.arrayBuffer()),
  threeToneMaskPng,
  "dormant Grain samples 0/128/255 must remain embedded and byte-exact",
);

const firstSequenceShapeId = "custom-shape:sequence-first";
const secondSequenceShapeId = "custom-shape:sequence-second";
const firstSequenceShape = storedAsset(
  "shape",
  "sequence first.png",
  threeToneMaskPng,
  "fixture:shape:sequence-first",
);
const secondSequenceShape = storedAsset(
  "shape",
  "sequence second.png",
  onePixelPng,
  "fixture:shape:sequence-second",
);
const sequenceSettings = persistedSettings({
  shape: "shape",
  shapeAssetId: firstSequenceShapeId,
  shapeAssetIds: [
    firstSequenceShapeId,
    "pencil-shape",
    secondSequenceShapeId,
    firstSequenceShapeId,
  ],
  shapeSequenceMode: "random",
});
const sequenceBlob = await transfer.createBrushStudioTransferBlob({
  name: "Shape Sequence",
  savedBrush: {
    version: 1,
    settings: sequenceSettings,
    shapeAssetKey: firstSequenceShape.key,
    shapeAssetRefs: [
      { assetId: firstSequenceShapeId, storageKey: firstSequenceShape.key },
      { assetId: secondSequenceShapeId, storageKey: secondSequenceShape.key },
    ],
    grainAssetKey: null,
  },
  shapeAssets: [
    { assetId: secondSequenceShapeId, asset: secondSequenceShape },
    { assetId: firstSequenceShapeId, asset: firstSequenceShape },
  ],
  grainAsset: null,
});
const sequenceParts = await unpackTransfer(sequenceBlob);
assert.deepEqual(
  sequenceParts.manifest.assets.shapes.map((asset) => asset.assetId),
  [firstSequenceShapeId, secondSequenceShapeId],
  "v2 must encode each unique custom Shape in first-use order",
);
const sequenceRoundTrip = await transfer.parseBrushStudioTransferBlob(sequenceBlob);
assert.deepEqual(sequenceRoundTrip.settings, sequenceSettings);
assert.equal(sequenceRoundTrip.settings.shapeSequenceMode, "random");
assert.equal(sequenceRoundTrip.shapeAsset, null);
assert.deepEqual(
  sequenceRoundTrip.shapeAssets.map((asset) => asset.assetId),
  [firstSequenceShapeId, secondSequenceShapeId],
);
assert.deepEqual(
  new Uint8Array(await sequenceRoundTrip.shapeAssets[0].blob.arrayBuffer()),
  threeToneMaskPng,
);
assert.deepEqual(
  new Uint8Array(await sequenceRoundTrip.shapeAssets[1].blob.arrayBuffer()),
  onePixelPng,
);

const native16Settings = persistedSettings({
  shape: "shape",
  shapeAssetId: "custom-shape:native16-roundtrip",
  shapeMaskFormat: "r16float",
  grainMode: "moving",
  grainAssetId: "custom-grain:native16-roundtrip",
});
const native16ShapeAsset = storedAsset("shape", "native shape.png", native16MaskPng);
const native16GrainAsset = storedAsset("grain", "native grain.png", native16MaskPng);
const native16Blob = await transfer.createBrushStudioTransferBlob({
  name: "Native Precision",
  savedBrush: {
    version: 1,
    settings: native16Settings,
    shapeAssetKey: native16ShapeAsset.key,
    grainAssetKey: native16GrainAsset.key,
  },
  shapeAsset: native16ShapeAsset,
  grainAsset: native16GrainAsset,
});
const native16RoundTrip = await transfer.parseBrushStudioTransferBlob(native16Blob);
assert.deepEqual(
  new Uint8Array(await native16RoundTrip.shapeAsset.blob.arrayBuffer()),
  native16MaskPng,
  "native 16-bit Shape PNG must survive storage/transfer byte-exactly",
);
assert.deepEqual(
  new Uint8Array(await native16RoundTrip.grainAsset.blob.arrayBuffer()),
  native16MaskPng,
  "native 16-bit Grain PNG must survive storage/transfer byte-exactly",
);
assert.equal(
  (await pngMask.decodeGrayscalePng(await native16RoundTrip.shapeAsset.blob.arrayBuffer()))
    .sourceBitDepth,
  16,
);

const customParts = await unpackTransfer(customBlob);
const legacyCustomManifest = structuredClone(customParts.manifest);
legacyCustomManifest.version = 1;
delete legacyCustomManifest.settings.shapeAssetIds;
delete legacyCustomManifest.settings.shapeSequenceMode;
const legacyCustomShapeManifest = { ...legacyCustomManifest.assets.shapes[0] };
delete legacyCustomShapeManifest.assetId;
legacyCustomManifest.assets = {
  shape: legacyCustomShapeManifest,
  grain: legacyCustomManifest.assets.grain,
};
const legacyCustom = await transfer.parseBrushStudioTransferBlob(packTransfer(
  legacyCustomManifest,
  customParts.shapeBytes,
  customParts.grainBytes,
));
assert.deepEqual(legacyCustom.settings, customSettings);
assert.equal(legacyCustom.shapeAssets[0].assetId, customSettings.shapeAssetId);
assert.deepEqual(
  new Uint8Array(await legacyCustom.shapeAssets[0].blob.arrayBuffer()),
  threeToneMaskPng,
  "v1 single-Shape files must remain readable byte-exactly",
);

const wrongVersion = structuredClone(customParts.manifest);
wrongVersion.version = 99;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    wrongVersion,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /unsupported version/,
);

const missingShape = structuredClone(customParts.manifest);
missingShape.assets.shapes = [];
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    missingShape,
    null,
    customParts.grainBytes,
  )),
  /Shape asset is missing or unexpected/,
);

const unexpectedShape = structuredClone(customParts.manifest);
unexpectedShape.settings.shapeAssetId = "legacy-shape";
unexpectedShape.settings.shapeAssetIds = ["legacy-shape"];
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    unexpectedShape,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /Shape asset is missing or unexpected/,
);

const missingSequenceShape = structuredClone(sequenceParts.manifest);
missingSequenceShape.assets.shapes = missingSequenceShape.assets.shapes.slice(0, 1);
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    missingSequenceShape,
    sequenceParts.shapePayloads.slice(0, 1),
    null,
  )),
  /Shape asset is missing or unexpected/,
  "v2 must reject an omitted custom Shape payload",
);

const duplicateSequenceShape = structuredClone(sequenceParts.manifest);
duplicateSequenceShape.assets.shapes[1].assetId = firstSequenceShapeId;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    duplicateSequenceShape,
    sequenceParts.shapePayloads,
    null,
  )),
  /Shape asset is missing or unexpected/,
  "v2 must reject duplicate custom Shape asset IDs",
);

const unexpectedSequenceShape = structuredClone(sequenceParts.manifest);
unexpectedSequenceShape.assets.shapes[1].assetId = "custom-shape:unexpected";
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    unexpectedSequenceShape,
    sequenceParts.shapePayloads,
    null,
  )),
  /Shape asset is missing or unexpected/,
  "v2 must reject a payload that does not match the authored Shape sequence",
);

const unsupportedLegacySequence = structuredClone(sequenceParts.manifest);
unsupportedLegacySequence.version = 1;
const unsupportedLegacyShape = { ...unsupportedLegacySequence.assets.shapes[0] };
delete unsupportedLegacyShape.assetId;
unsupportedLegacySequence.assets = { shape: unsupportedLegacyShape, grain: null };
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    unsupportedLegacySequence,
    sequenceParts.shapePayloads[0],
    null,
  )),
  /version 1 supports one custom Shape source/,
  "v1 cannot represent a multi-Shape custom source set",
);

const invalidCount = structuredClone(customParts.manifest);
invalidCount.settings.count = 25;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidCount,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /settings\.count/,
);

const invalidSpacing = structuredClone(customParts.manifest);
invalidSpacing.settings.spacingPercent = 99.25;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidSpacing,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /settings\.spacingPercent/,
);

const invalidBoolean = structuredClone(customParts.manifest);
invalidBoolean.settings.jitterPerCopy = "yes";
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidBoolean,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /settings\.jitterPerCopy/,
);

const invalidShapeMaskFormat = structuredClone(customParts.manifest);
invalidShapeMaskFormat.settings.shapeMaskFormat = "rgba16float";
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidShapeMaskFormat,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /settings\.shapeMaskFormat/,
);

const invalidShapeSequenceMode = structuredClone(customParts.manifest);
invalidShapeSequenceMode.settings.shapeSequenceMode = "shuffle";
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidShapeSequenceMode,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /settings\.shapeSequenceMode/,
);

const invalidLayout = structuredClone(customParts.manifest);
invalidLayout.assets.shapes[0].bytes += 1;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidLayout,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /asset layout/,
);

const notPng = Uint8Array.from(Buffer.from("not a png", "utf8"));
const invalidPng = structuredClone(customParts.manifest);
invalidPng.assets.shapes[0].bytes = notPng.byteLength;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    invalidPng,
    notPng,
    customParts.grainBytes,
  )),
  /normalized PNG/,
);

const oversizedHeader = Uint8Array.from(threeToneMaskPng);
oversizedHeader[16] = 0;
oversizedHeader[17] = 0;
oversizedHeader[18] = 8;
oversizedHeader[19] = 1;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    customParts.manifest,
    oversizedHeader,
    customParts.grainBytes,
  )),
  /at most 2048 px/,
);

await assert.rejects(
  transfer.createBrushStudioTransferBlob({
    name: "Broken",
    savedBrush: {
      version: 1,
      settings: customSettings,
      shapeAssetKey: shapeAsset.key,
      grainAssetKey: grainAsset.key,
    },
    shapeAsset: null,
    grainAsset,
  }),
  /saved asset is unavailable/,
  "Export must never silently omit a referenced custom asset",
);
await assert.rejects(
  transfer.parseBrushStudioTransferBlob({
    size: transfer.BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES + 1,
  }),
  /smaller than 42 MB/,
);
assert.equal(
  transfer.brushStudioTransferFileName(' Cloud:Paper? '),
  "Cloud-Paper-.m1m4brush",
);

const firstImportId = catalog.createBrushStudioCustomBrushId("first-import");
const secondImportId = catalog.createBrushStudioCustomBrushId("second-import");
assert.notEqual(
  transfer.createBrushStudioImportedAssetId(firstImportId, "shape"),
  transfer.createBrushStudioImportedAssetId(secondImportId, "shape"),
  "reimporting the same file must allocate a fresh Shape identity",
);
assert.notEqual(
  transfer.createBrushStudioImportedAssetId(firstImportId, "shape", 0),
  transfer.createBrushStudioImportedAssetId(firstImportId, "shape", 1),
  "each custom Shape in one import must receive a distinct identity",
);
assert.notEqual(
  transfer.createBrushStudioImportedAssetId(firstImportId, "grain"),
  transfer.createBrushStudioImportedAssetId(secondImportId, "grain"),
  "reimporting the same file must allocate a fresh Grain identity",
);

console.log("Brush transfer verification passed.");
