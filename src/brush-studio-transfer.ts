import {
  isCustomGrainAssetId,
  isCustomShapeAssetId,
} from "./brush-asset-registry.ts";
import {
  BRUSH_SOURCE_MAX_DIMENSION,
  brushSourceDimensionsFromBytes,
} from "./brush-source-image.ts";
import {
  BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX,
  normalizeBrushStudioCustomBrushName,
  BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH,
  type BrushStudioAssetKind,
  type BrushStudioCustomBrushId,
  type BrushStudioPersistedSettings,
  type BrushStudioSavedBrush,
  type BrushStudioStoredAsset,
} from "./brush-studio-storage.ts";
import type {
  CustomBrushGrainAssetId,
  CustomBrushShapeAssetId,
} from "./engine-types.ts";

export const BRUSH_STUDIO_TRANSFER_FORMAT = "m1m4-brush";
export const BRUSH_STUDIO_TRANSFER_VERSION = 1;
export const BRUSH_STUDIO_TRANSFER_EXTENSION = ".m1m4brush";
export const BRUSH_STUDIO_TRANSFER_MIME_TYPE = "application/vnd.m1m4.brush";
export const BRUSH_STUDIO_TRANSFER_MAGIC = "M1M4BRUSH\n";
export const BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES = 42 * 1024 * 1024;
export const BRUSH_STUDIO_TRANSFER_MAX_ASSET_BYTES = 20 * 1024 * 1024;

const TRANSFER_ASSET_NAME_MAX_LENGTH = 160;
const TRANSFER_MANIFEST_MAX_BYTES = 64 * 1024;
const TRANSFER_MAGIC_BYTES = new TextEncoder().encode(BRUSH_STUDIO_TRANSFER_MAGIC);
const TRANSFER_FIXED_HEADER_BYTES = TRANSFER_MAGIC_BYTES.byteLength + 4;

const defaultBrushSettings: BrushStudioPersistedSettings = {
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
  size: 96,
  spacingPercent: 1,
  stabilization: 0,
  startThickness: 1,
  endThickness: 1,
  count: 24,
  flow: 0.07,
  opacity: 1,
  hardness: 1,
  blendIntensity: 1,
  blendMode: "light-glaze",
  blendStretch: 0.18,
  blendPaint: 0.14,
  jitterMaster: 1,
  hueJitterDegrees: 12,
  saturationJitter: 0.18,
  lightnessJitter: 0.12,
  darknessJitter: 0.18,
  jitterPerCopy: false,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
};

type JsonRecord = Record<string, unknown>;

export interface BrushStudioTransferInput {
  readonly name: string;
  readonly savedBrush: BrushStudioSavedBrush;
  readonly shapeAsset: BrushStudioStoredAsset | null;
  readonly grainAsset: BrushStudioStoredAsset | null;
}

export interface BrushStudioTransferAsset {
  readonly kind: BrushStudioAssetKind;
  readonly name: string;
  readonly mimeType: "image/png";
  readonly blob: Blob;
}

export interface BrushStudioTransferBrush {
  readonly name: string;
  readonly settings: BrushStudioPersistedSettings;
  readonly shapeAsset: BrushStudioTransferAsset | null;
  readonly grainAsset: BrushStudioTransferAsset | null;
}

export function createBrushStudioImportedAssetId(
  brushId: BrushStudioCustomBrushId,
  kind: "shape",
): CustomBrushShapeAssetId;
export function createBrushStudioImportedAssetId(
  brushId: BrushStudioCustomBrushId,
  kind: "grain",
): CustomBrushGrainAssetId;
export function createBrushStudioImportedAssetId(
  brushId: BrushStudioCustomBrushId,
  kind: BrushStudioAssetKind,
): CustomBrushShapeAssetId | CustomBrushGrainAssetId {
  const token = brushId.slice(BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX.length);
  return kind === "shape"
    ? `custom-shape:${token}`
    : `custom-grain:${token}`;
}

interface EncodedBrushStudioTransferAsset {
  readonly name: string;
  readonly mimeType: "image/png";
  readonly bytes: number;
}

