/**
 * Stable brush-asset routing shared by live painting and history replay.
 * URLs stay explicit so Vite includes every source without a dynamic glob.
 */
import {
  BRUSH_ASSET_REGISTRY,
  type GrainBrushAsset,
  type ShapeBrushAsset,
} from "./brush-presets";
import type {
  BrushGrainAssetId,
  BrushSettings,
  BrushShapeAssetId,
} from "./engine-types";
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

export interface ShapeAssetDescriptor extends ShapeBrushAsset {
  readonly url: URL;
}

export interface GrainAssetDescriptor extends GrainBrushAsset {
  readonly url: URL;
}

export function normalizeShapeAssetId(value: unknown): BrushShapeAssetId {
  return value === "pencil-shape" || isCustomShapeAssetId(value) ? value : "legacy-shape";
}

export function normalizeGrainAssetId(value: unknown): BrushGrainAssetId {
  return value === "pencil-grain" || isCustomGrainAssetId(value) ? value : "pencil-grain";
}

export function shapeInvertForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): boolean {
  return settings.shapeInvert === true;
}

export function shapeAssetIdForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): BrushShapeAssetId {
  return normalizeShapeAssetId(settings.shapeAssetId);
}

export function grainAssetIdForSettings(
  settings: Readonly<BrushSettings> | Partial<BrushSettings>,
): BrushGrainAssetId {
  return normalizeGrainAssetId(settings.grainAssetId);
}

export function shapeAssetDescriptor(id: BrushShapeAssetId): ShapeAssetDescriptor {
  if (isCustomShapeAssetId(id)) {
    throw new Error(`L'asset ${id} deve essere risolto dal registro custom del motore.`);
  }
  if (id === "pencil-shape") {
    return {
      ...BRUSH_ASSET_REGISTRY["pencil-shape"],
      url: new URL("../Shapepencil.png", import.meta.url),
    };
  }
  return {
    ...BRUSH_ASSET_REGISTRY["legacy-shape"],
    url: new URL("../Shape.png", import.meta.url),
  };
}

export function grainAssetDescriptor(id: BrushGrainAssetId): GrainAssetDescriptor {
  if (isCustomGrainAssetId(id)) {
    throw new Error(`L'asset ${id} deve essere risolto dal registro custom del motore.`);
  }
  return {
    ...BRUSH_ASSET_REGISTRY["pencil-grain"],
    url: new URL("../Grainpencil.png", import.meta.url),
  };
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
