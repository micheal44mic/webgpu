import {
  isCustomGrainAssetId,
  isCustomShapeAssetId,
} from "./brush-asset-registry.ts";
import {
  LEGACY_SHAPE_ASSET_ID,
  migratePersistedGrainAssetId,
  PENCIL_GRAIN_ASSET_ID,
  PENCIL_SHAPE_ASSET_ID,
} from "./compat/brush-persistence.ts";
import type { BrushSettings } from "./engine-types.ts";
import type { CustomBrushShapeAssetId } from "./engine-types.ts";
import { MAX_BRUSH_SHAPE_SEQUENCE_LENGTH } from "./brush-shape-sequence-core.ts";

/** Current durable ABI for built-in, saved and transferred brush definitions. */
export const BRUSH_DEFINITION_VERSION = 1 as const;

export type BrushDefinitionVersion = typeof BRUSH_DEFINITION_VERSION;
export type BrushDefinitionSettings = Omit<BrushSettings, "color" | "tool">;

export interface BrushDefinitionShapeAssetRef {
  readonly assetId: CustomBrushShapeAssetId;
  readonly storageKey: string;
}

/**
 * A brush owns rendering behavior and optional persisted source references.
 * Active color and active tool deliberately remain session state.
 */
export interface BrushDefinition {
  readonly version: BrushDefinitionVersion;
  readonly settings: BrushDefinitionSettings;
  readonly shapeAssetKey: string | null;
  /** Complete persisted source set. `shapeAssetKey` remains the legacy primary alias. */
  readonly shapeAssetRefs?: readonly BrushDefinitionShapeAssetRef[];
  readonly grainAssetKey: string | null;
}

export class BrushDefinitionValidationError extends TypeError {
  readonly field: string;

  constructor(field: string) {
    super(`Invalid brush definition field: ${field}.`);
    this.name = "BrushDefinitionValidationError";
    this.field = field;
  }
}

type JsonRecord = Record<string, unknown>;

export interface BrushDefinitionNormalizationOptions {
  /** Strict transfer ingress rejects missing/unknown values instead of migrating them. */
  readonly strict?: boolean;
  readonly fallback?: Readonly<BrushDefinitionSettings>;
}

function asRecord(value: unknown, field: string, strict: boolean): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  if (strict) throw new BrushDefinitionValidationError(field);
  return {};
}

function finiteNumber(
  record: JsonRecord,
  key: keyof BrushDefinitionSettings,
  fallback: number,
  minimum: number,
  maximum: number,
  strict: boolean,
  integer = false,
  optional = false,
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
  if (strict && !(optional && value === undefined)) {
    throw new BrushDefinitionValidationError(`settings.${key}`);
  }
  return fallback;
}

function booleanValue(
  record: JsonRecord,
  key: keyof BrushDefinitionSettings,
  fallback: boolean,
  strict: boolean,
): boolean {
  const value = record[key];
  if (typeof value === "boolean") return value;
  if (strict) throw new BrushDefinitionValidationError(`settings.${key}`);
  return fallback;
}

function enumValue<const T extends readonly string[]>(
  record: JsonRecord,
  key: keyof BrushDefinitionSettings,
  values: T,
  fallback: T[number],
  strict: boolean,
  optional = false,
): T[number] {
  const value = record[key];
  if (typeof value === "string" && values.includes(value)) return value as T[number];
  if (strict && !(optional && value === undefined)) {
    throw new BrushDefinitionValidationError(`settings.${key}`);
  }
  return fallback;
}

export function brushDefinitionSettingsFromRuntime(
  settings: Readonly<BrushSettings>,
): BrushDefinitionSettings {
  const { color: _activeColor, tool: _activeTool, ...definitionSettings } = settings;
  return {
    ...definitionSettings,
    shapeAssetIds: definitionSettings.shapeAssetIds
      ? [...definitionSettings.shapeAssetIds]
      : undefined,
  };
}

