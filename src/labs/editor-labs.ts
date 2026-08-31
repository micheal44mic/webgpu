import type {
  EditorExtension,
  EditorExtensionHost,
} from "../editor-extension-contract";
import {
  benchmarkEffectsWorkingSet,
  measureLayerColdCompressionStudy,
  runBenchmark,
} from "./engine-lab-operations";
import type { BrushSettings, PointerSample } from "../engine-types";
import { HumanStrokeLab } from "./human-stroke-lab";

const HUMAN_RECORDING_PRESET_LABEL =
  "4K · Custom Shape · Texture · Count 16 · Spacing 1% · Intense Blending";

function humanRecordingPreset(base: BrushSettings): BrushSettings {
  return {
    ...base,
    tool: "paint",
    shape: "shape",
    shapeScatter: 1,
    grainMode: "texturized",
    grainFiltering: "improved",
    spacingPercent: 1,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 16,
    blendIntensity: 1,
    blendMode: "intense-blending",
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  };
}

const LABS = [
  ["stroke-golden", "Golden tratto raster"],
  ["shadow-golden", "Golden ombre raster"],
  ["bevel-golden", "Golden bevel bounding-box"],
  ["paint-benchmark", "Benchmark Paint sintetico"],
  ["effects-benchmark", "Benchmark banco effetti"],
  ["layer-history", "GPU test cronologia livelli"],
  ["cold-tile", "GPU test cold tile"],
  ["clipping", "GPU test clipping group"],
  ["raster-tone-curves", "GPU test curve raster · 512"],
  ["raster-color-balance", "GPU test bilanciamento colore · 512"],
  ["raster-gradient-map", "GPU test mappa gradiente · 512"],
  ["layer-blend", "GPU test fusioni livello"],
  ["group-transform", "GPU test trasformazione gruppo"],
  ["empty-import-svg", "GPU smoke import SVG su documento vuoto"],
  ["empty-import-image", "GPU smoke import immagine su documento vuoto"],
  ["layer-merge-raster", "GPU test merge raster"],
  ["layer-merge-clipping", "GPU test merge clipping"],
  ["layer-merge-mixed", "GPU test merge mixed"],
  ["layer-merge-memory", "GPU test merge memoria"],
  ["layer-merge-reject", "GPU test merge reject"],
  ["memory-stress", "Stress memoria livelli"],
  ["mixed-memory", "Benchmark memoria mista"],
  ["iphone-memory", "Ricerca limite iPhone"],
  ["layer-compression", "Studio compressione lossless"],
  ["vector-zoom-stress", "Stress zoom vettoriale"],
  ["vector-zoom-during", "A/B zoom · refresh durante il gesto"],
  ["vector-zoom-release", "A/B zoom · refresh al rilascio"],
  ["vector-zoom-coverage", "Zoom-out vettoriale · copertura C"],
  ["vector-baseline-shared", "Baseline vettori · geometria condivisa"],
  ["vector-baseline-unique", "Baseline vettori · revisioni uniche"],
  ["vector-baseline-curved-strokes", "Baseline vettori · curve e tratteggi"],
  ["vector-baseline-effects", "Baseline vettori · effetti condivisi"],
  ["human-record", "Registra · Custom 16 Intense"],
  ["human-replay", "Replay tratto umano canonico"],
  ["human-shape-sequence", "Confronto Shape ordinata/casuale · Count 1"],
  ["human-blend", "Replay Blend su sfondo multicolore"],
  ["human-suite", "Suite tratto umano · 3 rendering"],
] as const;
const DESTRUCTIVE_GPU_LAB_TIMEOUT_MS = 180_000;
const HOSTED_REPLAY_ONLY = import.meta.env.PROD;

type LabId = (typeof LABS)[number][0];

function isLabId(value: string | null): value is LabId {
  return LABS.some(([id]) => id === value);
}