function invalidBrushFile(detail?: string): never {
  throw new Error(detail ? `Invalid M1M4 brush file: ${detail}.` : "Invalid M1M4 brush file.");
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidBrushFile(label);
  }
  return value as JsonRecord;
}

function finiteNumber(
  record: JsonRecord,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
  strict: boolean,
  integer = false,
): number {
  const value = record[key];
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    && (!integer || Number.isInteger(value))
  ) {
    return value;
  }
  if (strict) return invalidBrushFile(`settings.${key}`);
  return fallback;
}

function booleanValue(
  record: JsonRecord,
  key: string,
  fallback: boolean,
  strict: boolean,
): boolean {
  const value = record[key];
  if (typeof value === "boolean") return value;
  if (strict) return invalidBrushFile(`settings.${key}`);
  return fallback;
}

function enumValue<const T extends readonly string[]>(
  record: JsonRecord,
  key: string,
  values: T,
  fallback: T[number],
  strict: boolean,
): T[number] {
  const value = record[key];
  if (typeof value === "string" && values.includes(value)) return value as T[number];
  if (strict) return invalidBrushFile(`settings.${key}`);
  return fallback;
}

function shapeAssetIdValue(
  record: JsonRecord,
  strict: boolean,
): BrushStudioPersistedSettings["shapeAssetId"] {
  const value = record.shapeAssetId;
  if (
    value === "legacy-shape"
    || value === "pencil-shape"
    || isCustomShapeAssetId(value)
  ) {
    return value;
  }
  if (strict) return invalidBrushFile("settings.shapeAssetId");
  return defaultBrushSettings.shapeAssetId;
}

function grainAssetIdValue(
  record: JsonRecord,
  strict: boolean,
): BrushStudioPersistedSettings["grainAssetId"] {
  const value = record.grainAssetId;
  if (
    value === "legacy-grain"
    || value === "pencil-grain"
    || isCustomGrainAssetId(value)
  ) {
    return value;
  }
  if (strict) return invalidBrushFile("settings.grainAssetId");
  return defaultBrushSettings.grainAssetId;
}

