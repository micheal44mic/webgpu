import type { CapturedProjectDocumentV1 } from "./engine-project-runtime";
import type { HistoryState } from "./engine-types";
import {
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  normalizeProjectTitle,
  type ProjectLoadResultV1,
  type ProjectStorage,
} from "./project-storage";

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
export class ProjectSessionController {
  private readonly engine: ProjectSessionEnginePort;
  private readonly storage: ProjectStorage;
  private readonly browser: Window;
  private readonly document: Document;
  private readonly documentWidth: number;
  private readonly documentHeight: number;
  private readonly saveButton: HTMLButtonElement;
  private readonly homeButton: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
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

    this.currentProjectId = options.searchParams.get("project")?.trim() || null;
    this.newProjectRequested = this.currentProjectId !== null
      && options.searchParams.get("newProject") === "1";
    this.requestedProjectName = normalizeProjectTitle(
      options.searchParams.get("projectName") ?? "Untitled Artwork",
    );
    this.currentProjectName = this.requestedProjectName;
    this.dirty = this.newProjectRequested;

    this.saveButton.addEventListener("click", () => {
      void this.save().catch((error) => {
        console.error("Project save failed:", error);
      });
    });
    this.homeButton.addEventListener("click", () => {
      void this.returnHome();
    });
    this.browser.addEventListener("keydown", (event) => this.handleSaveShortcut(event));
    this.browser.addEventListener("beforeunload", (event) => this.handleBeforeUnload(event));

    this.syncSaveControl();
    this.homeButton.disabled = true;
  }

  markDirty(): void {
    if (!this.trackingReady) return;
    this.mutationRevision += 1;
    if (this.dirty) return;
    this.dirty = true;
    this.syncSaveControl();
  }

  noteHistoryState(state: Pick<HistoryState, "cursor" | "actionCount">): void {
    const signature = `${state.cursor}|${state.actionCount}`;
    if (
      this.trackingReady
      && this.historyMutationSignature !== ""
      && signature !== this.historyMutationSignature
    ) {
      this.markDirty();
    }
    this.historyMutationSignature = signature;
  }

  noteSceneSnapshot(snapshot: unknown): void {
    const signature = JSON.stringify(snapshot) ?? "undefined";
    if (
      this.trackingReady
      && this.sceneMutationSignature !== ""
      && signature !== this.sceneMutationSignature
    ) {
      this.markDirty();
    }
    this.sceneMutationSignature = signature;
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
    this.editorReady = true;
    if (this.currentProjectId && !this.newProjectRequested) {
      this.setStatus("Opening project…");
      const saved = await this.storage.loadProject(this.currentProjectId);
      if (!saved) throw new Error("This project is no longer available on this device.");
      this.updateIdentity(saved.summary.name);
      await this.engine.restoreDocument(saved);
      this.dirty = false;
    } else if (this.newProjectRequested) {
      this.updateIdentity(this.requestedProjectName);
      this.engine.setInitialLayerName("Layer 1");
      // The URL token selects the editor route; durable storage generates the
      // canonical id when the first head is committed.
      this.currentProjectId = null;
      await this.save();
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

  async save(): Promise<void> {
    if (this.savePromise) return this.savePromise;
    const operation = this.performSave();
    this.savePromise = operation;
    try {
      await operation;
    } finally {
      if (this.savePromise === operation) this.savePromise = null;
    }
  }

  private async performSave(): Promise<void> {
    if (!this.editorReady) throw new Error("The editor is still starting.");
    this.saveBusy = true;
    this.syncSaveControl();
    this.setStatus("Saving the complete project…");
    try {
      await this.storage.initialize();
      // Capture a mutation boundary so a successful save never clears a newer
      // edit that landed during GPU readback or IndexedDB work.
      const capturedMutationRevision = this.mutationRevision;
      const captured = await this.engine.captureDocument();
      let thumbnail: Blob | null = null;
      if (this.mutationRevision === capturedMutationRevision) {
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
      this.updateIdentity(summary.name);
      this.updateUrl(summary.id);
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

  private async returnHome(): Promise<void> {
    if (this.savePromise) {
      try {
        await this.savePromise;
      } catch {
        // The explicit retry/leave decision below handles the failed state.
      }
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
    const url = new URL(this.browser.location.href);
    url.search = "";
    url.hash = "";
    this.browser.location.assign(url);
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

  private updateUrl(projectId: string): void {
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
    this.browser.history.replaceState(null, "", url);
  }

  private syncSaveControl(): void {
    this.saveButton.disabled = !this.editorReady || this.saveBusy;
    this.saveButton.classList.toggle("is-saving", this.saveBusy);
    this.saveButton.classList.toggle("is-dirty", this.dirty && !this.saveBusy);
    this.saveButton.setAttribute("aria-busy", String(this.saveBusy));
    this.saveButton.setAttribute(
      "aria-label",
      !this.editorReady
        ? "Editor starting"
        : this.saveBusy
          ? "Saving project"
          : this.dirty
            ? "Save project — unsaved changes"
            : "Project saved",
    );
    this.saveButton.title = !this.editorReady
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
    if (!this.dirty && !this.saveBusy) return;
    event.preventDefault();
    event.returnValue = "";
  }
}
