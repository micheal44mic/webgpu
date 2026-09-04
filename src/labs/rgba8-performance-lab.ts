import "./rgba8-performance-lab.css";
import {
  FRAMES_PER_MEASURED_RUN,
  MEASURED_RUNS,
  RGBA8_LAB_SCHEMA_VERSION,
  RGBA8_LAB_VERSION,
  STAMP_STRIDE_BYTES,
  TARGET_SIZE,
  WARMUP_RUNS,
  beginPreparedGeometrySession,
  buildGpuCases,
  comparePixels,
  createStampBytes,
  hashBytes,
  loadGeometryWasm,
  missedDeadlines,
  packGeometryDabs,
  prepareGeometry,
  sha256,
  summarize,
  type GeometryBackend,
  type GpuCase,
  type PreparedGeometry,
  type RendererKind,
  type RunMode,
  type SuiteKind,
  type TimingSummary,
} from "./rgba8-performance-core";
import {
  createBenchmarkRenderer,
  type BenchmarkRenderer,
  type FrameSubmission,
} from "./rgba8-performance-renderers";

type CapabilityState = "checking" | "ready" | "missing";

interface FrameSample {
  index: number;
  readonly runIndex: number;
  readonly elapsedMs: number;
  readonly frameIntervalMs: number;
  readonly uploadCpuMs: number;
  readonly encodeCpuMs: number;
  readonly submitCpuMs: number;
  geometryCpuMs: number;
  readonly inputToSubmitMs: number;
  inputToGpuCompleteMs: number | null;
  gpuMs: number | null;
  readonly backlogAtSubmit: number;
  backpressureStallMs: number;
  readonly instanceCount: number;
  readonly uploadBytes: number;
  readonly drawCount: number;
  readonly passCount: number;
  readonly submitCount: number;
  readonly copyCount: number;
  readonly timerSlot: number | null;
  readonly submittedAt: number;
  completionAt: number | null;
}

interface MeasurementRunSummary {
  readonly index: number;
  readonly sampleCount: number;
  readonly durationMs: number;
  readonly instances: number;
  readonly uploadBytes: number;
  readonly cpuFrameMs: TimingSummary;
  readonly geometryCpuMs: TimingSummary;
  readonly uploadCpuMs: TimingSummary;
  readonly encodeCpuMs: TimingSummary;
  readonly submitCpuMs: TimingSummary;
  readonly gpuMs: TimingSummary | null;
  readonly inputToSubmitMs: TimingSummary;
  readonly inputToGpuCompleteMs: TimingSummary;
  readonly inputToGpuDeadlineMisses: Record<string, number>;
  readonly maximumBacklogFrames: number;
  readonly backpressureLimitFrames: number;
  readonly backpressureStallCount: number;
  readonly backpressureStallMs: number;
  readonly queueDrainMs: number | null;
}

interface PixelEquivalence {
  status: "passed" | "failed" | "unavailable";
  exact: boolean | null;
  maximumChannelError: number | null;
  differentPixelRatio: number | null;
  readonly tolerance: {
    readonly maximumChannelError: 2;
    readonly maximumDifferentPixelRatio: 0.001;
  } | null;
}

interface GpuCaseResult {
  readonly caseId: string;
  readonly label: string;
  readonly category: GpuCase["category"];
  readonly renderer: RendererKind;
  readonly geometryBackend: GeometryBackend | null;
  readonly mode: RunMode;
  readonly timerSource: BenchmarkRenderer["timerSource"];
  readonly availableTimerSource: BenchmarkRenderer["timerSource"];
  readonly gpuTimerStatus: "sampled" | "unsupported" | "disabled-for-copy" | "disjoint" | "unavailable";
  readonly format: "rgba8";
  readonly workload: {
    readonly target: readonly [number, number];
    readonly nominalInstancesPerFrame: number | null;
    readonly instancesPerFrame: TimingSummary;
    readonly fragmentPixelAttemptsPerFrame: number;
    readonly timedUploadBytesPerFrame: number;
    readonly preloadedBytes: number;
    readonly passesPerFrame: number;
    readonly submitsPerFrame: number;
    readonly drawsPerFrame: number;
    readonly copiesPerFrame: number;
    readonly sampling: GpuCase["sampling"];
    readonly layout: GpuCase["layout"];
    readonly totals: {
      readonly instances: number;
      readonly fragmentPixelAttempts: number;
      readonly timedUploadBytes: number;
      readonly draws: number;
      readonly passes: number;
      readonly submits: number;
      readonly copies: number;
      readonly copiedPixels: number;
    };
  };
  readonly measuredFrames: number;
  readonly measuredRuns: number;
  readonly measuredWindows: number | null;
  readonly measurementKind: "independent-runs" | "continuous-windows";
  readonly framesPerRun: number | null;
  readonly activeDurationMs: number;
  readonly durationMs: number;
  readonly cpuFrameMs: TimingSummary;
  readonly uploadCpuMs: TimingSummary;
  readonly encodeCpuMs: TimingSummary;
  readonly submitCpuMs: TimingSummary;
  readonly frameIntervalMs: TimingSummary;
  readonly inputToSubmitMs: TimingSummary;
  readonly inputToGpuCompleteMs: TimingSummary;
  readonly gpuMs: TimingSummary | null;
  readonly inputToGpuDeadlineMisses: Record<string, number>;
  readonly maximumBacklogFrames: number;
  readonly backpressureLimitFrames: number;
  readonly backpressureStallCount: number;
  readonly backpressureStallMs: number;
  readonly finalQueueDrainMs: number;
  readonly queueDrainMs: TimingSummary;
  readonly framesPerSecond: number;
  readonly stampsPerSecond: number;
  readonly thermalDriftPercent: number | null;
  readonly geometryGenerationMs: TimingSummary | null;
  readonly gpuTimerSampleCount: number;
  readonly gpuTimerCoverageRatio: number;
  readonly pixelHash: string;
  equivalence: PixelEquivalence;
  readonly runs: readonly MeasurementRunSummary[];
  readonly windows: readonly MeasurementRunSummary[];
  readonly frameSamples: readonly FrameSample[];
}

interface CaseExecution {
  readonly result: GpuCaseResult;
  readonly pixels: Uint8Array;
}

