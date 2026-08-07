import type { BrushSettings } from "./engine-types";

const BRUSH_STUDIO_SETTINGS_KEY = "m1m4.brush-studio.settings.v1";
const BRUSH_STUDIO_LIBRARY_STATE_KEY = "m1m4.brush-studio.library-state.v1";
const BRUSH_STUDIO_ASSET_DATABASE = "m1m4-brush-studio";
const BRUSH_STUDIO_ASSET_STORE = "assets";
const BRUSH_STUDIO_ASSET_DATABASE_VERSION = 1;

export const BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX = "custom-brush:";
export const BRUSH_STUDIO_MAX_CUSTOM_BRUSHES = 8;
export const BRUSH_STUDIO_CUSTOM_BRUSH_NAME_MAX_LENGTH = 48;

export type BrushStudioAssetKind = "shape" | "grain";

export type BrushStudioPersistedSettings = Omit<BrushSettings, "color" | "tool">;

export interface BrushStudioSavedBrush {
  readonly version: 1;
  readonly settings: BrushStudioPersistedSettings;
  readonly shapeAssetKey: string | null;
  readonly grainAssetKey: string | null;
}

export interface BrushStudioStoredAsset {
  readonly key: string;
  readonly kind: BrushStudioAssetKind;
  readonly name: string;
  readonly mimeType: string;
  readonly blob: Blob;
  readonly updatedAt: number;
}

export interface BrushStudioLibraryState {
  readonly version: 2;
  readonly activeBrushId: string;
  readonly customBrushes: readonly BrushStudioCustomBrush[];
}

export type BrushStudioCustomBrushId =
  `${typeof BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX}${string}`;

export interface BrushStudioCustomBrush {
  readonly id: BrushStudioCustomBrushId;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type BrushStudioSavedBrushMap = Record<string, BrushStudioSavedBrush>;

function readSavedBrushMap(): BrushStudioSavedBrushMap {
  try {
    const serialized = window.localStorage.getItem(BRUSH_STUDIO_SETTINGS_KEY);
    if (!serialized) return {};
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as BrushStudioSavedBrushMap;
  } catch {
    return {};
  }
}

export function loadBrushStudioSavedBrush(brushId: string): BrushStudioSavedBrush | null {
  const saved = readSavedBrushMap()[brushId];
  if (!saved || saved.version !== 1 || !saved.settings) return null;
  return saved;
}

export function saveBrushStudioSavedBrush(
  brushId: string,
  brush: BrushStudioSavedBrush,
): void {
  const saved = readSavedBrushMap();
  saved[brushId] = brush;
  window.localStorage.setItem(BRUSH_STUDIO_SETTINGS_KEY, JSON.stringify(saved));
}

export function deleteBrushStudioSavedBrush(brushId: string): void {
  const saved = readSavedBrushMap();
  delete saved[brushId];
  window.localStorage.setItem(BRUSH_STUDIO_SETTINGS_KEY, JSON.stringify(saved));
}

export function loadBrushStudioLibraryState(): BrushStudioLibraryState | null {
  try {
    const serialized = window.localStorage.getItem(BRUSH_STUDIO_LIBRARY_STATE_KEY);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const candidate = parsed as {
      readonly version?: unknown;
      readonly activeBrushId?: unknown;
      readonly customBrushes?: unknown;
    };
    if (
      (candidate.version !== 1 && candidate.version !== 2)
      || typeof candidate.activeBrushId !== "string"
    ) {
      return null;
    }
    const customBrushes = candidate.version === 2
      ? normalizeCustomBrushCatalog(candidate.customBrushes)
      : [];
    return {
      version: 2,
      activeBrushId: candidate.activeBrushId,
      customBrushes,
    };
  } catch {
    return null;
  }
}

export function saveBrushStudioLibraryState(
  activeBrushId: string,
  customBrushes: readonly BrushStudioCustomBrush[] = [],
): void {
  const state: BrushStudioLibraryState = {
    version: 2,
    activeBrushId,
    customBrushes: normalizeCustomBrushCatalog(customBrushes),
  };
  window.localStorage.setItem(BRUSH_STUDIO_LIBRARY_STATE_KEY, JSON.stringify(state));
}

export function isBrushStudioCustomBrushId(
  value: string,
): value is BrushStudioCustomBrushId {
  return value.startsWith(BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX)
    && value.length > BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX.length
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
  return `${BRUSH_STUDIO_CUSTOM_BRUSH_ID_PREFIX}${safeToken}`;
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
    shapeInvert: false,
    shapeRotation: "fixed",
    shapeScatter: 0,
    grainMode: "off",
    grainAssetId: "legacy-grain",
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

function normalizeCustomBrushCatalog(value: unknown): BrushStudioCustomBrush[] {
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

export function brushStudioAssetStorageKey(
  brushId: string,
  kind: BrushStudioAssetKind,
  assetId?: string,
): string {
  return assetId ? `${brushId}:${kind}:${assetId}` : `${brushId}:${kind}`;
}

function openBrushStudioAssetDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(
      BRUSH_STUDIO_ASSET_DATABASE,
      BRUSH_STUDIO_ASSET_DATABASE_VERSION,
    );
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BRUSH_STUDIO_ASSET_STORE)) {
        database.createObjectStore(BRUSH_STUDIO_ASSET_STORE, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Brush Studio asset database unavailable."));
    }, { once: true });
    request.addEventListener("blocked", () => {
      reject(new Error("Brush Studio asset database upgrade blocked."));
    }, { once: true });
  });
}

async function runAssetTransaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openBrushStudioAssetDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(BRUSH_STUDIO_ASSET_STORE, mode);
      const request = operation(transaction.objectStore(BRUSH_STUDIO_ASSET_STORE));
      let result: T;
      let requestCompleted = false;
      request.addEventListener("success", () => {
        result = request.result;
        requestCompleted = true;
      }, { once: true });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("Brush Studio asset operation failed."));
      }, { once: true });
      transaction.addEventListener("complete", () => {
        if (requestCompleted) resolve(result);
      }, { once: true });
      transaction.addEventListener("abort", () => {
        reject(transaction.error ?? new Error("Brush Studio asset transaction aborted."));
      }, { once: true });
    });
  } finally {
    database.close();
  }
}

export async function saveBrushStudioAsset(
  key: string,
  kind: BrushStudioAssetKind,
  file: Blob,
  name: string,
): Promise<void> {
  const record: BrushStudioStoredAsset = {
    key,
    kind,
    name,
    mimeType: file.type || "image/png",
    blob: file,
    updatedAt: Date.now(),
  };
  await runAssetTransaction("readwrite", (store) => store.put(record));
}

export async function loadBrushStudioAsset(
  key: string,
): Promise<BrushStudioStoredAsset | null> {
  const result = await runAssetTransaction<BrushStudioStoredAsset | undefined>(
    "readonly",
    (store) => store.get(key),
  );
  return result ?? null;
}

export async function deleteBrushStudioAsset(key: string): Promise<void> {
  await runAssetTransaction("readwrite", (store) => store.delete(key));
}
