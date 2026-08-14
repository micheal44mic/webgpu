export const STARTUP_TIMING_SCHEMA = "webgpu-brush-startup-timing-v1" as const;

export type StartupPhaseStatus = "queued" | "running" | "ok" | "error";

export interface StartupTimingError {
  readonly name: string;
  readonly message: string;
}

export interface StartupPhaseSnapshot {
  readonly name: string;
  readonly status: StartupPhaseStatus;
  readonly queuedAtMs: number | null;
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly queueDelayMs: number | null;
  readonly durationMs: number | null;
  readonly error: StartupTimingError | null;
}

export interface StartupNavigationSnapshot {
  readonly type: string;
  readonly redirectCount: number;
  readonly responseStartMs: number | null;
  readonly responseEndMs: number | null;
  readonly domInteractiveMs: number | null;
  readonly domContentLoadedMs: number | null;
  readonly loadEventEndMs: number | null;
  readonly transferSizeBytes: number;
  readonly encodedBodySizeBytes: number;
  readonly decodedBodySizeBytes: number;
}

export interface StartupTelemetrySnapshot {
  readonly schema: typeof STARTUP_TIMING_SCHEMA;
  readonly unit: "milliseconds-from-navigation-start";
  readonly measurementNotes: readonly string[];
  readonly navigationStartedAt: string;
  readonly capturedAtMs: number;
  readonly navigation: StartupNavigationSnapshot | null;
  readonly summary: {
    readonly startupEntryMs: number | null;
    readonly mainCompositionStartedMs: number | null;
    readonly mainModuleLoadedMs: number | null;
    readonly adapterReadyMs: number | null;
    readonly deviceReadyMs: number | null;
    readonly coreRendererReadyMs: number | null;
    readonly initialDocumentReadyMs: number | null;
    readonly engineReadyMs: number | null;
    readonly firstCanvasFrameSubmittedMs: number | null;
    readonly firstCanvasPaintOpportunityMs: number | null;
    readonly projectInteractiveMs: number | null;
    readonly vectorToolsReadyMs: number | null;
    readonly selectionReadyMs: number | null;
    readonly blendReadyMs: number | null;
    readonly allBackgroundSettledMs: number | null;
    readonly allBackgroundSucceeded: boolean | null;
    readonly pendingBackgroundTasks: readonly string[];
  };
  readonly milestones: Readonly<Record<string, number>>;
  readonly expectedBackgroundTasks: readonly string[];
  readonly phases: readonly StartupPhaseSnapshot[];
  readonly pipelineCompilations: readonly {
    readonly phase: string;
    readonly label: string;
    readonly status: "ok" | "error";
    readonly completedAtMs: number;
    readonly durationMs: number;
    readonly error: StartupTimingError | null;
  }[];
  readonly errors: readonly {
    readonly phase: string;
    readonly atMs: number | null;
    readonly error: StartupTimingError;
  }[];
}

interface StartupPerformanceLike {
  readonly timeOrigin: number;
  now(): number;
  getEntriesByType?(type: string): readonly PerformanceEntry[];
}

interface MutableStartupPhase {
  readonly name: string;
  queuedAtMs: number | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  status: StartupPhaseStatus;
  error: StartupTimingError | null;
}

function roundedMilliseconds(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function completedNavigationTimestamp(value: number): number | null {
  return value > 0 ? roundedMilliseconds(value) : null;
}

function startupError(error: unknown): StartupTimingError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "Errore senza messaggio.",
    };
  }
  return {
    name: typeof error,
    message: String(error),
  };
}

/**
 * Bounded, content-free timing recorder for real-device startup comparisons.
 * It stores only a small fixed set of timestamps; report serialization happens
 * on demand when the user copies app diagnostics.
 */
export class StartupTelemetry {
  private readonly clock: StartupPerformanceLike;
  private readonly phases = new Map<string, MutableStartupPhase>();
  private readonly milestones = new Map<string, number>();
  private readonly pipelineCompilations: Array<{
    phase: string;
    label: string;
    status: "ok" | "error";
    completedAtMs: number;
    durationMs: number;
    error: StartupTimingError | null;
  }> = [];
  private expectedBackgroundTasks: readonly string[] = [];

  constructor(clock: StartupPerformanceLike) {
    this.clock = clock;
  }