interface CapabilityReport {
  webgpu: boolean;
  webgl2: boolean;
  wasm: boolean;
  refreshHz: number | null;
  webgpuInfo: Record<string, unknown> | null;
  webglInfo: Record<string, unknown> | null;
  wasmBytes: number | null;
  wasmCompileMs: number | null;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

const SUSTAINED_COOLDOWN_MS = 5_000;
const BACKPRESSURE_LIMIT_FRAMES = 32;

const rootCandidate = document.getElementById("rgba8PerformanceLab");
if (!rootCandidate) throw new Error("RGBA8 performance lab root is unavailable.");
const root: HTMLElement = rootCandidate;

root.innerHTML = `
  <div class="lab-shell">
    <header class="lab-header">
      <p class="lab-kicker">Mobile renderer benchmark</p>
      <h1>RGBA8 Brush Performance Lab</h1>
      <p class="lab-intro">
        Confronta geometria JavaScript/Wasm e rendering WebGPU/WebGL2 con gli stessi
        stamp, gli stessi byte e lo stesso target. Tutte le texture del test sono RGBA8.
      </p>
      <div class="capability-row" aria-label="Capacità del dispositivo">
        <span class="capability" data-capability="webgpu" data-state="checking">WebGPU…</span>
        <span class="capability" data-capability="webgl2" data-state="checking">WebGL2…</span>
        <span class="capability" data-capability="wasm" data-state="checking">Wasm…</span>
        <span class="capability" data-capability="format" data-state="ready">RGBA8 only</span>
      </div>
    </header>
    <div class="lab-grid">
      <section class="panel control-panel" aria-labelledby="controlsTitle">
        <p class="lab-label" id="controlsTitle">Test</p>
        <div class="control-grid">
          <label>Scenario
            <select data-suite>
              <option value="quick">Suite rapida · circa 1–2 min</option>
              <option value="full">Suite completa · circa 2–4 min</option>
              <option value="sustained">Sostenuto · 30 s per strategia</option>
            </select>
          </label>
          <label>Modalità
            <select data-mode>
              <option value="paced">Paced · sincronizzato al display</option>
              <option value="saturation">Saturation · carico continuo</option>
            </select>
          </label>
        </div>
        <label class="save-choice">
          <input type="checkbox" data-save />
          <span>Invia risultati e dati tecnici (browser, GPU e schermo) al database privato del lab</span>
        </label>
        <div class="actions">
          <button class="primary" type="button" data-run disabled>Avvia test</button>
          <button type="button" data-stop disabled>Interrompi</button>
        </div>
        <progress data-progress value="0" max="1" hidden></progress>
        <p class="status" data-status aria-live="polite">Controllo capacità in corso…</p>
      </section>
      <section class="canvas-frame" aria-label="Output RGBA8 del test">
        <canvas data-output width="${TARGET_SIZE}" height="${TARGET_SIZE}"></canvas>
        <p class="canvas-note">Target ${TARGET_SIZE}² · RGBA8 · source-over premoltiplicato</p>
      </section>
    </div>
    <section class="panel result-panel" aria-labelledby="resultsTitle">
      <div class="result-heading">
        <p class="lab-label" id="resultsTitle">Risultati</p>
        <div class="result-actions">
          <button type="button" data-copy disabled>Copia JSON</button>
          <button type="button" data-download disabled>Scarica JSON</button>
        </div>
      </div>
      <div class="result-grid">
        <div class="metric"><span>Stato</span><strong data-metric="state">Pronto</strong></div>
        <div class="metric"><span>Ultima cella · CPU p95</span><strong data-metric="frame">—</strong></div>
        <div class="metric"><span>Ultima cella · input→GPU p95</span><strong data-metric="latency">—</strong></div>
        <div class="metric"><span>Ultima cella · input→GPU &gt;16,67 ms</span><strong data-metric="miss">—</strong></div>
      </div>
      <div class="table-wrap" data-table-wrap hidden>
        <table>
          <thead><tr><th>Test</th><th>Strategia</th><th>CPU p95</th><th>input→GPU p95</th><th>Parità</th></tr></thead>
          <tbody data-results></tbody>
        </table>
      </div>
      <p class="method-note">
        Due warm-up e sette run per cella; i test generici usano più frame per run e il
        sostenuto divide 30 s continui in sette finestre. Clear, hash e readback restano fuori
        misura. La copia output è RGBA8 offscreen: “GPU complete” non equivale alla
        presentazione fisica sul display. Il browser non misura direttamente watt o temperatura:
        la deriva tra inizio e fine è soltanto un indicatore termico indiretto. Ordine casuale e
        cooldown riducono, ma non eliminano, il possibile carry-over termico. Parità: massimo 2
        livelli RGBA8 su non oltre lo 0,1% dei pixel; l'errore effettivo resta nel JSON.
      </p>
    </section>
  </div>
`;

function required<T extends Element>(selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento del laboratorio mancante: ${selector}`);
  return element;
}

const suiteSelect = required<HTMLSelectElement>("[data-suite]");
const modeSelect = required<HTMLSelectElement>("[data-mode]");
const saveInput = required<HTMLInputElement>("[data-save]");
const runButton = required<HTMLButtonElement>("[data-run]");
const stopButton = required<HTMLButtonElement>("[data-stop]");
const copyButton = required<HTMLButtonElement>("[data-copy]");
const downloadButton = required<HTMLButtonElement>("[data-download]");
const progressElement = required<HTMLProgressElement>("[data-progress]");
const statusElement = required<HTMLElement>("[data-status]");
const outputCanvas = required<HTMLCanvasElement>("[data-output]");
const resultsBody = required<HTMLTableSectionElement>("[data-results]");
const tableWrap = required<HTMLElement>("[data-table-wrap]");
const stateMetric = required<HTMLElement>("[data-metric='state']");
const frameMetric = required<HTMLElement>("[data-metric='frame']");
const latencyMetric = required<HTMLElement>("[data-metric='latency']");
const missMetric = required<HTMLElement>("[data-metric='miss']");

let capabilities: CapabilityReport = {
  webgpu: false,
  webgl2: false,
  wasm: false,
  refreshHz: null,
  webgpuInfo: null,
  webglInfo: null,
  wasmBytes: null,
  wasmCompileMs: null,
};
let activeAbortController: AbortController | null = null;
let lastReport: Record<string, unknown> | null = null;
let lastCompactReport: Record<string, unknown> | null = null;

function setCapability(name: string, state: CapabilityState, label: string): void {
  const badge = root.querySelector<HTMLElement>(`[data-capability="${name}"]`);
  if (!badge) return;
  badge.dataset.state = state;
  badge.textContent = label;
}

function formatMs(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)} ms`;
}

function nextAnimationFrame(signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Test interrotto.", "AbortError"));
      return;
    }
    let requestId = 0;
    const abort = (): void => {
      cancelAnimationFrame(requestId);
      reject(new DOMException("Test interrotto.", "AbortError"));
    };
    requestId = requestAnimationFrame((timestamp) => {
      signal?.removeEventListener("abort", abort);
      resolve(timestamp);
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function estimateRefreshRate(): Promise<number | null> {
  const samples: number[] = [];
  let previous = await nextAnimationFrame();
  for (let index = 0; index < 20; index += 1) {
    const current = await nextAnimationFrame();
    samples.push(current - previous);
    previous = current;
  }
  const median = summarize(samples).p50;
  return median > 0 ? Math.round(1000 / median) : null;
}

async function detectCapabilities(): Promise<void> {
  const webglCanvas = document.createElement("canvas");
  const gl = webglCanvas.getContext("webgl2");
  capabilities.webgl2 = Boolean(gl);
  if (gl) {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    capabilities.webglInfo = {
      version: gl.getParameter(gl.VERSION),
      shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      timerQuery: Boolean(gl.getExtension("EXT_disjoint_timer_query_webgl2")),
    };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  setCapability(
    "webgl2",
    capabilities.webgl2 ? "ready" : "missing",
    capabilities.webgl2 ? "WebGL2 ready" : "WebGL2 assente",
  );

  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      capabilities.webgpu = Boolean(adapter);
      if (adapter) {
        capabilities.webgpuInfo = {
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          vendor: adapter.info.vendor,
          description: adapter.info.description,
          features: [...adapter.features].sort(),
        };
      }
    } catch {
      capabilities.webgpu = false;
    }
  }
  setCapability(
    "webgpu",
    capabilities.webgpu ? "ready" : "missing",
    capabilities.webgpu ? "WebGPU ready" : "WebGPU assente",
  );

  try {
    const loaded = await loadGeometryWasm();
    capabilities.wasm = true;
    capabilities.wasmBytes = loaded.byteLength;
    capabilities.wasmCompileMs = loaded.compileMs;
    setCapability("wasm", "ready", "Wasm ABI ready");
  } catch {
    capabilities.wasm = false;
    setCapability("wasm", "missing", "Wasm non disponibile");
  }
  capabilities.refreshHz = await estimateRefreshRate();
  runButton.disabled = !(capabilities.wasm && (capabilities.webgpu || capabilities.webgl2));
  statusElement.textContent = runButton.disabled
    ? "Servono Wasm e almeno uno tra WebGPU e WebGL2."
    : `Pronto · refresh stimato ${capabilities.refreshHz ?? "—"} Hz. Mantieni la scheda visibile.`;
}

function assertRunnable(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Test interrotto.", "AbortError");
  if (document.visibilityState !== "visible") {
    throw new Error("La scheda è passata in background: misura annullata.");
  }
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const shuffled = [...values];
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

interface OutstandingCompletion {
  done: boolean;
  promise: Promise<void>;
}

function trackSubmission(
  submission: FrameSubmission,
  inputAt: number,
  sample: FrameSample | null,
  outstanding: OutstandingCompletion[],
): void {
  const state: OutstandingCompletion = { done: false, promise: Promise.resolve() };
  state.promise = submission.completion.then((completedAt) => {
    if (sample) {
      sample.completionAt = completedAt;
      sample.inputToGpuCompleteMs = Math.max(0, completedAt - inputAt);
    }
  }).finally(() => {
    state.done = true;
  });
  outstanding.push(state);
}

function pruneCompletions(outstanding: OutstandingCompletion[]): void {
  for (let index = outstanding.length - 1; index >= 0; index -= 1) {
    if (outstanding[index].done) outstanding.splice(index, 1);
  }
}

async function applyBackpressure(outstanding: OutstandingCompletion[]): Promise<{
  readonly peak: number;
  readonly stallMs: number;
}> {
  pruneCompletions(outstanding);
  const peak = outstanding.length;
  let stallMs = 0;
  if (outstanding.length >= BACKPRESSURE_LIMIT_FRAMES) {
    const stallStartedAt = performance.now();
    await Promise.race(outstanding.map((entry) => entry.promise));
    stallMs = performance.now() - stallStartedAt;
    pruneCompletions(outstanding);
  }
  return { peak, stallMs };
}

function cpuFrameValue(sample: FrameSample): number {
  return sample.geometryCpuMs
    + sample.uploadCpuMs
    + sample.encodeCpuMs
    + sample.submitCpuMs;
}

function buildRunSummaries(
  samples: readonly FrameSample[],
  queueDrainRuns: readonly (number | null)[],
): MeasurementRunSummary[] {
  const groups = new Map<number, FrameSample[]>();
  for (const sample of samples) {
    const group = groups.get(sample.runIndex) ?? [];
    group.push(sample);
    groups.set(sample.runIndex, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, runSamples]) => {
      const inputToGpu = runSamples
        .map((sample) => sample.inputToGpuCompleteMs)
        .filter((value): value is number => value !== null);
      const gpuValues = runSamples
        .map((sample) => sample.gpuMs)
        .filter((value): value is number => value !== null);
      const firstInputAt = Math.min(
        ...runSamples.map((sample) => sample.submittedAt - sample.inputToSubmitMs),
      );
      const lastCompleteAt = Math.max(
        ...runSamples.map((sample) => sample.completionAt ?? sample.submittedAt),
      );
      return {
        index,
        sampleCount: runSamples.length,
        durationMs: Math.max(0, lastCompleteAt - firstInputAt),
        instances: runSamples.reduce((total, sample) => total + sample.instanceCount, 0),
        uploadBytes: runSamples.reduce((total, sample) => total + sample.uploadBytes, 0),
        cpuFrameMs: summarize(runSamples.map(cpuFrameValue)),
        geometryCpuMs: summarize(runSamples.map((sample) => sample.geometryCpuMs)),
        uploadCpuMs: summarize(runSamples.map((sample) => sample.uploadCpuMs)),
        encodeCpuMs: summarize(runSamples.map((sample) => sample.encodeCpuMs)),
        submitCpuMs: summarize(runSamples.map((sample) => sample.submitCpuMs)),
        gpuMs: gpuValues.length > 0 ? summarize(gpuValues) : null,
        inputToSubmitMs: summarize(runSamples.map((sample) => sample.inputToSubmitMs)),
        inputToGpuCompleteMs: summarize(inputToGpu),
        inputToGpuDeadlineMisses: missedDeadlines(inputToGpu),
        maximumBacklogFrames: Math.max(0, ...runSamples.map((sample) => sample.backlogAtSubmit)),
        backpressureLimitFrames: BACKPRESSURE_LIMIT_FRAMES,
        backpressureStallCount: runSamples.filter(
          (sample) => sample.backpressureStallMs > 0,
        ).length,
        backpressureStallMs: runSamples.reduce(
          (total, sample) => total + sample.backpressureStallMs,
          0,
        ),
        queueDrainMs: queueDrainRuns[index] ?? null,
      };
    });
}

function buildResult(
  renderer: BenchmarkRenderer,
  spec: GpuCase,
  mode: RunMode,
  geometryBackend: GeometryBackend | null,
  samples: FrameSample[],
  activeDurationMs: number,
  queueDrainRuns: readonly (number | null)[],
  maximumBacklogFrames: number,
  pixelHash: string,
  measurementKind: GpuCaseResult["measurementKind"],
  framesPerRun: number | null,
): GpuCaseResult {
  const cpuFrameValues = samples.map(cpuFrameValue);
  const inputToGpuValues = samples
    .map((sample) => sample.inputToGpuCompleteMs)
    .filter((value): value is number => value !== null);
  const gpuValues = samples
    .map((sample) => sample.gpuMs)
    .filter((value): value is number => value !== null);
  const firstWindow = samples
    .filter((sample) => sample.elapsedMs <= 5000)
    .map((sample) => sample.inputToGpuCompleteMs)
    .filter((value): value is number => value !== null);
  const finalWindowStart = Math.max(0, activeDurationMs - 5000);
  const finalWindow = samples
    .filter((sample) => sample.elapsedMs >= finalWindowStart)
    .map((sample) => sample.inputToGpuCompleteMs)
    .filter((value): value is number => value !== null);
  const firstP95 = summarize(firstWindow).p95;
  const finalP95 = summarize(finalWindow).p95;
  const thermalDriftPercent = spec.sustainedMs && firstP95 > 0
    ? (finalP95 - firstP95) / firstP95 * 100
    : null;
  const runs = buildRunSummaries(samples, queueDrainRuns);
  const totalInstances = samples.reduce((total, sample) => total + sample.instanceCount, 0);
  const fragmentPixelAttempts = spec.uploadOnly || spec.layout === "clipped"
    ? 0
    : totalInstances * (spec.radiusPx * 2) ** 2;
  const timedUploadBytes = samples.reduce((total, sample) => total + sample.uploadBytes, 0);
  const totalDraws = samples.reduce((total, sample) => total + sample.drawCount, 0);
  const totalPasses = samples.reduce((total, sample) => total + sample.passCount, 0);
  const totalSubmits = samples.reduce((total, sample) => total + sample.submitCount, 0);
  const totalCopies = samples.reduce((total, sample) => total + sample.copyCount, 0);
  const measuredQueueDrains = queueDrainRuns.filter((value): value is number => value !== null);
  const finalQueueDrainMs = measuredQueueDrains.at(-1) ?? 0;
  const durationMs = activeDurationMs + measuredQueueDrains.reduce((total, value) => total + value, 0);
  const geometryValues = samples.map((sample) => sample.geometryCpuMs).filter((value) => value > 0);
  return {
    caseId: spec.id,
    label: spec.label,
    category: spec.category,
    renderer: renderer.kind,
    geometryBackend,
    mode,
    timerSource: gpuValues.length > 0 ? renderer.timerSource : "completion-proxy",
    availableTimerSource: renderer.timerSource,
    gpuTimerStatus: gpuValues.length > 0
      ? "sampled"
      : spec.copies > 0
        ? "disabled-for-copy"
        : renderer.timerReadStatus === "disjoint"
          ? "disjoint"
          : renderer.timerSource === "completion-proxy" ? "unsupported" : "unavailable",
    format: "rgba8",
    workload: {
      target: [TARGET_SIZE, TARGET_SIZE],
      nominalInstancesPerFrame: spec.layout === "human" ? null : spec.instanceCount,
      instancesPerFrame: summarize(samples.map((sample) => sample.instanceCount)),
      fragmentPixelAttemptsPerFrame: samples.length > 0 ? fragmentPixelAttempts / samples.length : 0,
      timedUploadBytesPerFrame: samples.length > 0 ? timedUploadBytes / samples.length : 0,
      preloadedBytes: spec.uploadEachFrame ? 0 : spec.instanceCount * STAMP_STRIDE_BYTES,
      passesPerFrame: spec.passes,
      submitsPerFrame: spec.submits,
      drawsPerFrame: spec.uploadOnly ? 0 : spec.passes,
      copiesPerFrame: spec.copies,
      sampling: spec.sampling,
      layout: spec.layout,
      totals: {
        instances: totalInstances,
        fragmentPixelAttempts,
        timedUploadBytes,
        draws: totalDraws,
        passes: totalPasses,
        submits: totalSubmits,
        copies: totalCopies,
        copiedPixels: totalCopies * TARGET_SIZE * TARGET_SIZE,
      },
    },
    measuredFrames: samples.length,
    measuredRuns: measurementKind === "independent-runs" ? runs.length : 1,
    measuredWindows: measurementKind === "continuous-windows" ? runs.length : null,
    measurementKind,
    framesPerRun,
    activeDurationMs,
    durationMs,
    cpuFrameMs: summarize(cpuFrameValues),
    uploadCpuMs: summarize(samples.map((sample) => sample.uploadCpuMs)),
    encodeCpuMs: summarize(samples.map((sample) => sample.encodeCpuMs)),
    submitCpuMs: summarize(samples.map((sample) => sample.submitCpuMs)),
    frameIntervalMs: summarize(samples.map((sample) => sample.frameIntervalMs)),
    inputToSubmitMs: summarize(samples.map((sample) => sample.inputToSubmitMs)),
    inputToGpuCompleteMs: summarize(inputToGpuValues),
    gpuMs: gpuValues.length > 0 ? summarize(gpuValues) : null,
    inputToGpuDeadlineMisses: missedDeadlines(inputToGpuValues),
    maximumBacklogFrames,
    backpressureLimitFrames: BACKPRESSURE_LIMIT_FRAMES,
    backpressureStallCount: samples.filter((sample) => sample.backpressureStallMs > 0).length,
    backpressureStallMs: samples.reduce(
      (total, sample) => total + sample.backpressureStallMs,
      0,
    ),
    finalQueueDrainMs,
    queueDrainMs: summarize(measuredQueueDrains),
    framesPerSecond: durationMs > 0 ? samples.length / durationMs * 1000 : 0,
    stampsPerSecond: durationMs > 0 ? totalInstances / durationMs * 1000 : 0,
    thermalDriftPercent,
    geometryGenerationMs: geometryValues.length > 0
      ? summarize(geometryValues)
      : null,
    gpuTimerSampleCount: gpuValues.length,
    gpuTimerCoverageRatio: samples.length > 0 ? gpuValues.length / samples.length : 0,
    pixelHash,
    equivalence: {
      status: "unavailable",
      exact: null,
      maximumChannelError: null,
      differentPixelRatio: null,
      tolerance: spec.uploadOnly
        ? null
        : {
            maximumChannelError: 2,
            maximumDifferentPixelRatio: 0.001,
          },
    },
    runs: measurementKind === "independent-runs" ? runs : [],
    windows: measurementKind === "continuous-windows" ? runs : [],
    frameSamples: samples,
  };
}

async function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function pace(mode: RunMode, _frameIndex: number, signal: AbortSignal): Promise<number> {
  if (mode === "paced") return nextAnimationFrame(signal);
  return performance.now();
}

async function runGenericCase(
  renderer: BenchmarkRenderer,
  spec: GpuCase,
  bytes: Uint8Array,
  mode: RunMode,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<CaseExecution> {
  renderer.prepare(spec, bytes);
  const timedSpec: GpuCase = { ...spec, clearBeforeDraw: false };
  const framesPerRun = mode === "saturation" ? 64 : FRAMES_PER_MEASURED_RUN;
  const executeRun = async (
    runIndex: number,
    collect: boolean,
    benchmarkStartedAt: number,
  ): Promise<{
    readonly samples: FrameSample[];
    readonly activeDurationMs: number;
    readonly queueDrainMs: number;
    readonly maximumBacklogFrames: number;
  }> => {
    await renderer.resetTarget();
    const runSamples: FrameSample[] = [];
    const outstanding: OutstandingCompletion[] = [];
    let maximumBacklogFrames = 0;
    let previousInputAt: number | null = null;
    let firstInputAt: number | null = null;
    let lastSubmittedAt = performance.now();
    for (let frameIndex = 0; frameIndex < framesPerRun; frameIndex += 1) {
      assertRunnable(signal);
      const inputAt = await pace(mode, frameIndex, signal);
      firstInputAt ??= inputAt;
      const submission = renderer.render(timedSpec, bytes);
      pruneCompletions(outstanding);
      const sample: FrameSample | null = collect
        ? {
            index: 0,
            runIndex,
            elapsedMs: inputAt - benchmarkStartedAt,
            frameIntervalMs: previousInputAt === null ? 0 : inputAt - previousInputAt,
            uploadCpuMs: submission.uploadCpuMs,
            encodeCpuMs: submission.encodeCpuMs,
            submitCpuMs: submission.submitCpuMs,
            geometryCpuMs: 0,
            inputToSubmitMs: submission.submittedAt - inputAt,
            inputToGpuCompleteMs: null,
            gpuMs: null,
            backlogAtSubmit: outstanding.length + 1,
            backpressureStallMs: 0,
            instanceCount: spec.instanceCount,
            uploadBytes: spec.uploadEachFrame ? bytes.byteLength : 0,
            drawCount: spec.uploadOnly ? 0 : spec.passes,
            passCount: spec.passes,
            submitCount: spec.submits,
            copyCount: spec.copies,
            timerSlot: submission.timerSlot,
            submittedAt: submission.submittedAt,
            completionAt: null,
          }
        : null;
      if (sample) {
        sample.index = runSamples.length;
        runSamples.push(sample);
      }
      trackSubmission(submission, inputAt, sample, outstanding);
      const backpressure = await applyBackpressure(outstanding);
      if (sample) sample.backpressureStallMs = backpressure.stallMs;
      maximumBacklogFrames = Math.max(maximumBacklogFrames, backpressure.peak);
      previousInputAt = inputAt;
      lastSubmittedAt = submission.submittedAt;
    }
    const activeDurationMs = firstInputAt === null ? 0 : Math.max(0, lastSubmittedAt - firstInputAt);
    await Promise.all(outstanding.map((entry) => entry.promise));
    return {
      samples: runSamples,
      activeDurationMs,
      queueDrainMs: Math.max(0, performance.now() - lastSubmittedAt),
      maximumBacklogFrames,
    };
  };

  for (let warmup = 0; warmup < WARMUP_RUNS; warmup += 1) {
    assertRunnable(signal);
    await executeRun(warmup, false, performance.now());
  }
  renderer.beginTiming(MEASURED_RUNS * framesPerRun);
  const samples: FrameSample[] = [];
  let maximumBacklogFrames = 0;
  let activeDurationMs = 0;
  const queueDrainRuns: number[] = [];
  const startedAt = performance.now();
  for (let runIndex = 0; runIndex < MEASURED_RUNS; runIndex += 1) {
    onProgress(`${spec.label} · ${renderer.kind} · run ${runIndex + 1}/${MEASURED_RUNS}`);
    const run = await executeRun(runIndex, true, startedAt);
    for (const sample of run.samples) {
      sample.index = samples.length;
      samples.push(sample);
    }
    activeDurationMs += run.activeDurationMs;
    queueDrainRuns.push(run.queueDrainMs);
    maximumBacklogFrames = Math.max(maximumBacklogFrames, run.maximumBacklogFrames);
  }
  const gpuTimes = await renderer.finishTiming();
  for (const sample of samples) {
    if (sample.timerSlot !== null) sample.gpuMs = gpuTimes[sample.timerSlot] ?? null;
  }
  const pixels = spec.uploadOnly ? new Uint8Array(0) : await renderer.readPixels();
  const uploadWitness = spec.uploadOnly ? await renderer.readUploadBytes(bytes.byteLength) : null;
  const pixelHash = uploadWitness ? await sha256(uploadWitness) : await sha256(pixels);
  return {
    result: buildResult(
      renderer,
      spec,
      mode,
      null,
      samples,
      activeDurationMs,
      queueDrainRuns,
      maximumBacklogFrames,
      pixelHash,
      "independent-runs",
      framesPerRun,
    ),
    pixels,
  };
}

function concatenateDabs(chunks: readonly Float64Array[]): Float64Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float64Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

interface IncrementalReplayResult {
  readonly samples: FrameSample[];
  readonly activeDurationMs: number;
  readonly queueDrainMs: number;
  readonly maximumBacklogFrames: number;
  readonly stampCount: number;
  readonly stampHash: string;
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function runIncrementalReplay(
  renderer: BenchmarkRenderer,
  baseSpec: GpuCase,
  prepared: PreparedGeometry,
  geometryBackend: GeometryBackend,
  mode: RunMode,
  signal: AbortSignal,
  runIndex: number,
  collect: boolean,
  benchmarkStartedAt: number,
): Promise<IncrementalReplayResult> {
  await renderer.resetTarget();
  const replayStartedAt = performance.now();
  const sessionStartedAt = performance.now();
  const session = beginPreparedGeometrySession(prepared, geometryBackend);
  let geometryCarryMs = performance.now() - sessionStartedAt;
  const samples: FrameSample[] = [];
  const outstanding: OutstandingCompletion[] = [];
  let pointIndex = 1;
  let stampOrdinal = 0;
  let pendingInitial = true;
  let finished = false;
  let previousInputAt: number | null = null;
  let firstInputAt: number | null = null;
  let lastSubmittedAt = replayStartedAt;
  let maximumBacklogFrames = 0;
  let lastYieldAt = replayStartedAt;
  const packedChunks: Uint8Array[] = [];
  try {
    while (!finished) {
      assertRunnable(signal);
      let logicalInputAt: number;
      let endPoint = pointIndex;
      if (mode === "paced") {
        await nextAnimationFrame(signal);
        const now = performance.now();
        const dueMs = now - replayStartedAt;
        while (
          endPoint < prepared.points.length
          && prepared.points[endPoint].timeMs <= dueMs
        ) endPoint += 1;
        if (!pendingInitial && endPoint === pointIndex) continue;
        const oldestPointIndex = pendingInitial ? 0 : pointIndex;
        logicalInputAt = replayStartedAt + prepared.points[oldestPointIndex].timeMs;
      } else {
        logicalInputAt = performance.now();
        endPoint = Math.min(prepared.points.length, pointIndex + 16);
      }

      firstInputAt ??= logicalInputAt;
      const generationStartedAt = performance.now();
      const dabChunks: Float64Array[] = [];
      if (pendingInitial) {
        dabChunks.push(session.initialDab);
        pendingInitial = false;
      }
      while (pointIndex < endPoint) {
        const batchEnd = Math.min(endPoint, pointIndex + 16);
        const update = session.processBatch(prepared.points.slice(pointIndex, batchEnd), {
          includePreviewTail: false,
          includeTail: false,
        });
        dabChunks.push(update.dabs);
        pointIndex = batchEnd;
      }
      if (pointIndex >= prepared.points.length) {
        const final = session.finish();
        dabChunks.push(final.dabs);
        finished = true;
      }
      const dabs = concatenateDabs(dabChunks);
      const bytes = packGeometryDabs(dabs, stampOrdinal);
      const instanceCount = bytes.byteLength / STAMP_STRIDE_BYTES;
      stampOrdinal += instanceCount;
      if (bytes.byteLength > 0) packedChunks.push(bytes);
      const geometryCpuMs = geometryCarryMs + performance.now() - generationStartedAt;
      geometryCarryMs = 0;
      if (instanceCount === 0) {
        geometryCarryMs = geometryCpuMs;
        continue;
      }
      const frameSpec: GpuCase = {
        ...baseSpec,
        instanceCount,
        clearBeforeDraw: false,
      };
      const submission = renderer.render(frameSpec, bytes);
      pruneCompletions(outstanding);
      const sample: FrameSample | null = collect
        ? {
            index: samples.length,
            runIndex,
            elapsedMs: logicalInputAt - benchmarkStartedAt,
            frameIntervalMs: previousInputAt === null ? 0 : logicalInputAt - previousInputAt,
            uploadCpuMs: submission.uploadCpuMs,
            encodeCpuMs: submission.encodeCpuMs,
            submitCpuMs: submission.submitCpuMs,
            geometryCpuMs,
            inputToSubmitMs: submission.submittedAt - logicalInputAt,
            inputToGpuCompleteMs: null,
            gpuMs: null,
            backlogAtSubmit: outstanding.length + 1,
            backpressureStallMs: 0,
            instanceCount,
            uploadBytes: bytes.byteLength,
            drawCount: baseSpec.passes,
            passCount: baseSpec.passes,
            submitCount: baseSpec.submits,
            copyCount: baseSpec.copies,
            timerSlot: submission.timerSlot,
            submittedAt: submission.submittedAt,
            completionAt: null,
          }
        : null;
      if (sample) samples.push(sample);
      trackSubmission(submission, logicalInputAt, sample, outstanding);
      const backpressure = await applyBackpressure(outstanding);
      if (sample) sample.backpressureStallMs = backpressure.stallMs;
      maximumBacklogFrames = Math.max(maximumBacklogFrames, backpressure.peak);
      previousInputAt = logicalInputAt;
      lastSubmittedAt = submission.submittedAt;
      const now = performance.now();
      if (mode === "saturation" && now - lastYieldAt >= 100) {
        await yieldToEventLoop();
        lastYieldAt = performance.now();
      }
    }
  } finally {
    if (!finished) session.cancel();
  }
  if (collect && geometryCarryMs > 0 && samples.length > 0) {
    samples[samples.length - 1].geometryCpuMs += geometryCarryMs;
  }
  const activeDurationMs = firstInputAt === null ? 0 : Math.max(0, lastSubmittedAt - firstInputAt);
  await Promise.all(outstanding.map((entry) => entry.promise));
  return {
    samples,
    activeDurationMs,
    queueDrainMs: Math.max(0, performance.now() - lastSubmittedAt),
    maximumBacklogFrames,
    stampCount: stampOrdinal,
    stampHash: hashBytes(concatenateBytes(packedChunks)),
  };
}

async function runE2ECase(
  renderer: BenchmarkRenderer,
  baseSpec: GpuCase,
  prepared: PreparedGeometry,
  geometryBackend: GeometryBackend,
  mode: RunMode,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<CaseExecution> {
  renderer.prepare(baseSpec, prepared.humanStampBytes);
  const canonicalStampHash = hashBytes(prepared.humanStampBytes);
  for (let warmup = 0; warmup < WARMUP_RUNS; warmup += 1) {
    const replay = await runIncrementalReplay(
      renderer,
      baseSpec,
      prepared,
      geometryBackend,
      mode,
      signal,
      warmup,
      false,
      performance.now(),
    );
    if (replay.stampHash !== canonicalStampHash) {
      throw new Error(`Parità geometria incrementale ${geometryBackend} non superata.`);
    }
  }
  renderer.beginTiming(prepared.points.length * MEASURED_RUNS);
  const samples: FrameSample[] = [];
  const queueDrainRuns: number[] = [];
  let activeDurationMs = 0;
  let maximumBacklogFrames = 0;
  let lastStampCount = 0;
  const startedAt = performance.now();
  for (let replayIndex = 0; replayIndex < MEASURED_RUNS; replayIndex += 1) {
    onProgress(
      `${baseSpec.label} · ${geometryBackend}/${renderer.kind} · ${replayIndex + 1}/${MEASURED_RUNS}`,
    );
    const replay = await runIncrementalReplay(
      renderer,
      baseSpec,
      prepared,
      geometryBackend,
      mode,
      signal,
      replayIndex,
      true,
      startedAt,
    );
    if (replay.stampHash !== canonicalStampHash) {
      throw new Error(`Parità geometria incrementale ${geometryBackend} non superata.`);
    }
    for (const sample of replay.samples) {
      sample.index = samples.length;
      samples.push(sample);
    }
    activeDurationMs += replay.activeDurationMs;
    queueDrainRuns.push(replay.queueDrainMs);
    maximumBacklogFrames = Math.max(maximumBacklogFrames, replay.maximumBacklogFrames);
    lastStampCount = replay.stampCount;
  }
  const gpuTimes = await renderer.finishTiming();
  for (const sample of samples) {
    if (sample.timerSlot !== null) sample.gpuMs = gpuTimes[sample.timerSlot] ?? null;
  }
  const pixels = await renderer.readPixels();
  const finalSpec: GpuCase = { ...baseSpec, instanceCount: lastStampCount };
  return {
    result: buildResult(
      renderer,
      finalSpec,
      mode,
      geometryBackend,
      samples,
      activeDurationMs,
      queueDrainRuns,
      maximumBacklogFrames,
      await sha256(pixels),
      "independent-runs",
      null,
    ),
    pixels,
  };
}

async function runSustainedCase(
  renderer: BenchmarkRenderer,
  baseSpec: GpuCase,
  prepared: PreparedGeometry,
  geometryBackend: GeometryBackend,
  mode: RunMode,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<CaseExecution> {
  renderer.prepare(baseSpec, prepared.humanStampBytes);
  const canonicalStampHash = hashBytes(prepared.humanStampBytes);
  for (let warmup = 0; warmup < WARMUP_RUNS; warmup += 1) {
    const replay = await runIncrementalReplay(
      renderer,
      baseSpec,
      prepared,
      geometryBackend,
      mode,
      signal,
      warmup,
      false,
      performance.now(),
    );
    if (replay.stampHash !== canonicalStampHash) {
      throw new Error(`Parità geometria incrementale ${geometryBackend} non superata.`);
    }
  }
  await renderer.resetTarget();
  const sustainedMs = baseSpec.sustainedMs ?? 30_000;
  const timerStride = mode === "saturation" ? 16 : 1;
  renderer.beginTiming(4096, timerStride);
  const samples: FrameSample[] = [];
  const outstanding: OutstandingCompletion[] = [];
  const startedAt = performance.now();
  let lastSubmittedAt = startedAt;
  let firstInputAt: number | null = null;
  let previousInputAt: number | null = null;
  let maximumBacklogFrames = 0;
  let cycle = 0;
  let lastProgressAt = startedAt - 1000;
  let lastYieldAt = startedAt;

  while (performance.now() - startedAt < sustainedMs) {
    const cycleStartedAt = performance.now();
    const sessionStartedAt = performance.now();
    const session = beginPreparedGeometrySession(prepared, geometryBackend);
    let geometryCarryMs = performance.now() - sessionStartedAt;
    let pointIndex = 1;
    let stampOrdinal = 0;
    let pendingInitial = true;
    let finished = false;
    try {
      while (!finished && performance.now() - startedAt < sustainedMs) {
        assertRunnable(signal);
        let logicalInputAt: number;
        let endPoint = pointIndex;
        if (mode === "paced") {
          await nextAnimationFrame(signal);
          const now = performance.now();
          const dueMs = now - cycleStartedAt;
          while (
            endPoint < prepared.points.length
            && prepared.points[endPoint].timeMs <= dueMs
          ) endPoint += 1;
          if (!pendingInitial && endPoint === pointIndex) continue;
          logicalInputAt = cycleStartedAt + prepared.points[pendingInitial ? 0 : pointIndex].timeMs;
        } else {
          logicalInputAt = performance.now();
          endPoint = Math.min(prepared.points.length, pointIndex + 16);
        }
        firstInputAt ??= logicalInputAt;
        const generationStartedAt = performance.now();
        const dabChunks: Float64Array[] = [];
        if (pendingInitial) {
          dabChunks.push(session.initialDab);
          pendingInitial = false;
        }
        while (pointIndex < endPoint) {
          const batchEnd = Math.min(endPoint, pointIndex + 16);
          const update = session.processBatch(prepared.points.slice(pointIndex, batchEnd), {
            includePreviewTail: false,
            includeTail: false,
          });
          dabChunks.push(update.dabs);
          pointIndex = batchEnd;
        }
        if (pointIndex >= prepared.points.length) {
          dabChunks.push(session.finish().dabs);
          finished = true;
        }
        const bytes = packGeometryDabs(concatenateDabs(dabChunks), stampOrdinal);
        const instanceCount = bytes.byteLength / STAMP_STRIDE_BYTES;
        stampOrdinal += instanceCount;
        const geometryCpuMs = geometryCarryMs + performance.now() - generationStartedAt;
        geometryCarryMs = 0;
        if (instanceCount === 0) {
          geometryCarryMs = geometryCpuMs;
          continue;
        }
        const frameSpec: GpuCase = {
          ...baseSpec,
          instanceCount,
          clearBeforeDraw: false,
        };
        const submission = renderer.render(frameSpec, bytes);
        pruneCompletions(outstanding);
        const elapsedMs = logicalInputAt - startedAt;
        const runIndex = Math.min(
          MEASURED_RUNS - 1,
          Math.floor(Math.max(0, elapsedMs) / sustainedMs * MEASURED_RUNS),
        );
        const sample: FrameSample = {
          index: samples.length,
          runIndex,
          elapsedMs,
          frameIntervalMs: previousInputAt === null ? 0 : logicalInputAt - previousInputAt,
          uploadCpuMs: submission.uploadCpuMs,
          encodeCpuMs: submission.encodeCpuMs,
          submitCpuMs: submission.submitCpuMs,
          geometryCpuMs,
          inputToSubmitMs: submission.submittedAt - logicalInputAt,
          inputToGpuCompleteMs: null,
          gpuMs: null,
          backlogAtSubmit: outstanding.length + 1,
          backpressureStallMs: 0,
          instanceCount,
          uploadBytes: bytes.byteLength,
          drawCount: baseSpec.passes,
          passCount: baseSpec.passes,
          submitCount: baseSpec.submits,
          copyCount: baseSpec.copies,
          timerSlot: submission.timerSlot,
          submittedAt: submission.submittedAt,
          completionAt: null,
        };
        samples.push(sample);
        trackSubmission(submission, logicalInputAt, sample, outstanding);
        const backpressure = await applyBackpressure(outstanding);
        sample.backpressureStallMs = backpressure.stallMs;
        maximumBacklogFrames = Math.max(maximumBacklogFrames, backpressure.peak);
        previousInputAt = logicalInputAt;
        lastSubmittedAt = submission.submittedAt;
        const now = performance.now();
        if (now - lastProgressAt >= 1000) {
          onProgress(
            `${baseSpec.label} · ${geometryBackend}/${renderer.kind} · ${Math.min(30, (now - startedAt) / 1000).toFixed(0)}/30 s`,
          );
          lastProgressAt = now;
        }
        if (mode === "saturation" && now - lastYieldAt >= 100) {
          await yieldToEventLoop();
          lastYieldAt = performance.now();
        }
      }
    } finally {
      if (!finished) session.cancel();
    }
    if (geometryCarryMs > 0 && samples.length > 0) {
      samples[samples.length - 1].geometryCpuMs += geometryCarryMs;
    }
    cycle += 1;
    if (cycle > 100_000) throw new Error("Limite di sicurezza del replay sostenuto superato.");
  }

  const activeDurationMs = firstInputAt === null ? 0 : Math.max(0, lastSubmittedAt - firstInputAt);
  await Promise.all(outstanding.map((entry) => entry.promise));
  const drainMs = Math.max(0, performance.now() - lastSubmittedAt);
  const gpuTimes = await renderer.finishTiming();
  for (const sample of samples) {
    if (sample.timerSlot !== null) sample.gpuMs = gpuTimes[sample.timerSlot] ?? null;
  }
  const pixels = await renderer.readPixels();
  const queueDrainRuns: (number | null)[] = Array.from(
    { length: MEASURED_RUNS },
    (_, index) => index === MEASURED_RUNS - 1 ? drainMs : null,
  );
  return {
    result: buildResult(
      renderer,
      baseSpec,
      mode,
      geometryBackend,
      samples,
      activeDurationMs,
      queueDrainRuns,
      maximumBacklogFrames,
      await sha256(pixels),
      "continuous-windows",
      null,
    ),
    pixels,
  };
}

function renderPreview(pixels: Uint8Array): void {
  if (pixels.byteLength !== TARGET_SIZE * TARGET_SIZE * 4) return;
  const context = outputCanvas.getContext("2d");
  if (!context) return;
  const clamped = new Uint8ClampedArray(
    pixels.buffer as ArrayBuffer,
    pixels.byteOffset,
    pixels.byteLength,
  );
  const image = new ImageData(clamped, TARGET_SIZE, TARGET_SIZE);
  context.putImageData(image, 0, 0);
}

function renderResults(results: readonly GpuCaseResult[]): void {
  tableWrap.hidden = results.length === 0;
  resultsBody.innerHTML = results.map((result) => {
    const strategy = result.geometryBackend
      ? `${result.geometryBackend} + ${result.renderer}`
      : result.renderer;
    const parity = result.equivalence.status === "passed"
      ? "OK"
      : result.equivalence.status === "failed" ? "DIFF" : "—";
    return `<tr>
      <td>${result.label}</td>
      <td><code>${strategy}</code></td>
      <td>${formatMs(result.cpuFrameMs.p95)}</td>
      <td>${formatMs(result.inputToGpuCompleteMs.p95)}</td>
      <td data-parity="${result.equivalence.status}">${parity}</td>
    </tr>`;
  }).join("");
  const latest = results.at(-1);
  frameMetric.textContent = formatMs(latest?.cpuFrameMs.p95 ?? null);
  latencyMetric.textContent = formatMs(latest?.inputToGpuCompleteMs.p95 ?? null);
  missMetric.textContent = String(latest?.inputToGpuDeadlineMisses["16.67ms"] ?? 0);
}

function compactResult(result: GpuCaseResult): Record<string, unknown> {
  const copy = { ...result } as Record<string, unknown>;
  delete copy.frameSamples;
  return copy;
}

function localResult(result: GpuCaseResult): GpuCaseResult {
  const maximumSamples = 2000;
  if (result.frameSamples.length <= maximumSamples) return result;
  const step = result.frameSamples.length / maximumSamples;
  const frameSamples = Array.from(
    { length: maximumSamples },
    (_, index) => result.frameSamples[Math.min(
      result.frameSamples.length - 1,
      Math.floor(index * step),
    )],
  );
  return { ...result, frameSamples };
}

function collectEnvironment(renderers: readonly BenchmarkRenderer[]): Record<string, unknown> {
  const navigatorWithMemory = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: {
      brands?: readonly { brand: string; version: string }[];
      mobile?: boolean;
      platform?: string;
    };
  };
  return {
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    runtime: navigatorWithMemory.userAgentData
      ? {
          brands: navigatorWithMemory.userAgentData.brands ?? [],
          mobile: navigatorWithMemory.userAgentData.mobile ?? null,
          operatingSystem: navigatorWithMemory.userAgentData.platform ?? navigator.platform,
        }
      : {
          brands: [],
          mobile: /Mobile|Android/i.test(navigator.userAgent),
          operatingSystem: navigator.platform,
        },
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints,
    devicePixelRatio: window.devicePixelRatio || 1,
    screen: [window.screen.width, window.screen.height],
    viewport: [window.innerWidth, window.innerHeight],
    estimatedRefreshHz: capabilities.refreshHz,
    secureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    temperatureAvailable: false,
    powerAvailable: false,
    completionProxyLimitations: {
      webgpu: "queue completion is not physical display presentation",
      webgl2: "fence polling includes main-thread timer scheduling",
    },
    webgpu: capabilities.webgpuInfo,
    webgl2: capabilities.webglInfo,
    rendererFeatures: Object.fromEntries(
      renderers.map((renderer) => [renderer.kind, renderer.featureNames]),
    ),
    wasm: {
      byteLength: capabilities.wasmBytes,
      compileMs: capabilities.wasmCompileMs,
    },
  };
}

async function saveReport(report: Record<string, unknown>): Promise<number | null> {
  if (import.meta.env.DEV) return null;
  const body = JSON.stringify(report);
  const byteLength = new TextEncoder().encode(body).byteLength;
  if (byteLength > 1_048_576) {
    throw new Error(`Riepilogo troppo grande (${Math.ceil(byteLength / 1024)} KiB).`);
  }
  const response = await fetch("/api/benchmark-runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RGBA8-Lab-Version": RGBA8_LAB_VERSION,
    },
    body,
  });
  if (!response.ok) throw new Error(`Salvataggio dati non riuscito (${response.status}).`);
  const payload = await response.json() as { id?: unknown };
  return typeof payload.id === "number" ? payload.id : null;
}

async function requestWakeLock(): Promise<WakeLockSentinelLike | null> {
  const navigatorWithWakeLock = navigator as Navigator & {
    wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
  };
  try {
    return await navigatorWithWakeLock.wakeLock?.request("screen") ?? null;
  } catch {
    return null;
  }
}

function delayAbortable(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Test interrotto.", "AbortError"));
      return;
    }
    let timeoutId = 0;
    const onAbort = (): void => {
      clearTimeout(timeoutId);
      reject(new DOMException("Test interrotto.", "AbortError"));
    };
    timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function runSuite(): Promise<void> {
  if (activeAbortController) return;
  const controller = new AbortController();
  activeAbortController = controller;
  const signal = controller.signal;
  const suite = suiteSelect.value as SuiteKind;
  const mode = modeSelect.value as RunMode;
  const orderSeed = Date.now() >>> 0;
  let wakeLock: WakeLockSentinelLike | null = null;
  let refreshReport: ((status: "partial" | "completed" | "aborted" | "error") => Record<string, unknown>) | null = null;
  const renderers: BenchmarkRenderer[] = [];
  const results: GpuCaseResult[] = [];
  runButton.disabled = true;
  stopButton.disabled = false;
  copyButton.disabled = true;
  downloadButton.disabled = true;
  suiteSelect.disabled = true;
  modeSelect.disabled = true;
  saveInput.disabled = true;
  progressElement.hidden = false;
  progressElement.value = 0;
  resultsBody.innerHTML = "";
  tableWrap.hidden = true;
  stateMetric.textContent = "In corso";
  statusElement.textContent = "Preparazione geometria JavaScript/Wasm…";
  try {
    wakeLock = await requestWakeLock();
    const geometry = await prepareGeometry(suite === "full");
    if (geometry.results.some((result) => !result.parity.exact)) {
      throw new Error("Parità byte JavaScript/Wasm non superata.");
    }
    const rendererKinds: RendererKind[] = [];
    if (capabilities.webgpu) rendererKinds.push("webgpu");
    if (capabilities.webgl2) rendererKinds.push("webgl2");
    for (const kind of rendererKinds) {
      assertRunnable(signal);
      statusElement.textContent = `Inizializzazione ${kind} RGBA8…`;
      try {
        renderers.push(await createBenchmarkRenderer(kind));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        statusElement.textContent = `${kind} escluso: ${message}`;
      }
    }
    if (renderers.length === 0) throw new Error("Nessun renderer inizializzato.");
    const caseDefinitions = buildGpuCases(
      suite,
      geometry.humanStampBytes.byteLength / STAMP_STRIDE_BYTES,
    );
    const matrixDefinitionHash = await sha256(
      new TextEncoder().encode(JSON.stringify(caseDefinitions)),
    );
    refreshReport = (status) => {
      const environment = {
        ...collectEnvironment(renderers),
        screenWakeLockAcquired: Boolean(wakeLock),
      };
      const report: Record<string, unknown> = {
        version: 1,
        benchmark: {
          id: RGBA8_LAB_VERSION,
          schemaVersion: RGBA8_LAB_SCHEMA_VERSION,
          matrixDefinitionHash,
          status,
          suite,
          target: [TARGET_SIZE, TARGET_SIZE],
          textureFormats: ["rgba8"],
          floatingPointTextures: false,
          submissionIntegrity: "schema-validated same-origin write; no public read endpoint",
          fixture: {
            id: "bundled-human-stroke-187-v1",
            pointCount: geometry.points.length,
            durationMs: geometry.points.at(-1)?.timeMs ?? 0,
            stampBufferHash: hashBytes(geometry.humanStampBytes),
          },
          geometry: geometry.results,
        },
        playback: {
          mode,
          warmupRuns: WARMUP_RUNS,
          independentMeasuredRuns: MEASURED_RUNS,
          pacedFramesPerGenericRun: FRAMES_PER_MEASURED_RUN,
          saturationFramesPerGenericRun: 64,
          sustainedMeasurement: "one-continuous-30s-run-split-into-seven-windows",
          sustainedMeasuredRuns: 1,
          sustainedMeasuredWindows: MEASURED_RUNS,
          sustainedCooldownMs: SUSTAINED_COOLDOWN_MS,
          thermalCarryoverControl: "randomized-order-plus-fixed-cooldown; residual-carryover-possible",
          orderSeed,
          strategyOrder: results.map((result) => ({
            caseId: result.caseId,
            geometryBackend: result.geometryBackend,
            renderer: result.renderer,
          })),
        },
        performance: { results: results.map(compactResult) },
        environment,
      };
      lastReport = {
        ...report,
        raw: {
          sampling: "all frames up to 2000 per cell, otherwise uniform downsample",
          results: results.map(localResult),
        },
      };
      lastCompactReport = report;
      if (results.length > 0) {
        copyButton.disabled = false;
        downloadButton.disabled = false;
      }
      return report;
    };
    const cases = seededShuffle(caseDefinitions, orderSeed);
    const totalCells = cases.reduce(
      (total, spec) => total + renderers.length * (
        spec.category === "e2e" || spec.category === "sustained" ? 2 : 1
      ),
      0,
    );
    progressElement.max = totalCells;
    let completedCells = 0;
    const onCaseProgress = (message: string): void => {
      statusElement.textContent = message;
    };

    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const spec = cases[caseIndex];
      const rendererOrder = caseIndex % 2 === 0 ? [...renderers] : [...renderers].reverse();
      const pendingParity = new Map<string, CaseExecution>();
      const usesGeometry = spec.category === "e2e" || spec.category === "sustained";
      const geometryBackends: readonly (GeometryBackend | null)[] = usesGeometry
        ? caseIndex % 2 === 0 ? ["javascript", "wasm"] : ["wasm", "javascript"]
        : [null];
      const strategies = usesGeometry
        ? seededShuffle(
            geometryBackends.flatMap((geometryBackend) => rendererOrder.map((renderer) => ({
              geometryBackend,
              renderer,
            }))),
            (orderSeed ^ Math.imul(caseIndex + 1, 0x9e3779b1)) >>> 0,
          )
        : rendererOrder.map((renderer) => ({ geometryBackend: null, renderer }));
      for (let strategyIndex = 0; strategyIndex < strategies.length; strategyIndex += 1) {
          const { geometryBackend, renderer } = strategies[strategyIndex];
          assertRunnable(signal);
          if (spec.category === "sustained") {
            for (
              let remainingMs = SUSTAINED_COOLDOWN_MS;
              remainingMs > 0;
              remainingMs -= 1_000
            ) {
              statusElement.textContent = `Cooldown tra strategie · ${Math.ceil(remainingMs / 1_000)} s`;
              await delayAbortable(Math.min(1_000, remainingMs), signal);
            }
          }
          const strategy = geometryBackend
            ? `${geometryBackend}/${renderer.kind}`
            : renderer.kind;
          statusElement.textContent = `${spec.label} · ${strategy}`;
          const bytes = spec.layout === "human"
            ? geometry.humanStampBytes
            : createStampBytes(spec);
          const execution = geometryBackend
            ? spec.category === "sustained"
              ? await runSustainedCase(
                  renderer,
                  spec,
                  geometry,
                  geometryBackend,
                  mode,
                  signal,
                  onCaseProgress,
                )
              : await runE2ECase(
                  renderer,
                  spec,
                  geometry,
                  geometryBackend,
                  mode,
                  signal,
                  onCaseProgress,
                )
            : await runGenericCase(
                renderer,
                spec,
                bytes,
                mode,
                signal,
                onCaseProgress,
              );
          results.push(execution.result);
          if (execution.pixels.byteLength > 0) renderPreview(execution.pixels);
          if (spec.category !== "sustained") {
            const parityKey = geometryBackend ?? "static";
            const previous = pendingParity.get(parityKey);
            if (previous) {
              const comparison = spec.uploadOnly
                ? {
                    valid: previous.result.pixelHash === execution.result.pixelHash,
                    exact: previous.result.pixelHash === execution.result.pixelHash,
                    maximumChannelError: null,
                    differentPixelRatio: null,
                  }
                : comparePixels(previous.pixels, execution.pixels);
              for (const compared of [previous, execution]) {
                compared.result.equivalence = {
                  status: comparison.valid ? "passed" : "failed",
                  exact: comparison.exact,
                  maximumChannelError: comparison.maximumChannelError,
                  differentPixelRatio: comparison.differentPixelRatio,
                  tolerance: spec.uploadOnly
                    ? null
                    : {
                        maximumChannelError: 2,
                        maximumDifferentPixelRatio: 0.001,
                      },
                };
              }
              pendingParity.delete(parityKey);
            } else {
              pendingParity.set(parityKey, execution);
            }
          }
          completedCells += 1;
          progressElement.value = completedCells;
          renderResults(results);
          refreshReport("partial");
      }
      renderResults(results);
      refreshReport("partial");
    }
    const serverReport = refreshReport("completed");
    let savedId: number | null = null;
    let saveWarning: string | null = null;
    if (saveInput.checked) {
      try {
        savedId = await saveReport(serverReport);
      } catch (error) {
        saveWarning = error instanceof Error ? error.message : String(error);
      }
    }
    const failedParity = results.filter((result) => result.equivalence.status === "failed").length;
    stateMetric.textContent = failedParity > 0 ? `${failedParity} diff` : "Completato";
    statusElement.textContent = saveWarning
      ? `Test completato. ${saveWarning} Puoi scaricare il JSON.`
      : savedId
        ? `Test completato e salvato · run #${savedId}.`
        : "Test completato. JSON pronto per il download.";
    copyButton.disabled = false;
    downloadButton.disabled = false;
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    const message = error instanceof Error ? error.message : String(error);
    refreshReport?.(aborted ? "aborted" : "error");
    stateMetric.textContent = aborted ? "Interrotto" : "Errore";
    statusElement.textContent = message;
  } finally {
    for (const renderer of renderers) renderer.dispose();
    await wakeLock?.release().catch(() => undefined);
    activeAbortController = null;
    stopButton.disabled = true;
    suiteSelect.disabled = false;
    modeSelect.disabled = false;
    saveInput.disabled = false;
    runButton.disabled = !(capabilities.wasm && (capabilities.webgpu || capabilities.webgl2));
    progressElement.hidden = true;
  }
}

function downloadReport(): void {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rgba8-performance-${new Date().toISOString().replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

runButton.addEventListener("click", () => {
  void runSuite();
});
stopButton.addEventListener("click", () => {
  activeAbortController?.abort();
});
copyButton.addEventListener("click", () => {
  if (!lastCompactReport) return;
  void navigator.clipboard.writeText(JSON.stringify(lastCompactReport)).then(
    () => {
      statusElement.textContent = "Riepilogo JSON copiato negli appunti.";
    },
    () => {
      statusElement.textContent = "Copia non riuscita: usa Scarica JSON.";
    },
  );
});
downloadButton.addEventListener("click", downloadReport);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") activeAbortController?.abort();
});

void detectCapabilities();
