import type {
  BrushEngine,
  DeferredLiftReplayTelemetry,
} from "../brush-engine";
import type {
  BrushSettings,
  LayerPoint,
  PointerSample,
} from "../engine-types";
import type {
  ReleaseGpuPhaseTiming,
  StrokePerformanceProfile,
} from "../engine-stats";
import { hasPendingRenderWork, waitForRenderPump } from "../engine-runtime-misc";

const HUMAN_STROKE_API_URL = "/api/human-stroke";
const HUMAN_STROKE_TIMELINE_API_URL = "/api/stroke-timeline";
const BENCHMARK_RUNS_API_URL = "/api/benchmark-runs";
const LOCAL_STORAGE_KEY = "webgpu-brush-engine.human-stroke.v1";
const TIMELINE_LOCAL_STORAGE_KEY = "webgpu-brush-engine.human-stroke-timeline.v1";
const TIMELINE_DENSE_RELEASE_WINDOW_MS = 3_000;
const TIMELINE_IDLE_SAMPLE_INTERVAL_MS = 100;
const TIMELINE_MAXIMUM_SCAN_COUNT = 10_000;
const TIMELINE_RELEASE_COMPLETION_TIMEOUT_MS = 3_000;

export const CANONICAL_HUMAN_STROKE_FINGERPRINT = "18982412";
export const CANONICAL_HUMAN_STROKE_POINT_COUNT = 1_583;
export const HUMAN_RENDERING_SUITE_REVISION = 4 as const;
export const HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 67 as const;
export const HUMAN_STROKE_TIMELINE_TELEMETRY_REVISION = 2 as const;

export interface HumanStrokePoint extends LayerPoint {
  timeMs: number;
}

export interface HumanStrokeFixture {
  version: 1;
  capturedAt: string;
  settings: BrushSettings;
  points: HumanStrokePoint[];
}

interface RenderingMemorySnapshot {
  countedTotalMiB: number;
  countedTotalTransitionPeakMiB: number;
  renderingStorageMiB: number;
  lightGlazeMiB: number;
  blendRendererMiB: number;
  grainTextureMiB: number;
  shapeTextureMiB: number;
  layerFormat: string;
}

interface PlaybackMetrics {
  inputDeliveryMs: number;
  inputDelayP50Ms: number;
  inputDelayP95Ms: number;
  inputDelayMaxMs: number;
  layerInputDispatchTotalMs: number;
  layerInputDispatchP50Ms: number;
  layerInputDispatchP95Ms: number;
  layerInputDispatchMaxMs: number;
  inputDeliveryPath: "preconverted-layer-points";
  pointerPipelineMeasured: false;
  inputToGpuCompletionMs: number;
  endToPresentedMs: number;
  releasePhases: ReleasePhaseMetrics;
}

interface ReleaseEngineSnapshot {
  pendingStamps: number;
  pendingBlendBatches: number;
  activeStroke: boolean;
  activeStrokeHistoryActionId: number | null;
  activeStrokeDeferredPreview: boolean;
  deferredPreviewStampCount: number;
  deferredPreviewPresentedStampCount: number;
  deferredPreviewBlendMode: BrushSettings["blendMode"] | null;
  lastDeferredLiftReplay: DeferredLiftReplayTelemetry | null;
  frameScheduled: boolean;
  displayDirty: boolean;
  clearRequested: boolean;
  lightGlazeEndRequested: boolean;
  lightGlazeCommitRequested: boolean;
  lightGlazeHasContent: boolean;
  lightGlazeNeedsClear: boolean;
  lightGlazeMipValidThroughLevel: number;
  historyActionCount: number;
  historyCursor: number;
  historyBatchCount: number;
  historyStoredBaseStamps: number;
  historyPublicationCount: number;
  historyPublicationTotalMs: number;
  historyRecordCpuCount: number;
  historyRecordCpuTotalMs: number;
  historyGpuCaptureCpuCount: number;
  historyGpuCaptureCpuTotalMs: number;
}

interface ReleaseHistoryDelta {
  actionCount: number;
  cursor: number;
  batchCount: number;
  storedBaseStamps: number;
  publicationCount: number;
  publicationMs: number;
  recordCpuCount: number;
  recordCpuMs: number;
  gpuCaptureCpuCount: number;
  gpuCaptureCpuMs: number;
}

interface ReleaseRenderPumpCycle {
  cycle: number;
  waitAndRenderMs: number;
  before: ReleaseEngineSnapshot;
  after: ReleaseEngineSnapshot;
}

interface ReleasePhaseMetrics {
  endStrokeCpuMs: number;
  renderPumpMs: number;
  preEndStrokeGpuBacklogMs: number;
  postBacklogToGpuIdleMs: number;
  gpuDrainMs: number;
  gpuCommandPhases: ReleaseGpuPhaseTiming | null;
  /** Queue-fence wall time minus timestamped final work; approximate and signed. */
  gpuCommandResidualApproxMs: number | null;
  presentationWaitMs: number;
  releaseToGpuIdleMs: number;
  releaseToPresentedMs: number;
  beforeEndStroke: ReleaseEngineSnapshot;
  afterEndStroke: ReleaseEngineSnapshot;
  afterRenderPump: ReleaseEngineSnapshot;
  afterGpuIdle: ReleaseEngineSnapshot;
  renderPumpCycles: ReleaseRenderPumpCycle[];
  historyDuringEndStroke: ReleaseHistoryDelta;
  historyDuringRenderPump: ReleaseHistoryDelta;
  historyTotal: ReleaseHistoryDelta;
}

type HumanStrokeTimelinePhase = "armed" | "drawing" | "released";

interface HumanStrokeTimelineEvent {
  sequence: number;
  atMs: number;
  name: string;
  attempt: number;
  detail?: Record<string, unknown>;
  engine?: ReleaseEngineSnapshot;
}

interface HumanStrokeTimelineScan {
  sequence: number;
  atMs: number;
  frameGapMs: number;
  phase: HumanStrokeTimelinePhase;
  probeCostMs: number;
  engine: ReleaseEngineSnapshot;
}

interface HumanStrokeTimelineLongTask {
  atMs: number;
  durationMs: number;
  name: string;
}

interface HumanStrokeManualReleaseDiagnostics {
  attempt: number;
  releaseStartedAtMs: number;
  endStrokeReturnedAtMs: number | null;
  endStrokeCpuMs: number | null;
  preEndStrokeGpuBacklogCompletedAtMs: number | null;
  preEndStrokeGpuBacklogMs: number | null;
  renderPumpDrainedAtMs: number | null;
  gpuQueueIdleAtMs: number | null;
  presentedAtMs: number | null;
  beforeEndStroke: ReleaseEngineSnapshot;
  afterEndStroke: ReleaseEngineSnapshot | null;
  deferredPreviewReplayAtLift: DeferredLiftReplayTelemetry | null;
  afterRenderPump: ReleaseEngineSnapshot | null;
  afterGpuIdle: ReleaseEngineSnapshot | null;
  gpuCommandPhases: ReleaseGpuPhaseTiming | null;
  performance: StrokePerformanceProfile | null;
}

interface HumanStrokeTimelineSession {
  startedAt: string;
  startedAtPerformanceMs: number;
  closedAt: string | null;
  closedAtPerformanceMs: number | null;
  phase: HumanStrokeTimelinePhase;
  attempt: number;
  lastAnimationFrameAtMs: number;
  lastStoredScanAtMs: number;
  releaseAtPerformanceMs: number | null;
  settingsAtStart: BrushSettings;
  events: HumanStrokeTimelineEvent[];
  scans: HumanStrokeTimelineScan[];
  longTasks: HumanStrokeTimelineLongTask[];
}

