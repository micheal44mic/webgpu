import "./styles.css";
import {
  BrushEngine,
  type BrushSettings,
  type EngineStats,
  type LayerPoint,
  type LayerFormat,
  type PointerSample,
} from "./brush-engine";

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Elemento #${id} non trovato.`);
  }
  return result as T;
}

function rangeValue(id: string): number {
  return Number(element<HTMLInputElement>(id).value);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(value);
}

const canvas = element<HTMLCanvasElement>("gpuCanvas");
const statusElement = element<HTMLParagraphElement>("status");
const benchmarkButton = element<HTMLButtonElement>("runBenchmark");
const benchmarkResult = element<HTMLParagraphElement>("benchmarkResult");
const recordHumanStrokeButton = element<HTMLButtonElement>("recordHumanStroke");
const playHumanStrokeButton = element<HTMLButtonElement>("playHumanStroke");
const clearHumanStrokeButton = element<HTMLButtonElement>("clearHumanStroke");
const humanStrokeResult = element<HTMLParagraphElement>("humanStrokeResult");
const layerFormatSelect = element<HTMLSelectElement>("layerFormat");

interface HumanStrokePoint extends LayerPoint {
  timeMs: number;
}

interface HumanStrokeBenchmark {
  version: 1;
  capturedAt: string;
  settings: BrushSettings;
  points: HumanStrokePoint[];
}

interface HumanStrokeRecording {
  settings: BrushSettings;
  startTimestamp: number;
  points: HumanStrokePoint[];
}

const HUMAN_STROKE_STORAGE_KEY = "webgpu-brush-engine.human-stroke.v1";

const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
  onStats(stats) {
    updateStats(stats);
  },
});

let humanStrokeBenchmark: HumanStrokeBenchmark | null = loadHumanStrokeBenchmark();
let humanStrokeRecording: HumanStrokeRecording | null = null;
let humanStrokeRecordingArmed = false;
let humanStrokeReplayFrame: number | null = null;
let humanStrokeReplaying = false;

function readBrushSettings(): BrushSettings {
  return {
    color: element<HTMLInputElement>("brushColor").value,
    size: rangeValue("brushSize"),
    spacingPercent: rangeValue("spacing"),
    count: rangeValue("count"),
    flow: rangeValue("flow") / 100,
    hardness: rangeValue("hardness") / 100,
    blendIntensity: rangeValue("blendIntensity"),
    blendMode: element<HTMLSelectElement>("blendMode").value as BrushSettings["blendMode"],
    jitterMaster: rangeValue("jitterMaster") / 100,
    hueJitterDegrees: rangeValue("hueJitter"),
    saturationJitter: rangeValue("saturationJitter") / 100,
    lightnessJitter: rangeValue("lightnessJitter") / 100,
    darknessJitter: rangeValue("darknessJitter") / 100,
    jitterPerCopy: element<HTMLInputElement>("jitterPerCopy").checked,
    positionJitterLateral: rangeValue("positionJitterLateral") / 100,
    positionJitterLinear: rangeValue("positionJitterLinear") / 100,
    pressureSize: rangeValue("pressureSize") / 100,
    pressureOpacity: rangeValue("pressureOpacity") / 100,
  };
}

