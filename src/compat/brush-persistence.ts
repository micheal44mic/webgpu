/**
 * Persisted brush identifiers are an external compatibility contract.
 *
 * New rendering/catalog code must not branch on these historical strings.
 * Ingress adapters translate them here and the rest of the application only
 * sees current identifiers.
 */
export const PENCIL_BRUSH_PERSISTED_ID = "m1m4-pencil-v1" as const;
export const CUSTOM_BRUSH_PERSISTED_ID_PREFIX = "custom-brush:" as const;

export const LEGACY_SHAPE_ASSET_ID = "legacy-shape" as const;
export const PENCIL_SHAPE_ASSET_ID = "pencil-shape" as const;
export const PENCIL_GRAIN_ASSET_ID = "pencil-grain" as const;
export const REMOVED_LEGACY_GRAIN_ASSET_ID = "legacy-grain" as const;

/** Maps the removed Cotton Fleece identity to the supported built-in grain. */
export function migratePersistedGrainAssetId(value: unknown): unknown {
  return value === REMOVED_LEGACY_GRAIN_ASSET_ID
    ? PENCIL_GRAIN_ASSET_ID
    : value;
}