function transferSettings(
  value: unknown,
  strict: boolean,
): BrushStudioPersistedSettings {
  const record = asRecord(value, "settings");
  if (strict && ("color" in record || "tool" in record)) {
    return invalidBrushFile("settings must not contain color or tool");
  }
  return {
    shape: enumValue(record, "shape", ["circle", "shape"] as const, defaultBrushSettings.shape, strict),
    shapeAssetId: shapeAssetIdValue(record, strict),
    shapeInvert: booleanValue(record, "shapeInvert", defaultBrushSettings.shapeInvert, strict),
    shapeRotation: enumValue(
      record,
      "shapeRotation",
      ["fixed", "follow-stroke"] as const,
      defaultBrushSettings.shapeRotation,
      strict,
    ),
    shapeScatter: finiteNumber(record, "shapeScatter", defaultBrushSettings.shapeScatter, 0, 1, strict),
    grainMode: enumValue(
      record,
      "grainMode",
      ["off", "texturized", "moving"] as const,
      defaultBrushSettings.grainMode,
      strict,
    ),
    grainAssetId: grainAssetIdValue(record, strict),
    grainScale: finiteNumber(record, "grainScale", defaultBrushSettings.grainScale, 0.1, 4, strict),
    grainMovement: finiteNumber(record, "grainMovement", defaultBrushSettings.grainMovement, 0, 1, strict),
    grainDepth: finiteNumber(record, "grainDepth", defaultBrushSettings.grainDepth, 0, 1, strict),
    grainBrightness: finiteNumber(record, "grainBrightness", defaultBrushSettings.grainBrightness, -1, 1, strict),
    grainContrast: finiteNumber(record, "grainContrast", defaultBrushSettings.grainContrast, -1, 1, strict),
    grainInvert: booleanValue(record, "grainInvert", defaultBrushSettings.grainInvert, strict),
    grainFiltering: enumValue(
      record,
      "grainFiltering",
      ["no", "classic", "improved"] as const,
      defaultBrushSettings.grainFiltering,
      strict,
    ),
    grainBlendMode: enumValue(
      record,
      "grainBlendMode",
      ["multiply"] as const,
      defaultBrushSettings.grainBlendMode,
      strict,
    ),
    size: finiteNumber(record, "size", defaultBrushSettings.size, 1, 1500, strict),
    spacingPercent: finiteNumber(
      record,
      "spacingPercent",
      defaultBrushSettings.spacingPercent,
      0.25,
      25,
      strict,
    ),
    stabilization: finiteNumber(record, "stabilization", defaultBrushSettings.stabilization, 0, 1, strict),
    startThickness: finiteNumber(record, "startThickness", defaultBrushSettings.startThickness, 0, 2, strict),
    endThickness: finiteNumber(record, "endThickness", defaultBrushSettings.endThickness, 0, 2, strict),
    count: finiteNumber(record, "count", defaultBrushSettings.count, 1, 24, strict, true),
    flow: finiteNumber(record, "flow", defaultBrushSettings.flow, 0.001, 1, strict),
    opacity: finiteNumber(record, "opacity", defaultBrushSettings.opacity, 0, 1, strict),
    hardness: finiteNumber(record, "hardness", 1, 1, 1, strict),
    blendIntensity: finiteNumber(record, "blendIntensity", 1, 1, 1, strict),
    blendMode: enumValue(
      record,
      "blendMode",
      ["light-glaze", "uniformed-glaze", "intense-blending"] as const,
      "light-glaze",
      strict,
    ),
    blendStretch: finiteNumber(record, "blendStretch", defaultBrushSettings.blendStretch, 0, 1, strict),
    blendPaint: finiteNumber(record, "blendPaint", defaultBrushSettings.blendPaint, 0, 1, strict),
    jitterMaster: finiteNumber(record, "jitterMaster", 1, 1, 1, strict),
    hueJitterDegrees: finiteNumber(
      record,
      "hueJitterDegrees",
      defaultBrushSettings.hueJitterDegrees,
      0,
      180,
      strict,
    ),
    saturationJitter: finiteNumber(
      record,
      "saturationJitter",
      defaultBrushSettings.saturationJitter,
      0,
      1,
      strict,
    ),
    lightnessJitter: finiteNumber(
      record,
      "lightnessJitter",
      defaultBrushSettings.lightnessJitter,
      0,
      1,
      strict,
    ),
    darknessJitter: finiteNumber(
      record,
      "darknessJitter",
      defaultBrushSettings.darknessJitter,
      0,
      1,
      strict,
    ),
    jitterPerCopy: booleanValue(record, "jitterPerCopy", defaultBrushSettings.jitterPerCopy, strict),
    positionJitterLateral: finiteNumber(
      record,
      "positionJitterLateral",
      defaultBrushSettings.positionJitterLateral,
      0,
      1,
      strict,
    ),
    positionJitterLinear: finiteNumber(
      record,
      "positionJitterLinear",
      defaultBrushSettings.positionJitterLinear,
      0,
      1,
      strict,
    ),
  };
}

function validatePng(bytes: Uint8Array): void {
  if (
    bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a
  ) {
    invalidBrushFile("asset must be a normalized PNG");
  }
  const dimensions = brushSourceDimensionsFromBytes(bytes);
  if (
    !dimensions
    || dimensions.width < 1
    || dimensions.height < 1
    || dimensions.width > BRUSH_SOURCE_MAX_DIMENSION
    || dimensions.height > BRUSH_SOURCE_MAX_DIMENSION
  ) {
    invalidBrushFile(`asset dimensions must be at most ${BRUSH_SOURCE_MAX_DIMENSION} px`);
  }
}

function normalizedAssetName(value: unknown, kind: BrushStudioAssetKind): string {
  if (typeof value !== "string") return invalidBrushFile(`${kind} asset name`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > TRANSFER_ASSET_NAME_MAX_LENGTH) {
    return invalidBrushFile(`${kind} asset name`);
  }
  return normalized;
}

