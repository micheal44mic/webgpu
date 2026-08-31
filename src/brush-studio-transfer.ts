import {
  BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH,
  normalizeBrushStudioCustomBrushName,
  type BrushStudioCustomBrushId,
} from "./brush-catalog.ts";
import {
  BrushDefinitionValidationError,
  normalizeBrushDefinitionSettings,
  type BrushDefinitionSettings,
} from "./brush-definition.ts";
import {
  isCustomGrainAssetId,
  isCustomShapeAssetId,
} from "./brush-asset-registry.ts";
import {
  BRUSH_SOURCE_MAX_DIMENSION,
  brushSourceDimensionsFromBytes,
} from "./brush-source-image.ts";
import {
  type BrushStudioAssetKind,
  type BrushStudioSavedBrush,
  type BrushStudioStoredAsset,
} from "./brush-studio-storage.ts";
import { CUSTOM_BRUSH_PERSISTED_ID_PREFIX } from "./compat/brush-persistence.ts";
import type {
  CustomBrushGrainAssetId,
  CustomBrushShapeAssetId,
} from "./engine-types.ts";

export const BRUSH_STUDIO_TRANSFER_FORMAT = "m1m4-brush";
export const BRUSH_STUDIO_TRANSFER_VERSION = 2;
const BRUSH_STUDIO_TRANSFER_LEGACY_VERSION = 1;
export const BRUSH_STUDIO_TRANSFER_EXTENSION = ".m1m4brush";
export const BRUSH_STUDIO_TRANSFER_MIME_TYPE = "application/vnd.m1m4.brush";
export const BRUSH_STUDIO_TRANSFER_MAGIC = "M1M4BRUSH\n";
export const BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES = 42 * 1024 * 1024;
export const BRUSH_STUDIO_TRANSFER_MAX_ASSET_BYTES = 20 * 1024 * 1024;

const TRANSFER_ASSET_NAME_MAX_LENGTH = 160;
const TRANSFER_MANIFEST_MAX_BYTES = 64 * 1024;
const TRANSFER_MAGIC_BYTES = new TextEncoder().encode(BRUSH_STUDIO_TRANSFER_MAGIC);
const TRANSFER_FIXED_HEADER_BYTES = TRANSFER_MAGIC_BYTES.byteLength + 4;

type JsonRecord = Record<string, unknown>;

export interface BrushStudioTransferInput {
  readonly name: string;
  readonly savedBrush: BrushStudioSavedBrush;
  readonly shapeAssets?: readonly BrushStudioTransferInputShapeAsset[];
  /** Compatibility input for the former single-Shape call site. */
  readonly shapeAsset?: BrushStudioStoredAsset | null;
  readonly grainAsset: BrushStudioStoredAsset | null;
}

export interface BrushStudioTransferInputShapeAsset {
  readonly assetId: CustomBrushShapeAssetId;
  readonly asset: BrushStudioStoredAsset;
}

export interface BrushStudioTransferAsset {
  readonly kind: BrushStudioAssetKind;
  readonly name: string;
  readonly mimeType: "image/png";
  readonly blob: Blob;
}

export interface BrushStudioTransferShapeAsset extends BrushStudioTransferAsset {
  readonly kind: "shape";
  readonly assetId: CustomBrushShapeAssetId;
}

export interface BrushStudioTransferBrush {
  readonly name: string;
  readonly settings: BrushDefinitionSettings;
  readonly shapeAssets: readonly BrushStudioTransferShapeAsset[];
  /** Compatibility alias populated only when exactly one Shape asset exists. */
  readonly shapeAsset: BrushStudioTransferShapeAsset | null;
  readonly grainAsset: BrushStudioTransferAsset | null;
}

export function createBrushStudioImportedAssetId(
  brushId: BrushStudioCustomBrushId,
  kind: "shape",
  ordinal?: number,
): CustomBrushShapeAssetId;
export function createBrushStudioImportedAssetId(
  brushId: BrushStudioCustomBrushId,
  kind: "grain",
): CustomBrushGrainAssetId;
export function createBrushStudioImportedAssetId(
  brushId: BrushStudioCustomBrushId,
  kind: BrushStudioAssetKind,
  ordinal = 0,
): CustomBrushShapeAssetId | CustomBrushGrainAssetId {
  const token = brushId.slice(CUSTOM_BRUSH_PERSISTED_ID_PREFIX.length);
  if (kind === "grain") return `custom-grain:${token}`;
  const stableOrdinal = Number.isInteger(ordinal) && ordinal > 0 ? ordinal : 0;
  return stableOrdinal === 0
    ? `custom-shape:${token}`
    : `custom-shape:${token}-${stableOrdinal + 1}`;
}

