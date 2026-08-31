/**
 * Stable brush-asset routing shared by live painting and history replay.
 * URLs stay explicit so Vite includes every source without a dynamic glob.
 */
import {
  builtinGrainAsset,
  builtinShapeAsset,
  type BuiltinGrainBrushAsset,
  type BuiltinShapeBrushAsset,
} from "./brush-builtin-assets.ts";
import {
  LEGACY_SHAPE_ASSET_ID,
  migratePersistedGrainAssetId,
  PENCIL_GRAIN_ASSET_ID,
  PENCIL_SHAPE_ASSET_ID,
} from "./compat/brush-persistence.ts";
import type {
  BrushGrainAssetId,
  BrushSettings,
  BrushShapeAssetId,
  BrushShapeMaskFormat,
} from "./engine-types";
import { MAX_BRUSH_SHAPE_SEQUENCE_LENGTH } from "./brush-shape-sequence-core.ts";
export {
  CustomBrushAssetRegistry,
  isCustomGrainAssetId,
  isCustomShapeAssetId,
} from "./brush-asset-registry";
export type {
  CustomBrushAssetSnapshot,
  DecodedCustomBrushImage,
  RegisteredCustomBrushAsset,
} from "./brush-asset-registry";

import { isCustomGrainAssetId, isCustomShapeAssetId } from "./brush-asset-registry";

export type ShapeAssetDescriptor = BuiltinShapeBrushAsset;
export type GrainAssetDescriptor = BuiltinGrainBrushAsset;

export function normalizeShapeAssetId(value: unknown): BrushShapeAssetId {
  return value === PENCIL_SHAPE_ASSET_ID || isCustomShapeAssetId(value)
    ? value
    : LEGACY_SHAPE_ASSET_ID;
}

export function normalizeGrainAssetId(value: unknown): BrushGrainAssetId {
  const migrated = migratePersistedGrainAssetId(value);
  return migrated === PENCIL_GRAIN_ASSET_ID || isCustomGrainAssetId(migrated)
    ? migrated
    : PENCIL_GRAIN_ASSET_ID;
}

export function shapeInvertForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): boolean {
  return settings.shapeInvert === true;
}

export function shapeMaskFormatForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): BrushShapeMaskFormat {
  return settings.shapeMaskFormat === "r8unorm" ? "r8unorm" : "r16float";
}

export function shapeAssetIdForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): BrushShapeAssetId {
  return shapeAssetIdsForSettings(settings)[0];
}

export function normalizeShapeAssetIds(
  value: unknown,
  fallback: BrushShapeAssetId = LEGACY_SHAPE_ASSET_ID,
): BrushShapeAssetId[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [normalizeShapeAssetId(fallback)];
  }
  return value
    .slice(0, MAX_BRUSH_SHAPE_SEQUENCE_LENGTH)
    .map((assetId) => normalizeShapeAssetId(assetId));
}

export function shapeAssetIdsForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): BrushShapeAssetId[] {
  return normalizeShapeAssetIds(
    settings.shapeAssetIds,
    normalizeShapeAssetId(settings.shapeAssetId),
  );
}

export function shapeAssetSequenceLengthForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): number {
  const assetIds = settings.shapeAssetIds;
  return Array.isArray(assetIds) && assetIds.length > 0
    ? Math.min(assetIds.length, MAX_BRUSH_SHAPE_SEQUENCE_LENGTH)
    : 1;
}

export function shapeAssetSequenceKey(assetIds: readonly BrushShapeAssetId[]): string {
  return normalizeShapeAssetIds(assetIds).join("\u001f");
}

export function shapeAssetSequenceMatches(
  left: readonly BrushShapeAssetId[],
  right: readonly BrushShapeAssetId[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((assetId, index) => assetId === right[index]);
}

export function grainAssetIdForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): BrushGrainAssetId {
  return normalizeGrainAssetId(settings.grainAssetId);
}

export function shapeAssetDescriptor(id: BrushShapeAssetId): ShapeAssetDescriptor {
  const descriptor = builtinShapeAsset(id);
  if (!descriptor) {
    throw new Error(`Asset ${id} must be resolved through the engine's custom registry.`);
  }
  return descriptor;
}

export function grainAssetDescriptor(id: BrushGrainAssetId): GrainAssetDescriptor {
  const descriptor = builtinGrainAsset(id);
  if (!descriptor) {
    throw new Error(`Asset ${id} must be resolved through the engine's custom registry.`);
  }
  return descriptor;
}

export function mipLevelCountForSize(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export function mipChainPixelCount(width: number, height: number): number {
  let mipWidth = width;
  let mipHeight = height;
  let pixels = 0;
  while (true) {
    pixels += mipWidth * mipHeight;
    if (mipWidth === 1 && mipHeight === 1) break;
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
  }
  return pixels;
}

export function rgba8MipChainBytes(width: number, height: number): number {
  return mipChainPixelCount(width, height) * 4;
}

/**
 * La grana e' un campo scalare: lo shader di pittura ne ricava una sola luma e
 * scarta l'alpha. Conservarla su un canale a mezza precisione costa due byte
 * per pixel invece di quattro, senza perdere nulla di cio' che veniva usato.
 */
export function r16MipChainBytes(width: number, height: number): number {
  return mipChainPixelCount(width, height) * 2;
}
