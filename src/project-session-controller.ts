import type { CapturedProjectDocumentV1 } from "./engine-project-runtime";
import type { HistoryState } from "./engine-types";
import { validateDocumentDimensions } from "./engine-limits";
import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  normalizeProjectTitle,
  validateLoadedProject,
  type ProjectLoadResultV1,
  type ProjectSummaryV1,
  type ProjectStorage,
} from "./project-storage";
import type {
  ProjectEditorSessionLifecycle,
  ProjectSessionSwitchFallback,
  ProjectSessionSwitchRequest,
  ProjectSessionSwitchResult,
  ProjectSessionSwitchStage,
} from "./project-shell-contract";

export interface ProjectSessionEngineSwitchTarget {
  readonly kind: ProjectSessionSwitchRequest["kind"];
  readonly project: ProjectLoadResultV1 | null;
  readonly name: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

export interface ProjectSessionEnginePort {
  captureDocument(): Promise<CapturedProjectDocumentV1>;
  captureThumbnailPixels(): Promise<{
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8ClampedArray;
  }>;
  restoreDocument(project: ProjectLoadResultV1): Promise<void>;
  historyState(): Pick<HistoryState, "cursor" | "actionCount">;
  sceneSnapshot(): unknown;
  setInitialLayerName(name: string): void;
  /** Validates/quiesces a same-runtime replacement without mutating the source document. */
  preflightDocumentSwitch?(target: ProjectSessionEngineSwitchTarget): Promise<void>;
  /** Crosses the destructive boundary and leaves a fresh document host. */
  resetDocumentForSwitch?(target: ProjectSessionEngineSwitchTarget): Promise<void>;
  /** Resolves only after the first submitted target frame is GPU-complete. */
  waitForDocumentFirstFrame?(): Promise<void>;
}

export interface ProjectSessionControllerOptions {
  readonly engine: ProjectSessionEnginePort;
  readonly storage: ProjectStorage;
  readonly browser: Window;
  readonly document: Document;
  readonly searchParams: URLSearchParams;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly saveButton: HTMLButtonElement;
  readonly homeButton: HTMLButtonElement;
  readonly status: HTMLParagraphElement;
  readonly storageReady?: Promise<void>;
  readonly preloadedProjectId?: string | null;
  readonly preloadedProject?: Promise<ProjectLoadResultV1 | null> | null;
  /** Flushes preview transactions before project capture or navigation. */
  readonly settleTransientEdits?: (() => Promise<void>) | null;
  readonly onReturnHome?: ((pushHistory: boolean) => Promise<void>) | null;
  /** Acquires the composition-root input/overlay lock before source settlement. */
  readonly onDocumentSwitchStart?: (
    target: ProjectSessionEngineSwitchTarget,
  ) => Promise<void>;
  /** Product-neutral progress signal consumed by the composition root. */
  readonly onDocumentSwitchStage?: (
    stage: ProjectSessionSwitchStage,
  ) => Promise<void> | void;
  /** Invalidates document-scoped UI only after the source head is safely verified. */
  readonly onDocumentSwitchPreReset?: (
    target: ProjectSessionEngineSwitchTarget,
  ) => Promise<void>;
  /** Resets document-scoped controllers and schedules the target presentation. */
  readonly onDocumentSwitchCommit?: (
    target: ProjectSessionEngineSwitchTarget,
  ) => Promise<void>;
  /** Always releases the composition-root lock; recovery remains the caller's decision. */
  readonly onDocumentSwitchFinish?: (
    result: ProjectSessionSwitchResult,
  ) => Promise<void> | void;
}

interface ProjectSaveOptions {
  readonly captureThumbnail?: boolean;
  readonly updateRoute?: boolean;
}

interface VerifiedProjectHead {
  readonly project: ProjectLoadResultV1;
  readonly url: string;
}

function canvasBlob(
  source: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => source.toBlob(resolve, type, quality));
}

/**
 * Owns the durable editor session. The controller receives a narrow engine
 * port and concrete UI elements; it never discovers dependencies in the DOM.
 */
