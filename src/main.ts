import "./styles.css";
import {
  BrushEngine,
  type BrushSettings,
  type EngineStats,
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
const layerFormatSelect = element<HTMLSelectElement>("layerFormat");

const engine = new BrushEngine(canvas, {
  onStatus(message, kind) {
    statusElement.textContent = message;
    statusElement.className = `status ${kind === "working" ? "" : kind}`;
  },
  onStats(stats) {
    updateStats(stats);
  },
});

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
  element<HTMLOutputElement>("pressureSizeOut").value = `${rangeValue("pressureSize").toFixed(0)}%`;
  element<HTMLOutputElement>("pressureOpacityOut").value = `${rangeValue("pressureOpacity").toFixed(0)}%`;
  element<HTMLOutputElement>("benchmarkStampsOut").value = formatInteger(rangeValue("benchmarkStamps"));
}

function applyBrushControls(): void {
  updateControlOutputs();
  engine.setBrushSettings(readBrushSettings());
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

function updateStats(stats: EngineStats): void {
  element<HTMLElement>("fpsStat").textContent = `${stats.fps}`;
  element<HTMLElement>("cpuStat").textContent = `${stats.lastCpuFrameMs.toFixed(2)} ms`;
  element<HTMLElement>("stampStat").textContent = formatInteger(stats.totalBaseStamps);
  element<HTMLElement>("avoidedStat").textContent = formatInteger(stats.avoidedLogicalDraws);
  element<HTMLElement>("memoryStat").textContent = `${stats.layerMemoryMiB} MiB`;
  element<HTMLElement>("gpuStat").textContent = stats.gpuLabel;
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
    engine.beginStroke(toPointerSample(event));
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
  const samples = (coalesced.length > 0 ? coalesced : [event]).map(toPointerSample);
  engine.extendStroke(samples);
});

function finishPointer(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) {
    return;
  }

  if (pointerMode === "paint") {
    engine.endStroke();
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

void engine.initialize().catch((error) => {
  const secureContextHint = !window.isSecureContext
    ? " WebGPU richiede HTTPS oppure localhost; un indirizzo LAN in HTTP non è sufficiente."
    : "";
  statusElement.textContent = `${error instanceof Error ? error.message : String(error)}${secureContextHint}`;
  statusElement.className = "status error";
  benchmarkButton.disabled = true;
});

window.setInterval(() => updateStats(engine.getStats()), 500);
