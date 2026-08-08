import {
  HISTORY_LOCAL_STORAGE_DATABASE,
  HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
  type HistoryManifestV1,
  type HistorySegmentDescriptorV1,
} from "./history-storage-core";

const SESSION_STORE = "sessions";
const MANIFEST_STORE = "manifestHeads";
const SEGMENT_STORE = "segments";
const CHUNK_STORE = "idbChunks";

interface HistorySessionRecord {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly leaseExpiresAt: number;
  readonly opfsMayExist?: boolean;
  readonly lockProtected?: boolean;
}

export interface HistorySessionCleanupCandidate {
  readonly sessionId: string;
  readonly leaseExpiresAt: number;
  readonly lockProtected: boolean;
}

interface HistorySegmentRecord {
  readonly key: string;
  readonly sessionId: string;
  readonly segmentId: string;
  readonly descriptor: HistorySegmentDescriptorV1;
}

interface HistoryChunkRecord {
  readonly key: string;
  readonly sessionId: string;
  readonly segmentKey: string;
  readonly segmentId: string;
  readonly chunkIndex: number;
  readonly bytes: ArrayBuffer;
}

function segmentKey(sessionId: string, segmentId: string): string {
  return `${sessionId}:${segmentId}`;
}

function chunkKey(sessionId: string, segmentId: string, chunkIndex: number): string {
  return `${segmentKey(sessionId, segmentId)}:${chunkIndex}`;
}

function requestResult<T>(request: IDBRequest<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error(`${label}: richiesta IndexedDB fallita.`));
    }, { once: true });
  });
}

function transactionCompletion(transaction: IDBTransaction, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error(`${label}: transazione IndexedDB annullata.`));
    }, { once: true });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error(`${label}: transazione IndexedDB fallita.`));
    }, { once: true });
  });
}

function openTransaction(
  database: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  strictDurability = false,
): IDBTransaction {
  if (strictDurability) {
    try {
      return database.transaction(storeNames, mode, { durability: "strict" });
    } catch {
      // Older Safari versions reject the optional third argument. Atomicity
      // still comes from the transaction; strict durability is only a hint.
    }
  }
  return database.transaction(storeNames, mode);
}

async function openHistoryDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB non disponibile.");
  }
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(
      HISTORY_LOCAL_STORAGE_DATABASE,
      HISTORY_LOCAL_STORAGE_SCHEMA_VERSION,
    );
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        database.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
      }
      if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
        database.createObjectStore(MANIFEST_STORE, { keyPath: "sessionId" });
      }
      if (!database.objectStoreNames.contains(SEGMENT_STORE)) {
        const store = database.createObjectStore(SEGMENT_STORE, { keyPath: "key" });
        store.createIndex("bySession", "sessionId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHUNK_STORE)) {
        const store = database.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        store.createIndex("bySession", "sessionId", { unique: false });
        store.createIndex("bySegment", "segmentKey", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("Apertura database History fallita."));
    }, { once: true });
    request.addEventListener("blocked", () => {
      reject(new Error("Aggiornamento database History bloccato da un'altra scheda."));
    }, { once: true });
  });
}