export interface HumanStrokeTimelineReport {
  version: 1;
  telemetryRevision: typeof HUMAN_STROKE_TIMELINE_TELEMETRY_REVISION;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  clock: "performance.now";
  sampling: {
    denseReleaseWindowMs: typeof TIMELINE_DENSE_RELEASE_WINDOW_MS;
    idleIntervalMs: typeof TIMELINE_IDLE_SAMPLE_INTERVAL_MS;
    maximumScanCount: typeof TIMELINE_MAXIMUM_SCAN_COUNT;
  };
  fixture: HumanStrokeFixture & {
    fingerprint: string;
    pointCount: number;
    traceDurationMs: number;
  };
  events: HumanStrokeTimelineEvent[];
  scans: HumanStrokeTimelineScan[];
  longTasks: HumanStrokeTimelineLongTask[];
  release: HumanStrokeManualReleaseDiagnostics | null;
  inputDiagnostics: Readonly<Record<string, unknown>>;
  environment: Record<string, unknown>;
}

export interface HumanStrokeBenchmarkRun {
  version: 1;
  recordedAt: string;
  benchmark: {
    capturedAt: string;
    traceFingerprint: string;
    pointCount: number;
    traceDurationMs: number;
    pathLengthPx: number;
    averageSpeedPxPerSecond: number;
    peakSpeedPxPerSecond: number;
    sampleGapP95Ms: number;
    sampleGapMaxMs: number;
    inputGapsOver33Ms: number;
    testTool: BrushSettings["tool"];
    testBlendMode: BrushSettings["blendMode"] | "not-applicable";
    renderingSuiteRevision: typeof HUMAN_RENDERING_SUITE_REVISION | null;
    renderingSuiteCaseId: string | null;
    renderingSuiteCaseLabel: string | null;
    renderingMemoryBeforeReplay: RenderingMemorySnapshot;
    renderingMemoryAfterReplay: RenderingMemorySnapshot;
    backgroundStrategy: "transparent" | "multicolor-horizontal-stripes-v1";
    settings: BrushSettings;
  };
  playback: PlaybackMetrics;
  performance: StrokePerformanceProfile;
  environment: Record<string, unknown>;
}

export interface HumanStrokeReplayReport {
  version: 1;
  label: string;
  run: HumanStrokeBenchmarkRun;
  runId: number;
  saveError: string | null;
  memoryBefore: RenderingMemorySnapshot;
  memoryAfter: RenderingMemorySnapshot;
}

interface Recording {
  settings: BrushSettings;
  startTimestamp: number;
  points: HumanStrokePoint[];
}

interface ReplayOptions {
  tool?: BrushSettings["tool"];
  backgroundStrategy?: "transparent" | "multicolor-horizontal-stripes-v1";
  suiteCaseId?: string;
  suiteCaseLabel?: string;
  suiteRevision?: typeof HUMAN_RENDERING_SUITE_REVISION;
}

function parseFixture(value: unknown): HumanStrokeFixture | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HumanStrokeFixture>;
  if (
    candidate.version !== 1
    || typeof candidate.capturedAt !== "string"
    || !candidate.settings
    || !Array.isArray(candidate.points)
    || candidate.points.length < 2
  ) {
    return null;
  }
  const points: HumanStrokePoint[] = [];
  for (const point of candidate.points) {
    if (
      !point
      || typeof point !== "object"
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || !Number.isFinite(point.pressure)
      || !Number.isFinite(point.timeMs)
    ) {
      return null;
    }
    points.push({
      x: Number(point.x),
      y: Number(point.y),
      pressure: Number(point.pressure),
      timeMs: Number(point.timeMs),
    });
  }
  return {
    version: 1,
    capturedAt: candidate.capturedAt,
    settings: { ...candidate.settings },
    points,
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function captureReleaseEngineSnapshot(engine: BrushEngine): ReleaseEngineSnapshot {
  const history = engine.getHistoryState();
  return {
    pendingStamps: engine.pendingStamps.length,
    pendingBlendBatches: engine.pendingBlendBatches.length,
    activeStroke: engine.activeStroke !== null,
    activeStrokeHistoryActionId: engine.activeStroke?.historyActionId ?? null,
    activeStrokeDeferredPreview: engine.activeStroke?.deferredPreview ?? false,
    deferredPreviewStampCount: engine.deferredStrokePreview?.stamps.length ?? 0,
    deferredPreviewPresentedStampCount:
      engine.deferredStrokePreview?.presentedStampCount ?? 0,
    deferredPreviewBlendMode:
      engine.deferredStrokePreview?.settings.blendMode ?? null,
    lastDeferredLiftReplay: engine.lastDeferredLiftReplay
      ? { ...engine.lastDeferredLiftReplay }
      : null,
    frameScheduled: engine.frameRequest !== null,
    displayDirty: engine.displayDirty,
    clearRequested: engine.clearRequested,
    lightGlazeEndRequested: engine.lightGlazeSession?.endRequested ?? false,
    lightGlazeCommitRequested: engine.lightGlazeSession?.commitRequested ?? false,
    lightGlazeHasContent: engine.lightGlazeSession?.hasContent ?? false,
    lightGlazeNeedsClear: engine.lightGlazeSession?.needsClear ?? false,
    lightGlazeMipValidThroughLevel:
      engine.lightGlazeSession?.mipValidThroughLevel ?? -1,
    historyActionCount: history.actionCount,
    historyCursor: history.cursor,
    historyBatchCount: engine.historyBatches.length,
    historyStoredBaseStamps: history.storedBaseStamps,
    historyPublicationCount: engine.historyPublicationCount,
    historyPublicationTotalMs: engine.historyPublicationTotalMs,
    historyRecordCpuCount: engine.historyRecordCpuCount,
    historyRecordCpuTotalMs: engine.historyRecordCpuTotalMs,
    historyGpuCaptureCpuCount: engine.historyGpuCaptureCpuCount,
    historyGpuCaptureCpuTotalMs: engine.historyGpuCaptureCpuTotalMs,
  };
}

function releaseHistoryDelta(
  before: ReleaseEngineSnapshot,
  after: ReleaseEngineSnapshot,
): ReleaseHistoryDelta {
  return {
    actionCount: after.historyActionCount - before.historyActionCount,
    cursor: after.historyCursor - before.historyCursor,
    batchCount: after.historyBatchCount - before.historyBatchCount,
    storedBaseStamps: after.historyStoredBaseStamps - before.historyStoredBaseStamps,
    publicationCount: after.historyPublicationCount - before.historyPublicationCount,
    publicationMs: Math.max(
      0,
      after.historyPublicationTotalMs - before.historyPublicationTotalMs,
    ),
    recordCpuCount: after.historyRecordCpuCount - before.historyRecordCpuCount,
    recordCpuMs: Math.max(
      0,
      after.historyRecordCpuTotalMs - before.historyRecordCpuTotalMs,
    ),
    gpuCaptureCpuCount:
      after.historyGpuCaptureCpuCount - before.historyGpuCaptureCpuCount,
    gpuCaptureCpuMs: Math.max(
      0,
      after.historyGpuCaptureCpuTotalMs - before.historyGpuCaptureCpuTotalMs,
    ),
  };
}

export function fingerprintHumanStroke(points: readonly HumanStrokePoint[]): string {
  let hash = 0x811c9dc5;
  for (const point of points) {
    for (const value of [
      Math.round(point.x * 10),
      Math.round(point.y * 10),
      Math.round(point.pressure * 1_000),
      Math.round(point.timeMs * 10),
    ]) {
      hash = Math.imul(hash ^ value, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

function summarizeMotion(points: readonly HumanStrokePoint[]): {
  pathLengthPx: number;
  averageSpeedPxPerSecond: number;
  peakSpeedPxPerSecond: number;
  sampleGapP95Ms: number;
  sampleGapMaxMs: number;
  inputGapsOver33Ms: number;
} {
  let pathLengthPx = 0;
  let peakSpeedPxPerSecond = 0;
  const sampleGaps: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const gapMs = Math.max(0, current.timeMs - previous.timeMs);
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    pathLengthPx += distance;
    sampleGaps.push(gapMs);
    if (gapMs > 0) {
      peakSpeedPxPerSecond = Math.max(peakSpeedPxPerSecond, distance / gapMs * 1_000);
    }
  }
  const traceDurationMs = points.at(-1)?.timeMs ?? 0;
  return {
    pathLengthPx,
    averageSpeedPxPerSecond: traceDurationMs > 0 ? pathLengthPx / traceDurationMs * 1_000 : 0,
    peakSpeedPxPerSecond,
    sampleGapP95Ms: percentile(sampleGaps, 0.95),
    sampleGapMaxMs: sampleGaps.length === 0 ? 0 : Math.max(...sampleGaps),
    inputGapsOver33Ms: sampleGaps.filter((gapMs) => gapMs > 33).length,
  };
}

function canonicalSettings(base: BrushSettings): BrushSettings {
  return {
    ...base,
    tool: "paint",
    shape: "circle",
    shapeAssetId: "legacy-shape",
    shapeInvert: false,
    shapeRotation: "fixed",
    shapeScatter: 0,
    grainMode: "off",
    grainAssetId: "pencil-grain",
    grainScale: 1.4,
    grainMovement: 0,
    grainDepth: 1,
    grainBrightness: 0,
    grainContrast: 0,
    grainInvert: false,
    grainFiltering: "improved",
    grainBlendMode: "multiply",
    size: 750,
    spacingPercent: 1,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 16,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
    blendMode: "light-glaze",
    blendStretch: 0.18,
    blendPaint: 0.14,
    blendBlur: 0,
    jitterMaster: 1,
    hueJitterDegrees: 180,
    saturationJitter: 1,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: true,
    positionJitterLateral: 1,
    positionJitterLinear: 1,
  };
}

function blendCarrierSettings(base: BrushSettings): BrushSettings {
  return {
    ...canonicalSettings(base),
    tool: "blend",
    count: 1,
    blendMode: "normal",
    blendStretch: 0.2,
    blendPaint: 0,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  };
}

export async function loadCanonicalHumanStroke(): Promise<HumanStrokeFixture | null> {
  try {
    const response = await fetch(HUMAN_STROKE_API_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.ok) {
      const fixture = parseFixture(await response.json());
      if (fixture) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fixture));
        return fixture;
      }
    }
  } catch {
    // The local fixture remains a valid fallback when the lab API is absent.
  }
  try {
    return parseFixture(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

export async function saveCanonicalHumanStroke(
  fixture: HumanStrokeFixture,
): Promise<HumanStrokeFixture> {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fixture));
  try {
    const response = await fetch(HUMAN_STROKE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fixture),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Salvataggio fixture HTTP ${response.status}.`);
    }
  } catch (error) {
    if (!import.meta.env.DEV) throw error;
  }
  return fixture;
}

async function saveHumanStrokeTimeline(
  report: HumanStrokeTimelineReport,
): Promise<void> {
  const serialized = JSON.stringify(report);
  try {
    localStorage.setItem(TIMELINE_LOCAL_STORAGE_KEY, serialized);
  } catch {
    // The local JSON endpoint remains authoritative when the report exceeds
    // the browser storage quota.
  }
  try {
    const response = await fetch(HUMAN_STROKE_TIMELINE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Salvataggio timeline HTTP ${response.status}.`);
    }
  } catch (error) {
    if (!import.meta.env.DEV) throw error;
  }
}