export class ProjectSessionController implements ProjectEditorSessionLifecycle {
  private readonly engine: ProjectSessionEnginePort;
  private readonly storage: ProjectStorage;
  private readonly browser: Window;
  private readonly document: Document;
  private documentWidth: number;
  private documentHeight: number;
  private readonly saveButton: HTMLButtonElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private readonly storageReady: Promise<void> | null;
  private readonly preloadedProjectId: string | null;
  private readonly preloadedProject: Promise<ProjectLoadResultV1 | null> | null;
  private readonly settleTransientEdits: (() => Promise<void>) | null;
  private readonly onReturnHome: ((pushHistory: boolean) => Promise<void>) | null;
  private readonly onDocumentSwitchStart: ProjectSessionControllerOptions["onDocumentSwitchStart"];
  private readonly onDocumentSwitchStage: ProjectSessionControllerOptions["onDocumentSwitchStage"];
  private readonly onDocumentSwitchPreReset:
    ProjectSessionControllerOptions["onDocumentSwitchPreReset"];
  private readonly onDocumentSwitchCommit: ProjectSessionControllerOptions["onDocumentSwitchCommit"];
  private readonly onDocumentSwitchFinish: ProjectSessionControllerOptions["onDocumentSwitchFinish"];
  private readonly newProjectRequested: boolean;
  private readonly requestedProjectName: string;

  private currentProjectId: string | null;
  private currentProjectName: string;
  private trackingReady = false;
  private editorReady = false;
  private dirty: boolean;
  private saveBusy = false;
  private savePromise: Promise<void> | null = null;
  private historyMutationSignature = "";
  private sceneMutationSignature = "";
  private mutationRevision = 0;
  private lastMutationReason = "document state";
  private currentHeadGenerationId: string | null = null;
  private switchPromise: Promise<ProjectSessionSwitchResult> | null = null;
  private switchRequestKey: string | null = null;
  private trackingSuspended = false;
  private recoveryRequired = false;
  private disposed = false;

  private readonly handleSaveButtonClick = (): void => {
    void this.save().catch((error) => {
      console.error("Project save failed:", error);
    });
  };

  private readonly handleHomeButtonClick = (): void => {
    void this.returnHome("push").catch((error) => {
      console.error("Return to projects failed:", error);
      this.setStatus(
        error instanceof Error
          ? `Could not return to projects: ${error.message}`
          : "Could not return to projects.",
        "error",
      );
    });
  };

  private readonly handleWindowKeydown = (event: KeyboardEvent): void => {
    this.handleSaveShortcut(event);
  };

  private readonly handleWindowBeforeUnload = (event: BeforeUnloadEvent): void => {
    this.handleBeforeUnload(event);
  };

  constructor(options: ProjectSessionControllerOptions) {
    this.engine = options.engine;
    this.storage = options.storage;
    this.browser = options.browser;
    this.document = options.document;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.saveButton = options.saveButton;
    this.homeButton = options.homeButton;
    this.status = options.status;
    this.storageReady = options.storageReady ?? null;
    this.preloadedProjectId = options.preloadedProjectId ?? null;
    this.preloadedProject = options.preloadedProject ?? null;
    this.settleTransientEdits = options.settleTransientEdits ?? null;
    this.onReturnHome = options.onReturnHome ?? null;
    this.onDocumentSwitchStart = options.onDocumentSwitchStart;
    this.onDocumentSwitchStage = options.onDocumentSwitchStage;
    this.onDocumentSwitchPreReset = options.onDocumentSwitchPreReset;
    this.onDocumentSwitchCommit = options.onDocumentSwitchCommit;
    this.onDocumentSwitchFinish = options.onDocumentSwitchFinish;

    this.currentProjectId = options.searchParams.get("project")?.trim() || null;
    this.newProjectRequested = this.currentProjectId !== null
      && options.searchParams.get("newProject") === "1";
    this.requestedProjectName = normalizeProjectTitle(
      options.searchParams.get("projectName") ?? "Untitled Artwork",
    );
    this.currentProjectName = this.requestedProjectName;
    this.dirty = this.newProjectRequested;

    this.saveButton.addEventListener("click", this.handleSaveButtonClick);
    this.homeButton.addEventListener("click", this.handleHomeButtonClick);
    this.browser.addEventListener("keydown", this.handleWindowKeydown);
    this.browser.addEventListener("beforeunload", this.handleWindowBeforeUnload);
    this.browser.__projectEditorSessionLifecycle = this;

    this.syncSaveControl();
    this.homeButton.disabled = true;
  }

