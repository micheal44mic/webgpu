import type { EngineStartupProgress } from "./engine-types";

const INITIAL_PROGRESS_PERCENT = 4;
const COMPLETION_HOLD_MS = 240;
const COMPLETION_FADE_MS = 180;
const RUNTIME_REVEAL_DELAY_MS = 120;
const RUNTIME_INITIAL_PROGRESS_PERCENT = 12;

interface PhaseProgressRange {
  readonly started: number;
  readonly completed: number;
}

const PHASE_PROGRESS: Readonly<Record<string, PhaseProgressRange>> = {
  "adapter-request": { started: 4, completed: 8 },
  "device-request": { started: 10, completed: 15 },
  "canvas-rgba16float": { started: 17, completed: 22 },
  "core-layouts": { started: 24, completed: 29 },
  "core-pipelines": { started: 31, completed: 38 },
  "document-pipelines": { started: 40, completed: 70 },
  "document-display-textures": { started: 72, completed: 76 },
  "document-layer-texture": { started: 78, completed: 82 },
  "document-bindings": { started: 84, completed: 87 },
  "history-view": { started: 89, completed: 91 },
  "selected-brush-first-use": { started: 92, completed: 93 },
  "first-frame-submit": { started: 94, completed: 95 },
  "first-frame-gpu": { started: 96, completed: 97 },
  "restore-active-brush": { started: 98, completed: 98 },
  "project-session": { started: 99, completed: 99 },
  "editor-ready": { started: 99, completed: 99 },
  // A same-runtime project switch reuses the already compiled GPU programs,
  // so its progress follows the document replacement boundary rather than the
  // one-time adapter/device pipeline phases above.
  "document-switch-availability": { started: 4, completed: 4 },
  "document-switch-preload-target": { started: 10, completed: 10 },
  "document-switch-start": { started: 18, completed: 18 },
  "document-switch-settle-source": { started: 25, completed: 25 },
  "document-switch-save-source": { started: 36, completed: 36 },
  "document-switch-verify-source": { started: 42, completed: 42 },
  "document-switch-preflight-engine": { started: 50, completed: 50 },
  "document-switch-reset-engine": { started: 60, completed: 60 },
  "document-switch-restore-target": { started: 78, completed: 78 },
  "document-switch-commit-target": { started: 88, completed: 88 },
  "document-switch-first-frame": { started: 96, completed: 96 },
  "document-switch-save-target": { started: 98, completed: 98 },
  "document-switch-publish-target": { started: 99, completed: 99 },
};

export interface CanvasStartupOverlayState {
  readonly percent: number;
  readonly label: string;
  readonly firstFrameGpuReady: boolean;
  readonly editorReady: boolean;
  readonly complete: boolean;
  readonly failed: boolean;
}

export interface CanvasRuntimeLoadingOperation {
  update(label: string): void;
  complete(): void;
  fail(): void;
}

export function createCanvasStartupOverlayState(): CanvasStartupOverlayState {
  return {
    percent: INITIAL_PROGRESS_PERCENT,
    label: "Opening canvas",
    firstFrameGpuReady: false,
    editorReady: false,
    complete: false,
    failed: false,
  };
}

export function reduceCanvasStartupOverlayState(
  current: CanvasStartupOverlayState,
  progress: EngineStartupProgress,
): CanvasStartupOverlayState {
  const range = PHASE_PROGRESS[progress.phase];
  const phasePercent = range
    ? range[progress.state === "completed" ? "completed" : "started"]
    : current.percent;
  const firstFrameGpuReady = current.firstFrameGpuReady
    || (progress.phase === "first-frame-gpu" && progress.state === "completed");
  const editorReady = current.editorReady
    || (progress.phase === "editor-ready" && progress.state === "completed");
  const failed = current.failed || progress.state === "failed";
  const complete = !failed && firstFrameGpuReady && editorReady;

  return {
    percent: complete ? 100 : Math.max(current.percent, phasePercent),
    label: complete ? "Canvas ready" : progress.label || current.label,
    firstFrameGpuReady,
    editorReady,
    complete,
    failed,
  };
}

export class CanvasStartupOverlayController {
  private state = createCanvasStartupOverlayState();
  private hideTimer: number | null = null;
  private runtimeRevealTimer: number | null = null;
  private runtimeOperationSequence = 0;
  private readonly runtimeOperations = new Map<number, string>();
  private runtimeFailureObserved = false;
  private presentationMode: "idle" | "startup" | "runtime" = "idle";
  private readonly interactionBlockedElements = new Set<HTMLElement>();
  private readonly root: Document;
  private readonly browser: Window;