function hostedLabId(value: string | null): LabId {
  return value === "human-shape-sequence" ? value : "human-replay";
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array || item instanceof Uint16Array) {
      return { type: item.constructor.name, byteLength: item.byteLength };
    }
    return item;
  }, 2);
}

function reportSucceeded(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const report = value as Record<string, unknown>;
  if (report.passed === false || report.saved === false) return false;
  return report.allRunsSaved !== false;
}

async function saveLabReport(endpoint: string, report: unknown): Promise<number> {
  if (import.meta.env.DEV) return 0;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error("Misura completata, ma il report non è stato salvato nel progetto.");
  }
  const payload = await response.json() as { id?: unknown };
  return typeof payload.id === "number" ? payload.id : 0;
}

class EditorLabController implements EditorExtension {
  readonly #host: EditorExtensionHost;
  readonly #select: HTMLSelectElement;
  readonly #runButton: HTMLButtonElement;
  readonly #recordControls: HTMLDivElement;
  readonly #recordStartButton: HTMLButtonElement;
  readonly #recordFinishButton: HTMLButtonElement;
  readonly #result: HTMLParagraphElement;
  readonly #report: HTMLPreElement;
  #busy = false;
  #latchedBusy = false;
  readonly #humanStroke: HumanStrokeLab;

