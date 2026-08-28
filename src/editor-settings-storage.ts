export interface EditorGuidePreferences {
  readonly rulers: boolean;
  readonly grid: boolean;
  readonly snapping: boolean;
  readonly symmetryEnabled: boolean;
  readonly symmetryAngleDegrees: number;
}

export interface EditorSettingsStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredEditorGuidePreferences {
  readonly version: 1;
  readonly preferences: EditorGuidePreferences;
}

export const EDITOR_SETTINGS_STORAGE_KEY = "m1m4.editor-settings.v1";

export const DEFAULT_EDITOR_GUIDE_PREFERENCES: Readonly<EditorGuidePreferences> =
  Object.freeze({
    rulers: false,
    grid: false,
    snapping: true,
    symmetryEnabled: false,
    symmetryAngleDegrees: 90,
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSymmetryAngleDegrees(
  value: unknown,
  fallback = DEFAULT_EDITOR_GUIDE_PREFERENCES.symmetryAngleDegrees,
): number {
  const finiteFallback = Number.isFinite(fallback)
    ? fallback
    : DEFAULT_EDITOR_GUIDE_PREFERENCES.symmetryAngleDegrees;
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : finiteFallback;
  const rounded = Math.round(numeric);
  return ((rounded % 180) + 180) % 180;
}

function normalizedPreferences(value: unknown): EditorGuidePreferences {
  const candidate = isRecord(value) ? value : {};
  return {
    rulers: typeof candidate.rulers === "boolean"
      ? candidate.rulers
      : DEFAULT_EDITOR_GUIDE_PREFERENCES.rulers,
    grid: typeof candidate.grid === "boolean"
      ? candidate.grid
      : DEFAULT_EDITOR_GUIDE_PREFERENCES.grid,
    snapping: typeof candidate.snapping === "boolean"
      ? candidate.snapping
      : DEFAULT_EDITOR_GUIDE_PREFERENCES.snapping,
    symmetryEnabled: typeof candidate.symmetryEnabled === "boolean"
      ? candidate.symmetryEnabled
      : DEFAULT_EDITOR_GUIDE_PREFERENCES.symmetryEnabled,
    symmetryAngleDegrees: normalizeSymmetryAngleDegrees(
      candidate.symmetryAngleDegrees,
      candidate.symmetryAxis === "horizontal"
        ? 0
        : candidate.symmetryAxis === "vertical"
          ? 90
          : DEFAULT_EDITOR_GUIDE_PREFERENCES.symmetryAngleDegrees,
    ),
  };
}

function defaultPreferences(): EditorGuidePreferences {
  return { ...DEFAULT_EDITOR_GUIDE_PREFERENCES };
}

export function loadEditorGuidePreferences(
  storage: EditorSettingsStoragePort | null,
): EditorGuidePreferences {
  if (!storage) return defaultPreferences();
  try {
    const serialized = storage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    if (!serialized) return defaultPreferences();
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== 1) return defaultPreferences();
    return normalizedPreferences(parsed.preferences);
  } catch {
    return defaultPreferences();
  }
}

export function saveEditorGuidePreferences(
  storage: EditorSettingsStoragePort | null,
  preferences: Readonly<EditorGuidePreferences>,
): boolean {
  if (!storage) return false;
  const stored: StoredEditorGuidePreferences = {
    version: 1,
    preferences: normalizedPreferences(preferences),
  };
  try {
    storage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}