  get switchInProgress(): boolean {
    return this.switchPromise !== null;
  }

  refreshCurrentProjectSummary(summary: ProjectSummaryV1): boolean {
    if (
      this.disposed
      || this.recoveryRequired
      || this.switchInProgress
      || this.currentProjectId === null
      || this.currentHeadGenerationId === null
      || summary.id !== this.currentProjectId
      || summary.documentWidth !== this.documentWidth
      || summary.documentHeight !== this.documentHeight
      || summary.headGenerationId !== this.currentHeadGenerationId
    ) {
      return false;
    }
    this.updateIdentity(summary.name);
    return true;
  }

  markDirty(reason = "document state"): void {
    if (
      !this.trackingReady
      || this.trackingSuspended
      || this.disposed
      || this.recoveryRequired
    ) return;
    this.lastMutationReason = reason;
    this.mutationRevision += 1;
    if (this.dirty) return;
    this.dirty = true;
    this.syncSaveControl();
  }

  noteHistoryState(state: Pick<HistoryState, "cursor" | "actionCount">): void {
    if (this.trackingSuspended || this.disposed || this.recoveryRequired) return;
    const signature = `${state.cursor}|${state.actionCount}`;
    if (
      this.trackingReady
      && this.historyMutationSignature !== ""
      && signature !== this.historyMutationSignature
    ) {
      this.markDirty("history state");
    }
    this.historyMutationSignature = signature;
  }

  noteSceneSnapshot(snapshot: unknown): void {
    if (this.trackingSuspended || this.disposed || this.recoveryRequired) return;
    const signature = JSON.stringify(snapshot) ?? "undefined";
    if (
      this.trackingReady
      && this.sceneMutationSignature !== ""
      && signature !== this.sceneMutationSignature
    ) {
      this.markDirty("scene state");
    }
    this.sceneMutationSignature = signature;
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error("The project session has been disposed.");
    await (this.storageReady ?? this.storage.initialize());
    this.editorReady = true;
    if (this.currentProjectId && !this.newProjectRequested) {
      this.setStatus("Opening project…");
      const saved = this.preloadedProject && this.preloadedProjectId === this.currentProjectId
        ? await this.preloadedProject
        : await this.storage.loadProject(this.currentProjectId);
      if (!saved) throw new Error("This project is no longer available on this device.");
      this.updateIdentity(saved.summary.name);
      await this.engine.restoreDocument(saved);
      this.currentHeadGenerationId = saved.summary.headGenerationId;
      this.dirty = false;
    } else if (this.newProjectRequested) {
      this.updateIdentity(this.requestedProjectName);
      this.engine.setInitialLayerName("Layer 1");
      // The URL token selects the editor route; durable storage generates the
      // canonical id when the first head is committed.
      this.currentProjectId = null;
      await this.save({ captureThumbnail: false });
    } else {
      this.updateIdentity("Untitled Artwork");
      this.dirty = true;
    }
    this.noteHistoryState(this.engine.historyState());
    this.noteSceneSnapshot(this.engine.sceneSnapshot());
    this.trackingReady = true;
    this.homeButton.disabled = false;
    this.syncSaveControl();
  }