  constructor(root: Document = document, browser: Window = window) {
    this.root = root;
    this.browser = browser;
  }

  reset(): void {
    this.clearHideTimer();
    this.clearRuntimeRevealTimer();
    this.state = createCanvasStartupOverlayState();
    this.presentationMode = "startup";
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.hidden = false;
    overlay.dataset.state = "loading";
    overlay.dataset.mode = "startup";
    overlay.setAttribute("aria-busy", "true");
    this.setEditorInteractionBlocked(true);
    this.render();
  }

  isVisible(): boolean {
    const overlay = this.overlay;
    return overlay !== null && !overlay.hidden;
  }

  report(progress: EngineStartupProgress): void {
    this.state = reduceCanvasStartupOverlayState(this.state, progress);
    if (this.state.failed) {
      this.fail();
      return;
    }
    this.render();
    if (!this.state.complete) return;

    const overlay = this.overlay;
    if (!overlay) return;
    overlay.setAttribute("aria-busy", "false");
    this.clearHideTimer();
    this.hideTimer = this.browser.setTimeout(() => {
      overlay.dataset.state = "complete";
      this.hideTimer = this.browser.setTimeout(() => {
        this.hideTimer = null;
        this.presentationMode = "idle";
        if (this.runtimeOperations.size > 0) {
          this.showRuntimeOverlay();
          return;
        }
        overlay.hidden = true;
        this.setEditorInteractionBlocked(false);
      }, COMPLETION_FADE_MS);
    }, COMPLETION_HOLD_MS);
  }

  beginRuntimeOperation(label: string): CanvasRuntimeLoadingOperation {
    const operationId = ++this.runtimeOperationSequence;
    if (this.runtimeOperations.size === 0) this.runtimeFailureObserved = false;
    this.runtimeOperations.set(operationId, label.trim() || "Loading");
    this.setEditorInteractionBlocked(true);
    if (this.presentationMode === "runtime") {
      this.clearHideTimer();
      this.showRuntimeOverlay();
    } else if (this.presentationMode === "idle") {
      this.clearHideTimer();
      this.scheduleRuntimeReveal();
    }

    let settled = false;
    const settle = (failed: boolean): void => {
      if (settled) return;
      settled = true;
      this.finishRuntimeOperation(operationId, failed);
    };
    return Object.freeze({
      update: (nextLabel: string) => {
        if (settled || !this.runtimeOperations.has(operationId)) return;
        this.runtimeOperations.set(operationId, nextLabel);
        if (this.presentationMode === "runtime") this.renderRuntimeOperation();
      },
      complete: () => settle(false),
      fail: () => settle(true),
    });
  }

  async runRuntimeOperation<Result>(
    label: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const loading = this.beginRuntimeOperation(label);
    try {
      const result = await operation();
      loading.complete();
      return result;
    } catch (error) {
      loading.fail();
      throw error;
    }
  }

  fail(): void {
    this.clearHideTimer();
    this.clearRuntimeRevealTimer();
    this.runtimeOperations.clear();
    this.runtimeFailureObserved = false;
    this.state = {
      ...this.state,
      complete: false,
      failed: true,
    };
    this.presentationMode = "idle";
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.hidden = true;
    overlay.dataset.state = "failed";
    overlay.setAttribute("aria-busy", "false");
    this.setEditorInteractionBlocked(false);
  }

  /** Hides a speculative overlay when no document replacement was needed. */
  dismiss(): void {
    this.clearHideTimer();
    this.clearRuntimeRevealTimer();
    this.state = createCanvasStartupOverlayState();
    this.presentationMode = "idle";
    if (this.runtimeOperations.size > 0) {
      this.showRuntimeOverlay();
      return;
    }
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.hidden = true;
    overlay.dataset.state = "idle";
    overlay.setAttribute("aria-busy", "false");
    this.setEditorInteractionBlocked(false);
  }

  private get overlay(): HTMLElement | null {
    return this.root.getElementById("canvasStartupOverlay");
  }

  private render(): void {
    const overlay = this.overlay;
    const progressBar = this.root.getElementById("canvasStartupProgress");
    const progressFill = this.root.getElementById("canvasStartupProgressFill");
    const progressLabel = this.root.getElementById("canvasStartupLabel");
    if (!overlay || !progressBar || !progressFill || !progressLabel) return;

    const percent = Math.round(this.state.percent);
    overlay.style.setProperty("--canvas-startup-progress", String(percent / 100));
    progressBar.setAttribute("aria-valuenow", String(percent));
    progressBar.setAttribute("aria-valuetext", this.state.label);
    progressLabel.textContent = this.state.label;
  }