  mark(name: string): void {
    if (!this.milestones.has(name)) this.milestones.set(name, this.clock.now());
  }

  queue(name: string): void {
    const phase = this.ensurePhase(name);
    if (phase.queuedAtMs === null) phase.queuedAtMs = this.clock.now();
  }

  begin(name: string): void {
    const phase = this.ensurePhase(name);
    if (phase.status === "ok" || phase.status === "error") return;
    const now = this.clock.now();
    phase.queuedAtMs ??= now;
    phase.startedAtMs ??= now;
    phase.status = "running";
  }

  complete(name: string): void {
    const phase = this.ensurePhase(name);
    if (phase.status === "ok" || phase.status === "error") return;
    const now = this.clock.now();
    phase.queuedAtMs ??= now;
    phase.startedAtMs ??= now;
    phase.completedAtMs = now;
    phase.status = "ok";
  }

  fail(name: string, error: unknown): void {
    const phase = this.ensurePhase(name);
    if (phase.status === "ok" || phase.status === "error") return;
    const now = this.clock.now();
    phase.queuedAtMs ??= now;
    phase.startedAtMs ??= now;
    phase.completedAtMs = now;
    phase.status = "error";
    phase.error = startupError(error);
  }

  async track<Value>(name: string, task: () => Promise<Value>): Promise<Value> {
    this.begin(name);
    try {
      const value = await task();
      this.complete(name);
      return value;
    } catch (error) {
      this.fail(name, error);
      throw error;
    }
  }

  expectBackgroundTasks(names: readonly string[]): void {
    this.expectedBackgroundTasks = [...new Set(names)];
  }

  recordPipelineCompilation(event: {
    readonly phase: string;
    readonly label: string;
    readonly state: "start" | "complete" | "error";
    readonly durationMs: number | null;
    readonly error?: unknown;
  }): void {
    if (event.state === "start" || event.durationMs === null) return;
    if (this.pipelineCompilations.length === 160) this.pipelineCompilations.shift();
    this.pipelineCompilations.push({
      phase: event.phase,
      label: event.label,
      status: event.state === "complete" ? "ok" : "error",
      completedAtMs: this.clock.now(),
      durationMs: event.durationMs,
      error: event.state === "error" ? startupError(event.error) : null,
    });
  }