  switchProject(request: ProjectSessionSwitchRequest): Promise<ProjectSessionSwitchResult> {
    const requestKey = this.documentSwitchRequestKey(request);
    if (this.switchPromise) {
      if (this.switchRequestKey === requestKey) return this.switchPromise;
      return Promise.resolve({
        status: "failed",
        stage: "availability",
        message: "Another project switch is already in progress.",
        destructive: false,
        sourceProjectId: this.currentProjectId,
        requestedTarget: request.kind,
        fallback: this.createFallback("none", null),
      });
    }
    const operation = this.performDocumentSwitch(request);
    const tracked = operation.finally(() => {
      if (this.switchPromise === tracked) {
        this.switchPromise = null;
        this.switchRequestKey = null;
        this.syncSaveControl();
      }
    });
    this.switchRequestKey = requestKey;
    this.switchPromise = tracked;
    this.syncSaveControl();
    return tracked;
  }

  private documentSwitchRequestKey(request: ProjectSessionSwitchRequest): string {
    const historyMode = request.historyMode ?? "push";
    if (request.kind === "existing") {
      return `existing:${request.projectId.trim()}:${historyMode}`;
    }
    return [
      "new",
      request.documentWidth,
      request.documentHeight,
      normalizeProjectTitle(request.name),
      historyMode,
    ].join(":");
  }

  async save(options: Readonly<ProjectSaveOptions> = {}): Promise<void> {
    if (this.disposed) throw new Error("The project session has been disposed.");
    if (this.recoveryRequired) {
      throw new Error("The project session requires recovery before it can be saved.");
    }
    if (this.savePromise) return this.savePromise;
    const operation = this.performSave(options);
    this.savePromise = operation;
    try {
      await operation;
    } finally {
      if (this.savePromise === operation) this.savePromise = null;
    }
  }