  constructor(host: EditorExtensionHost) {
    this.#host = host;
    const panel = document.createElement("aside");
    panel.className = "editor-labs-panel";
    panel.setAttribute("aria-label", "WebGPU Brush Engine Labs");
    panel.innerHTML = `
      <h1>Editor Labs</h1>
      <p>Entry separato: questi strumenti non entrano nel bundle dell'app.</p>
      <label>
        Laboratorio
        <select data-lab-select></select>
      </label>
      <button type="button" data-lab-run disabled>Avvia laboratorio</button>
      <div class="editor-labs-record-controls" data-human-record-controls hidden>
        <button type="button" data-human-record-start>Inizia registrazione</button>
        <button type="button" data-human-record-finish disabled>Termina registrazione</button>
      </div>
      <p class="editor-labs-result" data-lab-result>Inizializzazione WebGPU…</p>
      <pre class="editor-labs-report" data-lab-report hidden></pre>
    `;
    document.body.append(panel);

    this.#select = panel.querySelector("[data-lab-select]") as HTMLSelectElement;
    this.#runButton = panel.querySelector("[data-lab-run]") as HTMLButtonElement;
    this.#recordControls = panel.querySelector(
      "[data-human-record-controls]",
    ) as HTMLDivElement;
    this.#recordStartButton = panel.querySelector(
      "[data-human-record-start]",
    ) as HTMLButtonElement;
    this.#recordFinishButton = panel.querySelector(
      "[data-human-record-finish]",
    ) as HTMLButtonElement;
    this.#result = panel.querySelector("[data-lab-result]") as HTMLParagraphElement;
    this.#report = panel.querySelector("[data-lab-report]") as HTMLPreElement;
    this.#humanStroke = new HumanStrokeLab(
      host.engine,
      (report) => this.#showExternalReport(report),
      (message, kind) => host.setStatus(message, kind),
      (settings) => host.applyBrushSettings(settings),
      () => host.collectInputDiagnostics(),
      () => host.refreshControls(),
    );
    for (const [id, label] of LABS) {
      if (HOSTED_REPLAY_ONLY && id !== "human-replay" && id !== "human-shape-sequence") continue;
      this.#select.add(new Option(label, id));
    }
    const requested = new URLSearchParams(window.location.search).get("lab");
    if (HOSTED_REPLAY_ONLY) {
      this.#select.value = hostedLabId(requested);
    } else if (isLabId(requested)) {
      this.#select.value = requested;
    }
    this.#runButton.addEventListener("click", () => {
      void this.#runSelected();
    });
    this.#recordStartButton.addEventListener("click", () => {
      void this.#startHumanRecording();
    });
    this.#recordFinishButton.addEventListener("click", () => {
      void this.#finishHumanRecording();
    });
    this.#select.addEventListener("change", () => {
      this.#host.refreshControls();
    });
  }

  isBusy(): boolean {
    return this.#busy || this.#latchedBusy || this.#humanStroke.isBusy();
  }

  syncControls(editorLocked: boolean): void {
    const busy = this.isBusy();
    const recordingSelected = this.#select.value === "human-record";
    const recordingActive = this.#humanStroke.isArmed();
    this.#recordControls.hidden = !recordingSelected;
    this.#runButton.hidden = recordingSelected;
    this.#select.disabled = busy || recordingActive;
    this.#runButton.disabled = busy || editorLocked || recordingSelected;
    this.#recordStartButton.disabled = busy || editorLocked || recordingActive;
    this.#recordFinishButton.disabled = busy
      || editorLocked
      || !recordingActive
      || this.#humanStroke.isCapturingStroke()
      || !this.#humanStroke.hasCapturedStroke();
  }

  async afterEngineInitialized(): Promise<void> {
    const search = new URLSearchParams(window.location.search);
    const requested = HOSTED_REPLAY_ONLY
      ? hostedLabId(search.get("lab"))
      : search.get("lab");
    this.#result.textContent = requested === "human-record"
      ? `Preset pronto: ${HUMAN_RECORDING_PRESET_LABEL}.`
      : "Pronto. I test distruttivi richiedono una pagina nuova.";
    this.syncControls(false);
    if (isLabId(requested) && search.get("autorun") === "1") {
      if (requested === "human-record") {
        await this.#startHumanRecording();
      } else {
        await this.#runSelected();
      }
    }
  }

  handleEngineInitializationError(error: unknown): void {
    this.#result.textContent = error instanceof Error ? error.message : String(error);
    this.#result.classList.add("error");
  }

  wantsPaintRecording(): boolean {
    return this.#humanStroke.isArmed();
  }

  beginPaintRecording(event: PointerEvent, sample: PointerSample): void {
    this.#humanStroke.begin(event, sample);
    this.#result.textContent = "Registrazione del tratto in corso…";
  }

  capturePaintRecording(
    events: readonly PointerEvent[],
    samples: readonly PointerSample[],
  ): void {
    this.#humanStroke.capture(events, samples);
  }

  beginPaintReleaseRecording(event: PointerEvent): void {
    this.#humanStroke.beginRelease(event);
  }

  finishPaintRecording(commit: boolean): void {
    this.#humanStroke.finish(commit);
    this.#result.textContent = this.#humanStroke.hasCapturedStroke()
      ? "Tratto acquisito. Premi Termina registrazione per salvarlo."
      : "Tratto non acquisito: disegnalo di nuovo.";
  }

  cancelPaintRecording(): void {
    this.#humanStroke.cancel();
    this.#result.textContent = "Tratto annullato: disegnalo di nuovo.";
  }

  #showExternalReport(report: unknown): void {
    window.__editorLabReport = report;
    this.#report.textContent = serialize(report);
    this.#report.hidden = false;
    const failed = typeof report === "object"
      && report !== null
      && "saved" in report
      && report.saved === false;
    const error = failed && "error" in report && typeof report.error === "string"
      ? report.error
      : null;
    this.#result.textContent = error ?? "Fixture tratto umano aggiornata.";
    this.#result.classList.toggle("error", failed);
    this.#host.refreshControls();
  }

  async #startHumanRecording(): Promise<void> {
    if (this.isBusy() || this.#humanStroke.isArmed()) return;
    this.#busy = true;
    this.#report.hidden = true;
    this.#result.classList.remove("error");
    this.#result.textContent = `Preparazione ${HUMAN_RECORDING_PRESET_LABEL}…`;
    this.#host.setStatus("Preparazione del pennello di prova…", "working");
    this.#host.refreshControls();
    try {
      const settings = humanRecordingPreset(this.#host.engine.getSettings());
      this.#host.applyBrushSettings(settings);
      await this.#host.engine.ensureCurrentBrushResources();
      const recording = this.#humanStroke.startRecordingSession();
      window.__editorLabReport = {
        ...recording,
        preset: HUMAN_RECORDING_PRESET_LABEL,
      };
      this.#result.textContent =
        `${HUMAN_RECORDING_PRESET_LABEL}. Disegna il tratto, poi premi Termina.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#result.textContent = message;
      this.#result.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#busy = false;
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #finishHumanRecording(): Promise<void> {
    this.#result.classList.remove("error");
    this.#result.textContent = "Salvataggio registrazione…";
    try {
      const report = await this.#humanStroke.finishRecordingSession();
      if (!report.saved) this.#result.classList.add("error");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#result.textContent = message;
      this.#result.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #runSelected(): Promise<void> {
    if (this.#busy) return;
    const id = this.#select.value;
    if (!isLabId(id)) throw new Error(`Laboratorio sconosciuto: ${id}`);
    this.#busy = true;
    this.#report.hidden = true;
    this.#result.classList.remove("error");
    this.#result.textContent = `Esecuzione ${id}…`;
    this.#host.setStatus(`Laboratorio ${id} in corso…`, "working");
    this.#host.refreshControls();
    try {
      const report = await this.#run(id);
      window.__editorLabReport = report;
      this.#report.textContent = serialize(report);
      this.#report.hidden = false;
      if (reportSucceeded(report)) {
        this.#result.textContent = `Completato: ${id}`;
        this.#host.setStatus(`Laboratorio ${id} completato.`, "ok");
      } else {
        this.#result.textContent = `Completato con errori: ${id}`;
        this.#result.classList.add("error");
        this.#host.setStatus(`Laboratorio ${id} completato con errori.`, "error");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = {
        lab: id,
        passed: false,
        error: message,
        ...(import.meta.env.DEV && error instanceof Error && error.stack
          ? { stack: error.stack }
          : {}),
      };
      window.__editorLabReport = failure;
      this.#report.textContent = serialize(failure);
      this.#report.hidden = false;
      this.#result.textContent = message;
      this.#result.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#busy = false;
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #run(id: LabId): Promise<unknown> {
    const { engine } = this.#host;
    switch (id) {
      case "stroke-golden": {
        await engine.waitForIdle();
        const { runRasterStrokeGolden } = await import("./goldens/stroke-golden");
        return runRasterStrokeGolden(engine.device, {
          bevelBoundingFieldEnabled: engine.bevelBoundingFieldEnabled,
        });
      }
      case "shadow-golden": {
        await engine.waitForIdle();
        const { runRasterShadowGolden } = await import("./goldens/shadow-golden");
        return runRasterShadowGolden(engine.device);
      }
      case "bevel-golden": {
        await engine.waitForIdle();
        const { runRasterBevelBboxGolden } = await import("./goldens/bevel-bbox-golden");
        return runRasterBevelBboxGolden(engine.device);
      }
      case "paint-benchmark":
        return runBenchmark(engine, 2_000);
      case "effects-benchmark":
        return benchmarkEffectsWorkingSet(engine, 5);
      case "layer-history": {
        const { runLayerHistoryGpuTest } = await import("./gpu/layer-history-gpu-test");
        let timeoutId = 0;
        try {
          return await Promise.race([
            runLayerHistoryGpuTest(engine),
            new Promise<never>((_resolve, reject) => {
              timeoutId = window.setTimeout(() => {
                this.#latchedBusy = true;
                reject(new Error("Test livelli scaduto dopo 180 s; ricarica la pagina Labs."));
              }, DESTRUCTIVE_GPU_LAB_TIMEOUT_MS);
            }),
          ]);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      case "cold-tile": {
        const { runLayerColdTileCompositeGpuTest } = await import(
          "./gpu/layer-cold-tile-composite-gpu-test"
        );
        return runLayerColdTileCompositeGpuTest(engine);
      }
      case "clipping": {
        const { runClippingGroupGpuTest } = await import("./gpu/clipping-group-gpu-test");
        return runClippingGroupGpuTest(engine);
      }
      case "raster-tone-curves": {
        const { runRasterToneCurvesGpuTest } = await import(
          "./gpu/raster-tone-curves-gpu-test"
        );
        let timeoutId = 0;
        try {
          return await Promise.race([
            runRasterToneCurvesGpuTest(engine),
            new Promise<never>((_resolve, reject) => {
              timeoutId = window.setTimeout(() => {
                this.#latchedBusy = true;
                reject(new Error("Test curve scaduto dopo 180 s; ricarica la pagina Labs."));
              }, DESTRUCTIVE_GPU_LAB_TIMEOUT_MS);
            }),
          ]);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      case "raster-color-balance": {
        const { runRasterColorBalanceGpuTest } = await import(
          "./gpu/raster-color-balance-gpu-test"
        );
        let timeoutId = 0;
        try {
          return await Promise.race([
            runRasterColorBalanceGpuTest(engine),
            new Promise<never>((_resolve, reject) => {
              timeoutId = window.setTimeout(() => {
                this.#latchedBusy = true;
                reject(new Error(
                  "Test bilanciamento colore scaduto dopo 180 s; ricarica la pagina Labs.",
                ));
              }, DESTRUCTIVE_GPU_LAB_TIMEOUT_MS);
            }),
          ]);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      case "raster-gradient-map": {
        await this.#host.ensureMixedSceneController();
        const { runRasterGradientMapGpuTest } = await import(
          "./gpu/raster-gradient-map-gpu-test"
        );
        let timeoutId = 0;
        try {
          return await Promise.race([
            runRasterGradientMapGpuTest(engine),
            new Promise<never>((_resolve, reject) => {
              timeoutId = window.setTimeout(() => {
                this.#latchedBusy = true;
                reject(new Error(
                  "Test mappa gradiente scaduto dopo 180 s; ricarica la pagina Labs.",
                ));
              }, DESTRUCTIVE_GPU_LAB_TIMEOUT_MS);
            }),
          ]);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      case "layer-blend": {
        const { runLayerBlendGpuTest } = await import("./gpu/layer-blend-gpu-test");
        return runLayerBlendGpuTest(engine);
      }
      case "group-transform": {
        await this.#host.ensureMixedSceneController();
        const { runGroupTransformGpuTest } = await import(
          "./gpu/group-transform-gpu-test"
        );
        return runGroupTransformGpuTest(engine);
      }
      case "empty-import-svg":
      case "empty-import-image": {
        const { runEmptyDocumentImportGpuTest } = await import(
          "./gpu/empty-document-import-gpu-test"
        );
        return runEmptyDocumentImportGpuTest(
          engine,
          id === "empty-import-svg" ? "svg" : "image",
        );
      }
      case "layer-merge-raster":
      case "layer-merge-clipping":
      case "layer-merge-mixed":
      case "layer-merge-memory":
      case "layer-merge-reject": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runLayerMergeGpuTest } = await import("./gpu/layer-merge-gpu-test");
        return runLayerMergeGpuTest(
          engine,
          controller,
          id.slice("layer-merge-".length) as "raster" | "clipping" | "mixed" | "memory" | "reject",
        );
      }
      case "memory-stress": {
        const { runLayerMemoryStressTest } = await import("./memory/layer-memory-stress-test");
        return runLayerMemoryStressTest(engine);
      }
      case "mixed-memory": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runMixedMemoryBenchmarkStudy } = await import("./memory/mixed-memory-benchmark");
        const target = new URLSearchParams(window.location.search).get("targetMiB") === "600"
          ? 600
          : 800;
        return runMixedMemoryBenchmarkStudy(engine, controller, target, (progress) => {
          this.#host.setStatus(
            `Memoria mista: ${progress.textNodeCount} testi, ${progress.rasterLayerCount} raster, `
              + `${progress.countedTotalMiB.toFixed(1)}/${progress.targetMiB} MiB.`,
            "working",
          );
          this.#host.refreshStats();
        });
      }
      case "iphone-memory": {
        const {
          recoverInterruptedIphoneMemoryLimitRun,
          runIphoneMemoryLimitTest,
        } = await import("./memory/iphone-memory-limit-test");
        const search = new URLSearchParams(window.location.search);
        const serverRequired = search.get("localOnly") !== "1";
        const previousRun = await recoverInterruptedIphoneMemoryLimitRun(serverRequired);
        const report = await runIphoneMemoryLimitTest(engine, {
          deviceLabel: search.get("device") ?? undefined,
          serverRequired,
          onProgress: (progress) => {
            this.#host.setStatus(
              `Limite iPhone: ${progress.completedOperations}/${progress.totalOperations} operazioni.`,
              "working",
            );
            this.#host.refreshStats();
          },
        });
        return { previousRun, report };
      }
      case "layer-compression": {
        const report = await measureLayerColdCompressionStudy(engine, (progress) => {
          this.#host.setStatus(
            `Compressione: livello ${progress.layerNumber}/${progress.layerCount}, `
              + `${progress.completedTiles}/${progress.totalTiles} tile.`,
            "working",
          );
        });
        const savedRunId = await saveLabReport("/api/layer-compression-runs", report);
        return { report, savedRunId };
      }
      case "vector-zoom-stress":
      case "vector-zoom-during":
      case "vector-zoom-release":
      case "vector-zoom-coverage": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runVectorZoomLab } = await import("./vector/vector-zoom-labs");
        const kind = id.slice("vector-zoom-".length) as
          | "stress" | "during" | "release" | "coverage";
        return runVectorZoomLab(engine, controller, this.#host.canvas, kind);
      }
      case "vector-baseline-shared":
      case "vector-baseline-unique":
      case "vector-baseline-curved-strokes":
      case "vector-baseline-effects": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runVectorBaselineBenchmark } = await import(
          "./vector/vector-baseline-benchmark"
        );
        return runVectorBaselineBenchmark(
          engine,
          controller,
          this.#host.canvas,
          id === "vector-baseline-shared"
            ? "shared"
            : id === "vector-baseline-unique"
              ? "unique"
              : id === "vector-baseline-curved-strokes"
                ? "curved-strokes"
                : "effects-shared",
        );
      }
      case "human-record":
        return this.#humanStroke.startRecordingSession();
      case "human-replay": {
        const search = new URLSearchParams(window.location.search);
        const requestedBlendMode = search.get("blendMode");
        const blendMode = requestedBlendMode === "uniformed-glaze"
          || requestedBlendMode === "intense-blending"
          ? requestedBlendMode
          : "light-glaze";
        const fur = search.get("variant") === "fur";
        const texturized = search.get("grain") === "texturized";
        return this.#humanStroke.replay("canonical", {
          blendMode,
          ...(fur ? {
            shape: "shape" as const,
            shapeScatter: 1,
            positionJitterLateral: 0,
            positionJitterLinear: 0,
          } : {}),
          ...(texturized ? { grainMode: "texturized" as const } : {}),
        });
      }
      case "human-shape-sequence":
        return this.#humanStroke.runShapeSequenceComparison();
      case "human-blend":
        return this.#humanStroke.replayBlendCarrier();
      case "human-suite":
        return this.#humanStroke.runRenderingSuite();
    }
  }
}

export function createEditorLabController(host: EditorExtensionHost): EditorExtension {
  return new EditorLabController(host);
}
