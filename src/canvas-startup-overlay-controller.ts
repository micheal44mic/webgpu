import type { EngineStartupProgress } from "./engine-types";

const INITIAL_PROGRESS_PERCENT = 4;
const COMPLETION_HOLD_MS = 240;
const COMPLETION_FADE_MS = 180;

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
};

export interface CanvasStartupOverlayState {
  readonly percent: number;
  readonly label: string;
  readonly firstFrameGpuReady: boolean;
  readonly editorReady: boolean;
  readonly complete: boolean;
  readonly failed: boolean;
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
  private readonly interactionBlockedElements = new Set<HTMLElement>();
  private readonly root: Document;
  private readonly browser: Window;

  constructor(root: Document = document, browser: Window = window) {
    this.root = root;
    this.browser = browser;
  }

  reset(): void {
    this.clearHideTimer();
    this.state = createCanvasStartupOverlayState();
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.hidden = false;
    overlay.dataset.state = "loading";
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
        overlay.hidden = true;
        this.setEditorInteractionBlocked(false);
        this.hideTimer = null;
      }, COMPLETION_FADE_MS);
    }, COMPLETION_HOLD_MS);
  }

  fail(): void {
    this.clearHideTimer();
    this.state = {
      ...this.state,
      complete: false,
      failed: true,
    };
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.hidden = true;
    overlay.dataset.state = "failed";
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

  private clearHideTimer(): void {
    if (this.hideTimer === null) return;
    this.browser.clearTimeout(this.hideTimer);
    this.hideTimer = null;
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