export const DEFAULT_BRUSH_DEFINITION_SETTINGS: Readonly<BrushDefinitionSettings> = Object.freeze({
  shape: "circle",
  tipFalloff: "standard",
  shapeAssetId: "legacy-shape",
  shapeAssetIds: ["legacy-shape"] as const,
  shapeSequenceMode: "ordered",
  shapeInvert: false,
  shapeMaskFormat: "r16float",
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
  blendBlur: 0,
  jitterMaster: 1,
  hueJitterDegrees: 12,
  saturationJitter: 0.18,
  lightnessJitter: 0.12,
  darknessJitter: 0.18,
  jitterPerCopy: false,
  positionJitterLateral: 1,
  positionJitterLinear: 1,
});

/**
 * Single normalizer for local storage, built-ins and the transfer codec.
 * Lenient mode migrates old/missing fields; strict mode validates imports.
 */
export function normalizeBrushDefinitionSettings(
  value: unknown,
  options: BrushDefinitionNormalizationOptions = {},
): BrushDefinitionSettings {
  const strict = options.strict === true;
  const fallback = options.fallback ?? DEFAULT_BRUSH_DEFINITION_SETTINGS;
  const record = asRecord(value, "settings", strict);
  if (strict && ("color" in record || "tool" in record)) {
    throw new BrushDefinitionValidationError("settings.color/tool");
  }

  const rawShapeAssetId = record.shapeAssetId;
  let shapeAssetId = rawShapeAssetId === LEGACY_SHAPE_ASSET_ID
    || rawShapeAssetId === PENCIL_SHAPE_ASSET_ID
    || isCustomShapeAssetId(rawShapeAssetId)
    ? rawShapeAssetId
    : (() => {
      if (strict) throw new BrushDefinitionValidationError("settings.shapeAssetId");
      return fallback.shapeAssetId;
    })();
  const rawShapeAssetIds = record.shapeAssetIds;
  let shapeAssetIds: BrushDefinitionSettings["shapeAssetIds"];
  if (rawShapeAssetIds === undefined) {
    shapeAssetIds = [shapeAssetId];
  } else if (
    Array.isArray(rawShapeAssetIds)
    && rawShapeAssetIds.length >= 1
    && rawShapeAssetIds.length <= MAX_BRUSH_SHAPE_SEQUENCE_LENGTH
    && rawShapeAssetIds.every((assetId) => (
      assetId === LEGACY_SHAPE_ASSET_ID
      || assetId === PENCIL_SHAPE_ASSET_ID
      || isCustomShapeAssetId(assetId)
    ))
  ) {
    shapeAssetIds = [...rawShapeAssetIds];
    shapeAssetId = shapeAssetIds[0];
  } else {
    if (strict) throw new BrushDefinitionValidationError("settings.shapeAssetIds");
    shapeAssetIds = fallback.shapeAssetIds?.length
      ? [...fallback.shapeAssetIds]
      : [shapeAssetId];
    shapeAssetId = shapeAssetIds[0];
  }

  const migratedGrainAssetId = migratePersistedGrainAssetId(record.grainAssetId);
  const grainAssetId = migratedGrainAssetId === PENCIL_GRAIN_ASSET_ID
    || isCustomGrainAssetId(migratedGrainAssetId)
    ? migratedGrainAssetId
    : (() => {
      if (strict) throw new BrushDefinitionValidationError("settings.grainAssetId");
      return fallback.grainAssetId;
    })();

  return {
    shape: enumValue(record, "shape", ["circle", "shape"] as const, fallback.shape, strict),
    tipFalloff: enumValue(
      record,
      "tipFalloff",
      ["standard", "gaussian"] as const,
      fallback.tipFalloff ?? "standard",
      strict,
      true,
    ),
    shapeAssetId,
    shapeAssetIds,
    shapeSequenceMode: enumValue(
      record,
      "shapeSequenceMode",
      ["ordered", "random"] as const,
      fallback.shapeSequenceMode,
      strict,
      true,
    ),
    shapeInvert: booleanValue(record, "shapeInvert", fallback.shapeInvert, strict),
    shapeMaskFormat: enumValue(
      record,
      "shapeMaskFormat",
      ["r8unorm", "r16float"] as const,
      fallback.shapeMaskFormat,
      strict,
      true,
    ),
    shapeRotation: enumValue(
      record,
      "shapeRotation",
      ["fixed", "follow-stroke"] as const,
      fallback.shapeRotation,
      strict,
    ),
    shapeScatter: finiteNumber(record, "shapeScatter", fallback.shapeScatter, 0, 1, strict),
    grainMode: enumValue(
      record,
      "grainMode",
      ["off", "texturized", "moving"] as const,
      fallback.grainMode,
      strict,
    ),
    grainAssetId,
    grainScale: finiteNumber(record, "grainScale", fallback.grainScale, 0.1, 4, strict),
    grainMovement: finiteNumber(record, "grainMovement", fallback.grainMovement, 0, 1, strict),
    grainDepth: finiteNumber(record, "grainDepth", fallback.grainDepth, 0, 1, strict),
    grainBrightness: finiteNumber(
      record,
      "grainBrightness",
      fallback.grainBrightness,
      -1,
      1,
      strict,
    ),
    grainContrast: finiteNumber(
      record,
      "grainContrast",
      fallback.grainContrast,
      -1,
      1,
      strict,
    ),
    grainInvert: booleanValue(record, "grainInvert", fallback.grainInvert, strict),
    grainFiltering: enumValue(
      record,
      "grainFiltering",
      ["no", "classic", "improved"] as const,
      fallback.grainFiltering,
      strict,
    ),
    grainBlendMode: enumValue(
      record,
      "grainBlendMode",
      ["multiply"] as const,
      fallback.grainBlendMode,
      strict,
    ),
    size: finiteNumber(record, "size", fallback.size, 1, 1500, strict),
    spacingPercent: finiteNumber(
      record,
      "spacingPercent",
      fallback.spacingPercent,
      0.25,
      99,
      strict,
    ),
    stabilization: finiteNumber(
      record,
      "stabilization",
      fallback.stabilization,
      0,
      1,
      strict,
    ),
    startThickness: finiteNumber(
      record,
      "startThickness",
      fallback.startThickness,
      0,
      2,
      strict,
    ),
    endThickness: finiteNumber(record, "endThickness", fallback.endThickness, 0, 2, strict),
    count: finiteNumber(record, "count", fallback.count, 1, 24, strict, true),
    flow: finiteNumber(record, "flow", fallback.flow, 0.001, 1, strict),
    opacity: finiteNumber(record, "opacity", fallback.opacity, 0, 1, strict),
    hardness: finiteNumber(record, "hardness", 1, 1, 1, strict),
    blendIntensity: finiteNumber(record, "blendIntensity", 1, 1, 1, strict),
    blendMode: enumValue(
      record,
      "blendMode",
      ["light-glaze", "uniformed-glaze", "intense-blending"] as const,
      "light-glaze",
      strict,
    ),
    blendStretch: finiteNumber(record, "blendStretch", fallback.blendStretch, 0, 1, strict),
    blendPaint: finiteNumber(record, "blendPaint", fallback.blendPaint, 0, 1, strict),
    // Blend Blur was added to v1 after the first files shipped.
    blendBlur: finiteNumber(record, "blendBlur", fallback.blendBlur, 0, 1, strict, false, true),
    jitterMaster: finiteNumber(record, "jitterMaster", 1, 1, 1, strict),
    hueJitterDegrees: finiteNumber(
      record,
      "hueJitterDegrees",
      fallback.hueJitterDegrees,
      0,
      180,
      strict,
    ),
    saturationJitter: finiteNumber(
      record,
      "saturationJitter",
      fallback.saturationJitter,
      0,
      1,
      strict,
    ),
    lightnessJitter: finiteNumber(
      record,
      "lightnessJitter",
      fallback.lightnessJitter,
      0,
      1,
      strict,
    ),
    darknessJitter: finiteNumber(
      record,
      "darknessJitter",
      fallback.darknessJitter,
      0,
      1,
      strict,
    ),
    jitterPerCopy: booleanValue(record, "jitterPerCopy", fallback.jitterPerCopy, strict),
    positionJitterLateral: finiteNumber(
      record,
      "positionJitterLateral",
      fallback.positionJitterLateral,
      0,
      1,
      strict,
    ),
    positionJitterLinear: finiteNumber(
      record,
      "positionJitterLinear",
      fallback.positionJitterLinear,
      0,
      1,
      strict,
    ),
  };
}

