import type {
  ProjectLoadResultV1,
  ProjectStorage,
} from "./project-storage";

/**
 * Startup-to-editor handoff. The shell begins IndexedDB work before the large
 * WebGPU module is evaluated, so project I/O and GPU initialization overlap.
 */
export interface ProjectEditorBootstrap {
  readonly storage: ProjectStorage;
  readonly storageReady: Promise<void>;
  readonly preloadedProjectId: string | null;
  readonly preloadedProject: Promise<ProjectLoadResultV1 | null> | null;
  readonly returnHome: () => Promise<void>;
}

declare global {
  interface Window {
    __projectEditorBootstrap?: ProjectEditorBootstrap;
  }
}

export {};
