import {
  CHUNK_STORE,
  GENERATION_INDEX,
  MANIFEST_STORE,
  PROJECT_INDEX,
  PROJECT_STORAGE_DATABASE_NAME,
  PROJECT_STORE,
  ProjectStorageError,
  type ProjectLoadResultV1,
  type ProjectSaveRequestV1,
  type ProjectStorageBackend,
  type ProjectStorageManagerLike,
  type ProjectStorageOptions,
  type ProjectStorageQuotaEstimate,
  type ProjectStoredChunkV1,
  type ProjectSummaryV1,
} from "./project-storage-schema.ts";
import {
  assertProjectId,
  assertString,
  assertSummary,
  normalizeProjectTitle,
  validateLoadedProject,
  validateProjectSaveRequest,
} from "./project-storage-codec.ts";
import {
  asStorageError,
  cloneStructured,
  deleteIndexRecords,
  materializeGeneration,
  memoryDatabase,
  openProjectDatabase,
  openTransaction,
  requestResult,
  transactionCompletion,
  uniqueToken,
  type MaterializedGeneration,
  type MemoryDatabase,
  type StoredManifestRecord,
} from "./project-storage-backend.ts";
import { projectManifestKey } from "./project-storage-keys.ts";
import {
  estimateProjectStorageQuota,
  globalStorageManager,
  requestPersistentProjectStorage,
} from "./project-storage-quota.ts";

export class ProjectStorage {
  readonly databaseName: string;

  private readonly indexedDbFactory: IDBFactory | null;
  private readonly storageManager: ProjectStorageManagerLike | null;
  private readonly forceMemory: boolean;
  private database: IDBDatabase | null = null;
  private memory: MemoryDatabase | null = null;
  private initializePromise: Promise<void> | null = null;
  private _backend: ProjectStorageBackend = "uninitialized";
  private mutationTail: Promise<void> = Promise.resolve();
  private _initializationError: { readonly message: string } | null = null;

  constructor(options: ProjectStorageOptions = {}) {
    this.databaseName = options.databaseName?.trim() || PROJECT_STORAGE_DATABASE_NAME;
    this.forceMemory = options.forceMemory === true;
    this.indexedDbFactory = Object.prototype.hasOwnProperty.call(options, "indexedDB")
      ? options.indexedDB ?? null
      : typeof indexedDB !== "undefined"
        ? indexedDB
        : null;
    this.storageManager = Object.prototype.hasOwnProperty.call(options, "storageManager")
      ? options.storageManager ?? null
      : globalStorageManager();
  }

  get backend(): ProjectStorageBackend {
    return this._backend;
  }

  get fallbackReason(): string | null {
    return this._initializationError?.message ?? null;
  }

  async initialize(): Promise<void> {
    if (this._backend !== "uninitialized") return;
    if (!this.initializePromise) {
      this.initializePromise = this.initializeBackend().catch((error: unknown) => {
        this.initializePromise = null;
        throw error;
      });
    }
    await this.initializePromise;
  }

  private async initializeBackend(): Promise<void> {
    if (this.forceMemory || !this.indexedDbFactory) {
      this.memory = memoryDatabase(this.databaseName);
      this._backend = "memory";
      if (!this.forceMemory && !this.indexedDbFactory) {
        this._initializationError = { message: "IndexedDB is unavailable." };
      }
      return;
    }
    try {
      const database = await openProjectDatabase(this.indexedDbFactory, this.databaseName);
      database.addEventListener("versionchange", () => {
        database.close();
        if (this.database === database) {
          this.database = null;
          this._backend = "uninitialized";
          this.initializePromise = null;
        }
      });
      this.database = database;
      this._backend = "indexeddb";
    } catch (error) {
      this._initializationError = {
        message: error instanceof Error ? error.message : String(error),
      };
      this.memory = memoryDatabase(this.databaseName);
      this._backend = "memory";
    }
  }