  snapshot(): StartupTelemetrySnapshot {
    const phases = [...this.phases.values()]
      .map((phase): StartupPhaseSnapshot => ({
        name: phase.name,
        status: phase.status,
        queuedAtMs: roundedMilliseconds(phase.queuedAtMs),
        startedAtMs: roundedMilliseconds(phase.startedAtMs),
        completedAtMs: roundedMilliseconds(phase.completedAtMs),
        queueDelayMs: phase.queuedAtMs !== null && phase.startedAtMs !== null
          ? roundedMilliseconds(phase.startedAtMs - phase.queuedAtMs)
          : null,
        durationMs: phase.startedAtMs !== null && phase.completedAtMs !== null
          ? roundedMilliseconds(phase.completedAtMs - phase.startedAtMs)
          : null,
        error: phase.error,
      }))
      .sort((left, right) =>
        (left.queuedAtMs ?? left.startedAtMs ?? Number.POSITIVE_INFINITY)
        - (right.queuedAtMs ?? right.startedAtMs ?? Number.POSITIVE_INFINITY)
      );
    const phaseByName = new Map(phases.map((phase) => [phase.name, phase]));
    const pendingBackgroundTasks = this.expectedBackgroundTasks.filter((name) => {
      const status = phaseByName.get(name)?.status;
      return status !== "ok" && status !== "error";
    });
    const backgroundPhases = this.expectedBackgroundTasks
      .map((name) => phaseByName.get(name))
      .filter((phase): phase is StartupPhaseSnapshot => phase !== undefined);
    const backgroundSettled = this.expectedBackgroundTasks.length > 0
      && pendingBackgroundTasks.length === 0
      && backgroundPhases.length === this.expectedBackgroundTasks.length;
    const allBackgroundSettledMs = backgroundSettled
      ? Math.max(...backgroundPhases.map((phase) => phase.completedAtMs ?? 0))
      : null;
    const allBackgroundSucceeded = backgroundSettled
      ? backgroundPhases.every((phase) => phase.status === "ok")
      : null;
    const milestones = Object.fromEntries(
      [...this.milestones.entries()].map(([name, value]) => [
        name,
        roundedMilliseconds(value) ?? 0,
      ]),
    );
    const completedAt = (name: string): number | null => {
      const phase = phaseByName.get(name);
      return phase?.status === "ok" ? phase.completedAtMs : null;
    };
    const milestoneAt = (name: string): number | null => milestones[name] ?? null;

    return {
      schema: STARTUP_TIMING_SCHEMA,
      unit: "milliseconds-from-navigation-start",
      measurementNotes: [
        "All summary values are monotonic milliseconds from navigation start, not wall-clock durations measured by reload automation.",
        "firstCanvasPaintOpportunityMs is the second animation frame after engine readiness; browsers do not expose exact screen presentation time.",
        "Queued phase delay and execution duration are reported separately.",
      ],
      navigationStartedAt: new Date(this.clock.timeOrigin).toISOString(),
      capturedAtMs: roundedMilliseconds(this.clock.now()) ?? 0,
      navigation: this.captureNavigation(),
      summary: {
        startupEntryMs: milestoneAt("startup-entry"),
        mainCompositionStartedMs: milestoneAt("main-composition-start"),
        mainModuleLoadedMs: completedAt("main-module-load"),
        adapterReadyMs: completedAt("webgpu-adapter"),
        deviceReadyMs: completedAt("webgpu-device"),
        coreRendererReadyMs: completedAt("core-renderer-resources"),
        initialDocumentReadyMs: completedAt("initial-document-resources"),
        engineReadyMs: milestoneAt("engine-ready"),
        firstCanvasFrameSubmittedMs: milestoneAt("first-canvas-frame-submitted"),
        firstCanvasPaintOpportunityMs: milestoneAt("first-canvas-paint-opportunity"),
        projectInteractiveMs: milestoneAt("project-interactive"),
        vectorToolsReadyMs: milestoneAt("vector-tools-ready"),
        selectionReadyMs: completedAt("deferred-selection-pipelines"),
        blendReadyMs: completedAt("deferred-blend-renderer"),
        allBackgroundSettledMs: roundedMilliseconds(allBackgroundSettledMs),
        allBackgroundSucceeded,
        pendingBackgroundTasks,
      },
      milestones,
      expectedBackgroundTasks: this.expectedBackgroundTasks,
      phases,
      pipelineCompilations: this.pipelineCompilations.map((pipeline) => ({
        ...pipeline,
        completedAtMs: roundedMilliseconds(pipeline.completedAtMs) ?? 0,
        durationMs: roundedMilliseconds(pipeline.durationMs) ?? 0,
      })),
      errors: phases.flatMap((phase) => phase.error
        ? [{ phase: phase.name, atMs: phase.completedAtMs, error: phase.error }]
        : []),
    };
  }

  private ensurePhase(name: string): MutableStartupPhase {
    const current = this.phases.get(name);
    if (current) return current;
    const phase: MutableStartupPhase = {
      name,
      queuedAtMs: null,
      startedAtMs: null,
      completedAtMs: null,
      status: "queued",
      error: null,
    };
    this.phases.set(name, phase);
    return phase;
  }

  private captureNavigation(): StartupNavigationSnapshot | null {
    const entry = this.clock.getEntriesByType?.("navigation")[0];
    if (!entry) return null;
    const navigation = entry as PerformanceNavigationTiming;
    return {
      type: String(navigation.type ?? "unknown"),
      redirectCount: Number(navigation.redirectCount ?? 0),
      responseStartMs: completedNavigationTimestamp(navigation.responseStart),
      responseEndMs: completedNavigationTimestamp(navigation.responseEnd),
      domInteractiveMs: completedNavigationTimestamp(navigation.domInteractive),
      domContentLoadedMs: completedNavigationTimestamp(navigation.domContentLoadedEventEnd),
      loadEventEndMs: completedNavigationTimestamp(navigation.loadEventEnd),
      transferSizeBytes: Number(navigation.transferSize ?? 0),
      encodedBodySizeBytes: Number(navigation.encodedBodySize ?? 0),
      decodedBodySizeBytes: Number(navigation.decodedBodySize ?? 0),
    };
  }
}

export const startupTelemetry = new StartupTelemetry(performance);
