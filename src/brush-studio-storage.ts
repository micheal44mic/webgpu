import {
  normalizeCustomBrushCatalog,
  type BrushStudioCustomBrush,
} from "./brush-catalog.ts";
import {
  normalizeBrushDefinition,
  type BrushDefinition,
} from "./brush-definition.ts";

const BRUSH_STUDIO_SETTINGS_KEY = "m1m4.brush-studio.settings.v1";
const BRUSH_STUDIO_LIBRARY_STATE_KEY = "m1m4.brush-studio.library-state.v1";
const BRUSH_STUDIO_ASSET_DATABASE = "m1m4-brush-studio";
const BRUSH_STUDIO_ASSET_STORE = "assets";
const BRUSH_STUDIO_ASSET_DATABASE_VERSION = 1;

export type BrushStudioAssetKind = "shape" | "grain";

export type BrushStudioSavedBrush = BrushDefinition;

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

type BrushStudioSavedBrushMap = Record<string, unknown>;

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
  if (!saved) return null;
  try {
    return normalizeBrushDefinition(saved);
  } catch {
    return null;
  }
}

export function saveBrushStudioSavedBrush(
  brushId: string,
  brush: BrushStudioSavedBrush,
): void {
  const saved = readSavedBrushMap();
  saved[brushId] = normalizeBrushDefinition(brush);
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
