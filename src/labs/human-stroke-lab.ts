import type { BrushEngine } from "../brush-engine";
import type {
  BrushSettings,
  LayerPoint,
  PointerSample,
} from "../engine-types";
import type { StrokePerformanceProfile } from "../engine-stats";

const HUMAN_STROKE_API_URL = "/api/human-stroke";
const BENCHMARK_RUNS_API_URL = "/api/benchmark-runs";
const LOCAL_STORAGE_KEY = "webgpu-brush-engine.human-stroke.v1";

export const CANONICAL_HUMAN_STROKE_FINGERPRINT = "18982412";
export const CANONICAL_HUMAN_STROKE_POINT_COUNT = 1_583;
export const HUMAN_RENDERING_SUITE_REVISION = 4 as const;
export const HUMAN_STROKE_PERFORMANCE_TELEMETRY_REVISION = 64 as const;

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
  #busy = false;
  #replayFrame: number | null = null;

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

  arm(): { armed: true; settings: BrushSettings } {
    if (this.#busy || this.#recording) {
      throw new Error("Il laboratorio tratto umano è già occupato.");
    }
    const settings = canonicalSettings(this.#engine.getSettings());
    this.#applySettings(settings);
    this.#armed = true;
    this.#onStateChange();
    this.#onStatus("Preset canonico applicato: disegna una sola pennellata.", "working");
    return { armed: true, settings };
  }

  cancel(): void {
    this.#armed = false;
    this.#recording = null;
    this.#onStateChange();
  }

  begin(event: PointerEvent, sample: PointerSample): void {
    if (!this.#armed || this.#busy) return;
    const point = this.#engine.toLayerPoint(sample);
    this.#recording = {
      settings: this.#engine.getSettings(),
      startTimestamp: event.timeStamp,
      points: [{ ...point, timeMs: 0 }],
    };
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
  }

  finish(commit: boolean): void {
    const recording = this.#recording;
    this.#recording = null;
    this.#armed = false;
    if (!commit || !recording || recording.points.length < 2) {
      this.#onStateChange();
      this.#onStatus("Registrazione tratto annullata o troppo breve.", "error");
      return;
    }
    this.#busy = true;
    this.#onStateChange();
    const fixture: HumanStrokeFixture = {
      version: 1,
      capturedAt: new Date().toISOString(),
      settings: recording.settings,
      points: recording.points,
    };
    void (async () => {
      let report: unknown;
      let status: { message: string; kind: "ok" | "error" };
      try {
        const saved = await saveCanonicalHumanStroke(fixture);
        report = {
          saved: true,
          pointCount: saved.points.length,
          fingerprint: fingerprintHumanStroke(saved.points),
          capturedAt: saved.capturedAt,
        };
        status = { message: "Fixture tratto umano salvata.", kind: "ok" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report = { saved: false, error: message };
        status = { message, kind: "error" };
      } finally {
        this.#busy = false;
        this.#onStateChange();
      }
      this.#onReport(report);
      this.#onStatus(status.message, status.kind);
    })();
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
        this.#engine.endStroke(lastPoint.timeMs);
        this.#replayFrame = null;
        resolve();
      };
      this.#replayFrame = requestAnimationFrame(step);
    });

    const inputFinishedAt = performance.now();
    await this.#engine.waitForIdle();
    const gpuCompletedAt = performance.now();
    await nextAnimationFrame();
    const presentedAt = performance.now();
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