  async listProjects(): Promise<ProjectSummaryV1[]> {
    await this.initialize();
    let summaries: ProjectSummaryV1[];
    if (this._backend === "memory") {
      summaries = [...this.requireMemory().projects.values()].map(cloneStructured);
    } else {
      const transaction = openTransaction(this.requireDatabase(), PROJECT_STORE, "readonly");
      const completion = transactionCompletion(transaction, "List projects");
      summaries = await requestResult<ProjectSummaryV1[]>(
        transaction.objectStore(PROJECT_STORE).getAll(),
        "List projects",
      );
      await completion;
    }
    summaries.forEach((summary, index) => assertSummary(summary, `projects[${index}]`));
    return summaries
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map(cloneStructured);
  }

  async loadProject(projectId: string): Promise<ProjectLoadResultV1 | null> {
    assertProjectId(projectId, "projectId");
    await this.initialize();
    const project = this._backend === "memory"
      ? this.loadFromMemory(projectId)
      : await this.loadFromIndexedDb(projectId);
    if (!project) return null;
    validateLoadedProject(project);
    return cloneStructured(project);
  }

  private loadFromMemory(projectId: string): ProjectLoadResultV1 | null {
    const memory = this.requireMemory();
    const summary = memory.projects.get(projectId);
    if (!summary) return null;
    const manifestRecord = memory.manifests.get(
      projectManifestKey(projectId, summary.headGenerationId),
    );
    if (!manifestRecord) {
      throw new ProjectStorageError(
        `Project ${projectId} points to a missing manifest.`,
        "database",
      );
    }
    const generationKeyValue = manifestRecord.key;
    const chunks = [...memory.chunks.values()]
      .filter((chunk) => chunk.generationKey === generationKeyValue)
      .sort((left, right) => left.layerId - right.layerId || left.chunkIndex - right.chunkIndex);
    return cloneStructured({
      summary,
      manifest: manifestRecord.manifest,
      chunks,
    });
  }

