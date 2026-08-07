import assert from "node:assert/strict";

const transfer = await import("../src/brush-studio-transfer.ts");
const storage = await import("../src/brush-studio-storage.ts");
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

function persistedSettings(overrides = {}) {
  return {
    shape: "circle",
    shapeAssetId: "legacy-shape",
    shapeInvert: false,
    shapeRotation: "fixed",
    shapeScatter: 0,
    grainMode: "off",
    grainAssetId: "legacy-grain",
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
}

function storedAsset(kind, name, bytes = onePixelPng) {
  return {
    key: `fixture:${kind}`,
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
  const shapeBytes = manifest.assets.shape
    ? bytes.slice(offset, offset += manifest.assets.shape.bytes)
    : null;
  const grainBytes = manifest.assets.grain
    ? bytes.slice(offset, offset += manifest.assets.grain.bytes)
    : null;
  assert.equal(offset, bytes.byteLength, "portable payload layout mismatch");
  return { manifest, shapeBytes, grainBytes };
}

function packTransfer(manifest, shapeBytes, grainBytes) {
  const encodedManifest = encoder.encode(JSON.stringify(manifest));
  const header = new Uint8Array(fixedHeaderBytes);
  header.set(magic, 0);
  new DataView(header.buffer).setUint32(magic.byteLength, encodedManifest.byteLength, true);
  return new Blob([
    header,
    encodedManifest,
    ...(shapeBytes ? [shapeBytes] : []),
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
assert.equal(plain.shapeAsset, null);
assert.equal(plain.grainAsset, null);

const customSettings = persistedSettings({
  shape: "shape",
  shapeAssetId: "custom-shape:roundtrip",
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
assert.equal(custom.shapeAsset?.name, "cloud shape.png");
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

const customParts = await unpackTransfer(customBlob);
const wrongVersion = structuredClone(customParts.manifest);
wrongVersion.version = 2;
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    wrongVersion,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /unsupported version/,
);

const missingShape = structuredClone(customParts.manifest);
missingShape.assets.shape = null;
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
await assert.rejects(
  transfer.parseBrushStudioTransferBlob(packTransfer(
    unexpectedShape,
    customParts.shapeBytes,
    customParts.grainBytes,
  )),
  /Shape asset is missing or unexpected/,
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

const invalidLayout = structuredClone(customParts.manifest);
invalidLayout.assets.shape.bytes += 1;
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
invalidPng.assets.shape.bytes = notPng.byteLength;
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

const firstImportId = storage.createBrushStudioCustomBrushId("first-import");
const secondImportId = storage.createBrushStudioCustomBrushId("second-import");
assert.notEqual(
  transfer.createBrushStudioImportedAssetId(firstImportId, "shape"),
  transfer.createBrushStudioImportedAssetId(secondImportId, "shape"),
  "reimporting the same file must allocate a fresh Shape identity",
);
assert.notEqual(
  transfer.createBrushStudioImportedAssetId(firstImportId, "grain"),
  transfer.createBrushStudioImportedAssetId(secondImportId, "grain"),
  "reimporting the same file must allocate a fresh Grain identity",
);

console.log("Brush transfer verification passed.");