function assetStorageKey(value: unknown, field: string, strict: boolean): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.length > 0 && value.length <= 512) return value;
  if (strict) throw new BrushDefinitionValidationError(field);
  return null;
}

function shapeAssetRefs(
  value: unknown,
  strict: boolean,
): readonly BrushDefinitionShapeAssetRef[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_BRUSH_SHAPE_SEQUENCE_LENGTH) {
    if (strict) throw new BrushDefinitionValidationError("shapeAssetRefs");
    return undefined;
  }
  const result: BrushDefinitionShapeAssetRef[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const record = asRecord(value[index], `shapeAssetRefs[${index}]`, strict);
    const assetId = record.assetId;
    const storageKey = assetStorageKey(
      record.storageKey,
      `shapeAssetRefs[${index}].storageKey`,
      strict,
    );
    if (!isCustomShapeAssetId(assetId) || !storageKey || seen.has(assetId)) {
      if (strict) throw new BrushDefinitionValidationError(`shapeAssetRefs[${index}]`);
      return undefined;
    }
    seen.add(assetId);
    result.push({ assetId, storageKey });
  }
  return result;
}

export function normalizeBrushDefinition(
  value: unknown,
  options: BrushDefinitionNormalizationOptions = {},
): BrushDefinition {
  const strict = options.strict === true;
  const record = asRecord(value, "definition", strict);
  const version = record.version ?? BRUSH_DEFINITION_VERSION;
  if (version !== BRUSH_DEFINITION_VERSION) {
    throw new BrushDefinitionValidationError("version");
  }
  const refs = shapeAssetRefs(record.shapeAssetRefs, strict);
  return {
    version: BRUSH_DEFINITION_VERSION,
    settings: normalizeBrushDefinitionSettings(record.settings, options),
    shapeAssetKey: assetStorageKey(record.shapeAssetKey, "shapeAssetKey", strict),
    ...(refs ? { shapeAssetRefs: refs } : {}),
    grainAssetKey: assetStorageKey(record.grainAssetKey, "grainAssetKey", strict),
  };
}

