import {
  LEGACY_SHAPE_ASSET_ID,
  PENCIL_GRAIN_ASSET_ID,
  PENCIL_SHAPE_ASSET_ID,
} from "./compat/brush-persistence.ts";
import type {
  BrushGrainAssetId,
  BrushShapeAssetId,
} from "./engine-types.ts";

export type BuiltinBrushAssetId =
  | typeof LEGACY_SHAPE_ASSET_ID
  | typeof PENCIL_SHAPE_ASSET_ID
  | typeof PENCIL_GRAIN_ASSET_ID;

export function isBuiltinBrushAssetId(value: string): value is BuiltinBrushAssetId {
  return value === LEGACY_SHAPE_ASSET_ID
    || value === PENCIL_SHAPE_ASSET_ID
    || value === PENCIL_GRAIN_ASSET_ID;
}

interface BuiltinBrushAssetBase {
  readonly id: BuiltinBrushAssetId;
  readonly sourceFile: string;
  readonly url: URL;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  /** SHA-256 of the source PNG bytes, before decoding or polarity changes. */
  readonly sourceSha256: string;
}

export interface BuiltinShapeBrushAsset extends BuiltinBrushAssetBase {
  readonly id: typeof LEGACY_SHAPE_ASSET_ID | typeof PENCIL_SHAPE_ASSET_ID;
  readonly kind: "shape";
  readonly decode: {
    readonly strategy: "luminance-times-alpha";
    readonly invertLuminance: boolean;
  };
}

export interface BuiltinGrainBrushAsset extends BuiltinBrushAssetBase {
  readonly id: typeof PENCIL_GRAIN_ASSET_ID;
  readonly kind: "grain";
  readonly decode: {
    readonly strategy: "native-gray" | "bt601-rgb-luminance";
    readonly invertLuminance: boolean;
  };
}

export type BuiltinBrushAsset = BuiltinShapeBrushAsset | BuiltinGrainBrushAsset;

/** Single authoritative registry for built-in metadata and bundle URLs. */
export const BUILTIN_BRUSH_ASSETS = {
  [LEGACY_SHAPE_ASSET_ID]: {
    id: LEGACY_SHAPE_ASSET_ID,
    kind: "shape",
    sourceFile: "Shape.png",
    url: new URL("../Shape.png", import.meta.url),
    mimeType: "image/png",
    width: 2048,
    height: 2048,
    sourceSha256: "39b2d76527629e3c0726de1405ee5d80538722c948056486df4c44657380494f",
    decode: { strategy: "luminance-times-alpha", invertLuminance: false },
  },
  [PENCIL_SHAPE_ASSET_ID]: {
    id: PENCIL_SHAPE_ASSET_ID,
    kind: "shape",
    sourceFile: "Shapepencil.png",
    url: new URL("../Shapepencil.png", import.meta.url),
    mimeType: "image/png",
    width: 2048,
    height: 2048,
    sourceSha256: "41f9c9b5e964ca2c4d62d524829bd9610f6c252bb4d80e554ac142bc75528063",
    decode: { strategy: "luminance-times-alpha", invertLuminance: true },
  },
  [PENCIL_GRAIN_ASSET_ID]: {
    id: PENCIL_GRAIN_ASSET_ID,
    kind: "grain",
    sourceFile: "Grainpencil.png",
    url: new URL("../Grainpencil.png", import.meta.url),
    mimeType: "image/png",
    width: 800,
    height: 800,
    sourceSha256: "2af322275a8a1ebc9e410c123115eef2cbb3ab8f4ee5823bbb6cf3f495d07528",
    decode: { strategy: "native-gray", invertLuminance: false },
  },
} as const satisfies Record<BuiltinBrushAssetId, BuiltinBrushAsset>;

export function builtinShapeAsset(
  id: BrushShapeAssetId,
): BuiltinShapeBrushAsset | null {
  if (id === LEGACY_SHAPE_ASSET_ID || id === PENCIL_SHAPE_ASSET_ID) {
    return BUILTIN_BRUSH_ASSETS[id];
  }
  return null;
}

export function builtinGrainAsset(
  id: BrushGrainAssetId,
): BuiltinGrainBrushAsset | null {
  return id === PENCIL_GRAIN_ASSET_ID ? BUILTIN_BRUSH_ASSETS[id] : null;
}

export function builtinBrushAssetUrl(id: BuiltinBrushAssetId): string {
  return BUILTIN_BRUSH_ASSETS[id].url.href;
}
