import type { EngineCallbacks } from "./engine-types";
import type { StartupTelemetry } from "./startup-telemetry";

type EngineStartupPhaseEvent = Parameters<
  NonNullable<EngineCallbacks["onStartupPhase"]>
>[0];

export interface DeferredStartupSchedulerOptions {
  readonly browser: Window;
  readonly telemetry: StartupTelemetry;
  readonly onFailure: (name: string, error: unknown) => void;
}

/** Schedules non-critical startup work while keeping queue time measurable. */
export class DeferredStartupScheduler {
  private readonly options: DeferredStartupSchedulerOptions;

  constructor(options: DeferredStartupSchedulerOptions) {
    this.options = options;
  }

  schedule(name: string, task: () => Promise<void>, timeout: number): void {
    const { browser, telemetry } = this.options;
    telemetry.queue(name);
    const run = (): void => {
      void telemetry.track(name, task).catch((error) => {
        this.options.onFailure(name, error);
      });
    };
    if (typeof browser.requestIdleCallback === "function") {
      browser.requestIdleCallback(run, { timeout });
      return;
    }
    browser.setTimeout(run, 0);
  }

  afterFirstFrame(
    name: string,
    task: () => Promise<void>,
    timeout: number,
    delayMs = 0,
  ): void {
    const { browser, telemetry } = this.options;
    telemetry.queue(name);
    browser.requestAnimationFrame(() => {
      const schedule = (): void => this.schedule(name, task, timeout);
      if (delayMs > 0) browser.setTimeout(schedule, delayMs);
      else schedule();
    });
  }
}

/** One import promise per startup chunk, including retry after a rejected load. */
export function cachedStartupModuleLoader<Module>(
  telemetry: StartupTelemetry,
  phaseName: string,
  load: () => Promise<Module>,
): () => Promise<Module> {
  let promise: Promise<Module> | null = null;
  return async (): Promise<Module> => {
    if (promise) return promise;
    const loading = telemetry.track(phaseName, load);
    promise = loading;
    try {
      return await loading;
    } catch (error) {
      if (promise === loading) promise = null;
      throw error;
    }
  };
}

export function recordEngineStartupPhase(
  telemetry: StartupTelemetry,
  event: EngineStartupPhaseEvent,
): void {
  if (event.state === "start") telemetry.begin(event.name);
  else if (event.state === "complete") telemetry.complete(event.name);
  else telemetry.fail(event.name, event.error);
}

export function beginEditorStartup(
  telemetry: StartupTelemetry,
  options: {
    readonly mixedSceneEnabled: boolean;
    readonly restoreBrush: boolean;
  },
): void {
  telemetry.expectBackgroundTasks([
    ...(options.mixedSceneEnabled ? ["deferred-mixed-scene"] : []),
    "deferred-selection-pipelines",
    "deferred-blend-renderer",
    ...(options.restoreBrush ? ["deferred-brush-restore"] : []),
  ]);
  telemetry.begin("editor-startup");
  telemetry.begin("engine-initialize");
}

export function recordEngineReady(
  telemetry: StartupTelemetry,
  browser: Window,
): void {
  telemetry.complete("engine-initialize");
  telemetry.mark("engine-ready");
  browser.requestAnimationFrame(() => {
    telemetry.mark("first-canvas-frame-submitted");
    browser.requestAnimationFrame(() => telemetry.mark("first-canvas-paint-opportunity"));
  });
}

export function failEditorStartup(telemetry: StartupTelemetry, error: unknown): void {
  telemetry.fail("engine-initialize", error);
  telemetry.fail("editor-startup", error);
}