async function saveBenchmarkRun(run: HumanStrokeBenchmarkRun): Promise<number> {
  if (import.meta.env.DEV) return 0;
  const response = await fetch(BENCHMARK_RUNS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
  });
  if (!response.ok) {
    throw new Error("Misura valida, ma il registro benchmark non è stato aggiornato.");
  }
  const payload = await response.json() as { id?: unknown };
  return typeof payload.id === "number" ? payload.id : 0;
}

export class HumanStrokeLab {
  readonly #engine: BrushEngine;
  readonly #onReport: (report: unknown) => void;
  readonly #onStatus: (message: string, kind?: "working" | "ok" | "error") => void;
  readonly #applySettings: (settings: BrushSettings) => void;
  readonly #collectInputDiagnostics: () => Readonly<Record<string, unknown>>;
  readonly #onStateChange: () => void;
  #armed = false;
  #recording: Recording | null = null;
  #pendingFixture: HumanStrokeFixture | null = null;
  #busy = false;
  #replayFrame: number | null = null;
  #timelineSession: HumanStrokeTimelineSession | null = null;
  #timelineFrame: number | null = null;
  #timelineLongTaskObserver: PerformanceObserver | null = null;
  #manualRelease: HumanStrokeManualReleaseDiagnostics | null = null;
  #manualReleaseGeneration = 0;
  #manualReleaseCompletion: Promise<void> | null = null;
  #manualPerformanceProfileActive = false;

  constructor(
    engine: BrushEngine,
    onReport: (report: unknown) => void,
    onStatus: (message: string, kind?: "working" | "ok" | "error") => void,
    applySettings: (settings: BrushSettings) => void,
    collectInputDiagnostics: () => Readonly<Record<string, unknown>>,
    onStateChange: () => void,
  ) {
    this.#engine = engine;
    this.#onReport = onReport;
    this.#onStatus = onStatus;
    this.#applySettings = applySettings;
    this.#collectInputDiagnostics = collectInputDiagnostics;
    this.#onStateChange = onStateChange;
  }

  isBusy(): boolean {
    return this.#busy;
  }

  isArmed(): boolean {
    return this.#armed;
  }

  hasCapturedStroke(): boolean {
    return this.#pendingFixture !== null;
  }

  isCapturingStroke(): boolean {
    return this.#recording !== null;
  }