  private async performDocumentSwitch(
    request: ProjectSessionSwitchRequest,
  ): Promise<ProjectSessionSwitchResult> {
    const sourceProjectIdAtRequest = this.currentProjectId;
    let sourceHead: VerifiedProjectHead | null = null;
    let target: ProjectSessionEngineSwitchTarget | null = null;
    let stage: ProjectSessionSwitchStage = "availability";
    let destructive = false;
    let finishRequired = false;
    let result: ProjectSessionSwitchResult;

    try {
      await this.reportSwitchStage(stage);
      this.assertSwitchAvailable();
      if (request.kind === "existing") {
        const projectId = request.projectId.trim();
        if (projectId !== "" && projectId === this.currentProjectId) {
          return {
            status: "unchanged",
            sourceProjectId: projectId,
            targetProjectId: projectId,
            fallback: this.createFallback("none", null),
          };
        }
      }

      await (this.storageReady ?? this.storage.initialize());
      if (this.storage.backend !== "indexeddb") {
        throw new Error(
          "Durable IndexedDB project storage is required for an in-place document switch.",
        );
      }

      stage = "preload-target";
      await this.reportSwitchStage(stage);
      target = await this.loadSwitchTarget(request);

      stage = "start";
      await this.reportSwitchStage(stage);
      finishRequired = true;
      await this.onDocumentSwitchStart!(target);

      if (this.savePromise) {
        stage = "save-source";
        await this.reportSwitchStage(stage);
        await this.savePromise;
      }

      stage = "settle-source";
      await this.reportSwitchStage(stage);
      await this.settleTransientEdits?.();

      stage = "save-source";
      await this.reportSwitchStage(stage);
      if (this.dirty || !this.currentProjectId) {
        await this.save({ updateRoute: false });
      }
      if (this.dirty) {
        throw new Error(
          `The source project changed while its durable head was being saved (${this.lastMutationReason}).`,
        );
      }

      stage = "verify-source";
      await this.reportSwitchStage(stage);
      if (!this.currentProjectId) {
        throw new Error("The source project has no durable project identifier.");
      }
      sourceHead = await this.verifyProjectHead(
        this.currentProjectId,
        this.currentHeadGenerationId
          ? { headGenerationId: this.currentHeadGenerationId }
          : undefined,
      );

      stage = "preflight-engine";
      await this.reportSwitchStage(stage);
      await this.engine.preflightDocumentSwitch!(target);
      if (this.dirty) {
        throw new Error("The source project changed after its durable head was verified.");
      }
      await this.onDocumentSwitchPreReset!(target);
      if (this.dirty) {
        throw new Error("The source project changed during document switch preparation.");
      }

      target = await this.refreshExistingSwitchTarget(target);
      if (this.dirty) {
        throw new Error("The source project changed during final target verification.");
      }

      this.trackingSuspended = true;
      stage = "reset-engine";
      await this.reportSwitchStage(stage);
      destructive = true;
      await this.engine.resetDocumentForSwitch!(target);

      stage = "restore-target";
      await this.reportSwitchStage(stage);
      if (target.kind === "existing") {
        await this.engine.restoreDocument(target.project!);
      } else {
        this.engine.setInitialLayerName("Layer 1");
      }

      stage = "commit-target";
      await this.reportSwitchStage(stage);
      await this.onDocumentSwitchCommit!(target);

      stage = "first-frame";
      await this.reportSwitchStage(stage);
      await this.engine.waitForDocumentFirstFrame!();

      let targetHead: VerifiedProjectHead;
      if (target.kind === "existing") {
        stage = "publish-target";
        await this.reportSwitchStage(stage);
        targetHead = await this.verifyProjectHead(
          target.project!.summary.id,
          target.project!.summary,
        );
      } else {
        stage = "save-target";
        await this.reportSwitchStage(stage);
        targetHead = await this.saveNewTargetProject(target.name);
        stage = "publish-target";
        await this.reportSwitchStage(stage);
      }
      const targetSummary = targetHead.project.summary;
      this.documentWidth = targetSummary.documentWidth;
      this.documentHeight = targetSummary.documentHeight;
      this.currentProjectId = targetSummary.id;
      this.currentHeadGenerationId = targetSummary.headGenerationId;
      this.updateIdentity(targetSummary.name);
      this.updateUrl(targetSummary.id, request.historyMode ?? "push");
      this.dirty = false;
      this.mutationRevision += 1;
      this.historyMutationSignature = this.historySignature();
      this.sceneMutationSignature = this.sceneSignature();
      this.trackingReady = true;
      this.trackingSuspended = false;
      this.recoveryRequired = false;
      this.setStatus("Project opened in the current editor session.", "ok");
      this.syncSaveControl();
      result = {
        status: "committed",
        sourceProjectId: sourceHead.project.summary.id,
        targetProjectId: targetSummary.id,
        targetProjectName: targetSummary.name,
        targetKind: target.kind,
        fallback: this.createFallback("none", null),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackAction = destructive ? "reload-source" : "stay-current";
      const fallback = this.createFallback(fallbackAction, sourceHead);
      if (destructive) {
        this.recoveryRequired = true;
        this.trackingSuspended = true;
        this.setStatus(
          `Project switch stopped after the document reset: ${message}`,
          "error",
        );
      } else {
        this.trackingSuspended = false;
        this.setStatus(`Project switch stopped: ${message}`, "error");
      }
      this.syncSaveControl();
      result = {
        status: "failed",
        stage,
        message,
        destructive,
        sourceProjectId: sourceHead?.project.summary.id ?? sourceProjectIdAtRequest,
        requestedTarget: request.kind,
        fallback,
      };
    }

    if (finishRequired) {
      try {
        await this.onDocumentSwitchFinish?.(result);
      } catch (error) {
        console.error("Project switch finalization failed:", error);
      }
    }
    return result;
  }

  private assertSwitchAvailable(): void {
    if (this.disposed) throw new Error("The project session has been disposed.");
    if (!this.editorReady) throw new Error("The editor is still starting.");
    if (this.recoveryRequired) {
      throw new Error("The project session requires recovery before another switch.");
    }
    if (
      !this.engine.preflightDocumentSwitch
      || !this.engine.resetDocumentForSwitch
      || !this.engine.waitForDocumentFirstFrame
      || !this.onDocumentSwitchStart
      || !this.onDocumentSwitchPreReset
      || !this.onDocumentSwitchCommit
    ) {
      throw new Error("The composition root has not installed the document-switch lifecycle ports.");
    }
  }

  private async loadSwitchTarget(
    request: ProjectSessionSwitchRequest,
  ): Promise<ProjectSessionEngineSwitchTarget> {
    if (request.kind === "new") {
      validateDocumentDimensions(request.documentWidth, request.documentHeight);
      return {
        kind: "new",
        project: null,
        name: normalizeProjectTitle(request.name),
        documentWidth: request.documentWidth,
        documentHeight: request.documentHeight,
      };
    }

    const projectId = request.projectId.trim();
    if (projectId === "") throw new Error("A project identifier is required.");
    const project = request.preloadedProject
      ? await request.preloadedProject
      : await this.storage.loadProject(projectId);
    if (!project) throw new Error("The requested project is no longer available on this device.");
    validateLoadedProject(project);
    if (project.summary.id !== projectId) {
      throw new Error("The preloaded project does not match the requested project identifier.");
    }
    validateDocumentDimensions(
      project.summary.documentWidth,
      project.summary.documentHeight,
      { allowLegacy4096: true },
    );
    return {
      kind: "existing",
      project,
      name: project.summary.name,
      documentWidth: project.summary.documentWidth,
      documentHeight: project.summary.documentHeight,
    };
  }

  private async verifyProjectHead(
    projectId: string,
    expected?: Pick<ProjectSummaryV1, "headGenerationId">
      & Partial<Pick<ProjectSummaryV1, "documentWidth" | "documentHeight">>,
  ): Promise<VerifiedProjectHead> {
    const project = await this.storage.loadProject(projectId);
    if (!project) throw new Error("The saved project head could not be read back.");
    validateLoadedProject(project);
    const expectedWidth = expected?.documentWidth ?? this.documentWidth;
    const expectedHeight = expected?.documentHeight ?? this.documentHeight;
    if (
      project.summary.documentWidth !== expectedWidth
      || project.summary.documentHeight !== expectedHeight
    ) {
      throw new Error("The saved project head has incompatible document dimensions.");
    }
    if (
      expected
      && project.summary.headGenerationId !== expected.headGenerationId
    ) {
      throw new Error("The saved project head does not match the committed generation.");
    }
    return { project, url: this.projectUrl(project.summary.id) };
  }

  private async refreshExistingSwitchTarget(
    target: ProjectSessionEngineSwitchTarget,
  ): Promise<ProjectSessionEngineSwitchTarget> {
    if (target.kind !== "existing") return target;
    const expectedSummary = target.project!.summary;
    const verified = await this.verifyProjectHead(expectedSummary.id, expectedSummary);
    const summary = verified.project.summary;
    return {
      kind: "existing",
      project: verified.project,
      name: summary.name,
      documentWidth: summary.documentWidth,
      documentHeight: summary.documentHeight,
    };
  }

  private async saveNewTargetProject(name: string): Promise<VerifiedProjectHead> {
    const captured = await this.engine.captureDocument();
    const summary = await this.storage.saveProject({
      schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
      name,
      thumbnail: null,
      snapshot: captured.snapshot,
      chunks: captured.chunks,
    });
    return await this.verifyProjectHead(summary.id, summary);
  }

  private historySignature(): string {
    const state = this.engine.historyState();
    return `${state.cursor}|${state.actionCount}`;
  }

  private sceneSignature(): string {
    return JSON.stringify(this.engine.sceneSnapshot()) ?? "undefined";
  }

  private async reportSwitchStage(stage: ProjectSessionSwitchStage): Promise<void> {
    try {
      await this.onDocumentSwitchStage?.(stage);
    } catch (error) {
      console.warn(`Project switch progress callback failed at ${stage}:`, error);
    }
  }

  private createFallback(
    action: ProjectSessionSwitchFallback["action"],
    source: VerifiedProjectHead | null,
  ): ProjectSessionSwitchFallback {
    let url = source?.url ?? null;
    if (action === "reload-source" && url !== null) {
      const reloadUrl = new URL(url);
      reloadUrl.searchParams.set("projectSwitch", "reload");
      url = reloadUrl.href;
    }
    return {
      action,
      projectId: source?.project.summary.id ?? null,
      url,
    };
  }

  private async performSave(options: Readonly<ProjectSaveOptions>): Promise<void> {
    if (!this.editorReady) throw new Error("The editor is still starting.");
    this.saveBusy = true;
    this.syncSaveControl();
    this.setStatus("Saving the complete project…");
    try {
      await this.settleTransientEdits?.();
      await this.storage.initialize();
      // Capture a mutation boundary so a successful save never clears a newer
      // edit that landed during GPU readback or IndexedDB work.
      const capturedMutationRevision = this.mutationRevision;
      const captured = await this.engine.captureDocument();
      let thumbnail: Blob | null = null;
      if (
        options.captureThumbnail !== false
        && this.mutationRevision === capturedMutationRevision
      ) {
        try {
          thumbnail = await this.captureThumbnailBlob();
        } catch (error) {
          console.warn("Project thumbnail skipped:", error);
        }
      }
      const summary = await this.storage.saveProject({
        schemaVersion: PROJECT_DOCUMENT_SCHEMA_VERSION,
        ...(this.currentProjectId ? { projectId: this.currentProjectId } : {}),
        name: this.currentProjectName,
        ...(thumbnail
          ? { thumbnail }
          : this.currentProjectId
            ? {}
            : { thumbnail: null }),
        snapshot: captured.snapshot,
        chunks: captured.chunks,
      });
      this.currentProjectId = summary.id;
      this.currentHeadGenerationId = summary.headGenerationId;
      this.updateIdentity(summary.name);
      if (options.updateRoute !== false) this.updateUrl(summary.id);
      this.dirty = this.mutationRevision !== capturedMutationRevision;
      this.noteHistoryState(this.engine.historyState());
      this.noteSceneSnapshot(this.engine.sceneSnapshot());
      const savedTime = new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(summary.updatedAt));
      this.setStatus(
        this.dirty
          ? `Project saved locally at ${savedTime}; newer changes still need saving.`
          : `Project saved locally at ${savedTime}.`,
        this.dirty ? "working" : "ok",
      );
    } catch (error) {
      this.setStatus(
        error instanceof Error
          ? `Save failed: ${error.message}`
          : "The project could not be saved.",
        "error",
      );
      throw error;
    } finally {
      this.saveBusy = false;
      this.syncSaveControl();
    }
  }

