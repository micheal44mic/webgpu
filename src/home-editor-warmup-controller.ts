import {
  createGpuDeviceSessionPrewarmer,
  type GpuDeviceSession,
  type GpuDeviceSessionPrewarmer,
} from "./gpu-device-session";

export type HomeEditorWarmupState =
  | "disabled"
  | "scheduled"
  | "running"
  | "ready"
  | "handed-off"
  | "failed";

export type HomeEditorWarmupTaskState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface HomeEditorWarmupTaskContext {
  readonly session: GpuDeviceSession;
  /** Yield back to Home before starting another bounded piece of work. */
  yieldToHome(): Promise<void>;
  editorOpening(): boolean;
}

/**
 * Context for work that is safe before an adapter or device is requested.
 * Keeping the GPU session out of this type makes the lane device-free by
 * construction instead of relying on each task to remember that constraint.
 */
export interface HomeEditorPreGpuWarmupTaskContext {
  /** Yield back to Home before starting another bounded piece of work. */
  yieldToHome(): Promise<void>;
  editorOpening(): boolean;
}

export interface HomeEditorPreGpuWarmupTask {
  readonly id: string;
  readonly run: (context: HomeEditorPreGpuWarmupTaskContext) => Promise<unknown>;
}

export interface HomeEditorWarmupTask {
  readonly id: string;
  /** Required only while a task holds a device-global validation/error scope. */
  readonly blocksEditorDeviceUse?: boolean;
  readonly run: (context: HomeEditorWarmupTaskContext) => Promise<unknown>;
}

export interface HomeEditorWarmupTaskReport {
  readonly id: string;
  readonly state: HomeEditorWarmupTaskState;
  readonly startedAtMs: number | null;
  readonly durationMs: number | null;
  readonly detail: unknown;
  readonly error: string | null;
}

export interface HomeEditorWarmupReport {
  readonly schema: "home-editor-warmup-v1";
  readonly state: HomeEditorWarmupState;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly startedAtMs: number | null;
  readonly durationMs: number | null;
  readonly gpuSessionDurationMs: number | null;
  readonly editorOpening: boolean;
  readonly gpuSessionReady: boolean;
  readonly policy: {
    readonly initialQuietPeriodMs: number;
    readonly maximumGpuQuietPeriodMs: number;
    readonly betweenTaskQuietPeriodMs: number;
    readonly earlyJankFrameGapMs: number;
    readonly minimumEarlyFrameSamples: number;
    readonly gpuQuietReason: "pending" | "smooth" | "early-jank" | "insufficient-samples";
  };
  readonly gpu: {
    readonly currentBytes: number;
    readonly peakBytes: number;
    readonly textureCount: number;
    readonly bufferCount: number;
    readonly createdCount: number;
  } | null;
  readonly responsiveness: {
    readonly frameSamples: number;
    readonly frameP95Ms: number;
    readonly maximumFrameGapMs: number;
    readonly framesOver33Ms: number;
  };
  readonly preGpuTasks: readonly HomeEditorWarmupTaskReport[];
  readonly tasks: readonly HomeEditorWarmupTaskReport[];
  readonly errors: readonly string[];
}

export interface HomeEditorWarmupControllerOptions {
  readonly enabled: boolean;
  readonly preGpuTasks?: readonly HomeEditorPreGpuWarmupTask[];
  readonly tasks: readonly HomeEditorWarmupTask[];
  readonly browser?: Window;
  readonly document?: Document;
  readonly prewarmer?: GpuDeviceSessionPrewarmer;
}

export interface HomeEditorWarmupController {
  /** Starts after Home has painted. Repeated calls share one run. */
  start(): Promise<void>;
  /** Returns the exact session promise the editor should adopt. */
  prepareGpuSessionForEditor(): Promise<GpuDeviceSession> | null;
  /** Stops optional Home work; already-started cache work is allowed to settle. */
  handOffToEditor(): void;
  /** Releases Home-only listeners when the shell no longer owns this controller. */
  dispose(): void;
  snapshot(): HomeEditorWarmupReport;
}

interface MutableTaskReport {
  id: string;
  state: HomeEditorWarmupTaskState;
  startedAtMs: number | null;
  durationMs: number | null;
  detail: unknown;
  error: string | null;
}