  startRecordingSession(): { recording: true; settings: BrushSettings } {
    if (this.#busy || this.#recording || this.#armed) {
      throw new Error("Il laboratorio tratto umano è già occupato.");
    }
    const settings = this.#engine.getSettings();
    this.#pendingFixture = null;
    this.#startManualTimeline(settings);
    this.#armed = true;
    this.#onStateChange();
    this.#onStatus(
      "Registrazione attiva: disegna il tratto, poi premi Termina registrazione.",
      "working",
    );
    return { recording: true, settings };
  }

  cancel(): void {
    this.#recording = null;
    this.#appendManualTimelineEvent("stroke-canceled", {}, true);
    if (this.#timelineSession) this.#timelineSession.phase = "armed";
    this.#manualReleaseGeneration += 1;
    this.#manualReleaseCompletion = null;
    this.#manualRelease = null;
    if (this.#manualPerformanceProfileActive) {
      this.#engine.finishStrokePerformanceProfile();
      this.#manualPerformanceProfileActive = false;
    }
    this.#onStateChange();
    if (this.#armed) {
      this.#onStatus("Tratto annullato: puoi disegnarlo di nuovo.", "working");
    }
  }

  begin(event: PointerEvent, sample: PointerSample): void {
    if (!this.#armed || this.#busy) return;
    if (this.#manualPerformanceProfileActive) {
      this.#engine.finishStrokePerformanceProfile();
    }
    this.#engine.startStrokePerformanceProfile();
    this.#manualPerformanceProfileActive = true;
    this.#beginManualTimelineAttempt(event);
    const point = this.#engine.toLayerPoint(sample);
    this.#pendingFixture = null;
    this.#recording = {
      settings: this.#engine.getSettings(),
      startTimestamp: event.timeStamp,
      points: [{ ...point, timeMs: 0 }],
    };
    this.#onStateChange();
    this.#onStatus("Registrazione tratto umano in corso…", "working");
  }

  capture(events: readonly PointerEvent[], samples: readonly PointerSample[]): void {
    const recording = this.#recording;
    if (!recording) return;
    for (let index = 0; index < samples.length; index += 1) {
      const event = events[index];
      const point = this.#engine.toLayerPoint(samples[index]);
      recording.points.push({
        ...point,
        timeMs: Math.max(0, event.timeStamp - recording.startTimestamp),
      });
    }
    if (events.length > 0) {
      this.#appendManualTimelineEvent("input-batch", {
        sampleCount: samples.length,
        accumulatedPointCount: recording.points.length,
        firstPointerTimestamp: events[0]?.timeStamp ?? null,
        lastPointerTimestamp: events.at(-1)?.timeStamp ?? null,
      });
    }
  }

  beginRelease(event: PointerEvent): void {
    if (!this.#recording || !this.#armed || this.#busy) return;
    this.#beginManualRelease(event);
  }

  finish(commit: boolean): void {
    const recording = this.#recording;
    this.#recording = null;
    if (!commit || !recording || recording.points.length < 2) {
      this.#finishManualRelease(false, recording?.points.length ?? 0);
      this.#onStateChange();
      this.#onStatus(
        "Tratto annullato o troppo breve: disegnalo di nuovo.",
        "error",
      );
      return;
    }
    this.#finishManualRelease(true, recording.points.length);
    this.#pendingFixture = {
      version: 1,
      capturedAt: new Date().toISOString(),
      settings: recording.settings,
      points: recording.points,
    };
    this.#onStateChange();
    this.#onStatus(
      `Tratto acquisito (${recording.points.length} punti). Premi Termina registrazione per salvarlo.`,
      "working",
    );
  }

  async finishRecordingSession(): Promise<{
    saved: boolean;
    pointCount?: number;
    fingerprint?: string;
    capturedAt?: string;
    timelineSaved?: boolean;
    timelinePath?: string;
    timelineDurationMs?: number;
    timelineScanCount?: number;
    timelineEventCount?: number;
    error?: string;
  }> {
    if (this.#busy) {
      throw new Error("Il laboratorio tratto umano è già occupato.");
    }
    if (!this.#armed) {
      throw new Error("Premi prima Inizia registrazione.");
    }
    if (this.#recording) {
      throw new Error("Rilascia prima il tratto, poi termina la registrazione.");
    }
    const fixture = this.#pendingFixture;
    if (!fixture) {
      throw new Error("Disegna un tratto prima di terminare la registrazione.");
    }

    this.#armed = false;
    this.#pendingFixture = null;
    this.#busy = true;
    this.#onStateChange();
    this.#onStatus("Salvataggio del tratto acquisito…", "working");
    try {
      const timeline = await this.#finalizeManualTimeline(fixture);
      const saved = await saveCanonicalHumanStroke(fixture);
      await saveHumanStrokeTimeline(timeline);
      const report = {
        saved: true,
        pointCount: saved.points.length,
        fingerprint: fingerprintHumanStroke(saved.points),
        capturedAt: saved.capturedAt,
        timelineSaved: true,
        timelinePath: ".tmp-human-stroke-timeline.json",
        timelineDurationMs: timeline.durationMs,
        timelineScanCount: timeline.scans.length,
        timelineEventCount: timeline.events.length,
      };
      this.#onReport(report);
      this.#onStatus("Fixture tratto umano salvata.", "ok");
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const report = { saved: false, error: message };
      this.#onReport(report);
      this.#onStatus(message, "error");
      return report;
    } finally {
      this.#busy = false;
      this.#onStateChange();
    }
  }

  #discardManualTimeline(): void {
    if (this.#timelineFrame !== null) {
      cancelAnimationFrame(this.#timelineFrame);
      this.#timelineFrame = null;
    }
    this.#timelineLongTaskObserver?.disconnect();
    this.#timelineLongTaskObserver = null;
    this.#manualReleaseGeneration += 1;
    this.#manualReleaseCompletion = null;
    this.#manualRelease = null;
    if (this.#manualPerformanceProfileActive) {
      this.#engine.finishStrokePerformanceProfile();
      this.#manualPerformanceProfileActive = false;
    }
    this.#timelineSession = null;
  }

  #startManualTimeline(settings: BrushSettings): void {
    this.#discardManualTimeline();
    const startedAtPerformanceMs = performance.now();
    const session: HumanStrokeTimelineSession = {
      startedAt: new Date().toISOString(),
      startedAtPerformanceMs,
      closedAt: null,
      closedAtPerformanceMs: null,
      phase: "armed",
      attempt: 0,
      lastAnimationFrameAtMs: startedAtPerformanceMs,
      lastStoredScanAtMs: Number.NEGATIVE_INFINITY,
      releaseAtPerformanceMs: null,
      settingsAtStart: { ...settings },
      events: [],
      scans: [],
      longTasks: [],
    };
    this.#timelineSession = session;
    this.#appendManualTimelineEvent("session-start", {
      performanceTimeOrigin: performance.timeOrigin,
    }, true, startedAtPerformanceMs);

    if (
      typeof PerformanceObserver !== "undefined"
      && PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      try {
        this.#timelineLongTaskObserver = new PerformanceObserver((list) => {
          if (this.#timelineSession !== session || session.closedAtPerformanceMs !== null) return;
          for (const entry of list.getEntries()) {
            const atMs = entry.startTime - session.startedAtPerformanceMs;
            if (atMs < 0) continue;
            session.longTasks.push({
              atMs,
              durationMs: entry.duration,
              name: entry.name,
            });
          }
        });
        this.#timelineLongTaskObserver.observe({ type: "longtask", buffered: false });
      } catch {
        this.#timelineLongTaskObserver = null;
      }
    }
    this.#timelineFrame = requestAnimationFrame((timestamp) => {
      this.#scanManualTimeline(timestamp);
    });
  }

  #scanManualTimeline(frameTimestamp: number): void {
    const session = this.#timelineSession;
    if (!session || session.closedAtPerformanceMs !== null) {
      this.#timelineFrame = null;
      return;
    }
    const frameGapMs = Math.max(0, frameTimestamp - session.lastAnimationFrameAtMs);
    session.lastAnimationFrameAtMs = frameTimestamp;
    const releaseAgeMs = session.releaseAtPerformanceMs === null
      ? Number.POSITIVE_INFINITY
      : frameTimestamp - session.releaseAtPerformanceMs;
    // Full engine snapshots stay sparse while drawing so the probe does not
    // manufacture the very lag it is intended to measure. Only the release
    // window is sampled every presented frame.
    const dense = session.phase === "released"
      && releaseAgeMs <= TIMELINE_DENSE_RELEASE_WINDOW_MS;
    const intervalMs = dense ? 0 : TIMELINE_IDLE_SAMPLE_INTERVAL_MS;
    const maximumReached = session.scans.length >= TIMELINE_MAXIMUM_SCAN_COUNT;
    const shouldStore = !maximumReached
      && (
        intervalMs === 0
        || frameTimestamp - session.lastStoredScanAtMs >= intervalMs
        || frameGapMs >= 34
      );
    if (shouldStore) {
      const probeStartedAt = performance.now();
      const engine = captureReleaseEngineSnapshot(this.#engine);
      const probeCostMs = performance.now() - probeStartedAt;
      session.scans.push({
        sequence: session.scans.length + 1,
        atMs: Math.max(0, frameTimestamp - session.startedAtPerformanceMs),
        frameGapMs,
        phase: session.phase,
        probeCostMs,
        engine,
      });
      session.lastStoredScanAtMs = frameTimestamp;
    }
    this.#timelineFrame = requestAnimationFrame((timestamp) => {
      this.#scanManualTimeline(timestamp);
    });
  }

  #appendManualTimelineEvent(
    name: string,
    detail: Record<string, unknown> = {},
    includeEngine = false,
    atPerformanceMs = performance.now(),
  ): void {
    const session = this.#timelineSession;
    if (!session) return;
    if (
      session.closedAtPerformanceMs !== null
      && atPerformanceMs > session.closedAtPerformanceMs
    ) {
      return;
    }
    session.events.push({
      sequence: session.events.length + 1,
      atMs: Math.max(0, atPerformanceMs - session.startedAtPerformanceMs),
      name,
      attempt: session.attempt,
      ...(Object.keys(detail).length > 0 ? { detail } : {}),
      ...(includeEngine ? { engine: captureReleaseEngineSnapshot(this.#engine) } : {}),
    });
  }

  #beginManualTimelineAttempt(event: PointerEvent): void {
    const session = this.#timelineSession;
    if (!session) return;
    session.attempt += 1;
    session.phase = "drawing";
    session.releaseAtPerformanceMs = null;
    this.#manualReleaseGeneration += 1;
    this.#manualReleaseCompletion = null;
    this.#manualRelease = null;
    this.#appendManualTimelineEvent("pointer-down", {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      pointerTimestamp: event.timeStamp,
      pressure: event.pressure,
    }, true);
  }

  #beginManualRelease(event: PointerEvent): void {
    const session = this.#timelineSession;
    if (!session) return;
    const releaseStartedAt = performance.now();
    session.phase = "released";
    session.releaseAtPerformanceMs = releaseStartedAt;
    const generation = ++this.#manualReleaseGeneration;
    const beforeEndStroke = captureReleaseEngineSnapshot(this.#engine);
    const release: HumanStrokeManualReleaseDiagnostics = {
      attempt: session.attempt,
      releaseStartedAtMs: releaseStartedAt - session.startedAtPerformanceMs,
      endStrokeReturnedAtMs: null,
      endStrokeCpuMs: null,
      preEndStrokeGpuBacklogCompletedAtMs: null,
      preEndStrokeGpuBacklogMs: null,
      renderPumpDrainedAtMs: null,
      gpuQueueIdleAtMs: null,
      presentedAtMs: null,
      beforeEndStroke,
      afterEndStroke: null,
      deferredPreviewReplayAtLift: null,
      afterRenderPump: null,
      afterGpuIdle: null,
      gpuCommandPhases: null,
      performance: null,
    };
    this.#manualRelease = release;
    this.#appendManualTimelineEvent("release-start-before-endStroke", {
      pointerTimestamp: event.timeStamp,
      pendingWork: hasPendingRenderWork(this.#engine),
    }, true, releaseStartedAt);
    void this.#engine.device.queue.onSubmittedWorkDone().then(() => {
      if (generation !== this.#manualReleaseGeneration || this.#manualRelease !== release) return;
      const completedAt = performance.now();
      release.preEndStrokeGpuBacklogCompletedAtMs =
        completedAt - session.startedAtPerformanceMs;
      release.preEndStrokeGpuBacklogMs = completedAt - releaseStartedAt;
      this.#appendManualTimelineEvent("pre-release-gpu-backlog-drained", {
        durationMs: release.preEndStrokeGpuBacklogMs,
      }, true, completedAt);
    });
  }

  #finishManualRelease(commit: boolean, pointCount: number): void {
    const session = this.#timelineSession;
    const release = this.#manualRelease;
    const returnedAt = performance.now();
    if (!session || !release) {
      if (!commit && this.#manualPerformanceProfileActive) {
        this.#engine.finishStrokePerformanceProfile();
        this.#manualPerformanceProfileActive = false;
      }
      return;
    }
    release.endStrokeReturnedAtMs = returnedAt - session.startedAtPerformanceMs;
    release.endStrokeCpuMs = release.endStrokeReturnedAtMs - release.releaseStartedAtMs;
    release.afterEndStroke = captureReleaseEngineSnapshot(this.#engine);
    release.deferredPreviewReplayAtLift =
      release.afterEndStroke.lastDeferredLiftReplay;
    this.#appendManualTimelineEvent(
      commit ? "endStroke-returned" : "release-canceled",
      {
        commit,
        pointCount,
        endStrokeCpuMs: release.endStrokeCpuMs,
        pendingWork: hasPendingRenderWork(this.#engine),
        deferredPreviewReplayAtLift: release.deferredPreviewReplayAtLift,
      },
      true,
      returnedAt,
    );
    if (!commit) {
      session.phase = "armed";
      if (this.#manualPerformanceProfileActive) {
        release.performance = this.#engine.finishStrokePerformanceProfile();
        this.#manualPerformanceProfileActive = false;
      }
      return;
    }
    const generation = this.#manualReleaseGeneration;
    this.#manualReleaseCompletion = this.#observeManualReleaseCompletion(
      generation,
      session,
      release,
    );
  }

  async #observeManualReleaseCompletion(
    generation: number,
    session: HumanStrokeTimelineSession,
    release: HumanStrokeManualReleaseDiagnostics,
  ): Promise<void> {
    while (
      generation === this.#manualReleaseGeneration
      && hasPendingRenderWork(this.#engine)
    ) {
      await nextAnimationFrame();
    }
    if (generation !== this.#manualReleaseGeneration || this.#manualRelease !== release) return;
    const renderPumpDrainedAt = performance.now();
    release.renderPumpDrainedAtMs = renderPumpDrainedAt - session.startedAtPerformanceMs;
    release.afterRenderPump = captureReleaseEngineSnapshot(this.#engine);
    this.#appendManualTimelineEvent("render-pump-drained", {
      fromReleaseMs: release.renderPumpDrainedAtMs - release.releaseStartedAtMs,
    }, true, renderPumpDrainedAt);

    await this.#engine.device.queue.onSubmittedWorkDone();
    if (generation !== this.#manualReleaseGeneration || this.#manualRelease !== release) return;
    const gpuIdleAt = performance.now();
    release.gpuQueueIdleAtMs = gpuIdleAt - session.startedAtPerformanceMs;
    release.afterGpuIdle = captureReleaseEngineSnapshot(this.#engine);
    this.#appendManualTimelineEvent("gpu-queue-idle", {
      fromReleaseMs: release.gpuQueueIdleAtMs - release.releaseStartedAtMs,
    }, true, gpuIdleAt);

    await nextAnimationFrame();
    if (generation !== this.#manualReleaseGeneration || this.#manualRelease !== release) return;
    const presentedAt = performance.now();
    release.presentedAtMs = presentedAt - session.startedAtPerformanceMs;
    release.gpuCommandPhases = await this.#engine.waitForReleaseGpuTiming();
    if (generation !== this.#manualReleaseGeneration || this.#manualRelease !== release) return;
    if (this.#manualPerformanceProfileActive) {
      release.performance = this.#engine.finishStrokePerformanceProfile();
      this.#manualPerformanceProfileActive = false;
    }
    this.#appendManualTimelineEvent("release-presented-and-profile-ready", {
      fromReleaseMs: release.presentedAtMs - release.releaseStartedAtMs,
      gpuTimestampPhasesAvailable: release.gpuCommandPhases !== null,
      performanceProfileAvailable: release.performance !== null,
    }, true, presentedAt);
  }

  async #finalizeManualTimeline(
    fixture: HumanStrokeFixture,
  ): Promise<HumanStrokeTimelineReport> {
    const session = this.#timelineSession;
    if (!session) {
      throw new Error("La timeline manuale non è stata inizializzata.");
    }
    const finishClickedAt = performance.now();
    this.#appendManualTimelineEvent("finish-button-click", {
      releaseCompletionPending: this.#manualReleaseCompletion !== null,
    }, true, finishClickedAt);
    session.closedAtPerformanceMs = finishClickedAt;
    session.closedAt = new Date().toISOString();
    if (this.#timelineFrame !== null) {
      cancelAnimationFrame(this.#timelineFrame);
      this.#timelineFrame = null;
    }
    for (const entry of this.#timelineLongTaskObserver?.takeRecords() ?? []) {
      const atMs = entry.startTime - session.startedAtPerformanceMs;
      if (atMs < 0 || entry.startTime > finishClickedAt) continue;
      session.longTasks.push({
        atMs,
        durationMs: entry.duration,
        name: entry.name,
      });
    }
    this.#timelineLongTaskObserver?.disconnect();
    this.#timelineLongTaskObserver = null;

    const completion = this.#manualReleaseCompletion;
    if (completion) {
      await Promise.race([
        completion,
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, TIMELINE_RELEASE_COMPLETION_TIMEOUT_MS);
        }),
      ]);
    }
    if (this.#manualPerformanceProfileActive) {
      const performanceProfile = this.#engine.finishStrokePerformanceProfile();
      if (this.#manualRelease && !this.#manualRelease.performance) {
        this.#manualRelease.performance = performanceProfile;
      }
      this.#manualPerformanceProfileActive = false;
    }

    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    const report: HumanStrokeTimelineReport = {
      version: 1,
      telemetryRevision: HUMAN_STROKE_TIMELINE_TELEMETRY_REVISION,
      startedAt: session.startedAt,
      endedAt: session.closedAt,
      durationMs: finishClickedAt - session.startedAtPerformanceMs,
      clock: "performance.now",
      sampling: {
        denseReleaseWindowMs: TIMELINE_DENSE_RELEASE_WINDOW_MS,
        idleIntervalMs: TIMELINE_IDLE_SAMPLE_INTERVAL_MS,
        maximumScanCount: TIMELINE_MAXIMUM_SCAN_COUNT,
      },
      fixture: {
        ...fixture,
        fingerprint: fingerprintHumanStroke(fixture.points),
        pointCount: fixture.points.length,
        traceDurationMs: fixture.points.at(-1)?.timeMs ?? 0,
      },
      events: session.events,
      scans: session.scans,
      longTasks: session.longTasks,
      release: this.#manualRelease,
      inputDiagnostics: this.#collectInputDiagnostics(),
      environment: {
        ...this.#engine.getBenchmarkEnvironment(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
        devicePixelRatio: window.devicePixelRatio || 1,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        performanceTimeOrigin: performance.timeOrigin,
      },
    };
    this.#manualReleaseGeneration += 1;
    this.#manualReleaseCompletion = null;
    this.#manualRelease = null;
    this.#timelineSession = null;
    return report;
  }

  async replay(
    label: string,
    settingsOverride: Partial<BrushSettings> = {},
  ): Promise<HumanStrokeReplayReport> {
    return this.#withBusy(async () => {
      const fixture = await this.#requireFixture();
      const settings = { ...canonicalSettings(fixture.settings), ...settingsOverride };
      return this.#runReplay(fixture, label, settings, {});
    });
  }

  async replayBlendCarrier(): Promise<HumanStrokeReplayReport> {
    return this.#withBusy(async () => {
      const fixture = await this.#requireFixture();
      return this.#runReplay(
        fixture,
        "Blend carrier · sfondo multicolore",
        blendCarrierSettings(fixture.settings),
        { tool: "blend", backgroundStrategy: "multicolor-horizontal-stripes-v1" },
      );
    });
  }

  async runRenderingSuite(): Promise<{
    version: typeof HUMAN_RENDERING_SUITE_REVISION;
    passed: boolean;
    strategy: "canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4";
    trace: {
      fingerprint: string;
      expectedFingerprint: typeof CANONICAL_HUMAN_STROKE_FINGERPRINT;
      pointCount: number;
      expectedPointCount: typeof CANONICAL_HUMAN_STROKE_POINT_COUNT;
      matchesCanonical: boolean;
    };
    durationMs: number;
    allRunsSaved: boolean;
    memoryByRendering: Array<{
      blendMode: BrushSettings["blendMode"];
      renderingStorageMiB: number;
      countedTotalSteadyMiB: number;
      countedTotalTransitionPeakMiB: number;
      cpuFrameP95WorstMs: number;
      gpuQueueTailWorstMs: number;
      endToPresentedWorstMs: number;
    }>;
    cases: HumanStrokeReplayReport[];
  }> {
    return this.#withBusy(async () => {
      const fixture = await this.#requireFixture();
      const fingerprint = fingerprintHumanStroke(fixture.points);
      const matchesCanonical = fingerprint === CANONICAL_HUMAN_STROKE_FINGERPRINT
        && fixture.points.length === CANONICAL_HUMAN_STROKE_POINT_COUNT;
      if (!matchesCanonical) {
        throw new Error(
          `Traccia non canonica: attesa ${CANONICAL_HUMAN_STROKE_FINGERPRINT}`
            + `/${CANONICAL_HUMAN_STROKE_POINT_COUNT}, ricevuta `
            + `${fingerprint}/${fixture.points.length}.`,
        );
      }
      const cases = [
        ["light-base-grain-off", "Light Glaze · Base · Grain Off · spacing 1%", "light-glaze"],
        ["uniformed-base-grain-off", "Uniformed Glaze · Base · Grain Off · spacing 1%", "uniformed-glaze"],
        ["intense-base-grain-off", "Intense Blending · Base · Grain Off · spacing 1%", "intense-blending"],
      ] as const;
      const startedAt = performance.now();
      const results: HumanStrokeReplayReport[] = [];
      for (const [id, label, blendMode] of cases) {
        this.#onStatus(`Suite tratto umano: ${label}…`, "working");
        const settings: BrushSettings = {
          ...canonicalSettings(fixture.settings),
          blendMode,
        };
        const result = await this.#runReplay(fixture, label, settings, {
          suiteCaseId: id,
          suiteCaseLabel: label,
          suiteRevision: HUMAN_RENDERING_SUITE_REVISION,
        });
        const expectedCopies = result.run.performance.baseStamps * settings.count;
        if (result.run.performance.physicalCopies !== expectedCopies) {
          throw new Error(
            `${id}: copie fisiche ${result.run.performance.physicalCopies}, attese ${expectedCopies}.`,
          );
        }
        if (blendMode === "intense-blending" && result.memoryAfter.blendRendererMiB > 1) {
          throw new Error(
            `Intense ha allocato ${result.memoryAfter.blendRendererMiB.toFixed(3)} MiB dello scratch Blend dry.`,
          );
        }
        results.push(result);
      }
      const memoryByRendering = results.map((result) => ({
        blendMode: result.run.benchmark.settings.blendMode,
        renderingStorageMiB: result.memoryAfter.renderingStorageMiB,
        countedTotalSteadyMiB: result.memoryAfter.countedTotalMiB,
        countedTotalTransitionPeakMiB: result.memoryAfter.countedTotalTransitionPeakMiB,
        cpuFrameP95WorstMs: result.run.performance.renderFrameTotalP95Ms,
        gpuQueueTailWorstMs: result.run.playback.inputToGpuCompletionMs,
        endToPresentedWorstMs: result.run.playback.endToPresentedMs,
      }));
      return {
        version: HUMAN_RENDERING_SUITE_REVISION,
        passed: results.length === cases.length,
        strategy: "canonical-human-stroke-base-spacing-1-three-renderings-one-tap-v4",
        trace: {
          fingerprint,
          expectedFingerprint: CANONICAL_HUMAN_STROKE_FINGERPRINT,
          pointCount: fixture.points.length,
          expectedPointCount: CANONICAL_HUMAN_STROKE_POINT_COUNT,
          matchesCanonical,
        },
        durationMs: performance.now() - startedAt,
        allRunsSaved: results.every((result) => result.saveError === null),
        memoryByRendering,
        cases: results,
      };
    });
  }

  async #withBusy<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#busy || this.#armed || this.#recording) {
      throw new Error("Il laboratorio tratto umano è già occupato.");
    }
    this.#busy = true;
    this.#onStateChange();
    try {
      return await operation();
    } finally {
      if (this.#replayFrame !== null) cancelAnimationFrame(this.#replayFrame);
      this.#replayFrame = null;
      this.#busy = false;
      this.#onStateChange();
    }
  }

  async #requireFixture(): Promise<HumanStrokeFixture> {
    const fixture = await loadCanonicalHumanStroke();
    if (!fixture) {
      throw new Error("Nessuna fixture canonica: registrala prima dal laboratorio.");
    }
    return fixture;
  }

  #captureMemory(blendMode: BrushSettings["blendMode"]): RenderingMemorySnapshot {
    const stats = this.#engine.getStats();
    const renderingStorageMiB = blendMode === "light-glaze"
      || blendMode === "uniformed-glaze"
      || blendMode === "intense-blending"
      ? stats.gpuMemory.lightGlazeMiB
      : 0;
    return {
      countedTotalMiB: stats.gpuMemory.countedTotalMiB,
      countedTotalTransitionPeakMiB: Math.max(
        stats.gpuMemory.countedTotalMiB,
        stats.gpuMemory.lightGlazeTransitionPeakMiB,
      ),
      renderingStorageMiB,
      lightGlazeMiB: stats.gpuMemory.lightGlazeMiB,
      blendRendererMiB: stats.gpuMemory.blendRendererMiB,
      grainTextureMiB: stats.gpuMemory.grainTextureMiB,
      shapeTextureMiB: stats.gpuMemory.shapeTextureMiB,
      layerFormat: stats.layerFormat,
    };
  }

  async #prepareBlendBackground(replaySettings: BrushSettings): Promise<void> {
    const palette = ["#ff334f", "#ff9f1c", "#f4e04d", "#20c997", "#2d7ff9", "#8b5cf6"];
    const backgroundSettings: BrushSettings = {
      ...canonicalSettings(replaySettings),
      tool: "paint",
      size: 1_500,
      spacingPercent: 15,
      count: 1,
      blendMode: "normal",
      hueJitterDegrees: 0,
      saturationJitter: 0,
      jitterPerCopy: false,
      positionJitterLateral: 0,
      positionJitterLinear: 0,
    };
    try {
      for (let index = 0; index < palette.length; index += 1) {
        const y = this.#engine.documentHeight * index / (palette.length - 1);
        const timeMs = index * 10;
        this.#engine.setBrushSettings({ ...backgroundSettings, color: palette[index] });
        this.#engine.beginStrokeAtLayer({ x: 0, y, pressure: 1, timeMs });
        this.#engine.extendStrokeAtLayer([
          { x: this.#engine.documentWidth, y, pressure: 1, timeMs: timeMs + 1 },
        ]);
        this.#engine.endStroke(timeMs + 1);
        await this.#engine.waitForIdle();
      }
    } finally {
      this.#applySettings(replaySettings);
      await this.#engine.waitForIdle();
    }
  }

  async #runReplay(
    fixture: HumanStrokeFixture,
    label: string,
    settings: BrushSettings,
    options: ReplayOptions,
  ): Promise<HumanStrokeReplayReport> {
    if (this.#engine.getPixelSelectionState().selectedPixels > 0) {
      throw new Error("Deseleziona i pixel prima di riprodurre il tratto canonico.");
    }
    await this.#engine.waitForIdle();
    this.#engine.resetLightGlazeTransitionPeak();
    this.#applySettings(settings);
    await this.#engine.ensureCurrentBrushResources();
    await this.#engine.waitForIdle();
    this.#engine.resetStrokeRandomSeed();
    if (!this.#engine.resetDocument()) {
      throw new Error("Il replay richiede un documento nuovo con un solo livello raster.");
    }
    await this.#engine.waitForIdle();
    const backgroundStrategy = options.backgroundStrategy ?? "transparent";
    if (backgroundStrategy === "multicolor-horizontal-stripes-v1") {
      await this.#prepareBlendBackground(settings);
      this.#engine.resetStrokeRandomSeed();
    }

    const memoryBefore = this.#captureMemory(settings.blendMode);
    const before = this.#engine.getStats();
    const replayStart = performance.now();
    const lastPoint = fixture.points.at(-1) as HumanStrokePoint;
    const inputDelays: number[] = [];
    const dispatchDurations: number[] = [];
    let nextPointIndex = 1;
    let releaseStartedAt = 0;
    let endStrokeReturnedAt = 0;
    let preEndStrokeGpuBacklogCompletedAt: Promise<number> | null = null;
    let releaseBeforeEndStroke: ReleaseEngineSnapshot | null = null;
    let releaseAfterEndStroke: ReleaseEngineSnapshot | null = null;

    this.#engine.startStrokePerformanceProfile();
    const initialDispatchStart = performance.now();
    this.#engine.beginStrokeAtLayer(fixture.points[0]);
    dispatchDurations.push(performance.now() - initialDispatchStart);
    await new Promise<void>((resolve) => {
      const step = (timestamp: number) => {
        const elapsed = timestamp - replayStart;
        const duePoints: HumanStrokePoint[] = [];
        while (
          nextPointIndex < fixture.points.length
          && fixture.points[nextPointIndex].timeMs <= elapsed
        ) {
          inputDelays.push(Math.max(0, elapsed - fixture.points[nextPointIndex].timeMs));
          duePoints.push(fixture.points[nextPointIndex]);
          nextPointIndex += 1;
        }
        if (duePoints.length > 0) {
          const dispatchStart = performance.now();
          this.#engine.extendStrokeAtLayer(duePoints);
          dispatchDurations.push(performance.now() - dispatchStart);
        }
        if (nextPointIndex < fixture.points.length) {
          this.#replayFrame = requestAnimationFrame(step);
          return;
        }
        releaseBeforeEndStroke = captureReleaseEngineSnapshot(this.#engine);
        releaseStartedAt = performance.now();
        preEndStrokeGpuBacklogCompletedAt = this.#engine.device.queue
          .onSubmittedWorkDone()
          .then(() => performance.now());
        this.#engine.endStroke(lastPoint.timeMs);
        endStrokeReturnedAt = performance.now();
        releaseAfterEndStroke = captureReleaseEngineSnapshot(this.#engine);
        this.#replayFrame = null;
        resolve();
      };
      this.#replayFrame = requestAnimationFrame(step);
    });

    if (
      !releaseBeforeEndStroke
      || !releaseAfterEndStroke
      || !preEndStrokeGpuBacklogCompletedAt
      || endStrokeReturnedAt <= 0
    ) {
      throw new Error("La telemetria del rilascio non è stata inizializzata.");
    }
    const inputFinishedAt = endStrokeReturnedAt;
    const releaseRenderPumpCycles: ReleaseRenderPumpCycle[] = [];
    const renderPumpStartedAt = performance.now();
    while (hasPendingRenderWork(this.#engine)) {
      if (releaseRenderPumpCycles.length >= 256) {
        throw new Error("Il rilascio non ha drenato il render pump entro 256 cicli.");
      }
      const cycleStartedAt = performance.now();
      const cycleBefore = captureReleaseEngineSnapshot(this.#engine);
      await waitForRenderPump(this.#engine);
      releaseRenderPumpCycles.push({
        cycle: releaseRenderPumpCycles.length + 1,
        waitAndRenderMs: performance.now() - cycleStartedAt,
        before: cycleBefore,
        after: captureReleaseEngineSnapshot(this.#engine),
      });
    }
    const renderPumpCompletedAt = performance.now();
    const releaseAfterRenderPump = captureReleaseEngineSnapshot(this.#engine);
    await this.#engine.waitForIdle();
    const gpuCompletedAt = performance.now();
    const preEndStrokeGpuCompletedAt = await preEndStrokeGpuBacklogCompletedAt;
    const releaseAfterGpuIdle = captureReleaseEngineSnapshot(this.#engine);
    await nextAnimationFrame();
    const presentedAt = performance.now();
    const releaseGpuCommandPhases = await this.#engine.waitForReleaseGpuTiming();
    const profile = this.#engine.finishStrokePerformanceProfile();
    if (!profile) throw new Error("Profilo del tratto non disponibile.");
    const after = this.#engine.getStats();
    const memoryAfter = this.#captureMemory(settings.blendMode);
    const playback: PlaybackMetrics = {
      inputDeliveryMs: inputFinishedAt - replayStart,
      inputDelayP50Ms: percentile(inputDelays, 0.5),
      inputDelayP95Ms: percentile(inputDelays, 0.95),
      inputDelayMaxMs: inputDelays.length === 0 ? 0 : Math.max(...inputDelays),
      layerInputDispatchTotalMs: dispatchDurations.reduce((sum, duration) => sum + duration, 0),
      layerInputDispatchP50Ms: percentile(dispatchDurations, 0.5),
      layerInputDispatchP95Ms: percentile(dispatchDurations, 0.95),
      layerInputDispatchMaxMs: dispatchDurations.length === 0 ? 0 : Math.max(...dispatchDurations),
      inputDeliveryPath: "preconverted-layer-points",
      pointerPipelineMeasured: false,
      inputToGpuCompletionMs: Math.max(0, gpuCompletedAt - inputFinishedAt),
      endToPresentedMs: Math.max(0, presentedAt - replayStart),
      releasePhases: {
        endStrokeCpuMs: Math.max(0, endStrokeReturnedAt - releaseStartedAt),
        renderPumpMs: Math.max(0, renderPumpCompletedAt - renderPumpStartedAt),
        preEndStrokeGpuBacklogMs: Math.max(
          0,
          preEndStrokeGpuCompletedAt - releaseStartedAt,
        ),
        postBacklogToGpuIdleMs: Math.max(
          0,
          gpuCompletedAt - preEndStrokeGpuCompletedAt,
        ),
        gpuDrainMs: Math.max(0, gpuCompletedAt - renderPumpCompletedAt),
        gpuCommandPhases: releaseGpuCommandPhases,
        gpuCommandResidualApproxMs: releaseGpuCommandPhases
          ? gpuCompletedAt
            - preEndStrokeGpuCompletedAt
            - releaseGpuCommandPhases.totalReleaseSubmissionMs
          : null,
        presentationWaitMs: Math.max(0, presentedAt - gpuCompletedAt),
        releaseToGpuIdleMs: Math.max(0, gpuCompletedAt - releaseStartedAt),
        releaseToPresentedMs: Math.max(0, presentedAt - releaseStartedAt),
        beforeEndStroke: releaseBeforeEndStroke,
        afterEndStroke: releaseAfterEndStroke,
        afterRenderPump: releaseAfterRenderPump,
        afterGpuIdle: releaseAfterGpuIdle,
        renderPumpCycles: releaseRenderPumpCycles,
        historyDuringEndStroke: releaseHistoryDelta(
          releaseBeforeEndStroke,
          releaseAfterEndStroke,
        ),
        historyDuringRenderPump: releaseHistoryDelta(
          releaseAfterEndStroke,
          releaseAfterRenderPump,
        ),
        historyTotal: releaseHistoryDelta(
          releaseBeforeEndStroke,
          releaseAfterGpuIdle,
        ),
      },
    };
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    const run: HumanStrokeBenchmarkRun = {
      version: 1,
      recordedAt: new Date().toISOString(),
      benchmark: {
        capturedAt: fixture.capturedAt,
        traceFingerprint: fingerprintHumanStroke(fixture.points),
        pointCount: fixture.points.length,
        traceDurationMs: lastPoint.timeMs,
        ...summarizeMotion(fixture.points),
        testTool: options.tool ?? settings.tool,
        testBlendMode: settings.tool === "blend" ? "not-applicable" : settings.blendMode,
        renderingSuiteRevision: options.suiteRevision ?? null,
        renderingSuiteCaseId: options.suiteCaseId ?? null,
        renderingSuiteCaseLabel: options.suiteCaseLabel ?? null,
        renderingMemoryBeforeReplay: memoryBefore,
        renderingMemoryAfterReplay: memoryAfter,
        backgroundStrategy,
        settings,
      },
      playback,
      performance: profile,
      environment: {
        ...this.#engine.getBenchmarkEnvironment(),
        ...this.#collectInputDiagnostics(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        maxTouchPoints: navigator.maxTouchPoints,
        devicePixelRatio: window.devicePixelRatio || 1,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
        countedGpuMemoryMiBBefore: before.gpuMemory.countedTotalMiB,
        countedGpuMemoryMiBAfter: after.gpuMemory.countedTotalMiB,
        performanceTelemetryRevision: HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION,
      },
    };
    let runId = 0;
    let saveError: string | null = null;
    try {
      runId = await saveBenchmarkRun(run);
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
    return { version: 1, label, run, runId, saveError, memoryBefore, memoryAfter };
  }
}