  async returnHome(historyMode: "push" | "none" = "push"): Promise<void> {
    if (this.disposed || this.recoveryRequired || this.switchInProgress) return;
    if (this.savePromise) {
      try {
        await this.savePromise;
      } catch {
        // The explicit retry/leave decision below handles the failed state.
      }
    }
    try {
      await this.settleTransientEdits?.();
    } catch (error) {
      this.setStatus(
        error instanceof Error
          ? `Could not finish the current edit: ${error.message}`
          : "Could not finish the current edit.",
        "error",
      );
      return;
    }
    if (this.dirty) {
      try {
        await this.save();
      } catch {
        if (!this.browser.confirm("This project could not be saved. Leave the editor anyway?")) {
          return;
        }
      }
    }
    if (this.onReturnHome) {
      await this.onReturnHome(historyMode === "push");
      return;
    }
    const url = new URL(this.browser.location.href);
    url.search = "";
    url.hash = "";
    if (historyMode === "push") {
      this.browser.location.assign(url);
    } else {
      this.browser.location.replace(url);
    }
  }

  private async captureThumbnailBlob(): Promise<Blob | null> {
    const pixels = await this.engine.captureThumbnailPixels();
    const source = this.document.createElement("canvas");
    source.width = pixels.width;
    source.height = pixels.height;
    const sourceContext = source.getContext("2d", { alpha: false });
    if (!sourceContext) return null;
    const image = new ImageData(pixels.width, pixels.height);
    image.data.set(pixels.rgba);
    sourceContext.putImageData(image, 0, 0);

    const preview = this.document.createElement("canvas");
    const maximumEdge = 384;
    const scale = Math.min(maximumEdge / pixels.width, maximumEdge / pixels.height, 1);
    preview.width = Math.max(1, Math.round(pixels.width * scale));
    preview.height = Math.max(1, Math.round(pixels.height * scale));
    const context = preview.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#0d0f13";
    context.fillRect(0, 0, preview.width, preview.height);
    context.drawImage(source, 0, 0, preview.width, preview.height);
    return (await canvasBlob(preview, "image/webp", 0.82))
      ?? await canvasBlob(preview, "image/png");
  }

