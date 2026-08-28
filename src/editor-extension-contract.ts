import type { BrushEngine } from "./brush-engine";
import type {
  BrushEngineOptions,
  BrushSettings,
  EngineStartupProgress,
} from "./engine-types";
import type { EngineStats } from "./engine-stats";
import type { MixedSceneController } from "./mixed-scene-controller";
import type { PointerSample } from "./engine-types";

/**
 * Neutral, optional seam for development tooling.
 *
 * Production does not import any lab implementation. A dedicated entry may
 * register a factory before loading the editor; the editor then exposes only
 * the capabilities listed here.
 */
export interface EditorExtensionHost {
  readonly engine: BrushEngine;
  readonly canvas: HTMLCanvasElement;
  ensureMixedSceneController(): Promise<MixedSceneController>;
  applyBrushSettings(settings: BrushSettings): void;
  collectInputDiagnostics(): Readonly<Record<string, unknown>>;
  refreshControls(): void;
  refreshStats(stats?: EngineStats): void;
  setStatus(message: string, kind?: "working" | "ok" | "error"): void;
}

export interface EditorExtension {
  isBusy(): boolean;
  syncControls(editorLocked: boolean): void;
  afterEngineInitialized(): Promise<void>;
  handleEngineInitializationError(error: unknown): void;
  handleEngineStartupProgress?(progress: EngineStartupProgress): void;
  wantsPaintRecording?(): boolean;
  beginPaintRecording?(event: PointerEvent, sample: PointerSample): void;
  capturePaintRecording?(
    events: readonly PointerEvent[],
    samples: readonly PointerSample[],
  ): void;
  beginPaintReleaseRecording?(event: PointerEvent): void;
  finishPaintRecording?(commit: boolean): void;
  cancelPaintRecording?(): void;
}

export interface EditorExtensionBootstrap {
  readonly engineOptions?: Partial<BrushEngineOptions>;
  readonly vectorTextClippedRefreshPolicy?: "during-gesture" | "on-release";
  readonly restorePersistedBrushOnStartup?: boolean;
  readonly startupProgressEnabled?: boolean;
  readonly create: (host: EditorExtensionHost) => EditorExtension;
}

declare global {
  interface Window {
    __editorExtensionBootstrap?: EditorExtensionBootstrap;
    __editorLabReport?: unknown;
  }
}

export {};
