import type {
  BrushGrainAssetId,
  BrushSettings,
  BrushShapeAssetId,
} from "./engine-types";

/**
 * Stable, serializable contract for library presets. Every brush capability
 * lives in the shared BrushSettings ABI; a named brush is data, never a
 * special rendering branch.
 */
export const BRUSH_PRESET_CONTRACT_VERSION = "m1m4-brush-preset-v1" as const;

export type BrushPresetContractVersion = typeof BRUSH_PRESET_CONTRACT_VERSION;
export type BrushPresetCategoryId = "pencil" | "painting" | "spray-paint";
export type BrushAssetId =
  | BrushShapeAssetId
  | BrushGrainAssetId;

interface BrushAssetBase {
  readonly id: BrushAssetId;
  readonly sourceFile: string;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  /** SHA-256 of the source PNG bytes, before decoding or polarity changes. */
  readonly sourceSha256: string;
}

export interface ShapeBrushAsset extends BrushAssetBase {
  readonly kind: "shape";
  readonly decode: {
    readonly strategy: "luminance-times-alpha";
    /** `true` means coverage = (1 - luminance) * alpha. */
    readonly invertLuminance: boolean;
  };
}

export interface GrainBrushAsset extends BrushAssetBase {
  readonly kind: "grain";
  readonly decode: {
    readonly strategy: "native-gray" | "bt601-rgb-luminance";
    readonly invertLuminance: boolean;
  };
}

export type BrushAsset = ShapeBrushAsset | GrainBrushAsset;

/**
 * Both the existing singleton assets and the new Pencil assets have stable
 * identities. The registry is declarative: the resource loader remains free
 * to resolve each sourceFile with a static `new URL(...)` for Vite.
 */
export const BRUSH_ASSET_REGISTRY = {
  "legacy-shape": {
    id: "legacy-shape",
    kind: "shape",
    sourceFile: "Shape.png",
    mimeType: "image/png",
    width: 2048,
    height: 2048,
    sourceSha256: "39b2d76527629e3c0726de1405ee5d80538722c948056486df4c44657380494f",
    decode: {
      strategy: "luminance-times-alpha",
      invertLuminance: false,
    },
  },
  "legacy-grain": {
    id: "legacy-grain",
    kind: "grain",
    sourceFile: "graincottonfleece.PNG",
    mimeType: "image/png",
    width: 2500,
    height: 2500,
    sourceSha256: "9aa1ce073885b83ea223af0941ef74604548a85f54442228ec15522ace3ef2d7",
    decode: {
      strategy: "bt601-rgb-luminance",
      invertLuminance: false,
    },
  },
  "pencil-shape": {
    id: "pencil-shape",
    kind: "shape",
    sourceFile: "Shapepencil.png",
    mimeType: "image/png",
    width: 2048,
    height: 2048,
    sourceSha256: "41f9c9b5e964ca2c4d62d524829bd9610f6c252bb4d80e554ac142bc75528063",
    decode: {
      strategy: "luminance-times-alpha",
      // This source is black-on-white: black is authoritative coverage.
      invertLuminance: true,
    },
  },
  "pencil-grain": {
    id: "pencil-grain",
    kind: "grain",
    sourceFile: "Grainpencil.png",
    mimeType: "image/png",
    width: 800,
    height: 800,
    sourceSha256: "2af322275a8a1ebc9e410c123115eef2cbb3ab8f4ee5823bbb6cf3f495d07528",
    decode: {
      strategy: "native-gray",
      invertLuminance: false,
    },
  },
} as const satisfies Record<BrushAssetId, BrushAsset>;

export type BrushPresetSettings = Readonly<Omit<BrushSettings, "color">>;

export interface BrushPreset {
  readonly contractVersion: BrushPresetContractVersion;
  readonly id: string;
  readonly name: string;
  readonly categoryId: BrushPresetCategoryId;
  /** Selecting a brush must not unexpectedly replace the artist's color. */
  readonly colorPolicy: "preserve-current";
  /** Complete settings ABI, except for color which follows colorPolicy. */
  readonly settings: BrushPresetSettings;
  readonly compatibility: {
    readonly fallbackPolicy: "apply-supported-settings";
    readonly legacyAbiFields: readonly ["blendIntensity", "jitterMaster"];
  };
}

export const PENCIL_BRUSH_PRESET = {
  contractVersion: BRUSH_PRESET_CONTRACT_VERSION,
  id: "m1m4-pencil-v1",
  name: "Pencil",
  categoryId: "pencil",
  colorPolicy: "preserve-current",
  settings: {
    tool: "paint",
    shape: "shape",
    shapeAssetId: "pencil-shape",
    shapeRotation: "follow-stroke",
    shapeScatter: 0.51,
    grainMode: "moving",
    grainAssetId: "pencil-grain",
    grainScale: 0.43,
    // Procreate-style Grain Movement, normalized to 0..1.
    grainMovement: 0.99,
    grainDepth: 1,
    grainBrightness: 0,
    grainContrast: 0,
    grainInvert: false,
    grainFiltering: "improved",
    grainBlendMode: "multiply",
    size: 30,
    spacingPercent: 2,
    stabilization: 0,
    startThickness: 1,
    endThickness: 0.6,
    count: 1,
    flow: 1,
    opacity: 1,
    // Preserve the authored shape mask instead of squaring its coverage.
    hardness: 1,
    // Retained at the inert legacy value required by BrushSettings/history.
    blendIntensity: 1,
    blendMode: "intense-blending",
    blendStretch: 0.18,
    blendPaint: 0.14,
    // Retained at the inert legacy value required by BrushSettings/history.
    jitterMaster: 1,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0.1,
    positionJitterLinear: 0.1,
  },
  compatibility: {
    fallbackPolicy: "apply-supported-settings",
    legacyAbiFields: ["blendIntensity", "jitterMaster"],
  },
} as const satisfies BrushPreset;

export const BRUSH_PRESET_REGISTRY = {
  [PENCIL_BRUSH_PRESET.id]: PENCIL_BRUSH_PRESET,
} as const satisfies Readonly<Record<string, BrushPreset>>;

/**
 * Applies the complete generic settings object while preserving the artist's
 * active color. Future Brush Studio presets use this same path.
 */
export function resolveBrushPresetSettings(
  preset: BrushPreset,
  current: Readonly<BrushSettings>,
): BrushSettings {
  return {
    ...current,
    ...preset.settings,
    color: current.color,
  };
}
