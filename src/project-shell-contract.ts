import type {
  ProjectLoadResultV1,
  ProjectStorage,
} from "./project-storage";
import type { GpuDeviceSession } from "./gpu-device-session";

export interface ExistingProjectSessionSwitchRequest {
  readonly kind: "existing";
  readonly projectId: string;
  /** Optional shell-started read that overlaps Home/editor presentation work. */
  readonly preloadedProject?: Promise<ProjectLoadResultV1 | null> | null;
  readonly historyMode?: "push" | "replace";
}

export interface NewProjectSessionSwitchRequest {
  readonly kind: "new";
  readonly name: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly historyMode?: "push" | "replace";
}

export type ProjectSessionSwitchRequest =
  | ExistingProjectSessionSwitchRequest
  | NewProjectSessionSwitchRequest;

export type ProjectSessionSwitchStage =
  | "availability"
  | "preload-target"
  | "start"
  | "settle-source"
  | "save-source"
  | "verify-source"
  | "preflight-engine"
  | "reset-engine"
  | "restore-target"
  | "commit-target"
  | "first-frame"
  | "save-target"
  | "publish-target";

export interface ProjectSessionSwitchFallback {
  /** `reload-source` is required after the engine crossed its reset boundary. */
  readonly action: "none" | "stay-current" | "reload-source";
  readonly projectId: string | null;
  readonly url: string | null;
}

export type ProjectSessionSwitchResult = {
  readonly status: "committed";
  readonly sourceProjectId: string | null;
  readonly targetProjectId: string;
  readonly targetProjectName: string;
  readonly targetKind: ProjectSessionSwitchRequest["kind"];
  readonly fallback: ProjectSessionSwitchFallback;
} | {
  readonly status: "unchanged";
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly fallback: ProjectSessionSwitchFallback;
} | {
  readonly status: "failed";
  readonly stage: ProjectSessionSwitchStage;
  readonly message: string;
  readonly destructive: boolean;
  readonly sourceProjectId: string | null;
  readonly requestedTarget: ProjectSessionSwitchRequest["kind"];
  readonly fallback: ProjectSessionSwitchFallback;
};

/** Stable editor-side endpoint installed for the lifetime of one GPU runtime. */
export interface ProjectEditorSessionLifecycle {
  readonly switchInProgress: boolean;
  switchProject(request: ProjectSessionSwitchRequest): Promise<ProjectSessionSwitchResult>;
  refreshCurrentProjectSummary(summary: ProjectLoadResultV1["summary"]): boolean;
  returnHome(historyMode?: "push" | "none"): Promise<void>;
  dispose(): void;
}

/**
 * Startup-to-editor handoff. The shell begins IndexedDB work before the large
 * WebGPU module is evaluated, so project I/O and GPU initialization overlap.
 */
export interface ProjectEditorBootstrap {
  readonly storage: ProjectStorage;
  readonly storageReady: Promise<void>;
  readonly preloadedProjectId: string | null;
  readonly preloadedProject: Promise<ProjectLoadResultV1 | null> | null;
  /** Exact Home-created session; the editor may adopt it or fall back cold. */
  readonly prewarmedGpuSession?: Promise<GpuDeviceSession | null> | null;
  readonly returnHome: (pushHistory: boolean) => Promise<void>;
}

declare global {
  interface Window {
    __projectEditorBootstrap?: ProjectEditorBootstrap;
    __projectEditorSessionLifecycle?: ProjectEditorSessionLifecycle;
  }
}

export {};