export class HistoryStorageCatalog {
  private database: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    if (this.database) return;
    this.database = await openHistoryDatabase();
    this.database.addEventListener("versionchange", () => {
      this.database?.close();
      this.database = null;
    });
  }

  async selfTest(): Promise<void> {
    await this.initialize();
    const probeId = `probe-${crypto.randomUUID()}`;
    const now = Date.now();
    const transaction = openTransaction(
      this.requireDatabase(),
      SESSION_STORE,
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Self-test History");
    const store = transaction.objectStore(SESSION_STORE);
    store.put({
      sessionId: probeId,
      instanceId: probeId,
      createdAt: now,
      updatedAt: now,
      leaseExpiresAt: now,
      opfsMayExist: false,
      lockProtected: false,
    } satisfies HistorySessionRecord);
    store.delete(probeId);
    await completion;
  }

  async registerSession(
    sessionId: string,
    instanceId: string,
    leaseDurationMs: number,
  ): Promise<void> {
    await this.initialize();
    const now = Date.now();
    const transaction = openTransaction(
      this.requireDatabase(),
      SESSION_STORE,
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Registrazione sessione History");
    transaction.objectStore(SESSION_STORE).put({
      sessionId,
      instanceId,
      createdAt: now,
      updatedAt: now,
      leaseExpiresAt: now + leaseDurationMs,
      opfsMayExist: false,
      lockProtected: false,
    } satisfies HistorySessionRecord);
    await completion;
  }

  async touchSession(sessionId: string, leaseDurationMs: number): Promise<void> {
    await this.initialize();
    const database = this.requireDatabase();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    const completion = transactionCompletion(transaction, "Rinnovo lease History");
    const store = transaction.objectStore(SESSION_STORE);
    const request = store.get(sessionId) as IDBRequest<HistorySessionRecord | undefined>;
    request.addEventListener("success", () => {
      const current = request.result;
      if (!current) return;
      const now = Date.now();
      // Queue the dependent put inside the IDB success callback. Safari may
      // auto-commit before an async continuation resumes.
      store.put({ ...current, updatedAt: now, leaseExpiresAt: now + leaseDurationMs });
    }, { once: true });
    await completion;
  }

  async markSessionUsesOpfs(sessionId: string): Promise<void> {
    await this.initialize();
    const transaction = openTransaction(
      this.requireDatabase(),
      SESSION_STORE,
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Registrazione OPFS History");
    const store = transaction.objectStore(SESSION_STORE);
    const request = store.get(sessionId) as IDBRequest<HistorySessionRecord | undefined>;
    let missingSession: Error | null = null;
    request.addEventListener("success", () => {
      if (!request.result) {
        missingSession = new Error("Sessione History assente durante la registrazione OPFS.");
        transaction.abort();
        return;
      }
      store.put({ ...request.result, opfsMayExist: true });
    }, { once: true });
    try {
      await completion;
    } catch (error) {
      if (missingSession) throw missingSession;
      throw error;
    }
  }

  async markSessionLockProtected(sessionId: string): Promise<void> {
    await this.initialize();
    const transaction = openTransaction(
      this.requireDatabase(),
      SESSION_STORE,
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Registrazione lock History");
    const store = transaction.objectStore(SESSION_STORE);
    const request = store.get(sessionId) as IDBRequest<HistorySessionRecord | undefined>;
    let missingSession: Error | null = null;
    request.addEventListener("success", () => {
      if (!request.result) {
        missingSession = new Error("Sessione History assente durante la registrazione lock.");
        transaction.abort();
        return;
      }
      store.put({ ...request.result, lockProtected: true });
    }, { once: true });
    try {
      await completion;
    } catch (error) {
      if (missingSession) throw missingSession;
      throw error;
    }
  }

  async sessionMayUseOpfs(sessionId: string): Promise<boolean> {
    await this.initialize();
    const transaction = this.requireDatabase().transaction(SESSION_STORE, "readonly");
    const completion = transactionCompletion(transaction, "Lettura backend sessione History");
    const record = await requestResult(
      transaction.objectStore(SESSION_STORE).get(sessionId) as IDBRequest<
        HistorySessionRecord | undefined
      >,
      "Lettura backend sessione History",
    );
    await completion;
    // Records written before this field existed are conservatively treated as
    // potentially OPFS-backed so their only cleanup index is never discarded.
    return record?.opfsMayExist ?? true;
  }

  async cleanupCandidatesExcept(
    exceptSessionId: string,
  ): Promise<HistorySessionCleanupCandidate[]> {
    await this.initialize();
    const transaction = this.requireDatabase().transaction(SESSION_STORE, "readonly");
    const completion = transactionCompletion(transaction, "Elenco sessioni History");
    const records = await requestResult(
      transaction.objectStore(SESSION_STORE).getAll() as IDBRequest<HistorySessionRecord[]>,
      "Elenco sessioni History",
    );
    await completion;
    return records
      .filter((record) => record.sessionId !== exceptSessionId)
      .map((record) => ({
        sessionId: record.sessionId,
        leaseExpiresAt: record.leaseExpiresAt,
        lockProtected: record.lockProtected ?? false,
      }));
  }

  async loadManifest(sessionId: string): Promise<HistoryManifestV1 | null> {
    await this.initialize();
    const transaction = this.requireDatabase().transaction(MANIFEST_STORE, "readonly");
    const completion = transactionCompletion(transaction, "Lettura manifest History");
    const manifest = await requestResult(
      transaction.objectStore(MANIFEST_STORE).get(sessionId) as IDBRequest<
        HistoryManifestV1 | undefined
      >,
      "Lettura manifest History",
    );
    await completion;
    return manifest ?? null;
  }

  async commitSegmentCAS(options: {
    readonly expectedManifestGeneration: number;
    readonly segment: HistorySegmentDescriptorV1;
    readonly nextManifest: HistoryManifestV1;
  }): Promise<void> {
    await this.initialize();
    const database = this.requireDatabase();
    const transaction = openTransaction(
      database,
      [SESSION_STORE, MANIFEST_STORE, SEGMENT_STORE],
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "CAS manifest History");
    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    const request = manifestStore.get(options.nextManifest.sessionId) as IDBRequest<
      HistoryManifestV1 | undefined
    >;
    let conflict: Error | null = null;
    request.addEventListener("success", () => {
      const generation = request.result?.generation ?? 0;
      if (generation !== options.expectedManifestGeneration) {
        conflict = new Error(
          `Conflitto manifest History: generazione ${generation}, `
          + `attesa ${options.expectedManifestGeneration}.`,
        );
        transaction.abort();
        return;
      }
      // All dependent requests are enqueued synchronously in the success
      // event so Safari cannot auto-close the transaction between them.
      transaction.objectStore(SEGMENT_STORE).put({
        key: segmentKey(options.segment.sessionId, options.segment.segmentId),
        sessionId: options.segment.sessionId,
        segmentId: options.segment.segmentId,
        descriptor: options.segment,
      } satisfies HistorySegmentRecord);
      manifestStore.put(options.nextManifest);
      const sessionStore = transaction.objectStore(SESSION_STORE);
      const sessionRequest = sessionStore.get(options.segment.sessionId) as IDBRequest<
        HistorySessionRecord | undefined
      >;
      sessionRequest.addEventListener("success", () => {
        const session = sessionRequest.result;
        if (!session) {
          conflict = new Error("Sessione History assente durante il commit.");
          transaction.abort();
          return;
        }
        if (options.segment.backend === "opfs-worker") {
          sessionStore.put({ ...session, opfsMayExist: true });
        }
      }, { once: true });
    }, { once: true });
    try {
      await completion;
    } catch (error) {
      if (conflict) throw conflict;
      throw error;
    }
  }

  async removeSegmentCAS(options: {
    readonly sessionId: string;
    readonly segmentId: string;
    readonly expectedManifestGeneration: number;
    readonly nextManifest: HistoryManifestV1;
  }): Promise<void> {
    await this.initialize();
    const database = this.requireDatabase();
    const transaction = openTransaction(
      database,
      [MANIFEST_STORE, SEGMENT_STORE, CHUNK_STORE],
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "GC segmento History");
    const manifestStore = transaction.objectStore(MANIFEST_STORE);
    const request = manifestStore.get(options.sessionId) as IDBRequest<
      HistoryManifestV1 | undefined
    >;
    let conflict: Error | null = null;
    request.addEventListener("success", () => {
      const generation = request.result?.generation ?? 0;
      if (generation !== options.expectedManifestGeneration) {
        conflict = new Error(
          `Conflitto GC manifest History: generazione ${generation}, `
          + `attesa ${options.expectedManifestGeneration}.`,
        );
        transaction.abort();
        return;
      }
      const chunkStore = transaction.objectStore(CHUNK_STORE);
      deleteIndexRange(
        chunkStore,
        chunkStore.index("bySegment"),
        IDBKeyRange.only(segmentKey(options.sessionId, options.segmentId)),
      );
      transaction.objectStore(SEGMENT_STORE).delete(
        segmentKey(options.sessionId, options.segmentId),
      );
      manifestStore.put(options.nextManifest);
    }, { once: true });
    try {
      await completion;
    } catch (error) {
      if (conflict) throw conflict;
      throw error;
    }
  }

  async putCandidateChunk(options: {
    readonly sessionId: string;
    readonly segmentId: string;
    readonly chunkIndex: number;
    readonly bytes: ArrayBuffer;
  }): Promise<void> {
    await this.initialize();
    const transaction = this.requireDatabase().transaction(CHUNK_STORE, "readwrite");
    const completion = transactionCompletion(transaction, "Scrittura chunk History");
    transaction.objectStore(CHUNK_STORE).put({
      key: chunkKey(options.sessionId, options.segmentId, options.chunkIndex),
      sessionId: options.sessionId,
      segmentKey: segmentKey(options.sessionId, options.segmentId),
      segmentId: options.segmentId,
      chunkIndex: options.chunkIndex,
      bytes: options.bytes,
    } satisfies HistoryChunkRecord);
    await completion;
  }

  async readChunk(
    sessionId: string,
    segmentId: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer> {
    await this.initialize();
    const transaction = this.requireDatabase().transaction(CHUNK_STORE, "readonly");
    const completion = transactionCompletion(transaction, "Lettura chunk History");
    const record = await requestResult(
      transaction.objectStore(CHUNK_STORE).get(
        chunkKey(sessionId, segmentId, chunkIndex),
      ) as IDBRequest<HistoryChunkRecord | undefined>,
      "Lettura chunk History",
    );
    await completion;
    if (!record) throw new Error(`Chunk History ${segmentId}/${chunkIndex} mancante.`);
    return record.bytes;
  }

  async deleteSegmentPayload(sessionId: string, segmentId: string): Promise<void> {
    await this.initialize();
    const database = this.requireDatabase();
    const transaction = database.transaction([CHUNK_STORE, SEGMENT_STORE], "readwrite");
    const completion = transactionCompletion(transaction, "Rimozione segmento History");
    const chunkStore = transaction.objectStore(CHUNK_STORE);
    deleteIndexRange(
      chunkStore,
      chunkStore.index("bySegment"),
      IDBKeyRange.only(segmentKey(sessionId, segmentId)),
    );
    transaction.objectStore(SEGMENT_STORE).delete(segmentKey(sessionId, segmentId));
    await completion;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.initialize();
    const database = this.requireDatabase();
    const transaction = database.transaction(
      [SESSION_STORE, MANIFEST_STORE, SEGMENT_STORE, CHUNK_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction, "Rimozione sessione History");
    const segmentStore = transaction.objectStore(SEGMENT_STORE);
    const chunkStore = transaction.objectStore(CHUNK_STORE);
    deleteIndexRange(
      segmentStore,
      segmentStore.index("bySession"),
      IDBKeyRange.only(sessionId),
    );
    deleteIndexRange(
      chunkStore,
      chunkStore.index("bySession"),
      IDBKeyRange.only(sessionId),
    );
    transaction.objectStore(MANIFEST_STORE).delete(sessionId);
    transaction.objectStore(SESSION_STORE).delete(sessionId);
    await completion;
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  private requireDatabase(): IDBDatabase {
    if (!this.database) throw new Error("Catalogo History non inizializzato.");
    return this.database;
  }
}

function deleteIndexRange(
  store: IDBObjectStore,
  index: IDBIndex,
  range: IDBKeyRange,
): void {
  // Delete by primary key without materializing multi-megabyte chunk values.
  // Every request is still queued synchronously from the cursor callback so
  // Safari cannot auto-close the transaction between iterations.
  const request = index.openKeyCursor(range);
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  });
}