  private scheduleRuntimeReveal(): void {
    if (this.runtimeRevealTimer !== null || this.runtimeOperations.size === 0) return;
    this.runtimeRevealTimer = this.browser.setTimeout(() => {
      this.runtimeRevealTimer = null;
      this.showRuntimeOverlay();
    }, RUNTIME_REVEAL_DELAY_MS);
  }

  private showRuntimeOverlay(): void {
    if (this.runtimeOperations.size === 0 || this.presentationMode === "startup") return;
    this.clearRuntimeRevealTimer();
    this.clearHideTimer();
    this.presentationMode = "runtime";
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.hidden = false;
    overlay.dataset.state = "loading";
    overlay.dataset.mode = "runtime";
    overlay.setAttribute("aria-busy", "true");
    this.setEditorInteractionBlocked(true);
    this.renderRuntimeOperation();
  }

  private renderRuntimeOperation(): void {
    const overlay = this.overlay;
    const progressBar = this.root.getElementById("canvasStartupProgress");
    const progressLabel = this.root.getElementById("canvasStartupLabel");
    if (!overlay || !progressBar || !progressLabel) return;
    const labels = [...this.runtimeOperations.values()];
    const label = labels.at(-1) ?? "Loading";
    overlay.style.setProperty(
      "--canvas-startup-progress",
      String(RUNTIME_INITIAL_PROGRESS_PERCENT / 100),
    );
    progressBar.removeAttribute("aria-valuenow");
    progressBar.setAttribute("aria-valuetext", label);
    progressLabel.textContent = label;
  }

  private finishRuntimeOperation(operationId: number, failed: boolean): void {
    if (!this.runtimeOperations.delete(operationId)) return;
    this.runtimeFailureObserved ||= failed;
    if (this.runtimeOperations.size > 0) {
      if (this.presentationMode === "runtime") this.renderRuntimeOperation();
      return;
    }
    this.clearRuntimeRevealTimer();
    if (this.presentationMode !== "runtime") {
      if (this.presentationMode === "idle") this.setEditorInteractionBlocked(false);
      return;
    }

    const overlay = this.overlay;
    const progressBar = this.root.getElementById("canvasStartupProgress");
    const progressLabel = this.root.getElementById("canvasStartupLabel");
    if (!overlay || !progressBar || !progressLabel) {
      this.presentationMode = "idle";
      this.setEditorInteractionBlocked(false);
      return;
    }
    overlay.style.setProperty("--canvas-startup-progress", "1");
    overlay.dataset.state = "finishing";
    overlay.setAttribute("aria-busy", "false");
    progressBar.setAttribute("aria-valuenow", "100");
    const terminalLabel = this.runtimeFailureObserved ? "Loading stopped" : "Ready";
    progressBar.setAttribute("aria-valuetext", terminalLabel);
    progressLabel.textContent = terminalLabel;
    this.clearHideTimer();
    this.hideTimer = this.browser.setTimeout(() => {
      overlay.dataset.state = "complete";
      this.hideTimer = this.browser.setTimeout(() => {
        this.hideTimer = null;
        if (this.runtimeOperations.size > 0) {
          this.showRuntimeOverlay();
          return;
        }
        overlay.hidden = true;
        overlay.dataset.mode = "idle";
        this.presentationMode = "idle";
        this.runtimeFailureObserved = false;
        this.setEditorInteractionBlocked(false);
      }, COMPLETION_FADE_MS);
    }, COMPLETION_HOLD_MS);
  }

  private clearHideTimer(): void {
    if (this.hideTimer === null) return;
    this.browser.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private clearRuntimeRevealTimer(): void {
    if (this.runtimeRevealTimer === null) return;
    this.browser.clearTimeout(this.runtimeRevealTimer);
    this.runtimeRevealTimer = null;
  }

  private setEditorInteractionBlocked(blocked: boolean): void {
    const overlay = this.overlay;
    const editor = overlay?.parentElement;
    if (!overlay || !editor) return;

    if (blocked) {
      for (const child of editor.children) {
        if (!(child instanceof HTMLElement) || child === overlay || child.inert) continue;
        child.inert = true;
        this.interactionBlockedElements.add(child);
      }
      return;
    }

    for (const element of this.interactionBlockedElements) element.inert = false;
    this.interactionBlockedElements.clear();
  }
}

let sharedController: CanvasStartupOverlayController | null = null;

export function getCanvasStartupOverlayController(): CanvasStartupOverlayController {
  sharedController ??= new CanvasStartupOverlayController();
  return sharedController;
}
