import { BUILTIN_BRUSH_ASSETS } from "./brush-builtin-assets.ts";
import {
  applyBrushDefinition,
  createBrushDefinition,
  type BrushDefinition,
} from "./brush-definition.ts";
import {
  CUSTOM_BRUSH_PERSISTED_ID_PREFIX,
  PENCIL_BRUSH_PERSISTED_ID,
} from "./compat/brush-persistence.ts";
import type { BrushSettings } from "./engine-types.ts";

export const BRUSH_CATALOG_VERSION = 1 as const;
export const BRUSH_STUDIO_MAX_CUSTOM_BRUSHES = 8;
export const BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH = 48;

export type BrushCatalogCategory = "pencil" | "painting" | "spray-paint";

export interface BuiltinBrushCatalogEntry {
  readonly catalogVersion: typeof BRUSH_CATALOG_VERSION;
  readonly id: string;
  readonly name: string;
  readonly categoryId: BrushCatalogCategory;
  readonly definition: BrushDefinition;
  readonly compatibility: {
    readonly fallbackPolicy: "apply-supported-settings";
    readonly legacyAbiFields: readonly ["blendIntensity", "jitterMaster"];
  };
}

export const PENCIL_BRUSH_PRESET: BuiltinBrushCatalogEntry = {
  catalogVersion: BRUSH_CATALOG_VERSION,
  id: PENCIL_BRUSH_PERSISTED_ID,
  name: "Pencil",
  categoryId: "pencil",
  definition: createBrushDefinition({
    shape: "shape",
    shapeAssetId: "pencil-shape",
    shapeAssetIds: ["pencil-shape"],
    shapeSequenceMode: "ordered",
    shapeInvert: false,
    shapeMaskFormat: "r16float",
    shapeRotation: "follow-stroke",
    shapeScatter: 0.51,
    grainMode: "moving",
    grainAssetId: "pencil-grain",
    grainScale: 0.43,
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
    hardness: 1,
    blendIntensity: 1,
    blendMode: "intense-blending",
    blendStretch: 0.18,
    blendPaint: 0.14,
    blendBlur: 0,
    jitterMaster: 1,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0.1,
    positionJitterLinear: 0.1,
  }),
  compatibility: {
    fallbackPolicy: "apply-supported-settings",
    legacyAbiFields: ["blendIntensity", "jitterMaster"],
  },
};

/** Four resident Shape layers selected cyclically by successive base stamps. */
export const SHAPE_SEQUENCE_BRUSH_PRESET: BuiltinBrushCatalogEntry = {
  catalogVersion: BRUSH_CATALOG_VERSION,
  id: "shape-sequence-v1",
  name: "Shape Sequence",
  categoryId: "painting",
  definition: createBrushDefinition({
    shape: "shape",
    shapeAssetId: "legacy-shape",
    shapeAssetIds: [
      "legacy-shape",
      "pencil-shape",
      "legacy-shape",
      "pencil-shape",
    ],
    shapeSequenceMode: "ordered",
    shapeInvert: false,
    shapeMaskFormat: "r16float",
    shapeRotation: "follow-stroke",
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
    size: 70,
    spacingPercent: 6,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "intense-blending",
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
  }),
  compatibility: {
    fallbackPolicy: "apply-supported-settings",
    legacyAbiFields: ["blendIntensity", "jitterMaster"],
  },
};

export const BUILTIN_BRUSH_CATALOG = {
  [PENCIL_BRUSH_PRESET.id]: PENCIL_BRUSH_PRESET,
  [SHAPE_SEQUENCE_BRUSH_PRESET.id]: SHAPE_SEQUENCE_BRUSH_PRESET,
} as const satisfies Readonly<Record<string, BuiltinBrushCatalogEntry>>;

/** Catalog selection preserves session-owned tool and color. */
export function resolveBrushPresetSettings(
  preset: BuiltinBrushCatalogEntry,
  current: Readonly<BrushSettings>,
): BrushSettings {
  return applyBrushDefinition(preset.definition, current);
}

export type BrushStudioCustomBrushId =
  `${typeof CUSTOM_BRUSH_PERSISTED_ID_PREFIX}${string}`;