function updateControlOutputs(): void {
  element<HTMLOutputElement>("brushSizeOut").value = `${rangeValue("brushSize").toFixed(0)} px`;
  element<HTMLOutputElement>("spacingOut").value = `${rangeValue("spacing").toFixed(2)}%`;
  element<HTMLOutputElement>("countOut").value = rangeValue("count").toFixed(0);
  element<HTMLOutputElement>("flowOut").value = `${rangeValue("flow").toFixed(1).replace(".0", "")}%`;
  element<HTMLOutputElement>("hardnessOut").value = `${rangeValue("hardness").toFixed(0)}%`;
  element<HTMLOutputElement>("blendIntensityOut").value = `${rangeValue("blendIntensity").toFixed(2)}×`;
  element<HTMLOutputElement>("jitterMasterOut").value = `${rangeValue("jitterMaster").toFixed(0)}%`;
  element<HTMLOutputElement>("hueJitterOut").value = `${rangeValue("hueJitter").toFixed(0)}°`;
  element<HTMLOutputElement>("saturationJitterOut").value = `${rangeValue("saturationJitter").toFixed(0)}%`;
  element<HTMLOutputElement>("lightnessJitterOut").value = `${rangeValue("lightnessJitter").toFixed(0)}%`;
  element<HTMLOutputElement>("darknessJitterOut").value = `${rangeValue("darknessJitter").toFixed(0)}%`;
  element<HTMLOutputElement>("positionJitterLateralOut").value = `${rangeValue("positionJitterLateral").toFixed(0)}%`;
  element<HTMLOutputElement>("positionJitterLinearOut").value = `${rangeValue("positionJitterLinear").toFixed(0)}%`;
  element<HTMLOutputElement>("pressureSizeOut").value = `${rangeValue("pressureSize").toFixed(0)}%`;
  element<HTMLOutputElement>("pressureOpacityOut").value = `${rangeValue("pressureOpacity").toFixed(0)}%`;
  element<HTMLOutputElement>("benchmarkStampsOut").value = formatInteger(rangeValue("benchmarkStamps"));
}