declare global {
  interface Window {
    /** JSON-safe local A/B diagnostics; it never exposes the GPU device. */
    __homeEditorWarmupReport?: HomeEditorWarmupReport;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function serializableDetail(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

export function createHomeEditorWarmupController(
  options: HomeEditorWarmupControllerOptions,
): HomeEditorWarmupController {
  const browser = options.browser ?? window;
  const documentObject = options.document ?? document;
  const prewarmer = options.prewarmer ?? createGpuDeviceSessionPrewarmer();
  const userAgent = (browser as Partial<Window>).navigator?.userAgent ?? "";
  const touchDevice = /\b(?:Android|iPhone|iPad|iPod)\b/i.test(userAgent);
  const baseGpuQuietPeriodMs = 1_200;
  const maximumGpuQuietPeriodMs = touchDevice ? 3_000 : baseGpuQuietPeriodMs;
  const earlyJankFrameGapMs = 50;
  const minimumEarlyFrameSamples = 2;
  let initialQuietPeriodMs = baseGpuQuietPeriodMs;
  let gpuQuietReason: HomeEditorWarmupReport["policy"]["gpuQuietReason"] = "pending";
  const betweenTaskQuietPeriodMs = touchDevice ? 600 : 350;
  const createdAt = new Date().toISOString();
  const preGpuTaskReports: MutableTaskReport[] = (options.preGpuTasks ?? []).map((task) => ({
    id: task.id,
    state: options.enabled ? "pending" : "skipped",
    startedAtMs: null,
    durationMs: null,
    detail: null,
    error: null,
  }));
  const taskReports: MutableTaskReport[] = options.tasks.map((task) => ({
    id: task.id,
    state: options.enabled ? "pending" : "skipped",
    startedAtMs: null,
    durationMs: null,
    detail: null,
    error: null,
  }));
  const errors: string[] = [];
  const frameGaps: number[] = [];
  let state: HomeEditorWarmupState = options.enabled ? "scheduled" : "disabled";
  let startedAtMs: number | null = null;
  let completedAtMs: number | null = null;
  let gpuSessionDurationMs: number | null = null;
  let sessionPromise: Promise<GpuDeviceSession> | null = null;
  let session: GpuDeviceSession | null = null;
  let activeTaskSettlement: Promise<void> | null = null;
  let activeTaskBlocksEditorDeviceUse = false;
  let startPromise: Promise<void> | null = null;
  let editorOpening = false;
  let stopRequested = false;
  let gpuTaskFailed = false;
  let idleCancellation: (() => void) | null = null;
  let frameRequest = 0;
  const pendingFrameWaits = new Map<number, () => void>();
  let previousFrameAtMs: number | null = null;
  let lastInputAtMs = browser.performance.now();
  const diagnosticsElement = options.enabled && documentObject.head
    ? (() => {
        const existing = documentObject.getElementById("homeEditorWarmupDiagnostics");
        if (existing instanceof HTMLScriptElement) return existing;
        const element = documentObject.createElement("script");
        element.id = "homeEditorWarmupDiagnostics";
        element.type = "application/json";
        documentObject.head.append(element);
        return element;
      })()
    : null;

  const snapshot = (): HomeEditorWarmupReport => {
    const gpuSnapshot = session?.registry.snapshot() ?? null;
    return {
      schema: "home-editor-warmup-v1",
      state,
      enabled: options.enabled,
      createdAt,
      startedAtMs,
      durationMs: startedAtMs === null
        ? null
        : (completedAtMs ?? browser.performance.now()) - startedAtMs,
      gpuSessionDurationMs,
      editorOpening,
      gpuSessionReady: session !== null && !session.lost,
      policy: {
        initialQuietPeriodMs,
        maximumGpuQuietPeriodMs,
        betweenTaskQuietPeriodMs,
        earlyJankFrameGapMs,
        minimumEarlyFrameSamples,
        gpuQuietReason,
      },
      gpu: gpuSnapshot
        ? {
            currentBytes: gpuSnapshot.currentBytes,
            peakBytes: gpuSnapshot.peakBytes,
            textureCount: gpuSnapshot.textureCount,
            bufferCount: gpuSnapshot.bufferCount,
            createdCount: gpuSnapshot.createdCount,
          }
        : null,
      responsiveness: {
        frameSamples: frameGaps.length,
        frameP95Ms: percentile95(frameGaps),
        maximumFrameGapMs: frameGaps.length > 0 ? Math.max(...frameGaps) : 0,
        framesOver33Ms: frameGaps.filter((gap) => gap > 33).length,
      },
      preGpuTasks: preGpuTaskReports.map((task) => ({ ...task })),
      tasks: taskReports.map((task) => ({ ...task })),
      errors: [...errors],
    };
  };

  const publishSnapshot = (): void => {
    const report = snapshot();
    // Some embedded browser realms intentionally seal Window. Diagnostics are
    // opportunistic and must never prevent the actual warm-up from starting.
    try {
      browser.__homeEditorWarmupReport = report;
    } catch {
      // The non-rendering JSON node below remains available to local tests.
    }
    if (diagnosticsElement) diagnosticsElement.textContent = JSON.stringify(report);
  };

  const noteInput = (): void => {
    lastInputAtMs = browser.performance.now();
  };

  const onFrame = (timestamp: number): void => {
    if (previousFrameAtMs !== null) frameGaps.push(timestamp - previousFrameAtMs);
    previousFrameAtMs = timestamp;
    if (
      state === "scheduled"
      || state === "running"
      || (state === "handed-off" && !editorOpening)
    ) {
      frameRequest = browser.requestAnimationFrame(onFrame);
    }
  };

  const stopFrameSampling = (): void => {
    if (frameRequest !== 0) browser.cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  };

  const waitForFrame = (): Promise<void> => {
    if (stopRequested) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      let frameId = 0;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        pendingFrameWaits.delete(frameId);
        resolve();
      };
      frameId = browser.requestAnimationFrame(finish);
      pendingFrameWaits.set(frameId, () => {
        browser.cancelAnimationFrame(frameId);
        finish();
      });
    });
  };

  const cancelPendingFrameWaits = (): void => {
    for (const cancel of [...pendingFrameWaits.values()]) cancel();
    pendingFrameWaits.clear();
  };

  const waitForVisibility = async (): Promise<void> => {
    while (!stopRequested && documentObject.visibilityState !== "visible") {
      await new Promise<void>((resolve) => {
        const onVisibility = (): void => {
          if (documentObject.visibilityState !== "visible" && !stopRequested) return;
          documentObject.removeEventListener("visibilitychange", onVisibility);
          resolve();
        };
        documentObject.addEventListener("visibilitychange", onVisibility);
        idleCancellation = () => {
          documentObject.removeEventListener("visibilitychange", onVisibility);
          resolve();
        };
      });
      idleCancellation = null;
    }
  };

  const waitForQuietPeriod = async (minimumQuietMs: number): Promise<void> => {
    while (!stopRequested) {
      const remaining = minimumQuietMs - (browser.performance.now() - lastInputAtMs);
      if (remaining <= 0) return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          idleCancellation = null;
          resolve();
        };
        const timeoutId = browser.setTimeout(finish, Math.ceil(remaining));
        idleCancellation = () => {
          browser.clearTimeout(timeoutId);
          finish();
        };
      });
    }
  };

  const waitForIdle = async (): Promise<void> => {
    await waitForVisibility();
    if (stopRequested) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        idleCancellation = null;
        resolve();
      };
      if (typeof browser.requestIdleCallback === "function") {
        const idleId = browser.requestIdleCallback(() => finish(), { timeout: 1_200 });
        idleCancellation = () => {
          browser.cancelIdleCallback(idleId);
          finish();
        };
      } else {
        const timeoutId = browser.setTimeout(finish, 32);
        idleCancellation = () => {
          browser.clearTimeout(timeoutId);
          finish();
        };
      }
    });
  };

  const yieldToHome = async (): Promise<void> => {
    if (stopRequested) return;
    await waitForFrame();
    await waitForQuietPeriod(betweenTaskQuietPeriodMs);
    await waitForIdle();
  };

  const yieldPreGpuWorkToHome = async (): Promise<void> => {
    if (stopRequested) return;
    await waitForFrame();
    await waitForIdle();
  };

  const selectAdaptiveGpuQuietPeriod = (): void => {
    if (!touchDevice) {
      initialQuietPeriodMs = baseGpuQuietPeriodMs;
      gpuQuietReason = "smooth";
      return;
    }
    // Two clean post-paint samples are enough to use the short path. The
    // longer grace period remains a safety valve for slow mobile Homes; it is
    // no longer charged to every phone unconditionally.
    if (frameGaps.length < minimumEarlyFrameSamples) {
      initialQuietPeriodMs = maximumGpuQuietPeriodMs;
      gpuQuietReason = "insufficient-samples";
      return;
    }
    const earlyMaximumFrameGapMs = Math.max(...frameGaps);
    if (earlyMaximumFrameGapMs > earlyJankFrameGapMs) {
      initialQuietPeriodMs = maximumGpuQuietPeriodMs;
      gpuQuietReason = "early-jank";
      return;
    }
    initialQuietPeriodMs = baseGpuQuietPeriodMs;
    gpuQuietReason = "smooth";
  };

  const ensureSessionPromise = (): Promise<GpuDeviceSession> => {
    if (session?.lost === true) {
      session = null;
      sessionPromise = null;
    }
    if (sessionPromise) return sessionPromise;
    const pending = prewarmer.prepare();
    sessionPromise = pending;
    void pending.then(
      (prepared) => {
        if (sessionPromise !== pending) return;
        session = prepared;
        publishSnapshot();
      },
      () => {
        if (sessionPromise !== pending) return;
        sessionPromise = null;
        session = null;
      },
    );
    return pending;
  };

  const markRemainingSkipped = (): void => {
    for (const report of preGpuTaskReports) {
      if (report.state === "pending") report.state = "skipped";
    }
    for (const report of taskReports) {
      if (report.state === "pending") report.state = "skipped";
    }
  };

  const inputEvents = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
  let inputListenersInstalled = false;
  const installInputListeners = (): void => {
    if (!options.enabled || inputListenersInstalled) return;
    inputListenersInstalled = true;
    for (const eventName of inputEvents) {
      browser.addEventListener(eventName, noteInput, { capture: true, passive: true });
    }
  };
  const removeInputListeners = (): void => {
    if (!inputListenersInstalled) return;
    inputListenersInstalled = false;
    for (const eventName of inputEvents) {
      browser.removeEventListener(eventName, noteInput, { capture: true });
    }
  };

  const run = async (): Promise<void> => {
    if (!options.enabled || stopRequested) return;
    startedAtMs = browser.performance.now();
    frameRequest = browser.requestAnimationFrame(onFrame);
    publishSnapshot();
    // Home must become visible and interactive before any driver or module work.
    await waitForFrame();
    await waitForFrame();
    await waitForIdle();
    if (stopRequested) {
      markRemainingSkipped();
      completedAtMs = browser.performance.now();
      publishSnapshot();
      stopFrameSampling();
      removeInputListeners();
      return;
    }

    state = "running";
    publishSnapshot();
    const preGpuTasks = options.preGpuTasks ?? [];
    for (let index = 0; index < preGpuTasks.length; index += 1) {
      const task = preGpuTasks[index];
      const report = preGpuTaskReports[index];
      if (index > 0) await yieldPreGpuWorkToHome();
      if (stopRequested) break;
      report.state = "running";
      report.startedAtMs = browser.performance.now();
      publishSnapshot();
      try {
        report.detail = serializableDetail(await task.run({
          yieldToHome: yieldPreGpuWorkToHome,
          editorOpening: () => editorOpening,
        }));
        report.state = "completed";
      } catch (error) {
        const message = errorMessage(error);
        report.error = message;
        report.state = "failed";
        errors.push(`pre-gpu ${task.id}: ${message}`);
        // This lane only fills best-effort CPU/module caches. Its failure must
        // not prevent the exact GPU session from being prepared and adopted.
        console.error(`Home editor pre-GPU warm-up task ${task.id} failed:`, error);
      } finally {
        report.durationMs = browser.performance.now() - report.startedAtMs;
        publishSnapshot();
      }
    }

    // Include the final device-free task in the early responsiveness sample
    // before choosing whether this phone needs the longer GPU safety delay.
    if (!stopRequested) await waitForFrame();
    selectAdaptiveGpuQuietPeriod();
    publishSnapshot();
    // Give fast taps priority. If the user opens a canvas during this gate,
    // handoff cancels it immediately and requests the editor session directly.
    await waitForQuietPeriod(initialQuietPeriodMs);
    await waitForIdle();
    if (stopRequested) {
      markRemainingSkipped();
      completedAtMs = browser.performance.now();
      publishSnapshot();
      stopFrameSampling();
      removeInputListeners();
      return;
    }

    const gpuSessionStartedAtMs = browser.performance.now();
    try {
      session = await ensureSessionPromise();
      gpuSessionDurationMs = browser.performance.now() - gpuSessionStartedAtMs;
      const initialGpu = session.registry.snapshot();
      if (initialGpu.createdCount !== 0) {
        throw new Error("The Home GPU session created document resources before warm-up tasks.");
      }
    } catch (error) {
      gpuSessionDurationMs ??= browser.performance.now() - gpuSessionStartedAtMs;
      const message = errorMessage(error);
      errors.push(message);
      state = "failed";
      markRemainingSkipped();
      completedAtMs = browser.performance.now();
      console.error("Home editor GPU preparation failed:", error);
      publishSnapshot();
      stopFrameSampling();
      removeInputListeners();
      return;
    }

    for (let index = 0; index < options.tasks.length; index += 1) {
      const task = options.tasks[index];
      const report = taskReports[index];
      await yieldToHome();
      if (stopRequested) break;
      report.state = "running";
      report.startedAtMs = browser.performance.now();
      publishSnapshot();
      const resourcesBefore = session.registry.snapshot().createdCount;
      const taskPromise = Promise.resolve().then(() => task.run({
        session: session!,
        yieldToHome,
        editorOpening: () => editorOpening,
      }));
      const taskSettlement = taskPromise.then(() => undefined, () => undefined);
      activeTaskSettlement = taskSettlement;
      activeTaskBlocksEditorDeviceUse = task.blocksEditorDeviceUse === true;
      try {
        const detail = await taskPromise;
        if (!editorOpening) {
          const resourcesAfter = session.registry.snapshot().createdCount;
          if (resourcesAfter !== resourcesBefore) {
            throw new Error(
              `Home warm-up task ${task.id} created ${resourcesAfter - resourcesBefore} GPU buffer or texture resources.`,
            );
          }
        }
        report.detail = serializableDetail(detail);
        report.state = "completed";
      } catch (error) {
        const message = errorMessage(error);
        report.error = message;
        report.state = "failed";
        gpuTaskFailed = true;
        errors.push(`${task.id}: ${message}`);
        console.error(`Home editor warm-up task ${task.id} failed:`, error);
      } finally {
        if (activeTaskSettlement === taskSettlement) {
          activeTaskSettlement = null;
          activeTaskBlocksEditorDeviceUse = false;
        }
        report.durationMs = browser.performance.now() - report.startedAtMs;
        publishSnapshot();
      }
    }

    markRemainingSkipped();
    // Capture the first frame after the final compile so a last-task main-thread
    // stall is represented in the Home responsiveness diagnostics.
    if (!editorOpening && !stopRequested) await waitForFrame();
    if (!editorOpening) state = gpuTaskFailed ? "failed" : "ready";
    completedAtMs = browser.performance.now();
    publishSnapshot();
    stopFrameSampling();
    removeInputListeners();
  };

  const controller: HomeEditorWarmupController = {
    start(): Promise<void> {
      if (!startPromise) startPromise = run();
      return startPromise;
    },
    prepareGpuSessionForEditor(): Promise<GpuDeviceSession> | null {
      if (!options.enabled) return null;
      const prepared = ensureSessionPromise();
      const active = activeTaskBlocksEditorDeviceUse ? activeTaskSettlement : null;
      // Do not let editor resource creation interleave with an already-open
      // device error scope or compiler transaction. Module loading and project
      // I/O can continue while this small handoff barrier settles.
      return active
        ? Promise.all([prepared, active]).then(([preparedSession]) => preparedSession)
        : prepared;
    },
    handOffToEditor(): void {
      editorOpening = true;
      stopRequested = true;
      idleCancellation?.();
      idleCancellation = null;
      cancelPendingFrameWaits();
      if (options.enabled && state !== "failed" && state !== "ready") {
        state = "handed-off";
      }
      markRemainingSkipped();
      completedAtMs ??= browser.performance.now();
      publishSnapshot();
      stopFrameSampling();
      removeInputListeners();
    },
    dispose(): void {
      stopRequested = true;
      idleCancellation?.();
      idleCancellation = null;
      cancelPendingFrameWaits();
      stopFrameSampling();
      removeInputListeners();
    },
    snapshot,
  };

  installInputListeners();
  publishSnapshot();
  return controller;
}