  private updateIdentity(name: string): void {
    this.currentProjectName = normalizeProjectTitle(name);
    this.document.title = `${this.currentProjectName} — M1M4.COM`;
  }

  private projectUrl(projectId: string): string {
    const url = new URL(this.browser.location.href);
    url.searchParams.set("project", projectId);
    url.searchParams.set("documentWidth", String(this.documentWidth));
    url.searchParams.set("documentHeight", String(this.documentHeight));
    if (this.documentWidth === this.documentHeight) {
      url.searchParams.set("documentSize", String(this.documentWidth));
    } else {
      url.searchParams.delete("documentSize");
    }
    url.searchParams.delete("newProject");
    url.searchParams.delete("projectName");
    url.searchParams.delete("home");
    return url.href;
  }

  private updateUrl(projectId: string, mode: "push" | "replace" = "replace"): void {
    const url = this.projectUrl(projectId);
    if (mode === "push") {
      this.browser.history.pushState(null, "", url);
    } else {
      this.browser.history.replaceState(null, "", url);
    }
  }

  private syncSaveControl(): void {
    const sessionUnavailable = this.disposed || this.recoveryRequired || this.switchInProgress;
    this.saveButton.disabled = !this.editorReady || this.saveBusy || sessionUnavailable;
    this.homeButton.disabled = !this.editorReady || sessionUnavailable;
    this.saveButton.classList.toggle("is-saving", this.saveBusy);
    this.saveButton.classList.toggle("is-dirty", this.dirty && !this.saveBusy);
    this.saveButton.setAttribute("aria-busy", String(this.saveBusy));
    this.saveButton.setAttribute(
      "aria-label",
      this.recoveryRequired
        ? "Project recovery required"
        : this.switchInProgress
          ? "Switching project"
          : !this.editorReady
        ? "Editor starting"
        : this.saveBusy
          ? "Saving project"
          : this.dirty
            ? "Save project — unsaved changes"
            : "Project saved",
    );
    this.saveButton.title = this.recoveryRequired
      ? "Reload the last saved project to recover."
      : this.switchInProgress
        ? "Switching project…"
        : !this.editorReady
          ? "Editor starting…"
          : this.saveBusy
            ? "Saving project…"
            : this.dirty
              ? "Save project (Ctrl/⌘+S)"
              : "Project saved";
  }