async function encodeAsset(
  asset: BrushStudioStoredAsset,
  kind: BrushStudioAssetKind,
): Promise<EncodedBrushStudioTransferAsset> {
  if (asset.kind !== kind) invalidBrushFile(`${kind} asset kind`);
  if (!asset.key) invalidBrushFile(`${kind} asset key`);
  if (asset.blob.size < 1 || asset.blob.size > BRUSH_STUDIO_TRANSFER_MAX_ASSET_BYTES) {
    invalidBrushFile(`${kind} asset size`);
  }
  if (asset.mimeType !== "image/png" && asset.blob.type !== "image/png") {
    invalidBrushFile(`${kind} asset type`);
  }
  validatePng(new Uint8Array(await asset.blob.slice(0, 64).arrayBuffer()));
  return {
    name: normalizedAssetName(asset.name, kind),
    mimeType: "image/png",
    bytes: asset.blob.size,
  };
}

function decodeAssetManifest(
  value: unknown,
  kind: BrushStudioAssetKind,
): EncodedBrushStudioTransferAsset | null {
  if (value === null) return null;
  const record = asRecord(value, `${kind} asset`);
  if (record.mimeType !== "image/png") return invalidBrushFile(`${kind} asset type`);
  const byteCount = record.bytes;
  if (
    typeof byteCount !== "number"
    || !Number.isInteger(byteCount)
    || byteCount < 1
    || byteCount > BRUSH_STUDIO_TRANSFER_MAX_ASSET_BYTES
  ) {
    return invalidBrushFile(`${kind} asset size`);
  }
  return {
    name: normalizedAssetName(record.name, kind),
    mimeType: "image/png",
    bytes: byteCount,
  };
}

function transferHeader(manifestBytes: number): ArrayBuffer {
  const header = new Uint8Array(TRANSFER_FIXED_HEADER_BYTES);
  header.set(TRANSFER_MAGIC_BYTES, 0);
  new DataView(header.buffer).setUint32(TRANSFER_MAGIC_BYTES.byteLength, manifestBytes, true);
  return header.buffer;
}

function hasTransferMagic(header: Uint8Array): boolean {
  if (header.byteLength < TRANSFER_FIXED_HEADER_BYTES) return false;
  for (let index = 0; index < TRANSFER_MAGIC_BYTES.byteLength; index += 1) {
    if (header[index] !== TRANSFER_MAGIC_BYTES[index]) return false;
  }
  return true;
}

function validateAssetPairing(
  settings: BrushStudioPersistedSettings,
  shapePresent: boolean,
  grainPresent: boolean,
): void {
  const customShape = isCustomShapeAssetId(settings.shapeAssetId);
  const customGrain = isCustomGrainAssetId(settings.grainAssetId);
  if (customShape !== shapePresent) invalidBrushFile("custom Shape asset is missing or unexpected");
  if (customGrain !== grainPresent) invalidBrushFile("custom Grain asset is missing or unexpected");
}

export async function createBrushStudioTransferBlob(
  input: BrushStudioTransferInput,
): Promise<Blob> {
  const settings = transferSettings(input.savedBrush.settings, false);
  const expectsShape = input.savedBrush.shapeAssetKey !== null;
  const expectsGrain = input.savedBrush.grainAssetKey !== null;
  if (expectsShape !== Boolean(input.shapeAsset) || expectsGrain !== Boolean(input.grainAsset)) {
    invalidBrushFile("saved asset is unavailable");
  }
  if (
    (input.shapeAsset && input.shapeAsset.key !== input.savedBrush.shapeAssetKey)
    || (input.grainAsset && input.grainAsset.key !== input.savedBrush.grainAssetKey)
  ) {
    invalidBrushFile("saved asset key does not match");
  }
  validateAssetPairing(settings, Boolean(input.shapeAsset), Boolean(input.grainAsset));
  const shape = input.shapeAsset ? await encodeAsset(input.shapeAsset, "shape") : null;
  const grain = input.grainAsset ? await encodeAsset(input.grainAsset, "grain") : null;
  const manifest = new TextEncoder().encode(JSON.stringify({
    format: BRUSH_STUDIO_TRANSFER_FORMAT,
    version: BRUSH_STUDIO_TRANSFER_VERSION,
    name: normalizeBrushStudioCustomBrushName(input.name),
    settings,
    assets: { shape, grain },
  }));
  if (manifest.byteLength < 1 || manifest.byteLength > TRANSFER_MANIFEST_MAX_BYTES) {
    throw new Error("This brush manifest is too large to export safely.");
  }
  const parts: BlobPart[] = [transferHeader(manifest.byteLength), manifest.buffer];
  if (input.shapeAsset) parts.push(input.shapeAsset.blob);
  if (input.grainAsset) parts.push(input.grainAsset.blob);
  const blob = new Blob(parts, { type: BRUSH_STUDIO_TRANSFER_MIME_TYPE });
  if (blob.size > BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES) {
    throw new Error("This brush is too large to export safely on a phone.");
  }
  return blob;
}