interface EncodedBrushStudioTransferAsset {
  readonly name: string;
  readonly mimeType: "image/png";
  readonly bytes: number;
}

interface EncodedBrushStudioTransferShapeAsset extends EncodedBrushStudioTransferAsset {
  readonly assetId: CustomBrushShapeAssetId;
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

function transferSettings(
  value: unknown,
  strict: boolean,
): BrushDefinitionSettings {
  try {
    return normalizeBrushDefinitionSettings(value, { strict });
  } catch (error) {
    if (error instanceof BrushDefinitionValidationError) {
      return invalidBrushFile(error.field);
    }
    throw error;
  }
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

function decodeShapeAssetManifest(value: unknown): EncodedBrushStudioTransferShapeAsset {
  const record = asRecord(value, "shape asset");
  if (!isCustomShapeAssetId(record.assetId)) {
    return invalidBrushFile("shape asset ID");
  }
  const asset = decodeAssetManifest(record, "shape");
  if (!asset) return invalidBrushFile("shape asset");
  return { assetId: record.assetId, ...asset };
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

function customShapeAssetIds(
  settings: BrushDefinitionSettings,
): CustomBrushShapeAssetId[] {
  const shapeAssetIds = settings.shapeAssetIds ?? [settings.shapeAssetId];
  return [...new Set(shapeAssetIds.filter(isCustomShapeAssetId))];
}

function validateAssetPairing(
  settings: BrushDefinitionSettings,
  suppliedShapeAssetIds: readonly CustomBrushShapeAssetId[],
  grainPresent: boolean,
  version: 1 | 2,
): void {
  const expectedShapeAssetIds = customShapeAssetIds(settings);
  if (
    version === BRUSH_STUDIO_TRANSFER_LEGACY_VERSION
    && (
      expectedShapeAssetIds.length > 1
      || (expectedShapeAssetIds.length === 1 && expectedShapeAssetIds[0] !== settings.shapeAssetId)
    )
  ) {
    invalidBrushFile("version 1 supports one custom Shape source");
  }
  const suppliedSet = new Set(suppliedShapeAssetIds);
  if (
    suppliedSet.size !== suppliedShapeAssetIds.length
    || suppliedSet.size !== expectedShapeAssetIds.length
    || expectedShapeAssetIds.some((assetId) => !suppliedSet.has(assetId))
  ) {
    invalidBrushFile("custom Shape asset is missing or unexpected");
  }
  const customGrain = isCustomGrainAssetId(settings.grainAssetId);
  if (customGrain !== grainPresent) invalidBrushFile("custom Grain asset is missing or unexpected");
}

function transferInputShapeAssets(
  input: BrushStudioTransferInput,
  settings: BrushDefinitionSettings,
): BrushStudioTransferInputShapeAsset[] {
  if (input.shapeAssets !== undefined && input.shapeAsset !== undefined) {
    invalidBrushFile("ambiguous Shape assets");
  }
  if (input.shapeAssets !== undefined) return [...input.shapeAssets];
  if (!input.shapeAsset) return [];
  const assetIds = customShapeAssetIds(settings);
  if (assetIds.length !== 1) {
    invalidBrushFile("custom Shape asset is missing or unexpected");
  }
  return [{ assetId: assetIds[0], asset: input.shapeAsset }];
}

export async function createBrushStudioTransferBlob(
  input: BrushStudioTransferInput,
): Promise<Blob> {
  const settings = transferSettings(input.savedBrush.settings, false);
  const inputShapeAssets = transferInputShapeAssets(input, settings);
  const expectedShapeAssetIds = customShapeAssetIds(settings);
  const suppliedShapeAssets = new Map(
    inputShapeAssets.map((entry) => [entry.assetId, entry.asset] as const),
  );
  const savedShapeAssetRefs = input.savedBrush.shapeAssetRefs;
  const expectsGrain = input.savedBrush.grainAssetKey !== null;
  if (expectedShapeAssetIds.some((assetId) => !suppliedShapeAssets.has(assetId))) {
    invalidBrushFile("saved asset is unavailable");
  }
  if (expectsGrain !== Boolean(input.grainAsset)) {
    invalidBrushFile("saved asset is unavailable");
  }
  if (
    input.grainAsset
    && input.grainAsset.key !== input.savedBrush.grainAssetKey
  ) {
    invalidBrushFile("saved asset key does not match");
  }
  if (input.savedBrush.shapeAssetKey !== null) {
    const firstAsset = isCustomShapeAssetId(settings.shapeAssetId)
      ? suppliedShapeAssets.get(settings.shapeAssetId)
      : null;
    if (!firstAsset || firstAsset.key !== input.savedBrush.shapeAssetKey) {
      invalidBrushFile("saved asset key does not match");
    }
  } else if (input.shapeAssets === undefined && input.shapeAsset) {
    invalidBrushFile("saved asset key does not match");
  }
  if (savedShapeAssetRefs !== undefined) {
    const savedShapeAssetKeys = new Map(
      savedShapeAssetRefs.map((ref) => [ref.assetId, ref.storageKey] as const),
    );
    if (
      savedShapeAssetKeys.size !== expectedShapeAssetIds.length
      || expectedShapeAssetIds.some((assetId) => (
        savedShapeAssetKeys.get(assetId) !== suppliedShapeAssets.get(assetId)?.key
      ))
    ) {
      invalidBrushFile("saved Shape asset references do not match");
    }
  }
  validateAssetPairing(
    settings,
    inputShapeAssets.map((entry) => entry.assetId),
    Boolean(input.grainAsset),
    BRUSH_STUDIO_TRANSFER_VERSION,
  );
  const shapeAssets = await Promise.all(expectedShapeAssetIds.map(async (assetId) => {
    const asset = suppliedShapeAssets.get(assetId);
    if (!asset) return invalidBrushFile("saved asset is unavailable");
    const encoded = await encodeAsset(asset, "shape");
    return { assetId, ...encoded, blob: asset.blob };
  }));
  const grain = input.grainAsset ? await encodeAsset(input.grainAsset, "grain") : null;
  const manifest = new TextEncoder().encode(JSON.stringify({
    format: BRUSH_STUDIO_TRANSFER_FORMAT,
    version: BRUSH_STUDIO_TRANSFER_VERSION,
    name: normalizeBrushStudioCustomBrushName(input.name),
    settings,
    assets: {
      shapes: shapeAssets.map(({ blob: _blob, ...asset }) => asset),
      grain,
    },
  }));
  if (manifest.byteLength < 1 || manifest.byteLength > TRANSFER_MANIFEST_MAX_BYTES) {
    throw new Error("This brush manifest is too large to export safely.");
  }
  const parts: BlobPart[] = [transferHeader(manifest.byteLength), manifest.buffer];
  for (const asset of shapeAssets) parts.push(asset.blob);
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
  if (
    record.version !== BRUSH_STUDIO_TRANSFER_LEGACY_VERSION
    && record.version !== BRUSH_STUDIO_TRANSFER_VERSION
  ) {
    throw new Error("This M1M4 brush file uses an unsupported version.");
  }
  const version = record.version;
  if (
    typeof record.name !== "string"
    || !record.name.trim()
    || record.name.length > BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH
  ) {
    return invalidBrushFile("name");
  }
  const settings = transferSettings(record.settings, true);
  const assets = asRecord(record.assets, "assets");
  let shapeManifests: EncodedBrushStudioTransferShapeAsset[];
  if (version === BRUSH_STUDIO_TRANSFER_LEGACY_VERSION) {
    const legacyShapeManifest = decodeAssetManifest(assets.shape, "shape");
    const expectedShapeAssetIds = customShapeAssetIds(settings);
    if (legacyShapeManifest && expectedShapeAssetIds.length === 0) {
      return invalidBrushFile("custom Shape asset is missing or unexpected");
    }
    shapeManifests = legacyShapeManifest
      ? [{ assetId: expectedShapeAssetIds[0], ...legacyShapeManifest }]
      : [];
  } else {
    if (!Array.isArray(assets.shapes) || assets.shapes.length > 4) {
      return invalidBrushFile("shape assets");
    }
    shapeManifests = assets.shapes.map(decodeShapeAssetManifest);
  }
  const grainManifest = decodeAssetManifest(assets.grain, "grain");
  validateAssetPairing(
    settings,
    shapeManifests.map((asset) => asset.assetId),
    Boolean(grainManifest),
    version,
  );
  let assetOffset = TRANSFER_FIXED_HEADER_BYTES + manifestBytes;
  const expectedBytes = assetOffset
    + shapeManifests.reduce((total, asset) => total + asset.bytes, 0)
    + (grainManifest?.bytes ?? 0);
  if (expectedBytes !== blob.size) return invalidBrushFile("asset layout");

  const shapeAssets: BrushStudioTransferShapeAsset[] = [];
  for (const shapeManifest of shapeManifests) {
    const shapeBlob = blob.slice(
      assetOffset,
      assetOffset + shapeManifest.bytes,
      "image/png",
    );
    validatePng(new Uint8Array(await shapeBlob.slice(0, 64).arrayBuffer()));
    shapeAssets.push({
      assetId: shapeManifest.assetId,
      kind: "shape",
      name: shapeManifest.name,
      mimeType: "image/png",
      blob: shapeBlob,
    });
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
    shapeAssets,
    shapeAsset: shapeAssets.length === 1 ? shapeAssets[0] : null,
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
