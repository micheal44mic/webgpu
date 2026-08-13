import {
  CHUNK_STORE,
  GENERATION_INDEX,
  MANIFEST_STORE,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_INDEX,
  PROJECT_MANIFEST_MAGIC,
  PROJECT_STORAGE_DATABASE_VERSION,
  PROJECT_STORE,
  ProjectStorageError,
  type ProjectManifestV1,
  type ProjectSaveRequestV1,
  type ProjectStoredChunkV1,
  type ProjectSummaryV1,
} from "./project-storage-schema.ts";
import {
  normalizeProjectTitle,
  validateLoadedProject,
} from "./project-storage-codec.ts";
import {
  projectChunkKey,
  projectManifestKey,
} from "./project-storage-keys.ts";

export interface StoredManifestRecord {
  readonly key: string;
  readonly projectId: string;
  readonly generationId: string;
  readonly manifest: ProjectManifestV1;
}

export interface MemoryDatabase {
  readonly projects: Map<string, ProjectSummaryV1>;
  readonly manifests: Map<string, StoredManifestRecord>;
  readonly chunks: Map<string, ProjectStoredChunkV1>;
}

const MEMORY_DATABASES = new Map<string, MemoryDatabase>();

export function memoryDatabase(name: string): MemoryDatabase {
  let database = MEMORY_DATABASES.get(name);
  if (!database) {
    database = {
      projects: new Map(),
      manifests: new Map(),
      chunks: new Map(),
    };
    MEMORY_DATABASES.set(name, database);
  }
  return database;
}

function cloneFallback(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    const source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copied = source.slice().buffer;
    if (value instanceof DataView) return new DataView(copied);
    const Constructor = value.constructor as unknown as {
      new (buffer: ArrayBuffer): ArrayBufferView;
    };
    return new Constructor(copied);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return value.slice(0, value.size, value.type);
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    value.forEach((entry) => copy.push(cloneFallback(entry, seen)));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = cloneFallback(entry, seen);
  }
  return copy;
}

export function cloneStructured<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return cloneFallback(value) as T;
}

let fallbackIdSequence = 0;

export function uniqueToken(prefix: "project" | "generation"): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  fallbackIdSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}`;
}

export function requestResult<T>(request: IDBRequest<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new ProjectStorageError(`${label}: IndexedDB request failed.`));
    }, { once: true });
  });
}

export function transactionCompletion(
  transaction: IDBTransaction,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new ProjectStorageError(`${label}: transaction aborted.`));
    }, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new ProjectStorageError(`${label}: transaction failed.`));
    }, { once: true });
  });
}

export function openTransaction(
  database: IDBDatabase,
  stores: string | readonly string[],
  mode: IDBTransactionMode,
  strictDurability = false,
): IDBTransaction {
  const storeNames = typeof stores === "string" ? stores : [...stores];
  if (strictDurability) {
    try {
      return database.transaction(storeNames, mode, { durability: "strict" });
    } catch {
      // Safari versions without the durability option still provide atomicity.
    }
  }
  return database.transaction(storeNames, mode);
}

export function asStorageError(error: unknown, label: string): ProjectStorageError {
  if (error instanceof ProjectStorageError) return error;
  if (
    typeof DOMException !== "undefined"
    && error instanceof DOMException
    && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return new ProjectStorageError(
      `${label}: browser storage quota was exceeded.`,
      "quota",
      error,
    );
  }
  return new ProjectStorageError(
    `${label}: ${error instanceof Error ? error.message : String(error)}`,
    "database",
    error,
  );
}

export async function openProjectDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, PROJECT_STORAGE_DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
        const store = database.createObjectStore(MANIFEST_STORE, { keyPath: "key" });
        store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const store = database.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
        store.createIndex(GENERATION_INDEX, "generationKey", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new ProjectStorageError("Project database is unavailable."));
    }, { once: true });
    request.addEventListener("blocked", () => {
      reject(new ProjectStorageError(
        "Project database upgrade is blocked by another tab.",
        "unavailable",
      ));
    }, { once: true });
  });
}

export function deleteIndexRecords(
  index: IDBIndex,
  query: IDBValidKey,
  shouldDelete: (value: unknown) => boolean = () => true,
): void {
  const cursorRequest = index.openCursor(query);
  cursorRequest.addEventListener("success", () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (shouldDelete(cursor.value)) cursor.delete();
    cursor.continue();
  });
}

export interface MaterializedGeneration {
  readonly summary: ProjectSummaryV1;
  readonly manifestRecord: StoredManifestRecord;
  readonly chunks: readonly ProjectStoredChunkV1[];
}

export function materializeGeneration(
  request: ProjectSaveRequestV1,
  projectId: string,
  previous: ProjectSummaryV1 | null,
): MaterializedGeneration {
  const name = normalizeProjectTitle(request.name);
  const generationId = uniqueToken("generation");
  const wallClock = Date.now();
  const createdAt = previous?.createdAt ?? request.createdAt ?? wallClock;
  const savedAt = Math.max(wallClock, createdAt, previous?.updatedAt ?? 0);
  const snapshot = cloneStructured(request.snapshot);
  const manifest: ProjectManifestV1 = {
    magic: PROJECT_MANIFEST_MAGIC,
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    projectId,
    generationId,
    projectName: name,
    createdAt,
    savedAt,
    snapshot,
  };
  const generationKeyValue = projectManifestKey(projectId, generationId);
  const chunks: ProjectStoredChunkV1[] = request.chunks.map((chunk) => ({
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    key: projectChunkKey(projectId, generationId, chunk.layerId, chunk.chunkIndex),
    projectId,
    generationId,
    generationKey: generationKeyValue,
    layerId: chunk.layerId,
    chunkIndex: chunk.chunkIndex,
    storage: chunk.storage,
    rawBytes: chunk.rawBytes,
    storedBytes: chunk.storedBytes,
    sourceHash: chunk.sourceHash,
    // Never transfer/detach the engine's authoritative compression buffer.
    bytes: chunk.bytes.slice(0),
  }));
  const thumbnail = request.thumbnail === undefined
    ? cloneStructured(previous?.thumbnail ?? null)
    : cloneStructured(request.thumbnail);
  const summary: ProjectSummaryV1 = {
    schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
    id: projectId,
    name,
    createdAt,
    updatedAt: savedAt,
    headGenerationId: generationId,
    documentWidth: snapshot.document.width,
    documentHeight: snapshot.document.height,
    layerCount: snapshot.layers.length,
    storedBytes: chunks.reduce((total, chunk) => total + chunk.storedBytes, 0)
      + (thumbnail?.size ?? 0),
    thumbnail,
  };
  const manifestRecord: StoredManifestRecord = {
    key: generationKeyValue,
    projectId,
    generationId,
    manifest,
  };
  validateLoadedProject({ summary, manifest, chunks });
  return { summary, manifestRecord, chunks };
}