  private setStatus(message: string, kind: "working" | "ok" | "error" = "working"): void {
    this.status.textContent = message;
    this.status.className = `status ${kind === "working" ? "" : kind}`;
  }

  private handleSaveShortcut(event: KeyboardEvent): void {
    if (
      this.disposed
      || this.recoveryRequired
      || this.switchInProgress
      ||
      event.defaultPrevented
      || event.isComposing
      || event.altKey
      || (!event.ctrlKey && !event.metaKey)
      || event.key.toLowerCase() !== "s"
    ) {
      return;
    }
    event.preventDefault();
    void this.save().catch((error) => {
      console.error("Project save shortcut failed:", error);
    });
  }

  private handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty && !this.saveBusy && !this.switchInProgress && !this.recoveryRequired) return;
    event.preventDefault();
    event.returnValue = "";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.trackingReady = false;
    this.saveButton.removeEventListener("click", this.handleSaveButtonClick);
    this.homeButton.removeEventListener("click", this.handleHomeButtonClick);
    this.browser.removeEventListener("keydown", this.handleWindowKeydown);
    this.browser.removeEventListener("beforeunload", this.handleWindowBeforeUnload);
    if (this.browser.__projectEditorSessionLifecycle === this) {
      delete this.browser.__projectEditorSessionLifecycle;
    }
    this.syncSaveControl();
  }
}
