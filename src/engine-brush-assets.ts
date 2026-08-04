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

export interface ShapeAssetDescriptor extends ShapeBrushAsset {
  readonly url: URL;
}

export interface GrainAssetDescriptor extends GrainBrushAsset {
  readonly url: URL;
}

export function normalizeShapeAssetId(value: unknown): BrushShapeAssetId {
  return value === "pencil-shape" ? value : "legacy-shape";
}

export function normalizeGrainAssetId(value: unknown): BrushGrainAssetId {
  return value === "pencil-grain" ? value : "legacy-grain";
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
  if (id === "pencil-grain") {
    return {
      ...BRUSH_ASSET_REGISTRY["pencil-grain"],
      url: new URL("../Grainpencil.png", import.meta.url),
    };
  }
  return {
    ...BRUSH_ASSET_REGISTRY["legacy-grain"],
    url: new URL("../graincottonfleece.PNG", import.meta.url),
  };
}

export function mipLevelCountForSize(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export function rgba8MipChainBytes(width: number, height: number): number {
  let mipWidth = width;
  let mipHeight = height;
  let pixels = 0;
  while (true) {
    pixels += mipWidth * mipHeight;
    if (mipWidth === 1 && mipHeight === 1) break;
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
  }
  return pixels * 4;
}