  private async loadFromIndexedDb(projectId: string): Promise<ProjectLoadResultV1 | null> {
    const database = this.requireDatabase();
    return await new Promise<ProjectLoadResultV1 | null>((resolve, reject) => {
      const transaction = openTransaction(
        database,
        [PROJECT_STORE, MANIFEST_STORE, CHUNK_STORE],
        "readonly",
      );
      let project: ProjectLoadResultV1 | null = null;
      let localError: unknown = null;
      const summaryRequest = transaction.objectStore(PROJECT_STORE).get(projectId) as
        IDBRequest<ProjectSummaryV1 | undefined>;
      summaryRequest.addEventListener("success", () => {
        try {
          const summary = summaryRequest.result;
          if (!summary) return;
          assertSummary(summary, "project.summary");
          const manifestRequest = transaction.objectStore(MANIFEST_STORE).get(
            projectManifestKey(projectId, summary.headGenerationId),
          ) as IDBRequest<StoredManifestRecord | undefined>;
          manifestRequest.addEventListener("success", () => {
            try {
              const manifestRecord = manifestRequest.result;
              if (!manifestRecord) {
                throw new ProjectStorageError(
                  `Project ${projectId} points to a missing manifest.`,
                  "database",
                );
              }
              const chunkRequest = transaction.objectStore(CHUNK_STORE)
                .index(GENERATION_INDEX)
                .getAll(manifestRecord.key) as IDBRequest<ProjectStoredChunkV1[]>;
              chunkRequest.addEventListener("success", () => {
                project = {
                  summary,
                  manifest: manifestRecord.manifest,
                  chunks: chunkRequest.result.sort(
                    (left, right) => left.layerId - right.layerId
                      || left.chunkIndex - right.chunkIndex,
                  ),
                };
              }, { once: true });
            } catch (error) {
              localError = error;
              transaction.abort();
            }
          }, { once: true });
        } catch (error) {
          localError = error;
          transaction.abort();
        }
      }, { once: true });
      transaction.addEventListener("complete", () => resolve(project), { once: true });
      transaction.addEventListener("abort", () => {
        reject(localError ?? transaction.error ?? new ProjectStorageError("Load project aborted."));
      }, { once: true });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new ProjectStorageError("Load project failed."));
      }, { once: true });
    });
  }

  async saveProject(request: ProjectSaveRequestV1): Promise<ProjectSummaryV1> {
    return await this.enqueueMutation(async () => {
      validateProjectSaveRequest(request);
      await this.initialize();
      const previous = request.projectId
        ? await this.readSummary(request.projectId)
        : null;
      if (request.projectId && !previous) {
        throw new ProjectStorageError(
          `Project ${request.projectId} does not exist.`,
          "not-found",
        );
      }
      const projectId = previous?.id ?? uniqueToken("project");
      const generation = materializeGeneration(request, projectId, previous);
      try {
        // Phase 1: stage an immutable manifest and every referenced byte chunk.
        // No reader can observe them yet because the project head still points
        // at the previous generation.
        await this.writeStagedGeneration(generation);
        // Phase 2: publish only after staging committed. This small transaction
        // verifies the manifest still exists before atomically moving the head.
        await this.commitProjectHead(generation.summary, generation.manifestRecord.key);
      } catch (error) {
        throw asStorageError(error, `Save project ${projectId}`);
      }

      // Delete only the previously observed head. Other generations may be
      // concurrent, already staged writes from another tab and must not be
      // mistaken for garbage. Cleanup failure cannot uncommit a successful save.
      if (previous && previous.headGenerationId !== generation.summary.headGenerationId) {
        try {
          await this.deleteGeneration(projectId, previous.headGenerationId);
        } catch {
          // A later save/delete will reclaim this now-unreferenced generation.
        }
      }
      return cloneStructured(generation.summary);
    });
  }

  private async readSummary(projectId: string): Promise<ProjectSummaryV1 | null> {
    if (this._backend === "memory") {
      const summary = this.requireMemory().projects.get(projectId) ?? null;
      if (summary) assertSummary(summary, "project.summary");
      return summary ? cloneStructured(summary) : null;
    }
    const transaction = openTransaction(this.requireDatabase(), PROJECT_STORE, "readonly");
    const completion = transactionCompletion(transaction, "Read project summary");
    const summary = await requestResult<ProjectSummaryV1 | undefined>(
      transaction.objectStore(PROJECT_STORE).get(projectId),
      "Read project summary",
    );
    await completion;
    if (summary) assertSummary(summary, "project.summary");
    return summary ? cloneStructured(summary) : null;
  }

  private async writeStagedGeneration(generation: MaterializedGeneration): Promise<void> {
    if (this._backend === "memory") {
      const memory = this.requireMemory();
      memory.manifests.set(
        generation.manifestRecord.key,
        cloneStructured(generation.manifestRecord),
      );
      for (const chunk of generation.chunks) {
        memory.chunks.set(chunk.key, cloneStructured(chunk));
      }
      return;
    }
    const transaction = openTransaction(
      this.requireDatabase(),
      [MANIFEST_STORE, CHUNK_STORE],
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Stage project generation");
    transaction.objectStore(MANIFEST_STORE).put(generation.manifestRecord);
    const chunkStore = transaction.objectStore(CHUNK_STORE);
    for (const chunk of generation.chunks) chunkStore.put(chunk);
    await completion;
  }

  private async commitProjectHead(
    summary: ProjectSummaryV1,
    expectedManifestKey: string,
  ): Promise<void> {
    if (this._backend === "memory") {
      const memory = this.requireMemory();
      if (!memory.manifests.has(expectedManifestKey)) {
        throw new ProjectStorageError("Cannot publish a missing staged manifest.");
      }
      // Last mutation in the memory backend too: tests see the same contract.
      memory.projects.set(summary.id, cloneStructured(summary));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = openTransaction(
        this.requireDatabase(),
        [PROJECT_STORE, MANIFEST_STORE],
        "readwrite",
        true,
      );
      let localError: unknown = null;
      const request = transaction.objectStore(MANIFEST_STORE).get(expectedManifestKey) as
        IDBRequest<StoredManifestRecord | undefined>;
      request.addEventListener("success", () => {
        if (!request.result) {
          localError = new ProjectStorageError("Cannot publish a missing staged manifest.");
          transaction.abort();
          return;
        }
        transaction.objectStore(PROJECT_STORE).put(summary);
      }, { once: true });
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("abort", () => {
        reject(localError ?? transaction.error ?? new ProjectStorageError("Head commit aborted."));
      }, { once: true });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new ProjectStorageError("Head commit failed."));
      }, { once: true });
    });
  }

  private async deleteGeneration(projectId: string, generationId: string): Promise<void> {
    const generationKeyValue = projectManifestKey(projectId, generationId);
    if (this._backend === "memory") {
      const memory = this.requireMemory();
      memory.manifests.delete(generationKeyValue);
      for (const [key, chunk] of memory.chunks) {
        if (chunk.generationKey === generationKeyValue) memory.chunks.delete(key);
      }
      return;
    }
    const transaction = openTransaction(
      this.requireDatabase(),
      [MANIFEST_STORE, CHUNK_STORE],
      "readwrite",
    );
    const completion = transactionCompletion(transaction, "Delete old project generation");
    transaction.objectStore(MANIFEST_STORE).delete(generationKeyValue);
    deleteIndexRecords(
      transaction.objectStore(CHUNK_STORE).index(GENERATION_INDEX),
      generationKeyValue,
    );
    await completion;
  }

  async renameProject(projectId: string, requestedName: string): Promise<ProjectSummaryV1> {
    assertProjectId(projectId, "projectId");
    assertString(requestedName, "name", 4_096);
    const name = normalizeProjectTitle(requestedName);
    return await this.enqueueMutation(async () => {
      await this.initialize();
      try {
        if (this._backend === "memory") {
          const memory = this.requireMemory();
          const summary = memory.projects.get(projectId);
          if (!summary) {
            throw new ProjectStorageError(`Project ${projectId} does not exist.`, "not-found");
          }
          const manifestRecord = memory.manifests.get(
            projectManifestKey(projectId, summary.headGenerationId),
          );
          if (!manifestRecord) throw new ProjectStorageError("Project manifest is missing.");
          const renamedSummary: ProjectSummaryV1 = {
            ...summary,
            name,
            updatedAt: Math.max(Date.now(), summary.updatedAt),
          };
          const renamedManifest: StoredManifestRecord = {
            ...manifestRecord,
            manifest: { ...manifestRecord.manifest, projectName: name },
          };
          memory.manifests.set(renamedManifest.key, cloneStructured(renamedManifest));
          memory.projects.set(projectId, cloneStructured(renamedSummary));
          return cloneStructured(renamedSummary);
        }
        return await this.renameInIndexedDb(projectId, name);
      } catch (error) {
        throw asStorageError(error, `Rename project ${projectId}`);
      }
    });
  }

  private async renameInIndexedDb(
    projectId: string,
    name: string,
  ): Promise<ProjectSummaryV1> {
    return await new Promise<ProjectSummaryV1>((resolve, reject) => {
      const transaction = openTransaction(
        this.requireDatabase(),
        [PROJECT_STORE, MANIFEST_STORE],
        "readwrite",
        true,
      );
      let result: ProjectSummaryV1 | null = null;
      let localError: unknown = null;
      const summaryRequest = transaction.objectStore(PROJECT_STORE).get(projectId) as
        IDBRequest<ProjectSummaryV1 | undefined>;
      summaryRequest.addEventListener("success", () => {
        const summary = summaryRequest.result;
        if (!summary) {
          localError = new ProjectStorageError(`Project ${projectId} does not exist.`, "not-found");
          transaction.abort();
          return;
        }
        const manifestRequest = transaction.objectStore(MANIFEST_STORE).get(
          projectManifestKey(projectId, summary.headGenerationId),
        ) as IDBRequest<StoredManifestRecord | undefined>;
        manifestRequest.addEventListener("success", () => {
          const manifestRecord = manifestRequest.result;
          if (!manifestRecord) {
            localError = new ProjectStorageError("Project manifest is missing.");
            transaction.abort();
            return;
          }
          result = {
            ...summary,
            name,
            updatedAt: Math.max(Date.now(), summary.updatedAt),
          };
          transaction.objectStore(MANIFEST_STORE).put({
            ...manifestRecord,
            manifest: { ...manifestRecord.manifest, projectName: name },
          });
          transaction.objectStore(PROJECT_STORE).put(result);
        }, { once: true });
      }, { once: true });
      transaction.addEventListener("complete", () => {
        if (result) resolve(cloneStructured(result));
        else reject(new ProjectStorageError("Rename completed without a result."));
      }, { once: true });
      transaction.addEventListener("abort", () => {
        reject(localError ?? transaction.error ?? new ProjectStorageError("Rename aborted."));
      }, { once: true });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new ProjectStorageError("Rename failed."));
      }, { once: true });
    });
  }

  async deleteProject(projectId: string): Promise<boolean> {
    assertProjectId(projectId, "projectId");
    return await this.enqueueMutation(async () => {
      await this.initialize();
      try {
        if (this._backend === "memory") {
          const memory = this.requireMemory();
          const existed = memory.projects.delete(projectId);
          for (const [key, record] of memory.manifests) {
            if (record.projectId === projectId) memory.manifests.delete(key);
          }
          for (const [key, chunk] of memory.chunks) {
            if (chunk.projectId === projectId) memory.chunks.delete(key);
          }
          return existed;
        }
        return await this.deleteFromIndexedDb(projectId);
      } catch (error) {
        throw asStorageError(error, `Delete project ${projectId}`);
      }
    });
  }

  private async deleteFromIndexedDb(projectId: string): Promise<boolean> {
    const transaction = openTransaction(
      this.requireDatabase(),
      [PROJECT_STORE, MANIFEST_STORE, CHUNK_STORE],
      "readwrite",
      true,
    );
    const completion = transactionCompletion(transaction, "Delete project");
    const existingRequest = transaction.objectStore(PROJECT_STORE).get(projectId) as
      IDBRequest<ProjectSummaryV1 | undefined>;
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    deleteIndexRecords(
      transaction.objectStore(MANIFEST_STORE).index(PROJECT_INDEX),
      projectId,
    );
    deleteIndexRecords(
      transaction.objectStore(CHUNK_STORE).index(PROJECT_INDEX),
      projectId,
    );
    const existing = await requestResult(existingRequest, "Read project before delete");
    await completion;
    return existing !== undefined;
  }

  async estimateQuota(): Promise<ProjectStorageQuotaEstimate> {
    await this.initialize();
    const estimate = await estimateProjectStorageQuota(this.storageManager);
    return {
      ...estimate,
      backend: this._backend === "indexeddb" ? "indexeddb" : "memory",
    };
  }

  async requestPersistence(): Promise<boolean | null> {
    await this.initialize();
    if (this._backend === "memory") return null;
    return await requestPersistentProjectStorage(this.storageManager);
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.memory = null;
    this.initializePromise = null;
    this._backend = "uninitialized";
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private requireDatabase(): IDBDatabase {
    if (!this.database || this._backend !== "indexeddb") {
      throw new ProjectStorageError("IndexedDB project backend is not initialized.");
    }
    return this.database;
  }

  private requireMemory(): MemoryDatabase {
    if (!this.memory || this._backend !== "memory") {
      throw new ProjectStorageError("Memory project backend is not initialized.");
    }
    return this.memory;
  }
}

export function createProjectStorage(
  options: ProjectStorageOptions = {},
): ProjectStorage {
  return new ProjectStorage(options);
}