function applyBrushControls(): void {
  updateControlOutputs();
  engine.setBrushSettings(readBrushSettings());
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function loadHumanStrokeBenchmark(): HumanStrokeBenchmark | null {
  try {
    const stored = window.localStorage.getItem(HUMAN_STROKE_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored) as Partial<HumanStrokeBenchmark>;
    if (parsed.version !== 1 || !parsed.settings || !Array.isArray(parsed.points) || parsed.points.length === 0) {
      return null;
    }
    return parsed as HumanStrokeBenchmark;
  } catch {
    return null;
  }
}

function persistHumanStrokeBenchmark(): void {
  try {
    if (humanStrokeBenchmark) {
      window.localStorage.setItem(HUMAN_STROKE_STORAGE_KEY, JSON.stringify(humanStrokeBenchmark));
    } else {
      window.localStorage.removeItem(HUMAN_STROKE_STORAGE_KEY);
    }
  } catch {
    humanStrokeResult.textContent = "Il tratto è valido per questa sessione, ma non è stato possibile salvarlo sul dispositivo.";
  }
}

function setControlValue(id: string, value: string | number): void {
  element<HTMLInputElement | HTMLSelectElement>(id).value = String(value);
}

function applySettingsToControls(settings: BrushSettings): void {
  setControlValue("brushColor", settings.color);
  setControlValue("brushSize", settings.size);
  setControlValue("spacing", settings.spacingPercent);
  setControlValue("count", settings.count);
  setControlValue("flow", settings.flow * 100);
  setControlValue("hardness", settings.hardness * 100);
  setControlValue("blendIntensity", settings.blendIntensity);
  setControlValue("blendMode", settings.blendMode);
  setControlValue("jitterMaster", settings.jitterMaster * 100);
  setControlValue("hueJitter", settings.hueJitterDegrees);
  setControlValue("saturationJitter", settings.saturationJitter * 100);
  setControlValue("lightnessJitter", settings.lightnessJitter * 100);
  setControlValue("darknessJitter", settings.darknessJitter * 100);
  element<HTMLInputElement>("jitterPerCopy").checked = settings.jitterPerCopy;
  setControlValue("positionJitterLateral", settings.positionJitterLateral * 100);
  setControlValue("positionJitterLinear", settings.positionJitterLinear * 100);
  setControlValue("pressureSize", settings.pressureSize * 100);
  setControlValue("pressureOpacity", settings.pressureOpacity * 100);
  applyBrushControls();
}

function applyHumanStrokePreset(): BrushSettings {
  setControlValue("brushSize", 750);
  setControlValue("spacing", 1);
  setControlValue("count", 16);
  setControlValue("flow", 100);
  setControlValue("hardness", 100);
  setControlValue("jitterMaster", 100);
  setControlValue("hueJitter", 180);
  setControlValue("saturationJitter", 100);
  element<HTMLInputElement>("jitterPerCopy").checked = true;
  setControlValue("positionJitterLateral", 100);
  setControlValue("positionJitterLinear", 100);
  applyBrushControls();
  return readBrushSettings();
}

function updateHumanStrokeControls(): void {
  recordHumanStrokeButton.disabled = humanStrokeReplaying;
  recordHumanStrokeButton.textContent = humanStrokeRecordingArmed
    ? "Annulla registrazione tratto"
    : "Registra tratto umano";
  playHumanStrokeButton.disabled = !humanStrokeBenchmark || humanStrokeReplaying;
  clearHumanStrokeButton.disabled = !humanStrokeBenchmark || humanStrokeReplaying;
}

function describeHumanStrokeBenchmark(benchmark: HumanStrokeBenchmark): string {
  const duration = benchmark.points.at(-1)?.timeMs ?? 0;
  return [
    `Tratto salvato: ${formatInteger(benchmark.points.length)} campioni`,
    `durata ${formatDuration(duration)}`,
    `size ${benchmark.settings.size.toFixed(0)} px`,
    `Count ${benchmark.settings.count}`,
  ].join(" · ");
}

const brushControlIds = [
  "brushColor",
  "brushSize",
  "spacing",
  "count",
  "flow",
  "hardness",
  "blendIntensity",
  "blendMode",
  "jitterMaster",
  "hueJitter",
  "saturationJitter",
  "lightnessJitter",
  "darknessJitter",
  "jitterPerCopy",
  "positionJitterLateral",
  "positionJitterLinear",
  "pressureSize",
  "pressureOpacity",
] as const;

for (const id of brushControlIds) {
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("input", applyBrushControls);
  element<HTMLInputElement | HTMLSelectElement>(id).addEventListener("change", applyBrushControls);
}

element<HTMLInputElement>("benchmarkStamps").addEventListener("input", updateControlOutputs);

element<HTMLButtonElement>("clearLayer").addEventListener("click", () => engine.clear());
element<HTMLButtonElement>("fitView").addEventListener("click", () => engine.fitView());
element<HTMLButtonElement>("zoomIn").addEventListener("click", () => engine.zoomBy(1.35));
element<HTMLButtonElement>("zoomOut").addEventListener("click", () => engine.zoomBy(1 / 1.35));

layerFormatSelect.addEventListener("change", async () => {
  const requested = layerFormatSelect.value as LayerFormat;
  layerFormatSelect.disabled = true;
  try {
    await engine.setLayerFormat(requested);
  } catch {
    layerFormatSelect.value = engine.getStats().layerFormat;
  } finally {
    layerFormatSelect.disabled = false;
  }
});

benchmarkButton.addEventListener("click", async () => {
  benchmarkButton.disabled = true;
  benchmarkResult.textContent = "Benchmark in esecuzione sulla GPU…";
  try {
    const result = await engine.runBenchmark(rangeValue("benchmarkStamps"));
    benchmarkResult.textContent = [
      `${formatInteger(result.baseStamps)} base stamps`,
      `${formatInteger(result.logicalCopies)} copie logiche`,
      `CPU submit ${result.cpuSubmitMs.toFixed(2)} ms`,
      `GPU completion ${result.gpuCompletionMs.toFixed(2)} ms`,
      `copertura teorica ${(result.estimatedCoveredFragments / 1_000_000).toFixed(1)} Mpx`,
      result.strategy,
    ].join(" · ");
  } catch (error) {
    benchmarkResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    benchmarkButton.disabled = false;
  }
});

recordHumanStrokeButton.addEventListener("click", () => {
  if (humanStrokeReplaying || humanStrokeRecording) {
    return;
  }

  humanStrokeRecordingArmed = !humanStrokeRecordingArmed;
  if (humanStrokeRecordingArmed) {
    applyHumanStrokePreset();
    humanStrokeResult.textContent = "Preset umano applicato. Disegna ora una sola pennellata sul canvas.";
  } else {
    humanStrokeResult.textContent = humanStrokeBenchmark
      ? describeHumanStrokeBenchmark(humanStrokeBenchmark)
      : "Registrazione annullata.";
  }
  updateHumanStrokeControls();
});

playHumanStrokeButton.addEventListener("click", () => {
  void replayHumanStroke();
});

clearHumanStrokeButton.addEventListener("click", () => {
  humanStrokeBenchmark = null;
  persistHumanStrokeBenchmark();
  humanStrokeResult.textContent = "Tratto umano eliminato da questo dispositivo.";
  updateHumanStrokeControls();
});

function updateStats(stats: EngineStats): void {
  element<HTMLElement>("fpsStat").textContent = `${stats.fps}`;
  element<HTMLElement>("cpuStat").textContent = `${stats.lastCpuFrameMs.toFixed(2)} ms`;
  element<HTMLElement>("stampStat").textContent = formatInteger(stats.totalBaseStamps);
  element<HTMLElement>("avoidedStat").textContent = formatInteger(stats.avoidedLogicalDraws);
  element<HTMLElement>("memoryStat").textContent = `${stats.layerMemoryMiB} MiB`;
  element<HTMLElement>("gpuStat").textContent = stats.gpuLabel;
}

function startHumanStrokeRecording(event: PointerEvent, sample: PointerSample): void {
  const settings = applyHumanStrokePreset();
  const point = engine.toLayerPoint(sample);
  humanStrokeRecording = {
    settings,
    startTimestamp: event.timeStamp,
    points: [{ ...point, timeMs: 0 }],
  };
  humanStrokeResult.textContent = "Registrazione in corso…";
}

function captureHumanStrokeSamples(events: readonly PointerEvent[], samples: readonly PointerSample[]): void {
  const recording = humanStrokeRecording;
  if (!recording) {
    return;
  }

  for (let index = 0; index < samples.length; index += 1) {
    const previousTime = recording.points[recording.points.length - 1]?.timeMs ?? 0;
    const elapsed = Math.max(previousTime, events[index].timeStamp - recording.startTimestamp, 0);
    recording.points.push({
      ...engine.toLayerPoint(samples[index]),
      timeMs: elapsed,
    });
  }
}

function finishHumanStrokeRecording(shouldSave: boolean): void {
  const recording = humanStrokeRecording;
  humanStrokeRecording = null;
  humanStrokeRecordingArmed = false;

  if (recording && shouldSave && recording.points.length > 1) {
    humanStrokeBenchmark = {
      version: 1,
      capturedAt: new Date().toISOString(),
      settings: recording.settings,
      points: recording.points,
    };
    persistHumanStrokeBenchmark();
    humanStrokeResult.textContent = describeHumanStrokeBenchmark(humanStrokeBenchmark);
  } else if (recording) {
    humanStrokeResult.textContent = "Tratto troppo breve: registra una pennellata con almeno un movimento.";
  }

  updateHumanStrokeControls();
}

async function replayHumanStroke(): Promise<void> {
  const benchmark = humanStrokeBenchmark;
  if (!benchmark || humanStrokeReplaying) {
    return;
  }

  humanStrokeReplaying = true;
  benchmarkButton.disabled = true;
  updateHumanStrokeControls();
  applySettingsToControls(benchmark.settings);
  humanStrokeResult.textContent = "Riproduzione del tratto umano in corso…";

  try {
    await engine.waitForIdle();
    engine.resetStrokeRandomSeed();
    engine.clear();
    await engine.waitForIdle();

    const before = engine.getStats();
    const replayStart = performance.now();
    const lastPoint = benchmark.points[benchmark.points.length - 1];
    let nextPointIndex = 1;

    engine.beginStrokeAtLayer(benchmark.points[0]);

    await new Promise<void>((resolve) => {
      const step = (timestamp: number) => {
        const elapsed = timestamp - replayStart;
        const duePoints: HumanStrokePoint[] = [];

        while (
          nextPointIndex < benchmark.points.length &&
          benchmark.points[nextPointIndex].timeMs <= elapsed
        ) {
          duePoints.push(benchmark.points[nextPointIndex]);
          nextPointIndex += 1;
        }

        if (duePoints.length > 0) {
          engine.extendStrokeAtLayer(duePoints);
        }

        if (nextPointIndex < benchmark.points.length) {
          humanStrokeReplayFrame = requestAnimationFrame(step);
          return;
        }

        engine.endStroke();
        humanStrokeReplayFrame = null;
        resolve();
      };

      humanStrokeReplayFrame = requestAnimationFrame(step);
    });

    const inputFinishedAt = performance.now();
    await engine.waitForIdle();
    const completedAt = performance.now();
    const after = engine.getStats();
    const baseStamps = Math.max(0, after.totalBaseStamps - before.totalBaseStamps);
    const copies = baseStamps * benchmark.settings.count;

    humanStrokeResult.textContent = [
      `Tratto ${formatDuration(lastPoint.timeMs)}`,
      `${formatInteger(benchmark.points.length)} campioni`,
      `${formatInteger(baseStamps)} stamps base`,
      `${formatInteger(copies)} copie fisiche`,
      `coda GPU ${Math.max(0, completedAt - inputFinishedAt).toFixed(2)} ms`,
      `CPU frame ${after.lastCpuFrameMs.toFixed(2)} ms`,
    ].join(" · ");
  } catch (error) {
    humanStrokeResult.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    humanStrokeReplaying = false;
    benchmarkButton.disabled = false;
    updateHumanStrokeControls();
  }
}

function normalizedPressure(event: PointerEvent): number {
  if (event.pointerType === "mouse") {
    return 1;
  }
  if (event.pressure > 0) {
    return event.pressure;
  }
  return event.pointerType === "pen" ? 0.5 : 0.65;
}

function toPointerSample(event: PointerEvent): PointerSample {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: normalizedPressure(event),
  };
}