export function createBrushDefinition(
  settings: Readonly<BrushSettings> | Readonly<BrushDefinitionSettings>,
  assets: {
    readonly shapeAssetKey?: string | null;
    readonly shapeAssetRefs?: readonly BrushDefinitionShapeAssetRef[];
    readonly grainAssetKey?: string | null;
  } = {},
): BrushDefinition {
  const definitionSettings = "color" in settings || "tool" in settings
    ? brushDefinitionSettingsFromRuntime(settings as Readonly<BrushSettings>)
    : {
      ...settings,
      shapeAssetIds: settings.shapeAssetIds ? [...settings.shapeAssetIds] : undefined,
    } as BrushDefinitionSettings;
  return {
    version: BRUSH_DEFINITION_VERSION,
    settings: definitionSettings,
    shapeAssetKey: assets.shapeAssetKey ?? null,
    ...(assets.shapeAssetRefs ? { shapeAssetRefs: [...assets.shapeAssetRefs] } : {}),
    grainAssetKey: assets.grainAssetKey ?? null,
  };
}

/** Applies a definition without taking ownership of session color/tool state. */
export function applyBrushDefinition(
  definition: Readonly<BrushDefinition>,
  current: Readonly<BrushSettings>,
): BrushSettings {
  return {
    ...current,
    ...definition.settings,
    shapeAssetIds: definition.settings.shapeAssetIds
      ? [...definition.settings.shapeAssetIds]
      : [definition.settings.shapeAssetId],
    color: current.color,
    tool: current.tool,
  };
}