export async function parseBrushStudioTransferBlob(
  blob: Blob,
): Promise<BrushStudioTransferBrush> {
  if (blob.size < 1 || blob.size > BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES) {
    throw new Error("Choose an M1M4 brush file smaller than 42 MB.");
  }
  const header = new Uint8Array(
    await blob.slice(0, TRANSFER_FIXED_HEADER_BYTES).arrayBuffer(),
  );
  if (!hasTransferMagic(header)) return invalidBrushFile("header");
  const manifestBytes = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  ).getUint32(TRANSFER_MAGIC_BYTES.byteLength, true);
  if (
    manifestBytes < 1
    || manifestBytes > TRANSFER_MANIFEST_MAX_BYTES
    || TRANSFER_FIXED_HEADER_BYTES + manifestBytes > blob.size
  ) {
    return invalidBrushFile("manifest size");
  }
  let parsed: unknown;
  try {
    const manifest = new Uint8Array(await blob.slice(
      TRANSFER_FIXED_HEADER_BYTES,
      TRANSFER_FIXED_HEADER_BYTES + manifestBytes,
    ).arrayBuffer());
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest));
  } catch {
    return invalidBrushFile();
  }
  const record = asRecord(parsed, "document");
  if (record.format !== BRUSH_STUDIO_TRANSFER_FORMAT) return invalidBrushFile("format");
  if (record.version !== BRUSH_STUDIO_TRANSFER_VERSION) {
    throw new Error("This M1M4 brush file uses an unsupported version.");
  }
  if (
    typeof record.name !== "string"
    || !record.name.trim()
    || record.name.length > BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH
  ) {
    return invalidBrushFile("name");
  }
  const settings = transferSettings(record.settings, true);
  const assets = asRecord(record.assets, "assets");
  const shapeManifest = decodeAssetManifest(assets.shape, "shape");
  const grainManifest = decodeAssetManifest(assets.grain, "grain");
  validateAssetPairing(settings, Boolean(shapeManifest), Boolean(grainManifest));
  let assetOffset = TRANSFER_FIXED_HEADER_BYTES + manifestBytes;
  const expectedBytes = assetOffset
    + (shapeManifest?.bytes ?? 0)
    + (grainManifest?.bytes ?? 0);
  if (expectedBytes !== blob.size) return invalidBrushFile("asset layout");

  let shapeAsset: BrushStudioTransferAsset | null = null;
  if (shapeManifest) {
    const shapeBlob = blob.slice(
      assetOffset,
      assetOffset + shapeManifest.bytes,
      "image/png",
    );
    validatePng(new Uint8Array(await shapeBlob.slice(0, 64).arrayBuffer()));
    shapeAsset = {
      kind: "shape",
      name: shapeManifest.name,
      mimeType: "image/png",
      blob: shapeBlob,
    };
    assetOffset += shapeManifest.bytes;
  }
  let grainAsset: BrushStudioTransferAsset | null = null;
  if (grainManifest) {
    const grainBlob = blob.slice(
      assetOffset,
      assetOffset + grainManifest.bytes,
      "image/png",
    );
    validatePng(new Uint8Array(await grainBlob.slice(0, 64).arrayBuffer()));
    grainAsset = {
      kind: "grain",
      name: grainManifest.name,
      mimeType: "image/png",
      blob: grainBlob,
    };
  }
  return {
    name: normalizeBrushStudioCustomBrushName(record.name),
    settings,
    shapeAsset,
    grainAsset,
  };
}

export function brushStudioTransferFileName(name: string): string {
  const base = normalizeBrushStudioCustomBrushName(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${base || "M1M4 Brush"}${BRUSH_STUDIO_TRANSFER_EXTENSION}`;
}