let activePointerId: number | null = null;
let pointerMode: "paint" | "pan" | null = null;
let lastPanClientX = 0;
let lastPanClientY = 0;

canvas.addEventListener("pointerdown", (event) => {
  if (activePointerId !== null) {
    return;
  }

  event.preventDefault();
  activePointerId = event.pointerId;
  const shouldPan = event.shiftKey || event.button === 1 || event.button === 2;
  pointerMode = shouldPan ? "pan" : "paint";
  canvas.setPointerCapture(event.pointerId);

  if (pointerMode === "pan") {
    canvas.classList.add("panning");
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
  } else {
    const sample = toPointerSample(event);
    if (humanStrokeRecordingArmed) {
      startHumanStrokeRecording(event, sample);
    }
    engine.beginStroke(sample);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId || pointerMode === null) {
    return;
  }

  event.preventDefault();
  if (pointerMode === "pan") {
    engine.panByClientDelta(event.clientX - lastPanClientX, event.clientY - lastPanClientY);
    lastPanClientX = event.clientX;
    lastPanClientY = event.clientY;
    return;
  }

  const eventWithCoalescing = event as PointerEvent & {
    getCoalescedEvents?: () => PointerEvent[];
  };
  const coalesced = eventWithCoalescing.getCoalescedEvents?.() ?? [];
  const sourceEvents = coalesced.length > 0 ? coalesced : [event];
  const samples = sourceEvents.map(toPointerSample);
  captureHumanStrokeSamples(sourceEvents, samples);
  engine.extendStroke(samples);
});

function finishPointer(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }

  if (pointerMode === "paint") {
    engine.endStroke();
    finishHumanStrokeRecording(event.type === "pointerup");
  }
  canvas.classList.remove("panning");
  pointerMode = null;
  activePointerId = null;
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("lostpointercapture", finishPointer);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    engine.zoomBy(Math.min(2, Math.max(0.5, factor)), event.clientX, event.clientY);
  },
  { passive: false },
);

const resizeObserver = new ResizeObserver(() => engine.resizeCanvas());
resizeObserver.observe(canvas);

updateControlOutputs();
engine.setBrushSettings(readBrushSettings());
if (humanStrokeBenchmark) {
  humanStrokeResult.textContent = describeHumanStrokeBenchmark(humanStrokeBenchmark);
}
updateHumanStrokeControls();

void engine.initialize().catch((error) => {
  const secureContextHint = !window.isSecureContext
    ? " WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente."
    : "";
  statusElement.textContent = `${error instanceof Error ? error.message : String(error)}${secureContextHint}`;
  statusElement.className = "status error";
  benchmarkButton.disabled = true;
});

window.setInterval(() => updateStats(engine.getStats()), 500);