export interface BrushStudioCustomBrush {
  readonly id: BrushStudioCustomBrushId;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function isBrushStudioCustomBrushId(
  value: string,
): value is BrushStudioCustomBrushId {
  return value.startsWith(CUSTOM_BRUSH_PERSISTED_ID_PREFIX)
    && value.length > CUSTOM_BRUSH_PERSISTED_ID_PREFIX.length
    && value.length <= 160;
}

let fallbackBrushIdSequence = 0;

export function createBrushStudioCustomBrushId(
  suppliedToken?: string,
): BrushStudioCustomBrushId {
  const token = suppliedToken
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${(++fallbackBrushIdSequence).toString(36)}`;
  const safeToken = token.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120)
    || `${Date.now().toString(36)}-${(++fallbackBrushIdSequence).toString(36)}`;
  return `${CUSTOM_BRUSH_PERSISTED_ID_PREFIX}${safeToken}`;
}

export function normalizeBrushStudioCustomBrushName(name: string): string {
  const normalized = name.replace(/\s+/g, " ").trim()
    .slice(0, BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH);
  return normalized || "New Brush";
}

export function nextBrushStudioCustomBrushName(
  brushes: readonly Pick<BrushStudioCustomBrush, "name">[],
): string {
  const usedNames = new Set(brushes.map((brush) => (
    normalizeBrushStudioCustomBrushName(brush.name).toLocaleLowerCase()
  )));
  if (!usedNames.has("new brush")) return "New Brush";
  for (let suffix = 2; suffix <= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES + 1; suffix += 1) {
    const candidate = `New Brush ${suffix}`;
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `New Brush ${brushes.length + 1}`;
}

export function uniqueBrushStudioCustomBrushName(
  requestedName: string,
  brushes: readonly Pick<BrushStudioCustomBrush, "name">[],
): string {
  const base = normalizeBrushStudioCustomBrushName(requestedName);
  const usedNames = new Set(brushes.map((brush) => (
    normalizeBrushStudioCustomBrushName(brush.name).toLocaleLowerCase()
  )));
  if (!usedNames.has(base.toLocaleLowerCase())) return base;
  for (let suffix = 2; suffix <= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES + 1; suffix += 1) {
    const ending = ` ${suffix}`;
    const candidate = `${base.slice(
      0,
      BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH - ending.length,
    )}${ending}`;
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return base;
}

export function normalizeCustomBrushCatalog(value: unknown): BrushStudioCustomBrush[] {
  if (!Array.isArray(value)) return [];
  const normalized: BrushStudioCustomBrush[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as Partial<BrushStudioCustomBrush>;
    if (
      typeof candidate.id !== "string"
      || !isBrushStudioCustomBrushId(candidate.id)
      || seen.has(candidate.id)
    ) {
      continue;
    }
    const createdAt = typeof candidate.createdAt === "number"
      && Number.isFinite(candidate.createdAt)
      ? candidate.createdAt
      : 0;
    const updatedAt = typeof candidate.updatedAt === "number"
      && Number.isFinite(candidate.updatedAt)
      ? candidate.updatedAt
      : createdAt;
    normalized.push({
      id: candidate.id,
      name: normalizeBrushStudioCustomBrushName(
        typeof candidate.name === "string" ? candidate.name : "New Brush",
      ),
      createdAt,
      updatedAt,
    });
    seen.add(candidate.id);
    if (normalized.length >= BRUSH_STUDIO_MAX_CUSTOM_BRUSHES) break;
  }
  return normalized;
}

/** Neutral starting point for a new custom brush; session state is supplied explicitly. */
export function createBrushStudioBaseSettings(
  defaults: Readonly<BrushSettings>,
  color: BrushSettings["color"],
): BrushSettings {
  return {
    ...defaults,
    color,
    tool: "paint",
    shape: "circle",
    shapeAssetId: "legacy-shape",
    shapeAssetIds: ["legacy-shape"],
    shapeSequenceMode: "ordered",
    shapeInvert: false,
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
    size: 50,
    spacingPercent: 3,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
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
  };
}

// Catalog metadata may reference only assets owned by the built-in registry.
for (const preset of Object.values(BUILTIN_BRUSH_CATALOG)) {
  const { shapeAssetId, shapeAssetIds, grainAssetId } = preset.definition.settings;
  for (const assetId of shapeAssetIds ?? [shapeAssetId]) {
    if (assetId !== "legacy-shape" && !(assetId in BUILTIN_BRUSH_ASSETS)) {
      throw new Error(`Unknown built-in Shape asset: ${assetId}.`);
    }
  }
  if (grainAssetId !== "pencil-grain" || !(grainAssetId in BUILTIN_BRUSH_ASSETS)) {
    throw new Error(`Unknown built-in Grain asset: ${grainAssetId}.`);
  }
}
